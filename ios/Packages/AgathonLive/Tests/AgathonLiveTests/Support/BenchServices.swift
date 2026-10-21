import AgathonBrain
import AgathonKit
import CryptoKit
import Foundation
@testable import AgathonLive

/// The Live routes as the HEADLESS bench calls them (`TrainingBenchTests`): the real routes of a chosen
/// server through `TrainingServices` (`"training": true`, admins only, no ink), behind
///
///  - a **cache** of every answer a run got (reads by their payload, the model's checks by what they
///    were asked, the second reader's by its line): a later run asks the server only for ink it has
///    never seen, so a bench after a fix costs only what the fix changed;
///  - **two budgets** (reads, and everything else) that refuse a call once spent;
///  - a **pace** under the routes' own rate limits (reads 120 a minute, checks 30);
///  - a record per case (its board id) of every read it got, so a failure becomes a regression fixture.
///
/// Three modes: `server` (the routes, cache first), `replay` (the cache alone: a miss is unreadable)
/// and `oracle` (no server at all: a line is read as exactly what was written when its strokes are
/// one or more whole written lines, else unreadable — the tutor's logic with perfect reads, for
/// triage and for counting the calls a server run would make).
final class BenchServices: LiveServices, @unchecked Sendable {
    enum Mode: String {
        case server, replay, oracle
    }

    struct Counts: Codable, Equatable {
        var recognizeCalls = 0
        var recognizeCached = 0
        var recognizeMisses = 0
        var otherCalls: [String: Int] = [:]
        var otherCached = 0
        var otherMisses = 0
        var hintsLocal = 0
        var refused = 0
        var errors = 0
    }

    /// What a run keeps for the next one.
    struct Cache: Codable {
        var reads: [RecordedRead] = []
        var checks: [String: [CachedAnnotation]] = [:]
        var rereads: [String: RereadResponse] = [:]
    }

    /// An annotation of the model's, its line named by what the line said (line ids change run to run).
    struct CachedAnnotation: Codable, Equatable {
        var lineLatex: String?
        var verdict: String
        var kind: String
        var message: String
        var question: String?
        var latex: String?
        var expected: String?
        var confidence: Double
    }

    let mode: Mode
    let upstream: TrainingServices?
    /// hint words (a check the kid asked for on a ringed slip) from the server too; off, the loop's own
    /// words (the bench judges marks, not hint words)
    let hintsFromServer: Bool
    let maxRecognize: Int
    let maxOther: Int
    private let lock = NSLock()
    private var cache: Cache
    private var readIndex: [String: Int] = [:]
    private var counts = Counts()
    private var perCase: [String: [RecordedRead]] = [:]
    private var perCaseCalls: [String: [String: Int]] = [:]
    /// a line's written LaTeX for its strokes (oracle mode), per board
    private var oracles: [String: @MainActor (RecognizeRequest) async -> String?] = [:]
    private let readPace = Pace(perMinute: 100)
    private let checkPace = Pace(perMinute: 24)

    init(mode: Mode, upstream: TrainingServices?, cache: Cache, hintsFromServer: Bool, maxRecognize: Int, maxOther: Int) {
        self.mode = mode
        self.upstream = upstream
        self.cache = cache
        self.hintsFromServer = hintsFromServer
        self.maxRecognize = maxRecognize
        self.maxOther = maxOther
        for (i, r) in cache.reads.enumerated() where r.latex != nil { readIndex[Self.key(r.x, r.y)] = i }
    }

