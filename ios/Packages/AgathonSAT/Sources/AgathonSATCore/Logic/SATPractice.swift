import Foundation
import Observation

/// One SAT practice session (docs/SAT-MODE.md, "The session"): its sets of questions, where the
/// student is, what they chose or typed, Check, the solution, the free tutor's pass for each
/// question, and the end of a set. The screens show it; the board beside it follows `index`.
///
///  - **Check:** right is green and offers the solution; wrong is "Look again" (never red) and one
///    more try; a second wrong locks the question and offers the solution. Every check is an
///    attempt (`POST /api/sat/attempts`: chosen, correct, seconds on the question, used the tutor),
///    sent in the background; one that fails is kept and sent with the next.
///  - **Choices:** tap to choose; strike a choice out (Bluebook's eliminator). Choosing a struck
///    choice brings it back; striking the chosen one unchooses it.
///  - **Grid-in:** typed through the keypad's rules (`SATGridIn`).
///  - **The tutor:** a question's free tutor pass is claimed on the student's FIRST INK on its page
///    (the owner, 2026-10-22: "we just want ppl to use it!"), never by opening, browsing, choosing or
///    checking. `claimTutorPass(for:)` is the one place that asks (`POST /api/sat/tutor`, idempotent per
///    question and day); the app calls it from one trigger (`SATSessionModel.firstInk`).
///  - **Sets:** "Practice 10 more" adds a set to the same session (one board, a page a question).
@MainActor
@Observable
public final class SATPractice {
    /// How a question went.
    public enum Verdict: Hashable, Sendable {
        /// not checked yet
        case open
        /// checked once, not right: one more try
        case lookAgain
        /// right; on the first try or after "Look again"
        case right(firstTry: Bool)
        /// not right twice: the answer and the solution are shown
        case missed

        /// Checked for good: no more changes.
        public var isLocked: Bool {
            switch self {
            case .right, .missed: true
            case .open, .lookAgain: false
            }
        }
    }

    /// The live tutor on a question's page.
    public enum Tutor: Hashable, Sendable {
        /// ready, not claimed: the first ink on the page claims the pass
        case ready
        /// asking the server for the pass
        case asking
        /// on for this question (a free pass, or Unlimited)
        case on(SATTutorPass)
        /// the day's free tutor is used up: the board is plain ink here
        case capped(SATTutorPass)
        /// the server couldn't be asked (offline): off, with Try again
        case unavailable

        public var isOn: Bool {
            if case .on = self { return true }
            return false
        }
    }

    /// What one Check did.
    public enum CheckResult: Hashable, Sendable {
        case right
        case lookAgain
        case missed
        /// nothing chosen, or the grid-in is not an answer yet (why)
        case notReady(SATGridIn.Problem?)
        /// the question is checked for good
        case locked
    }

    /// One question's state in the session.
    public struct Item: Hashable, Sendable {
        /// the choice picked (mcq)
        public var chosen: String?
        /// choices struck out (mcq)
        public var eliminated: Set<String> = []
        /// the grid-in as typed (spr)
        public var typed = ""
        /// why the last key or Check did nothing (spr), for the line under the field
        public var hint: SATGridIn.Problem?
        /// every answer checked, in order
        public var tries: [String] = []
        public var verdict: Verdict = .open
        public var solutionOpen = false
        /// "Mark for review"
        public var marked = false
        /// seconds on the question before it was last shown
        public var seconds: Double = 0
        public var tutor: Tutor = .ready
        /// the tutor read or helped while this question was on show (the app tells the session)
        public var usedTutor = false
        /// its set (0-based) and its place in it (1-based) of how many
        public var set = 0
        public var number = 1
        public var count = 1
        /// Help me's ink hint ladder on the page (v2)
        public var ladder = SATHintLadder()
        /// the wrong-answer note after the last wrong check (v2): the choice's `why`, or the grid-in's
        /// common wrong answer; nil when the bank has none (v1's "Look again" alone)
        public var wrongNote: WrongNote?
    }

    /// "You picked B. That's what you get if you …" (docs/SAT-V2.md, "Wrong-answer diagnosis").
    public struct WrongNote: Hashable, Sendable {
        /// "B", or the grid-in as typed
        public var answer: String
        public var why: String
        /// a choice (mcq) or a grid-in
        public var isChoice: Bool
    }

