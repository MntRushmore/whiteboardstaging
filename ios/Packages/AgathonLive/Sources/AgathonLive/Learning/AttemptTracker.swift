import AgathonKit
import Foundation

/// The attempt tracker: the web's `AttemptTracker` (src/lib/learning/tracker.ts) in Swift, rule for
/// rule, so an attempt recorded on the iPad is the attempt the web would have recorded for the same
/// board events (`LearningParityTests` holds it to the web's golden results).
///
/// It turns the board's learning signals into attempts — one `LearningRecord` per problem the
/// student works on a screen — keeps each one's latest state, publishes it as it changes and saves
/// what changed when asked (`flush`). A state machine over the signals: time is the signals' own
/// (`at`), or `deps.now` for what the tracker does on its own (`tick`, a mistake classified); ids are
/// `deps.newId`; nothing here sets a timer (`LearningRecorder` closes idle attempts and decides when
/// to save).
///
/// The rules (the web's):
///  - An attempt starts on `problem` (the tutor wrote one), on `tutorSolved` of a problem it does
///    not know, or on the first `line` of a problem it does not know: then the problem is the
///    student's own (origin `student`, its LaTeX the head line the signal carries) — or, for one of
///    the tutor's problems written before this session (`#cell:` key), `tutor_problem`. A `problem`
///    arriving after its first `line` still says where the problem came from.
///  - Its skill is the brain's `classify(problemLatex, course)` (`deps.classify`), again whenever a
///    student's head line is read differently.
///  - Counts are per distinct line id: a line counts once however often it is read, is ringed once
///    however often it is ringed, and is right when its latest mark is a tick.
///  - A ringed line with the line above it and no model mistake for its read is classified locally
///    (`deps.classifyMistake`, async, guarded); a model mistake for the same read wins over a local
///    one. A line counts each kind of mistake once, however often it is read again with it.
///  - Active time is the gaps between events, each capped at `maxGapMs` — and never earlier than the
///    board's previous event. A `problem` signal starts the clock without adding to it.
///  - The outcome is `AttemptCounts.outcome` over the counts the record carries, always; who
///    answered stays (`solvedByStudent`, `tutorFinished`). `finishedAt` is set when the outcome
///    leaves `in_progress`, and stays when one answered outcome gives way to another.
///  - An attempt closes when its screen is left, the board closes, or after `idleCloseMs` with no
///    event (`tick`); a closed one that gets a new signal opens again.
///  - An attempt is recorded (published, saved) only once it holds something: a line the tutor
///    judged, any tutor help, the tutor finishing it, or — for a problem the tutor gave — any line.
///  - Help about a problem not known yet is kept briefly and counted when the attempt starts.
@MainActor
public final class AttemptTracker {
    public struct Deps {
        /// ms since the epoch (`Date.now()`)
        public var now: () -> Double
        /// a uuid v4, lower case
        public var newId: () -> String
        /// the student's course, for the record (`classify` already has it)
        public var course: String?
        /// the skill a problem is filed under (`classifyProblem(lines, course)`); synchronous: the
        /// recorder asks the brain before it hands a signal over
        public var classify: ([String]) -> String
        /// saves a batch (`LearningRepository.saveAttempts`); throws `LearningStoreError`
        public var save: ([LearningRecord]) async throws -> Void
        /// each attempt's latest state, as it changes
        public var publish: (LearningRecord) -> Void
        /// the board's own mistake classifier (`classifyMistake(previous, latex)`); nil: none
        public var classifyMistake: ((String, String) async -> String?)?

        public init(now: @escaping () -> Double, newId: @escaping () -> String, course: String?, classify: @escaping ([String]) -> String,
                    save: @escaping ([LearningRecord]) async throws -> Void, publish: @escaping (LearningRecord) -> Void,
                    classifyMistake: ((String, String) async -> String?)? = nil) {
            self.now = now
            self.newId = newId
            self.course = course
            self.classify = classify
            self.save = save
            self.publish = publish
            self.classifyMistake = classifyMistake
        }
    }

