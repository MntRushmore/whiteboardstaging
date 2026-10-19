import Foundation

// The learning record on the iPad: the web's contract (src/lib/learning/contracts.ts) in Swift.
//
//   LiveLoop ──LearningSignal──► LiveLearning ──► AttemptTracker ──LearningRecord──► onAttempt (Now you try, Today's practice)
//                                                       │
//                                                       └──changed──► SaveScheduler ──► learning_attempts (LearningRepository)
//
// The values here are the web's, letter for letter: a row written from the iPad is one the web
// wrote, and the Progress page, Today's practice, the skill path, weak-spot practice and the weekly
// report read both the same way.

/// LEARNING_LIMITS (contracts.ts).
public enum LearningLimits {
    public static let problemLatex = 500
    /// a gap between two events of one attempt longer than this counts as this much (a break)
    public static let maxGapMs = 120_000.0
    /// an attempt with no event for this long is closed (`unfinished` unless it has an outcome)
    public static let idleCloseMs = 30 * 60_000.0
    /// an attempt's active time never exceeds this (the database's check too)
    public static let maxActiveMs = 4 * 60 * 60_000.0
    /// each count column's ceiling (smallint)
    public static let maxCount = 32_767
}

/// Where a problem came from (ATTEMPT_ORIGINS).
public enum LearningOrigin: String, Codable, Sendable, CaseIterable {
    /// the student wrote the problem themselves
    case student
    /// the board chat wrote it (write_problems)
    case tutorProblem = "tutor_problem"
    /// the onboarding tour's starter
    case starter
    /// "Now you try" after the tutor solved or helped with a problem (`parentId` is that attempt)
    case nowYouTry = "now_you_try"
    /// a practice board (Today's practice, a topic, weak spots)
    case practice
    /// the chat taught it: the tutor wrote the whole worked solution
    case teach
}

/// How a problem went (OUTCOMES).
public enum LearningOutcome: String, Codable, Sendable, CaseIterable {
    case inProgress = "in_progress"
    case firstTry = "first_try"
    case selfCorrected = "self_corrected"
    case withHelp = "with_help"
    case tutorSolved = "tutor_solved"
    case unfinished

    /// An outcome that says the problem was answered — by the student or by the tutor.
    var isAnswered: Bool { self != .inProgress && self != .unfinished }
    /// The student solved it themselves (INDEPENDENT_OUTCOMES).
    public var isIndependent: Bool { self == .firstTry || self == .selfCorrected }
}

/// The tutor's mark on a student line (`LineMark`; nil: none).
public enum LineMark: String, Codable, Sendable {
    case check, circle, question
}

/// The tutor's help, as the record counts it.
public enum LearningHelp: String, Codable, Sendable {
    case hint
    case nextStep = "next_step"
    case solve
    case ask
}

/// MISTAKE_KINDS (src/lib/learning/hint.ts), in the web's order.
public enum MistakeKinds {
    public static let all = ["sign", "arithmetic", "distribution", "both_sides", "combining_terms", "inverse_operation",
                             "fractions", "exponents", "algebra", "units", "concept"]
    public static func isKind(_ s: String) -> Bool { all.contains(s) }
}

/// What the tracker counts for one attempt (`AttemptCounts`); `outcome(of:)` turns it into an outcome.
public struct AttemptCounts: Equatable, Sendable {
    public var linesWritten = 0
    public var linesRight = 0
    public var linesRinged = 0
    public var hints = 0
    public var tutorSteps = 0
    public var solves = 0
    public var asks = 0

    /// `outcomeOf` (contracts.ts): the one rule every module shares.
    public func outcome(solvedByStudent: Bool, tutorFinished: Bool, closed: Bool) -> LearningOutcome {
        if solvedByStudent && !tutorFinished {
            if hints > 0 || tutorSteps > 0 || solves > 0 { return .withHelp }
            return linesRinged > 0 ? .selfCorrected : .firstTry
        }
        if tutorFinished { return .tutorSolved }
        return closed ? .unfinished : .inProgress
    }
}

