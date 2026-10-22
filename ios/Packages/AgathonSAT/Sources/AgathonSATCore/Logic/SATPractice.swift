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
///  - **The tutor:** opening a question asks for its pass (`POST /api/sat/tutor`, idempotent per
///    question and day); the answer is kept per question.
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
        /// not asked yet
        case unknown
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
        public var tutor: Tutor = .unknown
        /// the tutor read or helped while this question was on show (the app tells the session)
        public var usedTutor = false
        /// its set (0-based) and its place in it (1-based) of how many
        public var set = 0
        public var number = 1
        public var count = 1
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
        send(SATAttempt(questionId: q.id, chosen: chosen, correct: correct, seconds: Int(seconds(at: i).rounded()), usedTutor: items[i].usedTutor))
        return result
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
                try await service.record(first)
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

    /// Asks for the tutor's pass for question `i` (the server's answer is kept; asked again only when
    /// it was not on, or couldn't be asked).
    @discardableResult
    public func openTutor(at i: Int) async -> Tutor {
        guard questions.indices.contains(i) else { return .unknown }
        if case .on = items[i].tutor { return items[i].tutor }
        if case .asking = items[i].tutor { return .asking }
        items[i].tutor = .asking
        let id = questions[i].id
        do {
            let pass = try await service.tutorPass(questionId: id)
            lastPass = pass
            guard items.indices.contains(i), questions[i].id == id else { return .unknown }
            items[i].tutor = pass.allowed ? .on(pass) : .capped(pass)
        } catch {
            guard items.indices.contains(i) else { return .unknown }
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

    /// Forgets a question's answer from the server, so the next `openTutor` asks again.
    public func resetTutor(at i: Int) {
        guard items.indices.contains(i) else { return }
        items[i].tutor = .unknown
    }

    // MARK: - the end of a set

    /// The set's results (the set on show).
    public func summary(of set: Int? = nil) -> Summary {
        let range = set.flatMap { sets.indices.contains($0) ? sets[$0] : nil } ?? currentSet
        var rows: [Summary.Row] = []
        var first = 0, second = 0
        var review: [Int] = []
        for i in range {
            let q = questions[i], it = items[i]
            rows.append(.init(index: i, number: it.number, skill: q.skill, domain: q.domain, verdict: it.verdict, marked: it.marked))
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