    /// TRACKER_LIMITS.
    public enum Limits {
        /// attempts kept in memory; past it, the oldest closed and saved ones are forgotten
        public static let attempts = 300
        /// problems whose help is kept before their attempt starts, and how much of it
        public static let orphanKeys = 50
        public static let orphanHelps = 10
        /// attempts of one board kept on the device between visits (`snapshot`), newest first
        public static let savedPerBoard = 25
        /// the most reads of one line whose mistakes are kept
        static let mistakeReads = 10
    }

    let deps: Deps
    private var byKey = OrderedMap<String, Attempt>()
    /// help about problems not known yet, by key
    private var orphans = OrderedMap<String, [(help: LearningHelp, at: Double)]>()
    /// the board's last event, of any attempt
    private var lastAt = -Double.infinity
    /// local classifications in flight, by line and read
    private var classifying: [String: Task<Void, Never>] = [:]
    /// the save in flight, which the next `flush` waits for
    private var saving: Task<Void, Never>?

    public init(deps: Deps) {
        self.deps = deps
    }

    // MARK: - the API

    /// One signal from the board. Never throws: a signal it cannot use is dropped.
    public func handle(_ signal: LearningSignal) {
        switch signal {
        case .problem(let s): onProblem(s)
        case .line(let s): onLine(s)
        case .mistake(let s): onMistake(s)
        case .help(let s): onHelp(s)
        case .tutorSolved(let s): onTutorSolved(s)
        case .screen(let at, let boardId, let pageId): onScreen(at: at, boardId: boardId, pageId: pageId)
        case .closed(let at, let boardId): onClosed(at: at, boardId: boardId)
        }
    }

    /// Closes the attempts with no event for `idleCloseMs` (the recorder calls it every minute).
    public func tick(_ now: Double? = nil) {
        let t = now ?? deps.now()
        for a in byKey.orderedValues where !a.closed && t - a.lastAt >= LearningLimits.idleCloseMs {
            close(a, at: t)
        }
    }

    /// The attempt id for a problem on the board, if it has one.
    public func attemptId(for problemKey: String) -> String? {
        byKey[problemKey]?.record.id
    }

    /// Every recorded attempt's latest state.
    public func records() -> [LearningRecord] {
        byKey.orderedValues.filter(\.recordable).map(\.record)
    }

    /// The recorded attempts not saved yet (changed, or being saved): what the device keeps.
    public func pending() -> [LearningRecord] {
        byKey.orderedValues.filter { $0.recordable && ($0.dirty || $0.saving) }.map(\.record)
    }

    /// This board's recorded attempts, as the device keeps them for its next visit: the newest `savedPerBoard`.
    public func snapshot(boardId: String) -> [SavedAttempt] {
        let mine = byKey.orderedValues.filter { $0.recordable && $0.record.boardId == boardId }
        return Self.stableSorted(mine) { $0.lastAt > $1.lastAt }
            .prefix(Limits.savedPerBoard)
            .map { a in
                SavedAttempt(key: a.key, record: a.record, pageId: a.pageId, lines: a.lines.pairs,
                             mistakes: a.mistakes.pairs.map { ($0.0, $0.1.pairs) }, help: a.help, active: a.active,
                             solvedByStudent: a.solvedByStudent, tutorFinished: a.tutorFinished, given: a.given)
            }
    }

    /// The attempts an earlier visit to this board left (`snapshot`), before its first signal: a line
    /// of one of their problems goes on with that attempt. They come back closed and saved; the time
    /// before this visit is never counted.
    public func restore(_ saved: [SavedAttempt]) {
        for s in saved where byKey[s.key] == nil {
            let a = Attempt(key: s.key, record: s.record, pageId: s.pageId, given: s.given)
            a.lines = OrderedMap(s.lines)
            a.mistakes = OrderedMap(s.mistakes.map { ($0.0, OrderedMap($0.1)) })
            a.help = s.help
            a.active = s.active
            a.lastAt = -.infinity
            a.closed = true
            a.solvedByStudent = s.solvedByStudent
            a.tutorFinished = s.tutorFinished
            a.recordable = true
            a.said = Said(a.record, mistakes: Self.mistakeCounts(a))
            byKey[s.key] = a
        }
        prune()
    }

