import Foundation

/// Where the app's backend lives: the Next.js API on Vercel and the Supabase project behind it
/// (docs/IPAD-NATIVE.md, "AgathonKit").
///
/// Production is the default. A Debug build may point at the local stack (`npm run db:start` +
/// `npm run dev`) with three environment variables, all set in the Agathon scheme and unticked:
///
/// - `AGATHON_API_URL`: the Next.js server, e.g. `http://localhost:3101`
/// - `SUPABASE_URL` + `SUPABASE_ANON_KEY`: the Supabase project, e.g. `http://127.0.0.1:54321` and the
///   `ANON_KEY` that `npx supabase status -o env` prints. These two go together: a local URL with the
///   production key (or the other way round) can only fail, so one without the other is an error.
///
/// Only a public key is ever accepted: the legacy anon JWT or a `sb_publishable_` key. A
/// service-role JWT or an `sb_secret_` key is refused, so one can never end up in the app.
public struct AgathonEnvironment: Sendable, Equatable {
    /// The Next.js API (`/api/*`).
    public let apiBaseURL: URL
    /// The Supabase project (`/auth/v1`, `/rest/v1`, `/storage/v1`).
    public let supabaseURL: URL
    /// The project's public anon (publishable) key. Safe to ship: row-level security does the work.
    public let supabaseAnonKey: String

    public init(apiBaseURL: URL, supabaseURL: URL, supabaseAnonKey: String) {
        self.apiBaseURL = apiBaseURL
        self.supabaseURL = supabaseURL
        self.supabaseAnonKey = supabaseAnonKey
    }

    /// The live app: www.agathon.app and Supabase project `sgolkponjdkphndosrea`. The key is the same
    /// public anon key the web app ships as NEXT_PUBLIC_SUPABASE_ANON_KEY (in its JavaScript bundle).
    public static let production = AgathonEnvironment(
        apiBaseURL: URL(string: "https://www.agathon.app")!,
        supabaseURL: URL(string: "https://sgolkponjdkphndosrea.supabase.co")!,
        supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNnb2xrcG9uamRrcGhuZG9zcmVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2Nzk5NDksImV4cCI6MjEwNTI1NTk0OX0.pXrT_QKNZhdz8cC7GbZeqk0-6tTPmPiy2Klrljj4f-E"
    )

    /// The environment variable names a Debug run reads.
    public enum Key {
        public static let apiURL = "AGATHON_API_URL"
        public static let supabaseURL = "SUPABASE_URL"
        public static let supabaseAnonKey = "SUPABASE_ANON_KEY"
    }

    /// True in a Debug build: only then are the environment variables read.
    public static var overridesAllowed: Bool {
        #if DEBUG
        return true
        #else
        return false
        #endif
    }

    /// What this run talks to: production, or a Debug run's overrides. A Debug run whose overrides
    /// are wrong stops here with the reason, rather than quietly talking to production.
    public static let current: AgathonEnvironment = {
        do {
            return try resolve(environment: ProcessInfo.processInfo.environment, allowOverrides: overridesAllowed)
        } catch {
            // Only reachable with overrides allowed (Debug): a ticked variable with a bad value.
            fatalError("AgathonEnvironment: \(error). Fix or untick it in Product > Scheme > Edit Scheme > Run > Arguments.")
        }
    }()

    public enum ResolveError: Error, Equatable, CustomStringConvertible {
        case invalidURL(key: String, value: String)
        case incompleteSupabaseOverride(missing: String)
        case notAPublicKey(reason: String)

        public var description: String {
            switch self {
            case let .invalidURL(key, value):
                return "\(key) is not an http(s) URL: \(value)"
            case let .incompleteSupabaseOverride(missing):
                return "\(Key.supabaseURL) and \(Key.supabaseAnonKey) go together; \(missing) is missing"
            case let .notAPublicKey(reason):
                return "\(Key.supabaseAnonKey) is not a public anon key (\(reason))"
            }
        }
    }

    /// Production with any overrides in `environment` applied (only when `allowOverrides`). Empty
    /// values count as unset.
    public static func resolve(environment: [String: String], allowOverrides: Bool) throws -> AgathonEnvironment {
        guard allowOverrides else { return .production }
        func value(_ key: String) -> String? {
            guard let raw = environment[key]?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
            return raw
        }

        var api = production.apiBaseURL
        if let raw = value(Key.apiURL) { api = try httpURL(raw, key: Key.apiURL) }

        var supabaseURL = production.supabaseURL
        var key = production.supabaseAnonKey
        switch (value(Key.supabaseURL), value(Key.supabaseAnonKey)) {
        case (nil, nil):
            break
        case (.some, nil):
            throw ResolveError.incompleteSupabaseOverride(missing: Key.supabaseAnonKey)
        case (nil, .some):
            throw ResolveError.incompleteSupabaseOverride(missing: Key.supabaseURL)
        case let (.some(rawURL), .some(rawKey)):
            supabaseURL = try httpURL(rawURL, key: Key.supabaseURL)
            try checkPublicKey(rawKey)
            key = rawKey
        }
        return AgathonEnvironment(apiBaseURL: api, supabaseURL: supabaseURL, supabaseAnonKey: key)
    }

    /// Throws unless `key` is a public key: a JWT whose role is `anon`, or an `sb_publishable_` key.
    public static func checkPublicKey(_ key: String) throws {
        if key.hasPrefix("sb_publishable_") { return }
        if key.hasPrefix("sb_secret_") { throw ResolveError.notAPublicKey(reason: "an sb_secret_ key") }
        guard let role = JWTClaims.role(of: key) else {
            throw ResolveError.notAPublicKey(reason: "neither a JWT nor an sb_publishable_ key")
        }
        guard role == "anon" else { throw ResolveError.notAPublicKey(reason: "its role is \(role)") }
    }

    private static func httpURL(_ raw: String, key: String) throws -> URL {
        guard let url = URL(string: raw), let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = url.host, !host.isEmpty
        else { throw ResolveError.invalidURL(key: key, value: raw) }
        // A trailing slash would double up with the paths appended to it.
        if raw.hasSuffix("/"), let trimmed = URL(string: String(raw.dropLast())) { return trimmed }
        return url
    }

    /// True for a backend on this machine (the local stack): http is allowed there.
    public var isLocal: Bool {
        let hosts = ["localhost", "127.0.0.1", "::1"]
        return hosts.contains(apiBaseURL.host ?? "") || hosts.contains(supabaseURL.host ?? "")
    }
}

/// Reads claims out of a JWT's payload without verifying it (the server verifies; this only stops a
/// wrong kind of key from being used).
enum JWTClaims {
    static func payload(of token: String) -> [String: Any]? {
        let parts = token.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3 else { return nil }
        var base64 = parts[1].replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 { base64 += "=" }
        guard let data = Data(base64Encoded: base64),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return object
    }

    static func role(of token: String) -> String? {
        payload(of: token)?["role"] as? String
    }
}
