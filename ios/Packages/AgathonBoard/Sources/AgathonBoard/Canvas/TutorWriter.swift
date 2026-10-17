#if canImport(UIKit)
import QuartzCore
import UIKit

/// The tutor writing on the board at handwriting pace (the web's `HandWriter`): each stroke appears
/// as the pen moves along it, on an overlay; once a stroke is finished it goes into the store as the
/// tutor's ink (origin `.tutor`: saved, never in the kid's undo stack). The Live loop drives it
/// later; Phase 0 drives it from the Lab.
///
/// Cancelling finishes every line already begun, whole, and drops the rest: what is saved is always
/// whole lines, never half an equation. With Reduce Motion on, the writing appears at once.
@MainActor
public final class TutorWriter {
    private let controller: BoardController
    private weak var canvas: BoardCanvasView?
    private var plan: HandPace.Plan?
    private var screen: RecordID = ""
    private var meta: Meta = [:]
    private var block = ""
    private var startedAt: CFTimeInterval = 0
    private var blockStart: Double = 0
    private var committed: [[Bool]] = []
    private var overlays: [[CAShapeLayer?]] = []
    private var driver: FrameDriver?
    private var onDone: (() -> Void)?

    public init(controller: BoardController, canvas: BoardCanvasView) {
        self.controller = controller
        self.canvas = canvas
    }

    public var isWriting: Bool { plan != nil }

    /// Writes `lines` on the current screen. Returns false when it is already writing.
    @discardableResult
    public func write(_ lines: [TutorLine], meta: Meta = [:], onDone: (() -> Void)? = nil) -> Bool {
        guard plan == nil else { return false }
        let p = HandPace.plan(lines)
        guard !p.lines.isEmpty else {
            onDone?()
            return true
        }
        plan = p
        screen = controller.currentScreenID
        self.meta = meta.merging(["live": true, "source": "ai", "createdAt": .number((Date().timeIntervalSince1970 * 1000).rounded())]) { a, _ in a }
        block = "hb_\(RecordID.make(.stroke).key)"
        committed = p.lines.map { $0.strokes.map { _ in false } }
        overlays = p.lines.map { $0.strokes.map { _ in nil } }
        startedAt = CACurrentMediaTime()
        blockStart = (Date().timeIntervalSince1970 * 1000).rounded()
        self.onDone = onDone
        if UIAccessibility.isReduceMotionEnabled {
            finish(all: true)
            return true
        }
        let d = FrameDriver { [weak self] _ in self?.frame() ?? true }
        driver = d
        d.start()
        return true
    }

    /// Stops: lines begun are finished whole, the rest are not written.
    public func cancel() {
        guard plan != nil else { return }
        finish(all: false)
    }

    private func frame() -> Bool {
        guard let plan else { return true }
        let t = (CACurrentMediaTime() - startedAt) * 1000 * plan.pace
        reveal(at: t)
        if t >= plan.totalMs {
            finish(all: true)
            return true
        }
        return false
    }

    private func reveal(at t: Double) {
        guard let plan, let canvas else { return }
        var commits: [(Int, Int)] = []
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for (i, line) in plan.lines.enumerated() where t > line.startMs {
            let counts = HandPace.revealCounts(line, localMs: t - line.startMs)
            for (j, count) in counts.enumerated() where !committed[i][j] {
                if count == 0 { break }
                let s = line.strokes[j]
                if count >= s.points.count {
                    commits.append((i, j))
                    continue
                }
                let layer = overlays[i][j] ?? {
                    let l = CAShapeLayer()
                    l.fillColor = RenderGeometry.cgColor(line.source.color)
                    l.actions = ["path": NSNull()]
                    canvas.tutorLayer.addSublayer(l)
                    overlays[i][j] = l
                    return l
                }()
                let pts = Array(s.points.prefix(count))
                let outline = Freehand.outline(pts, InkStyle.options(width: InkStyle.tutorWidth(weight: s.weight), pressure: .real, complete: false))
                layer.path = Freehand.path(outline)
            }
        }
        commit(commits)
        CATransaction.commit()
    }

    /// Puts finished strokes in the store (one tutor change) and takes their overlays away in the
    /// same frame, so nothing flickers.
    private func commit(_ list: [(Int, Int)]) {
        guard let plan, !list.isEmpty else { return }
        let keys = (try? OrderKey.sequence(list.count, after: controller.store.topOrder(on: screen))) ?? []
        controller.store.transact(.tutor) { tx in
            for (n, (i, j)) in list.enumerated() {
                committed[i][j] = true
                let order = n < keys.count ? keys[n] : controller.store.nextOrder(on: screen)
                tx.put(.stroke(HandPace.strokeRecord(
                    plan, line: i, stroke: j, screen: screen, order: order, blockStart: blockStart, block: block, meta: meta)))
            }
        }
        for (i, j) in list {
            overlays[i][j]?.removeFromSuperlayer()
            overlays[i][j] = nil
        }
    }

    private func finish(all: Bool) {
        guard let plan else { return }
        driver?.stop()
        driver = nil
        var list: [(Int, Int)] = []
        for (i, line) in plan.lines.enumerated() {
            let begun = all || committed[i].contains(true) || overlays[i].contains { $0 != nil }
            guard begun else { continue }
            for j in line.strokes.indices where !committed[i][j] { list.append((i, j)) }
        }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        commit(list)
        for row in overlays { for l in row { l?.removeFromSuperlayer() } }
        CATransaction.commit()
        self.plan = nil
        overlays = []
        committed = []
        let done = onDone
        onDone = nil
        done?()
    }
}
#endif
