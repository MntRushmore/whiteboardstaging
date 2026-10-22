import AgathonBrain
import Foundation

/// The second reader: WHEN to ask a vision model to read a line again, and WHETHER to believe it
/// (src/lib/live/readCheck.ts). Mathpix misreads about 3 % of lines, and its confidence is no
/// guide; a re-read costs ink and can break a right read, so it is asked only on a signal:
///
///  - `low-confidence`: Mathpix was unsure, so the board would show nothing;
///  - `unreadable`: the engine cannot make sense of a line that looks like maths;
///  - `suspicious`: a symbol Mathpix produces for a stray stroke far more often than a kid means it
///    (a Greek letter nothing else in the column uses, an `o` glued to digits, a zero denominator,
///    `0 = 5`).
///
/// The web has more suspicious-read rules (letter case, stray letters) and the "chain" re-read before
/// a ring; those are not here yet.
public enum ReadCheck {
    static let greek: Set<String> = [
        "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta",
        "iota", "kappa", "lambda", "mu", "nu", "xi", "omicron", "rho", "varrho", "sigma", "varsigma",
        "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega",
        "Gamma", "Delta", "Theta", "Lambda", "Xi", "Sigma", "Upsilon", "Phi", "Psi", "Omega",
    ]
    static let oddCommands: Set<String> = ["in", "ni", "notin", "ell", "wp", "aleph", "hbar", "imath", "jmath", "mho", "eth"]
    static let trig = #"\\(?:sin|cos|tan|sec|csc|cot|arcsin|arccos|arctan)(?![a-zA-Z])"#
    static let refused = #"\\(?:int|iint|oint|lim|sum|prod|begin|binom)(?![a-zA-Z])|'|\\prime"#

