import AgathonBoard
import Foundation

// The Training Center (docs/TRAINING-CENTER.md): an admin-only place where the owner brute-tests the
// tutor on the board with real maths. Two ways in:
//
//  - the AUTO BENCH writes cases from a catalogue of how kids really write (and the brain's own
//    practice problems) in synthetic hands, one problem a page, through the canvas's touch path, at a
//    kid's pace, against the real tutor; each line's mark is compared with what a teacher would do;
//  - MY PENCIL: the owner writes on a training board with the Apple Pencil and says 👍 or 👎 to what
//    the tutor did with each line.
//
// These are the records both share: what a case is and what is expected of each line, what was
// observed, and how a run went. Everything is Codable: runs are kept on the iPad as JSON, saved to
// Supabase (`training_runs`, `training_cases`), and a failure becomes a regression fixture.

/// What a teacher wants the tutor to do with one line.
public enum TrainingExpect: String, Codable, Sendable, CaseIterable, Hashable {
    /// a tick: a right step, or the answer
    case tick
    /// no mark at all (the writer's own problem, a line still going, a partial sum alone)
    case quiet
    /// a ring: a real slip
    case ring
    /// a true line a teacher might tick or let be: a tick or no mark, never a ring or a "?"
    case calm

    /// Does the tutor's mark do what is expected?
    public func accepts(_ mark: TrainingMark) -> Bool {
        switch self {
        case .tick: return mark == .tick
        case .quiet: return mark == .none
        case .ring: return mark == .ring
        case .calm: return mark == .tick || mark == .none
        }
    }

    public var words: String {
        switch self {
        case .tick: return "a tick"
        case .quiet: return "no mark"
        case .ring: return "a ring"
        case .calm: return "a tick or no mark"
        }
    }
}

/// The mark the tutor left on a line (the board's `mark` records).
public enum TrainingMark: String, Codable, Sendable, CaseIterable, Hashable {
    case tick, ring, question, none

    init(_ kind: AgathonBoard.MarkKind?) {
        switch kind {
        case .tick?: self = .tick
        case .ring?: self = .ring
        case .question?: self = .question
        case nil: self = .none
        }
    }

    public var words: String {
        switch self {
        case .tick: return "a tick"
        case .ring: return "a ring"
        case .question: return "a question mark"
        case .none: return "no mark"
        }
    }
}

/// Where on the problem page a line is written.
public enum TrainingPlace: String, Codable, Sendable, Hashable {
    /// the next line of the work area (under the last line)
    case work
    /// in the answer spot at the bottom of the page
    case answer
    /// at the top, where the tutor writes a problem: the writer's own problem
    case problem
    /// on the same row as the line before, after it (a kid's own tick, `= 431` beside a sum)
    case beside
}

/// The kinds of writing the catalogue covers (the owner's list of how kids really write).
public enum TrainingCategory: String, Codable, Sendable, CaseIterable, Hashable, Identifiable {
    case runningTotal
    case equalsNextLine
    case chain
    case multiStep
    case trueSteps
    case facts
    case fractions
    case mixedNumbers
    case decimals
    case negatives
    case exponents
    case orderOfOps
    case wordSetup
    case longDivision
    case columnSum
    case rewrite
    case ownTick
    case spacing
    case ownProblem
    case generated

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .runningTotal: return "Running totals"
        case .equalsNextLine: return "= on the next line"
        case .chain: return "Chains"
        case .multiStep: return "Multi-step equations"
        case .trueSteps: return "True steps, not the answer"
        case .facts: return "Facts and sums"
        case .fractions: return "Fractions"
        case .mixedNumbers: return "Mixed numbers"
        case .decimals: return "Decimals"
        case .negatives: return "Negatives"
        case .exponents: return "Exponents and roots"
        case .orderOfOps: return "Order of operations"
        case .wordSetup: return "Word-problem setups"
        case .longDivision: return "Long division"
        case .columnSum: return "Stacked / column sums"
        case .rewrite: return "Rewrites and corrections"
        case .ownTick: return "A kid's own tick"
        case .spacing: return "Spacing quirks"
        case .ownProblem: return "Their own problem"
        case .generated: return "Practice problems (brain)"
        }
    }
}

