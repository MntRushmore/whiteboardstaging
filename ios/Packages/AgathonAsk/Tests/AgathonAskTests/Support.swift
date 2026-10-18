@testable import AgathonAsk
import AgathonBoard
import AgathonBrain
import AgathonKit
import AgathonLive
import Foundation

/// A server in memory: each ask answers with the next script's events (or throws), the saved chat
/// per screen, and the moves it was asked for.
final class FakeTransport: AskTransport, @unchecked Sendable {
    enum Step {
        case event(AskEvent)
        case fail(Error)
        /// waits until `release()`
        case hold
    }

    private let lock = NSLock()
    private var scripts: [[Step]] = []
    private(set) var requests: [AskRequest] = []
    var histories: [String: (AskHistoryResponse?, Bool)] = [:]
    private(set) var historyCalls: [AskHistoryScreen?] = []
    private(set) var moves: [(turnIds: [String], screenId: String)] = []
    private var gate: CheckedContinuation<Void, Never>?

    func script(_ steps: [Step]) {
        lock.withLock { scripts.append(steps) }
    }

    func release() {
        lock.withLock {
            gate?.resume()
            gate = nil
        }
    }

    func ask(_ request: AskRequest) -> AsyncThrowingStream<AskEvent, Error> {
        let steps: [Step] = lock.withLock {
            requests.append(request)
            return scripts.isEmpty ? [] : scripts.removeFirst()
        }
        return AsyncThrowingStream { continuation in
            let task = Task {
                for step in steps {
                    if Task.isCancelled { break }
                    switch step {
                    case .event(let e):
                        continuation.yield(e)
                    case .fail(let error):
                        continuation.finish(throwing: error)
                        return
                    case .hold:
                        await withCheckedContinuation { k in self.lock.withLock { self.gate = k } }
                    }
                    await Task.yield()
                }
                if Task.isCancelled {
                    continuation.finish(throwing: CancellationError())
                } else {
                    continuation.finish()
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    func history(boardId: String, screen: AskHistoryScreen?) async -> (history: AskHistoryResponse?, retry: Bool) {
        lock.withLock {
            historyCalls.append(screen)
            return histories[screen?.id ?? ""] ?? (nil, false)
        }
    }

    func move(boardId: String, turnIds: [String], screenId: String) async -> Bool {
        lock.withLock { moves.append((turnIds, screenId)) }
        return true
    }
}

/// A board for the session: its screen, its picture, and a run that reports what it was given.
@MainActor
final class FakeBoard: AskBoardContext {
    var screenRef: AskScreenRef
    var shot = AskScreen(empty: true)
    var imageURL: String?
    var onScreenChange: ((AskScreenRef) -> Void)?
    private(set) var runs: [[AgathonKit.JSONValue]] = []
    var report = AskRunReport(outcomes: [AskActionOutcome(type: "write_problems", ok: true)], problemsWritten: 3)
    /// a run starts this screen part-way (the tutor's own new screen)
    var startsScreen: AskScreenRef?

    init(screen: AskScreenRef = AskScreenRef(id: "page:one", index: 1)) {
        screenRef = screen
    }

    func picture() async -> AskScreen { shot }
    func image() async -> String? { imageURL }

    func run(_ actions: [AgathonKit.JSONValue], onTutorScreen: @escaping @MainActor (AskScreenRef) -> Void) async -> AskRunReport {
        runs.append(actions)
        if let s = startsScreen {
            screenRef = s
            onTutorScreen(s)
            onScreenChange?(s)
        }
        return report
    }

    func move(to ref: AskScreenRef) {
        screenRef = ref
        onScreenChange?(ref)
    }
}

/// Read-aloud as the session tells it.
@MainActor
final class FakeSpeech: AskSpeechSink {
    var log: [String] = []
    func start(_ id: String) { log.append("start") }
    func feed(_ id: String, _ text: String) { log.append("feed:\(text)") }
    func finish(_ id: String, _ text: String) { log.append("finish:\(text)") }
    func stop() { log.append("stop") }
}

/// Waits (on the main actor) until `cond` holds, at most `seconds`.
@MainActor
func eventually(_ seconds: Double = 5, _ cond: () -> Bool) async -> Bool {
    let end = Date().addingTimeInterval(seconds)
    while !cond() {
        if Date() > end { return false }
        try? await Task.sleep(for: .milliseconds(10))
    }
    return true
}

/// A board in memory for the planner's operations (AgathonLive's `LiveBoard`): one screen, the
/// tutor's writing straight into the store.
@MainActor
final class MemoryBoard: LiveBoard {
    let store: BoardStore
    var currentScreenID: RecordID
    var screenRect: BrainRect { (store[currentScreenID]?.screen?.rect ?? .screen).rect }
    var fitZoom: Double? = 0.74
    var selection: [RecordID] = []
    var isPenDown = false
    var reduceMotion = true
    var onPen: ((Bool) -> Void)?
    var onScreenChange: ((RecordID) -> Void)?
    private(set) var writes: [(lines: [TutorLine], meta: Meta)] = []

    init() {
        store = BoardStore(document: .blank())
        currentScreenID = store.screenIDs[0]
    }

    func write(_ lines: [TutorLine], meta: Meta, onDone: @escaping @MainActor () -> Void) -> TutorPen {
        let pen = InstantPen(store: store, screen: currentScreenID)
        writes.append((lines, meta))
        pen.write(lines, meta: meta) { onDone() }
        return pen
    }

    func addScreen() -> RecordID? {
        let s = ScreenRecord(order: OrderKey.after(store.screens.last?.order))
        store.put(.screen(s), origin: .kid)
        currentScreenID = s.id
        onScreenChange?(s.id)
        return s.id
    }

    /// The kid's ink: a few strokes across a line at `y`.
    func kidLine(y: Double, x: Double = 120) {
        for i in 0..<5 {
            let origin = Vec2(x + Double(i) * 40, y)
            let pts = [Vec2(0, 0), Vec2(12, 30), Vec2(24, 4)]
            let s = StrokeRecord(screen: currentScreenID, order: store.nextOrder(on: currentScreenID), author: .kid, color: .black, width: 6,
                                 pressure: .simulated, x: origin.x, y: origin.y, points: pts.map { InkPoint(x: Float($0.x), y: Float($0.y)) }, start: 0)
            store.put(.stroke(s), origin: .kid)
        }
    }

    var tutorStrokes: [StrokeRecord] {
        store.drawables(on: currentScreenID).compactMap { r in
            if case .stroke(let s) = r, s.author == .tutor { return s }
            return nil
        }
    }
}

extension Box {
    var rect: BrainRect { BrainRect(x: x, y: y, w: w, h: h) }
}

/// A brain for the tests: one per process (loading takes a moment).
enum TestBrain {
    static let shared = Brain()
}

/// A board whose pen writes a moment later and only while something holds it (the canvas board's
/// `TutorWriter` drives itself through a weak reference): a pen let go never finishes.
@MainActor
final class SlowPenBoard: LiveBoard {
    let inner = MemoryBoard()
    var store: BoardStore { inner.store }
    var currentScreenID: RecordID { inner.currentScreenID }
    var screenRect: BrainRect { inner.screenRect }
    var fitZoom: Double? = 0.74
    var selection: [RecordID] = []
    var isPenDown = false
    var reduceMotion = false
    var onPen: ((Bool) -> Void)?
    var onScreenChange: ((RecordID) -> Void)?

    final class Pen: TutorPen {
        var isWriting = true
        let wallMs: Double = 30
        func cancel() { isWriting = false }
    }

    func write(_ lines: [TutorLine], meta: Meta, onDone: @escaping @MainActor () -> Void) -> TutorPen {
        let pen = Pen()
        let store = inner.store
        let screen = inner.currentScreenID
        Task { @MainActor [weak pen] in
            try? await Task.sleep(for: .milliseconds(30))
            guard let pen else { return }
            InstantPen(store: store, screen: screen).write(lines, meta: meta)
            pen.isWriting = false
            onDone()
        }
        return pen
    }

    func addScreen() -> RecordID? { inner.addScreen() }
}
