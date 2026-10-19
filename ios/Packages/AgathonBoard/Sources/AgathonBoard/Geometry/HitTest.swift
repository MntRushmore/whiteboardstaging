import Foundation

/// A uniform grid over page space: which records' bounds touch which cell. Answers "what is near
/// here" for the eraser and "what is in this tile" for the renderer without scanning every stroke.
public struct SpatialGrid: Sendable {
    public let cell: Double
    private var cells: [Int64: [RecordID]] = [:]
    private var boxes: [RecordID: Box] = [:]

    public init(cell: Double = 128) {
        self.cell = cell
    }

    public var count: Int { boxes.count }

    @inline(__always) private func key(_ cx: Int, _ cy: Int) -> Int64 {
        (Int64(cx) << 32) ^ Int64(UInt32(bitPattern: Int32(truncatingIfNeeded: cy)))
    }

    private func range(_ b: Box) -> (ClosedRange<Int>, ClosedRange<Int>) {
        let x0 = Int((b.minX / cell).rounded(.down))
        let y0 = Int((b.minY / cell).rounded(.down))
        let x1 = max(x0, Int((b.maxX / cell).rounded(.down)))
        let y1 = max(y0, Int((b.maxY / cell).rounded(.down)))
        return (x0...x1, y0...y1)
    }

    public mutating func insert(_ id: RecordID, _ b: Box) {
        if boxes[id] != nil { remove(id) }
        guard b.minX.isFinite, b.maxX.isFinite, b.minY.isFinite, b.maxY.isFinite else { return }
        boxes[id] = b
        let (xs, ys) = range(b)
        for cx in xs { for cy in ys { cells[key(cx, cy), default: []].append(id) } }
    }

    public mutating func remove(_ id: RecordID) {
        guard let b = boxes.removeValue(forKey: id) else { return }
        let (xs, ys) = range(b)
        for cx in xs {
            for cy in ys {
                let k = key(cx, cy)
                if var list = cells[k], let i = list.firstIndex(of: id) {
                    list.remove(at: i)
                    cells[k] = list.isEmpty ? nil : list
                }
            }
        }
    }

    public func box(_ id: RecordID) -> Box? { boxes[id] }

    /// The ids whose bounds intersect `b`.
    public func query(_ b: Box) -> Set<RecordID> {
        var out = Set<RecordID>()
        let (xs, ys) = range(b)
        for cx in xs {
            for cy in ys {
                guard let list = cells[key(cx, cy)] else { continue }
                for id in list where !out.contains(id) {
                    if let bb = boxes[id], bb.intersects(b) { out.insert(id) }
                }
            }
        }
        return out
    }
}

public enum HitTest {
    /// Squared distance from `p` to the segment a–b.
    @inline(__always) public static func distance2(_ p: Vec2, _ a: Vec2, _ b: Vec2) -> Double {
        let ab = b - a
        let l2 = ab.length2
        if l2 == 0 { return p.dist2(a) }
        let t = max(0, min(1, (p - a).dot(ab) / l2))
        return p.dist2(a + ab * t)
    }

    /// Squared distance between segments a1–a2 and b1–b2 (0 when they cross).
    public static func segmentDistance2(_ a1: Vec2, _ a2: Vec2, _ b1: Vec2, _ b2: Vec2) -> Double {
        if segmentsIntersect(a1, a2, b1, b2) { return 0 }
        return min(distance2(a1, b1, b2), distance2(a2, b1, b2), distance2(b1, a1, a2), distance2(b2, a1, a2))
    }

    @inline(__always) static func cross(_ o: Vec2, _ a: Vec2, _ b: Vec2) -> Double {
        (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
    }

    static func segmentsIntersect(_ p1: Vec2, _ p2: Vec2, _ q1: Vec2, _ q2: Vec2) -> Bool {
        let d1 = cross(q1, q2, p1)
        let d2 = cross(q1, q2, p2)
        let d3 = cross(p1, p2, q1)
        let d4 = cross(p1, p2, q2)
        return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
    }

    /// Whether the eraser's path a → b (page space) passes within `margin` of the stroke's ink.
    /// The ink is the stroke's centre line widened by half its pen width (like the web, which erases
    /// a whole stroke when the eraser comes within its hit margin of the stroke's geometry).
    public static func eraserHits(_ s: StrokeRecord, from a: Vec2, to b: Vec2, margin: Double) -> Bool {
        // into the stroke's space
        let o = Vec2(s.x, s.y)
        let la = (a - o).rotated(by: -s.rotation)
        let lb = (b - o).rotated(by: -s.rotation)
        let reach = margin + s.width / 2
        let reach2 = reach * reach
        let pts = s.points
        if pts.isEmpty { return false }
        if pts.count == 1 {
            let p = Vec2(Double(pts[0].x), Double(pts[0].y))
            return distance2(p, la, lb) <= reach2
        }
        var prev = Vec2(Double(pts[0].x), Double(pts[0].y))
        for i in 1..<pts.count {
            let p = Vec2(Double(pts[i].x), Double(pts[i].y))
            if segmentDistance2(prev, p, la, lb) <= reach2 { return true }
            prev = p
        }
        return false
    }

    /// The same test for a drawn shape, image, maths or graph: within `margin` of its bounds.
    public static func boundsHit(_ bounds: Box, from a: Vec2, to b: Vec2, margin: Double) -> Bool {
        let box = bounds.expanded(by: margin)
        if box.contains(a) || box.contains(b) { return true }
        let c = [Vec2(box.minX, box.minY), Vec2(box.maxX, box.minY), Vec2(box.maxX, box.maxY), Vec2(box.minX, box.maxY)]
        for i in 0..<4 where segmentsIntersect(a, b, c[i], c[(i + 1) % 4]) { return true }
        return false
    }
}
