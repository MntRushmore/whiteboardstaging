import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation
@testable import AgathonLive

/// The loop's clock, moved by hand: timers fire in order as `advance` passes their deadline.
@MainActor
final class ManualScheduler: LiveScheduler {
    private(set) var now: Double = 1_000
    private var timers: [(due: Double, seq: Int, timer: LiveTimer, body: @MainActor () -> Void)] = []
    private var seq = 0

    @discardableResult
    func after(_ ms: Double, _ body: @escaping @MainActor () -> Void) -> LiveTimer {
        let timer = LiveTimer()
        seq += 1
        timers.append((now + max(0, ms), seq, timer, body))
        return timer
    }

    /// Moves the clock on, firing each timer due on the way (at its own time).
    func advance(_ ms: Double) {
        let end = now + ms
        while true {
            timers.removeAll { $0.timer.isCancelled }
            guard let next = timers.filter({ $0.due <= end }).min(by: { ($0.due, $0.seq) < ($1.due, $1.seq) }) else { break }
            timers.removeAll { $0.seq == next.seq }
            now = max(now, next.due)
            next.timer.cancel()
            next.body()
        }
        now = end
    }

    var pending: Int { timers.filter { !$0.timer.isCancelled }.count }
}

/// A board in memory: one screen, the tutor's writing straight into the store (or held, to test the
/// kid writing while the tutor is mid-block).
@MainActor
final class TestBoard: LiveBoard {
    let store: BoardStore
    var currentScreenID: RecordID
    var screenRect: BrainRect { (store[currentScreenID]?.screen?.rect ?? .screen).rect }
    var fitZoom: Double? = 0.74
    var selection: [RecordID] = []
    var isPenDown = false
    var reduceMotion = true
    var onPen: ((Bool) -> Void)?
    var onHover: ((AgathonBrain.Point?) -> Void)?
    var onScreenChange: ((RecordID) -> Void)?
    /// hold every write until `finishWrites()`
    var holdWrites = false
    private(set) var pens: [InstantPen] = []
    /// every block the tutor wrote: its lines' LaTeX and its meta
    private(set) var writes: [(latex: [String], meta: Meta)] = []

    init() {
        store = BoardStore(document: .blank())
        currentScreenID = store.screenIDs[0]
    }

    func write(_ lines: [TutorLine], meta: Meta, onDone: @escaping @MainActor () -> Void) -> TutorPen {
        let pen = InstantPen(store: store, screen: currentScreenID)
        pens.append(pen)
        writes.append((lines.map(\.latex), meta))
        if holdWrites {
            pen.hold(lines, meta: meta) { onDone() }
        } else {
            pen.write(lines, meta: meta) { onDone() }
        }
        return pen
    }

    func finishWrites() {
        for p in pens where p.isWriting { p.finish() }
    }

    func addScreen() -> RecordID? {
        let s = ScreenRecord(order: OrderKey.after(store.screens.last?.order))
        store.put(.screen(s), origin: .kid)
        currentScreenID = s.id
        onScreenChange?(s.id)
        return s.id
    }

    // problem pages: as the board's controller does them

    func goToScreen(_ id: RecordID) {
        guard id != currentScreenID, store[id]?.screen != nil else { return }
        currentScreenID = id
        onScreenChange?(id)
    }

    func moveToNewScreen(_ ids: [RecordID], offset: Vec2, meta: Meta, alsoRemove: [RecordID]) -> RecordID? {
        let from = currentScreenID
        let moving = ids.compactMap { store.stroke($0) }.filter { $0.screen == from }
        guard !moving.isEmpty else { return nil }
        let screens = store.screens
        let i = screens.firstIndex { $0.id == from }
        let next = i.flatMap { $0 + 1 < screens.count ? screens[$0 + 1].order : nil }
        let order = (i.flatMap { try? OrderKey.between(screens[$0].order, next) }) ?? OrderKey.after(screens.last?.order)
        let screen = ScreenRecord(order: order, meta: meta)
        store.transact(.kid) { tx in
            tx.put(.screen(screen))
            var key = OrderKey.first
            for var s in moving.sorted(by: { $0.order < $1.order }) {
                s.screen = screen.id
                s.order = key
                s.x += offset.x
                s.y += offset.y
                tx.put(.stroke(s))
                key = OrderKey.after(key)
            }
            for id in alsoRemove where tx[id] != nil { tx.remove(id) }
        }
        goToScreen(screen.id)
        return screen.id
    }

