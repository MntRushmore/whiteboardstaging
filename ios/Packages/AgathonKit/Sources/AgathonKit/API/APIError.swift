import Foundation

/// Why a call to the API failed.
public enum APIError: Error, Sendable, Equatable {
    /// No session: the call needs a signed-in user (the web's `ApiError(401, "unauthorized")`
    /// thrown before any request).
    case notSignedIn
    /// The server answered with a non-2xx status.
    case http(HTTPFailure)
    /// Nothing arrived for the stall timeout: a stalled connection (an iPad's Wi-Fi dropping
    /// mid-answer). Retryable.
    case timeout
    /// The stream closed before its last event (`done`): the answer was cut off.
    case incomplete
    /// The request never got an answer (offline, DNS, TLS, the connection reset).
    case network(URLError.Code)
    /// A 2xx whose body was not what the route promises.
    case invalidResponse(String)

    /// The server's answer, when there was one.
    public var failure: HTTPFailure? {
        if case let .http(failure) = self { return failure }
        return nil
    }

    public var status: Int? { failure?.status }
    public var requestId: String? { failure?.requestId }

    /// Signed out, or a session the server refused.
    public var isUnauthorized: Bool {
        self == .notSignedIn || failure?.isUnauthorized == true
    }

    public var isOutOfInk: Bool { failure?.isOutOfInk == true }
    public var isRateLimited: Bool { failure?.isRateLimited == true }
    public var isFairUse: Bool { failure?.isFairUse == true }

    /// Worth offering "Try again": a timeout, a dropped connection, a 5xx, a cut-off stream.
    public var isRetryable: Bool {
        switch self {
        case .timeout, .incomplete, .network: return true
        case let .http(failure): return failure.status >= 500
        case .notSignedIn, .invalidResponse: return false
        }
    }

    /// An error from URLSession or a task, as an APIError (a cancellation stays a CancellationError).
    static func wrap(_ error: Error) -> Error {
        if error is APIError || error is CancellationError { return error }
        if let urlError = error as? URLError {
            switch urlError.code {
            case .cancelled: return CancellationError()
            case .timedOut: return APIError.timeout
            default: return APIError.network(urlError.code)
            }
        }
        return error
    }
}

extension APIError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .notSignedIn: return "You need to be signed in."
        // a 5xx says nothing a person can act on, and some name the server's own settings
        // ("…not set up on this deployment (SUPABASE_SERVICE_ROLE_KEY)"): our plain line instead
        case let .http(failure): return failure.status >= 500 ? HTTPFailure.serverWords : failure.message
        case .timeout: return "The connection stalled. Check the Wi-Fi and try again."
        case .incomplete: return "The answer was cut off. Try again."
        case .network: return "Agathon can't connect. Check the Wi-Fi and try again."
        case .invalidResponse: return "Something went wrong on our side. Try again in a moment."
        }
    }
}

/// A non-2xx answer, decoded from the shapes the server writes:
///
/// - every route: `{ error: <code>, message, ...extra }` (src/lib/server/auth.ts `json()`), e.g.
///   `rate_limited` with `retryAfterMs` (and a Retry-After header), `ink_empty` 402 with
///   `remaining` and `cost`, 429 `rate_limited` with `reason: "fair_use"`, 401 `unauthorized`;
///   the family routes add `reason`, `triesLeft`, `locked` and `requestId`
/// - Ask's errors: `{ code, message, status }` (src/lib/live/ask/contracts.ts)
/// - anything else (Cloudflare's HTML 502 page, a platform error): no code at all
public struct HTTPFailure: Sendable, Equatable {
    public let status: Int
    /// The machine code: the body's `error`, or Ask's `code`.
    public let code: String?
    public let message: String
    /// How long the server asked us to wait (the body's `retryAfterMs`, else Retry-After).
    public let retryAfterMs: Int?
    /// The server's `X-Request-Id` (or the body's `requestId`), for an error report.
    public let requestId: String?
    /// Vercel's `x-vercel-error`: the platform answered, not our route.
    public let vercelError: String?
    /// The whole body, for fields a route adds to its own errors.
    public let body: JSONValue?

    public init(status: Int, code: String?, message: String, retryAfterMs: Int? = nil, requestId: String? = nil,
                vercelError: String? = nil, body: JSONValue? = nil) {
        self.status = status
        self.code = code
        self.message = message
        self.retryAfterMs = retryAfterMs
        self.requestId = requestId
        self.vercelError = vercelError
        self.body = body
    }