    static func key(_ x: [[Double]], _ y: [[Double]]) -> String {
        let data = (try? JSONEncoder().encode([x, y])) ?? Data()
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    var snapshot: (counts: Counts, cache: Cache) { lock.withLock { (counts, cache) } }

    /// The budget is spent: the run stops before its next case.
    var spent: Bool {
        guard mode == .server else { return false }
        return lock.withLock { counts.recognizeCalls >= maxRecognize || counts.otherCalls.values.reduce(0, +) >= maxOther }
    }

    func begin(_ boardId: String, oracle: (@MainActor (RecognizeRequest) async -> String?)?) {
        lock.withLock {
            perCase[boardId] = []
            perCaseCalls[boardId] = [:]
            oracles[boardId] = oracle
        }
    }

    /// The case is over: its reads and its calls.
    func end(_ boardId: String) -> (reads: [RecordedRead], calls: [String: Int]) {
        lock.withLock {
            defer {
                perCase[boardId] = nil
                perCaseCalls[boardId] = nil
                oracles[boardId] = nil
            }
            return (perCase[boardId] ?? [], perCaseCalls[boardId] ?? [:])
        }
    }

    private func note(_ boardId: String, _ read: RecordedRead) {
        lock.withLock { perCase[boardId, default: []].append(read) }
    }

    private func called(_ boardId: String, _ route: String) {
        lock.withLock { perCaseCalls[boardId, default: [:]][route, default: 0] += 1 }
    }

    static func unreadable(_ why: String) -> Error {
        APIError.http(HTTPFailure(status: 503, code: "recognizer_failed", message: why, body: .object(["unreadable": .bool(true)])))
    }

    // MARK: - LiveServices

    func capabilities() async throws -> LiveCapabilities {
        LiveCapabilities(recognizer: "mathpix", liveEnabled: true, models: nil)
    }

    func recognize(_ request: RecognizeRequest) async throws -> RecognizeResponse {
        let k = Self.key(request.strokes.x, request.strokes.y)
        func recorded(_ latex: String?, _ res: RecognizeResponse?, ms: Double, error: String?) -> RecordedRead {
            RecordedRead(lineId: request.lineId, x: request.strokes.x, y: request.strokes.y, w: request.bounds.w, h: request.bounds.h,
                         latex: latex, confidence: res?.confidence, provider: res?.provider, ms: ms, error: error, at: 0)
        }
        // 1. the cache
        let hit: RecordedRead? = lock.withLock {
            guard let i = readIndex[k] else { return nil }
            counts.recognizeCached += 1
            return cache.reads[i]
        }
        if let hit, let latex = hit.latex {
            note(request.boardId, hit)
            return RecognizeResponse(latex: latex, confidence: hit.confidence ?? 0.99, provider: hit.provider ?? "mathpix", ms: hit.ms)
        }
        switch mode {
        case .replay:
            lock.withLock { counts.recognizeMisses += 1 }
            note(request.boardId, recorded(nil, nil, ms: 0, error: "not in the cache"))
            throw Self.unreadable("not in the cache")
        case .oracle:
            lock.withLock { counts.recognizeMisses += 1 }
            let oracle = lock.withLock { oracles[request.boardId] }
            guard let oracle, let latex = await oracle(request) else {
                note(request.boardId, recorded(nil, nil, ms: 0, error: "the oracle: not whole written lines"))
                throw Self.unreadable("the oracle: not whole written lines")
            }
            let res = RecognizeResponse(latex: latex, confidence: 0.995, provider: "mathpix", ms: 1)
            note(request.boardId, recorded(latex, res, ms: 1, error: nil))
            return res
        case .server:
            guard let upstream else { throw Self.unreadable("no server") }
            let allowed: Bool = lock.withLock {
                guard counts.recognizeCalls < maxRecognize else {
                    counts.refused += 1
                    return false
                }
                counts.recognizeCalls += 1
                return true
            }
            guard allowed else { throw TrainingBudgetSpent() }
            called(request.boardId, "recognize")
            await readPace.wait()
            let t0 = Date()
            do {
                let res = try await upstream.recognize(request)
                let read = recorded(res.latex, res, ms: Date().timeIntervalSince(t0) * 1000, error: nil)
                lock.withLock {
                    cache.reads.append(read)
                    readIndex[k] = cache.reads.count - 1
                }
                note(request.boardId, read)
                return res
            } catch {
                lock.withLock { counts.errors += 1 }
                note(request.boardId, recorded(nil, nil, ms: Date().timeIntervalSince(t0) * 1000, error: String(String(describing: error).prefix(160))))
                throw error
            }
        }
    }

    func reread(_ request: RereadRequest) async throws -> RereadResponse {
        let crop = SHA256.hash(data: Data(request.crop.utf8)).prefix(8).map { String(format: "%02x", $0) }.joined()
        let key = "\(request.latex)|\(request.above.joined(separator: ";"))|\(request.below.joined(separator: ";"))|\(crop)"
        if let hit = lock.withLock({ () -> RereadResponse? in
            let h = cache.rereads[key]
            if h != nil { counts.otherCached += 1 }
            return h
        }) { return hit }
        guard mode == .server, let upstream else {
            lock.withLock { counts.otherMisses += 1 }
            return RereadResponse(latex: request.latex, changed: false, model: "bench", ms: 1)
        }
        try spendOther("reread", boardId: request.boardId)
        await checkPace.wait()
        let res = try await upstream.reread(request)
        lock.withLock { cache.rereads[key] = res }
        return res
    }

    func setup(_ request: SetupRequest) async throws -> SetupResponse {
        guard mode == .server, let upstream else { throw APIError.http(HTTPFailure(status: 502, code: "upstream_error", message: "no setup on the bench")) }
        try spendOther("setup", boardId: request.boardId)
        return try await upstream.setup(request)
    }

    func check(_ request: CheckRequest) -> LiveEventStream {
        if request.userAsked && !hintsFromServer {
            // a hint on a ringed slip: its words are not what the bench judges (the loop words it itself)
            lock.withLock { counts.hintsLocal += 1 }
            return LiveEventStream { $0.finish() }
        }
        let byId = Dictionary(request.lines.map { ($0.id, $0.latex) }, uniquingKeysWith: { a, _ in a })
        let byLatex = Dictionary(request.lines.map { ($0.latex, $0.id) }, uniquingKeysWith: { a, _ in a })
        let focus = request.focusLineId.flatMap { byId[$0] } ?? ""
        let key = "\(request.mode)|\(request.userAsked)|\(focus)|" + request.lines.map { "\($0.latex)~\($0.local.verdict)" }.joined(separator: ";")
        let cached: [CachedAnnotation]? = lock.withLock {
            let h = cache.checks[key]
            if h != nil { counts.otherCached += 1 }
            return h
        }
        if let cached {
            return LiveEventStream { c in
                for a in cached {
                    if let ann = Self.annotation(a, lineId: a.lineLatex.flatMap { byLatex[$0] }) { c.yield(.annotation(ann)) }
                }
                c.finish()
            }
        }
        guard mode == .server, let upstream else {
            lock.withLock { counts.otherMisses += 1 }
            return LiveEventStream { $0.finish() }
        }
        do { try spendOther("check", boardId: request.boardId) } catch { return LiveEventStream { $0.finish(throwing: error) } }
        let pace = checkPace
        return LiveEventStream { c in
            let task = Task {
                await pace.wait()
                var got: [CachedAnnotation] = []
                do {
                    for try await event in upstream.check(request) {
                        if case .annotation(let a) = event {
                            got.append(CachedAnnotation(lineLatex: a.lineId.flatMap { byId[$0] }, verdict: a.verdict.rawValue, kind: a.kind,
                                                        message: a.message, question: a.question, latex: a.latex, expected: a.expected,
                                                        confidence: a.confidence))
                        }
                        c.yield(event)
                    }
                    self.lock.withLock { self.cache.checks[key] = got }
                    c.finish()
                } catch {
                    self.lock.withLock { self.counts.errors += 1 }
                    c.finish(throwing: error)
                }
            }
            c.onTermination = { _ in task.cancel() }
        }
    }

    func solve(_ request: SolveRequest) -> LiveEventStream {
        guard mode == .server, let upstream else { return LiveEventStream { $0.finish() } }
        do { try spendOther("solve", boardId: request.boardId) } catch { return LiveEventStream { $0.finish(throwing: error) } }
        return upstream.solve(request)
    }

    private func spendOther(_ route: String, boardId: String) throws {
        let ok: Bool = lock.withLock {
            guard counts.otherCalls.values.reduce(0, +) < maxOther else {
                counts.refused += 1
                return false
            }
            counts.otherCalls[route, default: 0] += 1
            return true
        }
        guard ok else { throw TrainingBudgetSpent() }
        called(boardId, route)
    }

    static func annotation(_ a: CachedAnnotation, lineId: String?) -> Annotation? {
        var o: [String: Any] = ["verdict": a.verdict, "kind": a.kind, "message": a.message, "confidence": a.confidence]
        if let lineId { o["lineId"] = lineId }
        if let q = a.question { o["question"] = q }
        if let l = a.latex { o["latex"] = l }
        if let e = a.expected { o["expected"] = e }
        guard let data = try? JSONSerialization.data(withJSONObject: o) else { return nil }
        return try? JSONDecoder().decode(Annotation.self, from: data)
    }
}

/// At most `perMinute` calls in any minute: a caller over it waits its turn.
actor Pace {
    let perMinute: Int
    private var times: [Date] = []

    init(perMinute: Int) {
        self.perMinute = perMinute
    }

    func wait() async {
        while true {
            let now = Date()
            times.removeAll { now.timeIntervalSince($0) > 60 }
            if times.count < perMinute {
                times.append(now)
                return
            }
            let wait = 60 - now.timeIntervalSince(times[0]) + 0.05
            try? await Task.sleep(for: .milliseconds(Int(max(50, wait * 1000))))
        }
    }
}