    /// Saves what has changed now: one batch of every attempt changed since its last save, after any
    /// save in flight. Throws when the save fails (`LearningStoreError`); what failed is saved with
    /// the next batch.
    public func flush() async throws {
        let previous = saving
        let run = Task { @MainActor [weak self] () throws -> Void in
            await previous?.value
            try await self?.saveChanged()
        }
        saving = Task { _ = try? await run.value }
        try await run.value
    }

    /// Waits for the local classifications in flight (tests, and the recorder before it saves on the way out).
    public func settled() async {
        while let task = classifying.values.first {
            await task.value
        }
    }

    // MARK: - signals

    private func onProblem(_ s: LearningSignal.Problem) {
        if let known = byKey[s.problemKey] {
            // its first line came first (a problem's signal arrives once its ink is on the page)
            if known.given { return }
            known.given = true
            known.record.origin = s.origin
            known.record.parentId = s.parentId
            setProblem(known, s.problemLatex)
            commit(known, at: s.at)
            return
        }
        let a = start(s.problemKey, boardId: s.boardId, pageId: s.pageId, problemLatex: s.problemLatex, origin: s.origin,
                      parentId: s.parentId, at: s.at, given: true)
        lastAt = max(lastAt, s.at)
        adoptOrphans(a)
        commit(a, at: s.at)
    }

    private func onLine(_ s: LearningSignal.Line) {
        let known = byKey[s.problemKey]
        let started = known == nil
        let a = known ?? start(s.problemKey, boardId: s.boardId, pageId: s.pageId, problemLatex: s.problemLatex,
                               origin: ProblemKeyKind.origin(of: s.problemKey), parentId: nil, at: s.at, given: false)
        let prev = a.lines[s.lineId]
        // the same again: nothing happened (nor does it open a closed attempt)
        if let prev, prev.latex == s.latex, prev.kind == s.kind, prev.mark == s.mark, prev.solved == s.solved { return }
        a.closed = false
        a.pageId = s.pageId
        spend(a, at: s.at)
        // the student's own problem is its head line, as read now
        if !a.given && !s.problemLatex.isEmpty { setProblem(a, s.problemLatex) }
        let ringed = (prev?.ringed ?? false) || s.mark == .circle
        a.lines[s.lineId] = LineState(latex: s.latex, kind: s.kind, mark: s.mark, solved: s.solved, ringed: ringed,
                                      judged: (prev?.judged ?? false) || s.mark == .check || s.mark == .circle || s.solved)
        if s.solved && s.mark == .check { a.solvedByStudent = true }
        // under a ringed line, a ring usually means the student is correcting it: compared with the
        // wrong line, the fix would read as a mistake of its own
        if s.mark == .circle, let previous = s.previousLatex, !previous.isEmpty, !ringedLineReads(a, lineId: s.lineId, latex: previous) {
            classify(a, lineId: s.lineId, previous: previous, latex: s.latex)
        }
        if started { adoptOrphans(a) }
        commit(a, at: s.at)
    }

    private func onMistake(_ s: LearningSignal.Mistake) {
        guard let a = byKey[s.problemKey] else { return }
        let latex = a.lines[s.lineId]?.latex ?? ""
        if let prev = mistakeOf(a, lineId: s.lineId, latex: latex), prev.kind == s.kind || (prev.source == .model && s.source == .local) { return }
        setMistake(a, lineId: s.lineId, latex: latex, LineMistake(kind: s.kind, source: s.source))
        a.closed = false
        spend(a, at: s.at)
        commit(a, at: s.at)
    }

