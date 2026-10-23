import Foundation

// One SAT question as GET /api/sat/next sends it: a row of `sat_questions`, field for field as the
// web's `SatQuestionSchema` (src/lib/sat/contracts.ts; docs/SAT-MODE.md, "Contract between the
// lanes"). The answer and the solution come with the question (free practice, checked on the iPad).
// Fields the app does not need (`status`, `version`, `created_at`) are read when present.

/// One question of the bank.
public struct SATQuestion: Codable, Hashable, Sendable, Identifiable {
    /// `<domain>-<skill slug>-<nnnn>`, stable forever
    public var id: String
    public var domain: SATDomain
    /// the skill's name exactly as the spec's table writes it ("linear functions")
    public var skill: String
    /// 1 easy, 2 medium, 3 hard
    public var difficulty: Int
    public var format: SATFormat
    /// Markdown with inline `$…$` and display `$$…$$` LaTeX
    public var stem: String
    public var figure: SATFigure?
    /// mcq: A–D in order; spr: nil
    public var choices: [SATChoice]?
    public var answer: SATAnswer
    public var solution: SATSolution
    public var status: String?
    public var version: Int?

    public init(id: String, domain: SATDomain, skill: String, difficulty: Int, format: SATFormat, stem: String, figure: SATFigure? = nil,
                choices: [SATChoice]? = nil, answer: SATAnswer, solution: SATSolution, status: String? = "live", version: Int? = 1) {
        self.id = id
        self.domain = domain
        self.skill = skill
        self.difficulty = difficulty
        self.format = format
        self.stem = stem
        self.figure = figure
        self.choices = choices
        self.answer = answer
        self.solution = solution
        self.status = status
        self.version = version
    }

    enum CodingKeys: String, CodingKey {
        case id, domain, skill, difficulty, format, stem, figure, choices, answer, solution, status, version
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        domain = try c.decode(SATDomain.self, forKey: .domain)
        skill = try c.decode(String.self, forKey: .skill)
        difficulty = (try? c.decode(Int.self, forKey: .difficulty)) ?? 2
        format = try c.decode(SATFormat.self, forKey: .format)
        stem = try c.decode(String.self, forKey: .stem)
        // a figure of a kind this build does not draw is left out, never the whole question
        figure = (try? c.decodeIfPresent(SATFigure.self, forKey: .figure)) ?? nil
        choices = try c.decodeIfPresent([SATChoice].self, forKey: .choices)
        answer = try c.decode(SATAnswer.self, forKey: .answer)
        solution = try c.decode(SATSolution.self, forKey: .solution)
        status = try c.decodeIfPresent(String.self, forKey: .status)
        version = try c.decodeIfPresent(Int.self, forKey: .version)
        if format == .mcq && (choices?.count ?? 0) < 2 {
            throw DecodingError.dataCorruptedError(forKey: .choices, in: c, debugDescription: "an mcq has choices")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(domain, forKey: .domain)
        try c.encode(skill, forKey: .skill)
        try c.encode(difficulty, forKey: .difficulty)
        try c.encode(format, forKey: .format)
        try c.encode(stem, forKey: .stem)
        try c.encode(figure, forKey: .figure)
        try c.encode(choices, forKey: .choices)
        try c.encode(answer, forKey: .answer)
        try c.encode(solution, forKey: .solution)
        try c.encodeIfPresent(status, forKey: .status)
        try c.encodeIfPresent(version, forKey: .version)
    }

    /// The skill's short name for the screens ("Linear functions").
    public var skillTitle: String { SATTaxonomy.title(of: skill) }

    /// The right choice's key (mcq).
    public var rightKey: String? { answer.key }
}

public enum SATFormat: String, Codable, Hashable, Sendable {
    /// four choices, A–D
    case mcq
    /// student-produced response ("grid-in")
    case spr
}

public struct SATChoice: Codable, Hashable, Sendable, Identifiable {
    /// A, B, C or D
    public var key: String
    /// the same Markdown and LaTeX as the stem
    public var text: String

    public var id: String { key }

    public init(key: String, text: String) {
        self.key = key
        self.text = text
    }
}

/// mcq `{"key":"C"}`; spr `{"accepted":["3/4","0.75",".75"]}`: every form a right grid-in could take.
public struct SATAnswer: Codable, Hashable, Sendable {
    public var key: String?
    public var accepted: [String]?

    public init(key: String) {
        self.key = key
        accepted = nil
    }

    public init(accepted: [String]) {
        key = nil
        self.accepted = accepted
    }

    enum CodingKeys: String, CodingKey { case key, accepted }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = try c.decodeIfPresent(String.self, forKey: .key)?.uppercased()
        accepted = try c.decodeIfPresent([String].self, forKey: .accepted)
        if key == nil && (accepted ?? []).isEmpty {
            throw DecodingError.dataCorruptedError(forKey: .key, in: c, debugDescription: "an answer is {key} or {accepted}")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(key, forKey: .key)
        try c.encodeIfPresent(accepted, forKey: .accepted)
    }

    /// How the answer is shown once it is given away: the key, or the first accepted form.
    public var shown: String { key ?? accepted?.first ?? "" }
}

/// 2–6 short steps, and how to do it on the test-day graphing calculator when that really helps.
public struct SATSolution: Codable, Hashable, Sendable {
    public struct Step: Codable, Hashable, Sendable {
        public var text: String
        /// a line of maths under the words (LaTeX), or nil
        public var math: String?

        public init(text: String, math: String? = nil) {
            self.text = text
            self.math = math
        }
    }

    public var steps: [Step]
    public var desmosTip: String?

    public init(steps: [Step], desmosTip: String? = nil) {
        self.steps = steps
        self.desmosTip = desmosTip
    }

    enum CodingKeys: String, CodingKey {
        case steps
        case desmosTip = "desmos_tip"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        steps = try c.decode([Step].self, forKey: .steps)
        desmosTip = try c.decodeIfPresent(String.self, forKey: .desmosTip)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(steps, forKey: .steps)
        try c.encode(desmosTip, forKey: .desmosTip)
    }
}

/// `{questions:[…]}`. A question that does not decode (a figure or field this build cannot read
/// wholesale) is left out, never the whole set.
public struct SATNextReply: Decodable, Sendable {
    public var questions: [SATQuestion]

    enum CodingKeys: String, CodingKey { case questions }

    public init(questions: [SATQuestion]) {
        self.questions = questions
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        questions = try c.decode([Lossy<SATQuestion>].self, forKey: .questions).compactMap(\.value)
    }
}

/// One element that may not decode.
struct Lossy<T: Decodable>: Decodable {
    let value: T?

    init(from decoder: Decoder) throws {
        value = try? T(from: decoder)
    }
}
