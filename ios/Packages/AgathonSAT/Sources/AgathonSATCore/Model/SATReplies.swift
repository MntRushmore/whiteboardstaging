import Foundation

// The routes' other bodies (docs/SAT-MODE.md, "Routes"; the web's `SatTutorResponse`,
// `SatProgressResponse` and `SatAttemptRequestSchema`). Replies decode leniently: a field the server
// leaves out takes its empty value, so an older or newer server never stops the screen.

/// POST /api/sat/attempts: one checked answer.
public struct SATAttempt: Codable, Hashable, Sendable {
    public var questionId: String
    /// "B", or the grid-in as typed
    public var chosen: String
    public var correct: Bool
    public var seconds: Int
    public var usedTutor: Bool

    public init(questionId: String, chosen: String, correct: Bool, seconds: Int, usedTutor: Bool) {
        self.questionId = questionId
        self.chosen = chosen
        self.correct = correct
        self.seconds = seconds
        self.usedTutor = usedTutor
    }

    enum CodingKeys: String, CodingKey {
        case questionId = "question_id"
        case chosen, correct, seconds
        case usedTutor = "used_tutor"
    }
}

/// POST /api/sat/attempts' answer: `{ok, correct}`, the server's own verdict from the bank's answer
/// (it stores that, whatever the app sent; docs/SAT-MODE.md "Route details").
public struct SATAttemptReply: Codable, Hashable, Sendable {
    public var ok: Bool
    public var correct: Bool?

    public init(ok: Bool = true, correct: Bool? = nil) {
        self.ok = ok
        self.correct = correct
    }

    enum CodingKeys: String, CodingKey { case ok, correct }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ok = try c.decodeIfPresent(Bool.self, forKey: .ok) ?? true
        correct = try c.decodeIfPresent(Bool.self, forKey: .correct)
    }
}

/// POST /api/sat/tutor's answer: may the live tutor help on this question today.
public struct SATTutorPass: Codable, Hashable, Sendable {
    public var allowed: Bool
    /// free tutor questions used today (this one included when it was just allowed)
    public var usedToday: Int
    public var cap: Int
    public var unlimited: Bool

    public init(allowed: Bool, usedToday: Int, cap: Int, unlimited: Bool) {
        self.allowed = allowed
        self.usedToday = usedToday
        self.cap = cap
        self.unlimited = unlimited
    }

    enum CodingKeys: String, CodingKey {
        case allowed
        case usedToday = "used_today"
        case cap, unlimited
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        allowed = try c.decode(Bool.self, forKey: .allowed)
        usedToday = try c.decodeIfPresent(Int.self, forKey: .usedToday) ?? 0
        cap = try c.decodeIfPresent(Int.self, forKey: .cap) ?? SATLimits.freeTutorPerDay
        unlimited = try c.decodeIfPresent(Bool.self, forKey: .unlimited) ?? false
    }

    /// Free tutor questions left today (nil with Unlimited).
    public var left: Int? { unlimited ? nil : max(0, cap - usedToday) }
}

/// GET /api/sat/progress's answer.
public struct SATProgress: Codable, Hashable, Sendable {
    public struct Count: Codable, Hashable, Sendable {
        public var answered: Int
        public var correct: Int

        public init(answered: Int, correct: Int) {
            self.answered = answered
            self.correct = correct
        }

        /// right / answered, 0 when nothing was answered
        public var share: Double { answered > 0 ? Double(correct) / Double(answered) : 0 }
    }

    public struct DomainCount: Codable, Hashable, Sendable {
        public var domain: SATDomain
        public var answered: Int
        public var correct: Int

        public init(domain: SATDomain, answered: Int, correct: Int) {
            self.domain = domain
            self.answered = answered
            self.correct = correct
        }

        public var count: Count { Count(answered: answered, correct: correct) }
    }

    public struct SkillCount: Codable, Hashable, Sendable {
        public var domain: SATDomain?
        public var skill: String
        public var answered: Int
        public var correct: Int

        public init(domain: SATDomain?, skill: String, answered: Int, correct: Int) {
            self.domain = domain
            self.skill = skill
            self.answered = answered
            self.correct = correct
        }

        public var count: Count { Count(answered: answered, correct: correct) }
    }

    public struct Today: Codable, Hashable, Sendable {
        public var answered: Int
        public var tutorUsed: Int
        public var cap: Int
        public var unlimited: Bool
        /// right today (v2, optional: nil from a server without it)
        public var correct: Int?

        public init(answered: Int, tutorUsed: Int, cap: Int, unlimited: Bool, correct: Int? = nil) {
            self.correct = correct
            self.answered = answered
            self.tutorUsed = tutorUsed
            self.cap = cap
            self.unlimited = unlimited
        }

        enum CodingKeys: String, CodingKey {
            case answered
            case tutorUsed = "tutor_used"
            case cap, unlimited, correct
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            answered = try c.decodeIfPresent(Int.self, forKey: .answered) ?? 0
            tutorUsed = try c.decodeIfPresent(Int.self, forKey: .tutorUsed) ?? 0
            cap = try c.decodeIfPresent(Int.self, forKey: .cap) ?? SATLimits.freeTutorPerDay
            unlimited = try c.decodeIfPresent(Bool.self, forKey: .unlimited) ?? false
            correct = (try? c.decodeIfPresent(Int.self, forKey: .correct)) ?? nil
        }

