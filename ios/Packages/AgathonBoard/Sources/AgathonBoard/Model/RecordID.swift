import Foundation

/// A record's stable id: `<type>:<key>`, e.g. `stroke:k3VbQ8wZp2Lr`. Never reused, never changed.
/// A board converted from tldraw keeps the tldraw key (`shape:abc` → `stroke:abc`), so converting
/// the same board twice gives the same ids.
public struct RecordID: Hashable, Comparable, Sendable, Codable, CustomStringConvertible, ExpressibleByStringLiteral {
    public let rawValue: String

    public init(_ rawValue: String) { self.rawValue = rawValue }
    public init(stringLiteral value: String) { self.rawValue = value }

    public init(from decoder: Decoder) throws {
        rawValue = try decoder.singleValueContainer().decode(String.self)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(rawValue)
    }

    public var description: String { rawValue }

    /// The part before the colon (`stroke`), or "" when there is none.
    public var prefix: Substring {
        guard let colon = rawValue.firstIndex(of: ":") else { return "" }
        return rawValue[..<colon]
    }

    /// The part after the colon.
    public var key: Substring {
        guard let colon = rawValue.firstIndex(of: ":") else { return Substring(rawValue) }
        return rawValue[rawValue.index(after: colon)...]
    }

    public static func < (a: RecordID, b: RecordID) -> Bool {
        a.rawValue.utf8.lexicographicallyPrecedes(b.rawValue.utf8)
    }

    /// A fresh id: `type` + 12 random base-62 characters (71 bits).
    public static func make(_ type: RecordType) -> RecordID {
        var rng = SystemRandomNumberGenerator()
        return make(type, using: &rng)
    }

    public static func make<G: RandomNumberGenerator>(_ type: RecordType, using rng: inout G) -> RecordID {
        let digits = Array(OrderKey.base62.utf8)
        var key = [UInt8]()
        key.reserveCapacity(12)
        for _ in 0..<12 { key.append(digits[Int(rng.next(upperBound: UInt64(62)))]) }
        return RecordID("\(type.rawValue):\(String(decoding: key, as: UTF8.self))")
    }

    /// The id a converted record gets: `type` + the source key.
    public static func converted(_ type: RecordType, from sourceID: String) -> RecordID {
        let key = sourceID.firstIndex(of: ":").map { String(sourceID[sourceID.index(after: $0)...]) } ?? sourceID
        return RecordID("\(type.rawValue):\(key)")
    }
}

/// A deterministic generator for tests and synthetic boards (SplitMix64).
public struct SeededGenerator: RandomNumberGenerator, Sendable {
    private var state: UInt64
    public init(seed: UInt64) { state = seed }
    public mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}