    /// A finished set: what the summary shows.
    public struct Summary: Hashable, Sendable {
        public struct Row: Hashable, Sendable, Identifiable {
            /// the question's index in the session
            public var index: Int
            public var number: Int
            public var skill: String
            public var domain: SATDomain
            public var verdict: Verdict
            public var marked: Bool
            /// the mistake deck brought it back (v2)
            public var review: Bool = false
            /// a wrong answer was sent: the deck brings it back this many days on (v2: 1)
            public var backInDays: Int?
            /// seconds on the question, and whether Help me was used on it (v2's summary)
            public var seconds: Int = 0
            public var helped: Bool = false
            /// the question's stem (the deck's front card)
            public var stem: String = ""

            public var id: Int { index }
        }

        public var rows: [Row]
        /// right on the first try: the score, as a test would count it
        public var rightFirstTry: Int
        /// right after "Look again"
        public var rightSecondTry: Int
        public var count: Int
        /// the questions not right on the first try or not answered (session indices)
        public var toReview: [Int]

        /// The set's time, in whole minutes (at least 1 once anything was done).
        public var minutes: Int {
            let s = rows.map(\.seconds).reduce(0, +)
            return s == 0 ? 0 : max(1, Int((Double(s) / 60).rounded()))
        }

        /// Questions Help me was used on.
        public var helped: Int { rows.filter(\.helped).count }

        /// What goes into the mistake deck (a wrong answer sent).
        public var intoDeck: [Row] { rows.filter { $0.backInDays != nil } }

        /// The set's one skill, when it is a skill's set (else nil: mixed practice).
        public var oneSkill: String? {
            let skills = Set(rows.map(\.skill))
            return skills.count == 1 && rows.count > 1 ? skills.first : nil
        }
    }

    public let service: SATService
    public let sessionId: String
    public private(set) var questions: [SATQuestion] = []
    public private(set) var items: [Item] = []
    /// the session's sets, as index ranges
    public private(set) var sets: [Range<Int>] = []
    /// the question on show
    public private(set) var index = 0
    /// reviewing a finished set's missed questions: the indices stepped through (nil: practising)
    public private(set) var reviewing: [Int]?
    /// the newest tutor pass (how many free tutor questions are left today)
    public private(set) var lastPass: SATTutorPass?
    /// today as /api/sat/progress last said (free tutor questions used, the cap, Unlimited)
    public var today: SATProgress.Today?
    /// attempts not yet sent
    public private(set) var unsent: [SATAttempt] = []

    let now: @Sendable () -> Date
    private var shownSince: Date?
    private var sending: Task<Void, Never>?

    public init(service: SATService, sessionId: String = UUID().uuidString.lowercased(), now: @escaping @Sendable () -> Date = { Date() }) {
        self.service = service
        self.sessionId = sessionId
        self.now = now
    }

    // MARK: - sets

    /// Adds a set (the first, or "Practice 10 more") and shows its first question. Returns its range.
    @discardableResult
    public func addSet(_ set: [SATQuestion]) -> Range<Int> {
        let start = questions.count
        let s = sets.count
        for (i, q) in set.enumerated() {
            questions.append(q)
            items.append(Item(set: s, number: i + 1, count: set.count))
        }
        let range = start..<questions.count
        sets.append(range)
        reviewing = nil
        if !range.isEmpty { show(start) }
        return range
    }

    /// The set the question on show belongs to.
    public var currentSet: Range<Int> {
        sets.first { $0.contains(index) } ?? 0..<0
    }

    public var current: SATQuestion? { questions.indices.contains(index) ? questions[index] : nil }

    public var item: Item { items.indices.contains(index) ? items[index] : Item() }

    /// The set's id on the board's pages (`sat:<session>:<set>`).
    public func setId(_ set: Int) -> String { "sat:\(sessionId):\(set + 1)" }

    // MARK: - moving

    /// Shows question `i` (time on the one left is kept).
    public func show(_ i: Int) {
        guard questions.indices.contains(i) else { return }
        stopClock()
        index = i
        shownSince = now()
    }

