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

        /// a shape's line in this size (tldraw's geo, line and arrow: STROKE_SIZES[size])
        public var shapeWidth: Double {
            switch self {
            case .regular: return 5
            case .fine: return 3.5
            }
        }
    }

    /// The tutor's hand: tldraw `s` (2 + 1) × the stroke's weight.
    public static func tutorWidth(weight: Double = 1) -> Double { 3 * weight }

    /// A highlighter stroke's width: tldraw's `FONT_SIZES[l] × 1.12` (the size the kid's pen is).
    public static let highlighterWidth = 36 * 1.12

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

    /// tldraw's `solidSettings`: the centre line of a dashed, dotted or solid (not "draw") stroke.
    public static func centerlineOptions(width sw: Double, complete: Bool = true) -> FreehandOptions {
        var o = FreehandOptions()
        o.size = sw
        o.thinning = 0
        o.streamline = 0.64 + (min(max(sw, 9), 16) - 9) / 7 * 0.10
        o.smoothing = 0.62
        o.simulatePressure = false
        o.easing = .linear
        o.last = complete
        return o
    }

    /// tldraw's `getHighlightFreehandSettings`.
    public static func highlightOptions(width sw: Double, complete: Bool = true) -> FreehandOptions {
        var o = FreehandOptions()
        o.size = 1 + sw
        o.thinning = 0
        o.streamline = 0.5
        o.smoothing = 0.5
        o.simulatePressure = false
        o.easing = .easeOutSine
        o.last = complete
        return o
    }

    /// A stroke's outline in its own space (relative to its origin, before rotation).
    public static func localOutline(points: [InkPoint], width: Double, pressure: PressureMode, complete: Bool = true) -> [Vec2] {
        let input = points.map { FreehandInput(Vec2(Double($0.x), Double($0.y)), Double($0.pressure)) }
        return Freehand.outline(input, options(width: width, pressure: pressure, complete: complete))
    }

    /// How a stroke is drawn: tldraw's `dash` (kept in `meta.dash` on a converted stroke) and the
    /// highlighter (`meta.highlight`).
    public enum Look: Equatable, Sendable {
        case freehand
        case solid
        case dashed
        case dotted
        case highlight
    }

    public static func look(of s: StrokeRecord) -> Look {
        if s.meta["highlight"]?.boolValue == true { return .highlight }
        switch s.meta["dash"]?.stringValue {
        case "dashed": return .dashed
        case "dotted": return .dotted
        case "solid": return .solid
        default: return .freehand
        }
    }
}

/// What the renderer draws for one record: paths in page space, ready for any thread.
/// (CGPath, CGColor, CGImage and CTLine are immutable and safe to share across threads.)
public struct RenderItem: @unchecked Sendable {
    public enum Text: @unchecked Sendable {
        case line(CTLine, origin: CGPoint)
    }

    /// One drawing step of an object (a picture, a graph, typeset maths).
    public enum Op: @unchecked Sendable {
        case fill(CGPath, CGColor)
        case stroke(CGPath, CGColor, width: CGFloat, dash: [CGFloat] = [], phase: CGFloat = 0, cap: CGLineCap = .round)
        case text(CTLine, origin: CGPoint)
        /// a picture filling `rect` (in the space `transform` maps to page space), right way up
        case image(CGImage, rect: CGRect, transform: CGAffineTransform)
        /// the following ops clipped to this path, until `.endClip`
        case clip(CGPath)
        case endClip
        case custom(@Sendable (CGContext) -> Void)
    }

    /// Drawn under every item of the screen, in a first pass: the strong half of a highlighter, so
    /// ink shows through it whichever came first.
    public struct Underlay: @unchecked Sendable {
        public var path: CGPath
        public var color: CGColor
        public var width: CGFloat
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
    public var ops: [Op] = []
    public var texts: [Text] = []
    public var underlay: Underlay?
    public var alpha: CGFloat = 1

    public init(id: RecordID, order: OrderKey, bounds: Box) {
        self.id = id
        self.order = order
        self.bounds = bounds
    }

    /// An item with an underlay cannot be painted over what is there: it goes under it.
    public var paintsUnder: Bool { underlay != nil }

