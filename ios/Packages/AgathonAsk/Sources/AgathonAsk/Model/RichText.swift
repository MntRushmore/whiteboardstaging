import Foundation

/// The tutor's reply as the panel shows it (src/lib/live/ask/richText.ts, ported line for line):
/// Markdown-lite — paragraphs, `**bold**`, `-` and `1.` lists, `$…$` inline and `$$…$$` display
/// maths — parsed into a small tree the panel renders with SwiftMath for the maths.
///
/// Robust to a reply still streaming: anything unclosed stays text until it closes. A `$` with no
/// partner is a dollar sign ("I have $5 and $3"). Only `**` is kinder while streaming: an opened
/// bold makes the rest bold, so the kid never sees the asterisks flash.
public indirect enum RichInline: Hashable, Sendable {
    case text(String)
    case bold([RichInline])
    case math(String, display: Bool)
    case br
}

public enum RichBlock: Hashable, Sendable {
    case paragraph([RichInline])
    case bullets([[RichInline]])
    case numbered(start: Int, items: [[RichInline]])
    case math(String)
}

public enum RichText {
    /// Longer than this between `$`s is not one formula.
    static let maxMath = 600

    public static func parse(_ src: String, streaming: Bool = false) -> [RichBlock] {
        let text = src.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        var blocks: [RichBlock] = []
        var para: [String] = []
        var list: (ul: Bool, start: Int, items: [String])?

        func flushPara() {
            let joined = para.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            para = []
            if joined.isEmpty { return }
            if let body = wholeDisplay(joined), !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, body.count <= maxMath {
                blocks.append(.math(body.trimmingCharacters(in: .whitespacesAndNewlines)))
                return
            }
            let c = trimBreaks(parseInline(joined, streaming: streaming))
            if !c.isEmpty { blocks.append(.paragraph(c)) }
        }
        func flushList() {
            guard let l = list else { return }
            let items = l.items.map { trimBreaks(parseInline($0.trimmingCharacters(in: .whitespacesAndNewlines), streaming: streaming)) }.filter { !$0.isEmpty }
            if !items.isEmpty { blocks.append(l.ul ? .bullets(items) : .numbered(start: l.start, items: items)) }
            list = nil
        }

        var openDisplay = false
        for line in text.components(separatedBy: "\n") {
            if line.trimmingCharacters(in: .whitespaces).isEmpty {
                if openDisplay {
                    para.append(line)
                    continue
                }
                flushPara()
                flushList()
                continue
            }
            if !openDisplay {
                let bullet = match(line, #"^\s{0,3}[-*•]\s+(.*)$"#)
                let numbered = bullet == nil ? match(line, #"^\s{0,3}(\d{1,3})[.)]\s+(.*)$"#) : nil
                if bullet != nil || numbered != nil {
                    flushPara()
                    let ul = bullet != nil
                    if list == nil || list!.ul != ul {
                        flushList()
                        list = (ul, numbered.flatMap { Int($0[0]) } ?? 1, [])
                    }
                    list!.items.append(bullet?[0] ?? numbered![1])
                    openDisplay = countDisplay(list!.items.last!) % 2 == 1
                    continue
                }
                if list != nil, line.range(of: #"^\s{2,}\S"#, options: .regularExpression) != nil {
                    list!.items[list!.items.count - 1] += " " + line.trimmingCharacters(in: .whitespaces)
                    openDisplay = countDisplay(list!.items.last!) % 2 == 1
                    continue
                }
                if line.range(of: #"^\s{0,3}([-*_])(\s*\1){2,}\s*$"#, options: .regularExpression) != nil {
                    flushPara()
                    flushList()
                    continue
                }
                if let heading = match(line, #"^\s{0,3}#{1,6}\s+(.*)$"#) {
                    flushPara()
                    flushList()
                    para.append("**\(heading[0].replacingOccurrences(of: "**", with: ""))**")
                    flushPara()
                    continue
                }
            }
            if list != nil && !openDisplay { flushList() }
            if list != nil && openDisplay {
                list!.items[list!.items.count - 1] += "\n" + line
                openDisplay = countDisplay(list!.items.last!) % 2 == 1
                continue
            }
            para.append(line)
            openDisplay = countDisplay(para.joined(separator: "\n")) % 2 == 1
        }
        flushPara()
        flushList()
        return blocks
    }

    /// A paragraph that is one closed `$$…$$` (or `\[…\]`): its body.
    static func wholeDisplay(_ s: String) -> String? {
        if let m = match(s, #"^\$\$([\s\S]+?)\$\$$"#) { return m[0] }
        if let m = match(s, #"^\\\[([\s\S]+?)\\\]$"#) { return m[0] }
        return nil
    }

    /// The capture groups of `pattern`'s first match (whole string semantics are the pattern's).
    static func match(_ s: String, _ pattern: String) -> [String]? {
        guard let re = try? NSRegularExpression(pattern: pattern), let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) else { return nil }
        return (1..<m.numberOfRanges).map { i in
            Range(m.range(at: i), in: s).map { String(s[$0]) } ?? ""
        }
    }

    static func countDisplay(_ s: String) -> Int {
        let c = Array(s)
        var n = 0
        var i = 0
        while i < c.count - 1 {
            if c[i] == "\\" {
                i += 2
                continue
            }
            if c[i] == "$" && c[i + 1] == "$" {
                n += 1
                i += 2
                continue
            }
            i += 1
        }
        return n
    }

    static func trimBreaks(_ nodes: [RichInline]) -> [RichInline] {
        var out: [RichInline] = []
        for (i, n) in nodes.enumerated() {
            if case .br = n {
                let prev = out.last
                let next = i + 1 < nodes.count ? nodes[i + 1] : nil
                if prev == nil || next == nil { continue }
                if case .math(_, true) = prev! { continue }
                if case .math(_, true) = next! { continue }
            }
            out.append(n)
        }
        return out
    }

    /// One paragraph's inline marks. `$…$` opens only on a `$` followed by a non-space and closes on
    /// one preceded by a non-space and not followed by a digit (Pandoc's rule), so prices stay prices.
    public static func parseInline(_ src: String, streaming: Bool = false) -> [RichInline] {
        let s = Array(src)
        var out: [RichInline] = []
        var buf = ""
        func flush() {
            guard !buf.isEmpty else { return }
            let parts = buf.components(separatedBy: "\n")
            for (i, p) in parts.enumerated() {
                if i > 0 { out.append(.br) }
                if !p.isEmpty { out.append(.text(p)) }
            }
            buf = ""
        }
        func str(_ a: Int, _ b: Int) -> String { String(s[a..<b]) }

        var i = 0
        while i < s.count {
            let ch = s[i]
            let next: Character? = i + 1 < s.count ? s[i + 1] : nil
            if ch == "\\", next == "$" || next == "*" {
                buf.append(next!)
                i += 2
                continue
            }
            if ch == "\\", next == "(" || next == "[" {
                let close: [Character] = next == "(" ? ["\\", ")"] : ["\\", "]"]
                let end = find(s, close, from: i + 2)
                let body = end.map { str(i + 2, $0) } ?? ""
                if let end, !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, body.count <= maxMath {
                    flush()
                    out.append(.math(body.trimmingCharacters(in: .whitespacesAndNewlines), display: next == "["))
                    i = end + 2
                    continue
                }
                buf.append(ch)
                i += 1
                continue
            }
            if ch == "$", next == "$" {
                let end = displayClose(s, from: i + 2)
                let body = end.map { str(i + 2, $0) } ?? ""
                if let end, !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, body.count <= maxMath {
                    flush()
                    out.append(.math(body.trimmingCharacters(in: .whitespacesAndNewlines), display: true))
                    i = end + 2
                    continue
                }
                buf += "$$"
                i += 2
                continue
            }
            if ch == "$" {
                let end = next.map { !$0.isWhitespace } == true ? inlineClose(s, from: i + 1) : nil
                if let end {
                    flush()
                    out.append(.math(str(i + 1, end), display: false))
                    i = end + 1
                    continue
                }
                buf += "$"
                i += 1
                continue
            }
            if ch == "*", next == "*" {
                if let end = find(s, ["*", "*"], from: i + 2), end > i + 2 {
                    let inner = parseInline(str(i + 2, end), streaming: streaming)
                    flush()
                    if !inner.isEmpty { out.append(.bold(inner)) }
                    i = end + 2
                    continue
                }
                if streaming {
                    let inner = parseInline(str(i + 2, s.count), streaming: streaming)
                    flush()
                    if !inner.isEmpty { out.append(.bold(inner)) }
                    i = s.count
                    continue
                }
                buf += "**"
                i += 2
                continue
            }
            buf.append(ch)
            i += 1
        }
        flush()
        return out
    }

    static func find(_ s: [Character], _ needle: [Character], from: Int) -> Int? {
        guard needle.count > 0, from <= s.count - needle.count else { return nil }
        var j = from
        while j <= s.count - needle.count {
            if Array(s[j..<(j + needle.count)]) == needle { return j }
            j += 1
        }
        return nil
    }

    static func displayClose(_ s: [Character], from: Int) -> Int? {
        var j = from
        while j < s.count - 1 {
            if s[j] == "\\" {
                j += 2
                continue
            }
            if s[j] == "$" && s[j + 1] == "$" { return j }
            j += 1
        }
        return nil
    }

    /// Only the NEXT dollar can close an inline formula: when it cannot, the opener was a price.
    static func inlineClose(_ s: [Character], from: Int) -> Int? {
        var j = from
        while j < s.count && j - from <= maxMath {
            let c = s[j]
            if c == "\\" {
                j += 2
                continue
            }
            if c != "$" {
                j += 1
                continue
            }
            let before = s[j - 1]
            let after: Character? = j + 1 < s.count ? s[j + 1] : nil
            if after == "$" || j == from || before.isWhitespace || (after?.isNumber == true && after?.isASCII == true) { return nil }
            return j
        }
        return nil
    }

    /// The reply's words without marks: maths as its source, or (`readable`, for VoiceOver) as plain
    /// words and symbols.
    public static func plainText(_ blocks: [RichBlock], readable: Bool = false) -> String {
        func inline(_ nodes: [RichInline]) -> String {
            nodes.map { n -> String in
                switch n {
                case .text(let v): return v
                case .bold(let c): return inline(c)
                case .math(let v, _): return readable ? mathAsText(v) : v
                case .br: return "\n"
                }
            }.joined()
        }
        return blocks.map { b -> String in
            switch b {
            case .paragraph(let c): return inline(c)
            case .math(let v): return readable ? mathAsText(v) : v
            case .bullets(let items): return items.map { "- " + inline($0) }.joined(separator: "\n")
            case .numbered(let start, let items): return items.enumerated().map { "\(start + $0.offset). " + inline($0.element) }.joined(separator: "\n")
            }
        }.joined(separator: "\n\n")
    }

    /// A formula as plain words and symbols (`mathAsText`): `\frac{3}{4}` reads 3/4, `x^2` x².
    public static func mathAsText(_ src: String) -> String {
        let rules: [(String, String)] = [
            (#"\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}"#, "$1/$2"),
            (#"\\sqrt\{([^{}]*)\}"#, "√($1)"),
            (#"\^\{?\\circ\}?|\\degree"#, "°"),
            (#"\^\{?2\}?"#, "²"),
            (#"\^\{?3\}?"#, "³"),
            (#"\\times"#, "×"),
            (#"\\div"#, "÷"),
            (#"\\c?dots?\b"#, "·"),
            (#"\\pm"#, "±"),
            (#"\\leq?\b"#, "≤"),
            (#"\\geq?\b"#, "≥"),
            (#"\\neq?\b"#, "≠"),
            (#"\\approx"#, "≈"),
            (#"\\pi\b"#, "π"),
            (#"\\(?:text|mathrm|mathbf|operatorname)\{([^{}]*)\}"#, "$1"),
            (#"\\(?:left|right)\b"#, ""),
            (#"\\[,;:! ]"#, " "),
            (#"\\([a-zA-Z]+)"#, "$1"),
            (#"[{}]"#, ""),
            (#"\s+"#, " "),
        ]
        var s = src
        for (p, t) in rules { s = s.replacingOccurrences(of: p, with: t, options: .regularExpression) }
        return s.trimmingCharacters(in: .whitespaces)
    }

    public static func hasMath(_ blocks: [RichBlock]) -> Bool {
        func inline(_ nodes: [RichInline]) -> Bool {
            nodes.contains { n in
                switch n {
                case .math: return true
                case .bold(let c): return inline(c)
                default: return false
                }
            }
        }
        return blocks.contains { b in
            switch b {
            case .math: return true
            case .paragraph(let c): return inline(c)
            case .bullets(let items), .numbered(_, let items): return items.contains(where: inline)
            }
        }
    }
}