    private func onHelp(_ s: LearningSignal.Help) {
        guard let a = byKey[s.problemKey] else {
            orphan(s.problemKey, help: s.help, at: s.at)
            return
        }
        a.closed = false
        spend(a, at: s.at)
        a.help.add(s.help)
        commit(a, at: s.at)
    }

    private func onTutorSolved(_ s: LearningSignal.TutorSolved) {
        let a: Attempt
        if let known = byKey[s.problemKey] {
            a = known
            a.closed = false
            spend(a, at: s.at)
        } else {
            a = start(s.problemKey, boardId: s.boardId, pageId: s.pageId, problemLatex: s.problemLatex,
                      origin: s.origin ?? ProblemKeyKind.origin(of: s.problemKey), parentId: nil, at: s.at, given: true)
            lastAt = max(lastAt, s.at)
            adoptOrphans(a)
        }
        // only before the student got there: a problem they solved stays theirs
        if !a.solvedByStudent { a.tutorFinished = true }
        commit(a, at: s.at)
    }

    private func onScreen(at: Double, boardId: String, pageId: String) {
        lastAt = max(lastAt, at)
        for a in byKey.orderedValues where !a.closed && a.pageId != pageId && (a.record.boardId == boardId || a.record.boardId == nil) {
            close(a, at: at)
        }
    }

    private func onClosed(at: Double, boardId: String) {
        for a in byKey.orderedValues where !a.closed && (a.record.boardId == boardId || a.record.boardId == nil) {
            close(a, at: at)
        }
    }

    // MARK: - attempts

    private func start(_ key: String, boardId: String, pageId: String, problemLatex: [String], origin: LearningOrigin, parentId: String?,
                       at: Double, given: Bool) -> Attempt {
        let lines = Self.clean(problemLatex)
        let record = LearningRecord(id: deps.newId(), boardId: boardId, problemLatex: Self.joined(lines), skill: deps.classify(lines),
                                    course: deps.course, origin: origin, parentId: parentId, outcome: .inProgress,
                                    startedAt: LearningTime.iso(at), updatedAt: LearningTime.iso(at), finishedAt: nil)
        let a = Attempt(key: key, record: record, pageId: pageId, given: given)
        // a problem given starts its clock now; a line's attempt counts the time its first line took
        a.lastAt = given ? at : -.infinity
        byKey[key] = a
        prune()
        return a
    }

    private func setProblem(_ a: Attempt, _ problemLatex: [String]) {
        let lines = Self.clean(problemLatex)
        let joined = Self.joined(lines)
        if joined.isEmpty || joined == a.record.problemLatex { return }
        a.record.problemLatex = joined
        a.record.skill = deps.classify(lines)
    }

    /// The time since this attempt's last event (or the board's, when later) goes to it, capped.
    private func spend(_ a: Attempt, at: Double) {
        let from = max(a.lastAt, lastAt)
        if from.isFinite && at > from {
            a.active = min(LearningLimits.maxActiveMs, a.active + min(at - from, LearningLimits.maxGapMs))
        }
        a.lastAt = a.lastAt.isFinite ? max(a.lastAt, at) : at
        lastAt = max(lastAt, at)
    }

    private func close(_ a: Attempt, at: Double) {
        a.closed = true
        commit(a, at: at)
        // nothing in it worth a record: nothing to keep either
        if !a.recordable { forget(a) }
    }

    private func forget(_ a: Attempt) {
        if byKey[a.key] === a { byKey.remove(a.key) }
    }

    /// Past `Limits.attempts`: the oldest closed attempts with nothing left to save go.
    private func prune() {
        guard byKey.count > Limits.attempts else { return }
        let done = Self.stableSorted(byKey.orderedValues.filter { $0.closed && !$0.dirty && !$0.saving }) { $0.lastAt < $1.lastAt }
        for a in done {
            if byKey.count <= Limits.attempts { return }
            forget(a)
        }
    }

