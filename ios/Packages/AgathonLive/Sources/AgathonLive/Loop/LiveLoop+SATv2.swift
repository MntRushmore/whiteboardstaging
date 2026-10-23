import AgathonBoard
import AgathonBrain
import Foundation

/// A question's printed coordinate plane on its page (SAT v2, docs/SAT-V2.md): its grid in page
/// coordinates and the axes' window. The app's SAT session hands it to the loop (`questionPlot`).
public struct QuestionPlot: Equatable, Sendable {
    /// the grid, page coordinates
    public var grid: BrainRect
    public var xMin: Double
    public var xMax: Double
    public var yMin: Double
    public var yMax: Double

    public init(grid: BrainRect, xMin: Double, xMax: Double, yMin: Double, yMax: Double) {
        self.grid = grid
        self.xMin = xMin
        self.xMax = xMax
        self.yMin = yMin
        self.yMax = yMax
    }

    /// The page point of graph point (x, y).
    public func page(_ x: Double, _ y: Double) -> Vec2 {
        Vec2(grid.x + (x - xMin) / (xMax - xMin) * grid.w, grid.y + grid.h - (y - yMin) / (yMax - yMin) * grid.h)
    }

    /// `expr` (the engine's plot expression in x) as polylines across the plane, in page coordinates,
    /// broken where it leaves the window (a little past it, so a steep line meets the edge).
    public func polylines(_ expr: String, samples: Int = 240) -> [[Vec2]] {
        guard xMax > xMin, yMax > yMin, let f = MathExpr.compile(expr) else { return [] }
        let pad = (yMax - yMin) * 0.02
        var out: [[Vec2]] = []
        var cur: [Vec2] = []
        for i in 0...samples {
            let x = xMin + (xMax - xMin) * Double(i) / Double(samples)
            let y = f(x)
            guard y.isFinite, y >= yMin - pad, y <= yMax + pad else {
                if cur.count > 1 { out.append(cur) }
                cur = []
                continue
            }
            cur.append(page(x, y))
        }
        if cur.count > 1 { out.append(cur) }
        return out
    }
}

/// What SAT v2 needs of the loop on a question's page: writing the tutor's maths with help off (the
/// hint ladder's bank steps work capped), one step through the live Help me, the lines read so far,
/// and graphs drawn onto the question's own plane.
extension LiveLoop {
    /// The lines read on the page on show, top to bottom (their LaTeX and ink).
    public var readLines: [(latex: String, bounds: BrainRect)] {
        lines.values.filter { !$0.latex.isEmpty }.sorted { ($0.bounds.y, $0.bounds.x) < ($1.bounds.y, $1.bounds.x) }.map { ($0.latex, $0.bounds) }
    }

    /// The tutor's hand is writing (a block not yet finished).
    public var busyWriting: Bool { writer?.isWriting == true }

    /// Rung 2 with the day's pass: ONE next step through the live Help me (Next step), under the
    /// student's last line. False when the tutor is off here or has nothing read to help with (the
    /// app then writes the bank's next step).
    @discardableResult
    public func helpOneStep() -> Bool {
        guard started, settings.enabled, !readLines.isEmpty else { return false }
        if settings.mode != .suggest { settings.mode = .suggest }
        // a line the engine finds finished (a true sum: `\frac{48-24}{6-2} = 6`, the slope) has no next step of
        // its own, and Help me said "nothing yet" while the app waited 12 s for the bank's step (the SAT v2
        // end-to-end run). The question is not finished: the next step comes from the model, which reads the
        // bank's question (the engine first, as Solve's first step does)
        if let target = helpTargetLine(), !reading.contains(target.id), target.analysis?.solved == true, !needsLook(target) {
            noteAsked()
            startSolve(column: target.column, fromLineId: target.id, lineId: target.id, onlyFirstStep: true)
            return true
        }
        helpMe()
        return true
    }

    /// Writes `steps` (LaTeX, a line each) in the tutor's hand, the first line's top-left at `origin`
    /// (page coordinates), the hand the height of `lineHeight`. Works with help off: the hand is the
    /// engine's, no call is made. Returns the block's bounds once the writing has started (nil when
    /// the hand cannot draw it all).
    @discardableResult
    public func writeTutorMath(_ steps: [String], at origin: Vec2, lineHeight: Double, seedKey: String, meta: Meta = [:]) async -> BrainRect? {
        guard !steps.isEmpty, let plan = await plan(steps, lineHeight: lineHeight, seedKey: seedKey) else { return nil }
        let placed = Self.moved(plan, to: AgathonBrain.Point(x: origin.x, y: origin.y))
        var m = meta
        m[LiveMeta.live] = true
        m[LiveMeta.source] = "sat"
        m[LiveMeta.createdAt] = .number((Date().timeIntervalSince1970 * 1000).rounded())
        _ = writeBlock(placed, meta: m)
        return placed.bounds
    }

    // MARK: - graphs onto the question's plane

    /// `expr` (the engine's plot of `latex`) drawn onto the question's plane in the tutor's ink,
    /// clipped to its window. False when the page has no plane.
    @discardableResult
    func graphOntoQuestion(expr: String, latex: String, lineId: String?, source: String) -> Bool {
        guard let plot = questionPlot?(board.currentScreenID) else { return false }
        let polylines = plot.polylines(expr)
        guard !polylines.isEmpty else { return false }
        let screen = board.currentScreenID
        var meta: Meta = [LiveMeta.live: true, LiveMeta.source: .string(source), LiveMeta.graphFor: .string(latex), LiveMeta.onFigure: "plot",
                          LiveMeta.createdAt: .number((Date().timeIntervalSince1970 * 1000).rounded())]
        if let lineId { meta[LiveMeta.lineId] = .string(lineId) }
        board.store.transact(.tutor) { tx in
            var order = board.store.nextOrder(on: screen)
            for line in polylines {
                guard let first = line.first else { continue }
                let points = line.map { InkPoint(x: Float($0.x - first.x), y: Float($0.y - first.y), pressure: 0.5, t: 0) }
                tx.put(.stroke(StrokeRecord(screen: screen, order: order, author: .tutor, color: .tutor, width: QuestionPlot.inkWidth,
                                            pressure: .simulated, x: first.x, y: first.y, points: points, meta: meta)))
                order = OrderKey.after(order)
            }
        }
        return true
    }
}

extension QuestionPlot {
    /// The tutor's line on a figure (the design notes: the tutor hand's 3.6).
    public static let inkWidth = 3.6
}
