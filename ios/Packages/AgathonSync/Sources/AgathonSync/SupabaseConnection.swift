import AgathonKit
import Foundation

/// How the sync layer reaches Supabase as the signed-in user: the project URL and public key, a
/// transport, and the user's access token (refreshed by supabase-swift; nil when signed out).
///
/// PostgREST and Storage are called over plain HTTP rather than supabase-swift's builders so a
/// board's document goes out and comes in as the bytes it is (no re-encoding of a multi-MB JSON), and
/// a write in flight can be cancelled when it hangs.
public struct SupabaseConnection: Sendable {
    public var url: URL
    public var anonKey: String
    public var transport: any HTTPTransport
    public var token: @Sendable () async throws -> String?
    /// Refreshes the session after a 401 "JWT expired" (PGRST303) and returns the new token.
    public var refreshToken: (@Sendable () async throws -> String?)?

    public init(
        url: URL, anonKey: String, transport: any HTTPTransport = URLSessionTransport(),
        token: @escaping @Sendable () async throws -> String?, refreshToken: (@Sendable () async throws -> String?)? = nil
    ) {
        self.url = url
        self.anonKey = anonKey
        self.transport = transport
        self.token = token
        self.refreshToken = refreshToken
    }

    public init(environment: AgathonEnvironment, transport: any HTTPTransport = URLSessionTransport(),
                token: @escaping @Sendable () async throws -> String?, refreshToken: (@Sendable () async throws -> String?)? = nil) {
        self.init(url: environment.supabaseURL, anonKey: environment.supabaseAnonKey, transport: transport, token: token, refreshToken: refreshToken)
    }

    /// A request to `path` (e.g. "rest/v1/whiteboards") with `query`, signed as the user.
    func request(_ method: String, _ path: String, query: [URLQueryItem] = [], headers: [String: String] = [:], body: Data? = nil, token: String?) -> URLRequest {
        var comps = URLComponents(url: url.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty {
            comps.queryItems = query
            // PostgREST filters carry `.` and `,` that must stay as they are; `+` must not mean a space
            comps.percentEncodedQuery = comps.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        }
        var req = URLRequest(url: comps.url!)
        req.httpMethod = method
        req.setValue(anonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(token ?? anonKey)", forHTTPHeaderField: "Authorization")
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        req.httpBody = body
        return req
    }

    /// Sends a request signed with the current token; once more with a refreshed one after a
    /// 401 PGRST303 (the token expired between the read and the call).
    func send(_ method: String, _ path: String, query: [URLQueryItem] = [], headers: [String: String] = [:], body: Data? = nil) async throws -> (Data, HTTPURLResponse) {
        let first = try await token()
        let (data, response) = try await transport.data(for: request(method, path, query: query, headers: headers, body: body, token: first))
        if response.statusCode == 401, let refreshToken, PostgrestError(data)?.code == "PGRST303" || String(decoding: data.prefix(400), as: UTF8.self).contains("JWT expired") {
            let fresh = try await refreshToken()
            return try await transport.data(for: request(method, path, query: query, headers: headers, body: body, token: fresh))
        }
        return (data, response)
    }
}

/// A PostgREST error body: `{code, message, details, hint}`.
struct PostgrestError: Decodable, Sendable, Equatable {
    var code: String?
    var message: String?
    var details: String?
    var hint: String?

    init?(_ data: Data) {
        guard let e = try? JSONDecoder().decode(PostgrestError.self, from: data), e.code != nil || e.message != nil else { return nil }
        self = e
    }

    init(code: String?, message: String?) {
        self.code = code
        self.message = message
    }
}
