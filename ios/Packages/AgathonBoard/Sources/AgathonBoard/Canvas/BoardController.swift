import Combine
import Foundation

/// What changed on the current screen, for the renderer.
public struct SceneDelta {
    /// items new or changed, bottom to top
    public var added: [RenderItem] = []
    /// bounds of items removed or changed (their old place)
    public var removedBounds: [Box] = []
    /// every added item is new and on top of the screen (the common case: a stroke drawn): the
    /// renderer can paint them over what it has instead of redrawing the area
    public var appendsOnTop = true

    public var isEmpty: Bool { added.isEmpty && removedBounds.isEmpty }
}

/// Draws the current screen. The canvas (UIKit) implements it; tests can too.
@MainActor
public protocol BoardRendering: AnyObject {
    /// a new screen or a new board: draw everything; call `done` once it is on screen
    func sceneReset(_ index: SceneIndex, screen: ScreenRecord, done: @escaping () -> Void)
    /// some records of the current screen changed
    func sceneChanged(_ delta: SceneDelta, index: SceneIndex)
}

/// The tools of Phase 0.
public enum BoardTool: String, Sendable {
    case pen
    case eraser
}

/// The board as the app uses it: the store, the current screen, the tool in hand, the input rules
/// (palm rejection, drawing with a finger) and the numbers for the stats overlay. Platform-neutral;
/// the UIKit canvas draws it and feeds it strokes.
@MainActor
public final class BoardController: ObservableObject {
    public let store: BoardStore
    public weak var renderer: BoardRendering? {
        didSet { if renderer != nil { resetScene() } }
    }

    @Published public private(set) var currentScreenID: RecordID
    @Published public private(set) var screenIndex = 1
    @Published public private(set) var screenCount = 1
    @Published public var tool: BoardTool = .pen
    @Published public var color: InkColor = .black {
        didSet { if !InkColor.kidPalette.contains(color) { color = .black } } // never the tutor's
    }
    @Published public var penSize: InkStyle.PenSize = .regular
    @Published public private(set) var canUndo = false
    @Published public private(set) var canRedo = false
    /// The running numbers. Not published per change: SwiftUI re-laying out whatever shows them
    /// inside a stroke's commit cost 4–8 ms (measured); `publishedStats` follows at most 4× a second.
    public var stats = BoardStats() {
        didSet { schedulePublishStats() }
    }
    @Published public private(set) var publishedStats = BoardStats()
    private var statsPublishPending = false
    /// the screen's records are being laid out / rasterized (a big board opening)
    @Published public private(set) var isLoading = false

    /// Draw with a finger even after a Pencil has been seen (the setting; on the simulator, which has
    /// no Pencil, it starts on).
    @Published public var drawWithFinger: Bool {
        didSet { defaults.set(drawWithFinger, forKey: Self.fingerKey) }
    }
    /// A Pencil has drawn on this device (remembered): from then on a finger never draws unless the
    /// setting says so, so a palm resting before the first stroke of a session leaves no mark.
    @Published public private(set) var pencilSeen: Bool

    public var fingerDraws: Bool { drawWithFinger || !pencilSeen }

    /// Keep the Pencil's altitude and azimuth on each point. Off: nothing draws with it yet, and it
    /// costs 2 bytes a point (a fifth of a stroke). The model and the encoding carry it when on.
    public var storesTilt = false

    public private(set) var scene = SceneIndex()
    private var subscription: StoreSubscription?
    private let defaults: UserDefaults
    private var sceneGeneration = 0
    private var docBytesTask: Task<Void, Never>?

    static let fingerKey = "agathon.board.drawWithFinger"
    static let pencilKey = "agathon.board.pencilSeen"

    public init(document: BoardDocument = .blank(), defaults: UserDefaults = .standard) {
        self.defaults = defaults
        store = BoardStore(document: document)
        #if targetEnvironment(simulator)
        let fingerDefault = true
        #else
        let fingerDefault = false
        #endif
        drawWithFinger = defaults.object(forKey: Self.fingerKey) as? Bool ?? fingerDefault
        pencilSeen = defaults.bool(forKey: Self.pencilKey)
        currentScreenID = store.screenIDs.first ?? "screen:none"
        ensureScreen()
        subscription = store.observe { [weak self] change in self?.storeChanged(change) }
        refreshCounts()
    }

    // MARK: - Input rules

