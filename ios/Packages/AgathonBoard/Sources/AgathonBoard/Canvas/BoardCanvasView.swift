#if canImport(UIKit)
import Combine
import QuartzCore
import UIKit

/// The board on screen: the current 16:9 screen on a flat surface, Apple Pencil first.
///
/// Layers, in page space under one camera transform:
///   paper (the white screen) → settled ink tiles (`TileLayers`) → the tutor's writing being revealed
///   → the kid's live stroke (a shape layer redrawn on every touch event)
///
/// Input rules:
///  - the Pencil always draws (coalesced and predicted touches, force, altitude, azimuth);
///  - a finger draws only while fingers draw (`BoardController.fingerDraws`: the "draw with finger"
///    setting, or no Pencil ever seen on this device); otherwise one finger pans;
///  - two fingers pan and pinch; a second finger cancels a finger's stroke;
///  - while the Pencil is down nothing else starts (a palm cannot pan or draw);
///  - double-tap on the Pencil switches pen ⇄ eraser.
@MainActor
public final class BoardCanvasView: UIView, BoardRendering, UIGestureRecognizerDelegate, UIPencilInteractionDelegate {
    public let controller: BoardController

    /// Room the board's chrome takes over the view, and the zoom range.
    public var constraintsInsets = CameraConstraints() {
        didSet { refit() }
    }

    public private(set) var camera = Camera()
    private var screenRect = Box.screen
    private var lastSize = CGSize.zero

    private let content = CALayer()
    private let paper = CALayer()
    private let tiles = TileLayers()
    /// the tutor's writing in progress (`TutorWriter` puts its strokes here)
    public let tutorLayer = CALayer()
    private let liveLayer = CAShapeLayer()
    private let eraserCursor = CAShapeLayer()