    private func counts(_ a: Attempt) -> AttemptCounts {
        var right = 0
        var ringed = 0
        for l in a.lines.orderedValues {
            if l.mark == .check { right += 1 }
            if l.ringed { ringed += 1 }
        }
        return AttemptCounts(linesWritten: Self.cap(Double(a.lines.count)), linesRight: Self.cap(Double(right)),
                             linesRinged: Self.cap(Double(ringed)), hints: Self.cap(Double(a.help.hint)),
                             tutorSteps: Self.cap(Double(a.help.nextStep)), solves: Self.cap(Double(a.help.solve)),
                             asks: Self.cap(Double(a.help.ask)))
    }

    /// Worth a record: the tutor judged a line of it, helped, or finished it — or a given problem has a line.
    private func isRecordable(_ a: Attempt, _ c: AttemptCounts) -> Bool {
        if a.recordable { return true }
        let helped = c.hints + c.tutorSteps + c.solves > 0
        let judged = a.lines.orderedValues.contains { $0.judged }
        a.recordable = a.tutorFinished || helped || judged || (a.given && c.linesWritten > 0)
        return a.recordable
    }

    /// Each kind once per line, however often the line was read with it, in the web's key order.
    static func mistakeCounts(_ a: Attempt) -> [(String, Int)] {
        var out = OrderedMap<String, Int>()
        for reads in a.mistakes.orderedValues {
            var seen = OrderedMap<String, Bool>()
            for m in reads.orderedValues { seen[m.kind] = true }
            for kind in seen.keys { out[kind] = cap(Double((out[kind] ?? 0) + 1)) }
        }
        return out.pairs
    }

    /// Its record from its state now; published (and to be saved) when it changed and is worth a record.
    private func commit(_ a: Attempt, at: Double) {
        let c = counts(a)
        let outcome = c.outcome(solvedByStudent: a.solvedByStudent, tutorFinished: a.tutorFinished, closed: a.closed)
        let mistakes = Self.mistakeCounts(a)
        // when it stopped being in progress — unfinished then answered, it was finished when answered;
        // a ring after the answer (first try → self-corrected) does not move when it was finished
        if outcome == .inProgress {
            a.record.finishedAt = nil
        } else if a.record.finishedAt == nil || (outcome != a.record.outcome && outcome.isAnswered != a.record.outcome.isAnswered) {
            a.record.finishedAt = LearningTime.iso(at)
        }
        a.record.setCounts(c)
        a.record.outcome = outcome
        a.record.mistakes = Dictionary(uniqueKeysWithValues: mistakes)
        a.record.activeMs = Self.jsRound(min(a.active, LearningLimits.maxActiveMs))
        let said = Said(a.record, mistakes: mistakes)
        let wasRecordable = a.recordable
        let recordable = isRecordable(a, c)
        if said == a.said && wasRecordable == recordable { return }
        a.said = said
        a.record.updatedAt = LearningTime.iso(max(at, LearningTime.parse(a.record.startedAt) ?? .nan))
        if !recordable { return }
        a.dirty = true
        deps.publish(a.record)
    }

    // MARK: - help before its problem

    private func orphan(_ key: String, help: LearningHelp, at: Double) {
        var list = orphans[key] ?? []
        orphans.remove(key)
        list.append((help, at))
        orphans[key] = Array(list.suffix(Limits.orphanHelps))
        while orphans.count > Limits.orphanKeys { orphans.removeFirst() }
    }

    private func adoptOrphans(_ a: Attempt) {
        guard let list = orphans[a.key] else { return }
        orphans.remove(a.key)
        let started = LearningTime.parse(a.record.startedAt) ?? .nan
        for o in list where started - o.at <= LearningLimits.maxGapMs { a.help.add(o.help) }
    }

    // MARK: - mistakes

    private func mistakeOf(_ a: Attempt, lineId: String, latex: String) -> LineMistake? {
        a.mistakes[lineId]?[latex]
    }

    private func setMistake(_ a: Attempt, lineId: String, latex: String, _ mistake: LineMistake) {
        var reads = a.mistakes[lineId] ?? OrderedMap()
        reads.remove(latex)
        reads[latex] = mistake
        while reads.count > Limits.mistakeReads { reads.removeFirst() }
        a.mistakes[lineId] = reads
    }