        /// Free tutor questions left today (nil with Unlimited).
        public var tutorLeft: Int? { unlimited ? nil : max(0, cap - tutorUsed) }
    }

    /// A rough 200–800 band from practice: never a score.
    public struct Estimate: Codable, Hashable, Sendable {
        public var low: Int
        public var high: Int
        /// the server's own words about what it is based on, when it sends them
        public var note: String?

        public init(low: Int, high: Int, note: String? = nil) {
            self.low = low
            self.high = high
            self.note = note
        }
    }

    public var answered: Int
    public var correct: Int
    public var byDomain: [DomainCount]
    public var bySkill: [SkillCount]
    public var streakDays: Int
    public var today: Today
    /// nil until 15 questions are answered
    public var estimate: Estimate?
    /// the mistake deck (v2, docs/SAT-V2.md): reviews due today, and waiting for a later day (nil:
    /// a server without the deck)
    public var reviewsDue: Int?
    public var reviewsWaiting: Int?
    /// the skills of the reviews due today, the soonest first (v2, optional): the deck's cards name them
    public var reviewsDueSkills: [String]?

    public init(answered: Int = 0, correct: Int = 0, byDomain: [DomainCount] = [], bySkill: [SkillCount] = [], streakDays: Int = 0,
                today: Today = Today(answered: 0, tutorUsed: 0, cap: SATLimits.freeTutorPerDay, unlimited: false), estimate: Estimate? = nil,
                reviewsDue: Int? = nil, reviewsWaiting: Int? = nil, reviewsDueSkills: [String]? = nil) {
        self.reviewsDueSkills = reviewsDueSkills
        self.reviewsDue = reviewsDue
        self.reviewsWaiting = reviewsWaiting
        self.answered = answered
        self.correct = correct
        self.byDomain = byDomain
        self.bySkill = bySkill
        self.streakDays = streakDays
        self.today = today
        self.estimate = estimate
    }

    enum CodingKeys: String, CodingKey {
        case answered, correct
        case byDomain = "by_domain"
        case bySkill = "by_skill"
        case streakDays = "streak_days"
        case today, estimate
        case reviewsDue = "reviews_due"
        case reviewsWaiting = "reviews_waiting"
        case reviewsDueSkills = "reviews_due_skills"
    }

    /// A skill of a due review: its name, or `{"skill": name}`.
    struct DueSkill: Decodable {
        let name: String?
        enum K: String, CodingKey { case skill }
        init(from decoder: Decoder) throws {
            if let s = try? decoder.singleValueContainer().decode(String.self) {
                name = s
            } else {
                name = try? decoder.container(keyedBy: K.self).decode(String.self, forKey: .skill)
            }
        }
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        answered = try c.decodeIfPresent(Int.self, forKey: .answered) ?? 0
        correct = try c.decodeIfPresent(Int.self, forKey: .correct) ?? 0
        byDomain = (try? c.decodeIfPresent([Lossy<DomainCount>].self, forKey: .byDomain))?.compactMap(\.value) ?? []
        bySkill = (try? c.decodeIfPresent([Lossy<SkillCount>].self, forKey: .bySkill))?.compactMap(\.value) ?? []
        streakDays = try c.decodeIfPresent(Int.self, forKey: .streakDays) ?? 0
        today = try c.decodeIfPresent(Today.self, forKey: .today) ?? Today(answered: 0, tutorUsed: 0, cap: SATLimits.freeTutorPerDay, unlimited: false)
        estimate = try? c.decodeIfPresent(Estimate.self, forKey: .estimate)
        reviewsDue = (try? c.decodeIfPresent(Int.self, forKey: .reviewsDue)) ?? nil
        reviewsWaiting = (try? c.decodeIfPresent(Int.self, forKey: .reviewsWaiting)) ?? nil
        reviewsDueSkills = ((try? c.decodeIfPresent([Lossy<DueSkill>].self, forKey: .reviewsDueSkills)) ?? nil)?.compactMap { $0.value?.name }
    }

    /// A domain's count (zero when none answered).
    public func count(_ domain: SATDomain) -> Count {
        byDomain.first { $0.domain == domain }?.count ?? Count(answered: 0, correct: 0)
    }

    /// A skill's count (zero when none answered).
    public func count(skill: String) -> Count {
        bySkill.first { $0.skill == skill }?.count ?? Count(answered: 0, correct: 0)
    }
}

/// The contract's numbers (the web's `SAT_LIMITS`).
public enum SATLimits {
    /// `SAT_FREE_TUTOR_PER_DAY`'s default
    public static let freeTutorPerDay = 5
    /// a set of practice
    public static let setSize = 10
    /// no estimate before this many answers
    public static let estimateMinAnswered = 15
    /// a positive grid-in fills at most 5 characters, a negative one 6 (with its minus)
    public static let sprMaxPositive = 5
    public static let sprMaxNegative = 6
}
