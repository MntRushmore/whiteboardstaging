import Foundation
import Supabase

/// A session minted a moment ago can reach PostgREST a fraction of a second "early" by its clock:
/// the first request after sign-in is then refused with 401 `PGRST303` "JWT issued at future". The
/// same request a second later goes through. The web retries once after 1.1 s
/// (src/lib/supabaseFetch.ts); so does the app, for PostgREST calls (`SkewRetry.run`) and for API
/// calls (`APIClient`). A device whose clock really is off still fails the one retry.
public enum SkewRetry {
    /// SKEW_RETRY_MS in src/lib/supabaseFetch.ts.
    public static let delay: Duration = .milliseconds(1100)

    /// The web's test: a 401 whose body says PGRST303 or "issued at future".
    public static func isSkew(status: Int, body: String) -> Bool {
        status == 401 && body.range(of: "PGRST303|issued at future", options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// The same test for an error thrown by supabase-swift.
    public static func isSkew(_ error: Error) -> Bool {
        if let error = error as? PostgrestError {
            return error.code == "PGRST303" || error.message.range(of: "issued at future", options: .caseInsensitive) != nil
        }
        if let error = error as? HTTPError {
            return isSkew(status: error.response.statusCode, body: String(decoding: error.data, as: UTF8.self))
        }
        return false
    }

    /// Runs `operation`, and once more after `delay` when it failed for clock skew.
    public static func run<T>(
        sleep: @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
        _ operation: () async throws -> T
    ) async throws -> T {
        do {
            return try await operation()
        } catch where isSkew(error) {
            try await sleep(delay)
            return try await operation()
        }
    }
}
