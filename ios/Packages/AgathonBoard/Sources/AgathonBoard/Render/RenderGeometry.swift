import CoreGraphics
import CoreText
import Foundation

/// The pen model: how a stroke's width, pressure and points become a freehand outline. The values
/// are tldraw's draw-shape options, so a converted board looks the way it did on the web and new
/// ink matches old.
public enum InkStyle {
    /// The kid's pen sizes: tldraw's `l` (the simple board's pen) and `m` (the classic board's).
    public enum PenSize: String, CaseIterable, Sendable {
        case regular
        case fine

        /// base width in page units (tldraw: (STROKE_SIZES[size] + 1) × scale)
        public var width: Double {
            switch self {
            case .regular: return 6 // l: 5 + 1
            case .fine: return 4.5 // m: 3.5 + 1
            }
        }
    }

    /// The tutor's hand: tldraw `s` (2 + 1) × the stroke's weight.
    public static func tutorWidth(weight: Double = 1) -> Double { 3 * weight }

    /// A Pencil's force as the pen model reads it: force / max × 1.25, capped at 1 (tldraw's mapping of
    /// a pointer's pressure, so new ink has the weight old ink had).
    public static func pencilPressure(force: Double, maximumForce: Double) -> Double {
        guard maximumForce > 0 else { return 0.5 }
        return min(1, max(0, force / maximumForce * 1.25))
    }

    public static func options(width sw: Double, pressure: PressureMode, complete: Bool) -> FreehandOptions {
        var o = FreehandOptions()
        o.last = complete
        switch pressure {
        case .real:
            o.size = 1 + sw * 1.2
            o.thinning = 0.62
            o.streamline = 0.62
            o.smoothing = 0.62
            o.simulatePressure = false
            o.smoothRealPressure = true
            o.easing = .pen
        case .simulated:
            o.size = sw
            o.thinning = 0.5
            // tldraw: modulate(sw, [9, 16], [0.64, 0.74], clamp)
            o.streamline = 0.64 + (min(max(sw, 9), 16) - 9) / 7 * 0.10
            o.smoothing = 0.62
            o.simulatePressure = true
            o.easing = .easeOutSine
        }
        return o
    }

    /// A stroke's outline in its own space (relative to its origin, before rotation).
    public static func localOutline(points: [InkPoint], width: Double, pressure: PressureMode, complete: Bool = true) -> [Vec2] {
        let input = points.map { FreehandInput(Vec2(Double($0.x), Double($0.y)), Double($0.pressure)) }
        return Freehand.outline(input, options(width: width, pressure: pressure, complete: complete))
    }
}

/// What the renderer draws for one record: paths in page space, ready for any thread.
/// (CGPath, CGColor and CTLine are immutable and safe to share across threads.)
public struct RenderItem: @unchecked Sendable {
    public enum Text: @unchecked Sendable {
        case line(CTLine, origin: CGPoint)
    }

    public let id: RecordID
    public let order: OrderKey
    /// page-space bounds of everything drawn, ink width included
    public let bounds: Box
    /// a closed shape's inside, drawn first
    public var underFill: CGPath?
    public var underFillColor: CGColor?
    /// filled ink (a freehand outline)
    public var fill: CGPath?
    public var fillColor: CGColor?
    /// stroked geometry (shapes, frames)
    public var stroke: CGPath?
    public var strokeColor: CGColor?
    public var lineWidth: CGFloat = 0
    public var texts: [Text] = []
    public var alpha: CGFloat = 1

    public init(id: RecordID, order: OrderKey, bounds: Box) {
        self.id = id
        self.order = order
        self.bounds = bounds
    }

    /// Draws the item into a context whose user space is page space.
    public func draw(in ctx: CGContext) {
        if alpha < 1 {
            ctx.saveGState()
            ctx.setAlpha(alpha)
            ctx.beginTransparencyLayer(auxiliaryInfo: nil)
        }
        if let underFill, let underFillColor {
            ctx.addPath(underFill)
            ctx.setFillColor(underFillColor)
            ctx.fillPath()
        }
        if let fill, let fillColor {
            ctx.addPath(fill)
            ctx.setFillColor(fillColor)
            ctx.fillPath(using: .winding)
        }
        if let stroke, let strokeColor {
            ctx.addPath(stroke)
            ctx.setStrokeColor(strokeColor)
            ctx.setLineWidth(lineWidth)
            ctx.setLineCap(.round)
            ctx.setLineJoin(.round)
            ctx.strokePath()
        }
        for t in texts {
            switch t {
            case .line(let line, let origin):
                ctx.saveGState()
                // page space is y-down; CoreText draws y-up
                ctx.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
                ctx.textPosition = origin
                CTLineDraw(line, ctx)
                ctx.restoreGState()
            }
        }
        if alpha < 1 {
            ctx.endTransparencyLayer()
            ctx.restoreGState()
        }
    }
}