/// One problem one student worked, as the board records it (`AttemptRecord`): one row of
/// `learning_attempts`, upserted by `id` as the attempt goes on. Coded in the web's camelCase shape
/// (what the device keeps, and what the brain's `progressSummary` reads).
public struct LearningRecord: Codable, Equatable, Sendable, Identifiable {
    /// uuid v4, made on the board when the attempt starts
    public var id: String
    /// the board it was worked on; null once that board is deleted
    public var boardId: String?
    /// the problem as LaTeX (a system's lines joined by "; "), at most 500 characters
    public var problemLatex: String
    public var skill: String
    /// the student's course (`profiles.course`), nil when unknown
    public var course: String?
    public var origin: LearningOrigin
    /// for `now_you_try`: the attempt it follows
    public var parentId: String?
    public var outcome: LearningOutcome
    public var linesWritten: Int
    public var linesRight: Int
    public var linesRinged: Int
    public var hints: Int
    public var tutorSteps: Int
    public var solves: Int
    public var asks: Int
    /// mistakes seen, by kind (only kinds with a count)
    public var mistakes: [String: Int]
    public var activeMs: Int
    /// ISO timestamps (`Date.toISOString`)
    public var startedAt: String
    public var updatedAt: String
    /// set when the outcome stopped being `in_progress`
    public var finishedAt: String?

    public init(id: String, boardId: String?, problemLatex: String, skill: String, course: String?, origin: LearningOrigin,
                parentId: String?, outcome: LearningOutcome, linesWritten: Int = 0, linesRight: Int = 0, linesRinged: Int = 0,
                hints: Int = 0, tutorSteps: Int = 0, solves: Int = 0, asks: Int = 0, mistakes: [String: Int] = [:],
                activeMs: Int = 0, startedAt: String, updatedAt: String, finishedAt: String?) {
        self.id = id
        self.boardId = boardId
        self.problemLatex = problemLatex
        self.skill = skill
        self.course = course
        self.origin = origin
        self.parentId = parentId
        self.outcome = outcome
        self.linesWritten = linesWritten
        self.linesRight = linesRight
        self.linesRinged = linesRinged
        self.hints = hints
        self.tutorSteps = tutorSteps
        self.solves = solves
        self.asks = asks
        self.mistakes = mistakes
        self.activeMs = activeMs
        self.startedAt = startedAt
        self.updatedAt = updatedAt
        self.finishedAt = finishedAt
    }

    enum CodingKeys: String, CodingKey {
        case id, boardId, problemLatex, skill, course, origin, parentId, outcome, linesWritten, linesRight, linesRinged
        case hints, tutorSteps, solves, asks, mistakes, activeMs, startedAt, updatedAt, finishedAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        boardId = try c.decodeIfPresent(String.self, forKey: .boardId)
        problemLatex = try c.decode(String.self, forKey: .problemLatex)
        skill = try c.decode(String.self, forKey: .skill)
        course = try c.decodeIfPresent(String.self, forKey: .course)
        origin = try c.decode(LearningOrigin.self, forKey: .origin)
        parentId = try c.decodeIfPresent(String.self, forKey: .parentId)
        outcome = try c.decode(LearningOutcome.self, forKey: .outcome)
        func count(_ k: CodingKeys) -> Int { (try? c.decodeIfPresent(Double.self, forKey: k)).flatMap { $0 }.map { Int($0) } ?? 0 }
        linesWritten = count(.linesWritten)
        linesRight = count(.linesRight)
        linesRinged = count(.linesRinged)
        hints = count(.hints)
        tutorSteps = count(.tutorSteps)
        solves = count(.solves)
        asks = count(.asks)
        mistakes = (try? c.decodeIfPresent([String: Int].self, forKey: .mistakes)).flatMap { $0 } ?? [:]
        activeMs = count(.activeMs)
        startedAt = try c.decode(String.self, forKey: .startedAt)
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt) ?? startedAt
        finishedAt = try c.decodeIfPresent(String.self, forKey: .finishedAt)
    }

    /// Every key, nulls included (the web's JSON).
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(boardId, forKey: .boardId)
        try c.encode(problemLatex, forKey: .problemLatex)
        try c.encode(skill, forKey: .skill)
        try c.encode(course, forKey: .course)
        try c.encode(origin, forKey: .origin)
        try c.encode(parentId, forKey: .parentId)
        try c.encode(outcome, forKey: .outcome)
        try c.encode(mistakes, forKey: .mistakes)
        try c.encode(activeMs, forKey: .activeMs)
        try c.encode(linesWritten, forKey: .linesWritten)
        try c.encode(linesRight, forKey: .linesRight)
        try c.encode(linesRinged, forKey: .linesRinged)
        try c.encode(hints, forKey: .hints)
        try c.encode(tutorSteps, forKey: .tutorSteps)
        try c.encode(solves, forKey: .solves)
        try c.encode(asks, forKey: .asks)
        try c.encode(startedAt, forKey: .startedAt)
        try c.encode(updatedAt, forKey: .updatedAt)
        try c.encode(finishedAt, forKey: .finishedAt)
    }

    var counts: AttemptCounts {
        AttemptCounts(linesWritten: linesWritten, linesRight: linesRight, linesRinged: linesRinged, hints: hints,
                      tutorSteps: tutorSteps, solves: solves, asks: asks)
    }

    mutating func setCounts(_ c: AttemptCounts) {
        linesWritten = c.linesWritten
        linesRight = c.linesRight
        linesRinged = c.linesRinged
        hints = c.hints
        tutorSteps = c.tutorSteps
        solves = c.solves
        asks = c.asks
    }
}

