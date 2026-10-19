import AgathonKit
import Foundation

/// The check and solve streams' events (AgathonKit's typed SSE events).
public typealias LiveEventStream = AsyncThrowingStream<LiveEvent, Error>

/// The Live routes, as the loop calls them. `LiveAPIServices` is the app's (AgathonKit's API client:
/// the bearer token, the error shapes, SSE); tests pass a scripted fake.
public protocol LiveServices: Sendable {
    /// GET /api/live/recognize: which recognizer is in use (with `vision`, reads send a crop)
    func capabilities() async throws -> LiveCapabilities
    /// POST /api/live/recognize: one line's strokes → LaTeX (1 ink)
    func recognize(_ request: RecognizeRequest) async throws -> RecognizeResponse
    /// POST /api/live/reread: the second reader, one suspicious line (1 ink)
    func reread(_ request: RereadRequest) async throws -> RereadResponse
    /// POST /api/live/setup: a word problem's equations (2 ink)
    func setup(_ request: SetupRequest) async throws -> SetupResponse
    /// POST /api/live/check (SSE): `meta`, `annotation`*, `done` (3 ink)
    func check(_ request: CheckRequest) -> LiveEventStream
    /// POST /api/live/solve (SSE): `meta`, `step`*, `done` (10 ink)
    func solve(_ request: SolveRequest) -> LiveEventStream
}

/// The Live routes over AgathonKit: `APIClient` for the JSON routes, `LiveAPI` for the streams.
public final class LiveAPIServices: LiveServices {
    public let api: APIClient
    public let live: LiveAPI
    /// A read abandoned after this (the web's `recognizeTimeoutMs`); the server gives up a second sooner.
    public let recognizeTimeout: Duration
    /// The backend these routes belong to, when made from one: the loop's learning record saves as
    /// its signed-in student (`LiveLearning.connect(backend:)`).
    public let backend: AgathonBackend?
    /// Debug only (the UI tests, `-liveMisread "3x = 15=>3 \\times = 15"`): a read rewritten before the
    /// loop sees it, the second reader's too, so a misread can be shown on purpose. Nil in the app.
    public let misread: (from: String, to: String)?

    public init(api: APIClient, live: LiveAPI, recognizeTimeout: Duration = .milliseconds(Int(LiveTiming.recognizeTimeoutMs)),
                backend: AgathonBackend? = nil, misread: (from: String, to: String)? = nil) {
        self.api = api
        self.live = live
        self.recognizeTimeout = recognizeTimeout
        self.backend = backend
        self.misread = misread
    }

    @MainActor public convenience init(backend: AgathonBackend, misread: (from: String, to: String)? = nil) {
        self.init(api: backend.api, live: backend.live, backend: backend, misread: misread)
    }

    static func flat(_ latex: String) -> String {
        latex.replacingOccurrences(of: #"\s+"#, with: "", options: .regularExpression)
    }

    func misreading(_ latex: String) -> String? {
        guard let m = misread, Self.flat(latex) == Self.flat(m.from) else { return nil }
        return m.to
    }

    public static let recognizePath = "/api/live/recognize"
    public static let rereadPath = "/api/live/reread"
    public static let setupPath = "/api/live/setup"

    public func capabilities() async throws -> LiveCapabilities {
        try await api.get(Self.recognizePath, as: LiveCapabilities.self)
    }

    public func recognize(_ request: RecognizeRequest) async throws -> RecognizeResponse {
        let api = self.api
        var res = try await Self.withTimeout(recognizeTimeout) {
            try await api.post(Self.recognizePath, body: request, as: RecognizeResponse.self)
        }
        if let wrong = misreading(res.latex) { res.latex = wrong }
        return res
    }

    public func reread(_ request: RereadRequest) async throws -> RereadResponse {
        var res = try await api.post(Self.rereadPath, body: request, as: RereadResponse.self)
        if let wrong = misreading(res.latex) { res.latex = wrong }
        return res
    }

    public func setup(_ request: SetupRequest) async throws -> SetupResponse {
        try await api.post(Self.setupPath, body: request, as: SetupResponse.self)
    }

    public func check(_ request: CheckRequest) -> LiveEventStream {
        let live = self.live
        return Self.stream { try live.check(request) }
    }

    public func solve(_ request: SolveRequest) -> LiveEventStream {
        let live = self.live
        return Self.stream { try live.solve(request) }
    }

    /// The server's events as one stream; stopping the iteration (or cancelling its task) cancels
    /// the request.
    static func stream(_ open: @escaping @Sendable () throws -> ServerEvents<LiveEvent>) -> LiveEventStream {
        LiveEventStream { continuation in
            let task = Task {
                do {
                    for try await event in try open() {
                        continuation.yield(event)
                        if event.isTerminal { break }
                    }
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// `body`, or `APIError.timeout` after `limit`.
    static func withTimeout<T: Sendable>(_ limit: Duration, _ body: @escaping @Sendable () async throws -> T) async throws -> T {
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
}
