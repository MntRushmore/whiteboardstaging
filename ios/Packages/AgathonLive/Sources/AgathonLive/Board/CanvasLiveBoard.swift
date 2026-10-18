#if canImport(UIKit)
import AgathonBoard
import AgathonBrain
import Combine
import UIKit

/// The Live loop's view of the app's board: AgathonBoard's `BoardController` (the store, the screen)
/// and `BoardCanvasView` (the camera, the kid's touches, the tutor's overlay layer).
///
/// - The tutor writes through AgathonBoard's `TutorWriter` (one per block, so a mark and a worked
///   solution can be written at once, as the web's `HandWriter`s are).
/// - The pen: a gesture recognizer that only watches (it never recognizes, cancels or delays a
///   touch) tells the loop when the kid's pen or finger is on the board, so nothing is read or
///   answered mid-stroke.
/// - The selection is the tools lane's to provide (`selectionProvider`).
@MainActor
public final class CanvasLiveBoard: LiveBoard, LiveCanvasGeometry {
    public let controller: BoardController
    public private(set) weak var canvas: BoardCanvasView?
    public var onPen: ((Bool) -> Void)?
    public var onScreenChange: ((RecordID) -> Void)?
    /// The records the kid picked with the select tool (wired to the board's selection when there is one).
    public var selectionProvider: () -> [RecordID] = { [] }
    private let observer = PenObserver()
    private var cancellables: Set<AnyCancellable> = []

    public init(controller: BoardController, canvas: BoardCanvasView) {
        self.controller = controller
        self.canvas = canvas
        observer.onChange = { [weak self] down in self?.onPen?(down) }
        canvas.addGestureRecognizer(observer)
        controller.$currentScreenID.dropFirst().removeDuplicates()
            .sink { [weak self] id in
                // after the controller has finished switching (its published value is set first)
                DispatchQueue.main.async { self?.onScreenChange?(id) }
            }
            .store(in: &cancellables)
    }

    public var store: BoardStore { controller.store }
    public var currentScreenID: RecordID { controller.currentScreenID }
    public var screenRect: BrainRect { (controller.currentScreen?.rect ?? .screen).rect }
    public var selection: [RecordID] { selectionProvider() }
    public var isPenDown: Bool { observer.isDown }
    public var reduceMotion: Bool { UIAccessibility.isReduceMotionEnabled }

    public var fitZoom: Double? {
        guard let canvas, canvas.bounds.width > 0 else { return nil }
        let screen = controller.currentScreen?.rect ?? .screen
        return canvas.constraintsInsets.fit(screen, in: canvas.bounds.size).scale
    }

    public func write(_ lines: [TutorLine], meta: Meta, onDone: @escaping @MainActor () -> Void) -> TutorPen {
        guard let canvas else {
            // no canvas (it went away): the writing goes straight into the store
            let pen = InstantPen(store: controller.store, screen: controller.currentScreenID)
            pen.write(lines, meta: meta)
            onDone()
            return pen
        }
        let writer = TutorWriter(controller: controller, canvas: canvas)
        let pen = WriterPen(writer: writer, wallMs: reduceMotion ? 0 : HandPace.plan(lines).wallMs)
        writer.write(lines, meta: meta) { onDone() }
        return pen
    }

    public func addScreen() -> RecordID? {
        controller.addScreen() ? controller.currentScreenID : nil
    }

    // MARK: LiveCanvasGeometry

    public func viewPoint(_ page: AgathonBrain.Point) -> CGPoint {
        canvas?.camera.toView(Vec2(page.x, page.y)) ?? .zero
    }

    public var viewSize: CGSize { canvas?.bounds.size ?? .zero }

    /// The pen as the Lab moves it (the simulator has no Pencil: replayed strokes go through the
    /// canvas's own path, which a gesture recognizer never sees).
    public func notePen(_ down: Bool) {
        observer.force(down)
    }
}

/// A `TutorWriter` as the loop's pen.
@MainActor
final class WriterPen: TutorPen {
    private let writer: TutorWriter
    let wallMs: Double

    init(writer: TutorWriter, wallMs: Double) {
        self.writer = writer
        self.wallMs = wallMs
    }

    var isWriting: Bool { writer.isWriting }
    func cancel() { writer.cancel() }
}

/// Watches touches on the canvas without taking part: never recognizes, never cancels, never
/// delays. Down while any touch is on the board.
final class PenObserver: UIGestureRecognizer, UIGestureRecognizerDelegate {
    var onChange: ((Bool) -> Void)?
    private var touching = 0
    private var forced = false
    private(set) var isDown = false

    init() {
        super.init(target: nil, action: nil)
        cancelsTouchesInView = false
        delaysTouchesBegan = false
        delaysTouchesEnded = false
        requiresExclusiveTouchType = false
        delegate = self
    }

    func force(_ down: Bool) {
        forced = down
        update()
    }

    private func update() {
        let now = touching > 0 || forced
        guard now != isDown else { return }
        isDown = now
        onChange?(now)
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        touching += touches.count
        update()
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        touching = max(0, touching - touches.count)
        update()
        if touching == 0 { state = .failed }
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        touching = max(0, touching - touches.count)
        update()
        if touching == 0 { state = .failed }
    }

    override func reset() {
        super.reset()
        if touching != 0 {
            touching = 0
            update()
        }
    }

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRequireFailureOf other: UIGestureRecognizer) -> Bool { false }
    func gestureRecognizer(_ g: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool { false }
}
#endif
