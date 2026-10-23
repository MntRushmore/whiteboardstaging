import CoreGraphics
import CoreText
import Foundation

/// Content printed on a page, like the question on a worksheet (SAT v2, docs/SAT-V2.md: "the question
/// is the page"): paths, words and typeset maths in the page's own units. Never a record: it is not
/// erased, selected, read, saved or sent anywhere, and the ink goes on top of it. The canvas draws
/// it between the template and the ink in tiles at the zoom on show (`BoardCanvasView.printProvider`),
/// so it is as crisp at 4× as at 1×.
///
/// Its units are the layout's: 1600 across, whatever the screen's own rect (the canvas scales it to
/// the screen's width, as `ProblemPageLayout.place` does).
public struct PagePrint: @unchecked Sendable {
    public enum Item: @unchecked Sendable {
        /// a filled shape
        case fill(CGPath, CGColor)
        /// a stroked path (round caps and joins), dashed when `dash` is not empty
        case stroke(CGPath, CGColor, width: CGFloat, dash: [CGFloat])
        /// a line of words with its baseline's left end at a point
        case text(CTLine, at: CGPoint)
        /// typeset maths with its baseline's left end at a point
        case math(TypesetMath, at: CGPoint)
        /// everything inside clipped to a rect
        case clip(CGRect, [Item])
        /// everything inside drawn through a transform (a turned axis name)
        case transformed(CGAffineTransform, [Item])
    }

    /// What it is (two prints with the same key draw the same: the canvas keeps its tiles)
    public var key: String
    public var items: [Item]

    public init(key: String, items: [Item]) {
        self.key = key
        self.items = items
    }

    public static let empty = PagePrint(key: "", items: [])

    /// Draws the print into a page-space context (y down).
    public func draw(in ctx: CGContext) {
        Self.draw(items, in: ctx)
    }

    static func draw(_ items: [Item], in ctx: CGContext) {
        for item in items {
            switch item {
            case .fill(let path, let color):
                ctx.setFillColor(color)
                ctx.addPath(path)
                ctx.fillPath()
            case .stroke(let path, let color, let width, let dash):
                ctx.saveGState()
                ctx.setStrokeColor(color)
                ctx.setLineWidth(width)
                ctx.setLineCap(.round)
                ctx.setLineJoin(.round)
                if !dash.isEmpty { ctx.setLineDash(phase: 0, lengths: dash) }
                ctx.addPath(path)
                ctx.strokePath()
                ctx.restoreGState()
            case .text(let line, let at):
                ctx.saveGState()
                ctx.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
                ctx.textPosition = at
                CTLineDraw(line, ctx)
                ctx.restoreGState()
            case .math(let m, let at):
                m.draw(ctx, at)
            case .clip(let rect, let inner):
                ctx.saveGState()
                ctx.clip(to: rect)
                draw(inner, in: ctx)
                ctx.restoreGState()
            case .transformed(let t, let inner):
                ctx.saveGState()
                ctx.concatenate(t)
                draw(inner, in: ctx)
                ctx.restoreGState()
            }
        }
    }

    /// The rect everything is in (paths' boxes, lines' and maths' ink), nil when empty.
    public var bounds: CGRect? {
        Self.bounds(items)
    }

    static func bounds(_ items: [Item]) -> CGRect? {
        var out: CGRect?
        func add(_ r: CGRect) { out = out.map { $0.union(r) } ?? r }
        for item in items {
            switch item {
            case .fill(let p, _): add(p.boundingBoxOfPath)
            case .stroke(let p, _, let w, _): add(p.boundingBoxOfPath.insetBy(dx: -w / 2, dy: -w / 2))
            case .text(let line, let at):
                var a: CGFloat = 0, d: CGFloat = 0, l: CGFloat = 0
                let w = CTLineGetTypographicBounds(line, &a, &d, &l)
                add(CGRect(x: at.x, y: at.y - a, width: w, height: a + d))
            case .math(let m, let at): add(CGRect(x: at.x, y: at.y - m.ascent, width: m.width, height: m.height))
            case .clip(let r, let inner): if let b = bounds(inner) { add(b.intersection(r)) }
            case .transformed(let t, let inner): if let b = bounds(inner) { add(b.applying(t)) }
            }
        }
        return out
    }
}
