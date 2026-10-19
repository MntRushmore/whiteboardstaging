import Foundation

/// A fractional index: a string key that sorts (byte order) between its neighbours, so a record can
/// be put between two others without renumbering anything. The same scheme as tldraw's `index`
/// (`a0`, `a1`, `a1V`, …): an integer part whose first character gives its length (`a`–`z` grow up
/// from `a0`, `A`–`Z` grow down), then a base-62 fraction with no trailing zero.
///
/// The algorithm is David Greenspan's, as in `fractional-indexing` (Rocicorp, CC0); this is a Swift
/// rewrite. Keys sort by their UTF-8 bytes, never by `String`'s Unicode ordering.
public struct OrderKey: Hashable, Comparable, Sendable, Codable, CustomStringConvertible, ExpressibleByStringLiteral {
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

    public static func < (a: OrderKey, b: OrderKey) -> Bool {
        a.rawValue.utf8.lexicographicallyPrecedes(b.rawValue.utf8)
    }

    public static let base62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    /// The first key of an empty list.
    public static let first: OrderKey = "a0"

    public enum KeyError: Error, Equatable {
        case invalid(String)
        case outOfOrder(String, String)
        case exhausted
    }

    /// Whether `key` is a well-formed key (a converted board's keys are checked with this).
    public var isValid: Bool { (try? Self.validate(Array(rawValue.utf8))) != nil }

    /// A key strictly between `a` and `b` (`nil` = open end). Throws when `a >= b` or a key is malformed.
    public static func between(_ a: OrderKey?, _ b: OrderKey?) throws -> OrderKey {
        let ka = a.map { Array($0.rawValue.utf8) }
        let kb = b.map { Array($0.rawValue.utf8) }
        if let ka { try validate(ka) }
        if let kb { try validate(kb) }
        if let ka, let kb, !ka.lexicographicallyPrecedes(kb) {
            throw KeyError.outOfOrder(a!.rawValue, b!.rawValue)
        }
        return OrderKey(String(decoding: try keyBetween(ka, kb), as: UTF8.self))
    }

    /// A key after `a` (or the first key).
    public static func after(_ a: OrderKey?) -> OrderKey {
        (try? between(a, nil)) ?? OrderKey((a?.rawValue ?? "a0") + "V")
    }

    /// A key before `b` (or the first key).
    public static func before(_ b: OrderKey?) -> OrderKey {
        (try? between(nil, b)) ?? .first
    }

    /// `n` keys in ascending order after `a` and before `b`, spread evenly enough for a bulk insert.
    public static func sequence(_ n: Int, after a: OrderKey? = nil, before b: OrderKey? = nil) throws -> [OrderKey] {
        if n <= 0 { return [] }
        if b == nil {
            var out: [OrderKey] = []
            out.reserveCapacity(n)
            var prev = a
            for _ in 0..<n {
                let k = try between(prev, nil)
                out.append(k)
                prev = k
            }
            return out
        }
        if a == nil {
            var out: [OrderKey] = []
            var next = b
            for _ in 0..<n {
                let k = try between(nil, next)
                out.append(k)
                next = k
            }
            return out.reversed()
        }
        // both ends: divide and conquer keeps the keys short
        let mid = n / 2
        let c = try between(a, b)
        return try sequence(mid, after: a, before: c) + [c] + sequence(n - mid - 1, after: c, before: b)
    }

    // MARK: - The algorithm (on UTF-8 bytes)

    private static let digits: [UInt8] = Array(base62.utf8)
    private static let zero = UInt8(ascii: "0")
    private static let smallestInteger: [UInt8] = Array(("A" + String(repeating: "0", count: 26)).utf8)

    private static func digitValue(_ c: UInt8) -> Int? {
        switch c {
        case UInt8(ascii: "0")...UInt8(ascii: "9"): return Int(c - UInt8(ascii: "0"))
        case UInt8(ascii: "A")...UInt8(ascii: "Z"): return Int(c - UInt8(ascii: "A")) + 10
        case UInt8(ascii: "a")...UInt8(ascii: "z"): return Int(c - UInt8(ascii: "a")) + 36
        default: return nil
        }
    }

    private static func integerLength(_ head: UInt8) throws -> Int {
        if head >= UInt8(ascii: "a") && head <= UInt8(ascii: "z") { return Int(head - UInt8(ascii: "a")) + 2 }
        if head >= UInt8(ascii: "A") && head <= UInt8(ascii: "Z") { return Int(UInt8(ascii: "Z") - head) + 2 }
        throw KeyError.invalid("head \(head)")
    }

