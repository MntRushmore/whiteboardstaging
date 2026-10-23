import Foundation

/// LaTeX as plain, readable text for the overlays (a readback, a problem on a card, a hint's maths):
/// `\frac{3}{4} + x^{2} \le 9` → `3/4 + x² ≤ 9`. Not a typesetter (the board's math records are the
/// tools lane's); just enough that a kid reads what the tutor read.
public enum MathText {
    static let commands: [String: String] = [
        "cdot": "·", "times": "×", "div": "÷", "pm": "±", "mp": "∓", "le": "≤", "leq": "≤", "ge": "≥", "geq": "≥",
        "neq": "≠", "ne": "≠", "approx": "≈", "to": "→", "rightarrow": "→", "Rightarrow": "⇒", "infty": "∞",
        "pi": "π", "theta": "θ", "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "Delta": "Δ", "lambda": "λ",
        "mu": "μ", "sigma": "σ", "phi": "φ", "omega": "ω", "circ": "°", "degree": "°", "angle": "∠", "triangle": "△",
        "in": "∈", "varnothing": "∅", "emptyset": "∅", "sqrt": "√", "ldots": "…", "cdots": "⋯", "%": "%",
        "sin": "sin", "cos": "cos", "tan": "tan", "log": "log", "ln": "ln", "quad": "  ", "qquad": "   ",
        "left": "", "right": "", "displaystyle": "", "mathrm": "", "operatorname": "", "boxed": "",
    ]
    static let superscripts: [Character: Character] = [
        "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
        "+": "⁺", "-": "⁻", "n": "ⁿ", "x": "ˣ", "(": "⁽", ")": "⁾",
    ]
    static let subscripts: [Character: Character] = [
        "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
    ]