    // MARK: the kid's pen

    /// Strokes the kid wrote (page coordinates), one undo step each, as the canvas commits them.
    @discardableResult
    func kidWrites(_ strokes: [[Vec2]]) -> [RecordID] {
        var ids: [RecordID] = []
        for pts in strokes where !pts.isEmpty {
            let origin = pts[0]
            let s = StrokeRecord(screen: currentScreenID, order: store.nextOrder(on: currentScreenID), author: .kid, color: .black,
                                 width: 6, pressure: .simulated, x: origin.x, y: origin.y,
                                 points: pts.map { InkPoint(x: $0.x - origin.x, y: $0.y - origin.y) }, start: 0)
            store.put(.stroke(s), origin: .kid)
            ids.append(s.id)
        }
        return ids
    }

    func erase(_ ids: [RecordID]) {
        store.remove(ids, origin: .kid)
    }

    // MARK: reading the board

    var marks: [MarkRecord] {
        store.records.values.compactMap { if case .mark(let m) = $0 { return m } else { return nil } }
    }

    var lineRecords: [LineRecord] {
        store.records.values.compactMap { if case .line(let l) = $0 { return l } else { return nil } }
    }

    var problems: [ProblemRecord] {
        store.records.values.compactMap { if case .problem(let p) = $0 { return p } else { return nil } }
    }

    var tutorStrokes: [StrokeRecord] {
        store.records.values.compactMap { if case .stroke(let s) = $0, s.author == .tutor { return s } else { return nil } }
    }

    /// The kind of mark on the line whose read is `latex` (nil: none).
    func mark(on latex: String) -> AgathonBoard.MarkKind? {
        guard let line = lineRecords.first(where: { $0.latex == latex }) else { return nil }
        return marks.first { $0.target == line.id }?.kind
    }

    /// Tutor strokes carrying this meta key (with this value, when given).
    func tutorStrokes(withMeta key: String, _ value: String? = nil) -> [StrokeRecord] {
        tutorStrokes.filter { s in
            guard let v = s.meta[key]?.stringValue else { return false }
            return value == nil || v == value
        }
    }
}

/// The Live routes, scripted. Reads are answered by the strokes they carry (registered per line of
/// fixture ink); a gate holds a call until the test lets it go.
final class FakeServices: LiveServices, @unchecked Sendable {
    private let lock = NSLock()
    private var reads: [String: RecognizeResponse] = [:]
    private var _recognizeRequests: [RecognizeRequest] = []
    private var _checkRequests: [CheckRequest] = []
    private var _solveRequests: [SolveRequest] = []
    private var _setupRequests: [SetupRequest] = []
    private var _rereadRequests: [RereadRequest] = []
    /// errors the next recognize calls throw, in order
    private var readErrors: [Error] = []
    private var readGates: [CheckedContinuation<Void, Never>] = []
    private var holdReads = false
    /// a read takes this long (real time), when set: the bench's network
    var readLatency: (@Sendable () -> Duration)?
    var capabilitiesRecognizer = "mathpix"
    var checkEvents: [[LiveEvent]] = []
    var solveEvents: [[LiveEvent]] = []
    var checkError: Error?
    var holdChecks = false
    private var checkCancelled = 0
    var setupReply: SetupResponse?
    var rereadReply: RereadResponse?

    var recognizeRequests: [RecognizeRequest] { lock.withLock { _recognizeRequests } }
    var checkRequests: [CheckRequest] { lock.withLock { _checkRequests } }
    var solveRequests: [SolveRequest] { lock.withLock { _solveRequests } }
    var setupRequests: [SetupRequest] { lock.withLock { _setupRequests } }
    var rereadRequests: [RereadRequest] { lock.withLock { _rereadRequests } }
    var cancelledChecks: Int { lock.withLock { checkCancelled } }

