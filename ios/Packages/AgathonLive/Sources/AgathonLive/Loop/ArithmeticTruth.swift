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
            // only onto an expression (`767-336`, or `767-336=`): under a finished line (`70+8=78`)
            // a lone `= 78` claims the answer, which the column's judge decides
            guard !up.isEmpty, !up.dropLast().contains("=") else { return nil }
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

    /// True as the child means it, though not as it is read (the Training Center's bench, 2026-10-21):
    ///
    ///  - **two facts side by side** (`10 \times 7=70 \quad 8 \times 7=56`, or run together by the read,
    ///    `10 \times 7=708 \times 7=56`): side work written on one row, clustered as one line — each
    ///    fact true. It was ringed as one wrong line;
    ///  - **an `=` read as a `-`** between two sides (`18 \times 7=70+56-126`): a wobbly `=` the read
    ///    took for a minus, the line true with it as an `=`.
    ///
    /// Only rings are taken back with it (never a tick given): when unsure, the tutor stays quiet.
    static func trueAsMeant(_ latex: String) -> Bool {
        if sideBySide(latex) == true { return true }
        return minusAsEquals(latex)
    }

    /// Two or more relations of plain numbers on one row, each true; nil when it is not that.
    static func sideBySide(_ latex: String) -> Bool? {
        // set apart by a space the read kept
        let spaced = latex.replacingOccurrences(of: #"\\q?quad|\\[;:]|\\hspace\s*\{[^{}]*\}"#, with: "\u{1}", options: .regularExpression)
        let pieces = spaced.split(separator: "\u{1}").map { String($0).trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        if pieces.count >= 2, pieces.allSatisfy({ $0.contains("=") }) {
            var all = true
            for p in pieces {
                guard let ok = holds(p) else { return nil }
                all = all && ok
            }
            return all
        }
        // run together: `A=B C=D` read `A=BC=D`, the middle side's digits shared by the two facts
        let line = tidy(latex)
        let sides = line.split(separator: "=", omittingEmptySubsequences: false).map(String.init)
        guard sides.count == 3, sides.allSatisfy({ !$0.isEmpty }) else { return nil }
        let middle = Array(sides[1])
        var k = 0
        while k < middle.count, middle[k].isNumber || middle[k] == "." { k += 1 }
        guard k >= 2, k < middle.count else { return nil }
        for cut in 1..<k {
            let first = sides[0] + "=" + String(middle[..<cut])
            let second = String(middle[cut...]) + "=" + sides[2]
            if holds(first) == true, holds(second) == true { return true }
        }
        return nil
    }

    /// The line is false as read, and true with one of its minus signs between two numbers read as an `=`.
    static func minusAsEquals(_ latex: String) -> Bool {
        let line = tidy(latex)
        guard line.contains("="), holds(line) == false else { return false }
        let chars = Array(line)
        for i in chars.indices where chars[i] == "-" && i > 0 && i + 1 < chars.count {
            guard chars[i - 1].isNumber || chars[i - 1] == ")", chars[i + 1].isNumber || chars[i + 1] == "(" else { continue }
            var swapped = chars
            swapped[i] = "="
            if holds(String(swapped)) == true { return true }
        }
        return false
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
