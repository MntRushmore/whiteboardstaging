import Foundation

/// A Training Center case saved as a regression test ("Save as regression test"): the page, every
/// line's strokes and what a teacher wants of it, and the recognizer's answers as the bench (or the
/// owner's Pencil) got them. `TrainingFixtureTests` replays every fixture in
/// `Tests/AgathonLiveTests/Fixtures/training/` through the loop with a fake API that answers each
/// read with the recorded one, so no Mathpix is called and the test is the tutor's logic alone.
///
/// `status`: `open` while the tutor still gets it wrong (the test expects the failure, and says so
/// when it starts passing), `fixed` once it is right (then it must stay right).
public struct TrainingFixture: Codable, Sendable, Equatable {
    public struct Line: Codable, Sendable, Equatable {
        public var written: String
        public var expect: TrainingExpect
        public var value: String?
        public var place: TrainingPlace
        public var strokes: [TrainingStroke]
        /// what the tutor read and marked when it was saved
        public var read: String?
        public var mark: TrainingMark
    }

    public struct Settings: Codable, Sendable, Equatable {
        public var mode: String
        public var auto: Bool
        public var checking: String

        public init(mode: String = "feedback", auto: Bool = true, checking: String = CheckTiming.whenDone.rawValue) {
            self.mode = mode
            self.auto = auto
            self.checking = checking
        }
    }

    public var version: Int
    public var id: String
    public var caseKey: String
    public var title: String
    public var status: String
    public var savedAt: Date
    public var kind: TrainingKind
    public var hand: String
    public var category: TrainingCategory
    public var grade: TrainingGrade?
    /// the page's problem (the tutor wrote it at the top); nil: the writer's own page
    public var problem: [String]?
    public var lines: [Line]
    public var reads: [RecordedRead]
    public var solved: Bool?
    public var settings: Settings
    /// why it failed when it was saved
    public var why: String?
    public var note: String?

    public static let currentVersion = 1

    /// The fixture for a case result: each line's expectation is the bench's, or (My Pencil) what the
    /// owner said it should have done (a 👍 keeps the mark it got).
    public init(_ r: TrainingCaseResult, settings: Settings, note: String? = nil) {
        version = Self.currentVersion
        id = r.id.uuidString.lowercased()
        caseKey = r.caseKey
        title = r.problem.isEmpty ? (r.lines.first?.written ?? r.caseKey) : r.problem.joined(separator: " ; ")
        status = "open"
        savedAt = Date()
        kind = r.kind
        hand = r.hand
        category = r.category
        grade = r.grade
        problem = r.problem.isEmpty ? nil : r.problem
        lines = r.lines.enumerated().map { i, l in
            let expect: TrainingExpect
            if let e = l.expect {
                expect = e
            } else if let review = l.review {
                expect = review.expect ?? (review.thumbsUp ? Self.expect(of: l.mark) : .calm)
            } else {
                expect = Self.expect(of: l.mark)
            }
            return Line(written: l.review?.latex ?? l.written, expect: expect, value: l.value, place: l.place,
                        strokes: i < r.strokes.count ? r.strokes[i] : [], read: l.read, mark: l.mark)
        }
        reads = r.reads
        solved = r.solvedExpected
        self.settings = settings
        why = r.firstWhy?.text
        self.note = note
    }

    static func expect(of mark: TrainingMark) -> TrainingExpect {
        switch mark {
        case .tick: return .tick
        case .ring: return .ring
        case .none, .question: return .quiet
        }
    }

    /// The file name the fixture is saved under.
    public var fileName: String {
        let safe = caseKey.map { $0.isLetter || $0.isNumber || $0 == "-" ? $0 : "-" }
        return "\(String(safe).prefix(60))-\(id.prefix(8)).json"
    }

    public static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    public static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    public func encoded() throws -> Data { try Self.encoder.encode(self) }
}

/// A recorded read for a request: the same strokes (the payload the brain builds from the same ink is
/// the same), else the nearest recording of the same shape (a brain that rounds a point differently).
public enum TrainingReplay {
    public static func match(x: [[Double]], y: [[Double]], in reads: [RecordedRead]) -> RecordedRead? {
        if let exact = reads.last(where: { $0.x == x && $0.y == y && $0.latex != nil }) { return exact }
        var best: (RecordedRead, Double)?
        for r in reads where r.latex != nil && r.x.count == x.count {
            guard zip(r.x, x).allSatisfy({ $0.count == $1.count }) else { continue }
            var d = 0.0
            var n = 0
            for (a, b) in zip(r.x, x) { for (p, q) in zip(a, b) { d += abs(p - q); n += 1 } }
            for (a, b) in zip(r.y, y) { for (p, q) in zip(a, b) { d += abs(p - q); n += 1 } }
            let mean = n > 0 ? d / Double(n) : .infinity
            if mean < 2, best == nil || mean < best!.1 { best = (r, mean) }
        }
        return best?.0
    }
}