    /// Decodes a failure from its status, headers and body. `header` looks a header up by name
    /// (case-insensitively, as HTTPURLResponse does).
    public init(status: Int, header: (String) -> String?, body data: Data, now: Date = Date()) {
        let json = JSONValue.parse(data)
        let object = json?.objectValue
        let code = object?["error"]?.stringValue ?? object?["code"]?.stringValue
        // a body that isn't ours (Cloudflare's HTML 502 page, a platform error): plain words, never
        // "Request failed (502)" or the page's HTML
        let message = object?["message"]?.stringValue ?? Self.plainWords(status: status)
        self.init(
            status: status,
            code: code,
            message: message,
            retryAfterMs: Self.retryAfter(body: object, header: header("Retry-After"), now: now),
            requestId: Self.requestId(header: header("X-Request-Id"), body: object?["requestId"]?.stringValue),
            vercelError: header("x-vercel-error").flatMap { Self.matches($0, Self.vercelErrorPattern) ? $0 : nil },
            body: object == nil ? nil : json
        )
    }

    public init(response: HTTPURLResponse, body: Data, now: Date = Date()) {
        self.init(status: response.statusCode, header: { response.value(forHTTPHeaderField: $0) }, body: body, now: now)
    }

    /// What a 5xx says to a person.
    public static let serverWords = "Something went wrong on our side. Try again in a moment."

    /// The words for an answer with no message of ours in it.
    public static func plainWords(status: Int) -> String {
        switch status {
        case 401: return "You need to be signed in."
        case 429: return "Too many tries. Wait a moment, then try again."
        case 500...: return serverWords
        default: return "Something got in the way. Try again in a moment."
        }
    }

    // MARK: what it means

    public var isUnauthorized: Bool { status == 401 || code == "unauthorized" }
    public var isRateLimited: Bool { status == 429 || code == "rate_limited" }
    /// Agathon Unlimited's daily fair-use cap: a rate limit, never "out of ink".
    public var isFairUse: Bool { isRateLimited && reason == "fair_use" }
    /// Out of ink: the API's 402 `ink_empty` (ink is the only thing it answers 402 for);
    /// `credits_exhausted` is the same answer from a server deployed before ink.
    public var isOutOfInk: Bool { status == 402 || code == "ink_empty" || code == "credits_exhausted" }
    /// A 5xx no route of ours wrote (Cloudflare's page, a platform error): nothing it says is ours.
    public var isBareServerError: Bool { status >= 500 && code == nil }

    // MARK: route-specific fields

    /// The family routes' and fair use's `reason` (`wrong_pin`, `pin_locked`, `fair_use`…).
    public var reason: String? { body?["reason"]?.stringValue }
    /// Out of ink: the ink left.
    public var remaining: Int? { body?["remaining"]?.intValue }
    /// Out of ink: what the refused call needs.
    public var cost: Int? { body?["cost"]?.intValue }
    /// A wrong PIN: the tries left before the lock.
    public var triesLeft: Int? { body?["triesLeft"]?.intValue }
    /// A wrong PIN that locked switching to the grown-up for the day.
    public var locked: Bool { body?["locked"]?.boolValue == true }

    // MARK: parsing

    static let requestIdPattern = "^[A-Za-z0-9_-]{1,64}$"
    static let vercelErrorPattern = "^[A-Z0-9_]{1,64}$"

    static func matches(_ value: String, _ pattern: String) -> Bool {
        value.range(of: pattern, options: .regularExpression) != nil
    }

    static func requestId(header: String?, body: String?) -> String? {
        for candidate in [header, body] {
            if let candidate, matches(candidate, requestIdPattern) { return candidate }
        }
        return nil
    }

    /// The body's `retryAfterMs` when it is a positive number, else the Retry-After header (seconds,
    /// or an HTTP date).
    static func retryAfter(body: [String: JSONValue]?, header: String?, now: Date) -> Int? {
        if let ms = body?["retryAfterMs"]?.doubleValue, ms.isFinite, ms > 0 { return Int(ms.rounded()) }
        guard let header = header?.trimmingCharacters(in: .whitespaces), !header.isEmpty else { return nil }
        if let seconds = Double(header), seconds.isFinite, seconds > 0 { return Int((seconds * 1000).rounded()) }
        if let date = httpDate.date(from: header), date > now { return Int((date.timeIntervalSince(now) * 1000).rounded()) }
        return nil
    }

    private static let httpDate: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "GMT")
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
        return formatter
    }()
}