    private let ink = InkGestureRecognizer()
    private let pan = UIPanGestureRecognizer()
    private let pinch = UIPinchGestureRecognizer()
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
    }
    private var live: Live?
    private var erasing: (last: Vec2, started: TimeInterval)?

    // frame timing while drawing
    private var displayLink: CADisplayLink?
    private var frameIntervals: [Double] = []
    private var lastFrame: CFTimeInterval = 0
    private var stopLinkWork: DispatchWorkItem?

    public init(controller: BoardController) {
        self.controller = controller
        super.init(frame: .zero)
        backgroundColor = Self.surface
        isMultipleTouchEnabled = true
        setUpLayers()
        setUpGestures()
        controller.$drawWithFinger.combineLatest(controller.$pencilSeen)
            .sink { [weak self] _ in DispatchQueue.main.async { self?.applyInputRules() } }
            .store(in: &cancellables)
        controller.$tool.sink { [weak self] _ in self?.cancelLive() }.store(in: &cancellables)
        controller.renderer = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    /// The flat surface around the screen (flat colour, no gradient).
    static let surface = UIColor(red: 0.925, green: 0.918, blue: 0.898, alpha: 1)

    private func setUpLayers() {
        content.anchorPoint = .zero
        content.actions = ["transform": NSNull(), "sublayerTransform": NSNull(), "position": NSNull(), "bounds": NSNull()]
        layer.addSublayer(content)

        paper.backgroundColor = UIColor.white.cgColor
        paper.shadowColor = UIColor.black.cgColor
        paper.shadowOpacity = 0.10
        paper.shadowRadius = 10
        paper.shadowOffset = CGSize(width: 0, height: 2)
        paper.actions = ["position": NSNull(), "bounds": NSNull(), "shadowPath": NSNull()]
        content.addSublayer(paper)
        content.addSublayer(tiles.root)
        tutorLayer.actions = ["sublayers": NSNull()]
        content.addSublayer(tutorLayer)

        liveLayer.lineWidth = 0
        liveLayer.actions = ["path": NSNull(), "fillColor": NSNull(), "contentsScale": NSNull()]
        content.addSublayer(liveLayer)

        eraserCursor.fillColor = UIColor(white: 0.5, alpha: 0.12).cgColor
        eraserCursor.strokeColor = UIColor(white: 0.35, alpha: 0.6).cgColor
        eraserCursor.lineWidth = 1.5
        eraserCursor.isHidden = true
        eraserCursor.actions = ["path": NSNull(), "hidden": NSNull(), "position": NSNull()]
        layer.addSublayer(eraserCursor)
    }

    private func setUpGestures() {
        ink.delegate = self
        ink.onBegan = { [weak self] t, e in self?.touchBegan(t, e) }
        ink.onMoved = { [weak self] t, e in self?.touchMoved(t, e) }
        ink.onEnded = { [weak self] t, e in self?.touchEnded(t, e) }
        ink.onCancelled = { [weak self] in self?.cancelLive() }
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
        CATransaction.commit()
    }

    private func updateDetail() {
        guard bounds.width > 0 else { return }
        tiles.updateDetail(visible: camera.visibleRect(viewSize: bounds.size), effectivePx: CGFloat(camera.scale) * contentScaleFactor)
    }

    /// Zoom: 1 = the whole screen fits.
    public var zoom: Double { constraintsInsets.zoom(of: camera, screen: screenRect, in: bounds.size) }

    /// Sets the zoom about a view point (the Lab's buttons; pinch does the same).
    public func setZoom(_ z: Double, around p: CGPoint? = nil) {
        let fit = constraintsInsets.fit(screenRect, in: bounds.size)
        let anchor = p ?? CGPoint(x: bounds.midX, y: bounds.midY)
        let page = camera.toPage(anchor)
        var c = camera
        c.scale = fit.scale * z
        c.offset = Vec2(anchor.x - page.x * c.scale, anchor.y - page.y * c.scale)
        camera = constraintsInsets.clamp(c, screen: screenRect, in: bounds.size)
        applyCamera()
        updateDetail()
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
    }

    private func sample(_ t: UITouch) -> Sample {
        let pencil = t.type == .pencil
        return Sample(
            view: pencil ? t.preciseLocation(in: self) : t.location(in: self),
            pressure: pencil ? InkStyle.pencilPressure(force: Double(t.force), maximumForce: Double(t.maximumPossibleForce)) : 0.5,
            altitude: pencil && controller.storesTilt ? Double(t.altitudeAngle) : -1,
            azimuth: pencil && controller.storesTilt ? Double(t.azimuthAngle(in: self)) : 0,
            timestamp: t.timestamp)
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
    }

    private func cancelLive() {
        if live != nil {
            live = nil
            liveLayer.path = nil
        }
        if erasing != nil {
            erasing = nil
            controller.endErase()
            eraserCursor.isHidden = true
        }
    }

    // MARK: - The stroke being drawn (shared by touches and synthetic input)

    func inkBegan(_ s: Sample, pencil: Bool) {
        cancelLive()
        startFrameMonitor()
        let page = camera.toPage(s.view)
        if controller.tool == .eraser {
            controller.beginErase()
            erasing = (page, s.timestamp)
            showEraser(at: s.view)
            eraseSegment(from: page, to: page)
            return
        }
        // pen down in wall-clock ms: the touch's time is on the same clock as CACurrentMediaTime
        let start = (Date().timeIntervalSince1970 - (CACurrentMediaTime() - s.timestamp)) * 1000
        let origin = Vec2((page.x * 16).rounded() / 16, (page.y * 16).rounded() / 16)
        let template = controller.strokeTemplate(pressure: pencil ? .real : .simulated, at: origin, start: start.rounded())
        live = Live(stroke: template, origin: origin, startTimestamp: s.timestamp, pencil: pencil, lastPage: page)
        liveLayer.fillColor = RenderGeometry.cgColor(template.color)
        appendSamples([s])
        redrawLive(predicted: [])
    }

    func inkMoved(_ samples: [Sample], predicted: [Sample]) {
        if let e = erasing {
            var last = e.last
            for s in samples {
                let p = camera.toPage(s.view)
                eraseSegment(from: last, to: p)
                last = p
            }
            erasing = (last, e.started)
            if let s = samples.last { showEraser(at: s.view) }
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
        guard live != nil else { return }
        appendSamples(samples)
        guard let l = live else { return }
        let signpost = BoardSignposts.signposter.beginInterval("Commit")
        let workStart = CACurrentMediaTime()
        var stroke = l.stroke
        stroke.points = l.points
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        controller.commitStroke(stroke) // → store → scene → tiles, synchronously
        liveLayer.path = nil
        CATransaction.commit()
        live = nil
        let done = CACurrentMediaTime()
        BoardSignposts.signposter.endInterval("Commit", signpost)
        var stats = controller.stats
        stats.lastCommitWorkMs = (done - workStart) * 1000
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
            l.points.append(InkPoint(
                x: Float(page.x - l.origin.x), y: Float(page.y - l.origin.y), pressure: Float(s.pressure),
                altitude: Float(s.altitude), azimuth: Float(s.azimuth),
                t: Float(max(0, (s.timestamp - l.startTimestamp) * 1000))))
        }
        live = l
    }

    private func redrawLive(predicted: [Sample]) {
        guard var l = live else { return }
        let started = CACurrentMediaTime()
        let signpost = BoardSignposts.signposter.beginInterval("LivePath")
        var input = l.points.map { FreehandInput(Vec2(Double($0.x), Double($0.y)), Double($0.pressure)) }
        for s in predicted {
            let p = camera.toPage(s.view)
            input.append(FreehandInput(Vec2(p.x - l.origin.x, p.y - l.origin.y), s.pressure))
        }
        let outline = Freehand.outline(input, InkStyle.options(width: l.stroke.width, pressure: l.stroke.pressure, complete: false))
        let path = Freehand.path(outline, transform: CGAffineTransform(translationX: l.origin.x, y: l.origin.y))
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        liveLayer.path = path
        CATransaction.commit()
        BoardSignposts.signposter.endInterval("LivePath", signpost)
        l.livePathMaxMs = max(l.livePathMaxMs, (CACurrentMediaTime() - started) * 1000)
        live = l
    }

    private func eraseSegment(from a: Vec2, to b: Vec2) {
        let started = CACurrentMediaTime()
        let margin = BoardController.eraserReach / camera.scale
        let hit = controller.erase(from: a, to: b, margin: margin)
        if !hit.isEmpty { controller.stats.lastEraseMs = (CACurrentMediaTime() - started) * 1000 }
    }

    private func showEraser(at p: CGPoint) {
        let r = CGFloat(BoardController.eraserReach)
        eraserCursor.path = UIBezierPath(ovalIn: CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r)).cgPath
        eraserCursor.isHidden = false
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
        let hz = 1 / max(1e-6, link.targetTimestamp - link.timestamp)
        if hz.isFinite { controller.stats.displayHz = (hz).rounded() }
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
        paper.shadowPath = CGPath(rect: CGRect(origin: .zero, size: screen.rect.cgRect.size), transform: nil)
        CATransaction.commit()
        if bounds.width > 0 {
            camera = constraintsInsets.fit(screenRect, in: bounds.size)
            applyCamera()
        }
        let signpost = BoardSignposts.signposter.beginInterval("BoardLoad", "\(index.count) items")
        tiles.reset(index: index, screen: screen.rect, px: bounds.width > 0 ? basePx : 2) { [weak self] in
            BoardSignposts.signposter.endInterval("BoardLoad", signpost)
            self?.updateDetail()
            done()
        }
    }

    public func sceneChanged(_ delta: SceneDelta, index: SceneIndex) {
        if delta.appendsOnTop {
            tiles.paintOnTop(delta.added, index: index)
        } else {
            tiles.invalidate(delta.removedBounds + delta.added.map(\.bounds), index: index)
        }
    }

    // MARK: - Synthetic input (the Lab's measurements; the simulator has no Pencil)

    /// Draws `points` (view coordinates) as a stroke of `duration` seconds through the same path a
    /// touch takes, one sample per display frame, at Pencil-like 240 Hz coalesced sampling.
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
