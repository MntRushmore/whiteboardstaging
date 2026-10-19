import AgathonBrain
import AgathonKit
import Foundation

/// The two classifiers the tracker needs, from the brain (the web's own TypeScript): the skill a
/// problem is filed under (`classify` → `classifyProblem(lines, course)`) and the kind of mistake a
/// ringed line is (`classifyMistake`). The tracker is synchronous, as the web's is; the brain is an
/// actor — so the recorder asks for a signal's skill (`prepare`) before it hands the signal over,
/// and the tracker reads the answer here (`skill`).
@MainActor
public final class LearningClassifier {
    public let brain: Brain
    public let course: String?
    private var skills: [String: String] = [:]
    private var order: [String] = []
    private static let remembered = 500

    public init(brain: Brain, course: String?) {
        self.brain = brain
        self.course = course
    }

    /// Asks the brain for the skill of the problem this signal carries, unless it is known.
    public func prepare(_ signal: LearningSignal) async {
        guard let lines = signal.problemLines else { return }
        await prepare(lines: AttemptTracker.clean(lines))
    }

    func prepare(lines: [String]) async {
        let key = lines.joined(separator: "\n")
        if skills[key] != nil { return }
        let skill: String
        do {
            try await brain.load()
            skill = try await brain.classify(lines, course: course)
        } catch {
            skill = "other"
        }
        skills[key] = skill
        order.append(key)
        if order.count > Self.remembered { skills[order.removeFirst()] = nil }
    }

    /// The skill of these (cleaned) lines, as the brain said; `other` when it was not asked.
    public func skill(_ lines: [String]) -> String {
        skills[lines.joined(separator: "\n")] ?? "other"
    }

    /// The kind of mistake `latex` is under `previous`, or nil (the brain's `classifyMistake`; nil
    /// too when this brain predates it).
    public func mistake(previous: String, latex: String) async -> String? {
        struct Args: Encodable { var previous: String; var latex: String }
        do {
            try await brain.load()
            return try await brain.call("classifyMistake", Args(previous: previous, latex: latex), as: String?.self)
        } catch {
            return nil
        }
    }
}