public enum RenderGeometry {
    static let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!

    /// An sRGB colour.
    public static func rgba(_ r: Double, _ g: Double, _ b: Double, _ a: Double) -> CGColor {
        CGColor(colorSpace: colorSpace, components: [r, g, b, a]) ?? CGColor(red: r, green: g, blue: b, alpha: a)
    }

    public static func cgColor(_ c: InkColor, alpha: CGFloat = 1) -> CGColor {
        let (r, g, b) = c.rgb
        return rgba(r, g, b, alpha)
    }

    static func tint(_ c: InkColor, _ amount: Double) -> CGColor {
        // the colour at `amount` over white, opaque (a flat tint, never a gradient)
        let (r, g, b) = c.rgb
        return rgba(1 - (1 - r) * amount, 1 - (1 - g) * amount, 1 - (1 - b) * amount, 1)
    }

    static func fillColor(_ f: FillStyle, _ c: InkColor) -> CGColor {
        switch f {
        case .solid: return cgColor(c)
        case .paper: return rgba(0.988, 1, 0.996, 1)
        default: return tint(c, 0.25)
        }
    }

    /// The render item for a drawn record (nil for records that are not drawn).
    public static func item(for record: BoardRecord) -> RenderItem? {
        switch record {
        case .stroke(let s): return stroke(s)
        case .shape(let s): return shape(s)
        case .image(let r): return image(r)
        case .math(let m): return math(m)
        case .graph(let g): return graph(g)
        default: return nil
        }
    }

    // MARK: strokes

    public static func strokeTransform(_ s: StrokeRecord) -> CGAffineTransform {
        CGAffineTransform(translationX: s.x, y: s.y).rotated(by: s.rotation)
    }

    public static func stroke(_ s: StrokeRecord) -> RenderItem {
        let outline = InkStyle.localOutline(points: s.points, width: s.width, pressure: s.pressure)
        let t = strokeTransform(s)
        let path = Freehand.path(outline, transform: t)
        let local = Box.around(outline) ?? Box(x: 0, y: 0, w: 0, h: 0)
        let bounds = Box(path.boundingBoxOfPath.isNull ? local.cgRect.applying(t) : path.boundingBoxOfPath).expanded(by: 1)
        var item = RenderItem(id: s.id, order: s.order, bounds: bounds)
        item.fill = path
        item.fillColor = cgColor(s.color)
        if s.closed && s.fill != .none && s.points.count > 2 {
            let inside = CGMutablePath()
            inside.addLines(between: s.points.map { CGPoint(x: Double($0.x), y: Double($0.y)) }, transform: t)
            inside.closeSubpath()
            item.underFill = inside
            item.underFillColor = fillColor(s.fill, s.color)
        }
        if s.meta["highlight"]?.boolValue == true { item.alpha = 0.35 }
        return item
    }

    // MARK: shapes

    static func shape(_ s: ShapeRecord) -> RenderItem {
        let t = CGAffineTransform(translationX: s.x, y: s.y).rotated(by: s.rotation)
        let path = CGMutablePath()
        switch s.kind {
        case .rect:
            path.addRect(CGRect(x: 0, y: 0, width: s.w, height: s.h), transform: t)
        case .ellipse:
            path.addEllipse(in: CGRect(x: 0, y: 0, width: s.w, height: s.h), transform: t)
        case .line, .arrow:
            if s.points.count >= 2 {
                path.addLines(between: s.points.map(\.cgPoint), transform: t)
                if s.kind == .arrow {
                    let a = s.points[s.points.count - 2]
                    let b = s.points[s.points.count - 1]
                    let d = (b - a).unit
                    let head = max(12, s.width * 4)
                    let l = b - d.rotated(by: 0.45) * head
                    let r = b - d.rotated(by: -0.45) * head
                    path.move(to: l.cgPoint, transform: t)
                    path.addLine(to: b.cgPoint, transform: t)
                    path.addLine(to: r.cgPoint, transform: t)
                }
            }
        }
        let bounds = Box(path.boundingBoxOfPath).expanded(by: s.width)
        var item = RenderItem(id: s.id, order: s.order, bounds: bounds)
        if s.fill != .none && (s.kind == .rect || s.kind == .ellipse) {
            item.underFill = path
            item.underFillColor = fillColor(s.fill, s.color)
        }
        item.stroke = path
        item.strokeColor = cgColor(s.color)
        item.lineWidth = s.width
        return item
    }

