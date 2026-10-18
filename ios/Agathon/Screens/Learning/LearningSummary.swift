import AgathonBrain
import AgathonKit
import Foundation

/// The brain's `LearningSummary` (src/lib/learning/contracts.ts), decoded for the screens: what the
/// student did, day by day and skill by skill. Made by `LearningLoader.summary`.
struct LearningSummary: Decodable, Equatable {
    struct Totals: Decodable, Equatable {
        var problems: Int
        var independent: Int
        var withHelp: Int
        var tutorSolved: Int
        var activeMs: Double
    }

    struct Day: Decodable, Equatable {
        var date: String
        var problems: Int
        var activeMs: Double
    }

    struct Skill: Decodable, Equatable, Identifiable {
        var skill: String
        var name: String
        var area: String?
        /// new, practicing, almost, mastered
        var level: String
        var score: Double
        var attempts: Int
        var independent: Int
        var lastAt: String?
        var id: String { skill }
    }

    struct Mistake: Decodable, Equatable {
        var kind: String
        var count: Int
    }

    struct Recent: Decodable, Equatable, Identifiable {
        var id: String
        var boardId: String?
        var problemLatex: String
        var skill: String
        var outcome: String
        var startedAt: String
    }

    var totals: Totals
    var days: [Day]
    var streakDays: Int
    var skills: [Skill]
    var weakSkills: [String]
    var strongSkills: [String]
    var mistakes: [Mistake]
    var recent: [Recent]

    static let empty = LearningSummary(totals: Totals(problems: 0, independent: 0, withHelp: 0, tutorSolved: 0, activeMs: 0),
                                       days: [], streakDays: 0, skills: [], weakSkills: [], strongSkills: [], mistakes: [], recent: [])
}

/// Reads the learning record and runs the brain's summary on it, off the main thread.
enum LearningLoader {
    /// The student's summary: their attempts (120 days) through `progressSummary`, with the grade's
    /// path skills included (as `new` until tried).
    @MainActor
    static func summary(backend: AgathonBackend, grade: Int?, course: String?) async throws -> LearningSummary {
        let learning = LearningRepository(client: backend.supabase)
        let attempts = try await learning.attempts()
        return try await summarize(attempts, grade: grade, course: course)
    }

    static func summarize(_ attempts: [AttemptRecord], grade: Int?, course: String?, now: Date = Date()) async throws -> LearningSummary {
        let json = try JSONEncoder().encode(attempts)
        let values = try JSONDecoder().decode([AgathonBrain.JSONValue].self, from: json)
        let brain = Brain.shared
        try await brain.load()
        let result = try await brain.progressSummary(attempts: values, now: now,
                                                     tzOffsetMinutes: FamilyService.tzOffset(.current, at: now),
                                                     course: course, grade: grade)
        let data = try JSONEncoder().encode(result.summary)
        return try JSONDecoder().decode(LearningSummary.self, from: data)
    }
}

/// Today's five problems, from the brain's practice generator: two on the next skill, two on a
/// weak one, one review (the web's DAILY_MIX; `planDailySet` itself isn't in the brain yet). Same
/// student, same day: same problems.
enum PracticePlanner {
    struct Problem: Equatable, Identifiable {
        let id: Int
        let skill: String
        /// LaTeX lines (one for most, 2–3 for a system).
        let lines: [String]
    }

    static func seed(_ text: String) -> Int {
        // FNV-1a: stable across launches (Swift's hashValue is not).
        var hash: UInt32 = 2_166_136_261
        for byte in text.utf8 {
            hash ^= UInt32(byte)
            hash = hash &* 16_777_619
        }
        return Int(hash & 0x7FFF_FFFF)
    }

    /// The skills for a day's set: next ×2, weak ×2, review ×1, falling back to the next skill.
    static func mix(path: PathView?, summary: LearningSummary?) -> [String] {
        let next = path?.next?.id ?? summary?.weakSkills.first ?? path?.stops.first?.id ?? "add_within_20"
        let weak = summary?.weakSkills.first { $0 != next } ?? next
        let review = summary?.strongSkills.first ?? path?.stops.last { $0.state == .done }?.id ?? next
        return [next, next, weak, weak, review]
    }

    static func daily(day: String, userId: String, path: PathView?, summary: LearningSummary?) async -> [Problem] {
        let skills = mix(path: path, summary: summary)
        var problems: [Problem] = []
        let brain = Brain.shared
        do {
            try await brain.load()
        } catch {
            return []
        }
        var used = Set<[String]>()
        for (i, skill) in skills.enumerated() {
            let made = (try? await brain.practice(skill: skill, count: 3, seed: seed("\(userId)|\(day)|\(i)"))) ?? []
            if let lines = made.first(where: { !used.contains($0) }) ?? made.first {
                used.insert(lines)
                problems.append(Problem(id: i, skill: skill, lines: lines))
            }
        }
        return problems
    }

    static func topic(_ skill: String, seed: Int, count: Int = 4) async -> [Problem] {
        let brain = Brain.shared
        guard (try? await brain.load()) != nil else { return [] }
        let made = (try? await brain.practice(skill: skill, count: count, seed: seed)) ?? []
        return made.enumerated().map { Problem(id: $0.offset, skill: skill, lines: $0.element) }
    }
}
