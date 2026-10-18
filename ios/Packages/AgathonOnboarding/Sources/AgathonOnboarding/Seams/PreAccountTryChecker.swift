import AgathonBrain
import Foundation

/// The try's checker before the account: the board's brain builds the recognizer payload on the
/// iPad (the same normalising and simplifying the web board does), the pre-account route reads it
/// and judges it with the board's own engine (`POST /api/try/check`, App Attest). "Help me" and
/// "Type it instead" never leave the iPad: the brain works the next step and the answer itself.
public final class PreAccountTryChecker: TryItChecking {
    let api: PreAccountAPI
    let brain: Brain

    public init(api: PreAccountAPI, brain: Brain = .shared) {
        self.api = api
        self.brain = brain
    }

    public func warmUp() async {
        _ = try? await brain.load()
        await api.warmUp()
    }

    public func check(_ ink: TryInk, problem: OnboardingCatalog.Problem, work: [String]) async throws -> TryCheck {
        try await brain.load()
        let strokes = ink.strokes.enumerated().compactMap { i, s -> BrainStroke? in
            guard s.x.count == s.y.count, !s.x.isEmpty else { return nil }
            return BrainStroke(id: "k\(i)", x: s.x, y: s.y)
        }
        guard !strokes.isEmpty, let payload = try await brain.recognizerPayload(strokes) else {
            return TryCheck(verdict: .unread, latex: "")
        }
        return try await api.check(problemId: problem.id, work: work, x: payload.strokes.x, y: payload.strokes.y,
                                   w: payload.bounds.w, h: payload.bounds.h)
    }

    public func checkTyped(_ answer: String, problem: OnboardingCatalog.Problem, work: [String]) async throws -> TryCheck {
        try await LocalAnswerJudge(brain: brain).judge(answer, problem: problem)
    }

    public func help(problem: OnboardingCatalog.Problem, work: [String]) async throws -> String? {
        if let step = try? await LocalAnswerJudge(brain: brain).nextStep(problem: problem, work: work) { return step }
        return try await api.help(problemId: problem.id, work: work)
    }
}

/// Judges a typed answer and works the next step with the brain alone (no read, no network): the
/// answer is the problem's own (`localSolve`'s last step, or the starter's one-step answer), compared
/// as a number. A typed line can only be the answer, so it is `solved` or a `ring`.
public struct LocalAnswerJudge: Sendable {
    let brain: Brain

    public init(brain: Brain = .shared) { self.brain = brain }

    public func judge(_ typed: String, problem: OnboardingCatalog.Problem) async throws -> TryCheck {
        guard let mine = Self.number(typed) else { return TryCheck(verdict: .unread, latex: typed) }
        var answers: [Double] = []
        if problem.oneStep, let a = Self.number(problem.firstStep) { answers.append(a) }
        try? await brain.load()
        if let solved = try? await brain.localSolve(problem.lines), let last = solved.steps.last ?? solved.answer, let a = Self.number(last) {
            answers.append(a)
        }
        guard !answers.isEmpty else { return TryCheck(verdict: .unread, latex: typed) }
        let right = answers.contains { abs($0 - mine) < 1e-9 * max(1, abs($0)) }
        return TryCheck(verdict: right ? .solved : .ring, latex: typed, note: right ? nil : problem.hint)
    }

    /// The next line after `work`, as LaTeX (the try route's `nextTryStep`, on the iPad).
    public func nextStep(problem: OnboardingCatalog.Problem, work: [String]) async throws -> String? {
        try await brain.load()
        let solved = try await brain.localSolve(problem.lines + work)
        return solved.steps.first
    }

    /// A number from what a kid types or the engine writes: `42`, `-3.5`, `x = 8`, `3/4`,
    /// `\frac{5}{7}`, `= 70`. Nil for anything else.
    public static func number(_ raw: String) -> Double? {
        var s = raw.replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "\u{2212}", with: "-")
        if let eq = s.lastIndex(of: "=") { s = String(s[s.index(after: eq)...]) }
        if s.hasPrefix("\\frac{") {
            let parts = s.dropFirst(6).split(separator: "}", omittingEmptySubsequences: false)
            guard parts.count >= 2 else { return nil }
            let num = String(parts[0])
            let den = String(parts[1]).replacingOccurrences(of: "{", with: "")
            guard let n = Double(num), let d = Double(den), d != 0 else { return nil }
            return n / d
        }
        if s.hasPrefix("-\\frac{"), let v = number(String(s.dropFirst())) { return -v }
        let slash = s.split(separator: "/")
        if slash.count == 2, let n = Double(slash[0]), let d = Double(slash[1]), d != 0 { return n / d }
        return Double(s)
    }
}