    // MARK: placeholders until Phase 1 (images load, LaTeX typesets, graphs plot)

    static func image(_ r: ImageRecord) -> RenderItem {
        let t = CGAffineTransform(translationX: r.x, y: r.y).rotated(by: r.rotation)
        let frame = CGMutablePath()
        frame.addRect(CGRect(x: 0, y: 0, width: r.w, height: r.h), transform: t)
        var item = RenderItem(id: r.id, order: r.order, bounds: Box(frame.boundingBoxOfPath).expanded(by: 2))
        item.underFill = frame
        item.underFillColor = rgba(0.93, 0.94, 0.95, 1)
        item.stroke = frame
        item.strokeColor = cgColor(.grey)
        item.lineWidth = 1.5
        item.texts = [label("picture", at: CGPoint(x: r.x + 12, y: r.y + 28), size: 18, color: cgColor(.grey))]
        return item
    }

    static func math(_ m: MathRecord) -> RenderItem {
        let color: CGColor
        switch m.role {
        case .readback: color = rgba(0.42, 0.45, 0.50, 1)
        case .answer: color = cgColor(.tutor)
        case .note: color = cgColor(.black)
        }
        let text = label(m.latex, at: CGPoint(x: m.x, y: m.y + m.fontSize), size: m.fontSize, color: color)
        var w = m.w
        if case .line(let line, _) = text { w = max(w, CTLineGetTypographicBounds(line, nil, nil, nil)) }
        var item = RenderItem(id: m.id, order: m.order, bounds: Box(x: m.x, y: m.y, w: w, h: max(m.h, m.fontSize * 1.4)).expanded(by: 2))
        item.texts = [text]
        return item
    }

    static func graph(_ g: GraphRecord) -> RenderItem {
        let frame = CGRect(x: g.x, y: g.y, width: g.w, height: g.h)
        let path = CGMutablePath()
        path.addRoundedRect(in: frame, cornerWidth: 6, cornerHeight: 6)
        let win = g.window
        func px(_ x: Double) -> Double { g.x + (x - win.xMin) / max(1e-9, win.xMax - win.xMin) * g.w }
        func py(_ y: Double) -> Double { g.y + g.h - (y - win.yMin) / max(1e-9, win.yMax - win.yMin) * g.h }
        let axes = CGMutablePath()
        if win.xMin < 0 && win.xMax > 0 {
            axes.move(to: CGPoint(x: px(0), y: g.y))
            axes.addLine(to: CGPoint(x: px(0), y: g.y + g.h))
        }
        if win.yMin < 0 && win.yMax > 0 {
            axes.move(to: CGPoint(x: g.x, y: py(0)))
            axes.addLine(to: CGPoint(x: g.x + g.w, y: py(0)))
        }
        path.addPath(axes)
        for p in g.points {
            path.addEllipse(in: CGRect(x: px(p.x) - 3, y: py(p.y) - 3, width: 6, height: 6))
        }
        var item = RenderItem(id: g.id, order: g.order, bounds: Box(frame).expanded(by: 4))
        item.underFill = CGPath(roundedRect: frame, cornerWidth: 6, cornerHeight: 6, transform: nil)
        item.underFillColor = rgba(1, 1, 1, 1)
        item.stroke = path
        item.strokeColor = rgba(0.6, 0.63, 0.68, 1)
        item.lineWidth = 1.5
        let title = g.title.isEmpty ? g.functions.map { $0.latex.isEmpty ? $0.expr : $0.latex }.joined(separator: ", ") : g.title
        item.texts = [label(title, at: CGPoint(x: g.x + 10, y: g.y + 24), size: 18, color: cgColor(.tutor))]
        return item
    }

    static func label(_ s: String, at origin: CGPoint, size: Double, color: CGColor) -> RenderItem.Text {
        let font = CTFontCreateUIFontForLanguage(.system, size, nil) ?? CTFontCreateWithName("Helvetica" as CFString, size, nil)
        let attrs: [CFString: Any] = [kCTFontAttributeName: font, kCTForegroundColorAttributeName: color]
        let str = CFAttributedStringCreate(nil, s as CFString, attrs as CFDictionary)!
        return .line(CTLineCreateWithAttributedString(str), origin: origin)
    }
}
