import Foundation

public enum HTTPMethod: String, Sendable {
    case get = "GET"
    case post = "POST"
    case put = "PUT"
    case patch = "PATCH"
    case delete = "DELETE"
}

/// Whether a request carries the session's token.
public enum AuthRequirement: Sendable {
    /// Every `/api/*` route but a few: no session is `APIError.notSignedIn`, before any request.
    case required
    /// Sent when signed in (POST /api/client-errors only uses it to say who it was).
    case optional
    case none
}

/// A 2xx with no body to read (`204`, or an answer the caller does not need).
public struct EmptyResponse: Decodable, Sendable, Equatable {
    public init() {}
}

/// Calls the Next.js API the way the web app does (src/lib/api-client.ts): `Authorization: Bearer
/// <Supabase access token>` on every call, JSON in and out, the server's error shapes as
/// `APIError.http(HTTPFailure)` with its X-Request-Id.
///
/// - The token comes from `token`, which refreshes a session that is about to expire.
/// - A 401 whose body says `PGRST303` ("JWT issued at future": a session minted a moment ago, by a
///   clock a little behind) is tried once more after 1.1 s (`SkewRetry`).
/// - Any other 401, with `refresh` given (the app): the session is refreshed once and the call tried
///   again. The token can be stale by the server's clock though not by the iPad's (back from a long
///   background, a clock that drifted); a refresh that fails means signed out, and the 401 stands.
/// - A token that can't be had (a refresh that failed) is `APIError.network` when offline, else
///   `APIError.notSignedIn`: never Auth's own words.
/// - A request that receives no bytes for 30 s fails as `APIError.timeout` (the transport's
///   session; SSE streams have their own watchdog, `SSEClient`).
public final class APIClient: Sendable {
    public typealias TokenProvider = @Sendable () async throws -> String?
    public typealias Refresh = @Sendable () async throws -> Void
    public typealias Sleep = @Sendable (Duration) async throws -> Void

    public let baseURL: URL
    public let transport: any HTTPTransport
    let token: TokenProvider
    let refresh: Refresh?
    let sleep: Sleep

    public init(
        baseURL: URL,
        transport: any HTTPTransport = URLSessionTransport(),
        token: @escaping TokenProvider,
        refresh: Refresh? = nil,
        sleep: @escaping Sleep = { try await Task.sleep(for: $0) }
    ) {
        self.baseURL = baseURL
        self.transport = transport
        self.token = token
        self.refresh = refresh
        self.sleep = sleep
    }

    /// After a 401 that isn't clock skew: refreshes the session once (`refresh`). True when it was
    /// refreshed and the call is worth trying again.
    func refreshedAfterUnauthorized(status: Int, body: Data) async -> Bool {
        guard status == 401, let refresh, !SkewRetry.isSkew(status: status, body: String(decoding: body, as: UTF8.self)) else { return false }
        do {
            try await refresh()
            return true
        } catch {
            return false
        }
    }

    /// The session's token for a call, its failure as an APIError.
    func currentToken() async throws -> String? {
        do {
            return try await token()
        } catch {
            let wrapped = APIError.wrap(error)
            if wrapped is APIError || wrapped is CancellationError { throw wrapped }
            // Auth couldn't refresh the session (its refresh token is gone): signed out
            throw APIError.notSignedIn
        }
    }

    // MARK: building requests

    /// The URL for an API path (`/api/family`) and its query.
    public func url(for path: String, query: [URLQueryItem] = []) -> URL {
        precondition(path.hasPrefix("/"), "API paths start with /")
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) ?? URLComponents()
        let base = components.path.hasSuffix("/") ? String(components.path.dropLast()) : components.path
        components.path = base + path
        components.queryItems = query.isEmpty ? nil : query
        return components.url ?? baseURL.appendingPathComponent(path)
    }

    /// The request as it goes out: method, URL, Accept, Content-Type for a body, and the Bearer token.
    public func makeRequest(
        _ method: HTTPMethod,
        _ path: String,
        query: [URLQueryItem] = [],
        body: Data? = nil,
        accept: String = "application/json",
        auth: AuthRequirement = .required
    ) async throws -> URLRequest {
        var request = URLRequest(url: url(for: path, query: query))
        request.httpMethod = method.rawValue
        request.setValue(accept, forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        switch auth {
        case .none:
            break
        case .optional:
            if let token = try? await token(), !token.isEmpty {
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            }
        case .required:
            guard let token = try await currentToken(), !token.isEmpty else { throw APIError.notSignedIn }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    // MARK: calling

    /// Sends a request and returns the 2xx body; a non-2xx is `APIError.http`.
    public func perform(
        _ method: HTTPMethod,
        _ path: String,
        query: [URLQueryItem] = [],
        body: Data? = nil,
        auth: AuthRequirement = .required
    ) async throws -> (Data, HTTPURLResponse) {
        var retried = false
        var refreshed = false
        while true {
            let request = try await makeRequest(method, path, query: query, body: body, auth: auth)
            let data: Data
            let response: HTTPURLResponse
            do {
                (data, response) = try await transport.data(for: request)
            } catch {
                throw APIError.wrap(error)
            }
            if (200 ..< 300).contains(response.statusCode) { return (data, response) }
            if !retried, SkewRetry.isSkew(status: response.statusCode, body: String(decoding: data, as: UTF8.self)) {
                retried = true
                try await sleep(SkewRetry.delay)
                continue
            }
            if !refreshed, auth != .none, await refreshedAfterUnauthorized(status: response.statusCode, body: data) {
                refreshed = true
                continue
            }
            throw APIError.http(HTTPFailure(response: response, body: data))
        }
    }

    /// Sends a request with an optional JSON body and decodes the answer.
    public func send<Response: Decodable>(
        _ method: HTTPMethod,
        _ path: String,
        query: [URLQueryItem] = [],
        body: (some Encodable)?,
        as type: Response.Type = Response.self,
        auth: AuthRequirement = .required
    ) async throws -> Response {
        let encoded = try body.map { try Self.encoder.encode($0) }
        let (data, _) = try await perform(method, path, query: query, body: encoded, auth: auth)
        return try Self.decode(type, from: data)
    }

    public func get<Response: Decodable>(
        _ path: String,
        query: [URLQueryItem] = [],
        as type: Response.Type = Response.self,
        auth: AuthRequirement = .required
    ) async throws -> Response {
        let (data, _) = try await perform(.get, path, query: query, auth: auth)
        return try Self.decode(type, from: data)
    }

    public func post<Response: Decodable>(
        _ path: String,
        body: some Encodable,
        as type: Response.Type = Response.self,
        auth: AuthRequirement = .required
    ) async throws -> Response {
        try await send(.post, path, body: body, as: type, auth: auth)
    }

    // MARK: JSON

    public static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        return encoder
    }()

    static func decode<Response: Decodable>(_ type: Response.Type, from data: Data) throws -> Response {
        if type == EmptyResponse.self, let empty = EmptyResponse() as? Response { return empty }
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw APIError.invalidResponse("\(Response.self): \(error)")
        }
    }
}
