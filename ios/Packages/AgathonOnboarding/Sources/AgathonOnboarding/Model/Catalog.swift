import Foundation

/// Every word and number the web's /start reads from TypeScript, as the app ships it:
/// `Resources/onboarding-catalog.json`, written by `node scripts/build-onboarding-catalog.mjs` from
/// the sources themselves (grades and paths, courses, skills and their examples, the try board's
/// problems, "How did you hear about Agathon?"). `--check` fails when it drifts.
public struct OnboardingCatalog: Decodable, Sendable {
    public struct Grade: Decodable, Sendable, Hashable, Identifiable {
        /// 0 (Kindergarten) to 8
        public let id: Int
        /// "Kindergarten", "3rd grade"
        public let label: String
        /// "K", "3rd"
        public let short: String
        /// the grade's skill path, in teaching order
        public let path: [String]
    }

    public struct Course: Decodable, Sendable, Hashable, Identifiable {
        /// "algebra1"…, "other"
        public let id: String
        public let label: String
        public let blurb: String
        /// the course's tricky list (`COURSE_FOCUS`)
        public let focus: [String]
    }

    public struct Skill: Decodable, Sendable, Hashable {
        /// "Times tables"
        public let name: String
        /// "Multiply facts like 6 × 7"
        public let blurb: String
        /// the example the tutor writes on the skill's card (LaTeX lines)
        public let example: [String]
    }

    /// One problem of the try board (`TRY_PROBLEMS`): the server looks it up by `id`.
    public struct Problem: Decodable, Sendable, Hashable, Identifiable {
        public let id: String
        /// "k2", "g35", "g68", "hs"
        public let band: String
        /// the problem as the tutor writes it (LaTeX)
        public let lines: [String]
        /// a nudge in words after a ring
        public let hint: String
        /// the first right step is the answer
        public let oneStep: Bool
        /// a right first step (the answer itself when `oneStep`)
        public let firstStep: String
        public let grade: Int?
        public let skill: String?
    }

    public struct Option: Decodable, Sendable, Hashable, Identifiable {
        public let id: String
        public let label: String
    }

    public let version: Int
    public let maxFocus: Int
    public let maxKids: Int
    public let grades: [Grade]
    public let courses: [Course]
    public let somethingElse: Course
    public let skills: [String: Skill]
    public let problems: [Problem]
    public let heardFrom: [Option]
    /// the family's picture ids (`AVATARS`)
    public let avatars: [String]

    /// The catalogue in the app.
    public static let shared: OnboardingCatalog = {
        guard let url = Bundle.module.url(forResource: "onboarding-catalog", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let catalog = try? JSONDecoder().decode(OnboardingCatalog.self, from: data)
        else {
            // The file ships inside the package; a build without it is a broken build.
            preconditionFailure("onboarding-catalog.json is missing or unreadable (run node scripts/build-onboarding-catalog.mjs)")
        }
        return catalog
    }()

    public func grade(_ id: Int) -> Grade? { grades.first { $0.id == id } }
    public func course(_ id: String) -> Course? { id == somethingElse.id ? somethingElse : courses.first { $0.id == id } }
    public func problem(_ id: String) -> Problem? { problems.first { $0.id == id } }

    /// A skill's words; its id when the catalogue has none (never empty).
    public func words(_ skill: String) -> Skill {
        skills[skill] ?? Skill(name: skill.replacingOccurrences(of: "_", with: " ").capitalized, blurb: "", example: [])
    }
}
