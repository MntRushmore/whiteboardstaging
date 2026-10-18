import Foundation

/// The outlines of tldraw's `geo` kinds (tldraw 4.2's getGeoShapePath), for a converted board: a
/// rectangle and an ellipse are `rect` and `ellipse` shapes; every other kind with straight sides
/// (or a heart's curve, sampled) is a closed `line` shape drawn through these points, with the box
/// in `w`, `h` and the kind in `meta.geo`. A cloud is drawn as an ellipse; an x-box and a check-box
/// as their box.
enum GeoOutline {
    /// Drawn as an ellipse.
    static func isRound(_ geo: String) -> Bool {
        geo == "ellipse" || geo == "oval" || geo == "cloud"
    }

    /// The closed outline in the shape's box (`w` × `h`, from 0, 0), the first point repeated last;
    /// nil for the kinds drawn as a box or an ellipse.
    static func polygon(_ geo: String, w rawW: Double, h rawH: Double) -> [Vec2]? {
        let w = max(1, rawW)
        let h = max(1, rawH)
        let cx = w / 2
        let cy = h / 2
        var pts: [Vec2]
        switch geo {
        case "triangle":
            pts = [Vec2(cx, 0), Vec2(w, h), Vec2(0, h)]
        case "diamond":
            pts = [Vec2(cx, 0), Vec2(w, cy), Vec2(cx, h), Vec2(0, cy)]
        case "pentagon":
            pts = polygonVertices(w, h, 5)
        case "hexagon":
            pts = polygonVertices(w, h, 6)
        case "octagon":
            pts = polygonVertices(w, h, 8)
        case "star":
            pts = star(w, h)
        case "rhombus":
            let o = min(w * 0.38, h * 0.38)
            pts = [Vec2(o, 0), Vec2(w, 0), Vec2(w - o, h), Vec2(0, h)]
        case "rhombus-2":
            let o = min(w * 0.38, h * 0.38)
            pts = [Vec2(0, 0), Vec2(w - o, 0), Vec2(w, h), Vec2(o, h)]
        case "trapezoid":
            let o = min(w * 0.38, h * 0.38)
            pts = [Vec2(o, 0), Vec2(w - o, 0), Vec2(w, h), Vec2(0, h)]
        case "arrow-right":
            let ox = min(w, h) * 0.38, oy = h * 0.16
            pts = [Vec2(0, oy), Vec2(w - ox, oy), Vec2(w - ox, 0), Vec2(w, h / 2), Vec2(w - ox, h), Vec2(w - ox, h - oy), Vec2(0, h - oy)]
        case "arrow-left":
            let ox = min(w, h) * 0.38, oy = h * 0.16
            pts = [Vec2(ox, 0), Vec2(ox, oy), Vec2(w, oy), Vec2(w, h - oy), Vec2(ox, h - oy), Vec2(ox, h), Vec2(0, h / 2)]
        case "arrow-up":
            let ox = w * 0.16, oy = min(w, h) * 0.38
            pts = [Vec2(w / 2, 0), Vec2(w, oy), Vec2(w - ox, oy), Vec2(w - ox, h), Vec2(ox, h), Vec2(ox, oy), Vec2(0, oy)]
        case "arrow-down":
            let ox = w * 0.16, oy = min(w, h) * 0.38
            pts = [Vec2(ox, 0), Vec2(w - ox, 0), Vec2(w - ox, h - oy), Vec2(w, h - oy), Vec2(w / 2, h), Vec2(0, h - oy), Vec2(ox, h - oy)]
        case "heart":
            pts = heart(w, h)
        default:
            return nil
        }
        pts.append(pts[0])
        return pts
    }

    /// tldraw's getPolygonVertices: a regular polygon from the top, stretched to the box.
    static func polygonVertices(_ width: Double, _ height: Double, _ sides: Int) -> [Vec2] {
        let cx = width / 2, cy = height / 2
        var pts: [Vec2] = []
        var minX = Double.infinity, maxX = -Double.infinity, minY = Double.infinity, maxY = -Double.infinity
        for i in 0..<sides {
            let t = -Double.pi / 2 + Double(i) * 2 * Double.pi / Double(sides)
            let p = Vec2(cx + cx * cos(t), cy + cy * sin(t))
            minX = min(minX, p.x); maxX = max(maxX, p.x); minY = min(minY, p.y); maxY = max(maxY, p.y)
            pts.append(p)
        }
        let w = maxX - minX, h = maxY - minY
        if w > 0, h > 0, w != width || h != height {
            pts = pts.map { Vec2((($0.x - minX) / w) * width, (($0.y - minY) / h) * height) }
        }
        return pts
    }

    /// tldraw's getStarPath (5 points, inner radius half the outer).
    static func star(_ w: Double, _ h: Double) -> [Vec2] {
        let sides = 5
        let step = 2 * Double.pi / Double(sides) / 2
        let right = (sides / 4) * 2
        let left = sides * 2 - right
        let bottom = (sides / 2) * 2
        let maxX = cos(-Double.pi / 2 + Double(right) * step) * w / 2
        let minX = cos(-Double.pi / 2 + Double(left) * step) * w / 2
        let minY = sin(-Double.pi / 2) * h / 2
        let maxY = sin(-Double.pi / 2 + Double(bottom) * step) * h / 2
        let diffX = w - abs(maxX - minX)
        let diffY = h - abs(maxY - minY)
        let offsetX = w / 2 + minX - (w / 2 - maxX)
        let offsetY = h / 2 + minY - (h / 2 - maxY)
        let cx = (w - offsetX) / 2
        let cy = (h - offsetY) / 2
        let ox = (w + diffX) / 2
        let oy = (h + diffY) / 2
        let ix = ox / 2
        let iy = oy / 2
        return (0..<(sides * 2)).map { i in
            let theta = -Double.pi / 2 + Double(i) * step
            return Vec2(cx + (i % 2 == 1 ? ix : ox) * cos(theta), cy + (i % 2 == 1 ? iy : oy) * sin(theta))
        }
    }

    /// tldraw's heart: four cubic curves, sampled.
    static func heart(_ w: Double, _ h: Double) -> [Vec2] {
        let cx = w / 2
        let o = w / 4
        let k = h / 4
        // (control 1, control 2, end) of each curve, from the bottom point
        let curves: [(Vec2, Vec2, Vec2)] = [
            (Vec2(o * 1.5, k * 3), Vec2(0, k * 2.5), Vec2(0, k * 1.2)),
            (Vec2(0, -k * 0.32), Vec2(o * 1.85, -k * 0.32), Vec2(cx, k * 0.9)),
            (Vec2(o * 2.15, -k * 0.32), Vec2(w, -k * 0.32), Vec2(w, k * 1.2)),
            (Vec2(w, k * 2.5), Vec2(o * 2.5, k * 3), Vec2(cx, h)),
        ]
        var pts = [Vec2(cx, h)]
        var p0 = Vec2(cx, h)
        for (c1, c2, p3) in curves {
            for i in 1...8 {
                let t = Double(i) / 8
                let u = 1 - t
                pts.append(p0 * (u * u * u) + c1 * (3 * u * u * t) + c2 * (3 * u * t * t) + p3 * (t * t * t))
            }
            p0 = p3
        }
        pts.removeLast() // the bottom point again: `polygon` closes the outline
        return pts
    }
}
