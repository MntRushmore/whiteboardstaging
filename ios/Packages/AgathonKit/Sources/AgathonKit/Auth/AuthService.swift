import Foundation
import Observation
import Supabase

/// Who is signed in, and signing in and out (email and password, as the web's /login).
///
/// The session lives in supabase-swift, which keeps it in the Keychain and refreshes it before it
/// expires. This mirrors it for SwiftUI (`phase`, `userId`, `email`) and hands the API client a
/// fresh token (`accessToken(from:)`). Call `start()` once at launch.
@MainActor
@Observable
public final class AuthService {
    public enum Phase: Sendable, Equatable {
        /// Reading the stored session at launch.
        case restoring
        case signedOut
        case signedIn
    }

    /// An auth change, as the app sees it.
    public enum Event: Sendable, Equatable {
        case initialSession
        case signedIn
        case signedOut
        case tokenRefreshed
        case userUpdated
        case passwordRecovery
        case other(String)

        init(_ event: AuthChangeEvent) {
            switch event {
            case .initialSession: self = .initialSession
            case .signedIn: self = .signedIn
            case .signedOut: self = .signedOut
            case .tokenRefreshed: self = .tokenRefreshed
            case .userUpdated: self = .userUpdated
            case .passwordRecovery: self = .passwordRecovery
            default: self = .other(event.rawValue)
            }
        }
    }

    /// One change and who is signed in after it.
    public struct Change: Sendable, Equatable {
        public let event: Event
        public let userId: String?
    }

    /// What sign-up did.
    public enum SignUpOutcome: Sendable, Equatable {
        /// The account exists and is signed in.
        case signedIn
        /// The project asks for email confirmation: no session until the link is opened.
        case confirmEmail
    }

    public private(set) var phase: Phase = .restoring
    /// The signed-in user's id (a uuid, lowercased as Supabase writes it).
    public private(set) var userId: String?
    public private(set) var email: String?
    /// An anonymous session (SAT mode with no account, `POST /api/sat/anon`, docs/SAT-MODE.md): it may
    /// use SAT practice and nothing else until it becomes a real account (`upgradeAnonymous`).
    public private(set) var isAnonymous = false

    public let client: SupabaseClient
    /// Where an email link (reset, confirm) sends the browser: the web's pages on the API's host,
    /// until the app has universal links.
    public let webBaseURL: URL

    @ObservationIgnored private var listener: Task<Void, Never>?

    public init(client: SupabaseClient, webBaseURL: URL) {
        self.client = client
        self.webBaseURL = webBaseURL
    }

    /// Starts following the session. Idempotent.
    public func start() {
        guard listener == nil else { return }
        listener = Task { [weak self, client] in
            for await (event, session) in client.auth.authStateChanges {
                guard let self else { return }
                self.apply(event: event, session: session)
            }
        }
    }

    private func apply(event: AuthChangeEvent, session: Session?) {
        if let session, event != .signedOut {
            userId = session.user.id.uuidString.lowercased()
            email = session.user.email
            isAnonymous = session.user.isAnonymous
            phase = .signedIn
        } else {
            userId = nil
            email = nil
            isAnonymous = false
            phase = .signedOut
        }
    }

