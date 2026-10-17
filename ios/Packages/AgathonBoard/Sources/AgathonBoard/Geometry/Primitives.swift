import CoreGraphics
import Foundation

/// A point or vector in page units (double precision). JSON: `{"x":…,"y":…}`.
public struct Vec2: Hashable, Sendable, Codable {
    public var x: Double
    public var y: Double

    public init(_ x: Double, _ y: Double) {
        self.x = x
        self.y = y
    }

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }

    public static let zero = Vec2(0, 0)

    @inline(__always) public static func + (a: Vec2, b: Vec2) -> Vec2 { Vec2(a.x + b.x, a.y + b.y) }
    @inline(__always) public static func - (a: Vec2, b: Vec2) -> Vec2 { Vec2(a.x - b.x, a.y - b.y) }
    @inline(__always) public static func * (a: Vec2, s: Double) -> Vec2 { Vec2(a.x * s, a.y * s) }
    @inline(__always) public static func / (a: Vec2, s: Double) -> Vec2 { Vec2(a.x / s, a.y / s) }
    @inline(__always) public static prefix func - (a: Vec2) -> Vec2 { Vec2(-a.x, -a.y) }

    @inline(__always) public var length: Double { (x * x + y * y).squareRoot() }
    @inline(__always) public var length2: Double { x * x + y * y }
    /// Perpendicular (perfect-freehand's `per`: [y, -x]).
    @inline(__always) public var per: Vec2 { Vec2(y, -x) }
    @inline(__always) public var unit: Vec2 {
        let l = length
        return l == 0 ? Vec2(0, 0) : Vec2(x / l, y / l)
    }

    @inline(__always) public func dot(_ b: Vec2) -> Double { x * b.x + y * b.y }
    @inline(__always) public func dist(_ b: Vec2) -> Double { (self - b).length }
    @inline(__always) public func dist2(_ b: Vec2) -> Double { (self - b).length2 }
    @inline(__always) public func lerp(_ b: Vec2, _ t: Double) -> Vec2 { Vec2(x + (b.x - x) * t, y + (b.y - y) * t) }

    /// Rotated by `r` radians around `c`.
    @inline(__always) public func rotated(around c: Vec2, by r: Double) -> Vec2 {
        let s = sin(r)
        let k = cos(r)
        let px = x - c.x
        let py = y - c.y
        return Vec2(px * k - py * s + c.x, px * s + py * k + c.y)
    }

    @inline(__always) public func rotated(by r: Double) -> Vec2 {
        if r == 0 { return self }
        let s = sin(r)
        let k = cos(r)
        return Vec2(x * k - y * s, x * s + y * k)
    }

    public var cgPoint: CGPoint { CGPoint(x: x, y: y) }
}

/// An axis-aligned rectangle in page units. JSON: `{"x":…,"y":…,"w":…,"h":…}`.
public struct Box: Hashable, Sendable, Codable {
    public var x: Double
    public var y: Double
    public var w: Double
    public var h: Double

    public init(x: Double, y: Double, w: Double, h: Double) {
        self.x = x
        self.y = y
        self.w = w
        self.h = h
    }

    public init(_ r: CGRect) {
        self.init(x: r.origin.x, y: r.origin.y, w: r.size.width, h: r.size.height)
    }

    /// The default 16:9 screen (the web's `SCREEN`, 1600 × 900).
    public static let screen = Box(x: 0, y: 0, w: 1600, h: 900)

    public var minX: Double { x }
    public var minY: Double { y }
    public var maxX: Double { x + w }
    public var maxY: Double { y + h }
    public var center: Vec2 { Vec2(x + w / 2, y + h / 2) }
    public var cgRect: CGRect { CGRect(x: x, y: y, width: w, height: h) }
    public var isEmpty: Bool { !(w > 0 && h > 0) }

    public func union(_ b: Box) -> Box {
        let x0 = min(minX, b.minX)
        let y0 = min(minY, b.minY)
        return Box(x: x0, y: y0, w: max(maxX, b.maxX) - x0, h: max(maxY, b.maxY) - y0)
    }

    public func intersects(_ b: Box) -> Bool {
        minX <= b.maxX && b.minX <= maxX && minY <= b.maxY && b.minY <= maxY
    }

    public func contains(_ p: Vec2) -> Bool {
        p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY
    }

    public func insetBy(_ d: Double) -> Box {
        Box(x: x + d, y: y + d, w: w - 2 * d, h: h - 2 * d)
    }

    public func expanded(by d: Double) -> Box { insetBy(-d) }

    /// The bounds of some points (nil for none).
    public static func around<S: Sequence>(_ points: S) -> Box? where S.Element == Vec2 {
        var it = points.makeIterator()
        guard let first = it.next() else { return nil }
        var x0 = first.x, y0 = first.y, x1 = first.x, y1 = first.y
        while let p = it.next() {
            if p.x < x0 { x0 = p.x }
            if p.y < y0 { y0 = p.y }
            if p.x > x1 { x1 = p.x }
            if p.y > y1 { y1 = p.y }
        }
        return Box(x: x0, y: y0, w: x1 - x0, h: y1 - y0)
    }
}