/// The grade bands the bench is cut by.
public enum TrainingGrade: String, Codable, Sendable, CaseIterable, Hashable, Identifiable {
    case k2 = "K-2"
    case g34 = "3-4"
    case g56 = "5-6"
    case g78 = "7-8"
    case hs = "HS"

    public var id: String { rawValue }
    public var title: String { self == .hs ? "High school" : "Grades \(rawValue)" }
}

/// One line of a case: what the hand writes, and what a teacher wants the tutor to do with it.
public struct TrainingLineSpec: Codable, Sendable, Hashable {
    /// the LaTeX the synthetic hand writes
    public var latex: String
    public var expect: TrainingExpect
    /// for a ring: the right value (what the line should have said), when there is one
    public var value: String?
    public var place: TrainingPlace
    /// an indent from the work area's left edge (page units)
    public var dx: Double
    /// what the line means, when the ink says it differently (`2 \quad x = 8` means `2x = 8`): a read
    /// is checked against this
    public var means: String?
    /// what the writer does to it after writing it: rubs it out (the eraser), or crosses it out (a stroke
    /// through it) and goes on below
    public var then: Then?

    public enum Then: String, Codable, Sendable, Hashable {
        case erase, strike
    }

    public init(_ latex: String, _ expect: TrainingExpect, value: String? = nil, place: TrainingPlace = .work, dx: Double = 0, means: String? = nil,
                then: Then? = nil) {
        self.latex = latex
        self.expect = expect
        self.value = value
        self.place = place
        self.dx = dx
        self.means = means
        self.then = then
    }

    /// what a right read of this line says
    public var meaning: String { means ?? latex }
}

/// Where a case comes from.
public enum TrainingSource: String, Codable, Sendable, Hashable {
    /// the curated catalogue (`TrainingCatalogue`)
    case catalogue
    /// the brain's practice generator, worked by the engine (`TrainingGenerator`)
    case practice
    /// the owner's own writing (My Pencil)
    case pencil
}

/// One problem page's worth: the problem (the tutor writes it at the top) and the work under it.
public struct TrainingCase: Codable, Sendable, Hashable, Identifiable {
    /// stable: the catalogue's id, or `gen:<skill>:<seed>:<n>:<right|slip>`
    public var id: String
    public var category: TrainingCategory
    public var grade: TrainingGrade
    public var topic: String
    /// the problem's lines; nil: the writer's own problem (its lines are `place: .problem`)
    public var problem: [String]?
    public var lines: [TrainingLineSpec]
    /// the page's problem ends solved (nil: not judged — a teacher could go either way)
    public var solved: Bool?
    /// a deliberately wrong solution (a slip somewhere in it)
    public var wrong: Bool
    public var source: TrainingSource
    public var note: String?

    public init(id: String, category: TrainingCategory, grade: TrainingGrade, topic: String, problem: [String]?, lines: [TrainingLineSpec],
                solved: Bool?, wrong: Bool? = nil, source: TrainingSource = .catalogue, note: String? = nil) {
        self.id = id
        self.category = category
        self.grade = grade
        self.topic = topic
        self.problem = problem
        self.lines = lines
        self.solved = solved
        self.wrong = wrong ?? lines.contains { $0.expect == .ring }
        self.source = source
        self.note = note
    }

    /// The problem as one line of text, for lists.
    public var title: String {
        if let problem, !problem.isEmpty { return problem.joined(separator: " ; ") }
        return lines.first { $0.place == .problem }?.latex ?? lines.first?.latex ?? id
    }
}

