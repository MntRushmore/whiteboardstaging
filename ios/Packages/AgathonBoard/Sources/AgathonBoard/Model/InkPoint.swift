import Foundation

/// One sample of a stroke, relative to the stroke's origin, in page units (a screen is 1600 × 900).
public struct InkPoint: Equatable, Sendable {
    public var x: Float
    public var y: Float
    /// 0…1. A finger or mouse stroke stores 0.5 (`PressureMode.simulated`).
    public var pressure: Float
    /// The Pencil's altitude in radians (0 = flat, π/2 = upright), or -1 when unknown.
    public var altitude: Float
    /// The Pencil's azimuth in radians (0…2π, in the canvas's frame), meaningful when `altitude >= 0`.
    public var azimuth: Float
    /// ms after the stroke's `startTime` (replay).
    public var t: Float

    public init(x: Float, y: Float, pressure: Float = 0.5, altitude: Float = -1, azimuth: Float = 0, t: Float = 0) {
        self.x = x
        self.y = y
        self.pressure = pressure
        self.altitude = altitude
        self.azimuth = azimuth
        self.t = t
    }

    public init(x: Double, y: Double, pressure: Double = 0.5, t: Double = 0) {
        self.init(x: Float(x), y: Float(y), pressure: Float(pressure), t: Float(t))
    }

    public var hasTilt: Bool { altitude >= 0 }
}

/// The compact point encoding of schema v1 ("p1"): a stroke's points as one base64 string,
/// about 6–8 bytes a point instead of tldraw's ~33 (`{"x":…,"y":…,"z":…}`). See docs/BOARD-FORMAT.md.
///
/// Bytes, before base64:
///
///     u8      version (1)
///     u8      flags: 1 = pressure, 2 = tilt, 4 = time
///     varint  point count
///     then per point:
///       zigzag varint  x delta, in 1/16 page unit (from 0 for the first point)
///       zigzag varint  y delta, in 1/16 page unit
///       u8             pressure × 255                       (flag 1)
///       u8, u8         altitude / (π/2) × 255, azimuth / 2π × 256   (flag 2)
///       varint         ms since the previous point          (flag 4)
///
/// Positions are quantized absolutely (`round(x × 16)`) and the deltas taken between quantized
/// values, so nothing drifts along a long stroke. Without flag 1 every pressure is 0.5; without
/// flag 2 no tilt; without flag 4 every time is 0.
public enum PointCodec {
    public static let version: UInt8 = 1
    /// quanta per page unit (1/16 unit: 0.03 px of error at most, invisible at 4× zoom)
    public static let positionScale: Double = 16

    public enum DecodeError: Error, Equatable {
        case badBase64
        case badVersion(UInt8)
        case truncated
        case tooMany(Int)
    }

    static let maxPoints = 1_000_000

    /// The points exactly as a save and load gives them back (quantized positions, pressure, tilt and
    /// times). A stroke is normalized when it is committed, so the document in memory equals the
    /// document read back from its JSON, and a diff never sees a change that is only rounding.
    public static func normalize(_ points: [InkPoint]) -> [InkPoint] {
        (try? decodeBytes(encodeBytes(points))) ?? points
    }

    // MARK: encode

    public static func encode(_ points: [InkPoint]) -> String {
        encodeBytes(points).base64EncodedString()
    }

