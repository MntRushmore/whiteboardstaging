import Foundation
import Observation
import Supabase

/// Everything the app talks to, made once at launch and handed to the screens
/// (`.environment(backend)`): auth, the API, the tutor's streams, family profiles, boards, the
/// profile and ink, and error reports.
@MainActor
@Observable
public final class AgathonBackend {
    public let environment: AgathonEnvironment
    public let release: AppRelease
    /// supabase-swift, for the lanes that read and write tables and Storage directly.
    public let supabase: SupabaseClient
    public let auth: AuthService
    public let api: APIClient
    public let live: LiveAPI
    public let family: FamilyService
    public let boards: BoardsRepository
    public let profiles: ProfileRepository
    public let errors: ClientErrorReporter

    /// - Parameters:
    ///   - authStorage: where the session is kept; nil is the Keychain (the app). Tests and previews
    ///     pass `InMemoryAuthStorage()`.
    ///   - transport: the API's transport; nil is URLSession.
    public init(
        environment: AgathonEnvironment = .current,
        release: AppRelease,
        authStorage: (any AuthLocalStorage)? = nil,
        transport: (any HTTPTransport)? = nil
    ) {
        self.environment = environment
        self.release = release

        let session = URLSessionTransport.makeSession()
        let authOptions: SupabaseClientOptions.AuthOptions
        // Implicit, as the web's client: an email link (reset, confirm) then works in any browser,
        // which a PKCE link would not (its code verifier lives on this device only).
        if let authStorage {
            authOptions = .init(storage: authStorage, flowType: .implicit, autoRefreshToken: true,
                                emitLocalSessionAsInitialSession: true)
        } else {
            authOptions = .init(flowType: .implicit, autoRefreshToken: true, emitLocalSessionAsInitialSession: true)
        }
        let supabase = SupabaseClient(
            supabaseURL: environment.supabaseURL,
            supabaseKey: environment.supabaseAnonKey,
            options: SupabaseClientOptions(auth: authOptions, global: .init(session: session))
        )
        self.supabase = supabase

        let auth = AuthService(client: supabase, webBaseURL: environment.apiBaseURL)
        self.auth = auth
        let api = APIClient(
            baseURL: environment.apiBaseURL,
            transport: transport ?? URLSessionTransport(session: session),
            token: { try await AuthService.accessToken(from: supabase) }
        )
        self.api = api
        live = LiveAPI(sse: SSEClient(api: api))
        family = FamilyService(api: api) { result in
            try await auth.setSession(accessToken: result.accessToken, refreshToken: result.refreshToken)
        }
        boards = BoardsRepository(client: supabase)
        profiles = ProfileRepository(client: supabase)
        errors = ClientErrorReporter(api: api, release: release)
    }
}
