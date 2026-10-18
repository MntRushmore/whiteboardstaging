import Foundation

/// Who is holding the iPad (the web contract's names: `StartRole`).
public enum OnboardingRole: String, Codable, Sendable, CaseIterable {
    /// a grown-up setting it up for a kid
    case parent
    /// the kid on their own
    case kid
}

/// A grade (Kindergarten to 8th) or a high-school course ("Something else" included): the web's
/// `WelcomeChoice`.
public enum LevelChoice: Codable, Sendable, Hashable {
    case grade(Int)
    case course(String)

    public var grade: Int? { if case .grade(let g) = self { g } else { nil } }
    public var course: String? { if case .course(let c) = self { c } else { nil } }

    /// "3rd grade", "Algebra 1"
    public func label(_ catalog: OnboardingCatalog = .shared) -> String? {
        switch self {
        case .grade(let g): catalog.grade(g)?.label
        case .course(let c): catalog.course(c)?.label
        }
    }

    /// save_onboarding's arguments (the web's `choiceSave`): a grade is the course "other" plus the
    /// grade; a course is the course alone, which clears any grade.
    public var saved: (course: String, grade: Int?) {
        switch self {
        case .grade(let g): ("other", g)
        case .course(let c): (c, nil)
        }
    }
}

/// One problem tried before the account: kept on the iPad so the first board can show it.
public struct TryRecord: Codable, Sendable, Equatable {
    public var problemId: String
    /// the tutor's last verdict on it (`TryVerdict.rawValue`), nil while unchecked
    public var verdict: String?
    /// what the reader saw
    public var latex: String?
    /// the kid's strokes, page coordinates: each point `[x, y, pressure]`
    public var strokes: [[[Double]]]
    /// the strokes of the line the tutor ticked (what the first board carries over)
    public var answerStrokes: [[[Double]]]?
    /// answered with "Type it instead"
    public var typed: Bool
    /// pen lift to the tick, ms
    public var ms: Int?
    /// rings before it was solved (a hint was given)
    public var rings: Int
    /// "Help me" wrote a step
    public var helped: Bool
    public var startedAt: Date

    public init(problemId: String, startedAt: Date = Date()) {
        self.problemId = problemId
        verdict = nil
        latex = nil
        strokes = []
        answerStrokes = nil
        typed = false
        ms = nil
        rings = 0
        helped = false
        self.startedAt = startedAt
    }

    public var solved: Bool { verdict == TryVerdict.solved.rawValue }
    public var checked: Bool { verdict == TryVerdict.check.rawValue || solved }
}

/// The colour of the kid's picture until the 12 pictures are drawn in Blocks shapes
/// (docs/ONBOARDING.md, `kidProfile`): the kid's initial on one of five flat colours, never cobalt.
/// Stored on the server as one of the family's picture ids (`AVATARS`).
public enum KidPicture: String, Codable, Sendable, CaseIterable, Identifiable {
    case tomato, sunny, green, pink, ink

    public var id: String { rawValue }

    /// The family picture id it is saved as (src/lib/family/contracts.ts `AVATARS`).
    public var avatarId: String {
        switch self {
        case .tomato: "fox"
        case .sunny: "lion"
        case .green: "frog"
        case .pink: "unicorn"
        case .ink: "penguin"
        }
    }

    public var name: String {
        switch self {
        case .tomato: "Tomato"
        case .sunny: "Sunny"
        case .green: "Green"
        case .pink: "Pink"
        case .ink: "Ink"
        }
    }
}

/// Everything the family answered, kept on the iPad (7 days) until the account exists.
public struct OnboardingAnswers: Codable, Sendable, Equatable {
    public var role: OnboardingRole?
    /// the kid's first name, trimmed; nil when skipped. **On the iPad only** until the account.
    public var name: String?
    public var choice: LevelChoice?
    /// up to 3 skills, in the order picked; [] for "Not sure"
    public var focus: [String]
    /// what happened on the try board, merged upward (`chooseTried`)
    public var tried: Tried?
    /// "How did you hear about Agathon?"
    public var heardFrom: String?
    /// the problems tried (at most `FlowRules.maxTries`)
    public var tries: [TryRecord]
    public var picture: KidPicture?

    public struct Tried: Codable, Sendable, Equatable {
        public var checked: Bool
        public var solved: Bool
    }

    public init(role: OnboardingRole? = nil, name: String? = nil, choice: LevelChoice? = nil, focus: [String] = [],
                tried: Tried? = nil, heardFrom: String? = nil, tries: [TryRecord] = [], picture: KidPicture? = nil) {
        self.role = role
        self.name = name
        self.choice = choice
        self.focus = focus
        self.tried = tried
        self.heardFrom = heardFrom
        self.tries = tries
        self.picture = picture
    }

    public static let empty = OnboardingAnswers()
}

// MARK: - The answers' reducers (src/lib/start/flow.ts)

extension OnboardingAnswers {
    /// A first name as a kid types it (`KID_NAME`): letters, spaces, hyphens and apostrophes, at most
    /// 24, starting with a letter.
    static let kidName = try! NSRegularExpression(pattern: #"^[\p{L}][\p{L}\p{M}' -]{0,23}$"#)

    /// A typed first name: trimmed and inner spaces closed up; "" when empty; nil when not a first
    /// name (`cleanName`). Curly apostrophes count as apostrophes.
    public static func cleanName(_ raw: String) -> String? {
        let name = raw
            .replacingOccurrences(of: "\u{2019}", with: "'")
            .split(whereSeparator: \.isWhitespace).joined(separator: " ")
        if name.isEmpty { return "" }
        let range = NSRange(name.startIndex..., in: name)
        return kidName.firstMatch(in: name, range: range) != nil ? name : nil
    }

    public func choosing(role: OnboardingRole) -> OnboardingAnswers {
        var a = self
        a.role = role
        return a
    }

    public func choosing(name: String?) -> OnboardingAnswers {
        var a = self
        a.name = (name?.isEmpty ?? true) ? nil : name
        return a
    }

    /// A new grade or course keeps only the picks it still offers (`chooseLevel`).
    public func choosing(level: LevelChoice, catalog: OnboardingCatalog = .shared) -> OnboardingAnswers {
        var a = self
        a.choice = level
        let offered = Set(Plan.focusOptions(level, catalog: catalog))
        a.focus = focus.filter { offered.contains($0) }
        return a
    }

    /// Tap a skill: on, or off; at most `maxFocus`, in the order picked (`toggleFocus`).
    public func toggling(skill: String, max: Int = OnboardingCatalog.shared.maxFocus) -> OnboardingAnswers {
        var a = self
        if let at = focus.firstIndex(of: skill) {
            a.focus.remove(at: at)
        } else if focus.count < max {
            a.focus.append(skill)
        }
        return a
    }

    public func notSure() -> OnboardingAnswers {
        var a = self
        a.focus = []
        return a
    }

    /// What happened on the try board, merged upward: a solved try stays solved (`chooseTried`).
    public func trying(checked: Bool, solved: Bool) -> OnboardingAnswers {
        var a = self
        a.tried = Tried(checked: checked || (tried?.checked ?? false), solved: solved || (tried?.solved ?? false))
        return a
    }
}
