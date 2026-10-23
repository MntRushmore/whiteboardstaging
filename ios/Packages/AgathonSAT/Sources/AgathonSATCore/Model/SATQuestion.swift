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
    // v2 (docs/SAT-V2.md, "Bank additions"): all optional, a bank without them is v1's
    /// the ink hint ladder's first rung: one short question or pointer, never the answer
    public var nudge: String?
    /// spr: likely wrong answers and the mistake that gives each (0–3)
    public var commonWrong: [SATCommonWrong]?
    /// the mistake deck brought it back: a review of a question missed before
    public var review: Bool

    public init(id: String, domain: SATDomain, skill: String, difficulty: Int, format: SATFormat, stem: String, figure: SATFigure? = nil,
                choices: [SATChoice]? = nil, answer: SATAnswer, solution: SATSolution, status: String? = "live", version: Int? = 1,
                nudge: String? = nil, commonWrong: [SATCommonWrong]? = nil, review: Bool = false) {
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
        self.nudge = nudge
        self.commonWrong = commonWrong
        self.review = review
    }

    enum CodingKeys: String, CodingKey {
        case id, domain, skill, difficulty, format, stem, figure, choices, answer, solution, status, version, nudge, review
        case commonWrong = "common_wrong"
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
        // the v2 fields: a malformed one is left out, never the question
        nudge = ((try? c.decodeIfPresent(String.self, forKey: .nudge)) ?? nil).flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 }
        commonWrong = ((try? c.decodeIfPresent([Lossy<SATCommonWrong>].self, forKey: .commonWrong)) ?? nil)?.compactMap(\.value)
        review = ((try? c.decodeIfPresent(Bool.self, forKey: .review)) ?? nil) ?? false
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
        try c.encodeIfPresent(nudge, forKey: .nudge)
        try c.encodeIfPresent(commonWrong, forKey: .commonWrong)
        if review { try c.encode(true, forKey: .review) }
    }

    /// The note for a wrong grid-in: the bank's common wrong answer it matches (by value: `6/8` is `3/4`).
    public func commonWrongNote(for typed: String) -> SATCommonWrong? {
        commonWrong?.first { SATGridIn.isCorrect(typed, accepted: [$0.answer]) }
    }

    /// The note for a wrong choice: why someone picks it.
    public func why(_ key: String) -> String? {
        choices?.first { $0.key == key }?.why.flatMap { $0.isEmpty ? nil : $0 }
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
    /// a wrong choice: the mistake that really produces it ("Swapped rise and run"), ≤ 140 characters
    public var why: String?

    public var id: String { key }

    public init(key: String, text: String, why: String? = nil) {
        self.key = key
        self.text = text
        self.why = why
    }

    enum CodingKeys: String, CodingKey { case key, text, why }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = try c.decode(String.self, forKey: .key)
        text = try c.decode(String.self, forKey: .text)
        why = (try? c.decodeIfPresent(String.self, forKey: .why)) ?? nil
    }
}

/// A likely wrong grid-in and the mistake that gives it (`common_wrong`, spr only).
public struct SATCommonWrong: Codable, Hashable, Sendable {
    public var answer: String
    public var why: String

    public init(answer: String, why: String) {
        self.answer = answer
        self.why = why
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
    /// "Two ways" (v2): the same question on Desmos, step by step; nil when there is no Desmos way
    public var desmosSteps: [Step]?

    public init(steps: [Step], desmosTip: String? = nil, desmosSteps: [Step]? = nil) {
        self.steps = steps
        self.desmosTip = desmosTip
        self.desmosSteps = desmosSteps
    }

    enum CodingKeys: String, CodingKey {
        case steps
        case desmosTip = "desmos_tip"
        case desmosSteps = "desmos_steps"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        steps = try c.decode([Step].self, forKey: .steps)
        desmosTip = try c.decodeIfPresent(String.self, forKey: .desmosTip)
        let desmos = ((try? c.decodeIfPresent([Lossy<Step>].self, forKey: .desmosSteps)) ?? nil)?.compactMap(\.value)
        desmosSteps = desmos?.isEmpty == false ? desmos : nil
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(steps, forKey: .steps)
        try c.encode(desmosTip, forKey: .desmosTip)
        try c.encodeIfPresent(desmosSteps, forKey: .desmosSteps)
    }

    /// The solution has a Desmos way (the "Two ways" view).
    public var hasDesmosWay: Bool { !(desmosSteps ?? []).isEmpty }
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