/// What the board tells the learning record (`LearningSignal`), at the moments the Live loop knows
/// about. `problemKey` names one problem on one screen and stays the same while the problem is
/// there: `<screen>#cell:<key>` for a problem the tutor wrote, `<screen>#ink:<line id>` for the
/// student's own, `<screen>#teach:<seed>` for a worked solution the chat taught. Times are ms since
/// the epoch (`Date.now()`).
public enum LearningSignal: Equatable, Sendable {
    /// a problem the tutor wrote (the chat, a practice set, Now you try, the tour)
    case problem(Problem)
    /// a student line's mark decided (drawn or not), or what is said about it changed
    case line(Line)
    /// a mistake named for a ringed line (`model`: a check's annotation; `local`: the board's classifier)
    case mistake(Mistake)
    /// the tutor's help for a problem
    case help(Help)
    /// the tutor finished writing a problem's solution
    case tutorSolved(TutorSolved)
    /// the student moved to another screen
    case screen(at: Double, boardId: String, pageId: String)
    /// the board closed
    case closed(at: Double, boardId: String)

    public struct Problem: Equatable, Sendable {
        public var at: Double
        public var boardId: String
        public var pageId: String
        public var problemKey: String
        /// the problem as LaTeX lines (one for most, 2–3 for a system)
        public var problemLatex: [String]
        public var origin: LearningOrigin
        public var parentId: String?
        public init(at: Double, boardId: String, pageId: String, problemKey: String, problemLatex: [String], origin: LearningOrigin, parentId: String? = nil) {
            self.at = at
            self.boardId = boardId
            self.pageId = pageId
            self.problemKey = problemKey
            self.problemLatex = problemLatex
            self.origin = origin
            self.parentId = parentId
        }
    }

    public struct Line: Equatable, Sendable {
        public var at: Double
        public var boardId: String
        public var pageId: String
        public var problemKey: String
        /// the problem's lines (the student's head line, as read; or the tutor's problem)
        public var problemLatex: [String]
        public var lineId: String
        public var latex: String
        /// the engine's kind of line (`LineAnalysis.kind`)
        public var kind: String
        /// the line above it in the same problem, as read (for the mistake classifier)
        public var previousLatex: String?
        public var mark: LineMark?
        /// the engine says this line is the answer, and it is ticked
        public var solved: Bool
        public init(at: Double, boardId: String, pageId: String, problemKey: String, problemLatex: [String], lineId: String, latex: String,
                    kind: String, previousLatex: String? = nil, mark: LineMark?, solved: Bool) {
            self.at = at
            self.boardId = boardId
            self.pageId = pageId
            self.problemKey = problemKey
            self.problemLatex = problemLatex
            self.lineId = lineId
            self.latex = latex
            self.kind = kind
            self.previousLatex = previousLatex
            self.mark = mark
            self.solved = solved
        }
    }

    public struct Mistake: Equatable, Sendable {
        public enum Source: String, Codable, Sendable { case model, local }
        public var at: Double
        public var problemKey: String
        public var lineId: String
        public var kind: String
        public var source: Source
        public init(at: Double, problemKey: String, lineId: String, kind: String, source: Source) {
            self.at = at
            self.problemKey = problemKey
            self.lineId = lineId
            self.kind = kind
            self.source = source
        }
    }

    public struct Help: Equatable, Sendable {
        public var at: Double
        public var problemKey: String
        public var help: LearningHelp
        /// Auto did it (no tap)
        public var auto: Bool
        public init(at: Double, problemKey: String, help: LearningHelp, auto: Bool) {
            self.at = at
            self.problemKey = problemKey
            self.help = help
            self.auto = auto
        }
    }

