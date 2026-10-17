import CoreGraphics
import Foundation

// A Swift port of perfect-freehand 1.2.3 (getStrokePoints, getStrokeOutlinePoints) by Steve Ruiz,
// MIT licence: see THIRD-PARTY-NOTICES.md. Changes from the original, all marked "Agathon:":
//  - the two-point case interpolates pressure as well as position;
//  - real pressure can be rate-limited like simulated pressure (`smoothRealPressure`), so a
//    Pencil's force does not make the outline jump from one sample to the next;
//  - points are `Vec2` structs instead of `[x, y]` arrays (no allocation per point).

/// Pressure easing curves.
public enum FreehandEasing: Sendable {
    case linear
    /// sin(t·π/2): tldraw's simulated-pressure pen
    case easeOutSine
    /// t·0.65 + sin(t·π/2)·0.35: tldraw's real-pressure pen
    case pen
    case easeOutQuad
    case easeOutCubic

    @inline(__always) func callAsFunction(_ t: Double) -> Double {
        switch self {
        case .linear: return t
        case .easeOutSine: return sin(t * .pi / 2)
        case .pen: return t * 0.65 + sin(t * .pi / 2) * 0.35
        case .easeOutQuad: return t * (2 - t)
        case .easeOutCubic:
            let u = t - 1
            return u * u * u + 1
        }
    }
}

public struct FreehandOptions: Sendable {
    /// base diameter
    public var size: Double = 16
    /// how much pressure changes the width (0 = none)
    public var thinning: Double = 0.5
    /// how much the outline's edge is softened (minimum distance between outline points, × size)
    public var smoothing: Double = 0.5
    /// how much the input is smoothed (0 = follows every point)
    public var streamline: Double = 0.5
    public var easing: FreehandEasing = .linear
    public var simulatePressure: Bool = true
    public var capStart = true
    public var capEnd = true
    /// taper length at each end (0 = none)
    public var taperStart: Double = 0
    public var taperEnd: Double = 0
    /// the stroke is finished: its last point is used exactly
    public var last = false
    /// Agathon: rate-limit real pressure the way simulated pressure is
    public var smoothRealPressure = false

    public init() {}
}

public struct FreehandStrokePoint: Sendable {
    public var point: Vec2
    public var pressure: Double
    public var vector: Vec2
    public var distance: Double
    public var runningLength: Double
}

/// One input sample: position and pressure (0…1, negative = none).
public struct FreehandInput: Sendable {
    public var p: Vec2
    public var pressure: Double

    public init(_ p: Vec2, _ pressure: Double) {
        self.p = p
        self.pressure = pressure
    }
}

public enum Freehand {
    static let rateOfPressureChange = 0.275
    static let fixedPi = Double.pi + 0.0001
    static let startCapSegments = 13.0
    static let endCapSegments = 29.0
    static let cornerCapSegments = 13.0
    static let endNoiseThreshold = 3.0
    static let minStreamlineT = 0.15
    static let streamlineTRange = 0.85
    static let minRadius = 0.01
    static let defaultFirstPressure = 0.25
    static let defaultPressure = 0.5

    @inline(__always) static func validPressure(_ p: Double) -> Bool { p >= 0 && !p.isNaN }

    @inline(__always) static func strokeRadius(_ size: Double, _ thinning: Double, _ pressure: Double, _ easing: FreehandEasing) -> Double {
        size * easing(0.5 - thinning * (0.5 - pressure))
    }

    @inline(__always) static func simulatePressure(_ prev: Double, _ distance: Double, _ size: Double) -> Double {
        let sp = min(1, distance / size)
        let rp = min(1, 1 - sp)
        return min(1, prev + (rp - prev) * (sp * rateOfPressureChange))
    }

    /// The full outline polygon of a stroke.
    public static func outline(_ input: [FreehandInput], _ o: FreehandOptions) -> [Vec2] {
        outlinePoints(strokePoints(input, o), o)
    }

    // MARK: getStrokePoints

