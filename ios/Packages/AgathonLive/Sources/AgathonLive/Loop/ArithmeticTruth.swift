import Foundation

/// Whether a line of plain arithmetic is TRUE: the loop never rings a correct line (the web's
/// young-work rule, `engine/primaryWork.ts`: "a relation that is true is never ringed"). The engine
/// judges a line against the column's problem; when the loop has the wrong problem for it (a column
/// it could not put under the tutor's problem) a true line could come back ringed — the owner's
/// iPad, 2026-10-19: `=431` under `767-336` was ringed. Checked here, by the line's own numbers:
///
///  - `A = B` (and chains `A = B = C`): every side worked out, all equal;
///  - a line starting with `=` goes on from the expression right above it (`767-336` then `=431` is
///    `767-336=431`), as a child means it;
///  - anything else (letters, fractions, roots, a side that will not parse) is not known here: nil,
///    and the engine's verdict stands.
enum ArithmeticTruth {
    /// True / false for a relation of plain numbers; nil when it is not one this can work out.
    static func holds(_ latex: String, above: String? = nil) -> Bool? {
        var line = tidy(latex)
        if line.hasPrefix("="), let above {
            let up = tidy(above)
            guard !up.isEmpty else { return nil }
            // `767-336` then `=431`; `767-336=` then `=431` too
            line = up.hasSuffix("=") ? up + String(line.dropFirst()) : up + line
        }
        let sides = line.split(separator: "=", omittingEmptySubsequences: false).map(String.init)
        guard sides.count >= 2, sides.allSatisfy({ !$0.isEmpty }) else { return nil }
        var values: [Double] = []
        for side in sides {
            guard let v = evaluate(side) else { return nil }
            values.append(v)
        }
        func same(_ a: Double, _ b: Double) -> Bool { abs(a - b) <= 1e-9 * max(1, abs(a)) }
        if values.dropFirst().allSatisfy({ same($0, values[0]) }) { return true }
        // a running chain, `=` used as "then" (`20+10=30+12=42`): read link by link, as the child
        // means it — each side worth the number the next one starts from (or the next side itself)
        for k in 0..<(sides.count - 1) {
            let next = sides[k + 1]
            let lead = leadingNumber(next)
            guard same(values[k], values[k + 1]) || lead.map({ same(values[k], $0) }) == true else { return false }
        }
        return true
    }

    /// `30+12` → 30: the number a side starts with.
    private static func leadingNumber(_ side: String) -> Double? {
        let digits = side.prefix { $0.isNumber || $0 == "." }
        return digits.isEmpty ? nil : Double(digits)
    }

    /// The read as plain characters: `\times`, `\cdot`, `×`, `*` are `*`; `\div`, `÷`, `/` are `/`;
    /// minus signs are `-`; brackets and spaces as they are, `\left(`/`\right)` as brackets. Empty
    /// when anything else is in it (a letter, a fraction, a root): not plain arithmetic.
    static func tidy(_ latex: String) -> String {
        var s = latex
        for (from, to) in [("\\left(", "("), ("\\right)", ")"), ("\\left", ""), ("\\right", ""), ("\\times", "*"), ("\\cdot", "*"), ("\\div", "/"),
                           ("×", "*"), ("÷", "/"), ("\u{2212}", "-"), ("\u{2013}", "-"), ("{", ""), ("}", ""), ("\\,", ""), ("\\ ", "")] {
            s = s.replacingOccurrences(of: from, with: to)
        }
        s = s.replacingOccurrences(of: " ", with: "")
        let allowed = Set("0123456789.+-*/()=")
        return s.allSatisfy { allowed.contains($0) } ? s : ""
    }

    /// `767-336` → 431. Numbers, + − × ÷ and brackets, the usual order; nil when it does not parse.
    static func evaluate(_ expression: String) -> Double? {
        var p = Parser(Array(expression))
        guard let v = p.sum(), p.atEnd, v.isFinite else { return nil }
        return v
    }

    private struct Parser {
        let c: [Character]
        var i = 0
        init(_ c: [Character]) { self.c = c }
        var atEnd: Bool { i == c.count }

        mutating func sum() -> Double? {
            guard var v = product() else { return nil }
            while i < c.count, c[i] == "+" || c[i] == "-" {
                let op = c[i]
                i += 1
                guard let r = product() else { return nil }
                v = op == "+" ? v + r : v - r
            }
            return v
        }

        mutating func product() -> Double? {
            guard var v = unary() else { return nil }
            while i < c.count, c[i] == "*" || c[i] == "/" {
                let op = c[i]
                i += 1
                guard let r = unary() else { return nil }
                if op == "/" { guard r != 0 else { return nil }; v /= r } else { v *= r }
            }
            return v
        }

        mutating func unary() -> Double? {
            if i < c.count, c[i] == "-" { i += 1; return unary().map { -$0 } }
            return atom()
        }

        mutating func atom() -> Double? {
            guard i < c.count else { return nil }
            if c[i] == "(" {
                i += 1
                guard let v = sum(), i < c.count, c[i] == ")" else { return nil }
                i += 1
                return v
            }
            let start = i
            while i < c.count, c[i].isNumber || c[i] == "." { i += 1 }
            guard i > start else { return nil }
            return Double(String(c[start..<i]))
        }
    }
}