    public struct TutorSolved: Equatable, Sendable {
        public var at: Double
        public var boardId: String
        public var pageId: String
        public var problemKey: String
        public var problemLatex: [String]
        public var origin: LearningOrigin?
        public init(at: Double, boardId: String, pageId: String, problemKey: String, problemLatex: [String], origin: LearningOrigin? = nil) {
            self.at = at
            self.boardId = boardId
            self.pageId = pageId
            self.problemKey = problemKey
            self.problemLatex = problemLatex
            self.origin = origin
        }
    }

    public var at: Double {
        switch self {
        case .problem(let s): return s.at
        case .line(let s): return s.at
        case .mistake(let s): return s.at
        case .help(let s): return s.at
        case .tutorSolved(let s): return s.at
        case .screen(let at, _, _), .closed(let at, _): return at
        }
    }

    /// The board this signal is about, when it says (a mistake or help says only its problem).
    public var boardId: String? {
        switch self {
        case .problem(let s): return s.boardId
        case .line(let s): return s.boardId
        case .tutorSolved(let s): return s.boardId
        case .screen(_, let b, _), .closed(_, let b): return b
        case .mistake, .help: return nil
        }
    }

    /// The problem it is about, when it is about one.
    public var problemKey: String? {
        switch self {
        case .problem(let s): return s.problemKey
        case .line(let s): return s.problemKey
        case .mistake(let s): return s.problemKey
        case .help(let s): return s.problemKey
        case .tutorSolved(let s): return s.problemKey
        case .screen, .closed: return nil
        }
    }

    /// The problem's LaTeX lines it carries (for the skill), when it carries them.
    var problemLines: [String]? {
        switch self {
        case .problem(let s): return s.problemLatex
        case .line(let s): return s.problemLatex
        case .tutorSolved(let s): return s.problemLatex
        default: return nil
        }
    }
}

extension LearningSignal: Codable {
    enum CodingKeys: String, CodingKey {
        case type, at, boardId, pageId, problemKey, problemLatex, origin, parentId, lineId, latex, kind, previousLatex, mark, solved, help, auto, source
    }

