import Foundation

/// The lane's own original questions (Resources/sat-fixtures.json, in the contract's JSON): both
/// formats, all four domains, every figure kind. For previews, the unit tests and the UI tests'
/// stubbed routes, never shown to a real student. Its first ten are a mixed set: an mcq, a table, a
/// grid-in system, a plotted line, a right triangle, a fraction grid-in, a parabola, a bar chart, a
/// triangle's angles and a circle.
public enum SATFixtures {
    public static let questions: [SATQuestion] = {
        guard let url = Bundle.module.url(forResource: "sat-fixtures", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let reply = try? JSONDecoder().decode(SATNextReply.self, from: data) else { return [] }
        return reply.questions
    }()

    /// The bank lane's 20 hand-checked questions with their real v2 notes (docs/sat/sample-20.json on
    /// feat/sat2-bank): nudges, whys, common wrong answers, Desmos ways. The screenshots' bank
    /// (`-satStub bank=sample`).
    public static let sample: [SATQuestion] = {
        guard let url = Bundle.module.url(forResource: "sat-sample-20", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let list = try? JSONDecoder().decode([Lossy<SATQuestion>].self, from: data) else { return [] }
        return list.compactMap(\.value)
    }()

    public static func question(_ id: String) -> SATQuestion? {
        questions.first { $0.id == id }
    }

    /// The domain a question id names (`geometry_trig-circles-0012` → geometry and trig).
    public static func domain(ofId id: String) -> SATDomain? {
        SATDomain.allCases.sorted { $0.rawValue.count > $1.rawValue.count }.first { id.hasPrefix($0.rawValue + "-") }
    }

    /// A progress reply with some history: 32 answered, an estimate, two free tutor questions used.
    public static let progress = SATProgress(
        answered: 32, correct: 21,
        byDomain: [
            .init(domain: .algebra, answered: 12, correct: 9),
            .init(domain: .advancedMath, answered: 10, correct: 6),
            .init(domain: .psda, answered: 6, correct: 4),
            .init(domain: .geometryTrig, answered: 4, correct: 2),
        ],
        bySkill: [
            .init(domain: .algebra, skill: "linear equations in one variable", answered: 4, correct: 4),
            .init(domain: .algebra, skill: "linear functions", answered: 5, correct: 3),
            .init(domain: .algebra, skill: "systems of two linear equations", answered: 3, correct: 2),
            .init(domain: .advancedMath, skill: "equivalent expressions", answered: 4, correct: 3),
            .init(domain: .advancedMath, skill: "nonlinear functions", answered: 6, correct: 3),
            .init(domain: .psda, skill: "percentages", answered: 3, correct: 2),
            .init(domain: .psda, skill: "probability", answered: 3, correct: 2),
            .init(domain: .geometryTrig, skill: "circles", answered: 2, correct: 1),
            .init(domain: .geometryTrig, skill: "right triangles and trigonometry", answered: 2, correct: 1),
        ],
        streakDays: 3,
        today: .init(answered: 6, tutorUsed: 2, cap: SATLimits.freeTutorPerDay, unlimited: false),
        estimate: .init(low: 540, high: 620, note: "From 32 practice questions. A rough estimate, not a score."))
}