    /// The next question: in the set, or the next one under review.
    public func next() {
        if let list = reviewing {
            if let k = list.firstIndex(of: index), k + 1 < list.count { show(list[k + 1]) }
            return
        }
        if index + 1 < currentSet.upperBound { show(index + 1) }
    }

    public func previous() {
        if let list = reviewing {
            if let k = list.firstIndex(of: index), k > 0 { show(list[k - 1]) }
            return
        }
        if index > currentSet.lowerBound { show(index - 1) }
    }

    public var hasNext: Bool {
        if let list = reviewing { return list.last != index }
        return index + 1 < currentSet.upperBound
    }

    public var hasPrevious: Bool {
        if let list = reviewing { return list.first != index }
        return index > currentSet.lowerBound
    }

    /// The last question of the set (Check there leads to the results).
    public var isLastInSet: Bool { index + 1 == currentSet.upperBound }

    /// Every question of the set is checked for good.
    public var setDone: Bool { currentSet.allSatisfy { items[$0].verdict.isLocked } }

    /// The time on a question so far.
    public func seconds(at i: Int) -> Double {
        guard items.indices.contains(i) else { return 0 }
        var s = items[i].seconds
        if i == index, let since = shownSince { s += max(0, now().timeIntervalSince(since)) }
        return s
    }

    /// The question's clock stops (the screen goes, the app leaves the foreground).
    public func stopClock() {
        if items.indices.contains(index), let since = shownSince {
            items[index].seconds += max(0, now().timeIntervalSince(since))
        }
        shownSince = nil
    }

    /// The question's clock runs again.
    public func startClock() {
        if shownSince == nil { shownSince = now() }
    }

    // MARK: - answering

    /// Taps a choice: it is chosen (a struck choice comes back).
    public func choose(_ key: String) {
        guard !item.verdict.isLocked, current?.format == .mcq else { return }
        items[index].eliminated.remove(key)
        items[index].chosen = key
        items[index].wrongNote = nil
    }

    /// Strikes a choice out, or brings it back (Bluebook's eliminator).
    public func toggleEliminated(_ key: String) {
        guard !item.verdict.isLocked, current?.format == .mcq else { return }
        if items[index].eliminated.contains(key) {
            items[index].eliminated.remove(key)
        } else {
            items[index].eliminated.insert(key)
            if items[index].chosen == key { items[index].chosen = nil }
        }
    }

    /// A key on the grid-in's keypad.
    public func press(_ key: SATGridIn.Key) {
        guard !item.verdict.isLocked, current?.format == .spr else { return }
        let r = SATGridIn.press(key, on: items[index].typed)
        if r.text != items[index].typed { items[index].wrongNote = nil }
        items[index].typed = r.text
        items[index].hint = r.refused
    }

    /// Text typed on a keyboard into the grid-in.
    public func type(_ text: String) {
        guard !item.verdict.isLocked, current?.format == .spr else { return }
        let r = SATGridIn.type(text, on: items[index].typed)
        items[index].typed = r.text
        items[index].hint = r.refused
    }

    public func toggleMarked() {
        guard items.indices.contains(index) else { return }
        items[index].marked.toggle()
    }

    /// The answer as it would be checked now ("B", or the grid-in), nil when there is none.
    public var answerNow: String? {
        guard let q = current else { return nil }
        switch q.format {
        case .mcq: return item.chosen
        case .spr: return item.typed.isEmpty ? nil : item.typed
        }
    }

    /// The answer on show is one already checked and not right ("Look again" until it changes).
    public var answerAlreadyTried: Bool {
        guard let a = answerNow else { return false }
        return item.tries.contains(a)
    }

