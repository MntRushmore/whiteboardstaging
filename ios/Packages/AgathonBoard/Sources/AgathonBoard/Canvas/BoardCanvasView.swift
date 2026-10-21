#if canImport(UIKit)
import Combine
import QuartzCore
import UIKit

/// How the canvas looks around the page.
public struct CanvasAppearance: Equatable, Sendable {
    /// the flat surface around the screen
    public var surface: UIColor
    /// the paper's corner radius, in view points (constant at any zoom)
    public var paperRadius: CGFloat
    /// a soft shadow under the paper (the Lab's look; Blocks has none)
    public var paperShadow: Bool
    /// the selection's frame and handles
    public var selectionInk: UIColor
    /// a problem page's template (docs/PROBLEM-PAGES.md): its guide lines, labels and answer spot
    public var template: PageTemplate.Colors

    public init(surface: UIColor, paperRadius: CGFloat, paperShadow: Bool, selectionInk: UIColor, template: PageTemplate.Colors = .blocks) {
        self.surface = surface
        self.paperRadius = paperRadius
        self.paperShadow = paperShadow
        self.selectionInk = selectionInk
        self.template = template
    }

    /// Board Lab's plain look.
    public static let lab = CanvasAppearance(
        surface: UIColor(red: 0.925, green: 0.918, blue: 0.898, alpha: 1), paperRadius: 0, paperShadow: true,
        selectionInk: UIColor(red: 0.078, green: 0.082, blue: 0.122, alpha: 1))

    /// Blocks (docs/DESIGN-SYSTEM.md): chalk ground, white page with 18 pt corners, no shadow.
    public static let blocks = CanvasAppearance(
        surface: UIColor(red: 0xF1 / 255.0, green: 0xF2 / 255.0, blue: 0xF6 / 255.0, alpha: 1), paperRadius: 18, paperShadow: false,
        selectionInk: UIColor(red: 0x14 / 255.0, green: 0x15 / 255.0, blue: 0x1F / 255.0, alpha: 1))
}

/// The board on screen: the current 16:9 screen on a flat surface, Apple Pencil first.
///
/// Layers, in page space under one camera transform:
///   paper (the white screen) → a problem page's template (`PageTemplate`: guide lines, labels, the
///   answer spot; never ink) → settled ink tiles (`TileLayers`) → the tutor's writing being revealed
///   → a lifted selection (moving or resizing) → the shape being dragged → the kid's live stroke
/// and, in view space over them: the selection's frame and handles, the lasso, the Pencil's hover.
///
/// Input rules:
///  - the Pencil always draws (coalesced and predicted touches, force, altitude, azimuth; late force
///    values are applied as they land, `EstimationTracker`);
///  - a finger draws only while fingers draw (`BoardController.fingerDraws`: the "draw with finger"
///    setting, or no Pencil ever seen on this device); otherwise one finger pans;
///  - two fingers pan and pinch; a second finger cancels a finger's stroke;
///  - while the Pencil is down nothing else starts (a palm cannot pan or draw);
///  - double-tap on the Pencil switches pen ⇄ eraser;
///  - the tool decides what a drag does: ink (pen, highlighter), rub out (eraser), a shape, or
///    Select (tap to pick, drag round to lasso, drag the selection to move it, a corner to resize it).
@MainActor
public final class BoardCanvasView: UIView, BoardRendering, UIGestureRecognizerDelegate, UIPencilInteractionDelegate {
    public let controller: BoardController

    /// Room the board's chrome takes over the view, and the zoom range.
    public var constraintsInsets = CameraConstraints() {
        didSet { refit() }
    }

    public var appearance: CanvasAppearance = .lab {
        didSet { applyAppearance() }
    }

    public private(set) var camera = Camera()
    private var screenRect = Box.screen
    private var lastSize = CGSize.zero

    private let content = CALayer()
    private let paper = CALayer()
    /// a problem page's template, in page space between the paper and the ink
    private let templateLayer = CALayer()
    private let templateAnswer = CAShapeLayer()
    private let templateAnswerLabel = CAShapeLayer()
    /// "Problem 2, continued", "Answer on the next page" ("More room")
    private let templateNotes = CAShapeLayer()
    private let templateLabel = CAShapeLayer()
    private let templateRules = CAShapeLayer()
    /// the page the template was drawn for (redrawn only when it changes)
    private var templateFor: (page: ProblemPage?, rect: Box)?
    /// all ink, clipped to the screen (the last row of tiles overhangs it): a rectangular
    /// `masksToBounds` (a scissor, no offscreen pass), its bounds the screen rect so its sublayers
    /// stay in page space
    private let inkRoot = CALayer()
    let tiles = TileLayers()
    /// the tutor's writing in progress (`TutorWriter` puts its strokes here)
    public let tutorLayer = CALayer()
    /// pictures on their way up (placeholders)
    private let pendingLayer = CALayer()
    /// the selection lifted off the tiles while it moves or is resized
    private let liftLayer = CALayer()
    private let shapePreview = CAShapeLayer()
    private let liveLayer = CAShapeLayer()
    private let eraserCursor = CAShapeLayer()
    // view space
    private let selectionFrame = CAShapeLayer()
    private let selectionHandles = CAShapeLayer()
    private let lassoLayer = CAShapeLayer()
    private let hoverLayer = CAShapeLayer()

    private let ink = InkGestureRecognizer()
    private let pan = UIPanGestureRecognizer()
    private let pinch = UIPinchGestureRecognizer()
    private let hover = UIHoverGestureRecognizer()
    private var cancellables: Set<AnyCancellable> = []

    // the stroke being drawn
    private struct Live {
        var stroke: StrokeRecord
        var points: [InkPoint] = []
        var origin: Vec2
        var startTimestamp: TimeInterval
        var pencil: Bool
        var lastPage: Vec2
        var livePathMaxMs: Double = 0
        var waiting = EstimationTracker()
    }
    private var live: Live?
    /// a finished Pencil stroke waiting (a few ms) for its last force values before it is committed
    private var finishing: (live: Live, eventTime: TimeInterval, deadline: DispatchWorkItem)?
    private var flushMs = 0.0
    private var erasing: (last: Vec2, started: TimeInterval)?
    private var shaping: (start: Vec2, kind: ShapeKind)?

    private enum SelectDrag {
        /// down, not moved yet: on the selection (a drag moves it), on a record (a drag picks it up),
        /// or on the page (a drag lassos)
        case pending(start: Vec2, view: CGPoint, onSelection: Bool, hit: RecordID?)
        case lasso([Vec2])
        case move(start: Vec2, delta: Vec2)
        case resize(anchor: Vec2, from: Vec2, scale: Double)
    }
    private var selecting: SelectDrag?
    private var liftBounds: Box?

    /// view points between the selection's ink and its frame, and the handles' reach
    static let selectionPad: CGFloat = 10
    static let handleReach: CGFloat = 30