    static func signature(_ x: [[Double]], _ y: [[Double]]) -> String { "\(x)|\(y)" }

    func register(_ payload: RecognizerPayload, as response: RecognizeResponse) {
        lock.withLock { reads[Self.signature(payload.strokes.x, payload.strokes.y)] = response }
    }

    func failNextReads(_ errors: [Error]) {
        lock.withLock { readErrors.append(contentsOf: errors) }
    }

    /// Holds reads until `releaseReads()`.
    func holdReadsNow() {
        lock.withLock { holdReads = true }
    }

    func releaseReads() {
        let gates = lock.withLock { () -> [CheckedContinuation<Void, Never>] in
            holdReads = false
            let g = readGates
            readGates = []
            return g
        }
        gates.forEach { $0.resume() }
    }

    /// Reads held right now.
    var heldReads: Int { lock.withLock { readGates.count } }

    func capabilities() async throws -> LiveCapabilities {
        LiveCapabilities(recognizer: capabilitiesRecognizer, liveEnabled: true, models: nil)
    }

    func recognize(_ request: RecognizeRequest) async throws -> RecognizeResponse {
        let (hold, error) = lock.withLock { () -> (Bool, Error?) in
            _recognizeRequests.append(request)
            return (holdReads, readErrors.isEmpty ? nil : readErrors.removeFirst())
        }
        if hold { await withCheckedContinuation { c in lock.withLock { readGates.append(c) } } }
        if let latency = readLatency { try await Task.sleep(for: latency()) }
        if let error { throw error }
        let hit = lock.withLock { reads[Self.signature(request.strokes.x, request.strokes.y)] }
        guard let hit else { throw APIError.http(HTTPFailure(status: 503, code: "recognizer_failed", message: "no fake read", body: .object(["unreadable": .bool(true)]))) }
        return hit
    }

    func reread(_ request: RereadRequest) async throws -> RereadResponse {
        lock.withLock { _rereadRequests.append(request) }
        if let r = rereadReply { return r }
        return RereadResponse(latex: request.latex, changed: false, model: "fake", ms: 1)
    }

    func setup(_ request: SetupRequest) async throws -> SetupResponse {
        lock.withLock { _setupRequests.append(request) }
        guard let r = setupReply else { throw APIError.http(HTTPFailure(status: 502, code: "upstream_error", message: "no setup")) }
        return r
    }

    func check(_ request: CheckRequest) -> LiveEventStream {
        let (events, error, hold) = lock.withLock { () -> ([LiveEvent], Error?, Bool) in
            _checkRequests.append(request)
            return (checkEvents.isEmpty ? [] : checkEvents.removeFirst(), checkError, holdChecks)
        }
        return LiveEventStream { continuation in
            let task = Task {
                if hold {
                    do { try await Task.sleep(for: .seconds(3600)) } catch { return }
                }
                for e in events { continuation.yield(e) }
                if let error { continuation.finish(throwing: error) } else { continuation.finish() }
            }
            continuation.onTermination = { [weak self] reason in
                task.cancel()
                if case .cancelled = reason { self?.lock.withLock { self?.checkCancelled += 1 } }
            }
        }
    }

    func solve(_ request: SolveRequest) -> LiveEventStream {
        let events = lock.withLock { () -> [LiveEvent] in
            _solveRequests.append(request)
            return solveEvents.isEmpty ? [] : solveEvents.removeFirst()
        }
        return LiveEventStream { continuation in
            for e in events { continuation.yield(e) }
            continuation.finish()
        }
    }
}

/// The kid's handwriting from the web's handwriting scoreboard (`Tools/make-fixtures.mjs`).
enum KidHands {
    struct File: Decodable {
        struct Stroke: Decodable {
            var x: [Double]
            var y: [Double]
        }
        var variants: [String]
        var lines: [String: [String: [Stroke]]]
    }

