import Foundation

/// Each grade's skill path, in teaching order: KEEP IN STEP with `GRADE_PATHS` in
/// src/lib/learning/grades.ts (a unit test reads that file and compares). The brain doesn't export
/// the paths yet, so the app carries them; the names are `K8_SKILLS` / `SKILLS`'s.
enum GradePath {
    static let paths: [Int: [String]] = [
        0: ["add_within_10", "subtract_within_10"],
        1: ["add_within_20", "subtract_within_20", "add_tens"],
        2: ["add_within_100", "subtract_within_100", "add_subtract_within_1000"],
        3: ["add_subtract_within_1000", "times_tables", "division_facts", "multiply_by_tens"],
        4: ["multi_digit_add_subtract", "multiply_multi_digit", "long_division", "equivalent_fractions", "add_fractions_like"],
        5: ["add_fractions_unlike", "multiply_fractions", "decimals_add_subtract", "decimals_multiply", "order_of_operations"],
        6: ["divide_fractions", "percents", "negative_numbers", "powers_roots", "one_step_equations", "simplify_expressions"],
        7: ["proportions", "negative_numbers", "two_step_equations", "inequalities", "area_perimeter", "circles"],
        8: ["exponent_rules", "multi_step_equations", "pythagorean", "linear_functions", "systems"],
    ]

    static let names: [String: (name: String, blurb: String?)] = [
        "add_within_10": ("Adding to 10", "Put two small numbers together, like 3 + 4"),
        "subtract_within_10": ("Taking away to 10", "Take some away, like 7 − 2"),
        "add_within_20": ("Adding to 20", "Add facts like 8 + 7"),
        "subtract_within_20": ("Subtracting to 20", "Take-away facts like 15 − 8"),
        "add_tens": ("Adding tens", "Count by tens, like 40 + 30"),
        "add_within_100": ("Adding 2-digit numbers", "Add numbers like 47 + 38"),
        "subtract_within_100": ("Subtracting 2-digit numbers", "Take away numbers like 72 − 35"),
        "add_subtract_within_1000": ("3-digit adding and subtracting", "Bigger sums like 386 + 247"),
        "times_tables": ("Times tables", "Multiply facts like 6 × 7"),
        "division_facts": ("Division facts", "Share equally, like 42 ÷ 6"),
        "multiply_by_tens": ("Multiplying by tens", "Like 4 × 60 = 240"),
        "multi_digit_add_subtract": ("Big adding and subtracting", "4-digit sums like 4386 + 2947"),
        "multiply_multi_digit": ("Multiplying bigger numbers", "Like 46 × 7 and 34 × 26"),
        "long_division": ("Long division", "Like 864 ÷ 4"),
        "equivalent_fractions": ("Equivalent fractions", "Same amount, new numbers: 6/8 = 3/4"),
        "add_fractions_like": ("Adding fractions", "Same bottom number, like 2/7 + 3/7"),
        "add_fractions_unlike": ("Adding unlike fractions", "Different bottoms, like 3/4 + 1/6"),
        "multiply_fractions": ("Multiplying fractions", "Like 2/3 × 3/5"),
        "divide_fractions": ("Dividing fractions", "Flip and multiply: 3/4 ÷ 1/2"),
        "decimals_add_subtract": ("Adding decimals", "Line up the points: 3.45 + 2.8"),
        "decimals_multiply": ("Multiplying decimals", "Like 1.2 × 3"),
        "percents": ("Percents", "A percent of a number, like 25% of 80"),
        "proportions": ("Proportions", "Equal ratios, like x/4 = 9/12"),
        "negative_numbers": ("Negative numbers", nil),
        "order_of_operations": ("Order of operations", nil),
        "powers_roots": ("Powers and square roots", nil),
        "simplify_expressions": ("Simplifying expressions", nil),
        "one_step_equations": ("One-step equations", nil),
        "two_step_equations": ("Two-step equations", nil),
        "multi_step_equations": ("Multi-step equations", nil),
        "inequalities": ("Inequalities", nil),
        "systems": ("Systems of equations", nil),
        "exponent_rules": ("Exponent rules", nil),
        "linear_functions": ("Lines and slope", nil),
        "pythagorean": ("Pythagorean theorem", nil),
        "area_perimeter": ("Area and perimeter", nil),
        "circles": ("Circles", nil),
    ]

    /// A skill's name: the summary's when it has one, else ours, else the id in words.
    static func name(_ id: String, summary: LearningSummary? = nil) -> String {
        if let named = summary?.skills.first(where: { $0.skill == id })?.name, !named.isEmpty { return named }
        if let known = names[id]?.name { return known }
        return id.replacingOccurrences(of: "_", with: " ").capitalized
    }

    /// "Kindergarten", "3rd grade".
    static func gradeName(_ grade: Int) -> String {
        switch grade {
        case 0: return "Kindergarten"
        case 1: return "1st grade"
        case 2: return "2nd grade"
        case 3: return "3rd grade"
        default: return "\(grade)th grade"
        }
    }

    /// "Your 3rd grade path" / "Your Kindergarten path".
    static func title(_ grade: Int) -> String { "Your \(gradeName(grade)) path" }

    /// The next stop (`nextStepIndex`, src/lib/path/nextStep.ts): the first skill not mastered,
    /// except a never-tried skill before one already almost there or mastered. -1: all mastered.
    static func nextIndex(_ levels: [String]) -> Int {
        var reach = -1
        for (i, level) in levels.enumerated() where level == "almost" || level == "mastered" { reach = i }
        if let ahead = levels.enumerated().first(where: { i, level in level != "mastered" && !(level == "new" && i < reach) })?.offset {
            return ahead
        }
        return levels.firstIndex { $0 != "mastered" } ?? -1
    }

    /// LEVEL_LABELS.
    static func levelLabel(_ level: String) -> String {
        switch level {
        case "practicing": return "Practicing"
        case "almost": return "Almost there"
        case "mastered": return "Mastered"
        default: return "New"
        }
    }

    /// LEVEL_STARS: new 0, practicing 1, almost 2, mastered 3.
    static func stars(_ level: String) -> Int {
        switch level {
        case "practicing": return 1
        case "almost": return 2
        case "mastered": return 3
        default: return 0
        }
    }
}

/// A grade's path as Home and Progress draw it.
struct PathView: Equatable {
    struct Stop: Equatable, Identifiable {
        enum State: Equatable { case done, current, upcoming }
        let id: String
        let name: String
        let level: String
        let state: State
    }

    let grade: Int
    let stops: [Stop]

    var doneCount: Int { stops.filter { $0.state == .done }.count }
    var next: Stop? { stops.first { $0.state == .current } }

    init(grade: Int, summary: LearningSummary?) {
        self.grade = grade
        let ids = GradePath.paths[grade] ?? []
        let levels = ids.map { id in summary?.skills.first { $0.skill == id }?.level ?? "new" }
        let next = GradePath.nextIndex(levels)
        stops = ids.enumerated().map { i, id in
            let level = levels[i]
            let state: Stop.State = level == "mastered" ? .done : (i == next ? .current : .upcoming)
            return Stop(id: id, name: GradePath.name(id, summary: summary), level: level, state: state)
        }
    }
}