    public static func encodeBytes(_ points: [InkPoint]) -> Data {
        var hasPressure = false
        var hasTilt = false
        var hasTime = false
        for p in points {
            if !hasPressure && abs(p.pressure - 0.5) > 0.5 / 255 { hasPressure = true }
            if !hasTilt && p.hasTilt { hasTilt = true }
            if !hasTime && p.t.rounded() != 0 { hasTime = true }
        }
        var flags: UInt8 = 0
        if hasPressure { flags |= 1 }
        if hasTilt { flags |= 2 }
        if hasTime { flags |= 4 }

        var out = [UInt8]()
        out.reserveCapacity(8 + points.count * (4 + (hasPressure ? 1 : 0) + (hasTilt ? 2 : 0) + (hasTime ? 1 : 0)))
        out.append(version)
        out.append(flags)
        putVarint(UInt64(points.count), &out)
        var px: Int64 = 0
        var py: Int64 = 0
        var pt: Int64 = 0
        for p in points {
            let qx = Int64((Double(p.x) * positionScale).rounded())
            let qy = Int64((Double(p.y) * positionScale).rounded())
            putVarint(zigzag(qx - px), &out)
            putVarint(zigzag(qy - py), &out)
            px = qx
            py = qy
            if hasPressure {
                out.append(UInt8((Double(min(max(p.pressure, 0), 1)) * 255).rounded()))
            }
            if hasTilt {
                if p.hasTilt {
                    out.append(UInt8((Double(min(max(p.altitude, 0), .pi / 2)) / (Double.pi / 2) * 255).rounded()))
                    var z = (Double(p.azimuth) / (2 * Double.pi) * 256).rounded().truncatingRemainder(dividingBy: 256)
                    if z < 0 { z += 256 }
                    out.append(UInt8(z))
                } else {
                    // a point without tilt in a stroke with some: upright (rare: the first sample)
                    out.append(255)
                    out.append(0)
                }
            }
            if hasTime {
                let qt = max(pt, Int64(max(0, p.t.rounded())))
                putVarint(UInt64(qt - pt), &out)
                pt = qt
            }
        }
        return Data(out)
    }

    // MARK: decode

    public static func decode(_ base64: String) throws -> [InkPoint] {
        guard let data = Data(base64Encoded: base64) else { throw DecodeError.badBase64 }
        return try decodeBytes(data)
    }

    public static func decodeBytes(_ data: Data) throws -> [InkPoint] {
        try data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> [InkPoint] in
            let b = raw.bindMemory(to: UInt8.self)
            var i = 0
            func byte() throws -> UInt8 {
                guard i < b.count else { throw DecodeError.truncated }
                defer { i += 1 }
                return b[i]
            }
            func varint() throws -> UInt64 {
                var result: UInt64 = 0
                var shift: UInt64 = 0
                while true {
                    let c = try byte()
                    result |= UInt64(c & 0x7F) << shift
                    if c & 0x80 == 0 { return result }
                    shift += 7
                    if shift > 63 { throw DecodeError.truncated }
                }
            }
            let v = try byte()
            guard v == version else { throw DecodeError.badVersion(v) }
            let flags = try byte()
            let count = Int(try varint())
            guard count <= maxPoints else { throw DecodeError.tooMany(count) }
            var points = [InkPoint]()
            points.reserveCapacity(count)
            var qx: Int64 = 0
            var qy: Int64 = 0
            var qt: Int64 = 0
            let scale = Float(positionScale)
            // wrapping arithmetic: a corrupt string decodes to nonsense, never traps
            for _ in 0..<count {
                qx &+= unzigzag(try varint())
                qy &+= unzigzag(try varint())
                var p = InkPoint(x: Float(qx) / scale, y: Float(qy) / scale)
                if flags & 1 != 0 { p.pressure = Float(try byte()) / 255 }
                if flags & 2 != 0 {
                    let a = try byte()
                    let z = try byte()
                    p.altitude = Float(Double(a) / 255 * (Double.pi / 2))
                    p.azimuth = Float(Double(z) / 256 * (2 * Double.pi))
                }
                if flags & 4 != 0 {
                    qt &+= Int64(truncatingIfNeeded: try varint())
                    p.t = Float(qt)
                }
                points.append(p)
            }
            return points
        }
    }

    // MARK: varints

    @inline(__always) static func zigzag(_ v: Int64) -> UInt64 { UInt64(bitPattern: (v << 1) ^ (v >> 63)) }
    @inline(__always) static func unzigzag(_ v: UInt64) -> Int64 { Int64(bitPattern: v >> 1) ^ -Int64(bitPattern: v & 1) }

    @inline(__always) static func putVarint(_ value: UInt64, _ out: inout [UInt8]) {
        var v = value
        while v >= 0x80 {
            out.append(UInt8(v & 0x7F) | 0x80)
            v >>= 7
        }
        out.append(UInt8(v))
    }
}
