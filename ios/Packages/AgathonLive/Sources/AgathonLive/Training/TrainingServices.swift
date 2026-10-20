import AgathonKit
import Foundation

/// The Live routes as the Training Center calls them: the real routes (production by default, the
/// local stack when the build points there) with three differences —
///
///  1. every paid call says `"training": true`: a server with the training pass (admins only) answers
///     without spending the admin's ink or counting toward fair use, rate limited and logged as
///     training (an older server ignores the key and charges as usual: the screens warn first);
///  2. a call budget: past `budget` calls every paid call fails at once (`TrainingBudgetSpent`), so a
///     run never costs more than the owner set;
///  3. a record of every call: the routes and their counts, and each recognizer answer with the
///     strokes it was asked about (a regression fixture replays those instead of calling Mathpix).
public final class TrainingServices: LiveServices, @unchecked Sendable {
    public let api: APIClient
    public let live: LiveAPI
    public let recognizeTimeout: Duration
    private let lock = NSLock()
    private var _budget: Int
    private var _calls: [String: Int] = [:]
    private var _reads: [RecordedRead] = []
    private var _refused = 0
    private let started = Date()

    public init(api: APIClient, live: LiveAPI, budget: Int, recognizeTimeout: Duration = .milliseconds(Int(LiveTiming.recognizeTimeoutMs))) {
        self.api = api
        self.live = live
        _budget = budget
        self.recognizeTimeout = recognizeTimeout
    }

    @MainActor public convenience init(backend: AgathonBackend, budget: Int) {
        self.init(api: backend.api, live: backend.live, budget: budget)
    }

    // MARK: - the budget and the record

    /// The run's call budget (calls to the paid routes). Raising it lets a stopped run go on.
    public var budget: Int {
        get { lock.withLock { _budget } }
        set { lock.withLock { _budget = newValue } }
    }

    /// Paid calls made so far, by route (`recognize`, `reread`, `setup`, `check`, `solve`).
    public var calls: [String: Int] { lock.withLock { _calls } }
    public var totalCalls: Int { lock.withLock { _calls.values.reduce(0, +) } }
    /// Calls refused because the budget was spent.
    public var refused: Int { lock.withLock { _refused } }
    public var spent: Bool { lock.withLock { _calls.values.reduce(0, +) >= _budget } }
    /// Every recognizer answer so far.
    public var reads: [RecordedRead] { lock.withLock { _reads } }

    /// Takes one call from the budget, or refuses.
    func spend(_ route: String) throws {
        try lock.withLock {
            guard _calls.values.reduce(0, +) < _budget else {
                _refused += 1
                throw TrainingBudgetSpent()
            }
            _calls[route, default: 0] += 1
        }
    }

    private func record(_ read: RecordedRead) {
        lock.withLock { _reads.append(read) }
    }

    // MARK: - LiveServices

    /// GET /api/live/recognize: free, and not counted.
    public func capabilities() async throws -> LiveCapabilities {
        try await api.get(LiveAPIServices.recognizePath, as: LiveCapabilities.self)
    }

    public func recognize(_ request: RecognizeRequest) async throws -> RecognizeResponse {
        try spend("recognize")
        let api = self.api
        let t0 = Date()
        let at = t0.timeIntervalSince(started)
        do {
            let res = try await LiveAPIServices.withTimeout(recognizeTimeout) {
                try await api.post(LiveAPIServices.recognizePath, body: Training(body: request), as: RecognizeResponse.self)
            }
            record(RecordedRead(lineId: request.lineId, x: request.strokes.x, y: request.strokes.y, w: request.bounds.w, h: request.bounds.h,
                                latex: res.latex, confidence: res.confidence, provider: res.provider, ms: Date().timeIntervalSince(t0) * 1000,
                                error: nil, at: at))
            return res
        } catch {
            record(RecordedRead(lineId: request.lineId, x: request.strokes.x, y: request.strokes.y, w: request.bounds.w, h: request.bounds.h,
                                latex: nil, confidence: nil, provider: nil, ms: Date().timeIntervalSince(t0) * 1000,
                                error: String(String(describing: error).prefix(160)), at: at))
            throw error
        }
    }

    public func reread(_ request: RereadRequest) async throws -> RereadResponse {
        try spend("reread")
        return try await api.post(LiveAPIServices.rereadPath, body: Training(body: request), as: RereadResponse.self)
    }

    public func setup(_ request: SetupRequest) async throws -> SetupResponse {
        try spend("setup")
        return try await api.post(LiveAPIServices.setupPath, body: Training(body: request), as: SetupResponse.self)
    }

    public func check(_ request: CheckRequest) -> LiveEventStream {
        do { try spend("check") } catch { return LiveEventStream { $0.finish(throwing: error) } }
        let live = self.live
        return LiveAPIServices.stream { try live.check(Training(body: request)) }
    }

    public func solve(_ request: SolveRequest) -> LiveEventStream {
        do { try spend("solve") } catch { return LiveEventStream { $0.finish(throwing: error) } }
        let live = self.live
        return LiveAPIServices.stream { try live.solve(Training(body: request)) }
    }
}

/// A request body with `"training": true` added (the server's training pass reads it; the routes'
/// schemas strip it when there is none).
struct Training<Body: Encodable>: Encodable {
    let body: Body

    private enum Key: String, CodingKey { case training }

    func encode(to encoder: Encoder) throws {
        try body.encode(to: encoder)
        var c = encoder.container(keyedBy: Key.self)
        try c.encode(true, forKey: .training)
    }
}

/// The run's call budget is spent: the call was not made.
public struct TrainingBudgetSpent: Error, LocalizedError, Equatable {
    public init() {}
    public var errorDescription: String? { "The run's call budget is spent." }
}

/// What the server says about training calls (`GET /api/training/status`, admins only): a server
/// without it (404) would charge a training call as an ordinary one.
public struct TrainingStatus: Codable, Sendable, Equatable {
    public struct Limits: Codable, Sendable, Equatable {
        public var perMinute: Int
        public var perDay: Int
    }
    public var training: Bool
    public var routes: [String]
    public var limits: Limits

    public static let path = "/api/training/status"

    /// The server's answer: its status, nil when it has no training pass (an older deployment), or an
    /// error when it could not be asked.
    public static func fetch(_ api: APIClient) async -> Result<TrainingStatus?, Error> {
        do {
            return .success(try await api.get(path, as: TrainingStatus.self))
        } catch let APIError.http(failure) where failure.status == 404 {
            return .success(nil)
        } catch {
            return .failure(error)
        }
    }
}