    public static func strokePoints(_ input: [FreehandInput], _ o: FreehandOptions) -> [FreehandStrokePoint] {
        if input.isEmpty { return [] }
        let t = minStreamlineT + (1 - o.streamline) * streamlineTRange
        var pts = input
        // Agathon: interpolate pressure too
        if pts.count == 2 {
            let a = pts[0]
            let b = pts[1]
            pts = [a]
            for i in 1..<5 {
                let k = Double(i) / 4
                pts.append(FreehandInput(a.p.lerp(b.p, k), a.pressure + (b.pressure - a.pressure) * k))
            }
        }
        if pts.count == 1 {
            pts.append(FreehandInput(pts[0].p + Vec2(1, 1), pts[0].pressure))
        }
        var out: [FreehandStrokePoint] = []
        out.reserveCapacity(pts.count)
        out.append(FreehandStrokePoint(
            point: pts[0].p,
            pressure: validPressure(pts[0].pressure) ? pts[0].pressure : defaultFirstPressure,
            vector: Vec2(1, 1), distance: 0, runningLength: 0))
        var hasReachedMinimumLength = false
        var runningLength = 0.0
        var prev = out[0]
        let maxI = pts.count - 1
        for i in 1..<pts.count {
            let point = (o.last && i == maxI) ? pts[i].p : prev.point.lerp(pts[i].p, t)
            if point == prev.point { continue }
            let distance = point.dist(prev.point)
            runningLength += distance
            if i < maxI && !hasReachedMinimumLength {
                if runningLength < o.size { continue }
                hasReachedMinimumLength = true
            }
            prev = FreehandStrokePoint(
                point: point,
                pressure: validPressure(pts[i].pressure) ? pts[i].pressure : defaultPressure,
                vector: (prev.point - point).unit,
                distance: distance,
                runningLength: runningLength)
            out.append(prev)
        }
        out[0].vector = out.count > 1 ? out[1].vector : Vec2(0, 0)
        return out
    }

    // MARK: getStrokeOutlinePoints

    public static func outlinePoints(_ points: [FreehandStrokePoint], _ o: FreehandOptions) -> [Vec2] {
        let size = o.size
        if points.isEmpty || size <= 0 { return [] }
        let totalLength = points[points.count - 1].runningLength
        let taperStart = o.taperStart > 0 ? o.taperStart : 0
        let taperEnd = o.taperEnd > 0 ? o.taperEnd : 0
        let minDistance = pow(size * o.smoothing, 2)
        var leftPts: [Vec2] = []
        var rightPts: [Vec2] = []
        leftPts.reserveCapacity(points.count + 16)
        rightPts.reserveCapacity(points.count + 16)

        let simulate = o.simulatePressure
        let rateLimit = simulate || o.smoothRealPressure
        // initial pressure: averaged over the first points, to avoid fat starts
        var prevPressure: Double = {
            var acc = points[0].pressure
            for p in points.prefix(10) {
                var pressure = p.pressure
                if simulate { pressure = simulatePressure(acc, p.distance, size) }
                acc = (acc + pressure) / 2
            }
            return acc
        }()

        var radius = strokeRadius(size, o.thinning, points[points.count - 1].pressure, o.easing)
        var firstRadius: Double?
        var prevVector = points[0].vector
        var prevLeftPoint = points[0].point
        var prevRightPoint = prevLeftPoint
        var tempLeftPoint = prevLeftPoint
        var tempRightPoint = prevRightPoint
        var isPrevPointSharpCorner = false

        for i in 0..<points.count {
            var pressure = points[i].pressure
            let point = points[i].point
            let vector = points[i].vector
            let distance = points[i].distance
            let runningLength = points[i].runningLength
            let isLastPoint = i == points.count - 1

            if !isLastPoint && totalLength - runningLength < endNoiseThreshold { continue }

            if o.thinning != 0 {
                if simulate {
                    pressure = simulatePressure(prevPressure, distance, size)
                } else if rateLimit {
                    // Agathon: real pressure, rate-limited by how far the pen moved
                    let sp = min(1, distance / size)
                    pressure = min(1, prevPressure + (pressure - prevPressure) * min(1, sp * rateOfPressureChange * 4))
                }
                radius = strokeRadius(size, o.thinning, pressure, o.easing)
            } else {
                radius = size / 2
            }
            if firstRadius == nil { firstRadius = radius }

            let taperStartStrength = runningLength < taperStart ? FreehandEasing.easeOutQuad(runningLength / taperStart) : 1
            let taperEndStrength = totalLength - runningLength < taperEnd ? FreehandEasing.easeOutCubic((totalLength - runningLength) / taperEnd) : 1
            radius = max(minRadius, radius * min(taperStartStrength, taperEndStrength))

            let nextVector = (!isLastPoint ? points[i + 1] : points[i]).vector
            let nextDpr = !isLastPoint ? vector.dot(nextVector) : 1.0
            let prevDpr = vector.dot(prevVector)
            let isPointSharpCorner = prevDpr < 0 && !isPrevPointSharpCorner
            let isNextPointSharpCorner = nextDpr < 0

            if isPointSharpCorner || isNextPointSharpCorner {
                let offset = prevVector.per * radius
                let step = 1 / cornerCapSegments
                var t = 0.0
                while t <= 1 {
                    tempLeftPoint = (point - offset).rotated(around: point, by: fixedPi * t)
                    leftPts.append(tempLeftPoint)
                    tempRightPoint = (point + offset).rotated(around: point, by: fixedPi * -t)
                    rightPts.append(tempRightPoint)
                    t += step
                }
                prevLeftPoint = tempLeftPoint
                prevRightPoint = tempRightPoint
                if isNextPointSharpCorner { isPrevPointSharpCorner = true }
                continue
            }
            isPrevPointSharpCorner = false

            if isLastPoint {
                let offset = vector.per * radius
                leftPts.append(point - offset)
                rightPts.append(point + offset)
                continue
            }

            let offset = nextVector.lerp(vector, nextDpr).per * radius
            tempLeftPoint = point - offset
            if i <= 1 || prevLeftPoint.dist2(tempLeftPoint) > minDistance {
                leftPts.append(tempLeftPoint)
                prevLeftPoint = tempLeftPoint
            }
            tempRightPoint = point + offset
            if i <= 1 || prevRightPoint.dist2(tempRightPoint) > minDistance {
                rightPts.append(tempRightPoint)
                prevRightPoint = tempRightPoint
            }
            prevPressure = pressure
            prevVector = vector
        }

        let firstPoint = points[0].point
        let lastPoint = points.count > 1 ? points[points.count - 1].point : points[0].point + Vec2(1, 1)
        var startCap: [Vec2] = []
        var endCap: [Vec2] = []

        if points.count == 1 {
            if !(taperStart > 0 || taperEnd > 0) || o.last {
                return dot(firstPoint, firstRadius ?? radius)
            }
        } else {
            if taperStart > 0 || (taperEnd > 0 && points.count == 1) {
                // tapered start: no cap
            } else if o.capStart, let r0 = rightPts.first {
                let step = 1 / startCapSegments
                var t = step
                while t <= 1 {
                    startCap.append(r0.rotated(around: firstPoint, by: fixedPi * t))
                    t += step
                }
            } else if let l0 = leftPts.first, let r0 = rightPts.first {
                let corners = l0 - r0
                let a = corners * 0.5
                let b = corners * 0.51
                startCap += [firstPoint - a, firstPoint - b, firstPoint + b, firstPoint + a]
            }

            let direction = (-points[points.count - 1].vector).per
            if taperEnd > 0 || (taperStart > 0 && points.count == 1) {
                endCap.append(lastPoint)
            } else if o.capEnd {
                let start = lastPoint + direction * radius
                let step = 1 / endCapSegments
                var t = step
                while t < 1 {
                    endCap.append(start.rotated(around: lastPoint, by: fixedPi * 3 * t))
                    t += step
                }
            } else {
                endCap += [lastPoint + direction * radius, lastPoint + direction * (radius * 0.99),
                           lastPoint - direction * (radius * 0.99), lastPoint - direction * radius]
            }
        }
        return leftPts + endCap + rightPts.reversed() + startCap
    }