    /// A Pencil touched the board.
    public func notePencil() {
        guard !pencilSeen else { return }
        pencilSeen = true
        defaults.set(true, forKey: Self.pencilKey)
    }

    /// For tests and the lab: forget the Pencil.
    public func forgetPencil() {
        pencilSeen = false
        defaults.removeObject(forKey: Self.pencilKey)
    }

    // MARK: - Loading

    public var currentScreen: ScreenRecord? { store[currentScreenID]?.screen }

    /// Opens a document (on `screen`, else the first).
    public func load(_ document: BoardDocument, screen: RecordID? = nil) {
        store.load(document)
        if let screen, store[screen]?.screen != nil {
            currentScreenID = screen
        } else {
            currentScreenID = store.screenIDs.first ?? "screen:none"
        }
        ensureScreen()
        refreshCounts()
        resetScene()
    }

    private func ensureScreen() {
        if store.screenIDs.isEmpty {
            let s = ScreenRecord(order: .first)
            store.put(.screen(s), origin: .system)
            currentScreenID = s.id
        } else if store[currentScreenID]?.screen == nil {
            currentScreenID = store.screenIDs[0]
        }
    }

    /// Lays out and draws the current screen from scratch (off the main thread for a big screen).
    public func resetScene(onDrawn: (() -> Void)? = nil) {
        sceneGeneration += 1
        let generation = sceneGeneration
        guard let screen = currentScreen else { return }
        let records = store.drawables(on: screen.id)
        let started = CFAbsoluteTimeGetCurrent()
        let finish: (SceneIndex) -> Void = { [weak self] index in
            guard let self, generation == self.sceneGeneration else { return }
            self.scene = index
            let laidOut = CFAbsoluteTimeGetCurrent()
            guard let renderer = self.renderer else {
                self.isLoading = false
                onDrawn?()
                return
            }
            renderer.sceneReset(index, screen: screen) { [weak self] in
                guard let self, generation == self.sceneGeneration else { return }
                let drawn = CFAbsoluteTimeGetCurrent()
                self.isLoading = false
                self.stats.lastLoadMs = (drawn - started) * 1000
                self.stats.lastLoadBreakdown = String(
                    format: "%d items: layout %.0f ms, tiles %.0f ms", index.count, (laidOut - started) * 1000, (drawn - laidOut) * 1000)
                onDrawn?()
            }
        }
        isLoading = true
        if records.count < 200 {
            finish(SceneIndex.build(records))
        } else {
            Task.detached(priority: .userInitiated) {
                let index = SceneIndex.build(records)
                await MainActor.run { finish(index) }
            }
        }
    }

    // MARK: - Store changes → scene

