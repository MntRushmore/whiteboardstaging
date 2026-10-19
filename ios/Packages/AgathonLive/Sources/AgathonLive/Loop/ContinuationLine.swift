import Foundation

/// A line that goes on from the result of the line above it: a young student's running total.
/// `403 + 364 - 336` worked as `400 + 364 = 764`, then `+3 = 767` (the 3 of 403 added back), then
/// `-336 = 431`. Read alone, `+3 = 767` is the false fact `3 = 767` (ringed on the owner's iPad,
/// 2026-10-19); read as a child means it, it is `764 + 3 = 767` — what the line above ended in, then
/// the operation — and the column's own judge decides it like any other step (`judgeLine`: a true
/// step of the problem is a tick, a wrong running total is ringed, one built on a ringed total is
/// carried on from that slip). A line of this shape with no result above it to go on from is never
/// judged: quiet.
///
/// Only plain numbers: `op number = number` under a line ending in `= number`. An operation line of
/// algebra (`-3 \quad -3`, `\div 2`: no `=`) is the engine's own (`kind: "operation"`).
enum ContinuationLine {
    struct Parts: Equatable {
        /// `+`, `-`, `\times` or `\div`
        var op: String
        var operand: String
        var result: String
    }

    private static let number = #"\d+(?:\.\d+)?"#
    private static let shape = try! NSRegularExpression(pattern: #"^\s*(\+|-|\\times|\\div)\s*("# + number + #")\s*=\s*("# + number + #")\s*$"#)
    private static let plainNumber = try! NSRegularExpression(pattern: #"^\s*-?\s*"# + number + #"\s*$"#)

    /// The read with its operators written one way: `−` and `–` are `-`, `×`, `\cdot`, `*` are
    /// `\times`, `÷` and `/` (between numbers) are `\div`.
    static func tidy(_ latex: String) -> String {
        latex
            .replacingOccurrences(of: "\u{2212}", with: "-")
            .replacingOccurrences(of: "\u{2013}", with: "-")
            .replacingOccurrences(of: "×", with: "\\times ")
            .replacingOccurrences(of: "\\cdot", with: "\\times")
            .replacingOccurrences(of: "*", with: "\\times ")
            .replacingOccurrences(of: "÷", with: "\\div ")
            .replacingOccurrences(of: "{", with: "")
            .replacingOccurrences(of: "}", with: "")
    }

    /// `+3=767` → (+, 3, 767); nil for any other line.
    static func parse(_ latex: String) -> Parts? {
        let s = tidy(latex)
        let range = NSRange(s.startIndex..., in: s)
        guard let m = shape.firstMatch(in: s, range: range), m.numberOfRanges == 4,
              let op = Range(m.range(at: 1), in: s), let a = Range(m.range(at: 2), in: s), let r = Range(m.range(at: 3), in: s)
        else { return nil }
        return Parts(op: String(s[op]), operand: String(s[a]), result: String(s[r]))
    }

    /// The plain number a line of arithmetic ends in (`400 + 364 = 764` → `764`); nil when its last
    /// side is not a number, or the line has letters (algebra goes on by its own rules).
    static func result(of latex: String) -> String? {
        let s = tidy(latex)
        guard let at = s.range(of: "=", options: .backwards) else { return nil }
        let bare = s.replacingOccurrences(of: #"\\(?:times|div|frac|left|right)"#, with: " ", options: .regularExpression)
        guard !bare.contains(where: \.isLetter) else { return nil }
        let last = String(s[at.upperBound...])
        guard plainNumber.firstMatch(in: last, range: NSRange(last.startIndex..., in: last)) != nil else { return nil }
        return last.replacingOccurrences(of: " ", with: "")
    }

    /// `+3=767` under a line ending in 764 → `764 + 3 = 767`.
    static func rewritten(_ parts: Parts, after previous: String) -> String {
        "\(previous) \(parts.op) \(parts.operand) = \(parts.result)"
    }
}
