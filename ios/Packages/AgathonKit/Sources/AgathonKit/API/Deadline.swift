import Foundation

/// How long each AI path may take from the iPad before the kid is told something (the v1 speed
/// lane). Each is sized to its route: a little over the server's own deadline for it, and under the
/// route's `maxDuration` plus the round trip, so the server's honest error (a `timeout` frame, a 503)
/// arrives first when it can, and the iPad's own deadline only catches a connection that went quiet.
///
/// | path | server | iPad |
/// |---|---|---|
/// | recognize (pen-up → read) | Mathpix 4 s, the vision read 6 s | 6 s (`LiveTiming.recognizeTimeoutMs`) |
/// | reread (the second reader) | 4 s a model, two models | 10 s |
/// | setup (a word problem's equations) | 12 s a model, 20 s in all | 22 s |
/// | check (Help me, Check, Auto) | 25 s in all, maxDuration 30 | 28 s |
/// | solve (Show me, Solve it) | 55 s in all, maxDuration 60 | 58 s |
/// | ask | 50 s in all, maxDuration 90 | 75 s (30 s with no byte at all) |
/// | speak (one phrase of Ask's voice) | first byte 8 s | 12 s |
/// | the session's token (a refresh) | — | 10 s |
public enum AIDeadline {
    public static let reread: Duration = .seconds(10)
    public static let setup: Duration = .seconds(22)
    public static let check: Duration = .seconds(28)
    public static let solve: Duration = .seconds(58)
    public static let ask: Duration = .seconds(75)
    public static let speak: Duration = .seconds(12)
    /// GET /api/live/recognize (which reader is in use): free, and nothing waits on it long
    public static let capabilities: Duration = .seconds(8)
    /// the Supabase session's token, refreshed when it is about to expire
    public static let token: Duration = .seconds(10)
}

/// `body`'s value, or `APIError.timeout` once `limit` has passed (the body is cancelled: a URLSession
/// request under it is cancelled with it). A cancellation of the caller stays a CancellationError.
public func withDeadline<T: Sendable>(_ limit: Duration, _ body: @escaping @Sendable () async throws -> T) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask { try await body() }
        group.addTask {
            try await Task.sleep(for: limit)
            throw APIError.timeout
        }
        defer { group.cancelAll() }
        guard let first = try await group.next() else { throw APIError.timeout }
        return first
    }
}
