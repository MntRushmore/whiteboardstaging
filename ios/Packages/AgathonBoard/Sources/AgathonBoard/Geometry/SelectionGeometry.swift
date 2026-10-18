import Foundation

/// Select's geometry: what a tap or a lasso picks, and records moved, resized and copied.
public enum SelectionGeometry {
    // MARK: - Picking

    /// Whether a tap at `p` (page space) lands on `r`, within `margin` page units of its ink.
    public static func hits(_ r: BoardRecord, at p: Vec2, margin: Double, bounds: Box?) -> Bool {
        switch r {
        case .stroke(let s):
            let reach = s.width / 2 + margin
            let local = (p - Vec2(s.x, s.y)).rotated(by: -s.rotation)
            let pts = s.points
            guard let first = pts.first else { return false }
            if pts.count == 1 { return local.dist(Vec2(Double(first.x), Double(first.y))) <= reach }
            let r2 = reach * reach
            var prev = Vec2(Double(first.x), Double(first.y))
            for q in pts.dropFirst() {
                let cur = Vec2(Double(q.x), Double(q.y))
                if HitTest.distance2(local, prev, cur) <= r2 { return true }
                prev = cur
            }
            return false
        case .shape(let s):
            let local = (p - Vec2(s.x, s.y)).rotated(by: -s.rotation)
            let reach = s.width / 2 + margin
            switch s.kind {
            case .rect:
                let box = Box(x: 0, y: 0, w: s.w, h: s.h)
                if s.fill != .none, box.contains(local) { return true }
                let c = [Vec2(0, 0), Vec2(s.w, 0), Vec2(s.w, s.h), Vec2(0, s.h)]
                return (0..<4).contains { HitTest.distance2(local, c[$0], c[($0 + 1) % 4]) <= reach * reach }
            case .ellipse:
                let rx = max(0.5, s.w / 2), ry = max(0.5, s.h / 2)
                let q = local - Vec2(rx, ry)
                let k = (q.x * q.x) / (rx * rx) + (q.y * q.y) / (ry * ry)
                if s.fill != .none, k <= 1 { return true }
                // the distance to the outline, near enough: how far the point is from the curve
                // along the ray from the centre
                let d = q.length
                guard d > 0 else { return reach >= min(rx, ry) }
                let onCurve = d / k.squareRoot()
                return abs(d - onCurve) <= reach
            case .line, .arrow:
                let pts = s.points
                guard pts.count >= 2 else { return false }
                return (1..<pts.count).contains { HitTest.distance2(local, pts[$0 - 1], pts[$0]) <= reach * reach }
            }
        case .image(let img):
            let local = (p - Vec2(img.x, img.y)).rotated(by: -img.rotation)
            return Box(x: 0, y: 0, w: img.w, h: img.h).expanded(by: margin * 0.5).contains(local)
        case .math, .graph:
            return (bounds ?? .screen).expanded(by: margin * 0.5).contains(p)
        default:
            return false
        }
    }

    /// Whether a lasso goes round `r`: at least three quarters of its ink (sampled) is inside the
    /// loop, so a loop drawn a little loosely still takes a whole number.
    public static func inside(_ r: BoardRecord, loop: [Vec2], bounds: Box?) -> Bool {
        let samples = samplePoints(r, bounds: bounds)
        guard !samples.isEmpty else { return false }
        let n = samples.filter { pointInPolygon($0, loop) }.count
        return Double(n) >= Double(samples.count) * 0.75
    }

    /// Points along the record's ink (page space).
    public static func samplePoints(_ r: BoardRecord, bounds: Box?) -> [Vec2] {
        switch r {
        case .stroke(let s):
            let step = max(1, s.points.count / 48)
            var out: [Vec2] = []
            var i = 0
            while i < s.points.count {
                out.append(s.pagePoint(s.points[i]))
                i += step
            }
            if let last = s.points.last { out.append(s.pagePoint(last)) }
            return out
        case .shape(let s):
            let o = Vec2(s.x, s.y)
            switch s.kind {
            case .rect:
                let c = [Vec2(0, 0), Vec2(s.w / 2, 0), Vec2(s.w, 0), Vec2(s.w, s.h / 2), Vec2(s.w, s.h), Vec2(s.w / 2, s.h), Vec2(0, s.h), Vec2(0, s.h / 2)]
                return c.map { o + $0.rotated(by: s.rotation) }
            case .ellipse:
                return (0..<16).map { i in
                    let t = Double(i) / 16 * 2 * .pi
                    return o + Vec2(s.w / 2 + cos(t) * s.w / 2, s.h / 2 + sin(t) * s.h / 2).rotated(by: s.rotation)
                }
            case .line, .arrow:
                var out: [Vec2] = []
                for i in 0..<s.points.count {
                    out.append(o + s.points[i].rotated(by: s.rotation))
                    if i + 1 < s.points.count { out.append(o + s.points[i].lerp(s.points[i + 1], 0.5).rotated(by: s.rotation)) }
                }
                return out
            }
        case .image(let img):
            let o = Vec2(img.x, img.y)
            return grid(Box(x: 0, y: 0, w: img.w, h: img.h)).map { o + $0.rotated(by: img.rotation) }
        case .math, .graph:
            return bounds.map(grid) ?? []
        default:
            return []
        }
    }