/// A synthetic student hand: the scoreboard's four (docs/eval/handwriting.md) at a kid's size, and two
/// sizes of the clean one. The glyphs are the tutor's hand atlas; what changes is how the pen moves.
public struct TrainingHand: Codable, Sendable, Hashable, Identifiable {
    public var name: String
    public var seed: Int
    /// horizontal shear per unit of height above the baseline (italic lean)
    public var slant: Double
    public var sx: Double
    public var sy: Double
    public var rotateDeg: Double
    /// per-stroke random offset, as a fraction of the hand size
    public var jitter: Double
    /// uneven glyph sizes along the line (±)
    public var sizeDrift: Double
    /// a wandering baseline (± a fraction of the hand size)
    public var wander: Double
    /// page units per unit of the scoreboard's hand (44 high): 1.6 is a kid's writing on the page's
    /// guide lines
    public var scale: Double

    public var id: String { name }

    public static let clean = TrainingHand(name: "clean", seed: 1, slant: 0, sx: 1, sy: 1, rotateDeg: 0, jitter: 0, sizeDrift: 0, wander: 0, scale: 1.6)
    public static let slanted = TrainingHand(name: "slanted", seed: 7, slant: 0.14, sx: 0.94, sy: 1.06, rotateDeg: -1.5, jitter: 0.035, sizeDrift: 0, wander: 0, scale: 1.6)
    public static let steep = TrainingHand(name: "steep", seed: 11, slant: 0.3, sx: 0.9, sy: 1.1, rotateDeg: -4, jitter: 0.06, sizeDrift: 0, wander: 0, scale: 1.6)
    public static let messy = TrainingHand(name: "messy", seed: 23, slant: 0.1, sx: 1, sy: 1, rotateDeg: 1, jitter: 0.05, sizeDrift: 0.2, wander: 0.12, scale: 1.6)
    /// a young kid's big letters
    public static let big = TrainingHand(name: "big", seed: 31, slant: 0.04, sx: 1.05, sy: 1, rotateDeg: 0.5, jitter: 0.04, sizeDrift: 0.12, wander: 0.06, scale: 2.1)
    /// small, tidy writing
    public static let small = TrainingHand(name: "small", seed: 37, slant: 0.06, sx: 0.96, sy: 1, rotateDeg: -0.5, jitter: 0.02, sizeDrift: 0, wander: 0, scale: 1.15)

    public static let all: [TrainingHand] = [.clean, .slanted, .steep, .messy, .big, .small]

    public static func named(_ name: String) -> TrainingHand? { all.first { $0.name == name } }
}

/// The handwriting a My Pencil page was written in (the owner's own tag), so results can be cut by it.
public enum HandwritingStyle: String, Codable, Sendable, CaseIterable, Hashable, Identifiable {
    case neat, fast, messy, bigKid, small, slanted, leftHanded, other

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .neat: return "Neat"
        case .fast: return "Fast"
        case .messy: return "Messy"
        case .bigKid: return "Big kid letters"
        case .small: return "Small"
        case .slanted: return "Slanted"
        case .leftHanded: return "Left-handed"
        case .other: return "Other"
        }
    }

    /// The tag stored with a page: the style, or the owner's own words for "Other".
    public static func tag(_ style: HandwritingStyle, other: String) -> String {
        let words = other.trimmingCharacters(in: .whitespacesAndNewlines)
        if style == .other, !words.isEmpty { return "other: \(String(words.prefix(40)))" }
        return style.rawValue
    }
}

// MARK: - what was observed

