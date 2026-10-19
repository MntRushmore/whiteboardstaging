import CoreGraphics
import Foundation

/// Where the page is in the view: `view = page × scale + offset` (points).
public struct Camera: Equatable, Sendable {
    /// view points per page unit
    public var scale: Double
    /// the view position of page (0, 0)
    public var offset: Vec2

    public init(scale: Double = 1, offset: Vec2 = .zero) {
        self.scale = scale
        self.offset = offset
    }

    public func toView(_ p: Vec2) -> CGPoint { CGPoint(x: p.x * scale + offset.x, y: p.y * scale + offset.y) }
    public func toPage(_ p: CGPoint) -> Vec2 { Vec2((p.x - offset.x) / scale, (p.y - offset.y) / scale) }
    public var transform: CGAffineTransform { CGAffineTransform(a: scale, b: 0, c: 0, d: scale, tx: offset.x, ty: offset.y) }

    /// The page rect the view shows.
    public func visibleRect(viewSize: CGSize) -> Box {
        let a = toPage(.zero)
        return Box(x: a.x, y: a.y, w: viewSize.width / scale, h: viewSize.height / scale)
    }
}

/// How the camera is held on a screen: fitted inside the view's insets, zoomed between 1× and
/// `maxZoom`× that fit, never panned off the screen (the web's `contain` camera, zoom steps 1…4).
public struct CameraConstraints: Equatable, Sendable {
    public var top: Double
    public var left: Double
    public var bottom: Double
    public var right: Double
    public var maxZoom: Double

    public init(top: Double = 16, left: Double = 16, bottom: Double = 16, right: Double = 16, maxZoom: Double = 4) {
        self.top = top
        self.left = left
        self.bottom = bottom
        self.right = right
        self.maxZoom = maxZoom
    }

    func available(_ size: CGSize) -> Box {
        Box(x: left, y: top, w: max(1, size.width - left - right), h: max(1, size.height - top - bottom))
    }

    /// The camera that shows the whole screen, centred.
    public func fit(_ screen: Box, in size: CGSize) -> Camera {
        let a = available(size)
        let s = min(a.w / screen.w, a.h / screen.h)
        let ox = a.x + (a.w - screen.w * s) / 2 - screen.x * s
        let oy = a.y + (a.h - screen.h * s) / 2 - screen.y * s
        return Camera(scale: s, offset: Vec2(ox, oy))
    }

    /// `camera` held to the rules: zoom within range, the screen covering the view where it can.
    public func clamp(_ camera: Camera, screen: Box, in size: CGSize) -> Camera {
        let fitScale = fit(screen, in: size).scale
        var c = camera
        c.scale = min(max(c.scale, fitScale), fitScale * maxZoom)
        let a = available(size)
        func axis(_ off: Double, _ origin: Double, _ length: Double, _ aMin: Double, _ aLen: Double) -> Double {
            let content = length * c.scale
            if content <= aLen { return aMin + (aLen - content) / 2 - origin * c.scale }
            let lo = aMin + aLen - (origin + length) * c.scale
            let hi = aMin - origin * c.scale
            return min(max(off, lo), hi)
        }
        c.offset.x = axis(c.offset.x, screen.x, screen.w, a.x, a.w)
        c.offset.y = axis(c.offset.y, screen.y, screen.h, a.y, a.h)
        return c
    }

    /// The fit zoom's multiple the camera is at (1 = the whole screen).
    public func zoom(of camera: Camera, screen: Box, in size: CGSize) -> Double {
        camera.scale / fit(screen, in: size).scale
    }
}
