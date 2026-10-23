import AgathonBoard
import AgathonBrain
import Foundation

/// A word problem on its own page ("Sam has 3 bags of 4 apples. How many apples?"): the desk
/// writes maths only (`verifyProblem`'s `words`), so a problem in sentences is written as words at
/// the top of the page, in the tutor's hand, wrapped to the page — never as raw `\text{…}`.
///
/// Its words are not a problem the engine solves: they head no column. The kid's own first line
/// under them (`3 \times 4 = 12`) is the problem their work is judged against, as on a page of
/// their own homework, so a slip in the sums is still ringed; the set-up itself is theirs.
public enum WordProblem {
    /// The meta key on the words' strokes.
    public static let meta = "wordProblem"
    /// The words' hand on a page, and the smallest it shrinks to for a long problem.
    public static let handSize = 48.0
    public static let minHandSize = 28.0

    /// The problem's sentences in plain words, or nil when it is not words (the desk checks maths)
    /// or something in it would show as raw LaTeX.
    public static func sentences(_ problem: [String]) -> [String]? {
        var out: [String] = []
        var words = false
        for line in problem {
            guard let p = plain(line) else { return nil }
            guard !p.isEmpty else { continue }
            out.append(p)
            if hasWords(line) { words = true }
        }
        return words && !out.isEmpty ? out : nil
    }

    /// The words in the tutor's hand at the page's problem origin, as big as fits above the work
    /// area: nil when they cannot be drawn there.
    public static func plan(_ sentences: [String], brain: Brain, seedKey: String) async -> HandPlan? {
        let L = ProblemPageLayout.self
        var size = handSize
        while size >= minHandSize {
            let request = WordsRequest(sentences: sentences, maxWidth: L.ruleRight - L.problemOrigin.x, size: size, seedKey: seedKey,
                                       origin: AgathonBrain.Point(x: L.problemOrigin.x, y: L.problemOrigin.y))
            guard let result = try? await brain.layoutWords(request), let plan = result.plan else { return nil }
            if plan.bounds.y + plan.bounds.h <= L.problemMaxBottom { return plan }
            size -= 6
        }
        return nil
    }

    // MARK: - LaTeX to words

    static let symbols: [(String, String)] = [
        ("\\times", "×"), ("\\div", "÷"), ("\\cdot", "·"), ("\\%", "%"), ("\\$", "$"), ("\\le", "≤"), ("\\ge", "≥"),
        ("\\leq", "≤"), ("\\geq", "≥"), ("\\neq", "≠"), ("\\pi", "π"), ("^\\circ", "°"), ("\\degree", "°"),
        ("\\,", " "), ("\\;", " "), ("\\:", " "), ("\\!", ""), ("\\quad", " "), ("\\qquad", " "), ("\\ ", " "),
        ("\\left", ""), ("\\right", ""),
    ]

    /// One line as plain words: `\text{…}` unwrapped, `\frac{a}{b}` as a/b, symbols as themselves;
    /// nil when a command is left over (it would show as LaTeX).
    static func plain(_ latex: String) -> String? {
        var s = latex.replacingOccurrences(of: "$", with: "")
        // \text{…} and friends: their words
        s = s.replacingOccurrences(of: #"\\(?:text|textbf|textit|mathrm|mbox)\s*\{([^{}]*)\}"#, with: "$1", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}"#, with: "$1/$2", options: .regularExpression)
        // longest first, so \leq is not \le + q
        for (cmd, out) in symbols.sorted(by: { $0.0.count > $1.0.count }) {
            s = s.replacingOccurrences(of: cmd, with: out)
        }
        s = s.replacingOccurrences(of: #"\^\{?2\}?"#, with: "²", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\^\{?3\}?"#, with: "³", options: .regularExpression)
        s = s.replacingOccurrences(of: "{", with: "").replacingOccurrences(of: "}", with: "")
        if s.contains("\\") || s.contains("^") || s.contains("_") { return nil }
        return s.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
    }

    /// Sentences, not maths: `\text` with a word in it, or a word of three letters or more outside
    /// any command.
    static func hasWords(_ latex: String) -> Bool {
        if latex.range(of: #"\\(?:text|textbf|textit|mbox)\s*\{[^{}]*[A-Za-z]{2,}"#, options: .regularExpression) != nil { return true }
        let bare = latex.replacingOccurrences(of: #"\\[A-Za-z]+"#, with: " ", options: .regularExpression)
        return bare.range(of: #"[A-Za-z]{3,}"#, options: .regularExpression) != nil
    }
}