    /// The line with prose, units and spacing taken out.
    static func mathOnly(_ latex: String) -> String {
        var s = latex.replacingOccurrences(of: #"\\(?:text|textrm|textbf|textit|textsf|mbox)\s*\{([^{}]*)\}"#, with: " ", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\\(?:mathrm|operatorname|mathbf|mathit)\s*\{[^{}]*\}"#, with: " ", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\\(?:left|right)(?![a-zA-Z])"#, with: "", options: .regularExpression)
        return s.replacingOccurrences(of: #"\\[,;:! ]|~"#, with: " ", options: .regularExpression)
    }

    static func bareMath(_ latex: String) -> String {
        mathOnly(latex).replacingOccurrences(of: #"\\[a-zA-Z]+"#, with: " # ", options: .regularExpression)
    }

    static func commands(_ latex: String) -> Set<String> {
        Set(LivePolicy.matches(#"\\([a-zA-Z]+)"#, in: mathOnly(latex), group: 1))
    }

    static func has(_ pattern: String, _ s: String) -> Bool { s.range(of: pattern, options: .regularExpression) != nil }

    /// A read that looks wrong in its column, or nil (a subset of the web's `suspiciousRead`).
    public static func suspicious(_ latex: String, others: [String]) -> String? {
        let line = latex.trimmingCharacters(in: .whitespaces)
        guard !line.isEmpty, !LivePolicy.isProse(line) else { return nil }
        let column = others.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty && !LivePolicy.isProse($0) }
        let otherCommands = column.reduce(into: Set<String>()) { $0.formUnion(commands($1)) }
        let isTrig = has(trig, line) || column.contains { has(trig, $0) }
        for name in commands(line) where greek.contains(name) || oddCommands.contains(name) {
            if otherCommands.contains(name) { continue }
            if isTrig && (name == "theta" || name == "vartheta") { continue }
            if name == "in" && has(#"\\in\s*(?:\\mathbb|\\left|\\\{|[(\[])"#, line) { continue }
            return "odd-symbol"
        }
        let bare = bareMath(line)
        if has(#"\d\s*[oO](?![a-zA-Z])|(?<![a-zA-Z])[oO]\s*\d"#, bare) { return "digit-letter" }
        if has(#"\\frac\s*\{[^{}]*\}\s*\{\s*0\s*\}"#, line) { return "zero-denominator" }
        // a fraction read without its top: `\bar{2}`, `\overline{3}`, `\frac{}{6}` (`\frac{1}{2} = \frac{3}{6}`
        // re-read `\bar{2}=\bar{6}`, judged 2 = 6 and ringed)
        if has(#"(?<![\d.]|[\d.]\s)\\(?:bar|overline)\s*\{\s*\d+\s*\}|\\frac\s*\{\s*\}"#, line) { return "lost-numerator" }
        let sides = mathOnly(line).trimmingCharacters(in: .whitespaces).split(separator: "=", omittingEmptySubsequences: false)
        if sides.count == 2, !has(#"<|>|\\(?:le|ge|leq|geq|neq|ne|approx)(?![a-zA-Z])"#, line) {
            let a = sides[0].trimmingCharacters(in: .whitespaces), b = sides[1].trimmingCharacters(in: .whitespaces)
            if let x = Double(a), let y = Double(b), x != y, has(#"^\d$"#, a) || has(#"^\d$"#, b) { return "false-number" }
        }
        return nil
    }

    /// Enough ink and enough symbols to be a line of maths rather than a mark.
    static func looksLikeMaths(_ latex: String, strokeCount: Int) -> Bool {
        guard strokeCount >= 2, !LivePolicy.isSingleSymbolLatex(latex) else { return false }
        return LivePolicy.matches(#"[A-Za-z0-9=+\-<>^/]"#, in: bareMath(latex)).count >= 2
    }

    /// Should this read go to the second reader? The reason, or nil.
    public static func trigger(latex: String, confidence: Double, analysis: LineAnalysis?, strokeCount: Int, others: [String]) -> String? {
        let l = latex.trimmingCharacters(in: .whitespaces)
        guard !l.isEmpty else { return nil }
        if analysis?.kind == "text" || analysis?.kind == "label" || LivePolicy.isProse(l) { return nil }
        guard looksLikeMaths(l, strokeCount: strokeCount) else { return nil }
        if confidence < LiveLimits.minConfidence { return "low-confidence" }
        let unknown = analysis == nil || analysis?.kind == "unknown"
        if unknown && !has(refused, l) && !l.contains("?") { return "unreadable" }
        return suspicious(l, others: others)
    }

    /// Words on the board (prose, or a run of four letters that is no command).
    static func hasWords(_ latex: String) -> Bool {
        let s = latex.replacingOccurrences(of: #"\\(?:text|textrm|mbox)\s*\{\s*(?:of|to)\s*\}"#, with: " ", options: .regularExpression)
        if has(#"\\(?:text|textrm|textbf|textit|textsf|mbox)\s*\{[^{}]*[A-Za-z]"#, s) { return true }
        return has("[A-Za-z]{4,}", bareMath(s))
    }

    static func comparable(_ s: String) -> String {
        s.replacingOccurrences(of: #"\\(?:left|right)(?![a-zA-Z])|\\[,;:! ]|~|\s|[{}]"#, with: "", options: .regularExpression)
    }

    /// The second reader's read, when it should replace Mathpix's (the engine's say comes after:
    /// the caller checks `reads`): it differs, has no words, is a transcription of the same line
    /// (half to double the length), and does not itself look misread.
    public static func candidate(mathpix: String, reread: String, others: [String]) -> String? {
        let next = reread.replacingOccurrences(of: #"^\s*\$+|\$+\s*$"#, with: "", options: .regularExpression).trimmingCharacters(in: .whitespaces)
        guard !next.isEmpty, comparable(next) != comparable(mathpix), !hasWords(next) else { return nil }
        func len(_ s: String) -> Int { s.filter { !$0.isWhitespace }.count }
        let was = len(mathpix)
        if len(next) > was * 2 + 4 || len(next) * 2 + 4 < was { return nil }
        if suspicious(next, others: others) != nil { return nil }
        return next
    }
}
