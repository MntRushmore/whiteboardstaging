import AgathonKit
import Foundation

/// What the SAT screens ask for. `SATClient` is the app's (AgathonKit's API client: the bearer token,
/// the error shapes, the 401 refresh); tests, previews and the UI tests pass `SATStubService`.
public protocol SATService: Sendable {
    /// GET /api/sat/next: a set, adaptive (unseen first, weak skills weighted up)
    func next(_ request: SATNextRequest) async throws -> [SATQuestion]
    /// POST /api/sat/attempts: one checked answer
    func record(_ attempt: SATAttempt) async throws
    /// POST /api/sat/tutor: may the live tutor help on this question today (idempotent per day)
    func tutorPass(questionId: String) async throws -> SATTutorPass
    /// GET /api/sat/progress
    func progress() async throws -> SATProgress
}

/// What a set is made of: mixed and adaptive (all nil), a domain, or one skill.
public struct SATNextRequest: Hashable, Sendable {
    public var count: Int
    public var domain: SATDomain?
    /// the skill's name exactly as the bank stores it
    public var skill: String?
    public var difficulty: Int?

    public init(count: Int = SATLimits.setSize, domain: SATDomain? = nil, skill: String? = nil, difficulty: Int? = nil) {
        self.count = count
        self.domain = domain
        self.skill = skill
        self.difficulty = difficulty
    }

    /// The query as the route reads it (empty values left out).
    public var query: [URLQueryItem] {
        var q = [URLQueryItem(name: "count", value: String(count))]
        if let domain { q.append(URLQueryItem(name: "domain", value: domain.rawValue)) }
        if let skill { q.append(URLQueryItem(name: "skill", value: skill)) }
        if let difficulty { q.append(URLQueryItem(name: "difficulty", value: String(difficulty))) }
        return q
    }
}

/// The SAT routes over AgathonKit's `APIClient` (src/app/api/sat/…, the app's usual auth).
public final class SATClient: SATService {
    public static let nextPath = "/api/sat/next"
    public static let attemptsPath = "/api/sat/attempts"
    public static let tutorPath = "/api/sat/tutor"
    public static let progressPath = "/api/sat/progress"

    public let api: APIClient
    /// the student's time zone: the free tutor's day and "today" are counted where they are
    let timeZone: @Sendable () -> TimeZone

    public init(api: APIClient, timeZone: @escaping @Sendable () -> TimeZone = { .current }) {
        self.api = api
        self.timeZone = timeZone
    }

    public func next(_ request: SATNextRequest) async throws -> [SATQuestion] {
        let reply: SATNextReply = try await api.get(Self.nextPath, query: request.query)
        return reply.questions
    }

    public func record(_ attempt: SATAttempt) async throws {
        _ = try await api.post(Self.attemptsPath, body: attempt, as: EmptyResponse.self)
    }

    public func tutorPass(questionId: String) async throws -> SATTutorPass {
        struct Body: Encodable {
            let question_id: String
            let tz: String
        }
        return try await api.post(Self.tutorPath, body: Body(question_id: questionId, tz: timeZone().identifier))
    }

    public func progress() async throws -> SATProgress {
        try await api.get(Self.progressPath, query: [URLQueryItem(name: "tz", value: timeZone().identifier)])
    }
}
