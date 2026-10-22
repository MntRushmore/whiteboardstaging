import AgathonKit
import Foundation

/// The SAT routes, played by the iPad (previews, unit tests, the UI tests' `-satStub`): the fixture
/// questions, a free tutor that runs out after `cap` questions a day (idempotent per question, as
/// the server's pass is), attempts kept in memory and counted into progress as the server would.
public final class SATStubService: SATService, @unchecked Sendable {
    private let lock = NSLock()
    private var bank: [SATQuestion]
    private var served = 0
    private var passes = Set<String>()
    private var _attempts: [SATAttempt] = []
    /// how many free tutor questions a day
    public let cap: Int
    /// Unlimited: the tutor is never capped
    public let unlimited: Bool
    /// tutor passes the day had used before this stub began (the UI tests' "already capped")
    public let usedBefore: Int
    /// every call fails as offline would (the screens' offline states)
    public var offline = false
    /// a call's delay (the screens' waiting states)
    public var delay: Duration = .zero
    /// an estimate band to report once this many questions are answered (in all)
    public var estimateAfter = SATLimits.estimateMinAnswered
    /// answers given before this stub began, counted into progress (a student with history)
    public var history: [SATAttempt] = []

    public init(questions: [SATQuestion] = SATFixtures.questions, cap: Int = SATLimits.freeTutorPerDay, usedBefore: Int = 0, unlimited: Bool = false) {
        bank = questions
        self.cap = cap
        self.usedBefore = usedBefore
        self.unlimited = unlimited
    }

    /// Every attempt recorded, in order.
    public var attempts: [SATAttempt] {
        lock.withLock { _attempts }
    }

    /// The questions the tutor was asked about.
    public var tutorAsked: Set<String> {
        lock.withLock { passes }
    }

    private func wait() async throws {
        if delay > .zero { try await Task.sleep(for: delay) }
        if offline { throw APIError.network(.notConnectedToInternet) }
    }

    public func next(_ request: SATNextRequest) async throws -> [SATQuestion] {
        try await wait()
        return lock.withLock {
            var pool = bank
            if let domain = request.domain { pool = pool.filter { $0.domain == domain } }
            if let skill = request.skill { pool = pool.filter { $0.skill == skill } }
            if let d = request.difficulty { pool = pool.filter { $0.difficulty == d } }
            guard !pool.isEmpty else { return [] }
            // round the bank from where the last set ended, as the server goes on to unseen ones
            var out: [SATQuestion] = []
            for i in 0..<min(request.count, pool.count) { out.append(pool[(served + i) % pool.count]) }
            served += out.count
            return out
        }
    }

    public func record(_ attempt: SATAttempt) async throws {
        try await wait()
        lock.withLock { _attempts.append(attempt) }
    }

    public func tutorPass(questionId: String) async throws -> SATTutorPass {
        try await wait()
        return lock.withLock {
            if unlimited { return SATTutorPass(allowed: true, usedToday: 0, cap: cap, unlimited: true) }
            if passes.contains(questionId) { return SATTutorPass(allowed: true, usedToday: usedBefore + passes.count, cap: cap, unlimited: false) }
            guard usedBefore + passes.count < cap else { return SATTutorPass(allowed: false, usedToday: usedBefore + passes.count, cap: cap, unlimited: false) }
            passes.insert(questionId)
            return SATTutorPass(allowed: true, usedToday: usedBefore + passes.count, cap: cap, unlimited: false)
        }
    }

    public func progress() async throws -> SATProgress {
        try await wait()
        return lock.withLock {
            // a question's first answer is what counts, as on the server
            var firsts: [String: SATAttempt] = [:]
            var order: [String] = []
            for a in history + _attempts where firsts[a.questionId] == nil {
                firsts[a.questionId] = a
                order.append(a.questionId)
            }
            let byId = Dictionary(bank.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
            var domains: [SATDomain: SATProgress.Count] = [:]
            var skills: [String: (SATDomain?, SATProgress.Count)] = [:]
            var right = 0
            for id in order {
                guard let a = firsts[id] else { continue }
                if a.correct { right += 1 }
                let q = byId[id]
                let domain = q?.domain ?? SATFixtures.domain(ofId: id)
                if let domain {
                    var c = domains[domain] ?? SATProgress.Count(answered: 0, correct: 0)
                    c.answered += 1
                    c.correct += a.correct ? 1 : 0
                    domains[domain] = c
                }
                if let skill = q?.skill {
                    var c = skills[skill]?.1 ?? SATProgress.Count(answered: 0, correct: 0)
                    c.answered += 1
                    c.correct += a.correct ? 1 : 0
                    skills[skill] = (domain, c)
                }
            }
            let answered = order.count
            var estimate: SATProgress.Estimate?
            if answered >= estimateAfter {
                // the same idea as the server's band: centred on the share right, narrowing with more answers
                let share = Double(right) / Double(max(1, answered))
                let mid = 200 + share * 600
                let half = max(40, 160 - Double(answered) * 2)
                func r10(_ v: Double) -> Int { Int((v / 10).rounded()) * 10 }
                estimate = SATProgress.Estimate(low: max(200, r10(mid - half)), high: min(800, r10(mid + half)),
                                                note: "From \(answered) practice questions. A rough estimate, not a score.")
            }
            let today = SATProgress.Today(answered: _attempts.count, tutorUsed: usedBefore + passes.count, cap: cap, unlimited: unlimited)
            return SATProgress(
                answered: answered, correct: right,
                byDomain: SATDomain.allCases.compactMap { d in domains[d].map { SATProgress.DomainCount(domain: d, answered: $0.answered, correct: $0.correct) } },
                bySkill: SATTaxonomy.skills.compactMap { s in skills[s.name].map { SATProgress.SkillCount(domain: $0.0, skill: s.name, answered: $0.1.answered, correct: $0.1.correct) } },
                streakDays: answered > 0 ? 1 : 0, today: today, estimate: estimate)
        }
    }
}