    static let file: File = {
        let url = Bundle.module.url(forResource: "kid-hands", withExtension: "json", subdirectory: "Fixtures")!
        return try! JSONDecoder().decode(File.self, from: Data(contentsOf: url))
    }()

    /// `latex` in a hand, its ink box's top-left at `at`, scaled.
    static func strokes(_ latex: String, hand: String = "clean", at: Vec2, scale: Double = 1.4) -> [[Vec2]] {
        guard let s = file.lines[latex]?[hand] else { fatalError("no fixture ink for \(latex) (\(hand))") }
        return s.map { st in zip(st.x, st.y).map { Vec2(at.x + $0 * scale, at.y + $1 * scale) } }
    }
}

/// One brain for every test (loading costs ~0.3 s).
enum TestBrain {
    static let shared = Brain()
    static let background = Brain()
}

/// A loop on a test board, with the kid's writing and the clock in hand.
@MainActor
final class Harness {
    let board = TestBoard()
    let scheduler = ManualScheduler()
    let services = FakeServices()
    let connectivity = ManualConnectivity()
    let loop: LiveLoop
    /// the line → its kid strokes
    private(set) var written: [String: [RecordID]] = [:]

    /// `checking`: the suites written before problem pages test the tutor as it was ("as I go");
    /// `ProblemPagesLoopTests` tests "when they're done".
    init(mode: LiveMode = .feedback, auto: Bool = true, readsEarly: Bool = true, checking: CheckTiming = .asIGo) {
        loop = LiveLoop(board: board, boardId: "test-board", services: services,
                        settings: LiveSettings(enabled: true, mode: mode, auto: auto, handwriting: true, celebrations: true, checking: checking),
                        brain: TestBrain.shared, background: TestBrain.background, scheduler: scheduler, connectivity: connectivity)
        loop.readsEarly = readsEarly
    }

    func start() async {
        loop.start()
        await idle()
    }

    /// How long `idle` waits for the loop's work (short while a test holds a call on purpose).
    var idleTimeout: Duration = .seconds(20)

    /// Lets the loop's async work (the brain, the fake network) run to the end.
    func idle() async {
        for _ in 0..<3 {
            await loop.waitUntilIdle(timeout: idleTimeout)
            await Task.yield()
        }
    }

    /// The kid writes `latex` (fixture ink) at `at`; the fake recognizer will read it as `reads`.
    @discardableResult
    /// `confidence`: Mathpix's for the read (under 0.99 the tutor asks "Is this right?" and rings nothing,
    /// with problem pages' second part on)
    /// `second`: the route's second opinion on the line (its read, and whether it agreed)
    func write(_ latex: String, at: Vec2, hand: String = "clean", reads: String? = nil, confidence: Double = 0.995, scale: Double = 1.4,
               second: (latex: String, agree: Bool)? = nil) async -> [RecordID] {
        let ink = KidHands.strokes(latex, hand: hand, at: at, scale: scale)
        let ids = board.kidWrites(ink)
        await register(ids, reads: reads ?? latex, confidence: confidence, second: second)
        written[latex] = ids
        return ids
    }

    /// The fake recognizer reads these strokes (as the board stores them) as `reads`.
    func register(_ ids: [RecordID], reads: String, confidence: Double = 0.995, second: (latex: String, agree: Bool)? = nil) async {
        let set = Set(ids.map(\.rawValue))
        let strokes = board.store.kidStrokes(on: board.currentScreenID).filter { set.contains($0.id) }
        if let payload = try? await TestBrain.shared.recognizerPayload(strokes) {
            services.register(payload, as: RecognizeResponse(latex: reads, confidence: confidence,
                                                             second: second.map { .init(latex: $0.latex, confidence: 0.97) }, agree: second?.agree))
        }
    }

    /// The clock moves on `ms`, and everything that starts runs.
    func pass(_ ms: Double) async {
        var left = ms
        while left > 0 {
            let step = min(left, 100)
            scheduler.advance(step)
            left -= step
            await idle()
        }
    }
}