    /// Another line of this attempt reads `latex` and wears a ring now.
    private func ringedLineReads(_ a: Attempt, lineId: String, latex: String) -> Bool {
        a.lines.pairs.contains { $0.0 != lineId && $0.1.latex == latex && $0.1.mark == .circle }
    }

    /// A ringed line, compared with the line above it by the board's own classifier (async; a model
    /// mistake for the same read wins).
    private func classify(_ a: Attempt, lineId: String, previous: String, latex: String) {
        guard let classifier = deps.classifyMistake else { return }
        if mistakeOf(a, lineId: lineId, latex: latex) != nil { return }
        let job = "\(a.record.id)\n\(lineId)\n\(latex)"
        if classifying[job] != nil { return }
        classifying[job] = Task { @MainActor [weak self] in
            let kind = await classifier(previous, latex)
            guard let self else { return }
            defer { self.classifying[job] = nil }
            guard let kind, MistakeKinds.isKind(kind), self.byKey[a.key] === a else { return }
            // read again meanwhile, or the model named this read's mistake first
            if a.lines[lineId]?.latex != latex || self.mistakeOf(a, lineId: lineId, latex: latex) != nil { return }
            self.setMistake(a, lineId: lineId, latex: latex, LineMistake(kind: kind, source: .local))
            self.commit(a, at: self.deps.now())
        }
    }

    // MARK: - saving

    private func saveChanged() async throws {
        let batch = byKey.orderedValues.filter { $0.recordable && $0.dirty }
        if batch.isEmpty { return }
        let records = batch.map(\.record)
        for a in batch {
            a.dirty = false
            a.saving = true
        }
        defer {
            for a in batch { a.saving = false }
            prune()
        }
        do {
            try await deps.save(records)
        } catch {
            // saved with the next batch (a change meanwhile marked it again already) — unless the
            // store refused a record as invalid: it saved the rest, and that one would fail every time
            if LearningStoreErrorCode.of(error) != "invalid" { for a in batch { a.dirty = true } }
            throw error
        }
    }

    // MARK: - helpers

    /// `lines.map(trim).filter(Boolean)`.
    static func clean(_ lines: [String]) -> [String] {
        lines.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    /// `lines.join("; ").slice(0, 500)`: cut by UTF-16 code units, as JavaScript cuts.
    static func joined(_ lines: [String]) -> String {
        let s = lines.joined(separator: "; ")
        let units = Array(s.utf16)
        guard units.count > LearningLimits.problemLatex else { return s }
        return String(decoding: units.prefix(LearningLimits.problemLatex), as: UTF16.self)
    }

    /// `Math.max(0, Math.min(maxCount, Math.round(n)))`.
    static func cap(_ n: Double) -> Int {
        max(0, min(LearningLimits.maxCount, jsRound(n)))
    }

    /// `Math.round`: halves go up.
    static func jsRound(_ n: Double) -> Int {
        guard n.isFinite else { return 0 }
        return Int((n + 0.5).rounded(.down))
    }

    /// A stable sort (JavaScript's `Array.sort` is): equal elements keep their order.
    static func stableSorted<T>(_ xs: [T], by before: (T, T) -> Bool) -> [T] {
        xs.enumerated().sorted { l, r in
            if before(l.element, r.element) { return true }
            if before(r.element, l.element) { return false }
            return l.offset < r.offset
        }.map(\.element)
    }
}

/// A store failure's code (`storeErrorCode`): `LearningStoreError.code`, else `unknown`.
enum LearningStoreErrorCode {
    static func of(_ error: Error) -> String {
        if let e = error as? LearningStoreErrorConvertible { return e.learningStoreCode }
        return "unknown"
    }
}

/// An error that says what kind of store failure it is (`LearningStoreError` in AgathonKit is one).
public protocol LearningStoreErrorConvertible: Error {
    /// unavailable, unauthorized, invalid, network or unknown
    var learningStoreCode: String { get }
}

/// One line of an attempt, as the tracker knows it.
public struct LineState: Codable, Equatable, Sendable {
    public var latex: String
    public var kind: String
    public var mark: LineMark?
    public var solved: Bool
    /// ever ringed
    public var ringed: Bool
    /// ever ticked, ringed or the answer: the tutor judged it
    public var judged: Bool

