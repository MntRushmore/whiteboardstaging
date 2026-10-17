import Foundation
@testable import AgathonBrain

/// One parity case: a brain call and what the TypeScript brain answered in node
/// (`src/__eval__/brain/golden.test.ts`, `npm run brain:golden`).
struct GoldenCase: Decodable, Sendable {
    var name: String
    var method: String
    /// the arguments, exactly as they cross the boundary
    var args: String
    /// the envelope node's brain returned
    var result: String
}

enum Golden {
    static let cases: [GoldenCase] = {
        guard let url = Bundle.module.url(forResource: "golden", withExtension: "ndjson"),
              let text = try? String(contentsOf: url, encoding: .utf8)
        else { return [] }
        let decoder = JSONDecoder()
        return text.split(separator: "\n").compactMap { try? decoder.decode(GoldenCase.self, from: Data($0.utf8)) }
    }()

    static func named(_ name: String) -> GoldenCase? { cases.first { $0.name == name } }

    static func method(_ method: String) -> [GoldenCase] { cases.filter { $0.method == method } }

    /// A brain loaded once for the whole test run.
    static let brain: Brain = Brain()
}

/// Compares two JSON documents: exactly, or with numbers within a relative tolerance.
enum JSONCompare {
    struct Difference: CustomStringConvertible {
        var path: String
        var detail: String
        var description: String { "\(path): \(detail)" }
    }

    static func parse(_ json: String) -> Any? {
        try? JSONSerialization.jsonObject(with: Data(json.utf8), options: [.fragmentsAllowed])
    }

    private static func isBool(_ n: NSNumber) -> Bool { CFGetTypeID(n) == CFBooleanGetTypeID() }

    /// The first difference, or nil. `tolerance` is relative (to the larger magnitude, at least 1).
    /// `nullIsMissing`: a key set to null equals a key left out (Swift leaves nil optionals out).
    static func firstDifference(_ a: Any?, _ b: Any?, tolerance: Double, nullIsMissing: Bool = false, path: String = "$") -> Difference? {
        switch (a, b) {
        case (nil, nil): return nil
        case (is NSNull, is NSNull): return nil
        case (nil, is NSNull), (is NSNull, nil): return nullIsMissing ? nil : Difference(path: path, detail: "missing vs null")
        case let (x as NSNumber, y as NSNumber):
            if isBool(x) || isBool(y) {
                return isBool(x) && isBool(y) && x.boolValue == y.boolValue ? nil : Difference(path: path, detail: "\(x) vs \(y)")
            }
            let dx = x.doubleValue, dy = y.doubleValue
            if dx == dy { return nil }
            let scale = max(1, abs(dx), abs(dy))
            return abs(dx - dy) <= tolerance * scale ? nil : Difference(path: path, detail: "\(dx) vs \(dy)")
        case let (x as String, y as String):
            return x == y ? nil : Difference(path: path, detail: "\"\(x.prefix(60))\" vs \"\(y.prefix(60))\"")
        case let (x as [Any], y as [Any]):
            if x.count != y.count { return Difference(path: path, detail: "\(x.count) items vs \(y.count)") }
            for i in x.indices {
                if let d = firstDifference(x[i], y[i], tolerance: tolerance, nullIsMissing: nullIsMissing, path: "\(path)[\(i)]") { return d }
            }
            return nil
        case let (x as [String: Any], y as [String: Any]):
            for key in Set(x.keys).union(y.keys).sorted() {
                if let d = firstDifference(x[key], y[key], tolerance: tolerance, nullIsMissing: nullIsMissing, path: "\(path).\(key)") { return d }
            }
            return nil
        default:
            return Difference(path: path, detail: "\(String(describing: a).prefix(60)) vs \(String(describing: b).prefix(60))")
        }
    }

    /// The largest relative difference between numbers at the same place (0 when equal).
    static func maxRelativeDifference(_ a: Any?, _ b: Any?) -> Double {
        switch (a, b) {
        case let (x as NSNumber, y as NSNumber):
            let dx = x.doubleValue, dy = y.doubleValue
            return dx == dy ? 0 : abs(dx - dy) / max(1, abs(dx), abs(dy))
        case let (x as [Any], y as [Any]):
            return zip(x, y).map { maxRelativeDifference($0, $1) }.max() ?? 0
        case let (x as [String: Any], y as [String: Any]):
            return x.keys.compactMap { k in y[k].map { maxRelativeDifference(x[k], $0) } }.max() ?? 0
        default:
            return 0
        }
    }
}
