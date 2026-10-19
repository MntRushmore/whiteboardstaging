import AgathonKit
import Foundation

/// Ask's calls to the server, so the session can be tested with a fake.
public protocol AskTransport: Sendable {
    /// POST /api/live/ask, streamed: `model`, `delta`*, `reply`, `actions`, `done` (or `error`).
    /// Throws an `APIError` before the stream (signed out, rate limited, out of ink), a
    /// `StreamError` for an `error` event.
    func ask(_ request: AskRequest) -> AsyncThrowingStream<AskEvent, Error>
    /// GET /api/live/ask/history for a screen: nil for none; `retry` when a later view may try again
    func history(boardId: String, screen: AskHistoryScreen?) async -> (history: AskHistoryResponse?, retry: Bool)
    /// POST /api/live/ask/history/move: the turns follow a screen the tutor started
    func move(boardId: String, turnIds: [String], screenId: String) async -> Bool
}

/// The transport on AgathonKit's API client and SSE.
public final class LiveAskTransport: AskTransport {
    public let api: APIClient
    public let live: LiveAPI

    public init(api: APIClient, live: LiveAPI) {
        self.api = api
        self.live = live
    }

    @MainActor
    public convenience init(backend: AgathonBackend) {
        self.init(api: backend.api, live: backend.live)
    }

    public func ask(_ request: AskRequest) -> AsyncThrowingStream<AskEvent, Error> {
        let live = self.live
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    for try await event in try live.ask(request) {
                        if case .error(let e) = event {
                            continuation.finish(throwing: e)
                            return
                        }
                        continuation.yield(event)
                        if event.isTerminal { break }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    public func history(boardId: String, screen: AskHistoryScreen?) async -> (history: AskHistoryResponse?, retry: Bool) {
        var query = [URLQueryItem(name: "boardId", value: boardId)]
        if let screen {
            query.append(URLQueryItem(name: "screenId", value: screen.id))
            query.append(URLQueryItem(name: "first", value: screen.first ? "1" : "0"))
        }
        do {
            let response: AskHistoryResponse = try await api.get(AskPaths.history, query: query)
            return (response, false)
        } catch let error as APIError {
            // a board that is not the student's has none, quietly; a dropped connection, a 5xx or
            // being rate limited may be tried again on a later view
            switch error {
            case .http(let f): return (nil, f.status >= 500 || f.status == 429)
            case .timeout, .network, .incomplete: return (nil, true)
            default: return (nil, false)
            }
        } catch is CancellationError {
            return (nil, true)
        } catch {
            return (nil, false)
        }
    }

    public func move(boardId: String, turnIds: [String], screenId: String) async -> Bool {
        struct Body: Encodable { var boardId: String; var turnIds: [String]; var screenId: String }
        var ids: [String] = []
        for id in turnIds where !id.isEmpty && !ids.contains(id) { ids.append(id) }
        guard !ids.isEmpty else { return false }
        do {
            let _: EmptyResponse = try await api.post(AskPaths.move, body: Body(boardId: boardId, turnIds: Array(ids.prefix(4)), screenId: screenId))
            return true
        } catch {
            return false
        }
    }
}