    /// Every auth change from now on (the initial session first). A new stream per call.
    public func changes() -> AsyncStream<Change> {
        let source = client.auth.authStateChanges
        return AsyncStream { continuation in
            let task = Task {
                for await (event, session) in source {
                    let userId = event == .signedOut ? nil : session?.user.id.uuidString.lowercased()
                    continuation.yield(Change(event: Event(event), userId: userId))
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: signing in and out

    public func signIn(email: String, password: String) async throws {
        let session = try await client.auth.signIn(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
        apply(event: .signedIn, session: session)
    }

    /// Creates an account. The Terms version goes into the new account's user metadata in the same
    /// request (src/lib/loginForm.ts `signUpRequest`): the database refuses an account without it.
    @discardableResult
    public func signUp(email: String, password: String) async throws -> SignUpOutcome {
        let response = try await client.auth.signUp(
            email: email.trimmingCharacters(in: .whitespacesAndNewlines),
            password: password,
            data: Self.signUpMetadata
        )
        if let session = response.session {
            apply(event: .signedIn, session: session)
            return .signedIn
        }
        return .confirmEmail
    }

    /// `options.data` of a sign-up.
    public nonisolated static var signUpMetadata: [String: AnyJSON] {
        ["terms_version": .string(TermsVersion.current)]
    }

    /// Emails a reset link. The link opens the web's reset page until the app has a universal link
    /// for it (docs/IPAD-NATIVE.md, phase 6).
    public func sendPasswordReset(email: String) async throws {
        try await client.auth.resetPasswordForEmail(
            email.trimmingCharacters(in: .whitespacesAndNewlines),
            redirectTo: webBaseURL.appendingPathComponent("reset-password")
        )
    }

    /// Signs out. `.global` (the default, as the web's sign-out) ends every session of the account;
    /// `.local` only this device's.
    public func signOut(scope: SignOutScope = .global) async throws {
        try await client.auth.signOut(scope: scope)
        apply(event: .signedOut, session: nil)
    }

    /// Makes the anonymous session a real account: the SAME user (its SAT attempts, passes and board
    /// carry over), given an email and a password and the Terms version (as sign-up sends it). The
    /// project may ask the email to be confirmed first: then the user stays anonymous until the link
    /// is opened (`.confirmEmail`).
    @discardableResult
    public func upgradeAnonymous(email: String, password: String) async throws -> SignUpOutcome {
        guard isAnonymous else { throw APIError.notSignedIn }
        // the Terms acceptance FIRST, as a sign-up sends it: the database refuses to make an anonymous
        // user permanent without it (docs/SAT-MODE.md, "Upgrading")
        _ = try await client.auth.update(user: UserAttributes(data: Self.signUpMetadata))
        let user = try await client.auth.update(user: UserAttributes(
            email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password))
        if let session = client.auth.currentSession { apply(event: .userUpdated, session: session) }
        isAnonymous = user.isAnonymous
        self.email = user.email ?? self.email
        // still anonymous, or the new address waits for its link: the account is not finished yet
        let waiting = user.isAnonymous || (user.emailConfirmedAt == nil && user.newEmail != nil)
        return waiting ? .confirmEmail : .signedIn
    }

    /// Takes a session minted elsewhere (POST /api/family/switch).
    public func setSession(accessToken: String, refreshToken: String) async throws {
        let session = try await client.auth.setSession(accessToken: accessToken, refreshToken: refreshToken)
        apply(event: .signedIn, session: session)
    }

    // MARK: the token for API calls

    /// Refresh when the token has less than this left.
    public nonisolated static let refreshMargin: TimeInterval = 60

    /// The access token for an API call: the stored one, refreshed first when it expires within
    /// `refreshMargin`. Nil when signed out. Safe to call from any task.
    public nonisolated static func accessToken(from client: SupabaseClient, now: Date = Date()) async throws -> String? {
        guard let session = client.auth.currentSession else { return nil }
        if session.expiresAt - now.timeIntervalSince1970 > refreshMargin { return session.accessToken }
        return try await client.auth.refreshSession().accessToken
    }

    // MARK: words

    /// The person's own mistake (a wrong email or password, a weak password, an address already
    /// used), not a failure of ours: shown, never reported (the web's loginFailureReport).
    public nonisolated static func isUsersOwnMistake(_ error: Error) -> Bool {
        guard let error = error as? AuthError else { return false }
        return [.invalidCredentials, .emailNotConfirmed, .userAlreadyExists, .emailExists, .weakPassword].contains(error.errorCode)
    }

    /// What a sign-in, sign-up or reset failure says (the web's LOGIN_COPY, src/lib/loginErrorMessage.ts).
    public nonisolated static func message(for error: Error) -> String {
        if let error = error as? AuthError {
            switch error.errorCode {
            case .invalidCredentials: return "That email and password don't match. Check them and try again."
            case .emailNotConfirmed: return "Confirm your email first: open the link we sent you, then sign in."
            case .userAlreadyExists, .emailExists: return "An account with this email already exists. Sign in instead."
            case .weakPassword: return "Use a password with at least 8 characters."
            case .overEmailSendRateLimit, .overRequestRateLimit: return "Too many attempts for now. Wait a minute, then try again."
            default: break
            }
            if case let .api(_, _, _, response) = error, response.statusCode == 429 {
                return "Too many attempts for now. Wait a minute, then try again."
            }
        }
        if error is URLError { return "Can't reach the sign-in service. Check your connection and try again." }
        if let error = error as? APIError, let description = error.errorDescription { return description }
        return "Sign-in didn't complete. Try again in a moment."
    }
}