    /// The web's JSON shape (`{ "type": "line", … }`).
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let type = try c.decode(String.self, forKey: .type)
        let at = try c.decode(Double.self, forKey: .at)
        switch type {
        case "problem":
            self = .problem(Problem(at: at, boardId: try c.decode(String.self, forKey: .boardId), pageId: try c.decode(String.self, forKey: .pageId),
                                    problemKey: try c.decode(String.self, forKey: .problemKey), problemLatex: try c.decode([String].self, forKey: .problemLatex),
                                    origin: try c.decode(LearningOrigin.self, forKey: .origin), parentId: try c.decodeIfPresent(String.self, forKey: .parentId)))
        case "line":
            self = .line(Line(at: at, boardId: try c.decode(String.self, forKey: .boardId), pageId: try c.decode(String.self, forKey: .pageId),
                              problemKey: try c.decode(String.self, forKey: .problemKey), problemLatex: try c.decode([String].self, forKey: .problemLatex),
                              lineId: try c.decode(String.self, forKey: .lineId), latex: try c.decode(String.self, forKey: .latex),
                              kind: try c.decode(String.self, forKey: .kind), previousLatex: try c.decodeIfPresent(String.self, forKey: .previousLatex),
                              mark: try c.decodeIfPresent(LineMark.self, forKey: .mark), solved: try c.decode(Bool.self, forKey: .solved)))
        case "mistake":
            self = .mistake(Mistake(at: at, problemKey: try c.decode(String.self, forKey: .problemKey), lineId: try c.decode(String.self, forKey: .lineId),
                                    kind: try c.decode(String.self, forKey: .kind), source: try c.decode(Mistake.Source.self, forKey: .source)))
        case "help":
            self = .help(Help(at: at, problemKey: try c.decode(String.self, forKey: .problemKey), help: try c.decode(LearningHelp.self, forKey: .help),
                              auto: try c.decodeIfPresent(Bool.self, forKey: .auto) ?? false))
        case "tutor_solved":
            self = .tutorSolved(TutorSolved(at: at, boardId: try c.decode(String.self, forKey: .boardId), pageId: try c.decode(String.self, forKey: .pageId),
                                            problemKey: try c.decode(String.self, forKey: .problemKey), problemLatex: try c.decode([String].self, forKey: .problemLatex),
                                            origin: try c.decodeIfPresent(LearningOrigin.self, forKey: .origin)))
        case "screen":
            self = .screen(at: at, boardId: try c.decode(String.self, forKey: .boardId), pageId: try c.decode(String.self, forKey: .pageId))
        case "closed":
            self = .closed(at: at, boardId: try c.decode(String.self, forKey: .boardId))
        default:
            throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "unknown learning signal \(type)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(at, forKey: .at)
        switch self {
        case .problem(let s):
            try c.encode("problem", forKey: .type)
            try c.encode(s.boardId, forKey: .boardId)
            try c.encode(s.pageId, forKey: .pageId)
            try c.encode(s.problemKey, forKey: .problemKey)
            try c.encode(s.problemLatex, forKey: .problemLatex)
            try c.encode(s.origin, forKey: .origin)
            try c.encodeIfPresent(s.parentId, forKey: .parentId)
        case .line(let s):
            try c.encode("line", forKey: .type)
            try c.encode(s.boardId, forKey: .boardId)
            try c.encode(s.pageId, forKey: .pageId)
            try c.encode(s.problemKey, forKey: .problemKey)
            try c.encode(s.problemLatex, forKey: .problemLatex)
            try c.encode(s.lineId, forKey: .lineId)
            try c.encode(s.latex, forKey: .latex)
            try c.encode(s.kind, forKey: .kind)
            try c.encodeIfPresent(s.previousLatex, forKey: .previousLatex)
            try c.encode(s.mark, forKey: .mark)
            try c.encode(s.solved, forKey: .solved)
        case .mistake(let s):
            try c.encode("mistake", forKey: .type)
            try c.encode(s.problemKey, forKey: .problemKey)
            try c.encode(s.lineId, forKey: .lineId)
            try c.encode(s.kind, forKey: .kind)
            try c.encode(s.source, forKey: .source)
        case .help(let s):
            try c.encode("help", forKey: .type)
            try c.encode(s.problemKey, forKey: .problemKey)
            try c.encode(s.help, forKey: .help)
            try c.encode(s.auto, forKey: .auto)
        case .tutorSolved(let s):
            try c.encode("tutor_solved", forKey: .type)
            try c.encode(s.boardId, forKey: .boardId)
            try c.encode(s.pageId, forKey: .pageId)
            try c.encode(s.problemKey, forKey: .problemKey)
            try c.encode(s.problemLatex, forKey: .problemLatex)
            try c.encodeIfPresent(s.origin, forKey: .origin)
        case .screen(_, let boardId, let pageId):
            try c.encode("screen", forKey: .type)
            try c.encode(boardId, forKey: .boardId)
            try c.encode(pageId, forKey: .pageId)
        case .closed(_, let boardId):
            try c.encode("closed", forKey: .type)
            try c.encode(boardId, forKey: .boardId)
        }
    }
}

/// How the record names problems (`PROBLEM_KEY_KINDS`): the tracker reads only the kind.
public enum ProblemKeyKind {
    public static let cell = "#cell:"
    public static let ink = "#ink:"
    public static let teach = "#teach:"

    /// Where a problem known only by its key came from (`originOfKey`).
    public static func origin(of key: String) -> LearningOrigin {
        if key.contains(cell) { return .tutorProblem }
        if key.contains(teach) { return .teach }
        return .student
    }
}

/// A dictionary that keeps its keys in insertion order, as a JavaScript `Map` does: setting a key
/// that is there keeps its place, deleting and setting it again moves it to the end.
struct OrderedMap<Key: Hashable, Value> {
    private(set) var keys: [Key] = []
    private var values: [Key: Value] = [:]

    init() {}

    init(_ pairs: [(Key, Value)]) {
        for (k, v) in pairs { self[k] = v }
    }

    var count: Int { keys.count }
    var isEmpty: Bool { keys.isEmpty }

    subscript(key: Key) -> Value? {
        get { values[key] }
        set {
            if let newValue {
                if values.updateValue(newValue, forKey: key) == nil { keys.append(key) }
            } else {
                remove(key)
            }
        }
    }

    func has(_ key: Key) -> Bool { values[key] != nil }

    mutating func remove(_ key: Key) {
        guard values.removeValue(forKey: key) != nil, let i = keys.firstIndex(of: key) else { return }
        keys.remove(at: i)
    }

    /// The oldest key, removed.
    mutating func removeFirst() {
        guard let k = keys.first else { return }
        remove(k)
    }

    var orderedValues: [Value] { keys.compactMap { values[$0] } }
    var pairs: [(Key, Value)] { keys.compactMap { k in values[k].map { (k, $0) } } }
}