/// Why a line (or a case) failed, in a few words and a code to count by.
public struct TrainingWhy: Codable, Sendable, Hashable {
    public enum Code: String, Codable, Sendable, CaseIterable {
        /// read as something else than written
        case misread
        /// nothing read (a "?", or never read)
        case unread
        /// the tutor took one written line for two or more
        case split
        /// the tutor took the line together with another one
        case merged
        /// never checked (held: when-done mode never released it)
        case held
        /// a ring on a line a teacher ticks or lets be
        case wrongRing
        /// no ring on a slip
        case missedRing
        /// some other mark than expected (a tick missing, a tick where none belongs)
        case wrongMark
        /// "Is this right?" instead of the ring (a read the tutor doubted)
        case asked
        /// ringed, but the tutor's value is not the right one
        case wrongValue
        /// the page should end solved and does not
        case notSolved
        /// the page ends solved and should not
        case falselySolved
        /// the run's call budget ran out
        case budget
        /// the bench could not write or run it
        case error

        public var title: String {
            switch self {
            case .misread: return "Misread"
            case .unread: return "Not read"
            case .split: return "Split in two"
            case .merged: return "Merged with another line"
            case .held: return "Never checked"
            case .wrongRing: return "Ringed right work"
            case .missedRing: return "Missed a slip"
            case .wrongMark: return "Wrong mark"
            case .asked: return "Asked instead of ringing"
            case .wrongValue: return "Wrong value"
            case .notSolved: return "Not counted solved"
            case .falselySolved: return "Counted solved wrongly"
            case .budget: return "Budget ran out"
            case .error: return "Bench error"
            }
        }
    }

    public var code: Code
    public var text: String

    public init(_ code: Code, _ text: String) {
        self.code = code
        self.text = text
    }
}

/// The owner's word on what the tutor did with one line (My Pencil).
public struct TrainingReview: Codable, Sendable, Hashable {
    public enum Should: String, Codable, Sendable, CaseIterable {
        case tick, quiet, ring, misread

        public var title: String {
            switch self {
            case .tick: return "Tick it"
            case .quiet: return "Leave it"
            case .ring: return "Ring it"
            case .misread: return "Read it as…"
            }
        }
    }

    public var thumbsUp: Bool
    /// what it should have done (a 👎)
    public var should: Should?
    /// with `misread`: the right reading (LaTeX)
    public var latex: String?
    public var note: String?
    public var at: Date

    public init(thumbsUp: Bool, should: Should? = nil, latex: String? = nil, note: String? = nil, at: Date = Date()) {
        self.thumbsUp = thumbsUp
        self.should = should
        self.latex = latex
        self.note = note
        self.at = at
    }

    /// The review as an expectation, when it says one (a misread keeps the mark's own expectation).
    public var expect: TrainingExpect? {
        switch should {
        case .tick?: return .tick
        case .quiet?: return .quiet
        case .ring?: return .ring
        case .misread?, nil: return nil
        }
    }
}

/// One stroke, page units.
public struct TrainingStroke: Codable, Sendable, Hashable {
    public var x: [Double]
    public var y: [Double]

    public init(x: [Double], y: [Double]) {
        self.x = x
        self.y = y
    }
}

/// What happened to one written line.
public struct TrainingLineResult: Codable, Sendable, Hashable, Identifiable {
    public var index: Int
    /// what was written (the case's LaTeX), or for My Pencil what the tutor read first
    public var written: String
    /// what a right read says
    public var meaning: String
    public var expect: TrainingExpect?
    public var value: String?
    public var place: TrainingPlace
    /// the tutor's read (nil: never read)
    public var read: String?
    public var provider: String?
    public var confidence: Double?
    /// "I read": read, asking, fixed, unread
    public var reading: String?
    /// the engine's word on it: ok, mismatch, unknown, none
    public var verdict: String?
    public var kind: String?
    /// the engine's value of the line (`resultLatex`), when it gives one
    public var result: String?
    public var mark: TrainingMark
    /// checked (when-done) or marked as it went (as-I-go)
    public var released: Bool
    /// the tutor's lines this written line became (1 is right)
    public var pieces: Int
    /// pen up → read in (ms)
    public var readMs: Double?
    /// pen up → its mark (ms)
    public var markMs: Double?
    /// the read is the maths that was written
    public var readRight: Bool?
    public var pass: Bool?
    public var why: TrainingWhy?
    public var review: TrainingReview?
    /// the tutor's line id (My Pencil's reviews, re-runs)
    public var lineId: String?