    private static func integerPart(_ key: [UInt8]) throws -> [UInt8] {
        guard let head = key.first else { throw KeyError.invalid("") }
        let n = try integerLength(head)
        if n > key.count { throw KeyError.invalid(String(decoding: key, as: UTF8.self)) }
        return Array(key[0..<n])
    }

    private static func validate(_ key: [UInt8]) throws {
        if key == smallestInteger { throw KeyError.invalid(String(decoding: key, as: UTF8.self)) }
        let i = try integerPart(key)
        for c in key where digitValue(c) == nil { throw KeyError.invalid(String(decoding: key, as: UTF8.self)) }
        if key.count > i.count, key.last == zero { throw KeyError.invalid(String(decoding: key, as: UTF8.self)) }
    }

    /// A fraction strictly between fractions `a` and `b` (`nil` = 1). No trailing zeros in or out.
    private static func midpoint(_ a: ArraySlice<UInt8>, _ b: ArraySlice<UInt8>?) throws -> [UInt8] {
        if let b {
            // the common prefix (a padded with zeros)
            var n = 0
            while n < b.count && (n < a.count ? a[a.startIndex + n] : zero) == b[b.startIndex + n] { n += 1 }
            if n > 0 {
                let rest = try midpoint(a.dropFirst(min(n, a.count)), b.dropFirst(n))
                return Array(b.prefix(n)) + rest
            }
        }
        let da = a.first.flatMap(digitValue) ?? 0
        let db = b.flatMap { $0.first.flatMap(digitValue) } ?? digits.count
        if db - da > 1 {
            let mid = Int((0.5 * Double(da + db)).rounded())
            return [digits[mid]]
        }
        if let b, b.count > 1 { return [b[b.startIndex]] }
        return [digits[da]] + (try midpoint(a.dropFirst(), nil))
    }

    private static func increment(_ x: [UInt8]) -> [UInt8]? {
        guard let head = x.first else { return nil }
        var digs = Array(x.dropFirst())
        var carry = true
        var i = digs.count - 1
        while carry && i >= 0 {
            let d = (digitValue(digs[i]) ?? 0) + 1
            if d == digits.count {
                digs[i] = zero
            } else {
                digs[i] = digits[d]
                carry = false
            }
            i -= 1
        }
        if carry {
            if head == UInt8(ascii: "Z") { return Array("a0".utf8) }
            if head == UInt8(ascii: "z") { return nil }
            let h = head + 1
            if h > UInt8(ascii: "a") { digs.append(zero) } else { digs.removeLast() }
            return [h] + digs
        }
        return [head] + digs
    }

    private static func decrement(_ x: [UInt8]) -> [UInt8]? {
        guard let head = x.first else { return nil }
        var digs = Array(x.dropFirst())
        var borrow = true
        var i = digs.count - 1
        while borrow && i >= 0 {
            let d = (digitValue(digs[i]) ?? 0) - 1
            if d == -1 {
                digs[i] = digits[digits.count - 1]
            } else {
                digs[i] = digits[d]
                borrow = false
            }
            i -= 1
        }
        if borrow {
            if head == UInt8(ascii: "a") { return [UInt8(ascii: "Z"), digits[digits.count - 1]] }
            if head == UInt8(ascii: "A") { return nil }
            let h = head - 1
            if h < UInt8(ascii: "Z") { digs.append(digits[digits.count - 1]) } else { digs.removeLast() }
            return [h] + digs
        }
        return [head] + digs
    }

    private static func keyBetween(_ a: [UInt8]?, _ b: [UInt8]?) throws -> [UInt8] {
        guard let a else {
            guard let b else { return Array("a0".utf8) }
            let ib = try integerPart(b)
            let fb = b[ib.count...]
            if ib == smallestInteger { return ib + (try midpoint([], fb)) }
            if ib.lexicographicallyPrecedes(b) { return ib }
            guard let res = decrement(ib) else { throw KeyError.exhausted }
            return res
        }
        guard let b else {
            let ia = try integerPart(a)
            let fa = a[ia.count...]
            if let i = increment(ia) { return i }
            return ia + (try midpoint(fa, nil))
        }
        let ia = try integerPart(a)
        let fa = a[ia.count...]
        let ib = try integerPart(b)
        let fb = b[ib.count...]
        if ia == ib { return ia + (try midpoint(fa, fb)) }
        guard let i = increment(ia) else { throw KeyError.exhausted }
        if i.lexicographicallyPrecedes(b) { return i }
        return ia + (try midpoint(fa, nil))
    }
}
