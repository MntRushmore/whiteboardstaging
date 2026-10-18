import Foundation

/// The plan the onboarding builds (src/lib/start/plan.ts, and the try board's choice of problem in
/// src/components/start/screens/StartTry.tsx). The same choice decides the first board, so the plan
/// the family saw is the board the kid gets.
public enum Plan {
    /// How many skills the plan screen shows (`PLAN_SKILLS`).
    public static let shownSkills = 3
    /// Today's practice on the plan's card: the try counts as the first.
    public static let todayProblems = 5
    /// The first board's practice problems after the try (`START_PROBLEMS`).
    public static let firstBoardProblems = 4

    /// The skills a family may pick as tricky for this grade or course; [] for none (`focusOptions`).
    public static func focusOptions(_ choice: LevelChoice?, catalog: OnboardingCatalog = .shared) -> [String] {
        switch choice {
        case .grade(let g): catalog.grade(g)?.path ?? []
        case .course(let c): catalog.course(c)?.focus ?? []
        case nil: []
        }
    }

    /// The plan's skills in order: those picked, in teaching order, then the rest of the offer
    /// (`planSkills`).
    public static func skills(_ answers: OnboardingAnswers, catalog: OnboardingCatalog = .shared) -> [String] {
        let offer = focusOptions(answers.choice, catalog: catalog)
        func rank(_ id: String) -> Int { offer.firstIndex(of: id) ?? offer.count }
        var seen = Set<String>()
        let picked = answers.focus.filter { seen.insert($0).inserted }.sorted { rank($0) < rank($1) }
        var out: [String] = []
        for id in picked + offer where !out.contains(id) { out.append(id) }
        return out
    }

    /// The try board's band for a grade or course (`tryBand`).
    public static func band(_ choice: LevelChoice?) -> String {
        switch choice {
        case .course: return "hs"
        case .grade(let g):
            switch g {
            case 0...2: return "k2"
            case 3...5: return "g35"
            default: return "g68"
            }
        case nil: return "g35"
        }
    }

    /// The problems a try can come from, in the order they're offered: the band's starter for the
    /// plan's first skill at the kid's grade first (`tryProblemFor`), then the rest of that grade,
    /// then the rest of the band.
    public static func tryProblems(_ answers: OnboardingAnswers, catalog: OnboardingCatalog = .shared) -> [OnboardingCatalog.Problem] {
        let band = band(answers.choice)
        let list = catalog.problems.filter { $0.band == band }
        let grade = answers.choice?.grade
        let first = skills(answers, catalog: catalog).first
        var ordered: [OnboardingCatalog.Problem] = []
        func add(_ p: OnboardingCatalog.Problem?) { if let p, !ordered.contains(p) { ordered.append(p) } }
        add(list.first { p in first != nil && p.skill == first && (grade == nil || p.grade == grade) })
        for p in list where grade != nil && p.grade == grade { add(p) }
        for p in list { add(p) }
        return ordered
    }

    public struct Shown: Sendable, Equatable {
        public struct Skill: Sendable, Equatable, Identifiable {
            public let id: String
            public let name: String
            public let blurb: String
            public let picked: Bool
        }
        /// "3rd grade", "Algebra 1"; nil with no answer
        public let level: String?
        public let skills: [Skill]
        /// "Something else" or no answer: the plan is the course's starters, not a list of skills
        public var open: Bool { skills.isEmpty }
    }

    /// The plan screen's plan (`buildPlan`).
    public static func shown(_ answers: OnboardingAnswers, catalog: OnboardingCatalog = .shared) -> Shown {
        let picked = Set(answers.focus)
        let list = skills(answers, catalog: catalog).prefix(shownSkills).map { id in
            let w = catalog.words(id)
            return Shown.Skill(id: id, name: w.name, blurb: w.blurb, picked: picked.contains(id))
        }
        return Shown(level: answers.choice?.label(catalog), skills: Array(list))
    }

    /// The skill the first board practises after the try: the plan's first, else the try problem's.
    public static func firstSkill(_ answers: OnboardingAnswers, catalog: OnboardingCatalog = .shared) -> String? {
        skills(answers, catalog: catalog).first ?? answers.tries.first.flatMap { catalog.problem($0.problemId)?.skill }
    }
}
