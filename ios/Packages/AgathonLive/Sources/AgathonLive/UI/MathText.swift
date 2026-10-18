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

    public static func plain(_ latex: String) -> String {
        var s = latex
        // \text{…} and friends: their words
        s = s.replacingOccurrences(of: #"\\(?:text|textrm|mathrm|mbox|operatorname)\s*\{([^{}]*)\}"#, with: "$1", options: .regularExpression)
        // fractions, innermost first
        for _ in 0..<6 {
            let next = s.replacingOccurrences(of: #"\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}"#, with: "$1/$2", options: .regularExpression)
            if next == s { break }
            s = next
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
