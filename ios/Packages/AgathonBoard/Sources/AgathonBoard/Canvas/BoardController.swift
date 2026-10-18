import Combine
import CoreGraphics
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

/// The tool in the kid's hand.
public enum BoardTool: String, Sendable, CaseIterable {
    case pen
    case eraser
    /// tap a stroke or an object, or circle some ink, then move, resize, copy or delete it
    case select
    /// a rectangle, an ellipse, a line or an arrow (`BoardController.shapeKind`), straight from a drag
    case shapes
    /// a marker: translucent, under the ink
    case highlighter
}

/// Where the page is in the view, for things drawn over the board in screen space (the Live lane's
/// hint cards, the selection's buttons). Published apart from the controller so only what follows
/// the camera re-renders when it moves.
@MainActor
public final class BoardViewport: ObservableObject {
    @Published public internal(set) var camera = Camera()
    @Published public internal(set) var viewSize: CGSize = .zero

    public init() {}

    public func toView(_ p: Vec2) -> CGPoint { camera.toView(p) }
    public func toView(_ b: Box) -> CGRect {
        let a = camera.toView(Vec2(b.minX, b.minY))
        return CGRect(x: a.x, y: a.y, width: b.w * camera.scale, height: b.h * camera.scale)
    }
    public func toPage(_ p: CGPoint) -> Vec2 { camera.toPage(p) }
}

/// A picture on its way to the board (uploading): shown as a placeholder where it will go.
public struct PendingPicture: Identifiable, Equatable, Sendable {
    public let id: UUID
    public var screen: RecordID
    public var rect: Box
}

/// Something the board has to tell the kid (the editor shows it as a banner).
public struct BoardNotice: Equatable, Sendable, Identifiable {
    public enum Kind: String, Sendable { case pictureFailed, boardFull, pdfFailed }
    public let id = UUID()
    public var kind: Kind

    public init(kind: Kind) {
        self.kind = kind
    }
}

/// The board as the app uses it: the store, the current screen, the tool in hand, the input rules
/// (palm rejection, drawing with a finger), the selection and the numbers for the stats overlay.
/// Platform-neutral; the UIKit canvas draws it and feeds it input.
@MainActor
public final class BoardController: ObservableObject {
    public let store: BoardStore
    public weak var renderer: BoardRendering? {
        didSet { if renderer != nil { resetScene() } }
    }

    @Published public private(set) var currentScreenID: RecordID
    @Published public private(set) var screenIndex = 1
    @Published public private(set) var screenCount = 1
    @Published public var tool: BoardTool = .pen {
        didSet { if tool != .select && !selection.isEmpty { clearSelection() } }
    }
    /// the shape the Shapes tool draws
    @Published public var shapeKind: ShapeKind = .rect
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

    // MARK: selection

    /// What the kid picked with Select (drawn records of the current screen). It also tells the Live
    /// loop what Help me acts on (the web's `helpTarget`: a picked problem wins over the pen).
    @Published public private(set) var selection: Set<RecordID> = []
    /// the selection's bounds in page space (nil with nothing picked)
    @Published public private(set) var selectionBounds: Box?
    /// the selection is being moved or resized (its buttons step aside)
    @Published public internal(set) var isTransforming = false

    /// The camera, for overlays in screen space.
    public let viewport = BoardViewport()

    // MARK: pictures

    /// Where pictures are stored and read. Board Lab and tests use a `MemoryBoardAssetStore`.
    public var assetStore: BoardAssetStore? {
        didSet { requestImages(retryFailed: true) }
    }
    /// the board the pictures belong to (the `whiteboards` row's id)
    public var boardId = "local"
    @Published public private(set) var pendingPictures: [PendingPicture] = []
    @Published public var notice: BoardNotice?
    public let images: BoardImageCache

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
    private var docBytesDue: CFAbsoluteTime = 0
    private var docBytesScheduled = false
    /// per screen, the store's `seq` when it last changed (thumbnails redraw when it moves)
    private var screenRevisions: [RecordID: UInt64] = [:]

    static let fingerKey = "agathon.board.drawWithFinger"
    static let pencilKey = "agathon.board.pencilSeen"