    enum CodingKeys: String, CodingKey { case latex, kind, mark, solved, ringed, judged }

    public init(latex: String, kind: String, mark: LineMark?, solved: Bool, ringed: Bool, judged: Bool) {
        self.latex = latex
        self.kind = kind
        self.mark = mark
        self.solved = solved
        self.ringed = ringed
        self.judged = judged
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(latex, forKey: .latex)
        try c.encode(kind, forKey: .kind)
        try c.encode(mark, forKey: .mark)
        try c.encode(solved, forKey: .solved)
        try c.encode(ringed, forKey: .ringed)
        try c.encode(judged, forKey: .judged)
    }
}

/// A mistake named for one read of a line.
public struct LineMistake: Codable, Equatable, Sendable {
    public var kind: String
    public var source: LearningSignal.Mistake.Source
}

/// The help an attempt had, by kind (`Record<HelpKind, number>`).
public struct HelpCounts: Codable, Equatable, Sendable {
    public var hint = 0
    public var nextStep = 0
    public var solve = 0
    public var ask = 0

    enum CodingKeys: String, CodingKey {
        case hint, solve, ask
        case nextStep = "next_step"
    }

    public init() {}

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func n(_ k: CodingKeys) -> Int { (try? c.decodeIfPresent(Double.self, forKey: k)).flatMap { $0 }.map { Int($0) } ?? 0 }
        hint = n(.hint)
        nextStep = n(.nextStep)
        solve = n(.solve)
        ask = n(.ask)
    }

    mutating func add(_ help: LearningHelp) {
        switch help {
        case .hint: hint += 1
        case .nextStep: nextStep += 1
        case .solve: solve += 1
        case .ask: ask += 1
        }
    }
}

/// One attempt as the device keeps it between visits to its board (`SavedAttempt`), in the web's
/// JSON shape (maps as arrays of pairs).
public struct SavedAttempt: Codable, Equatable, Sendable {
    public var key: String
    public var record: LearningRecord
    public var pageId: String
    public var lines: [(String, LineState)]
    public var mistakes: [(String, [(String, LineMistake)])]
    public var help: HelpCounts
    public var active: Double
    public var solvedByStudent: Bool
    public var tutorFinished: Bool
    public var given: Bool

    public init(key: String, record: LearningRecord, pageId: String, lines: [(String, LineState)], mistakes: [(String, [(String, LineMistake)])],
                help: HelpCounts, active: Double, solvedByStudent: Bool, tutorFinished: Bool, given: Bool) {
        self.key = key
        self.record = record
        self.pageId = pageId
        self.lines = lines
        self.mistakes = mistakes
        self.help = help
        self.active = active
        self.solvedByStudent = solvedByStudent
        self.tutorFinished = tutorFinished
        self.given = given
    }

    enum CodingKeys: String, CodingKey { case key, record, pageId, lines, mistakes, help, active, solvedByStudent, tutorFinished, given }

