import Foundation

/// POSTs JSON to a streaming route and hands back its Server-Sent Events as they arrive, like the
/// web's `streamLiveSse` and `streamAsk` (src/lib/live/sseClient.ts, src/lib/live/ask/client.ts):
///
/// - a non-2xx before the stream (signed out, rate limited, out of ink, a bad body) throws
///   `APIError.http` with the server's error, as any API call does
/// - nothing arriving for `stallTimeout` (before the response or between chunks; the server's
///   `: ping` every 15 s counts) throws `APIError.timeout`
/// - stopping the iteration (or cancelling its task) cancels the request
public final class SSEClient: Sendable {
    public let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    /// Every frame, until the stream ends.
    public func frames(path: String, body: Data, stallTimeout: Duration) -> ServerEvents<SSEFrame> {
        let api = self.api
        return ServerEvents {
            let (stream, continuation) = AsyncThrowingStream<SSEFrame, Error>.makeStream()
            let task = Task {
                do {
                    _ = try await Self.run(api: api, path: path, body: body, stallTimeout: stallTimeout) { frame in
                        if case .terminated = continuation.yield(frame) { return false }
                        return true
                    }
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: APIError.wrap(error))
                }
            }
            continuation.onTermination = { _ in task.cancel() }
            return (stream, task)
        }
    }

    /// Typed events: each frame through `decode` (a frame it returns nil for is skipped: a newer
    /// server may send events this app does not know), until an event `isTerminal` says ends it.
    /// With `requireTerminal`, a stream that closes before one throws `APIError.incomplete`.
    public func events<Event: Sendable>(
        path: String,
        body: Data,
        stallTimeout: Duration,
        requireTerminal: Bool,
        decode: @escaping @Sendable (SSEFrame) -> Event?,
        isTerminal: @escaping @Sendable (Event) -> Bool
    ) -> ServerEvents<Event> {
        let api = self.api
        return ServerEvents {
            let (stream, continuation) = AsyncThrowingStream<Event, Error>.makeStream()
            let task = Task {
                do {
                    // Stopped early only by a terminal event or by the consumer going away.
                    let stopped = try await Self.run(api: api, path: path, body: body, stallTimeout: stallTimeout) { frame in
                        guard let event = decode(frame) else { return true }
                        if case .terminated = continuation.yield(event) { return false }
                        return !isTerminal(event)
                    }
                    if requireTerminal && !stopped && !Task.isCancelled {
                        continuation.finish(throwing: APIError.incomplete)
                    } else {
                        continuation.finish()
                    }
                } catch is CancellationError {
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: APIError.wrap(error))
                }
            }
            continuation.onTermination = { _ in task.cancel() }
            return (stream, task)
        }
    }

    /// Reads the stream, handing each frame to `onFrame` until it answers false (then returns true)
    /// or the stream ends (false), with a watchdog that fails the read after `stallTimeout` of silence.
    static func run(
        api: APIClient,
        path: String,
        body: Data,
        stallTimeout: Duration,
        onFrame: @escaping @Sendable (SSEFrame) -> Bool
    ) async throws -> Bool {
        let activity = ActivityClock()
        return try await withThrowingTaskGroup(of: Bool.self) { group in
            group.addTask {
                var attempt = 0
                var opened: (HTTPURLResponse, AsyncThrowingStream<Data, Error>)
                while true {
                    attempt += 1
                    let request = try await api.makeRequest(.post, path, body: body, accept: "text/event-stream")
                    opened = try await api.transport.stream(for: request)
                    activity.touch()
                    if (200 ..< 300).contains(opened.0.statusCode) { break }
                    var data = Data()
                    for try await chunk in opened.1 {
                        activity.touch()
                        data.append(chunk)
                        if data.count > 64 * 1024 { break }
                    }
                    // a stale session (back from a long background): refreshed once, then asked again
                    if attempt == 1, await api.refreshedAfterUnauthorized(status: opened.0.statusCode, body: data) { continue }
                    throw APIError.http(HTTPFailure(response: opened.0, body: data))
                }
                let chunks = opened.1
                var parser = SSEParser()
                for try await chunk in chunks {
                    activity.touch()
                    for frame in parser.push(chunk) {
                        if !onFrame(frame) { return true }
                    }
                }
                try Task.checkCancellation()
                for frame in parser.finish() {
                    if !onFrame(frame) { return true }
                }
                return false
            }
            group.addTask {
                let tick = max(.milliseconds(10), min(.seconds(1), stallTimeout / 10))
                while true {
                    try await Task.sleep(for: tick)
                    if activity.idle() >= stallTimeout { throw APIError.timeout }
                }
            }
            // Whichever ends first (the stream, or the watchdog's timeout) ends both.
            defer { group.cancelAll() }
            return try await group.next() ?? false
        }
    }
}

/// When the stream last showed a sign of life.
final class ActivityClock: @unchecked Sendable {
    private let lock = NSLock()
    private var last = ContinuousClock.now

    func touch() {
        lock.withLock { last = .now }
    }

    func idle() -> Duration {
        lock.withLock { ContinuousClock.now - last }
    }
}