    public var id: Int { index }

    public init(index: Int, written: String, meaning: String, expect: TrainingExpect?, value: String?, place: TrainingPlace, read: String? = nil,
                provider: String? = nil, confidence: Double? = nil, reading: String? = nil, verdict: String? = nil, kind: String? = nil,
                result: String? = nil, mark: TrainingMark = .none, released: Bool = false, pieces: Int = 0, readMs: Double? = nil,
                markMs: Double? = nil, readRight: Bool? = nil, pass: Bool? = nil, why: TrainingWhy? = nil, review: TrainingReview? = nil,
                lineId: String? = nil) {
        self.index = index
        self.written = written
        self.meaning = meaning
        self.expect = expect
        self.value = value
        self.place = place
        self.read = read
        self.provider = provider
        self.confidence = confidence
        self.reading = reading
        self.verdict = verdict
        self.kind = kind
        self.result = result
        self.mark = mark
        self.released = released
        self.pieces = pieces
        self.readMs = readMs
        self.markMs = markMs
        self.readRight = readRight
        self.pass = pass
        self.why = why
        self.review = review
        self.lineId = lineId
    }
}

/// One recognizer answer as the bench saw it: the request's strokes (the payload: what a replay
/// matches on) and the answer. A regression fixture replays these instead of calling Mathpix.
public struct RecordedRead: Codable, Sendable, Hashable {
    public var lineId: String
    public var x: [[Double]]
    public var y: [[Double]]
    public var w: Double
    public var h: Double
    public var latex: String?
    public var confidence: Double?
    public var provider: String?
    public var ms: Double
    /// the call failed (its error, short)
    public var error: String?
    /// when it was asked (seconds since the run began)
    public var at: Double

    public init(lineId: String, x: [[Double]], y: [[Double]], w: Double, h: Double, latex: String?, confidence: Double?, provider: String?,
                ms: Double, error: String?, at: Double) {
        self.lineId = lineId
        self.x = x
        self.y = y
        self.w = w
        self.h = h
        self.latex = latex
        self.confidence = confidence
        self.provider = provider
        self.ms = ms
        self.error = error
        self.at = at
    }
}

public enum TrainingKind: String, Codable, Sendable, Hashable {
    case bench, pencil
}

/// One page as it went: the case, every line's outcome, the calls it cost.
public struct TrainingCaseResult: Codable, Sendable, Hashable, Identifiable {
    public var id: UUID
    public var kind: TrainingKind
    public var caseKey: String
    public var category: TrainingCategory
    public var grade: TrainingGrade?
    public var topic: String
    /// the synthetic hand (bench), or the handwriting style tag (My Pencil)
    public var hand: String
    public var problem: [String]
    /// the bench's case as written (nil for My Pencil)
    public var spec: TrainingCase?
    public var lines: [TrainingLineResult]
    /// each line's strokes, page units (index-aligned with `lines`)
    public var strokes: [[TrainingStroke]]
    public var reads: [RecordedRead]
    public var solvedExpected: Bool?
    public var solvedGot: Bool
    public var pass: Bool?
    /// the case's own failure (solved or not, the budget, an error), beside its lines'
    public var why: TrainingWhy?
    public var calls: [String: Int]
    /// writing started → the last mark (ms)
    public var ms: Double
    /// Check → the last mark landed (ms)
    public var checkMs: Double?
    /// the page as it looked at the end (JPEG), kept for failures
    public var snapshot: Data?
    public var regression: Bool
    public var createdAt: Date

