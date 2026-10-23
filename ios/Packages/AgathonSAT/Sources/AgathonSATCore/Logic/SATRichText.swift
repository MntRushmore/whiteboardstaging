import Foundation

/// A stem, a choice or a solution step as the panel shows it: Markdown-lite (paragraphs, `**bold**`,
/// `-` lists) with inline `$…$` and display `$$…$$` LaTeX (docs/SAT-MODE.md: "Plain enough for
/// SwiftMath"). Parsed here, drawn by AgathonSAT's `SATText` (SwiftMath for the maths).
///
/// A `$` with no partner is a dollar sign, and so is `\$` ("It costs \$12."), so prices never turn
/// into maths.
public indirect enum SATInline: Hashable, Sendable {
    case text(String)
    case bold([SATInline])
    case math(String)
}

public enum SATBlock: Hashable, Sendable {
    case paragraph([SATInline])
    /// display maths, on a line of its own
    case math(String)
    case bullets([[SATInline]])
}

public enum SATRichText {
    /// Longer than this between `$`s is not one formula.
    static let maxMath = 400

    public static func parse(_ source: String) -> [SATBlock] {
        let text = source.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\\$", with: "\u{E000}")
        var blocks: [SATBlock] = []
        for chunk in paragraphs(text) {
            let lines = chunk.components(separatedBy: "\n")
            if lines.allSatisfy({ $0.trimmingCharacters(in: .whitespaces).range(of: #"^[-*•]\s+"#, options: .regularExpression) != nil }) {
                let items = lines.map { line in
                    inline(line.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: #"^[-*•]\s+"#, with: "", options: .regularExpression))
                }
                blocks.append(.bullets(items))
                continue
            }
            // display maths inside a paragraph splits it: text, the maths on its own line, text
            for piece in splitDisplay(lines.joined(separator: " ")) {
                switch piece {
                case .math(let m): blocks.append(.math(m))
                case .text(let t):
                    let trimmed = t.trimmingCharacters(in: .whitespaces)
                    if !trimmed.isEmpty { blocks.append(.paragraph(inline(trimmed))) }
                case .bold: break
                }
            }
        }
        return blocks
    }

    /// Blank lines separate paragraphs (a `$$` block left open runs on).
    static func paragraphs(_ text: String) -> [String] {
        var out: [String] = []
        var cur: [String] = []
        for line in text.components(separatedBy: "\n") {
            if line.trimmingCharacters(in: .whitespaces).isEmpty && countDisplay(cur.joined(separator: "\n")) % 2 == 0 {
                if !cur.isEmpty { out.append(cur.joined(separator: "\n")) }
                cur = []
            } else {
                cur.append(line)
            }
        }
        if !cur.isEmpty { out.append(cur.joined(separator: "\n")) }
        return out
    }

    static func countDisplay(_ s: String) -> Int {
        s.components(separatedBy: "$$").count - 1
    }

    /// Text and `$$…$$` display maths, in order (an unclosed `$$` stays text).
    static func splitDisplay(_ s: String) -> [SATInline] {
        var out: [SATInline] = []
        var rest = Substring(s)
        while let open = rest.range(of: "$$") {
            guard let close = rest[open.upperBound...].range(of: "$$") else { break }
            let before = String(rest[..<open.lowerBound])
            let body = rest[open.upperBound..<close.lowerBound].trimmingCharacters(in: .whitespacesAndNewlines)
            if !before.isEmpty { out.append(.text(before)) }
            if !body.isEmpty { out.append(.math(restore(body))) }
            rest = rest[close.upperBound...]
        }
        if !rest.isEmpty { out.append(.text(String(rest))) }
        return out
    }

    /// One line's inline parts: `**bold**`, `$maths$`, text.
    public static func inline(_ s: String) -> [SATInline] {
        var out: [SATInline] = []
        var text = ""
        let chars = Array(s)
        var i = 0
        func flush() {
            if !text.isEmpty { out.append(.text(restore(text))) }
            text = ""
        }
        while i < chars.count {
            let c = chars[i]
            if c == "*", i + 1 < chars.count, chars[i + 1] == "*", let end = find("**", in: chars, from: i + 2) {
                flush()
                out.append(.bold(inline(String(chars[(i + 2)..<end]))))
                i = end + 2
                continue
            }
            if c == "$", let end = find("$", in: chars, from: i + 1), end > i + 1, end - i - 1 <= maxMath {
                let body = String(chars[(i + 1)..<end])
                // "$5 and $3": a "formula" that starts with a number and ends before a space is money
                let money = body.first?.isNumber == true && body.hasSuffix(" ")
                if !money {
                    flush()
                    out.append(.math(restore(body.trimmingCharacters(in: .whitespaces))))
                    i = end + 1
                    continue
                }
            }
            text.append(c)
            i += 1
        }
        flush()
        return out
    }

    static func find(_ token: String, in chars: [Character], from start: Int) -> Int? {
        let t = Array(token)
        var i = start
        while i + t.count <= chars.count {
            if chars[i] == "\\" && t != ["\\"] {
                i += 2
                continue
            }
            if Array(chars[i..<(i + t.count)]) == t { return i }
            i += 1
        }
        return nil
    }

    /// `\$` back to a dollar sign.
    static func restore(_ s: String) -> String {
        s.replacingOccurrences(of: "\u{E000}", with: "$")
    }

    // MARK: - plain words

    /// The text with its maths as words a screen reader can say ("x squared plus 1").
    public static func plain(_ source: String) -> String {
        parse(source).map { block -> String in
            switch block {
            case .paragraph(let nodes): plain(nodes)
            case .math(let m): SATMathWords.spoken(m)
            case .bullets(let items): items.map(plain).joined(separator: ". ")
            }
        }.joined(separator: " ")
    }

    static func plain(_ nodes: [SATInline]) -> String {
        nodes.map { n -> String in
            switch n {
            case .text(let t): t
            case .bold(let c): plain(c)
            case .math(let m): SATMathWords.spoken(m)
            }
        }.joined()
    }

    /// Every piece of maths in the text, in order.
    public static func maths(_ source: String) -> [String] {
        var out: [String] = []
        func walk(_ nodes: [SATInline]) {
            for n in nodes {
                switch n {
                case .math(let m): out.append(m)
                case .bold(let c): walk(c)
                case .text: break
                }
            }
        }
        for block in parse(source) {
            switch block {
            case .paragraph(let nodes): walk(nodes)
            case .math(let m): out.append(m)
            case .bullets(let items): items.forEach(walk)
            }
        }
        return out
    }
}

/// LaTeX as words (VoiceOver) or as plain text (a fallback when SwiftMath can't set it).
public enum SATMathWords {
    /// `\frac{3}{4}` → 3/4, `\le` → ≤, `x^{2}` → x²: plain text that reads like the maths.
    public static func plain(_ latex: String) -> String {
        var s = latex
        let frac = try? NSRegularExpression(pattern: #"\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}"#)
        for _ in 0..<6 {
            guard let frac else { break }
            let next = frac.stringByReplacingMatches(in: s, range: NSRange(s.startIndex..., in: s), withTemplate: "($1)/($2)")
            if next == s { break }
            s = next
        }
        s = s.replacingOccurrences(of: #"\(([0-9a-zA-Z.]+)\)/\(([0-9a-zA-Z.]+)\)"#, with: "$1/$2", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\\sqrt\s*\{([^{}]*)\}"#, with: "√($1)", options: .regularExpression)
        let words: [(String, String)] = [
            (#"\left"#, ""), (#"\right"#, ""), (#"\cdot"#, "·"), (#"\times"#, "×"), (#"\div"#, "÷"), (#"\pm"#, "±"),
            (#"\leq"#, "≤"), (#"\geq"#, "≥"), (#"\le"#, "≤"), (#"\ge"#, "≥"), (#"\neq"#, "≠"), (#"\ne"#, "≠"),
            (#"\pi"#, "π"), (#"\theta"#, "θ"), (#"^{\circ}"#, "°"), (#"^\circ"#, "°"), (#"\circ"#, "°"), (#"\angle"#, "∠"),
            (#"\triangle"#, "△"), (#"\overline"#, ""), (#"\sin"#, "sin"), (#"\cos"#, "cos"), (#"\tan"#, "tan"),
            (#"\%"#, "%"), (#"\,"#, " "), (#"\;"#, " "), (#"\!"#, ""), (#"\ "#, " "), (#"\text"#, ""), (#"\mathrm"#, ""),
        ]
        for (from, to) in words { s = s.replacingOccurrences(of: from, with: to) }
        let sup: [Character: Character] = ["0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻", "n": "ⁿ", "x": "ˣ"]
        if let power = try? NSRegularExpression(pattern: #"\^\{([0-9nx\-]+)\}|\^([0-9nx])"#) {
            let ns = s as NSString
            var out = ""
            var last = 0
            for m in power.matches(in: s, range: NSRange(location: 0, length: ns.length)) {
                out += ns.substring(with: NSRange(location: last, length: m.range.location - last))
                let g = m.range(at: 1).location != NSNotFound ? m.range(at: 1) : m.range(at: 2)
                out += String(ns.substring(with: g).map { sup[$0] ?? $0 })
                last = m.range.location + m.range.length
            }
            out += ns.substring(from: last)
            s = out
        }
        s = s.replacingOccurrences(of: "{", with: "").replacingOccurrences(of: "}", with: "").replacingOccurrences(of: "\\", with: "")
        return s.replacingOccurrences(of: #"(?<=[0-9a-zA-Z)²³])\s*-\s*(?=[0-9a-zA-Z(√])"#, with: " − ", options: .regularExpression)
    }

    /// The maths as VoiceOver says it.
    public static func spoken(_ latex: String) -> String {
        plain(latex)
            .replacingOccurrences(of: "²", with: " squared")
            .replacingOccurrences(of: "³", with: " cubed")
            .replacingOccurrences(of: "≤", with: " is at most ")
            .replacingOccurrences(of: "≥", with: " is at least ")
            .replacingOccurrences(of: "<", with: " is less than ")
            .replacingOccurrences(of: ">", with: " is greater than ")
            .replacingOccurrences(of: "=", with: " equals ")
            .replacingOccurrences(of: "−", with: " minus ")
            .replacingOccurrences(of: "×", with: " times ")
            .replacingOccurrences(of: "·", with: " times ")
            .replacingOccurrences(of: "√", with: "the square root of ")
            .replacingOccurrences(of: "  ", with: " ")
            .trimmingCharacters(in: .whitespaces)
    }
}

/// The page's problem for the tutor: the relations a stem states (`3x + 5 = 20`, a system's two
/// equations, `f(x) = 2x - 7`), as the lines the live tutor judges the student's ink against. A stem
/// with none (a word problem, a table, a figure) gives none: the student's own first line heads
/// their work, as on a page of their own homework (docs/PROBLEM-PAGES.md, "Word problems").
public enum SATStemMath {
    /// At most this many lines (a system is two; three is a stem with a given and a system).
    public static let maxLines = 3

    public static func problemLines(_ stem: String) -> [String] {
        var out: [String] = []
        for m in SATRichText.maths(stem) {
            let t = m.trimmingCharacters(in: .whitespaces)
            guard isRelation(t), !t.contains(#"\text"#), !isGiven(t), !out.contains(t) else { continue }
            out.append(t)
            if out.count == maxLines { break }
        }
        return out
    }

    /// An equation or inequality with a letter in it.
    static func isRelation(_ t: String) -> Bool {
        let relation = t.contains("=") || t.contains("<") || t.contains(">") || t.contains(#"\le"#) || t.contains(#"\ge"#)
            || t.contains(#"\lt"#) || t.contains(#"\gt"#)
        let letters = t.replacingOccurrences(of: #"\\[a-zA-Z]+"#, with: "", options: .regularExpression)
        return relation && letters.range(of: "[a-zA-Z]", options: .regularExpression) != nil
    }

    /// A value given for a letter (`x = 3`, `k = -2`): context, not a problem to solve.
    static func isGiven(_ t: String) -> Bool {
        t.range(of: #"^[a-zA-Z]\s*=\s*-?\s*[0-9.]+$"#, options: .regularExpression) != nil
    }
}
