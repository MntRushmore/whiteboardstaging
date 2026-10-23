import AgathonKit
import Foundation

/// The three routes the onboarding calls before there is an account, each proved by App Attest
/// (`AppAttestor`): the try board's read and check (`POST /api/try/check`), its next step
/// (`POST /api/try/help`) and the anonymous step counts (`POST /api/start/step`). No session, no
/// cookies; the AI keys stay on the server.
public final class PreAccountAPI: Sendable {
    public enum Paths {
        public static let check = "/api/try/check"
        public static let help = "/api/try/help"
        public static let step = "/api/start/step"
    }

    let api: APIClient
    let attestor: AppAttestor

    public init(api: APIClient, defaults: UserDefaults = .standard) {
        self.api = api
        let host = api.baseURL.host ?? "api"
        // the simulator's debug header is for the local stack and previews only, never production
        let production = host == AgathonEnvironment.production.apiBaseURL.host
        attestor = AppAttestor(host: host, allowsDebugHeader: !production, defaults: defaults) { path, body, headers in
            try await Self.send(api, path: path, body: body, headers: headers)
        }
    }

    /// One POST with no session: the status and the body.
    static func send(_ api: APIClient, path: String, body: Data, headers: [String: String]) async throws -> (Int, Data) {
        var request = try await api.makeRequest(.post, path, body: body, auth: .none)
        for (k, v) in headers { request.setValue(v, forHTTPHeaderField: k) }
        do {
            let (data, response) = try await api.transport.data(for: request)
            return (response.statusCode, data)
        } catch {
            throw TryCheckError.offline
        }
    }

    /// POSTs `body` proved by App Attest; a key the server has forgotten is registered again once.
    func attested(_ path: String, _ body: Data) async throws -> (Int, Data) {
        var headers: [String: String]
        do {
            headers = try await attestor.headers(for: body)
        } catch let error as TryCheckError {
            throw error
        } catch {
            throw TryCheckError.refused("attest: \(error.localizedDescription)")
        }
        var (status, data) = try await Self.send(api, path: path, body: body, headers: headers)
        if status == 403, Self.reason(data) == "attest_unknown_key" {
            await attestor.serverForgotKey()
            headers = try await attestor.headers(for: body)
            (status, data) = try await Self.send(api, path: path, body: body, headers: headers)
        }
        return (status, data)
    }

    static func reason(_ data: Data) -> String? {
        (try? JSONDecoder().decode(ErrorBody.self, from: data))?.reason
    }

    static func error(_ status: Int, _ data: Data) -> TryCheckError {
        let body = try? JSONDecoder().decode(ErrorBody.self, from: data)
        switch status {
        case 429: return .rateLimited(retryAfterMs: body?.retryAfterMs)
        case 503, 502, 500: return .unavailable
        default: return .refused("\(status) \(body?.reason ?? body?.error ?? "")")
        }
    }

    struct ErrorBody: Decodable {
        let error: String?
        let reason: String?
        let retryAfterMs: Int?
    }

    // MARK: - the try board

    struct CheckBody: Encodable {
        struct Strokes: Encodable { let x: [[Double]]; let y: [[Double]] }
        struct Bounds: Encodable { let w: Double; let h: Double }
        let problemId: String
        let work: [String]
        let strokes: Strokes
        let bounds: Bounds
    }

    struct CheckAnswer: Decodable {
        let latex: String
        let verdict: String
        let note: String?
    }

    /// `POST /api/try/check`: the reader reads the line and the engine judges it.
    public func check(problemId: String, work: [String], x: [[Double]], y: [[Double]], w: Double, h: Double) async throws -> TryCheck {
        let body = try APIClient.encoder.encode(CheckBody(problemId: problemId, work: work, strokes: .init(x: x, y: y), bounds: .init(w: w, h: h)))
        let (status, data) = try await attested(Paths.check, body)
        guard status == 200 else { throw Self.error(status, data) }
        guard let answer = try? JSONDecoder().decode(CheckAnswer.self, from: data), let verdict = TryVerdict(rawValue: answer.verdict) else {
            throw TryCheckError.unavailable
        }
        return TryCheck(verdict: verdict, latex: answer.latex, note: answer.note)
    }

    struct HelpBody: Encodable { let problemId: String; let work: [String] }
    struct HelpAnswer: Decodable { let latex: String?; let solves: Bool }

    /// `POST /api/try/help`: the next step after `work`, or nil.
    public func help(problemId: String, work: [String]) async throws -> String? {
        let body = try APIClient.encoder.encode(HelpBody(problemId: problemId, work: work))
        let (status, data) = try await attested(Paths.help, body)
        guard status == 200 else { throw Self.error(status, data) }
        return (try? JSONDecoder().decode(HelpAnswer.self, from: data))?.latex
    }

    // MARK: - the steps

    struct StepBody: Encodable {
        let journeyId: String
        let event: String
        let meta: [String: JSONValue]?
    }

    /// `POST /api/start/step`, fire and forget: nothing here is ever in a family's way.
    public func step(journeyId: UUID, event: String, meta: [String: JSONValue] = [:]) async {
        var m = meta
        m["client"] = .string("ipad")
        guard let body = try? APIClient.encoder.encode(StepBody(journeyId: journeyId.uuidString.lowercased(), event: event, meta: m)) else { return }
        _ = try? await attested(Paths.step, body)
    }

    // MARK: - SAT mode with no account

    /// The anonymous session `POST /api/sat/anon` mints for SAT practice (docs/SAT-MODE.md): App
    /// Attest proves it is the real app (the simulator's debug header off production). The app adopts
    /// it with `AuthService.setSession`; it never signs in anonymously itself.
    public struct AnonSession: Decodable, Sendable, Equatable {
        public let accessToken: String
        public let refreshToken: String
        public let expiresAt: Double?
        public let userId: String?

        enum CodingKeys: String, CodingKey {
            case accessToken = "access_token"
            case refreshToken = "refresh_token"
            case expiresAt = "expires_at"
            case userId = "user_id"
        }
    }

    public static let anonPath = "/api/sat/anon"

    /// `POST /api/sat/anon` with the body the assertion signs, `{}`.
    public func satAnonSession() async throws -> AnonSession {
        let (status, data) = try await attested(Self.anonPath, Data("{}".utf8))
        guard status == 200 else { throw Self.error(status, data) }
        guard let session = try? JSONDecoder().decode(AnonSession.self, from: data) else { throw TryCheckError.unavailable }
        return session
    }

    public func warmUp() async {
        await attestor.warmUp()
    }
}