    private struct Pair<V: Codable>: Codable {
        var key: String
        var value: V
        init(_ key: String, _ value: V) {
            self.key = key
            self.value = value
        }
        init(from decoder: Decoder) throws {
            var c = try decoder.unkeyedContainer()
            key = try c.decode(String.self)
            value = try c.decode(V.self)
        }
        func encode(to encoder: Encoder) throws {
            var c = encoder.unkeyedContainer()
            try c.encode(key)
            try c.encode(value)
        }
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = try c.decode(String.self, forKey: .key)
        record = try c.decode(LearningRecord.self, forKey: .record)
        pageId = try c.decode(String.self, forKey: .pageId)
        lines = try c.decode([Pair<LineState>].self, forKey: .lines).map { ($0.key, $0.value) }
        mistakes = try c.decode([Pair<[Pair<LineMistake>]>].self, forKey: .mistakes).map { ($0.key, $0.value.map { ($0.key, $0.value) }) }
        help = (try? c.decodeIfPresent(HelpCounts.self, forKey: .help)).flatMap { $0 } ?? HelpCounts()
        active = (try? c.decodeIfPresent(Double.self, forKey: .active)).flatMap { $0 } ?? 0
        solvedByStudent = (try? c.decodeIfPresent(Bool.self, forKey: .solvedByStudent)).flatMap { $0 } ?? false
        tutorFinished = (try? c.decodeIfPresent(Bool.self, forKey: .tutorFinished)).flatMap { $0 } ?? false
        given = (try? c.decodeIfPresent(Bool.self, forKey: .given)).flatMap { $0 } ?? false
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(key, forKey: .key)
        try c.encode(record, forKey: .record)
        try c.encode(pageId, forKey: .pageId)
        try c.encode(lines.map { Pair($0.0, $0.1) }, forKey: .lines)
        try c.encode(mistakes.map { Pair($0.0, $0.1.map { Pair($0.0, $0.1) }) }, forKey: .mistakes)
        try c.encode(help, forKey: .help)
        try c.encode(active, forKey: .active)
        try c.encode(solvedByStudent, forKey: .solvedByStudent)
        try c.encode(tutorFinished, forKey: .tutorFinished)
        try c.encode(given, forKey: .given)
    }

    public static func == (a: SavedAttempt, b: SavedAttempt) -> Bool {
        a.key == b.key && a.record == b.record && a.pageId == b.pageId
            && a.lines.map(\.0) == b.lines.map(\.0) && a.lines.map(\.1) == b.lines.map(\.1)
            && a.mistakes.map(\.0) == b.mistakes.map(\.0)
            && a.mistakes.map { $0.1.map(\.0) } == b.mistakes.map { $0.1.map(\.0) }
            && a.mistakes.map { $0.1.map(\.1) } == b.mistakes.map { $0.1.map(\.1) }
            && a.help == b.help && a.active == b.active && a.solvedByStudent == b.solvedByStudent
            && a.tutorFinished == b.tutorFinished && a.given == b.given
    }
}

/// An attempt as the tracker holds it (a reference: a classification in flight checks it is still
/// the one the tracker knows by its key).
final class Attempt {
    let key: String
    var record: LearningRecord
    var pageId: String
    var lines = OrderedMap<String, LineState>()
    /// each line's mistakes, by the read they were about
    var mistakes = OrderedMap<String, OrderedMap<String, LineMistake>>()
    var help = HelpCounts()
    var active = 0.0
    /// its last event's time; -∞ before its first (an attempt started by a line)
    var lastAt = -Double.infinity
    var closed = false
    var solvedByStudent = false
    var tutorFinished = false
    /// the problem was given (`problem`, `tutorSolved`), not taken from a line of it
    var given: Bool
    var recordable = false
    /// changed since it was last saved
    var dirty = false
    /// being saved now
    var saving = false
    /// what it said last (`commit`), updatedAt aside
    var said: Said?

    init(key: String, record: LearningRecord, pageId: String, given: Bool) {
        self.key = key
        self.record = record
        self.pageId = pageId
        self.given = given
    }
}

/// A record's content, updatedAt aside, with its mistakes in order: the web compares
/// `JSON.stringify({ ...record, updatedAt: "" })`.
struct Said: Equatable {
    var record: LearningRecord
    var mistakeKinds: [String]
    var mistakeCounts: [Int]

    init(_ r: LearningRecord, mistakes: [(String, Int)]) {
        var copy = r
        copy.updatedAt = ""
        record = copy
        mistakeKinds = mistakes.map(\.0)
        mistakeCounts = mistakes.map(\.1)
    }
}