    public init(id: UUID = UUID(), kind: TrainingKind, caseKey: String, category: TrainingCategory, grade: TrainingGrade?, topic: String,
                hand: String, problem: [String], spec: TrainingCase?, lines: [TrainingLineResult], strokes: [[TrainingStroke]],
                reads: [RecordedRead] = [], solvedExpected: Bool?, solvedGot: Bool, pass: Bool?, why: TrainingWhy? = nil,
                calls: [String: Int] = [:], ms: Double = 0, checkMs: Double? = nil, snapshot: Data? = nil, regression: Bool = false,
                createdAt: Date = Date()) {
        self.id = id
        self.kind = kind
        self.caseKey = caseKey
        self.category = category
        self.grade = grade
        self.topic = topic
        self.hand = hand
        self.problem = problem
        self.spec = spec
        self.lines = lines
        self.strokes = strokes
        self.reads = reads
        self.solvedExpected = solvedExpected
        self.solvedGot = solvedGot
        self.pass = pass
        self.why = why
        self.calls = calls
        self.ms = ms
        self.checkMs = checkMs
        self.snapshot = snapshot
        self.regression = regression
        self.createdAt = createdAt
    }

    /// The first reason a line (or the page) failed.
    public var firstWhy: TrainingWhy? {
        lines.first { $0.pass == false }?.why ?? why
    }
}

/// How a bench run is set up.
public struct TrainingConfig: Codable, Sendable, Hashable {
    public var grades: [TrainingGrade]
    public var categories: [TrainingCategory]
    /// cases to run (each in one hand)
    public var count: Int
    public var hands: [String]
    /// brisk, typical, slow (KidPace)
    public var pace: String
    /// whenDone or asIGo (`CheckTiming`)
    public var checking: String
    /// right and deliberately wrong solutions (false: right ones only)
    public var includeWrong: Bool
    /// the brain's practice problems as well as the catalogue
    public var includeGenerated: Bool
    /// at most this many calls to the server in the whole run
    public var budget: Int
    public var seed: Int

    public init(grades: [TrainingGrade] = TrainingGrade.allCases, categories: [TrainingCategory] = TrainingCategory.allCases, count: Int = 12,
                hands: [String] = ["clean", "messy"], pace: String = "brisk", checking: String = CheckTiming.whenDone.rawValue,
                includeWrong: Bool = true, includeGenerated: Bool = true, budget: Int = 60, seed: Int = 1) {
        self.grades = grades
        self.categories = categories
        self.count = count
        self.hands = hands
        self.pace = pace
        self.checking = checking
        self.includeWrong = includeWrong
        self.includeGenerated = includeGenerated
        self.budget = budget
        self.seed = seed
    }

    /// A small run for the first try against production: a dozen cases, two hands, 60 calls.
    public static let small = TrainingConfig()
}

/// A run: a bench run, or a My Pencil session.
public struct TrainingRun: Codable, Sendable, Hashable, Identifiable {
    public enum Status: String, Codable, Sendable {
        case running, done, stopped, budget, failed
    }

    public var id: UUID
    public var kind: TrainingKind
    public var startedAt: Date
    public var finishedAt: Date?
    public var status: Status
    /// the API the run called (its host)
    public var target: String
    public var appBuild: String?
    public var config: TrainingConfig?
    public var cases: [TrainingCaseResult]
    /// saved to Supabase (nil: not tried; a message: why it is only on this iPad)
    public var synced: Bool
    public var syncNote: String?

    public init(id: UUID = UUID(), kind: TrainingKind, startedAt: Date = Date(), finishedAt: Date? = nil, status: Status = .running, target: String,
                appBuild: String? = nil, config: TrainingConfig? = nil, cases: [TrainingCaseResult] = [], synced: Bool = false, syncNote: String? = nil) {
        self.id = id
        self.kind = kind
        self.startedAt = startedAt
        self.finishedAt = finishedAt
        self.status = status
        self.target = target
        self.appBuild = appBuild
        self.config = config
        self.cases = cases
        self.synced = synced
        self.syncNote = syncNote
    }

    public var summary: TrainingSummary { TrainingSummary(cases) }
}
