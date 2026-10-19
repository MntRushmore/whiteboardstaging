import Foundation

/// Reading a line in its page's context (docs/PROBLEM-PAGES.md, "Letters in context"): a kid's `x`
/// read as `×` where no multiplication can be, an `a` read as `0`, an `e` as `6`. The recognizer
/// (`/api/live/recognize`) takes no letters to expect (its `hint` is `math | chem | physics`, for the
/// vision reader's prompt only), so the page's letters are used here, on the read — to ASK the kid
/// ("Is this right?") and to SUGGEST the reading in "Fix what I read". Never to swap a read without a
/// tap (the Mathpix eval, docs/eval/mpx-supernet.md: swapping breaks right reads).
public enum ReadingContext {
    /// What a reader writes for a letter that looks like something else (the eval's misreads: `a` →
    /// `0`, `e` → `6` / `\theta` / `\epsilon` / `\in`, `i` → `;`, `u` → `U`; and the board's own: `x` →
    /// `\times`, `X`, `\chi`). Digits only stand alone here (`0=5`, never the `0` of `10`) when deciding
    /// to ask; a suggestion may try any one place.
    static let lookAlikes: [Character: [String]] = [
        "x": [#"\\times(?![a-zA-Z])"#, #"(?<![\\a-zA-Z])X(?![a-zA-Z])"#, #"\\chi(?![a-zA-Z])"#],
        "a": [#"(?<![0-9.\\a-zA-Z])0(?![0-9.])"#, #"\\alpha(?![a-zA-Z])"#, #"(?<![\\a-zA-Z])o(?![a-zA-Z])"#],
        "e": [#"(?<![0-9.\\a-zA-Z])6(?![0-9.])"#, #"\\(?:theta|epsilon|varepsilon|in)(?![a-zA-Z])"#],
        "i": [#";"#],
        "u": [#"(?<![\\a-zA-Z])U(?![a-zA-Z])"#, #"\\mu(?![a-zA-Z])"#],
        "b": [#"(?<![0-9.\\a-zA-Z])6(?![0-9.])"#],
        "l": [#"(?<![0-9.\\a-zA-Z])1(?![0-9.])"#, #"\|"#],
        "o": [#"(?<![0-9.\\a-zA-Z])0(?![0-9.])"#],
        "z": [#"(?<![0-9.\\a-zA-Z])2(?![0-9.])"#],
        "s": [#"(?<![0-9.\\a-zA-Z])5(?![0-9.])"#],
        "n": [#"\\eta(?![a-zA-Z])"#],
        "w": [#"\\omega(?![a-zA-Z])"#],
        "v": [#"\\nu(?![a-zA-Z])"#],
    ]

    /// The same look-alikes anywhere (a digit inside a number too: `20 - 3` for `2a - 3`), for the
    /// sheet's suggestions only.
    static func anywhere(_ pattern: String) -> String {
        pattern.replacingOccurrences(of: #"(?<![0-9.\\a-zA-Z])"#, with: #"(?<![.\\a-zA-Z])"#)
            .replacingOccurrences(of: #"(?![0-9.])"#, with: #"(?![.])"#)
    }

    /// A reason to ask about this read on a page whose problem uses `letters`: a letter of the
    /// problem missing from the read, and one of its look-alikes in it (standing alone, for a digit);
    /// or a `\times` where no product can be.
    public static func asks(_ latex: String, letters: Set<Character>) -> Bool {
        if correct(latex, letters: letters) != nil { return true }
        let readLetters = Self.letters([latex])
        for letter in letters where !readLetters.contains(letter) {
            for pattern in lookAlikes[letter] ?? [] where latex.range(of: pattern, options: .regularExpression) != nil {
                return true
            }
        }
        return false
    }

    /// Readings the page's letters make likely, best first: the `\times` rule, then each look-alike
    /// of a letter the read lacks, one place at a time.
    public static func suggestions(_ latex: String, letters: Set<Character>) -> [String] {
        var out: [String] = []
        if let c = correct(latex, letters: letters) { out.append(c) }
        let readLetters = Self.letters([latex])
        let ns = latex as NSString
        for letter in letters.sorted() where !readLetters.contains(letter) {
            for pattern in lookAlikes[letter] ?? [] {
                guard let re = try? NSRegularExpression(pattern: anywhere(pattern)) else { continue }
                for m in re.matches(in: latex, range: NSRange(location: 0, length: ns.length)) {
                    let one = ns.replacingCharacters(in: m.range, with: String(letter))
                    if !out.contains(one) { out.append(one) }
                }
            }
        }
        return out
    }
    /// The letters a problem uses as unknowns: single Latin letters outside commands and `\text{…}`
    /// (`2x + 3 = 11` → x; `\frac{a}{b} = 3y` → a, b, y). Empty for arithmetic.
    public static func letters(_ lines: [String]) -> Set<Character> {
        var out = Set<Character>()
        for latex in lines {
            var s = latex.replacingOccurrences(of: #"\\(?:text|mathrm|textrm|textbf|mbox|operatorname)\s*\{[^{}]*\}"#, with: " ", options: .regularExpression)
            s = s.replacingOccurrences(of: #"\\[a-zA-Z]+"#, with: " ", options: .regularExpression)
            for ch in s where ch.isASCII && ch.isLetter { out.insert(ch) }
        }
        return out
    }

    /// The strongest suggestion: what `latex` likely says on a page whose problem uses `letters`, or nil.
    ///
    ///  - a `\times` where no product can be — at the start, after `(`, `=` or another operator,
    ///    before `=`, `+`, `-`, `)`, `^`, a relation or the end (`2 \times + 3 = 11`, `4 \times = 12`,
    ///    `\times^{2}`) — is the page's one letter;
    ///  - `\chi` is `x`, and `X` is `x`, on a page with `x` and no `X`.
    public static func correct(_ latex: String, letters: Set<Character>) -> String? {
        var s = latex
        let hasX = letters.contains("x")
        if hasX && !letters.contains("X") {
            s = s.replacingOccurrences(of: #"\\chi(?![a-zA-Z])"#, with: "x", options: .regularExpression)
            s = replaceUpperX(s)
        }
        if letters.count == 1, let v = letters.first {
            s = replaceLoneTimes(s, with: String(v))
        }
        return s == latex ? nil : s
    }

    /// `X` outside commands and `\text{…}` → `x`.
    static func replaceUpperX(_ latex: String) -> String {
        var out = ""
        var i = latex.startIndex
        while i < latex.endIndex {
            let ch = latex[i]
            if ch == "\\" {
                // a command (`\Xi`, `\text{X}`): copied as it is
                var j = latex.index(after: i)
                while j < latex.endIndex, latex[j].isLetter { j = latex.index(after: j) }
                let name = latex[latex.index(after: i)..<j]
                out += latex[i..<j]
                i = j
                if ["text", "mathrm", "textrm", "textbf", "mbox"].contains(String(name)), i < latex.endIndex, latex[i] == "{",
                   let close = latex[i...].firstIndex(of: "}") {
                    out += latex[i...close]
                    i = latex.index(after: close)
                }
                continue
            }
            out.append(ch == "X" ? "x" : ch)
            i = latex.index(after: i)
        }
        return out
    }

    /// Each `\times` with no product on one side, as the letter `v`.
    static func replaceLoneTimes(_ latex: String, with v: String) -> String {
        guard latex.contains("\\times") else { return latex }
        let ns = latex as NSString
        guard let re = try? NSRegularExpression(pattern: #"\\times(?![a-zA-Z])"#) else { return latex }
        var out = latex
        var replaced = false
        // right to left, so the ranges stay good
        for m in re.matches(in: latex, range: NSRange(location: 0, length: ns.length)).reversed() {
            let before = ns.substring(to: m.range.location).trimmingCharacters(in: .whitespaces)
            let after = ns.substring(from: m.range.location + m.range.length).trimmingCharacters(in: .whitespaces)
            let noLeft = before.isEmpty || endsWithOperator(before)
            let noRight = after.isEmpty || startsWithNonOperand(after)
            guard noLeft || noRight else { continue }
            guard let r = Range(m.range, in: out) else { continue }
            // `2 \times + 3` → `2x + 3`: the letter takes the product's place, next to its coefficient
            out.replaceSubrange(r, with: v)
            replaced = true
        }
        guard replaced else { return latex }
        return out.replacingOccurrences(of: #"(\d)\s+([a-zA-Z])(?![a-zA-Z])"#, with: "$1$2", options: .regularExpression)
    }

    static func endsWithOperator(_ s: String) -> Bool {
        s.range(of: #"(?:[=+\-(<>]|\\(?:times|div|cdot|le|ge|leq|geq|neq|ne)|\\left\()$"#, options: .regularExpression) != nil
    }

    static func startsWithNonOperand(_ s: String) -> Bool {
        s.range(of: #"^(?:[=+\-)<>^]|\\(?:le|ge|leq|geq|neq|ne|right)(?![a-zA-Z]))"#, options: .regularExpression) != nil
    }
}

/// Other readings of a line, for "Fix what I read" (docs/PROBLEM-PAGES.md, "Tap to fix"): the
/// page's context first, then the commonest confusions of a handwritten line, each applied to every
/// such symbol of the read. Unchecked: the loop keeps those the engine reads as maths.
public enum ReadingAlternatives {
    /// A handwriting confusion: what was read, and what it may have been.
    struct Swap {
        let pattern: String
        let replacement: String
        /// the letters this swap reads as something else (a page that uses one keeps it a letter)
        var from: Set<Character> = []
    }

    /// The pairs the doc names: ×↔x, X→x, 1↔l↔|, 5↔s, 2↔z, 0↔o, 9↔g, t→+, b→6.
    static func swaps(letter: String) -> [Swap] {
        [
            Swap(pattern: #"\\times(?![a-zA-Z])"#, replacement: letter),
            // a lone letter x between numbers, read for a product: `2x3`
            Swap(pattern: #"(?<=\d)\s*x\s*(?=\d)"#, replacement: " \\\\times "),
            Swap(pattern: #"(?<![\\a-zA-Z])X(?![a-zA-Z])"#, replacement: "x", from: ["X"]),
            Swap(pattern: #"(?<![\\a-zA-Z])[l|I](?![a-zA-Z])"#, replacement: "1", from: ["l", "I"]),
            Swap(pattern: #"(?<![\\a-zA-Z0-9])1(?![0-9])"#, replacement: "l", from: []),
            Swap(pattern: #"(?<![\\a-zA-Z])[sS](?![a-zA-Z])"#, replacement: "5", from: ["s", "S"]),
            Swap(pattern: #"(?<![\\a-zA-Z])[zZ](?![a-zA-Z])"#, replacement: "2", from: ["z", "Z"]),
            Swap(pattern: #"(?<![\\a-zA-Z])[oO](?![a-zA-Z])"#, replacement: "0", from: ["o", "O"]),
            Swap(pattern: #"(?<![\\a-zA-Z])g(?![a-zA-Z])"#, replacement: "9", from: ["g"]),
            Swap(pattern: #"(?<![\\a-zA-Z])t(?![a-zA-Z])"#, replacement: "+", from: ["t"]),
            Swap(pattern: #"(?<![\\a-zA-Z])b(?![a-zA-Z])"#, replacement: "6", from: ["b"]),
        ]
    }

    /// Readings other than `latex`, best first, at most `limit`: `prior` (the second opinion's read,
    /// when it disagreed), the page's context, `also` (the second reader's), then one swap at a time
    /// (letters the page uses are kept as letters: on an `s` page an `s` stays).
    public static func candidates(_ latex: String, letters: Set<Character>, prior: [String] = [], also extra: [String] = [], limit: Int = 6) -> [String] {
        var out: [String] = []
        func add(_ c: String) {
            let t = c.trimmingCharacters(in: .whitespaces)
            guard !t.isEmpty, flat(t) != flat(latex), !out.contains(where: { flat($0) == flat(t) }) else { return }
            out.append(t)
        }
        prior.forEach(add)
        ReadingContext.suggestions(latex, letters: letters).forEach(add)
        extra.forEach(add)
        let letter = letters.count == 1 ? String(letters.first!) : (letters.contains("x") || letters.isEmpty ? "x" : String(letters.sorted().first!))
        for swap in swaps(letter: letter) {
            // a letter the page's problem uses is a letter here too; `1` → `l` only on a page with an l
            if !swap.from.isDisjoint(with: letters) { continue }
            if swap.replacement == "l" && !letters.contains("l") { continue }
            let replaced = latex.replacingOccurrences(of: swap.pattern, with: swap.replacement, options: .regularExpression)
            if replaced != latex { add(replaced) }
        }
        return Array(out.prefix(limit))
    }

    static func flat(_ latex: String) -> String {
        latex.replacingOccurrences(of: #"\s+"#, with: "", options: .regularExpression)
    }
}

/// What a kid types on the maths keypad, as LaTeX (docs/PROBLEM-PAGES.md, "Or type it"): plain
/// maths in, the board's LaTeX out. `×` → `\times`, `÷` → `\div`, `−` → `-`, `a/b` → `\frac{a}{b}`
/// (numbers, letters or a bracket on each side), `^2` or `²` → `^{2}`, `√16` / `√(x+1)` →
/// `\sqrt{16}` / `\sqrt{x+1}`.
public enum PlainMath {
    public static func latex(_ plain: String) -> String {
        var s = plain
            .replacingOccurrences(of: "×", with: " \\times ")
            .replacingOccurrences(of: "÷", with: " \\div ")
            .replacingOccurrences(of: "−", with: "-")
            .replacingOccurrences(of: "²", with: "^2")
            .replacingOccurrences(of: "³", with: "^3")
        // √( … ) and √n
        s = replaceAll(s, #"√\s*\(([^()]*)\)"#) { "\\sqrt{\($0[1])}" }
        s = replaceAll(s, #"√\s*([0-9a-zA-Z.]+)"#) { "\\sqrt{\($0[1])}" }
        // powers: ^n, ^(…)
        s = replaceAll(s, #"\^\s*\(([^()]*)\)"#) { "^{\($0[1])}" }
        s = replaceAll(s, #"\^\s*(-?[0-9a-zA-Z.]+)"#) { "^{\($0[1])}" }
        // fractions: (…)/(…), and a number or letter run on either side
        let side = #"(\([^()]*\)|[0-9.]+[a-zA-Z]?|[a-zA-Z])"#
        s = replaceAll(s, side + #"\s*/\s*"# + side) { m in "\\frac{\(unbracket(m[1]))}{\(unbracket(m[2]))}" }
        // tidy spaces: one around relations and + / -, none elsewhere doubled
        s = s.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
        return s
    }

    /// The keypad's own view of a LaTeX line, for editing a reading (`MathText.plain` with the
    /// keypad's symbols).
    public static func plain(_ latex: String) -> String {
        MathText.plain(latex)
    }

    static func unbracket(_ s: String) -> String {
        s.hasPrefix("(") && s.hasSuffix(")") ? String(s.dropFirst().dropLast()) : s
    }

    static func replaceAll(_ s: String, _ pattern: String, _ make: ([String]) -> String) -> String {
        guard let re = try? NSRegularExpression(pattern: pattern) else { return s }
        var out = s
        // until nothing matches (nested fractions are not a keypad thing; a few passes are plenty)
        for _ in 0..<4 {
            let ns = out as NSString
            let found = re.matches(in: out, range: NSRange(location: 0, length: ns.length))
            guard !found.isEmpty else { break }
            for m in found.reversed() {
                let groups = (0..<m.numberOfRanges).map { m.range(at: $0).location == NSNotFound ? "" : ns.substring(with: m.range(at: $0)) }
                out = (out as NSString).replacingCharacters(in: m.range, with: make(groups))
            }
        }
        return out
    }
}