    /// Check: right, look again, or missed after the second try. Each check is an attempt.
    @discardableResult
    public func check() -> CheckResult {
        guard let q = current else { return .notReady(nil) }
        let i = index
        if items[i].verdict.isLocked { return .locked }
        let chosen: String
        let correct: Bool
        switch q.format {
        case .mcq:
            guard let c = items[i].chosen else { return .notReady(nil) }
            chosen = c
            correct = c == q.answer.key
        case .spr:
            if let p = SATGridIn.problem(items[i].typed) {
                items[i].hint = p
                return .notReady(p)
            }
            chosen = items[i].typed
            correct = SATGridIn.isCorrect(chosen, accepted: q.answer.accepted ?? [])
        }
        // the same wrong answer again is no second try
        if !correct && items[i].tries.contains(chosen) { return .lookAgain }
        items[i].hint = nil
        items[i].tries.append(chosen)
        let result: CheckResult
        if correct {
            items[i].verdict = .right(firstTry: items[i].tries.count == 1)
            result = .right
        } else if items[i].tries.count >= 2 {
            items[i].verdict = .missed
            result = .missed
        } else {
            items[i].verdict = .lookAgain
            result = .lookAgain
        }
        items[i].wrongNote = correct ? nil : Self.wrongNote(q, chosen)
        send(SATAttempt(questionId: q.id, chosen: chosen, correct: correct, seconds: Int(seconds(at: i).rounded()), usedTutor: items[i].usedTutor))
        return result
    }

    /// The note for a wrong answer, when the bank has one.
    static func wrongNote(_ q: SATQuestion, _ chosen: String) -> WrongNote? {
        switch q.format {
        case .mcq: return q.why(chosen).map { WrongNote(answer: chosen, why: $0, isChoice: true) }
        case .spr: return q.commonWrongNote(for: chosen).map { WrongNote(answer: chosen, why: $0.why, isChoice: false) }
        }
    }

    /// "Try again" on the wrong-answer note: the note goes and the answer is cleared for a fresh one
    /// (the wrong one stays marked as tried).
    public func tryAgain() {
        guard items.indices.contains(index), !items[index].verdict.isLocked else { return }
        items[index].wrongNote = nil
        items[index].chosen = nil
        items[index].typed = ""
        items[index].hint = nil
    }

    /// The note closes (the student chose something else, or moved on).
    public func dismissWrongNote() {
        guard items.indices.contains(index) else { return }
        items[index].wrongNote = nil
    }

    /// Help me's ladder on question `i` changes (the app climbs it: `SATSessionModel`).
    public func updateLadder(at i: Int, _ change: (inout SATHintLadder) -> Void) {
        guard items.indices.contains(i) else { return }
        change(&items[i].ladder)
    }

    /// Shows (or hides) the solution: once the question is checked for good, or given up on.
    public func setSolutionOpen(_ open: Bool) {
        guard items.indices.contains(index) else { return }
        items[index].solutionOpen = open
    }

    /// The tutor read or helped on this question's page.
    public func noteTutorUsed(at i: Int) {
        guard items.indices.contains(i), items[i].tutor.isOn else { return }
        items[i].usedTutor = true
    }

    // MARK: - attempts

    private func send(_ attempt: SATAttempt) {
        unsent.append(attempt)
        flushSoon()
    }

    /// Sends what is waiting, in order; what fails waits for the next try.
    public func flushSoon() {
        guard sending == nil, !unsent.isEmpty else { return }
        sending = Task { @MainActor [weak self] in
            await self?.flush()
            self?.sending = nil
            // another arrived meanwhile
            if self?.unsent.isEmpty == false, self?.lastFlushFailed == false { self?.flushSoon() }
        }
    }

    private var lastFlushFailed = false

    /// Sends every waiting attempt now (in order; stops at the first that fails).
    public func flush() async {
        lastFlushFailed = false
        while let first = unsent.first {
            do {
                _ = try await service.record(first)
                if unsent.first == first { unsent.removeFirst() }
            } catch {
                lastFlushFailed = true
                return
            }
        }
    }

    /// Waits for the background send to finish (tests).
    public func settle() async {
        await sending?.value
    }

    // MARK: - the free tutor

    /// Whether ink on question `i`'s page should claim its pass now: not yet claimed, or the last ask
    /// couldn't reach the server. A capped question stays off (the cap line says why).
    public func needsTutorClaim(_ i: Int) -> Bool {
        guard items.indices.contains(i) else { return false }
        switch items[i].tutor {
        case .ready, .unavailable: return true
        case .asking, .on, .capped: return false
        }
    }