    static func dot(_ center: Vec2, _ radius: Double) -> [Vec2] {
        let offsetPoint = center + Vec2(1, 1)
        let start = center + (center - offsetPoint).per.unit * -radius
        var out: [Vec2] = []
        let step = 1 / startCapSegments
        var t = step
        while t <= 1 {
            out.append(start.rotated(around: center, by: fixedPi * 2 * t))
            t += step
        }
        return out
    }

    // MARK: path

    /// The outline as a smooth closed path: quadratic curves through the midpoints of the outline's
    /// points (perfect-freehand's `getSvgPathFromStroke`, `M a Q b mid(b,c) T …`).
    public static func path(_ outline: [Vec2], transform: CGAffineTransform = .identity) -> CGPath {
        let path = CGMutablePath()
        addPath(outline, to: path, transform: transform)
        return path
    }

    public static func addPath(_ pts: [Vec2], to path: CGMutablePath, transform t: CGAffineTransform = .identity) {
        let n = pts.count
        if n == 0 { return }
        if n < 4 {
            path.addLines(between: pts.map(\.cgPoint), transform: t)
            path.closeSubpath()
            return
        }
        path.move(to: pts[0].cgPoint, transform: t)
        for i in 1..<(n - 1) {
            let a = pts[i]
            let b = pts[i + 1]
            path.addQuadCurve(to: CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2), control: a.cgPoint, transform: t)
        }
        path.closeSubpath()
    }
}