    /// A stacked sum or a division bracket as one line (the kid sees "I read 47 + 38 = 85", not the
    /// array's LaTeX): the rows over a bar are added up (or take their own sign), what is under a bar
    /// is what they make; `9 )\overline{144}` under a quotient is `144 ÷ 9 = 16`. Nil for anything else.
    static func stacked(_ latex: String) -> String? {
        guard let begin = latex.range(of: #"\\begin\{array\}(\{[^{}]*\})?"#, options: .regularExpression),
              let end = latex.range(of: "\\end{array}"), begin.upperBound <= end.lowerBound else { return nil }
        let rows = latex[begin.upperBound..<end.lowerBound].components(separatedBy: "\\\\")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        // a division bracket: the quotient over `divisor )\overline{dividend}`
        if rows.count == 2, let re = try? NSRegularExpression(pattern: #"^([^)]+?)\s*\)\s*\\overline\s*\{([^{}]+)\}$"#),
           let m = re.firstMatch(in: rows[1], range: NSRange(rows[1].startIndex..., in: rows[1])),
           let divisor = Range(m.range(at: 1), in: rows[1]), let dividend = Range(m.range(at: 2), in: rows[1]) {
            return "\(rows[1][dividend]) \\div \(rows[1][divisor].trimmingCharacters(in: .whitespaces)) = \(rows[0])"
        }
        // sections between the bars: each one's rows (a row without a sign is added)
        var sections: [[String]] = [[]]
        for row in rows {
            var r = row
            while let bar = r.range(of: "\\hline") {
                r.removeSubrange(bar)
                sections.append([])
            }
            r = r.trimmingCharacters(in: .whitespaces)
            if !r.isEmpty { sections[sections.count - 1].append(r) }
        }
        sections = sections.filter { !$0.isEmpty }
        guard sections.count >= 2 else { return nil }
        return sections.map { rows in
            rows.enumerated().map { i, r in
                i == 0 || r.hasPrefix("+") || r.hasPrefix("-") || r.hasPrefix("\\times") || r.hasPrefix("\\div") ? r : "+ \(r)"
            }.joined(separator: " ")
        }.joined(separator: " = ")
    }

    public static func plain(_ latex: String) -> String {
        var s = stacked(latex) ?? latex
        // \text{…} and friends: their words
        s = s.replacingOccurrences(of: #"\\(?:text|textrm|mathrm|mbox|operatorname)\s*\{([^{}]*)\}"#, with: "$1", options: .regularExpression)
        // fractions, innermost first; a numerator or denominator of more than one term in brackets
        // (`\\frac{48-24}{6-2}` is `(48 - 24)/(6 - 2)`, never `48 - 24/6 - 2`: the SAT v2 end-to-end run's "I read")
        if let frac = try? NSRegularExpression(pattern: #"\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}"#) {
            for _ in 0..<6 {
                let ns = s as NSString
                guard let m = frac.firstMatch(in: s, range: NSRange(location: 0, length: ns.length)) else { break }
                let part = { (r: NSRange) -> String in
                    let t = ns.substring(with: r).trimmingCharacters(in: .whitespaces)
                    // a sign after the first character: two terms (`48-24`, `x+1`); `-3` alone is one
                    return t.dropFirst().range(of: #"[+\-]"#, options: .regularExpression) != nil ? "(\(t))" : t
                }
                s = ns.replacingCharacters(in: m.range, with: "\(part(m.range(at: 1)))/\(part(m.range(at: 2)))")
            }
        }
        s = s.replacingOccurrences(of: #"\\sqrt\s*\{([^{}]*)\}"#, with: "√($1)", options: .regularExpression)
        s = s.replacingOccurrences(of: #"√\(([A-Za-z0-9.]+)\)"#, with: "√$1", options: .regularExpression)
        s = scripts(s, marker: "^", table: superscripts)
        s = scripts(s, marker: "_", table: subscripts)
        // commands
        if let re = try? NSRegularExpression(pattern: #"\\([A-Za-z]+|[,;:! %])"#) {
            let ns = s as NSString
            var out = ""
            var last = 0
            for m in re.matches(in: s, range: NSRange(location: 0, length: ns.length)) {
                out += ns.substring(with: NSRange(location: last, length: m.range.location - last))
                let name = ns.substring(with: m.range(at: 1))
                if [",", ";", ":", "!", " "].contains(name) { out += " " } else { out += commands[name] ?? name }
                last = m.range.location + m.range.length
            }
            out += ns.substring(from: last)
            s = out
        }
        s = s.replacingOccurrences(of: "[{}]", with: "", options: .regularExpression)
        // spaced as a kid writes it: `2 x+3=11` → `2x + 3 = 11` (a minus after a relation or an
        // opening bracket is a sign, and keeps to its number)
        let words = s.replacingOccurrences(of: #"\b(?:sin|cos|tan|log|ln)\b"#, with: "", options: .regularExpression)
            .range(of: "[A-Za-z]{2,}", options: .regularExpression) != nil
        if words {
            // prose (a hint's words): its own spacing
            return s.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
        }
        s = s.replacingOccurrences(of: #"\s+"#, with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: "([=<>≤≥≠≈+×÷·→])", with: " $1 ", options: .regularExpression)
        s = s.replacingOccurrences(of: #"(?<=[0-9A-Za-zπ)²³ⁿ])-"#, with: " - ", options: .regularExpression)
        s = s.replacingOccurrences(of: ",", with: ", ")
        s = s.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        return s.trimmingCharacters(in: .whitespaces)
    }

    /// `x^{2}` → `x²` when every character has a raised form; else `x^(…)`.
    static func scripts(_ s: String, marker: Character, table: [Character: Character]) -> String {
        var out = ""
        var chars = Array(s)[...]
        while let c = chars.popFirst() {
            guard c == marker else {
                out.append(c)
                continue
            }
            var body = ""
            if chars.first == "{" {
                chars.removeFirst()
                var depth = 1
                while let d = chars.popFirst() {
                    if d == "{" { depth += 1 }
                    if d == "}" {
                        depth -= 1
                        if depth == 0 { break }
                    }
                    body.append(d)
                }
            } else if let d = chars.popFirst() {
                body = String(d)
            }
            let mapped = body.compactMap { table[$0] }
            if mapped.count == body.count && !body.isEmpty {
                out.append(contentsOf: mapped)
            } else {
                out += "\(marker)(\(body))"
            }
        }
        return out
    }
}