    /// Claims the free tutor's pass for question `i`: THE one place SAT practice asks
    /// `POST /api/sat/tutor` (the app calls it on the first ink on the question's page). The server's
    /// answer is kept per question; a pass already held is not asked for again.
    @discardableResult
    public func claimTutorPass(for i: Int) async -> Tutor {
        guard questions.indices.contains(i) else { return .ready }
        if case .on = items[i].tutor { return items[i].tutor }
        if case .asking = items[i].tutor { return .asking }
        items[i].tutor = .asking
        let id = questions[i].id
        do {
            let pass = try await service.tutorPass(questionId: id)
            lastPass = pass
            guard items.indices.contains(i), questions[i].id == id else { return .ready }
            items[i].tutor = pass.allowed ? .on(pass) : .capped(pass)
        } catch {
            guard items.indices.contains(i) else { return .ready }
            items[i].tutor = .unavailable
        }
        return items[i].tutor
    }

    /// The tutor was refused on question `i` after all (the server's "out of ink" on a live call):
    /// off here, until it is asked again.
    public func tutorRefused(at i: Int) {
        guard items.indices.contains(i) else { return }
        let pass = lastPass.map { SATTutorPass(allowed: false, usedToday: max($0.usedToday, $0.cap), cap: $0.cap, unlimited: false) }
            ?? SATTutorPass(allowed: false, usedToday: SATLimits.freeTutorPerDay, cap: SATLimits.freeTutorPerDay, unlimited: false)
        items[i].tutor = .capped(pass)
    }

    /// Forgets a question's answer from the server, so the next ink claims again (after Unlimited).
    public func resetTutor(at i: Int) {
        guard items.indices.contains(i) else { return }
        items[i].tutor = .ready
    }

    /// Free tutor questions left today (nil with Unlimited, or before anything is known): the newest
    /// pass's count, else /progress's.
    public var tutorLeft: Int? {
        if let p = lastPass { return p.left }
        return today?.tutorLeft
    }

    /// The day's free tutor questions (5).
    public var tutorCap: Int { lastPass?.cap ?? today?.cap ?? SATLimits.freeTutorPerDay }

    /// Unlimited: the tutor is never capped.
    public var unlimited: Bool { lastPass?.unlimited ?? today?.unlimited ?? false }

    // MARK: - the end of a set

    /// The set's results (the set on show).
    public func summary(of set: Int? = nil) -> Summary {
        let range = set.flatMap { sets.indices.contains($0) ? sets[$0] : nil } ?? currentSet
        var rows: [Summary.Row] = []
        var first = 0, second = 0
        var review: [Int] = []
        for i in range {
            let q = questions[i], it = items[i]
            // a wrong answer sent schedules the question again, a day on (the server's deck, docs/SAT-V2.md)
            let missedOnce = it.tries.contains { !Self.isRight(q, $0) }
            rows.append(.init(index: i, number: it.number, skill: q.skill, domain: q.domain, verdict: it.verdict, marked: it.marked,
                              review: q.review, backInDays: missedOnce ? 1 : nil, seconds: Int(seconds(at: i).rounded()),
                              helped: it.ladder.reached != nil, stem: q.stem))
            switch it.verdict {
            case .right(true): first += 1
            case .right(false):
                second += 1
                review.append(i)
            default: review.append(i)
            }
        }
        return Summary(rows: rows, rightFirstTry: first, rightSecondTry: second, count: range.count, toReview: review)
    }

    static func isRight(_ q: SATQuestion, _ answer: String) -> Bool {
        switch q.format {
        case .mcq: return answer == q.answer.key
        case .spr: return SATGridIn.isCorrect(answer, accepted: q.answer.accepted ?? [])
        }
    }

    /// Steps through the set's questions that weren't right on the first try, from the first.
    public func reviewMissed() {
        let list = summary().toReview
        guard let first = list.first else { return }
        reviewing = list
        show(first)
    }

    /// Back to practising (out of review).
    public func endReview() {
        reviewing = nil
    }

    /// The question's page header: "Q3 · Linear functions".
    public func pageHeading(_ i: Int) -> String {
        guard questions.indices.contains(i) else { return "" }
        return "Q\(items[i].number) · \(questions[i].skillTitle)"
    }
}