    // frame timing while drawing
    private var displayLink: CADisplayLink?
    private var frameIntervals: [Double] = []
    private var lastFrame: CFTimeInterval = 0
    private var stopLinkWork: DispatchWorkItem?

    public init(controller: BoardController) {
        self.controller = controller
        super.init(frame: .zero)
        backgroundColor = appearance.surface
        isMultipleTouchEnabled = true
        setUpLayers()
        setUpGestures()
        controller.$drawWithFinger.combineLatest(controller.$pencilSeen)
            .sink { [weak self] _ in DispatchQueue.main.async { self?.applyInputRules() } }
            .store(in: &cancellables)
        controller.$tool.sink { [weak self] _ in self?.cancelLive() }.store(in: &cancellables)
        controller.$selection.combineLatest(controller.$selectionBounds)
            .sink { [weak self] _ in DispatchQueue.main.async { self?.updateSelectionOverlay() } }
            .store(in: &cancellables)
        controller.$pendingPictures
            .sink { [weak self] list in self?.showPending(list) }
            .store(in: &cancellables)
        tiles.index = { [weak controller] in controller?.scene ?? SceneIndex() }
        controller.renderer = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    /// Settled-ink tiles backed by IOSurfaces (shown without a copy) instead of CGImages (copied to
    /// the render server on every change). Set before a canvas is made.
    public static var surfaceTiles: Bool {
        get { TileLayers.kind == .surface }
        set { TileLayers.kind = newValue ? .surface : .image }
    }

    private func setUpLayers() {
        content.anchorPoint = .zero
        content.actions = ["transform": NSNull(), "sublayerTransform": NSNull(), "position": NSNull(), "bounds": NSNull()]
        layer.addSublayer(content)

        paper.backgroundColor = UIColor.white.cgColor
        paper.actions = ["position": NSNull(), "bounds": NSNull(), "shadowPath": NSNull(), "cornerRadius": NSNull()]
        content.addSublayer(paper)
        templateLayer.anchorPoint = .zero
        templateLayer.actions = ["sublayers": NSNull(), "hidden": NSNull()]
        for l in [templateAnswer, templateAnswerLabel, templateNotes, templateLabel, templateRules] {
            l.actions = ["path": NSNull(), "fillColor": NSNull(), "strokeColor": NSNull(), "lineWidth": NSNull(), "hidden": NSNull()]
            templateLayer.addSublayer(l)
        }
        templateRules.fillColor = nil
        templateRules.lineCap = .round
        templateLayer.isHidden = true
        content.addSublayer(templateLayer)
        inkRoot.anchorPoint = .zero
        inkRoot.masksToBounds = true
        inkRoot.actions = ["sublayers": NSNull(), "position": NSNull(), "bounds": NSNull()]
        content.addSublayer(inkRoot)
        inkRoot.addSublayer(tiles.root)
        tutorLayer.actions = ["sublayers": NSNull()]
        inkRoot.addSublayer(tutorLayer)
        pendingLayer.actions = ["sublayers": NSNull()]
        inkRoot.addSublayer(pendingLayer)

        liftLayer.anchorPoint = .zero
        liftLayer.isHidden = true
        liftLayer.actions = ["contents": NSNull(), "position": NSNull(), "bounds": NSNull(), "transform": NSNull(), "hidden": NSNull()]
        inkRoot.addSublayer(liftLayer)

        shapePreview.fillColor = nil
        shapePreview.lineCap = .round
        shapePreview.lineJoin = .round
        shapePreview.actions = ["path": NSNull(), "strokeColor": NSNull(), "lineWidth": NSNull(), "hidden": NSNull()]
        inkRoot.addSublayer(shapePreview)

        liveLayer.lineWidth = 0
        liveLayer.actions = ["path": NSNull(), "fillColor": NSNull(), "contentsScale": NSNull(), "strokeColor": NSNull(), "lineWidth": NSNull()]
        inkRoot.addSublayer(liveLayer)

        eraserCursor.fillColor = UIColor(white: 0.5, alpha: 0.12).cgColor
        eraserCursor.strokeColor = UIColor(white: 0.35, alpha: 0.6).cgColor
        eraserCursor.lineWidth = 1.5
        eraserCursor.isHidden = true
        eraserCursor.actions = ["path": NSNull(), "hidden": NSNull(), "position": NSNull()]
        layer.addSublayer(eraserCursor)

        for l in [selectionFrame, selectionHandles, lassoLayer, hoverLayer] {
            l.actions = ["path": NSNull(), "hidden": NSNull(), "position": NSNull(), "fillColor": NSNull(), "strokeColor": NSNull(), "lineWidth": NSNull()]
            l.isHidden = true
            layer.addSublayer(l)
        }
        selectionFrame.fillColor = nil
        selectionFrame.lineWidth = 2
        selectionFrame.lineDashPattern = [7, 5]
        selectionHandles.fillColor = UIColor.white.cgColor
        selectionHandles.lineWidth = 3
        lassoLayer.fillColor = nil
        lassoLayer.lineWidth = 2
        lassoLayer.lineDashPattern = [5, 6]
        lassoLayer.lineCap = .round
        lassoLayer.lineJoin = .round
        applyAppearance()
    }

    private func applyAppearance() {
        backgroundColor = appearance.surface
        paper.shadowColor = UIColor.black.cgColor
        paper.shadowOpacity = appearance.paperShadow ? 0.10 : 0
        paper.shadowRadius = 10
        paper.shadowOffset = CGSize(width: 0, height: 2)
        templateAnswer.fillColor = appearance.template.answer
        templateAnswerLabel.fillColor = appearance.template.answerLabel
        templateNotes.fillColor = appearance.template.answerLabel
        templateLabel.fillColor = appearance.template.label
        templateRules.strokeColor = appearance.template.rule
        selectionFrame.strokeColor = appearance.selectionInk.cgColor
        selectionHandles.strokeColor = appearance.selectionInk.cgColor
        lassoLayer.strokeColor = appearance.selectionInk.withAlphaComponent(0.7).cgColor
        applyCamera()
    }

    private func setUpGestures() {
        ink.delegate = self
        ink.onBegan = { [weak self] t, e in self?.touchBegan(t, e) }
        ink.onMoved = { [weak self] t, e in self?.touchMoved(t, e) }
        ink.onEnded = { [weak self] t, e in self?.touchEnded(t, e) }
        ink.onCancelled = { [weak self] in self?.cancelLive() }
        ink.onEstimatedUpdate = { [weak self] touches in self?.estimatedUpdate(touches) }
        addGestureRecognizer(ink)

        pan.delegate = self
        pan.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        pan.maximumNumberOfTouches = 2
        pan.addTarget(self, action: #selector(handlePan(_:)))
        addGestureRecognizer(pan)

        pinch.delegate = self
        pinch.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        pinch.addTarget(self, action: #selector(handlePinch(_:)))
        addGestureRecognizer(pinch)

        hover.addTarget(self, action: #selector(handleHover(_:)))
        addGestureRecognizer(hover)

        let pencil = UIPencilInteraction()
        pencil.delegate = self
        addInteraction(pencil)
        applyInputRules()
    }

    /// Who draws: the Pencil always; a finger only while fingers draw. One finger pans otherwise.
    private func applyInputRules() {
        var types = [NSNumber(value: UITouch.TouchType.pencil.rawValue)]
        if controller.fingerDraws { types.append(NSNumber(value: UITouch.TouchType.direct.rawValue)) }
        ink.allowedTouchTypes = types
        pan.minimumNumberOfTouches = controller.fingerDraws ? 2 : 1
    }

    // MARK: - Layout and camera

    public override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.size != lastSize, bounds.width > 0, bounds.height > 0 else { return }
        let wasFit = lastSize == .zero || abs(constraintsInsets.zoom(of: camera, screen: screenRect, in: lastSize) - 1) < 0.01
        lastSize = bounds.size
        if wasFit {
            camera = constraintsInsets.fit(screenRect, in: bounds.size)
        } else {
            camera = constraintsInsets.clamp(camera, screen: screenRect, in: bounds.size)
        }
        controller.viewport.viewSize = bounds.size
        applyCamera()
        tiles.rebase(px: basePx)
        updateDetail()
    }

    private func refit() {
        guard bounds.width > 0 else { return }
        camera = constraintsInsets.fit(screenRect, in: bounds.size)
        applyCamera()
        updateDetail()
    }

    /// device pixels per page unit with the screen fitted
    private var basePx: CGFloat {
        CGFloat(constraintsInsets.fit(screenRect, in: bounds.size).scale) * contentScaleFactor
    }

    private func applyCamera() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        content.setAffineTransform(camera.transform)
        // the live stroke is a vector layer: keep it sharp at this zoom
        liveLayer.contentsScale = contentScaleFactor * CGFloat(camera.scale)
        shapePreview.contentsScale = liveLayer.contentsScale
        paper.cornerRadius = camera.scale > 0 ? appearance.paperRadius / CGFloat(camera.scale) : 0
        if appearance.paperShadow {
            paper.shadowPath = CGPath(rect: CGRect(origin: .zero, size: screenRect.cgRect.size), transform: nil)
        }
        updateSelectionOverlay()
        CATransaction.commit()
        if controller.viewport.camera != camera { controller.viewport.camera = camera }
    }

    private func updateDetail(done: (() -> Void)? = nil) {
        guard bounds.width > 0 else {
            done?()
            return
        }
        tiles.updateDetail(visible: camera.visibleRect(viewSize: bounds.size), effectivePx: CGFloat(camera.scale) * contentScaleFactor, done: done)
    }

    /// Zoom: 1 = the whole screen fits.
    public var zoom: Double { constraintsInsets.zoom(of: camera, screen: screenRect, in: bounds.size) }

    /// Sets the zoom about a view point (the Lab's buttons; pinch does the same).
    public func setZoom(_ z: Double, around p: CGPoint? = nil, refreshDetail: Bool = true) {
        let fit = constraintsInsets.fit(screenRect, in: bounds.size)
        let anchor = p ?? CGPoint(x: bounds.midX, y: bounds.midY)
        let page = camera.toPage(anchor)
        var c = camera
        c.scale = fit.scale * z
        c.offset = Vec2(anchor.x - page.x * c.scale, anchor.y - page.y * c.scale)
        camera = constraintsInsets.clamp(c, screen: screenRect, in: bounds.size)
        applyCamera()
        if refreshDetail { updateDetail() }
    }

    private var gestureStart: (camera: Camera, centroid: CGPoint)?

    @objc private func handlePan(_ g: UIPanGestureRecognizer) {
        switch g.state {
        case .began:
            cancelFingerStroke()
            gestureStart = (camera, .zero)
        case .changed:
            guard let start = gestureStart, pinch.state != .changed && pinch.state != .began else { return }
            let t = g.translation(in: self)
            var c = start.camera
            c.offset = Vec2(c.offset.x + t.x, c.offset.y + t.y)
            camera = constraintsInsets.clamp(c, screen: screenRect, in: bounds.size)
            applyCamera()
        default:
            gestureStart = nil
            updateDetail()
        }
    }

    private var pinchStart: (camera: Camera, page: Vec2, centroid: CGPoint)?

    @objc private func handlePinch(_ g: UIPinchGestureRecognizer) {
        switch g.state {
        case .began:
            cancelFingerStroke()
            let c = g.location(in: self)
            pinchStart = (camera, camera.toPage(c), c)
        case .changed:
            guard let start = pinchStart else { return }
            let centroid = g.location(in: self)
            var c = start.camera
            c.scale = start.camera.scale * Double(g.scale)
            // the page point under the fingers stays under them (and follows a two-finger pan)
            c.offset = Vec2(centroid.x - start.page.x * c.scale, centroid.y - start.page.y * c.scale)
            camera = constraintsInsets.clamp(c, screen: screenRect, in: bounds.size)
            applyCamera()
        default:
            pinchStart = nil
            updateDetail()
        }
    }

    // MARK: - Pencil hover (iPad Pro M2 and later): where the tip will land

    @objc private func handleHover(_ g: UIHoverGestureRecognizer) {
        switch g.state {
        case .began, .changed:
            // nothing previews while the pen is down
            guard live == nil, erasing == nil, shaping == nil, selecting == nil else {
                hoverLayer.isHidden = true
                return
            }
            showHover(at: g.location(in: self))
        default:
            hoverLayer.isHidden = true
        }
    }

    private func showHover(at p: CGPoint) {
        let scale = CGFloat(camera.scale)
        let colour = RenderGeometry.cgColor(controller.color)
        var path: CGPath
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        switch controller.tool {
        case .pen:
            let r = max(2.5, CGFloat(controller.penSize.width) * scale / 2)
            path = CGPath(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r), transform: nil)
            hoverLayer.fillColor = colour.copy(alpha: 0.55)
            hoverLayer.strokeColor = nil
        case .highlighter:
            let r = max(4, CGFloat(InkStyle.highlighterWidth) * scale / 2)
            path = CGPath(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r), transform: nil)
            hoverLayer.fillColor = RenderGeometry.highlightColor(controller.color, alpha: 0.45)
            hoverLayer.strokeColor = nil
        case .eraser:
            let r = CGFloat(BoardController.eraserReach)
            path = CGPath(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r), transform: nil)
            hoverLayer.fillColor = UIColor(white: 0.5, alpha: 0.10).cgColor
            hoverLayer.strokeColor = UIColor(white: 0.35, alpha: 0.6).cgColor
            hoverLayer.lineWidth = 1.5
        case .select, .shapes:
            path = CGPath(ellipseIn: CGRect(x: p.x - 4, y: p.y - 4, width: 8, height: 8), transform: nil)
            hoverLayer.fillColor = appearance.selectionInk.withAlphaComponent(0.5).cgColor
            hoverLayer.strokeColor = nil
        }
        hoverLayer.path = path
        hoverLayer.isHidden = false
        CATransaction.commit()
    }

    // MARK: - Gesture rules

    public func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        true
    }

    public override func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        if g === pan || g === pinch {
            // a palm while the Pencil is down moves nothing
            return !ink.isTrackingPencil
        }
        return true
    }

    public func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
        controller.tool = controller.tool == .pen ? .eraser : .pen
    }

    // MARK: - Touches → ink

    struct Sample {
        var view: CGPoint
        var pressure: Double
        var altitude: Double
        var azimuth: Double
        var timestamp: TimeInterval
        /// a Pencil sample whose force (or tilt) is still an estimate: its update's key
        var updateIndex: Int? = nil
    }

    private static let lateProperties: UITouch.Properties = [.force, .altitude, .azimuth]

    private func sample(_ t: UITouch) -> Sample {
        let pencil = t.type == .pencil
        let waiting = pencil && !t.estimatedPropertiesExpectingUpdates.intersection(Self.lateProperties).isEmpty
        return Sample(
            view: pencil ? t.preciseLocation(in: self) : t.location(in: self),
            pressure: pencil ? InkStyle.pencilPressure(force: Double(t.force), maximumForce: Double(t.maximumPossibleForce)) : 0.5,
            altitude: pencil && controller.storesTilt ? Double(t.altitudeAngle) : -1,
            azimuth: pencil && controller.storesTilt ? Double(t.azimuthAngle(in: self)) : 0,
            timestamp: t.timestamp,
            updateIndex: waiting ? t.estimationUpdateIndex?.intValue : nil)
    }

    private func touchBegan(_ t: UITouch, _ e: UIEvent) {
        let pencil = t.type == .pencil
        if pencil {
            controller.notePencil()
            // a pan a palm began before the Pencil touched: stop it
            if pan.state == .began || pan.state == .changed { pan.isEnabled = false; pan.isEnabled = true }
        }
        inkBegan(sample(t), pencil: pencil)
    }

    private func touchMoved(_ t: UITouch, _ e: UIEvent) {
        let coalesced = e.coalescedTouches(for: t) ?? [t]
        let predicted = e.predictedTouches(for: t) ?? []
        inkMoved(coalesced.map(sample), predicted: predicted.map(sample))
    }

    private func touchEnded(_ t: UITouch, _ e: UIEvent) {
        let coalesced = e.coalescedTouches(for: t) ?? [t]
        inkEnded(coalesced.map(sample), eventTime: t.timestamp)
    }

    private func cancelFingerStroke() {
        if let live, !live.pencil { cancelLive() }
        if selecting != nil || shaping != nil { cancelLive() }
    }

    private func cancelLive() {
        finishPending()
        if live != nil {
            live = nil
            liveLayer.path = nil
        }
        if erasing != nil {
            erasing = nil
            controller.endErase()
            eraserCursor.isHidden = true
        }
        if shaping != nil {
            shaping = nil
            shapePreview.path = nil
        }
        if let s = selecting {
            selecting = nil
            lassoLayer.isHidden = true
            if case .move = s { endLift(commit: nil) }
            if case .resize = s { endLift(commit: nil) }
        }
    }

    // MARK: - Input, by tool (shared by touches and synthetic input)

    func inkBegan(_ s: Sample, pencil: Bool) {
        cancelLive()
        hoverLayer.isHidden = true
        startFrameMonitor()
        let page = camera.toPage(s.view)
        switch controller.tool {
        case .eraser:
            controller.beginErase()
            erasing = (page, s.timestamp)
            showEraser(at: s.view)
            eraseAlong([page])
        case .shapes:
            shaping = (page, controller.shapeKind)
        case .select:
            selectBegan(page, view: s.view)
        case .pen, .highlighter:
            // pen down in wall-clock ms: the touch's time is on the same clock as CACurrentMediaTime
            let start = (Date().timeIntervalSince1970 - (CACurrentMediaTime() - s.timestamp)) * 1000
            let origin = Vec2((page.x * 16).rounded() / 16, (page.y * 16).rounded() / 16)
            let template = controller.strokeTemplate(pressure: pencil ? .real : .simulated, at: origin, start: start.rounded())
            live = Live(stroke: template, origin: origin, startTimestamp: s.timestamp, pencil: pencil, lastPage: page)
            if controller.tool == .highlighter {
                liveLayer.fillColor = nil
                liveLayer.strokeColor = RenderGeometry.highlightColor(template.color, alpha: 0.6)
                liveLayer.lineWidth = CGFloat(template.width)
                liveLayer.lineCap = .round
                liveLayer.lineJoin = .round
            } else {
                liveLayer.strokeColor = nil
                liveLayer.lineWidth = 0
                liveLayer.fillColor = RenderGeometry.cgColor(template.color)
            }
            appendSamples([s])
            redrawLive(predicted: [])
        }
    }

    func inkMoved(_ samples: [Sample], predicted: [Sample]) {
        if let e = erasing {
            let path = [e.last] + samples.map { camera.toPage($0.view) }
            eraseAlong(path)
            erasing = (path.last ?? e.last, e.started)
            if let s = samples.last { showEraser(at: s.view) }
            return
        }
        if let sh = shaping, let s = (predicted.last ?? samples.last) {
            showShape(sh.kind, from: sh.start, to: camera.toPage(s.view))
            return
        }
        if selecting != nil {
            if let s = samples.last { selectMoved(camera.toPage(s.view), view: s.view) }
            return
        }
        guard live != nil else { return }
        appendSamples(samples)
        redrawLive(predicted: predicted)
    }

    func inkEnded(_ samples: [Sample], eventTime: TimeInterval) {
        if erasing != nil {
            inkMoved(samples, predicted: [])
            controller.endErase()
            erasing = nil
            eraserCursor.isHidden = true
            stopFrameMonitorSoon()
            return
        }
        if let sh = shaping {
            let end = samples.last.map { camera.toPage($0.view) } ?? sh.start
            shaping = nil
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            if let shape = controller.shapeRecord(sh.kind, from: sh.start, to: end) {
                controller.commitShape(shape)
                tiles.flushInvalidations()
            }
            shapePreview.path = nil
            CATransaction.commit()
            stopFrameMonitorSoon()
            return
        }
        if selecting != nil {
            if let s = samples.last { selectMoved(camera.toPage(s.view), view: s.view) }
            selectEnded()
            stopFrameMonitorSoon()
            return
        }
        guard live != nil else { return }
        appendSamples(samples)
        guard let l = live else { return }
        live = nil
        if !l.waiting.isEmpty {
            // the Pencil's last force values are on their way: hold the stroke a moment for them
            let work = DispatchWorkItem { [weak self] in self?.finishPending() }
            finishing = (l, eventTime, work)
            redrawLive(l, predicted: [])
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.06, execute: work)
            return
        }
        commit(l, eventTime: eventTime)
    }

    /// Commits a stroke held for its late values (they came, the wait ran out, or a new stroke began).
    private func finishPending() {
        guard let f = finishing else { return }
        finishing = nil
        f.deadline.cancel()
        commit(f.live, eventTime: f.eventTime)
    }

    private func commit(_ l: Live, eventTime: TimeInterval) {
        let signpost = BoardSignposts.signposter.beginInterval("Commit")
        let workStart = CACurrentMediaTime()
        var stroke = l.stroke
        stroke.points = l.points
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        controller.commitStroke(stroke) // → store → scene → tiles, synchronously
        tiles.flushInvalidations() // a highlighter goes under the ink: redrawn, not painted on top
        liveLayer.path = nil
        let committed = CACurrentMediaTime()
        CATransaction.commit()
        let done = CACurrentMediaTime()
        flushMs = (done - committed) * 1000
        BoardSignposts.signposter.endInterval("Commit", signpost)
        var stats = controller.stats
        stats.lastCommitWorkMs = (done - workStart) * 1000
        stats.lastFlushMs = flushMs
        stats.lastTouchToCommitMs = (done - eventTime) * 1000
        stats.lastLivePathMaxMs = l.livePathMaxMs
        stats.commits.append(stats.lastTouchToCommitMs)
        if stats.commits.count > 200 { stats.commits.removeFirst(stats.commits.count - 200) }
        controller.stats = stats
        stopFrameMonitorSoon()
    }

    private func appendSamples(_ samples: [Sample]) {
        guard var l = live else { return }
        for s in samples {
            let page = camera.toPage(s.view)
            l.lastPage = page
            if let key = s.updateIndex { l.waiting.expect(updateIndex: key, point: l.points.count) }
            l.points.append(InkPoint(
                x: Float(page.x - l.origin.x), y: Float(page.y - l.origin.y), pressure: Float(s.pressure),
                altitude: Float(s.altitude), azimuth: Float(s.azimuth),
                t: Float(max(0, (s.timestamp - l.startTimestamp) * 1000))))
        }
        live = l
    }

    /// The Pencil's real force (and tilt) for samples drawn with an estimate: fixed in the stroke
    /// being drawn, or in the one waiting to be committed.
    private func estimatedUpdate(_ touches: Set<UITouch>) {
        func apply(_ l: inout Live) -> Bool {
            var changed = false
            for t in touches {
                guard let key = t.estimationUpdateIndex?.intValue, let i = l.waiting.point(for: key), i < l.points.count else { continue }
                l.points[i].pressure = Float(InkStyle.pencilPressure(force: Double(t.force), maximumForce: Double(t.maximumPossibleForce)))
                if controller.storesTilt {
                    l.points[i].altitude = Float(t.altitudeAngle)
                    l.points[i].azimuth = Float(t.azimuthAngle(in: self))
                }
                if t.estimatedPropertiesExpectingUpdates.intersection(Self.lateProperties).isEmpty { l.waiting.settle(key) }
                changed = true
            }
            return changed
        }
        if var l = live, apply(&l) {
            live = l
            redrawLive(predicted: [])
        }
        if var f = finishing, apply(&f.live) {
            finishing = f
            if f.live.waiting.isEmpty { finishPending() }
        }
    }

    private func redrawLive(predicted: [Sample]) {
        guard let l = live else { return }
        redrawLive(l, predicted: predicted)
    }

    private func redrawLive(_ l0: Live, predicted: [Sample]) {
        var l = l0
        let started = CACurrentMediaTime()
        let signpost = BoardSignposts.signposter.beginInterval("LivePath")
        var input = l.points.map { FreehandInput(Vec2(Double($0.x), Double($0.y)), Double($0.pressure)) }
        for s in predicted {
            let p = camera.toPage(s.view)
            input.append(FreehandInput(Vec2(p.x - l.origin.x, p.y - l.origin.y), s.pressure))
        }
        let path: CGPath
        if controller.tool == .highlighter || l.stroke.meta["highlight"] != nil {
            let pts = Freehand.strokePoints(input, InkStyle.highlightOptions(width: l.stroke.width, complete: false)).map(\.point)
            path = RenderGeometry.centerlinePath(pts, transform: CGAffineTransform(translationX: l.origin.x, y: l.origin.y))
        } else {
            let outline = Freehand.outline(input, InkStyle.options(width: l.stroke.width, pressure: l.stroke.pressure, complete: false))
            path = Freehand.path(outline, transform: CGAffineTransform(translationX: l.origin.x, y: l.origin.y))
        }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        liveLayer.path = path
        CATransaction.commit()
        BoardSignposts.signposter.endInterval("LivePath", signpost)
        l.livePathMaxMs = max(l.livePathMaxMs, (CACurrentMediaTime() - started) * 1000)
        if live != nil { live?.livePathMaxMs = l.livePathMaxMs }
    }

    // MARK: - Eraser

    private func eraseAlong(_ path: [Vec2]) {
        let started = CACurrentMediaTime()
        let margin = BoardController.eraserReach / camera.scale
        let hit = controller.erase(along: path, margin: margin)
        if !hit.isEmpty {
            controller.stats.lastEraseMs = (CACurrentMediaTime() - started) * 1000
        }
    }

    private func showEraser(at p: CGPoint) {
        let r = CGFloat(BoardController.eraserReach)
        eraserCursor.path = UIBezierPath(ovalIn: CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r)).cgPath
        eraserCursor.isHidden = false
    }

    // MARK: - Shapes

    private func showShape(_ kind: ShapeKind, from a: Vec2, to b: Vec2) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        defer { CATransaction.commit() }
        guard let shape = controller.shapeRecord(kind, from: a, to: b, minimum: 1), let item = RenderGeometry.item(for: .shape(shape)) else {
            shapePreview.path = nil
            return
        }
        shapePreview.path = item.stroke
        shapePreview.strokeColor = RenderGeometry.cgColor(shape.color)
        shapePreview.lineWidth = CGFloat(shape.width)
    }

    // MARK: - Select

    /// The selection's frame in view space (its ink's bounds, padded).
    private func selectionViewRect(_ b: Box) -> CGRect {
        let a = camera.toView(Vec2(b.minX, b.minY))
        let c = camera.toView(Vec2(b.maxX, b.maxY))
        return CGRect(x: a.x, y: a.y, width: c.x - a.x, height: c.y - a.y).insetBy(dx: -Self.selectionPad, dy: -Self.selectionPad)
    }

    /// The four corners' handles (view space): top-left, top-right, bottom-right, bottom-left.
    private func handles(_ r: CGRect) -> [CGPoint] {
        [CGPoint(x: r.minX, y: r.minY), CGPoint(x: r.maxX, y: r.minY), CGPoint(x: r.maxX, y: r.maxY), CGPoint(x: r.minX, y: r.maxY)]
    }

    private func selectBegan(_ p: Vec2, view v: CGPoint) {
        if let b = controller.selectionBounds, !controller.selection.isEmpty {
            let r = selectionViewRect(b)
            let hs = handles(r)
            if let i = hs.indices.min(by: { hypot(hs[$0].x - v.x, hs[$0].y - v.y) < hypot(hs[$1].x - v.x, hs[$1].y - v.y) }),
               hypot(hs[i].x - v.x, hs[i].y - v.y) <= Self.handleReach {
                // resize about the opposite corner of the ink's bounds
                let corners = [Vec2(b.minX, b.minY), Vec2(b.maxX, b.minY), Vec2(b.maxX, b.maxY), Vec2(b.minX, b.maxY)]
                selecting = .resize(anchor: corners[(i + 2) % 4], from: corners[i], scale: 1)
                beginLift()
                return
            }
            if r.contains(v) {
                selecting = .pending(start: p, view: v, onSelection: true, hit: nil)
                return
            }
        }
        selecting = .pending(start: p, view: v, onSelection: false, hit: controller.hit(at: p, margin: 12 / camera.scale))
    }

    private func selectMoved(_ p: Vec2, view v: CGPoint) {
        guard let s = selecting else { return }
        switch s {
        case .pending(let start, let v0, let onSelection, let hit):
            guard hypot(v.x - v0.x, v.y - v0.y) > 6 else { return }
            if onSelection {
                selecting = .move(start: start, delta: .zero)
                beginLift()
            } else if let hit {
                controller.select([hit])
                selecting = .move(start: start, delta: .zero)
                beginLift()
            } else {
                controller.clearSelection()
                selecting = .lasso([start])
            }
            selectMoved(p, view: v)
        case .lasso(var loop):
            if let last = loop.last, camera.toView(last).distance(to: v) < 2 { return }
            loop.append(p)
            selecting = .lasso(loop)
            showLasso(loop)
        case .move(let start, _):
            var d = p - start
            // keep the selection on the page
            if let b = liftBounds {
                d.x = min(max(d.x, screenRect.minX - b.maxX + 24), screenRect.maxX - b.minX - 24)
                d.y = min(max(d.y, screenRect.minY - b.maxY + 24), screenRect.maxY - b.minY - 24)
            }
            selecting = .move(start: start, delta: d)
            liftLayer.setAffineTransform(CGAffineTransform(translationX: d.x, y: d.y))
            if let b = liftBounds { drawSelectionFrame(Box(x: b.x + d.x, y: b.y + d.y, w: b.w, h: b.h)) }
        case .resize(let anchor, let from, _):
            let v0 = from - anchor
            let len2 = max(1e-6, v0.length2)
            // uniform: how far along the corner's diagonal the pen is
            var k = (p - anchor).dot(v0) / len2
            if let b = liftBounds {
                let least = 12 / max(1, min(b.w, b.h))
                k = max(least, min(k, 8))
            }
            selecting = .resize(anchor: anchor, from: from, scale: k)
            if let b = liftBounds {
                let o = Vec2(b.x, b.y)
                let t = Vec2(anchor.x + k * (o.x - anchor.x) - o.x, anchor.y + k * (o.y - anchor.y) - o.y)
                liftLayer.setAffineTransform(CGAffineTransform(a: k, b: 0, c: 0, d: k, tx: t.x, ty: t.y))
                let a2 = anchor + (Vec2(b.minX, b.minY) - anchor) * k
                let c2 = anchor + (Vec2(b.maxX, b.maxY) - anchor) * k
                drawSelectionFrame(Box(x: min(a2.x, c2.x), y: min(a2.y, c2.y), w: abs(c2.x - a2.x), h: abs(c2.y - a2.y)))
            }
        }
    }

    private func selectEnded() {
        guard let s = selecting else { return }
        selecting = nil
        switch s {
        case .pending(let start, _, _, _):
            // a tap: pick what is under it (just that), or nothing
            if let id = controller.hit(at: start, margin: 12 / camera.scale) {
                controller.select([id])
            } else {
                controller.clearSelection()
            }
        case .lasso(let loop):
            lassoLayer.isHidden = true
            controller.select(controller.ids(inLasso: loop))
        case .move(_, let d):
            endLift { self.controller.moveSelection(by: d) }
        case .resize(let anchor, _, let k):
            endLift { self.controller.scaleSelection(by: k, about: anchor) }
        }
    }

    /// Lifts the selection off the tiles onto one layer that moves with the pen: no tile is redrawn
    /// while it moves, whatever the board holds.
    private func beginLift() {
        guard let b = controller.selectionBounds, !controller.selection.isEmpty else { return }
        let ids = controller.selection
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        tiles.hidden = ids
        tiles.invalidate([b])
        tiles.flushInvalidations()
        let items = ids.compactMap { controller.scene.items[$0] }.sorted { $0.order != $1.order ? $0.order < $1.order : $0.id < $1.id }
        let rect = b.expanded(by: 2)
        let scale = min(CGFloat(camera.scale) * contentScaleFactor, 4096 / CGFloat(max(1, max(rect.w, rect.h))))
        liftLayer.contents = TileRasterizer.render(items, rect: rect, scale: scale)?.makeImage()
        liftLayer.setAffineTransform(.identity)
        liftLayer.frame = rect.cgRect
        liftLayer.isHidden = false
        CATransaction.commit()
        liftBounds = b
        controller.isTransforming = true
    }

    /// Puts the lifted selection back: `commit` changes the records (one undoable step), and the
    /// tiles are redrawn in the same transaction the lifted layer goes, so nothing flickers.
    private func endLift(commit: (() -> Void)?) {
        guard liftBounds != nil else { return }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        let b = liftBounds
        tiles.hidden = []
        if let commit {
            commit()
        }
        if let b { tiles.invalidate([b]) }
        tiles.flushInvalidations()
        liftLayer.isHidden = true
        liftLayer.contents = nil
        liftLayer.setAffineTransform(.identity)
        CATransaction.commit()
        liftBounds = nil
        controller.isTransforming = false
        updateSelectionOverlay()
    }

    private func showLasso(_ loop: [Vec2]) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        let path = CGMutablePath()
        path.addLines(between: loop.map { camera.toView($0) })
        lassoLayer.path = path
        lassoLayer.isHidden = false
        CATransaction.commit()
    }

    private func updateSelectionOverlay() {
        guard selecting == nil || liftBounds == nil else { return }
        guard let b = controller.selectionBounds, !controller.selection.isEmpty else {
            selectionFrame.isHidden = true
            selectionHandles.isHidden = true
            return
        }
        drawSelectionFrame(b)
    }

    private func drawSelectionFrame(_ b: Box) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        let r = selectionViewRect(b)
        selectionFrame.path = CGPath(roundedRect: r, cornerWidth: 10, cornerHeight: 10, transform: nil)
        let hs = CGMutablePath()
        for h in handles(r) { hs.addEllipse(in: CGRect(x: h.x - 10, y: h.y - 10, width: 20, height: 20)) }
        selectionHandles.path = hs
        selectionFrame.isHidden = false
        selectionHandles.isHidden = false
        CATransaction.commit()
    }

    // MARK: - Pictures on their way

    private var pendingShown: [UUID: CALayer] = [:]

    private func showPending(_ list: [PendingPicture]) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        let keep = Set(list.filter { $0.screen == controller.currentScreenID }.map(\.id))
        for (id, l) in pendingShown where !keep.contains(id) {
            l.removeFromSuperlayer()
            pendingShown[id] = nil
        }
        for p in list where keep.contains(p.id) && pendingShown[p.id] == nil {
            var item = RenderItem(id: "image:pending", order: "a0", bounds: p.rect)
            item.ops = RenderGeometry.placeholder(rect: CGRect(origin: .zero, size: p.rect.cgRect.size), transform: CGAffineTransform(translationX: p.rect.x, y: p.rect.y), failed: false)
            let scale = min(CGFloat(camera.scale) * contentScaleFactor, 2048 / CGFloat(max(1, max(p.rect.w, p.rect.h))))
            let l = CALayer()
            l.contents = TileRasterizer.render([item], rect: p.rect, scale: scale)?.makeImage()
            l.frame = p.rect.cgRect
            pendingLayer.addSublayer(l)
            pendingShown[p.id] = l
        }
        CATransaction.commit()
    }

    // MARK: - Frame timing while drawing

    private func startFrameMonitor() {
        stopLinkWork?.cancel()
        frameIntervals.removeAll()
        lastFrame = 0
        if displayLink == nil {
            let link = CADisplayLink(target: self, selector: #selector(frameTick(_:)))
            link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
            link.add(to: .main, forMode: .common)
            displayLink = link
        }
    }

    @objc private func frameTick(_ link: CADisplayLink) {
        if lastFrame > 0 {
            let ms = (link.timestamp - lastFrame) * 1000
            frameIntervals.append(ms)
            BoardSignposts.signposter.emitEvent("Frame", "\(ms, format: .fixed(precision: 2)) ms")
        }
        lastFrame = link.timestamp
        // published only when it changes: a change a frame would re-render whatever watches the stats
        let hz = (1 / max(1e-6, link.targetTimestamp - link.timestamp)).rounded()
        if hz.isFinite && hz != controller.stats.displayHz { controller.stats.displayHz = hz }
    }

    private func stopFrameMonitorSoon() {
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.displayLink?.invalidate()
            self.displayLink = nil
            let xs = self.frameIntervals
            guard !xs.isEmpty else { return }
            let expected = 1000 / max(1, self.controller.stats.displayHz)
            var stats = self.controller.stats
            stats.drawingFrameMeanMs = xs.reduce(0, +) / Double(xs.count)
            stats.drawingFrameMaxMs = xs.max() ?? 0
            stats.drawingFramesDropped = xs.filter { $0 > expected * 1.5 }.count
            self.controller.stats = stats
        }
        stopLinkWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25, execute: work)
    }

    // MARK: - BoardRendering

    public func sceneReset(_ index: SceneIndex, screen: ScreenRecord, done: @escaping () -> Void) {
        cancelLive()
        screenRect = screen.rect
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        paper.frame = screen.rect.cgRect
        updateTemplate(screen)
        inkRoot.position = screen.rect.cgRect.origin
        inkRoot.bounds = screen.rect.cgRect
        CATransaction.commit()
        if bounds.width > 0 {
            camera = constraintsInsets.fit(screenRect, in: bounds.size)
            applyCamera()
        }
        showPending(controller.pendingPictures)
        let signpost = BoardSignposts.signposter.beginInterval("BoardLoad", "\(index.count) items")
        tiles.reset(screen: screen.rect, px: bounds.width > 0 ? basePx : 2) { [weak self] in
            BoardSignposts.signposter.endInterval("BoardLoad", signpost)
            self?.updateDetail()
            done()
        }
    }

    public func sceneChanged(_ delta: SceneDelta, index: SceneIndex) {
        updateTemplateLabel()
        if delta.appendsOnTop {
            tiles.paintOnTop(delta.added)
            controller.stats.lastPaintMs = (tiles.lastPaintDrawMs, tiles.lastPaintImageMs)
        } else {
            tiles.invalidate(delta.removedBounds + delta.added.map(\.bounds))
        }
    }

    public func screenChanged(_ screen: ScreenRecord) {
        guard screen.id == controller.currentScreenID else { return }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        updateTemplate(screen)
        CATransaction.commit()
    }

    /// The template for the screen's problem page (none for a plain screen or the All done page).
    private func updateTemplate(_ screen: ScreenRecord) {
        let page = screen.problemPage
        if let last = templateFor, last.page == page, last.rect == screen.rect { return }
        templateFor = (page, screen.rect)
        guard let page, let t = PageTemplate(page: page, screen: screen.rect) else {
            templateLayer.isHidden = true
            return
        }
        templateAnswer.path = t.answer
        templateAnswerLabel.path = t.answerLabel
        templateNotes.path = t.notes
        templateLabel.path = t.label
        templateRules.path = t.rules
        templateRules.lineWidth = t.ruleWidth
        templateLayer.isHidden = false
        updateTemplateLabel()
    }

    /// "Work it out here" is an invitation: it steps aside once the kid has written on the page (a
    /// first line written right under the problem would sit on it).
    private func updateTemplateLabel() {
        guard !templateLayer.isHidden else { return }
        let screen = controller.currentScreenID
        let written = controller.store.drawables(on: screen).contains { r in
            if case .stroke(let s) = r { return s.author == .kid }
            return false
        }
        if templateLabel.isHidden != written { templateLabel.isHidden = written }
    }

    /// Whether the template's "Work it out here" shows (tests).
    public var showsTemplateLabel: Bool { !templateLayer.isHidden && !templateLabel.isHidden }

    /// Whether the current screen shows a template (tests, the Lab).
    public var showsTemplate: Bool { !templateLayer.isHidden }

    /// Redraws now whatever is waiting for this run-loop turn's flush (tests and measurements).
    public func flushTiles() { tiles.flushInvalidations() }

    /// The last tile flush: its time and how many tiles it redrew.
    public var lastTileFlush: (ms: Double, tiles: Int) { (tiles.lastFlushMs, tiles.lastFlushTiles) }

    // MARK: - Camera sweep (the Lab's pan/zoom measurement)

    /// Zooms from the fit to `maxZoom`× and back to `endZoom` over `duration` seconds while panning,
    /// one camera change a display frame (a pinch: no tiles redrawn while it moves), then lets the
    /// detail tiles render. Reports the frame intervals (ms), the slowest frame's own work, and how
    /// long the detail tiles took to arrive after the camera stopped.
    public func sweepCamera(maxZoom: Double = 4, endZoom: Double = 3, duration: TimeInterval = 3,
                            completion: @escaping (_ frames: [Double], _ workMaxMs: Double, _ detailMs: Double) -> Void) {
        let start = CACurrentMediaTime()
        var last = start
        var frames: [Double] = []
        var workMax = 0.0
        let driver = FrameDriver { [weak self] link in
            guard let self else { return true }
            let now = CACurrentMediaTime()
            frames.append((link.timestamp - last) * 1000)
            last = link.timestamp
            let t = min(1, (now - start) / duration)
            let w0 = CACurrentMediaTime()
            let up = sin(min(1, t * 1.5) * .pi / 2) // out to maxZoom, then settle at endZoom
            let z = t < 2.0 / 3 ? 1 + (maxZoom - 1) * up : maxZoom + (endZoom - maxZoom) * (t - 2.0 / 3) * 3
            let anchor = CGPoint(x: self.bounds.width * (0.2 + 0.6 * t), y: self.bounds.height * (0.35 + 0.3 * sin(t * 2 * .pi)))
            self.setZoom(z, around: anchor, refreshDetail: false)
            workMax = max(workMax, (CACurrentMediaTime() - w0) * 1000)
            if t >= 1 {
                let stopped = CACurrentMediaTime()
                self.updateDetail {
                    completion(Array(frames.dropFirst()), workMax, (CACurrentMediaTime() - stopped) * 1000)
                }
                return true
            }
            return false
        }
        driver.start()
    }

    /// Detail tiles on screen now (the Lab's stats).
    public var detailTileCount: Int { tiles.detailTileCount }

    // MARK: - Synthetic input (the Lab's measurements; the simulator has no Pencil)

    /// Draws `points` (view coordinates) as a stroke of `duration` seconds through the same path a
    /// touch takes, one sample per display frame, at Pencil-like 240 Hz coalesced sampling. The tool
    /// in hand decides what it does (ink, rub out, a shape, a lasso or a move).
    public func simulateStroke(_ points: [CGPoint], duration: TimeInterval, pencil: Bool = true, completion: @escaping () -> Void) {
        guard points.count >= 2 else {
            completion()
            return
        }
        let start = CACurrentMediaTime()
        var sent = 0
        func samples(upTo now: CFTimeInterval) -> [Sample] {
            let frac = min(1, (now - start) / duration)
            let n = max(1, Int((frac * Double(points.count - 1)).rounded(.down)) + 1)
            var out: [Sample] = []
            while sent < n {
                let i = sent
                let t = start + duration * Double(i) / Double(points.count - 1)
                let pressure = pencil ? 0.45 + 0.35 * sin(Double(i) / Double(points.count) * .pi) : 0.5
                out.append(Sample(view: points[i], pressure: pressure, altitude: pencil && controller.storesTilt ? 1.1 : -1, azimuth: pencil && controller.storesTilt ? 0.6 : 0, timestamp: t))
                sent += 1
            }
            return out
        }
        let first = samples(upTo: start)
        inkBegan(first[0], pencil: pencil)
        let driver = FrameDriver { [weak self] link in
            guard let self else { return true }
            let now = CACurrentMediaTime()
            let batch = samples(upTo: now)
            if sent >= points.count {
                self.inkEnded(batch, eventTime: now)
                completion()
                return true
            }
            if !batch.isEmpty { self.inkMoved(batch, predicted: []) }
            return false
        }
        driver.start()
    }

    /// A tap at a view point with the tool in hand (synthetic input: the Lab, tests, screenshots).
    public func simulateTap(at p: CGPoint, pencil: Bool = true) {
        let now = CACurrentMediaTime()
        inkBegan(Sample(view: p, pressure: 0.5, altitude: -1, azimuth: 0, timestamp: now), pencil: pencil)
        inkEnded([Sample(view: p, pressure: 0.5, altitude: -1, azimuth: 0, timestamp: now + 0.05)], eventTime: now + 0.05)
    }

    /// A drag from `a` to `b` (view points) in `steps` touch events, synchronously (tests).
    public func simulateDrag(from a: CGPoint, to b: CGPoint, steps: Int = 12, pencil: Bool = true) {
        let now = CACurrentMediaTime()
        func at(_ k: Int) -> Sample {
            let t = Double(k) / Double(steps)
            return Sample(view: CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t), pressure: 0.5, altitude: -1, azimuth: 0, timestamp: now + 0.008 * Double(k))
        }
        inkBegan(at(0), pencil: pencil)
        for k in 1..<steps { inkMoved([at(k)], predicted: []) }
        inkEnded([at(steps)], eventTime: now + 0.008 * Double(steps))
    }

    /// A drag along `points` (view), synchronously (tests: a lasso, an eraser path).
    public func simulatePath(_ points: [CGPoint], pencil: Bool = true) {
        guard let first = points.first else { return }
        let now = CACurrentMediaTime()
        inkBegan(Sample(view: first, pressure: 0.5, altitude: -1, azimuth: 0, timestamp: now), pencil: pencil)
        for (k, p) in points.dropFirst().dropLast().enumerated() {
            inkMoved([Sample(view: p, pressure: 0.5, altitude: -1, azimuth: 0, timestamp: now + 0.008 * Double(k + 1))], predicted: [])
        }
        let last = points.last ?? first
        inkEnded([Sample(view: last, pressure: 0.5, altitude: -1, azimuth: 0, timestamp: now + 0.008 * Double(points.count))], eventTime: now + 0.008 * Double(points.count))
    }
}

private extension CGPoint {
    func distance(to p: CGPoint) -> CGFloat { hypot(x - p.x, y - p.y) }
}

/// A display-link loop that runs until its body returns true.
@MainActor
final class FrameDriver: NSObject {
    private var link: CADisplayLink?
    private let body: (CADisplayLink) -> Bool
    private var keepAlive: FrameDriver?

    init(_ body: @escaping (CADisplayLink) -> Bool) {
        self.body = body
    }

    func start() {
        keepAlive = self
        let link = CADisplayLink(target: self, selector: #selector(tick(_:)))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
        link.add(to: .main, forMode: .common)
        self.link = link
    }

    func stop() {
        link?.invalidate()
        link = nil
        keepAlive = nil
    }

    @objc private func tick(_ link: CADisplayLink) {
        if body(link) { stop() }
    }
}
#endif