    private func schedulePublishStats() {
        guard !statsPublishPending else { return }
        statsPublishPending = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            guard let self else { return }
            self.statsPublishPending = false
            self.publishedStats = self.stats
        }
    }

    private func storeChanged(_ change: ChangeSet) {
        if canUndo != store.canUndo { canUndo = store.canUndo }
        if canRedo != store.canRedo { canRedo = store.canRedo }
        if change.origin == .load { return } // `load` resets the scene itself

        let t0 = CFAbsoluteTimeGetCurrent()
        var screensChanged = false
        var delta = SceneDelta()
        var addedNew = Set<RecordID>()
        for id in change.ids {
            let before = change.before(id)
            let after = change.after(id)
            if before?.type == .screen || after?.type == .screen {
                screensChanged = true
                continue
            }
            let wasHere = before.map { $0.isDrawable && $0.screenID == currentScreenID } ?? false
            let isHere = after.map { $0.isDrawable && $0.screenID == currentScreenID } ?? false
            if wasHere, let old = scene.remove(id) {
                delta.removedBounds.append(old.bounds)
            }
            if isHere, let after, let item = RenderGeometry.item(for: after) {
                scene.upsert(item)
                delta.added.append(item)
                if before == nil { addedNew.insert(id) }
            }
        }
        if !delta.isEmpty {
            delta.added.sort { $0.order != $1.order ? $0.order < $1.order : $0.id < $1.id }
            // on top only if every added item is new and they are the topmost records of the screen
            let top = store.topDrawableIDs(on: currentScreenID, count: delta.added.count)
            delta.appendsOnTop = delta.removedBounds.isEmpty && addedNew.count == delta.added.count && Set(top) == addedNew
            let t1 = CFAbsoluteTimeGetCurrent()
            renderer?.sceneChanged(delta, index: scene)
            stats.lastSceneMs = (t1 - t0) * 1000
            stats.lastTilesMs = (CFAbsoluteTimeGetCurrent() - t1) * 1000
        }
        if screensChanged {
            if store[currentScreenID]?.screen == nil {
                // the current screen went (an undo of "new screen"): show its neighbour
                ensureScreen()
                resetScene()
            }
            refreshCounts()
        }
        stats.strokeCount = store.strokeCount
        stats.recordCount = store.records.count
        scheduleDocBytes()
    }

    private func refreshCounts() {
        let ids = store.screenIDs
        screenCount = max(1, ids.count)
        screenIndex = (ids.firstIndex(of: currentScreenID) ?? 0) + 1
        stats.strokeCount = store.strokeCount
        stats.recordCount = store.records.count
        canUndo = store.canUndo
        canRedo = store.canRedo
        scheduleDocBytes()
    }

    /// The document's JSON size, measured off the main thread a moment after the last change. The
    /// snapshot is taken when the timer fires, not per change: a snapshot held across changes would
    /// make the next change copy the whole record table.
    private func scheduleDocBytes() {
        docBytesTask?.cancel()
        docBytesTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 600_000_000)
            guard !Task.isCancelled, let doc = self?.store.document else { return }
            let bytes = await Task.detached(priority: .utility) { (try? doc.encoded(sortedKeys: false).count) ?? 0 }.value
            self?.stats.docBytes = bytes
        }
    }

    // MARK: - Pen

    /// A kid's stroke, finished: in the store as one undoable step.
    public func commitStroke(_ stroke: StrokeRecord) {
        store.put(.stroke(stroke), origin: .kid)
    }

    /// A new stroke's record, before its points: on the current screen, on top, in the pen's colour.
    public func strokeTemplate(pressure: PressureMode, at origin: Vec2, start: Double) -> StrokeRecord {
        StrokeRecord(
            screen: currentScreenID, order: store.nextOrder(on: currentScreenID), author: .kid, color: color,
            width: penSize.width, pressure: pressure, x: origin.x, y: origin.y, points: [], start: start)
    }

    // MARK: - Eraser (whole strokes)

    /// The eraser's reach either side of its path, in screen points (the web's `eraserReach`).
    public static let eraserReach = 16.0

    public func beginErase() { store.beginUndoGroup("erase") }
    public func endErase() { store.endUndoGroup() }

    /// Erases every record the eraser's path a → b (page space) touches within `margin` (page units).
    /// Returns the ids erased.
    @discardableResult
    public func erase(from a: Vec2, to b: Vec2, margin: Double) -> [RecordID] {
        let reach = Box.around([a, b])!.expanded(by: margin + 12)
        var hits: [RecordID] = []
        for id in scene.ids(in: reach) {
            guard let record = store[id] else { continue }
            switch record {
            case .stroke(let s):
                if HitTest.eraserHits(s, from: a, to: b, margin: margin) { hits.append(id) }
            default:
                if let bounds = scene.items[id]?.bounds, HitTest.boundsHit(bounds, from: a, to: b, margin: margin) { hits.append(id) }
            }
        }
        if !hits.isEmpty { store.remove(hits, origin: .kid) }
        return hits
    }

    // MARK: - Undo

    public func undo() { store.undo() }
    public func redo() { store.redo() }

    // MARK: - Screens

    public func goToScreen(_ id: RecordID) {
        guard id != currentScreenID, store[id]?.screen != nil else { return }
        currentScreenID = id
        refreshCounts()
        resetScene()
    }

    public func nextScreen() { step(1) }
    public func previousScreen() { step(-1) }

    private func step(_ d: Int) {
        let ids = store.screenIDs
        guard let i = ids.firstIndex(of: currentScreenID) else { return }
        let j = min(ids.count - 1, max(0, i + d))
        if j != i { goToScreen(ids[j]) }
    }

    /// Adds a blank screen after the last and shows it. False at the cap (50).
    @discardableResult
    public func addScreen() -> Bool {
        let screens = store.screens
        guard screens.count < ScreenRecord.maxScreens else { return false }
        let s = ScreenRecord(order: OrderKey.after(screens.last?.order), name: "Screen \(screens.count + 1)")
        store.put(.screen(s), origin: .kid)
        goToScreen(s.id)
        return true
    }

    // MARK: - JSON

    public func documentJSON() throws -> Data { try store.document.encoded() }

    public func loadJSON(_ data: Data) throws {
        load(try BoardDocument.decode(data))
    }
}