    static func grid(_ b: Box) -> [Vec2] {
        var out: [Vec2] = []
        for fy in [0.15, 0.5, 0.85] { for fx in [0.15, 0.5, 0.85] { out.append(Vec2(b.x + b.w * fx, b.y + b.h * fy)) } }
        return out
    }

    /// Even–odd point in polygon.
    public static func pointInPolygon(_ p: Vec2, _ poly: [Vec2]) -> Bool {
        var inside = false
        var j = poly.count - 1
        for i in 0..<poly.count {
            let a = poly[i], b = poly[j]
            if (a.y > p.y) != (b.y > p.y) {
                let x = (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x
                if p.x < x { inside.toggle() }
            }
            j = i
        }
        return inside
    }

    // MARK: - Moving, resizing, copying

    public static func translated(_ r: BoardRecord, by d: Vec2) -> BoardRecord {
        switch r {
        case .stroke(var s): s.x += d.x; s.y += d.y; return .stroke(s)
        case .shape(var s): s.x += d.x; s.y += d.y; return .shape(s)
        case .image(var s): s.x += d.x; s.y += d.y; return .image(s)
        case .math(var s): s.x += d.x; s.y += d.y; return .math(s)
        case .graph(var s): s.x += d.x; s.y += d.y; return .graph(s)
        default: return r
        }
    }

    /// The least size a graph shrinks to (the web's GRAPH_MIN_W/H).
    public static let graphMin = (w: 160.0, h: 120.0)

    /// `r` scaled by `s` about `a` (page space). Ink keeps its pen width (as tldraw's resize does);
    /// typeset maths grows its type.
    public static func scaled(_ r: BoardRecord, by s: Double, about a: Vec2) -> BoardRecord {
        func move(_ x: Double, _ y: Double) -> Vec2 { a + (Vec2(x, y) - a) * s }
        switch r {
        case .stroke(var st):
            let o = move(st.x, st.y)
            st.x = o.x
            st.y = o.y
            let k = Float(s)
            st.points = st.points.map { var q = $0; q.x *= k; q.y *= k; return q }
            return .stroke(st)
        case .shape(var sh):
            let o = move(sh.x, sh.y)
            sh.x = o.x
            sh.y = o.y
            sh.w *= s
            sh.h *= s
            sh.points = sh.points.map { $0 * s }
            return .shape(sh)
        case .image(var im):
            let o = move(im.x, im.y)
            im.x = o.x
            im.y = o.y
            im.w *= s
            im.h *= s
            return .image(im)
        case .math(var m):
            let o = move(m.x, m.y)
            m.x = o.x
            m.y = o.y
            m.w *= s
            m.h *= s
            m.fontSize = max(8, m.fontSize * s)
            return .math(m)
        case .graph(var g):
            let o = move(g.x, g.y)
            g.x = o.x
            g.y = o.y
            g.w = max(graphMin.w, g.w * s)
            g.h = max(graphMin.h, g.h * s)
            return .graph(g)
        default:
            return r
        }
    }

    /// The tutor's bookkeeping a copy must not carry (the Live loop would take it for the tutor's
    /// own writing, its marks or the line it read).
    static let tutorKeys = ["live", "source", "lineId", "createdAt", "handBlock", "handLine", "mark", "markWhy", "locked", "protected", "t", "t1"]

    /// A copy of `r` for the kid, `offset` away, at `order`: a new id, the kid's (the tutor's ink
    /// copied is the kid's ink, never in the tutor's colour), with the tutor's bookkeeping dropped.
    public static func copy(_ r: BoardRecord, order: OrderKey, offset: Vec2, now: Double = (Date().timeIntervalSince1970 * 1000).rounded()) -> BoardRecord? {
        func clean(_ m: Meta) -> Meta {
            var m = m
            for k in tutorKeys { m[k] = nil }
            return m
        }
        func kid(_ c: InkColor) -> InkColor { c == .tutor ? .blue : c }
        switch translated(r, by: offset) {
        case .stroke(var s):
            s.id = .make(.stroke)
            s.order = order
            s.author = .kid
            s.color = kid(s.color)
            s.start = now
            s.meta = clean(s.meta)
            return .stroke(s)
        case .shape(var s):
            s.id = .make(.shape)
            s.order = order
            s.author = .kid
            s.color = kid(s.color)
            s.meta = clean(s.meta)
            return .shape(s)
        case .image(var s):
            s.id = .make(.image)
            s.order = order
            s.author = .kid
            s.meta = clean(s.meta)
            return .image(s)
        case .math(var s):
            s.id = .make(.math)
            s.order = order
            s.author = .kid
            s.role = .note
            s.line = nil
            s.meta = clean(s.meta)
            return .math(s)
        case .graph(var s):
            s.id = .make(.graph)
            s.order = order
            s.author = .kid
            s.line = nil
            s.functions = s.functions.map { var f = $0; f.color = kid(f.color); return f }
            s.meta = clean(s.meta)
            return .graph(s)
        default:
            return nil
        }
    }
}
