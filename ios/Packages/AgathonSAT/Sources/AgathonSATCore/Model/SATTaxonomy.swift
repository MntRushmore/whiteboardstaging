import Foundation

/// The SAT math section's four domains (docs/SAT-MODE.md, "The SAT math we mirror").
public enum SATDomain: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case algebra
    case advancedMath = "advanced_math"
    case psda
    case geometryTrig = "geometry_trig"

    public var id: String { rawValue }

    /// The domain's name as the test's own score report writes it.
    public var title: String {
        switch self {
        case .algebra: "Algebra"
        case .advancedMath: "Advanced Math"
        case .psda: "Problem-Solving and Data Analysis"
        case .geometryTrig: "Geometry and Trigonometry"
        }
    }

    /// A shorter name where room is tight (a chip, a narrow column).
    public var shortTitle: String {
        switch self {
        case .algebra: "Algebra"
        case .advancedMath: "Advanced Math"
        case .psda: "Data Analysis"
        case .geometryTrig: "Geometry and Trig"
        }
    }

    /// About how much of the section it is.
    public var share: Double {
        switch self {
        case .algebra, .advancedMath: 0.35
        case .psda, .geometryTrig: 0.15
        }
    }
}

/// The skills, named exactly as the spec's table (the `skill` column, the web's `SAT_SKILLS`), with
/// the slug question ids use and the short title the screens show.
public enum SATTaxonomy {
    public struct Skill: Hashable, Sendable, Identifiable {
        /// the name as the bank stores it
        public let name: String
        /// `<domain>-<slug>-<nnnn>`
        public let slug: String
        /// what the screens say ("Linear functions", "Q3 · Linear functions")
        public let title: String
        public let domain: SATDomain

        public var id: String { name }
    }

    public static let skills: [Skill] = [
        Skill(name: "linear equations in one variable", slug: "linear-one-var", title: "Linear equations in one variable", domain: .algebra),
        Skill(name: "linear equations in two variables", slug: "linear-two-var", title: "Linear equations in two variables", domain: .algebra),
        Skill(name: "linear functions", slug: "linear-functions", title: "Linear functions", domain: .algebra),
        Skill(name: "systems of two linear equations", slug: "linear-systems", title: "Systems of linear equations", domain: .algebra),
        Skill(name: "linear inequalities", slug: "linear-inequalities", title: "Linear inequalities", domain: .algebra),
        Skill(name: "equivalent expressions", slug: "equivalent-expressions", title: "Equivalent expressions", domain: .advancedMath),
        Skill(name: "nonlinear equations and systems", slug: "nonlinear-equations", title: "Nonlinear equations", domain: .advancedMath),
        Skill(name: "nonlinear functions", slug: "nonlinear-functions", title: "Nonlinear functions", domain: .advancedMath),
        Skill(name: "ratios, rates, proportions, units", slug: "ratios-rates", title: "Ratios, rates and units", domain: .psda),
        Skill(name: "percentages", slug: "percentages", title: "Percentages", domain: .psda),
        Skill(name: "one-variable data (distributions, centre, spread)", slug: "one-var-data", title: "One-variable data", domain: .psda),
        Skill(name: "two-variable data (models, scatterplots)", slug: "two-var-data", title: "Two-variable data", domain: .psda),
        Skill(name: "probability", slug: "probability", title: "Probability", domain: .psda),
        Skill(name: "inference from samples and margin of error", slug: "inference", title: "Samples and margin of error", domain: .psda),
        Skill(name: "evaluating statistical claims", slug: "statistical-claims", title: "Statistical claims", domain: .psda),
        Skill(name: "area and volume", slug: "area-volume", title: "Area and volume", domain: .geometryTrig),
        Skill(name: "lines, angles, triangles", slug: "lines-angles-triangles", title: "Lines, angles and triangles", domain: .geometryTrig),
        Skill(name: "right triangles and trigonometry", slug: "right-triangles-trig", title: "Right triangles and trig", domain: .geometryTrig),
        Skill(name: "circles", slug: "circles", title: "Circles", domain: .geometryTrig),
    ]

    /// A domain's skills in table order.
    public static func skills(in domain: SATDomain) -> [Skill] {
        skills.filter { $0.domain == domain }
    }

    public static func skill(named name: String) -> Skill? {
        skills.first { $0.name == name }
    }

    /// The short title of a skill; a name this build does not know, capitalised.
    public static func title(of name: String) -> String {
        if let s = skill(named: name) { return s.title }
        guard let first = name.first else { return name }
        return first.uppercased() + name.dropFirst()
    }
}