    public init(document: BoardDocument = .blank(), defaults: UserDefaults = .standard, images: BoardImageCache = .shared) {
        self.defaults = defaults
        self.images = images
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
        selection = []
        selectionBounds = nil
        store.load(document)
        if let screen, store[screen]?.screen != nil {
            currentScreenID = screen
        } else {
            currentScreenID = store.screenIDs.first ?? "screen:none"
        }
        screenRevisions.removeAll()
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
        let images = self.images
        let seqAtStart = store.seq
        let started = CFAbsoluteTimeGetCurrent()
        let finish: (SceneIndex) -> Void = { [weak self] built in
            guard let self, generation == self.sceneGeneration else { return }
            // the board changed while it was laid out (a stroke drawn as it opened): lay it out again
            let index = self.store.seq == seqAtStart ? built : SceneIndex.build(self.store.drawables(on: screen.id), images: images)
            self.scene = index
            self.updateSelectionBounds()
            self.requestImages()
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
            finish(SceneIndex.build(records, images: images))
        } else {
            Task.detached(priority: .userInitiated) {
                let index = SceneIndex.build(records, images: images)
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
        var touchesSelection = false
        var newImages = false
        for id in change.ids {
            let before = change.before(id)
            let after = change.after(id)
            if before?.type == .screen || after?.type == .screen {
                screensChanged = true
                screenRevisions[id] = change.seq
                continue
            }
            if let s = before?.screenID { screenRevisions[s] = change.seq }
            if let s = after?.screenID { screenRevisions[s] = change.seq }
            if selection.contains(id) { touchesSelection = true }
            let wasHere = before.map { $0.isDrawable && $0.screenID == currentScreenID } ?? false
            let isHere = after.map { $0.isDrawable && $0.screenID == currentScreenID } ?? false
            if wasHere, let old = scene.remove(id) {
                delta.removedBounds.append(old.bounds)
            }
            if isHere, let after, let item = RenderGeometry.item(for: after, images: images) {
                scene.upsert(item)
                delta.added.append(item)
                if before == nil { addedNew.insert(id) }
                if after.type == .image { newImages = true }
            }
        }
        if !delta.isEmpty {
            delta.added.sort { $0.order != $1.order ? $0.order < $1.order : $0.id < $1.id }
            // on top only if every added item is new, the topmost records of the screen, and drawn in
            // one pass (a highlighter goes under the ink)
            let top = store.topDrawableIDs(on: currentScreenID, count: delta.added.count)
            delta.appendsOnTop = delta.removedBounds.isEmpty && addedNew.count == delta.added.count && Set(top) == addedNew
                && !delta.added.contains(where: \.paintsUnder)
            let t1 = CFAbsoluteTimeGetCurrent()
            renderer?.sceneChanged(delta, index: scene)
            stats.lastSceneMs = (t1 - t0) * 1000
            stats.lastTilesMs = (CFAbsoluteTimeGetCurrent() - t1) * 1000
        }
        if touchesSelection { pruneSelection() }
        if newImages { requestImages() }
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
    /// make the next change copy the whole record table. One timer, pushed back by each change (no
    /// task made per change: an eraser drag makes dozens a second).
    private func scheduleDocBytes() {
        docBytesDue = CFAbsoluteTimeGetCurrent() + 0.6
        guard !docBytesScheduled else { return }
        docBytesScheduled = true
        func check() {
            let wait = docBytesDue - CFAbsoluteTimeGetCurrent()
            if wait > 0.01 {
                DispatchQueue.main.asyncAfter(deadline: .now() + wait) { check() }
                return
            }
            docBytesScheduled = false
            let doc = store.document
            Task { [weak self] in
                let bytes = await Task.detached(priority: .utility) { (try? doc.encoded(sortedKeys: false).count) ?? 0 }.value
                self?.stats.docBytes = bytes
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { check() }
    }

    /// Items to draw again without a change to their records (a picture's bytes arrived).
    public func refreshItems(_ ids: [RecordID]) {
        var delta = SceneDelta()
        delta.appendsOnTop = false
        for id in ids {
            guard let r = store[id], r.screenID == currentScreenID, let item = RenderGeometry.item(for: r, images: images) else { continue }
            if let old = scene.remove(id) { delta.removedBounds.append(old.bounds) }
            scene.upsert(item)
            delta.added.append(item)
        }
        guard !delta.isEmpty else { return }
        delta.added.sort { $0.order != $1.order ? $0.order < $1.order : $0.id < $1.id }
        renderer?.sceneChanged(delta, index: scene)
    }

    /// The store's `seq` when anything on `screen` last changed in this session (0: not since it opened).
    public func revision(of screen: RecordID) -> UInt64 { screenRevisions[screen] ?? 0 }

    // MARK: - Pen and highlighter

    /// A kid's stroke, finished: in the store as one undoable step.
    public func commitStroke(_ stroke: StrokeRecord) {
        store.put(.stroke(stroke), origin: .kid)
    }

    /// A new stroke's record, before its points: on the current screen, on top, in the pen's colour
    /// (the highlighter's is a marker the size of the kid's handwriting).
    public func strokeTemplate(pressure: PressureMode, at origin: Vec2, start: Double) -> StrokeRecord {
        let highlight = tool == .highlighter
        return StrokeRecord(
            screen: currentScreenID, order: store.nextOrder(on: currentScreenID), author: .kid, color: color,
            width: highlight ? InkStyle.highlighterWidth : penSize.width, pressure: pressure, x: origin.x, y: origin.y,
            points: [], start: start, meta: highlight ? ["highlight": true] : [:])
    }

    // MARK: - Eraser (whole strokes)

    /// The eraser's reach either side of its path, in screen points (the web's `eraserReach`).
    public static let eraserReach = 16.0

    public func beginErase() { store.beginUndoGroup("erase") }
    public func endErase() { store.endUndoGroup() }

    /// Whether the eraser rubs `record` out: ink, shapes and the tutor's maths and graphs do; a
    /// picture never does (a kid rubbing out their working over a photo of the worksheet keeps the
    /// photo), nor anything locked (a PDF page). Select a picture and Delete it instead.
    public static func erasable(_ record: BoardRecord) -> Bool {
        if record.meta["locked"]?.boolValue == true { return false }
        if case .image = record { return false }
        return record.isDrawable
    }

    /// Erases every record the eraser's path a → b (page space) touches within `margin` (page units).
    /// Returns the ids erased.
    @discardableResult
    public func erase(from a: Vec2, to b: Vec2, margin: Double) -> [RecordID] {
        erase(along: [a, b], margin: margin)
    }

    /// Erases every record the eraser's path (one touch event's samples) touches, as one change: one
    /// store transaction and one redraw however many samples and strokes.
    @discardableResult
    public func erase(along path: [Vec2], margin: Double) -> [RecordID] {
        guard let first = path.first else { return [] }
        let pts = path.count == 1 ? [first, first] : path
        guard let reach = Box.around(pts)?.expanded(by: margin + 12) else { return [] }
        var hits: [RecordID] = []
        for id in scene.ids(in: reach) {
            guard let record = store[id], Self.erasable(record) else { continue }
            var hit = false
            for i in 1..<pts.count {
                let a = pts[i - 1], b = pts[i]
                switch record {
                case .stroke(let s):
                    hit = HitTest.eraserHits(s, from: a, to: b, margin: margin)
                default:
                    if let bounds = scene.items[id]?.bounds { hit = HitTest.boundsHit(bounds, from: a, to: b, margin: margin) }
                }
                if hit { break }
            }
            if hit { hits.append(id) }
        }
        if !hits.isEmpty { store.remove(hits, origin: .kid) }
        return hits
    }

    // MARK: - Shapes

    /// A line or arrow's end, gently snapped: within `tolerance` of 0°, 45° or 90° (and the rest of
    /// the eight directions) it lands exactly on it.
    public static func snapped(from a: Vec2, to b: Vec2, tolerance: Double = 7 * .pi / 180) -> Vec2 {
        let d = b - a
        let len = d.length
        guard len > 0 else { return b }
        let angle = atan2(d.y, d.x)
        let step = Double.pi / 4
        let nearest = (angle / step).rounded() * step
        guard abs(angle - nearest) <= tolerance else { return b }
        return a + Vec2(cos(nearest), sin(nearest)) * len
    }

    /// The shape a drag from `a` to `b` makes (page space), in the pen's colour; nil for a drag too
    /// short to mean a shape (a tap).
    public func shapeRecord(_ kind: ShapeKind, from a: Vec2, to b0: Vec2, minimum: Double = 6) -> ShapeRecord? {
        let width = penSize.shapeWidth
        switch kind {
        case .rect, .ellipse:
            let box = Box(x: min(a.x, b0.x), y: min(a.y, b0.y), w: abs(b0.x - a.x), h: abs(b0.y - a.y))
            guard max(box.w, box.h) >= minimum else { return nil }
            return ShapeRecord(
                screen: currentScreenID, order: store.nextOrder(on: currentScreenID), author: .kid, kind: kind,
                x: box.x, y: box.y, w: max(1, box.w), h: max(1, box.h), color: color, width: width)
        case .line, .arrow:
            let b = Self.snapped(from: a, to: b0)
            guard a.dist(b) >= minimum else { return nil }
            return ShapeRecord(
                screen: currentScreenID, order: store.nextOrder(on: currentScreenID), author: .kid, kind: kind,
                x: a.x, y: a.y, points: [.zero, b - a], color: color, width: width)
        }
    }

    public func commitShape(_ shape: ShapeRecord) {
        store.put(.shape(shape), origin: .kid)
    }

    // MARK: - Selection

    /// Whether the kid can pick `record` with Select: anything drawn on this screen that is not
    /// locked (a PDF page is the worksheet: it stays put).
    public func isSelectable(_ record: BoardRecord) -> Bool {
        record.isDrawable && record.screenID == currentScreenID && record.meta["locked"]?.boolValue != true
    }

    /// The topmost selectable record at `p` (page space), within `margin` page units of its ink.
    public func hit(at p: Vec2, margin: Double) -> RecordID? {
        let near = scene.ids(in: Box(x: p.x - margin, y: p.y - margin, w: 2 * margin, h: 2 * margin).expanded(by: 24))
        let ordered = near.compactMap { id -> (RecordID, OrderKey)? in
            guard let r = store[id], isSelectable(r), let o = r.order else { return nil }
            return (id, o)
        }.sorted { $0.1 != $1.1 ? $0.1 > $1.1 : $0.0 > $1.0 }
        for (id, _) in ordered {
            guard let r = store[id] else { continue }
            if SelectionGeometry.hits(r, at: p, margin: margin, bounds: scene.items[id]?.bounds) { return id }
        }
        return nil
    }

    /// The selectable records a lasso (a closed loop in page space) goes round.
    public func ids(inLasso loop: [Vec2]) -> Set<RecordID> {
        guard loop.count >= 3, let box = Box.around(loop) else { return [] }
        var out = Set<RecordID>()
        for id in scene.ids(in: box) {
            guard let r = store[id], isSelectable(r) else { continue }
            if SelectionGeometry.inside(r, loop: loop, bounds: scene.items[id]?.bounds) { out.insert(id) }
        }
        return out
    }

    public func select(_ ids: Set<RecordID>) {
        let picked = ids.filter { store[$0].map(isSelectable) ?? false }
        if picked != selection { selection = picked }
        updateSelectionBounds()
    }

    public func clearSelection() {
        if !selection.isEmpty { selection = [] }
        if selectionBounds != nil { selectionBounds = nil }
    }

    private func pruneSelection() {
        let kept = selection.filter { store[$0].map(isSelectable) ?? false }
        if kept != selection { selection = kept }
        updateSelectionBounds()
    }

    func updateSelectionBounds() {
        var box: Box?
        for id in selection {
            guard let b = scene.items[id]?.bounds else { continue }
            box = box.map { $0.union(b) } ?? b
        }
        if box != selectionBounds { selectionBounds = box }
    }

    /// Moves the selection by `d` (page units), as one undoable step.
    public func moveSelection(by d: Vec2) {
        guard !selection.isEmpty, d != .zero else { return }
        store.transact(.kid) { tx in
            for id in selection { if let r = tx[id] { tx.put(SelectionGeometry.translated(r, by: d)) } }
        }
    }

    /// Scales the selection by `s` about `anchor` (page space), as one undoable step. Strokes keep
    /// their pen width; shapes, pictures, maths and graphs grow (a graph not below its least size).
    public func scaleSelection(by s: Double, about anchor: Vec2) {
        guard !selection.isEmpty, s > 0, s != 1, s.isFinite else { return }
        store.transact(.kid) { tx in
            for id in selection { if let r = tx[id] { tx.put(SelectionGeometry.scaled(r, by: s, about: anchor)) } }
        }
    }

    public func deleteSelection() {
        guard !selection.isEmpty else { return }
        let ids = Array(selection)
        clearSelection()
        store.remove(ids, origin: .kid)
    }

    /// Copies the selection a little down and to the right, on top, and selects the copies. A copy
    /// is the kid's: a copy of the tutor's ink is the kid's ink (in the kid's blue, never the tutor's).
    public func duplicateSelection(offset: Vec2 = Vec2(28, 28)) {
        guard !selection.isEmpty else { return }
        let originals = selection.compactMap { store[$0] }.sorted { ($0.order ?? "a0") < ($1.order ?? "a0") }
        guard !originals.isEmpty else { return }
        let keys = (try? OrderKey.sequence(originals.count, after: store.topOrder(on: currentScreenID))) ?? []
        var d = offset
        if let b = selectionBounds, let screen = currentScreen?.rect {
            // stay on the page
            if b.maxX + d.x > screen.maxX { d.x = -d.x }
            if b.maxY + d.y > screen.maxY { d.y = -d.y }
        }
        var copies = Set<RecordID>()
        store.transact(.kid) { tx in
            for (i, r) in originals.enumerated() {
                let order = i < keys.count ? keys[i] : store.nextOrder(on: currentScreenID)
                guard let copy = SelectionGeometry.copy(r, order: order, offset: d) else { continue }
                tx.put(copy)
                copies.insert(copy.id)
            }
        }
        select(copies)
    }

    // MARK: - Undo

    public func undo() { store.undo() }
    public func redo() { store.redo() }

    // MARK: - Screens

    public func goToScreen(_ id: RecordID) {
        guard id != currentScreenID, store[id]?.screen != nil else { return }
        clearSelection()
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
        guard screens.count < ScreenRecord.maxScreens else {
            notice = BoardNotice(kind: .boardFull)
            return false
        }
        let s = ScreenRecord(order: OrderKey.after(screens.last?.order), name: "Screen \(screens.count + 1)")
        store.put(.screen(s), origin: .kid)
        goToScreen(s.id)
        return true
    }

    /// Deletes a screen and everything on it (ink, objects, what the tutor read and marked there) as
    /// one undoable step, and shows its neighbour (the one before; the next for the first). Never
    /// the only screen.
    @discardableResult
    public func deleteScreen(_ id: RecordID) -> Bool {
        let ids = store.screenIDs
        guard ids.count > 1, let i = ids.firstIndex(of: id) else { return false }
        let doomed = store.records.values.filter { $0.screenID == id }.map(\.id)
        if id == currentScreenID {
            let neighbour = i > 0 ? ids[i - 1] : ids[i + 1]
            goToScreen(neighbour)
        }
        store.transact(.kid) { tx in
            for r in doomed { tx.remove(r) }
            tx.remove(id)
        }
        return true
    }

    /// Moves a screen to `index` (0-based, in the screens' order) as one undoable step.
    public func moveScreen(_ id: RecordID, to index: Int) {
        var ids = store.screenIDs
        guard let from = ids.firstIndex(of: id), case .screen(var screen)? = store[id] else { return }
        let to = min(max(0, index), ids.count - 1)
        guard to != from else { return }
        ids.remove(at: from)
        let before = to > 0 ? store[ids[to - 1]]?.order : nil
        let after = to < ids.count ? store[ids[to]]?.order : nil
        guard let key = try? OrderKey.between(before, after) else { return }
        screen.order = key
        store.put(.screen(screen), origin: .kid)
        refreshCounts()
    }

    /// The screens strip: every screen in order, the current one, and what can be done.
    public var strip: ScreenStrip {
        let ids = store.screenIDs
        return ScreenStrip(
            items: ids.enumerated().map { i, id in ScreenStrip.Item(id: id, number: i + 1, isCurrent: id == currentScreenID, revision: revision(of: id)) },
            canAdd: ids.count < ScreenRecord.maxScreens, canDelete: ids.count > 1)
    }

    // MARK: - Pictures

    /// Where something `size` big goes on the current screen: scaled down (never up) to fit inside
    /// it with `margin` on every side, centred (the web's `fitInScreen`).
    public func fitInScreen(_ size: CGSize, margin: Double = 40) -> Box {
        let screen = currentScreen?.rect ?? .screen
        let room = (w: max(1, screen.w - 2 * margin), h: max(1, screen.h - 2 * margin))
        let s = min(1, room.w / max(1, size.width), room.h / max(1, size.height))
        let w = size.width * s, h = size.height * s
        return Box(x: screen.x + (screen.w - w) / 2, y: screen.y + (screen.h - h) / 2, w: w, h: h)
    }

    /// Puts a picture on the current screen: it is uploaded first (a placeholder shows where it will
    /// go), then goes on the board as one undoable step, on top, at `rect` (default: fitted in the
    /// screen). `image` is its decoded pixels (shown at once, never fetched back). False, with a
    /// notice, when the upload fails.
    @discardableResult
    public func insertPicture(
        _ data: Data, image: CGImage, mimeType: String, source: String, rect: Box? = nil, meta: Meta = [:], author: Author = .kid
    ) async -> RecordID? {
        let screen = currentScreenID
        let place = rect ?? fitInScreen(CGSize(width: image.width, height: image.height))
        let pending = PendingPicture(id: UUID(), screen: screen, rect: place)
        pendingPictures.append(pending)
        defer { pendingPictures.removeAll { $0.id == pending.id } }
        guard let assets = assetStore else {
            notice = BoardNotice(kind: .pictureFailed)
            return nil
        }
        let url: URL
        do {
            url = try await assets.upload(data, mimeType: mimeType, boardId: boardId, width: image.width, height: image.height, source: source)
        } catch {
            notice = BoardNotice(kind: source == "pdf" ? .pdfFailed : .pictureFailed)
            return nil
        }
        images.put(image, for: url.absoluteString)
        guard self.store[screen]?.screen != nil else { return nil }
        let record = ImageRecord(
            screen: screen, order: self.store.nextOrder(on: screen), author: author, x: place.x, y: place.y, w: place.w, h: place.h,
            asset: AssetRef(src: url.absoluteString, mime: mimeType, w: Double(image.width), h: Double(image.height)), meta: meta)
        self.store.put(.image(record), origin: .kid)
        return record.id
    }

    /// Starts loading the pictures of the current screen that are not decoded yet (or are now shown
    /// bigger than they were decoded for).
    func requestImages(retryFailed: Bool = false) {
        for r in store.drawables(on: currentScreenID) {
            guard case .image(let img) = r else { continue }
            let src = img.asset.src
            guard !src.isEmpty else { continue }
            // nowhere to read it from yet (a store comes later): leave it a placeholder
            guard assetStore != nil || src.hasPrefix("data:") else { continue }
            if retryFailed, images.state(for: src) == .failed { images.forget(src) }
            let pixels = BoardImageCache.pixels(forPageSize: img.w, img.h)
            guard images.beginLoad(src, pixels: pixels) else { continue }
            let assets = assetStore
            let cache = images
            Task { [weak self] in
                let image: CGImage? = await Task.detached(priority: .userInitiated) {
                    var bytes = BoardImageCache.dataURLBytes(src)
                    if bytes == nil, let assets, let url = URL(string: src) { bytes = try? await assets.data(for: url) }
                    return bytes.flatMap { BoardImageCache.decode($0, maxPixels: pixels) }
                }.value
                if let image { cache.put(image, for: src) } else { cache.fail(src) }
                self?.imageArrived(src)
            }
        }
    }

    private func imageArrived(_ src: String) {
        let ids = store.drawables(on: currentScreenID).compactMap { r -> RecordID? in
            if case .image(let i) = r, i.asset.src == src { return i.id }
            return nil
        }
        refreshItems(ids)
    }

    // MARK: - JSON

    public func documentJSON() throws -> Data { try store.document.encoded() }

    public func loadJSON(_ data: Data) throws {
        load(try BoardDocument.decode(data))
    }
}

/// The screens strip (the Pages sheet): the board's screens in order, which one is shown, and what
/// can be done (a board holds 1 to 50).
public struct ScreenStrip: Equatable, Sendable {
    public struct Item: Equatable, Sendable, Identifiable {
        public var id: RecordID
        /// 1-based
        public var number: Int
        public var isCurrent: Bool
        /// moves when anything on the screen changes (thumbnails redraw)
        public var revision: UInt64
    }

    public var items: [Item]
    public var canAdd: Bool
    public var canDelete: Bool

    public var current: Int { items.first(where: \.isCurrent)?.number ?? 1 }
    public var count: Int { items.count }
}