    public func drawUnderlay(in ctx: CGContext) {
        guard let u = underlay else { return }
        ctx.saveGState()
        ctx.addPath(u.path)
        ctx.setStrokeColor(u.color)
        ctx.setLineWidth(u.width)
        ctx.setLineCap(.round)
        ctx.setLineJoin(.round)
        ctx.strokePath()
        ctx.restoreGState()
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
        var clips = 0
        for op in ops {
            switch op {
            case .fill(let p, let c):
                ctx.addPath(p)
                ctx.setFillColor(c)
                ctx.fillPath()
            case .stroke(let p, let c, let w, let dash, let phase, let cap):
                ctx.saveGState()
                ctx.addPath(p)
                ctx.setStrokeColor(c)
                ctx.setLineWidth(w)
                ctx.setLineCap(cap)
                ctx.setLineJoin(.round)
                if !dash.isEmpty { ctx.setLineDash(phase: phase, lengths: dash) }
                ctx.strokePath()
                ctx.restoreGState()
            case .text(let line, let origin):
                ctx.saveGState()
                ctx.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
                ctx.textPosition = origin
                CTLineDraw(line, ctx)
                ctx.restoreGState()
            case .image(let img, let rect, let t):
                ctx.saveGState()
                ctx.concatenate(t)
                // page space is y-down; an image draws y-up
                ctx.translateBy(x: rect.minX, y: rect.maxY)
                ctx.scaleBy(x: 1, y: -1)
                ctx.interpolationQuality = .high
                ctx.draw(img, in: CGRect(origin: .zero, size: rect.size))
                ctx.restoreGState()
            case .clip(let p):
                ctx.saveGState()
                ctx.addPath(p)
                ctx.clip()
                clips += 1
            case .endClip:
                if clips > 0 {
                    ctx.restoreGState()
                    clips -= 1
                }
            case .custom(let body):
                ctx.saveGState()
                body(ctx)
                ctx.restoreGState()
            }
        }
        while clips > 0 {
            ctx.restoreGState()
            clips -= 1
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

    public static func hex(_ v: UInt32, alpha: Double = 1) -> CGColor {
        rgba(Double((v >> 16) & 0xFF) / 255, Double((v >> 8) & 0xFF) / 255, Double(v & 0xFF) / 255, alpha)
    }

    public static func cgColor(_ c: InkColor, alpha: CGFloat = 1) -> CGColor {
        let (r, g, b) = c.rgb
        return rgba(r, g, b, alpha)
    }

    /// The Blocks colours the board's objects use (docs/DESIGN-SYSTEM.md; flat, no gradients).
    public enum Palette {
        public static let ink = hex(0x14151F)
        public static let inkSecondary = hex(0x5B5E6E)
        public static let chalk = hex(0xF1F2F6)
        public static let line = hex(0xE2E4EB)
        public static let paper = hex(0xFFFFFF)
        /// a picture's placeholder glyph on chalk
        public static let placeholder = hex(0xC6C9D3)
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

    /// The render item for a drawn record (nil for records that are not drawn). Pictures are drawn
    /// from `images` once decoded (a placeholder until then).
    public static func item(for record: BoardRecord, images: BoardImageCache = .shared) -> RenderItem? {
        switch record {
        case .stroke(let s): return stroke(s)
        case .shape(let s): return shape(s)
        case .image(let r): return image(r, images: images)
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
        let look = InkStyle.look(of: s)
        if look != .freehand, s.points.count > 1 { return centerlineStroke(s, look: look) }
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
        if look == .highlight {
            // a highlighter dot: tldraw draws it at the overlay's strength only
            item.fillColor = highlightColor(s.color, alpha: 0.35)
        }
        return item
    }

    public static func highlightColor(_ c: InkColor, alpha: CGFloat) -> CGColor {
        let (r, g, b) = c.highlightRGB
        return rgba(r, g, b, alpha)
    }

    /// tldraw's dashed, dotted and solid strokes, and its highlighter: the stroke's centre line
    /// (`getStrokePoints` with tldraw's settings), stroked at the pen's width.
    ///  - dashed: `2w 2w`; dotted: `0.1 2w` with round caps (dots); solid: no dashes.
    ///  - highlight: its marker colour twice, as tldraw does: strong (82 %) under every item of the
    ///    screen, and faint (35 %) in its own place, so ink shows through whichever came first.
    static func centerlineStroke(_ s: StrokeRecord, look: InkStyle.Look) -> RenderItem {
        let t = strokeTransform(s)
        let input = s.points.map { FreehandInput(Vec2(Double($0.x), Double($0.y)), Double($0.pressure)) }
        let opts = look == .highlight ? InkStyle.highlightOptions(width: s.width) : InkStyle.centerlineOptions(width: s.width)
        let pts = Freehand.strokePoints(input, opts).map(\.point)
        let path = centerlinePath(pts, transform: t)
        let box = path.boundingBoxOfPath
        let bounds = Box(box.isNull ? CGRect(x: s.x, y: s.y, width: 0, height: 0) : box).expanded(by: s.width / 2 + 1)
        var item = RenderItem(id: s.id, order: s.order, bounds: bounds)
        switch look {
        case .highlight:
            item.underlay = RenderItem.Underlay(path: path, color: highlightColor(s.color, alpha: 0.82), width: s.width)
            item.ops = [.stroke(path, highlightColor(s.color, alpha: 0.35), width: s.width)]
        case .dashed:
            item.ops = [.stroke(path, cgColor(s.color), width: s.width, dash: [s.width * 2, s.width * 2], cap: .butt)]
        case .dotted:
            item.ops = [.stroke(path, cgColor(s.color), width: s.width, dash: [0.1, s.width * 2], cap: .round)]
        case .solid, .freehand:
            item.ops = [.stroke(path, cgColor(s.color), width: s.width)]
        }
        if s.closed && s.fill != .none && pts.count > 2 {
            let inside = CGMutablePath()
            inside.addLines(between: pts.map(\.cgPoint), transform: t)
            inside.closeSubpath()
            item.underFill = inside
            item.underFillColor = fillColor(s.fill, s.color)
        }
        return item
    }

    /// tldraw's `getSvgPathFromStrokePoints` (open): a smooth path through the points' midpoints.
    public static func centerlinePath(_ pts: [Vec2], transform t: CGAffineTransform = .identity) -> CGPath {
        let path = CGMutablePath()
        let n = pts.count
        guard n >= 2 else {
            if let p = pts.first { path.addEllipse(in: CGRect(x: p.x - 0.5, y: p.y - 0.5, width: 1, height: 1), transform: t) }
            return path
        }
        func mid(_ a: Vec2, _ b: Vec2) -> CGPoint { CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2) }
        path.move(to: pts[0].cgPoint, transform: t)
        if n == 2 {
            path.addLine(to: pts[1].cgPoint, transform: t)
            return path
        }
        var control = pts[1].cgPoint
        var current = mid(pts[1], pts[2])
        path.addQuadCurve(to: current, control: control, transform: t)
        if n > 3 {
            for i in 2..<(n - 1) {
                // SVG's T: the control point reflected through the current point
                let next = mid(pts[i], pts[i + 1])
                control = CGPoint(x: 2 * current.x - control.x, y: 2 * current.y - control.y)
                path.addQuadCurve(to: next, control: control, transform: t)
                current = next
            }
        }
        path.addLine(to: pts[n - 1].cgPoint, transform: t)
        return path
    }

    // MARK: shapes

    static func shape(_ s: ShapeRecord) -> RenderItem {
        let t = CGAffineTransform(translationX: s.x, y: s.y).rotated(by: s.rotation)
        let path = CGMutablePath()
        let dash = s.meta["dash"]?.stringValue
        let dashStyle: PerfectDash.Style? = dash == "dashed" ? .dashed : dash == "dotted" ? .dotted : nil
        var sides: [(CGPath, PerfectDash.Pattern)] = []
        switch s.kind {
        case .rect:
            path.addRect(CGRect(x: 0, y: 0, width: s.w, height: s.h), transform: t)
            if let dashStyle {
                let c = [Vec2(0, 0), Vec2(s.w, 0), Vec2(s.w, s.h), Vec2(0, s.h)]
                for i in 0..<4 {
                    let a = c[i], b = c[(i + 1) % 4]
                    let side = CGMutablePath()
                    side.move(to: a.cgPoint, transform: t)
                    side.addLine(to: b.cgPoint, transform: t)
                    sides.append((side, PerfectDash.pattern(length: a.dist(b), width: s.width, style: dashStyle)))
                }
            }
        case .ellipse:
            path.addEllipse(in: CGRect(x: 0, y: 0, width: s.w, height: s.h), transform: t)
            if let dashStyle {
                let a = s.w / 2, b = s.h / 2
                // Ramanujan's perimeter
                let perimeter = Double.pi * (3 * (a + b) - ((3 * a + b) * (a + 3 * b)).squareRoot())
                sides.append((path, PerfectDash.pattern(length: perimeter, width: s.width, style: dashStyle, closed: true)))
            }
        case .line, .arrow:
            if s.points.count >= 2 {
                path.addLines(between: s.points.map(\.cgPoint), transform: t)
                if let dashStyle {
                    for i in 0..<(s.points.count - 1) {
                        let side = CGMutablePath()
                        side.move(to: s.points[i].cgPoint, transform: t)
                        side.addLine(to: s.points[i + 1].cgPoint, transform: t)
                        sides.append((side, PerfectDash.pattern(length: s.points[i].dist(s.points[i + 1]), width: s.width, style: dashStyle)))
                    }
                }
            }
        }
        var head: CGMutablePath?
        if s.kind == .arrow, s.points.count >= 2 {
            let a = s.points[s.points.count - 2]
            let b = s.points[s.points.count - 1]
            let d = (b - a).unit
            let size = min(max(12, s.width * 4), max(6, a.dist(b) * 0.4))
            let l = b - d.rotated(by: 0.45) * size
            let r = b - d.rotated(by: -0.45) * size
            let h = CGMutablePath()
            h.move(to: l.cgPoint, transform: t)
            h.addLine(to: b.cgPoint, transform: t)
            h.addLine(to: r.cgPoint, transform: t)
            head = h
        }
        let all = CGMutablePath()
        all.addPath(path)
        if let head { all.addPath(head) }
        let bounds = Box(all.boundingBoxOfPath).expanded(by: s.width)
        var item = RenderItem(id: s.id, order: s.order, bounds: bounds)
        if s.fill != .none && (s.kind == .rect || s.kind == .ellipse) {
            item.underFill = path
            item.underFillColor = fillColor(s.fill, s.color)
        }
        if sides.isEmpty {
            item.stroke = all
            item.strokeColor = cgColor(s.color)
            item.lineWidth = s.width
        } else {
            let color = cgColor(s.color)
            item.ops = sides.map { side, p in
                .stroke(side, color, width: s.width, dash: p.lengths, phase: p.phase, cap: dashStyle == .dotted ? .round : .butt)
            }
            if let head { item.ops.append(.stroke(head, color, width: s.width)) }
        }
        return item
    }

    // MARK: pictures

    static func image(_ r: ImageRecord, images: BoardImageCache = .shared) -> RenderItem {
        let t = CGAffineTransform(translationX: r.x, y: r.y).rotated(by: r.rotation)
        let rect = CGRect(x: 0, y: 0, width: max(1, r.w), height: max(1, r.h))
        let frame = CGMutablePath()
        frame.addRect(rect, transform: t)
        var item = RenderItem(id: r.id, order: r.order, bounds: Box(frame.boundingBoxOfPath).expanded(by: 1))
        if let img = images.image(for: r.asset.src) {
            item.ops = [.image(img, rect: rect, transform: t)]
        } else {
            item.ops = placeholder(rect: rect, transform: t, failed: images.state(for: r.asset.src) == .failed)
        }
        return item
    }

    /// A picture still on its way (or one that could not be loaded): flat chalk with a picture glyph
    /// (a sun over two hills), no words.
    static func placeholder(rect: CGRect, transform t: CGAffineTransform, failed: Bool) -> [RenderItem.Op] {
        var ops: [RenderItem.Op] = []
        let back = CGMutablePath()
        back.addRect(rect, transform: t)
        ops.append(.fill(back, Palette.chalk))
        let s = min(96, max(20, min(rect.width, rect.height) * 0.28))
        let cx = rect.midX, cy = rect.midY
        let glyph = CGMutablePath()
        // the frame of the glyph
        glyph.addRoundedRect(in: CGRect(x: cx - s / 2, y: cy - s * 0.4, width: s, height: s * 0.8), cornerWidth: s * 0.12, cornerHeight: s * 0.12, transform: t)
        let hills = CGMutablePath()
        hills.move(to: CGPoint(x: cx - s * 0.38, y: cy + s * 0.28), transform: t)
        hills.addLine(to: CGPoint(x: cx - s * 0.12, y: cy - s * 0.02), transform: t)
        hills.addLine(to: CGPoint(x: cx + s * 0.06, y: cy + s * 0.16), transform: t)
        hills.addLine(to: CGPoint(x: cx + s * 0.2, y: cy + s * 0.04), transform: t)
        hills.addLine(to: CGPoint(x: cx + s * 0.38, y: cy + s * 0.28), transform: t)
        let sun = CGMutablePath()
        sun.addEllipse(in: CGRect(x: cx + s * 0.1, y: cy - s * 0.26, width: s * 0.16, height: s * 0.16), transform: t)
        let color = failed ? Palette.inkSecondary : Palette.placeholder
        let w = max(1.5, s * 0.07)
        ops.append(.stroke(glyph, color, width: w))
        ops.append(.stroke(hills, color, width: w))
        ops.append(.fill(sun, color))
        if failed {
            let slash = CGMutablePath()
            slash.move(to: CGPoint(x: cx - s * 0.55, y: cy - s * 0.5), transform: t)
            slash.addLine(to: CGPoint(x: cx + s * 0.55, y: cy + s * 0.5), transform: t)
            ops.append(.stroke(slash, Palette.chalk, width: w * 3))
            ops.append(.stroke(slash, color, width: w))
        }
        return ops
    }

    // MARK: typeset maths

    /// How a maths record is laid out: the type size, the colour, and whether it sits in a chip.
    public struct MathLook: Sendable, Equatable {
        public var fontSize: Double
        public var color: InkColor?
        public var chip: Bool
        public var padX: Double
        public var padY: Double
    }

    /// - readback: the grey echo of what was read, small, in a chalk chip;
    /// - answer: typeset maths the tutor wrote, in the tutor's ink, as big as its hand;
    /// - note: a typed line, in ink.
    public static func mathLook(_ m: MathRecord) -> MathLook {
        switch m.role {
        case .readback: return MathLook(fontSize: m.fontSize * 0.72, color: nil, chip: true, padX: m.fontSize * 0.36, padY: m.fontSize * 0.2)
        case .answer: return MathLook(fontSize: m.fontSize, color: .tutor, chip: false, padX: m.fontSize * 0.25, padY: m.fontSize * 0.2)
        case .note: return MathLook(fontSize: m.fontSize, color: m.author == .tutor ? .tutor : .black, chip: false, padX: m.fontSize * 0.25, padY: m.fontSize * 0.2)
        }
    }

    static func math(_ m: MathRecord) -> RenderItem {
        let look = mathLook(m)
        let color = look.color.map { cgColor($0) } ?? Palette.inkSecondary
        let latex = m.latex.trimmingCharacters(in: .whitespacesAndNewlines)
        let set = latex.isEmpty ? nil : MathRendering.typeset(latex, fontSize: look.fontSize, color: color)
        let w = (set?.width ?? look.fontSize) + 2 * look.padX
        let h = (set?.height ?? look.fontSize) + 2 * look.padY
        // centred in the height the web measured, when it measured more
        let top = m.y + max(0, (m.h - h) / 2)
        let box = CGRect(x: m.x, y: top, width: w, height: h)
        var item = RenderItem(id: m.id, order: m.order, bounds: Box(box).expanded(by: 1))
        if look.chip {
            item.ops.append(.fill(CGPath(roundedRect: box, cornerWidth: min(h / 2, w / 2), cornerHeight: min(h / 2, w / 2), transform: nil), Palette.chalk))
        }
        if let set {
            let baseline = CGPoint(x: box.minX + look.padX, y: box.minY + look.padY + set.ascent)
            item.ops.append(.custom { ctx in set.draw(ctx, baseline) })
        }
        return item
    }

    // MARK: graphs

    /// The colour of a graph's `i`th function: the tutor's first curve is in the tutor's ink; a
    /// colour a converted board could not name (black) gives way to a pen colour of its own.
    public static func graphColor(_ g: GraphRecord, _ i: Int) -> InkColor {
        let f = g.functions[i]
        if g.author == .tutor && i == 0 { return .tutor }
        if f.color == .black || (g.author == .tutor && f.color == .tutor && i > 0) {
            let others: [InkColor] = [.orange, .green, .red, .pink, .violet]
            return others[(i - 1 + others.count) % others.count]
        }
        return f.color
    }

    public struct GraphLayout: Sendable, Equatable {
        public var card: CGRect
        public var radius: Double
        public var titleSize: Double
        public var plot: CGRect
    }

    public static func graphLayout(_ g: GraphRecord) -> GraphLayout {
        let card = CGRect(x: g.x, y: g.y, width: max(40, g.w), height: max(40, g.h))
        let titleSize = min(22, max(13, card.height * 0.075))
        let header = titleSize * 1.9
        let inset = min(8, card.width * 0.03)
        let plot = CGRect(x: card.minX + inset, y: card.minY + header, width: card.width - 2 * inset, height: max(10, card.height - header - inset))
        return GraphLayout(card: card, radius: min(18, min(card.width, card.height) * 0.08), titleSize: titleSize, plot: plot)
    }

    /// A graph in Blocks: a flat chalk card, the functions' LaTeX on top, a white plot with a light
    /// grid, grey axes and numbers, the curves 2.5 units thick and the points as ink dots.
    static func graph(_ g: GraphRecord) -> RenderItem {
        let L = graphLayout(g)
        var item = RenderItem(id: g.id, order: g.order, bounds: Box(L.card).expanded(by: 1))
        let titleColor = g.author == .tutor ? cgColor(.tutor) : Palette.ink
        item.ops.append(.fill(CGPath(roundedRect: L.card, cornerWidth: L.radius, cornerHeight: L.radius, transform: nil), Palette.chalk))
        let inner = min(L.radius * 0.6, 12)
        let plotPath = CGPath(roundedRect: L.plot, cornerWidth: inner, cornerHeight: inner, transform: nil)
        item.ops.append(.fill(plotPath, Palette.paper))

        // the title: the record's, else its functions' LaTeX
        let title = g.title.isEmpty ? g.functions.map { $0.latex.isEmpty ? $0.expr : $0.latex }.joined(separator: ",\\; ") : g.title
        if !title.isEmpty {
            let set = MathRendering.typeset(title, fontSize: L.titleSize, color: titleColor)
            let room = L.card.width - 2 * (L.plot.minX - L.card.minX) - 8
            let baseline = CGPoint(x: L.plot.minX + 6, y: L.card.minY + (L.plot.minY - L.card.minY) / 2 + (set.ascent - set.descent) / 2)
            if set.width <= room {
                item.ops.append(.custom { ctx in set.draw(ctx, baseline) })
            } else {
                let clip = CGPath(rect: CGRect(x: L.card.minX, y: L.card.minY, width: L.card.width - 6, height: L.plot.minY - L.card.minY), transform: nil)
                item.ops.append(.clip(clip))
                item.ops.append(.custom { ctx in set.draw(ctx, baseline) })
                item.ops.append(.endClip)
            }
        }

        let tick = max(9, min(13, L.plot.height * 0.05))
        let fns = g.functions.prefix(6).enumerated().map { i, f in
            GraphPlot.Function(id: f.id, color: graphColor(g, i), sampler: MathExpr.compile(f.expr))
        }
        let plot = GraphPlot.build(Array(fns), points: g.points, window: g.window, grid: g.grid, w: L.plot.width, h: L.plot.height, tickSize: tick)
        let o = L.plot.origin
        func at(_ p: CGPoint) -> CGPoint { CGPoint(x: o.x + p.x, y: o.y + p.y) }

        item.ops.append(.clip(plotPath))
        if !plot.gridLines.isEmpty {
            let grid = CGMutablePath()
            for (a, b) in plot.gridLines {
                grid.move(to: at(a))
                grid.addLine(to: at(b))
            }
            item.ops.append(.stroke(grid, Palette.line, width: 1, cap: .butt))
        }
        let axes = CGMutablePath()
        if let x0 = plot.axisX {
            axes.move(to: CGPoint(x: o.x + x0, y: L.plot.minY))
            axes.addLine(to: CGPoint(x: o.x + x0, y: L.plot.maxY))
        }
        if let y0 = plot.axisY {
            axes.move(to: CGPoint(x: L.plot.minX, y: o.y + y0))
            axes.addLine(to: CGPoint(x: L.plot.maxX, y: o.y + y0))
        }
        if !axes.isEmpty { item.ops.append(.stroke(axes, Palette.inkSecondary, width: 1.5, cap: .butt)) }
        for label in plot.labels {
            let line = RenderFonts.line(label.text, size: tick, weight: .medium, color: Palette.inkSecondary)
            let width = CTLineGetTypographicBounds(line, nil, nil, nil)
            let x = label.axis == .x ? label.at.x - width / 2 : label.at.x
            item.ops.append(.text(line, origin: at(CGPoint(x: x, y: label.at.y))))
        }
        let curveWidth = max(2, min(3.5, L.plot.width / 140))
        for c in plot.curves {
            let path = CGMutablePath()
            for run in c.runs where !run.isEmpty {
                path.addLines(between: run.map(at))
            }
            item.ops.append(.stroke(path, cgColor(c.color), width: curveWidth))
        }
        item.ops.append(.endClip)
        for p in plot.points {
            let c = at(p.at)
            let r = max(4, curveWidth * 1.7)
            item.ops.append(.fill(CGPath(ellipseIn: CGRect(x: c.x - r - 2, y: c.y - r - 2, width: 2 * r + 4, height: 2 * r + 4), transform: nil), Palette.paper))
            item.ops.append(.fill(CGPath(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r), transform: nil), Palette.ink))
            if !p.label.isEmpty {
                let line = RenderFonts.line(p.label, size: tick * 1.15, weight: .semibold, color: Palette.ink)
                item.ops.append(.text(line, origin: CGPoint(x: c.x + r + 4, y: c.y - r - 3)))
            }
        }
        return item
    }

    static func label(_ s: String, at origin: CGPoint, size: Double, color: CGColor) -> RenderItem.Text {
        .line(RenderFonts.line(s, size: size, color: color), origin: origin)
    }
}

/// tldraw's `getPerfectDashProps`: a dash pattern that fits a side exactly, with whole dashes at both
/// ends (a dashed rectangle's corners are dashes, never gaps).
public enum PerfectDash {
    public enum Style: Sendable { case dashed, dotted }

    public struct Pattern: Equatable, Sendable {
        public var lengths: [CGFloat]
        public var phase: CGFloat
    }

    public static func pattern(length total0: Double, width sw: Double, style: Style, closed: Bool = false, lengthRatio: Double = 2) -> Pattern {
        var total = total0
        var dash: Double
        let ratio: Double
        var offset = 0.0
        switch style {
        case .dashed:
            ratio = 1
            dash = min(sw * lengthRatio, total / 4)
        case .dotted:
            ratio = 100
            dash = sw / ratio
        }
        if !closed {
            // start and end "outset": half a dash beyond each end
            total += dash / 2
            offset += dash / 2
            total += dash / 2
        }
        var count = Int(floor(total / dash / (2 * ratio)))
        var gap: Double
        if count < 3 && style == .dashed {
            if total / sw < 4 {
                dash = total
                count = 1
                gap = 0
            } else {
                dash = total / 3
                gap = total / 3
            }
        } else {
            count = max(1, count)
            dash = total / Double(count) / (2 * ratio)
            if closed {
                offset = dash / 2
                gap = (total - Double(count) * dash) / Double(count)
            } else {
                gap = (total - Double(count) * dash) / Double(max(1, count - 1))
            }
        }
        if gap <= 0 { return Pattern(lengths: [], phase: 0) }
        return Pattern(lengths: [CGFloat(dash), CGFloat(gap)], phase: CGFloat(offset))
    }
}
