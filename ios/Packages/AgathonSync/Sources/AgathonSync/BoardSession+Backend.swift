import AgathonBoard
import AgathonKit
import Foundation

extension SupabaseConnection {
    /// The signed-in user's connection: the backend's project and key, its transport, and the
    /// session's access token (refreshed by supabase-swift before it expires).
    @MainActor
    public static func signedIn(_ backend: AgathonBackend, transport: any HTTPTransport = URLSessionTransport()) -> SupabaseConnection {
        let client = backend.supabase
        return SupabaseConnection(environment: backend.environment, transport: transport, token: {
            try await AuthService.accessToken(from: client)
        })
    }
}

extension BoardSession {
    /// A board of the signed-in user, read and saved through the backend: PostgREST for the row,
    /// `board-assets` for its pictures, the device backups under the user's folder.
    @MainActor
    public static func make(boardId: String, backend: AgathonBackend, controller: BoardController? = nil) -> BoardSession? {
        guard let userId = backend.auth.userId else { return nil }
        let connection = SupabaseConnection.signedIn(backend)
        return BoardSession(
            boardId: boardId, remote: PostgrestBoardRemote(connection: connection),
            assets: SupabaseBoardAssetStore(connection: connection, userId: userId),
            backup: BoardBackupStore.forUser(userId), controller: controller)
    }
}
