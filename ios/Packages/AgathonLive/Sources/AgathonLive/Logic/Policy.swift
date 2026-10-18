import AgathonBrain
import Foundation

/// The help ladder and the silence rules for one line: a Swift port of `decide` in
/// src/lib/live/policy.ts (the brain has it too, as `policy`; `PolicyParityTests` hold them equal).
/// Swift here because the loop asks it on every render, synchronously.
///
/// Marks may be immediate; answers must wait. A tick, a ring and a hint are about work already
/// done and land on the per-line cadence; a result is the next thing the kid was going to write, so
/// it waits for the kid to stop (`settled`), and only Solve shows it at all. With Auto off the tutor
/// says nothing it was not asked for. The one exception is the grown-ups' own: "Show the answer when
/// I write =" (`answerOnEquals`, off by default) answers a sum ended with `=` at once, in any mode.
public enum LivePolicy {
    public struct Input: Equatable, Sendable {
        public var mode: LiveMode
        public var analysis: LineAnalysis?
        public var confidence: Double
        public var settled: Bool
        public var auto: Bool
        public var userAsked: Bool
        public var hintsShownForLine: Int
        public var openHintCount: Int
        public var rewritesWithWarn: Int
        public var liveShapeCount: Int
        public var latex: String?
        /// the grown-ups' "Show the answer when I write =": a sum ended with `=` is answered at once
        public var answerOnEquals: Bool

        public init(mode: LiveMode, analysis: LineAnalysis?, confidence: Double, settled: Bool, auto: Bool, userAsked: Bool,
                    hintsShownForLine: Int = 0, openHintCount: Int = 0, rewritesWithWarn: Int = 0, liveShapeCount: Int = 0, latex: String? = nil,
                    answerOnEquals: Bool = false) {
            self.mode = mode
            self.analysis = analysis
            self.confidence = confidence
            self.settled = settled
            self.auto = auto
            self.userAsked = userAsked
            self.hintsShownForLine = hintsShownForLine
            self.openHintCount = openHintCount
            self.rewritesWithWarn = rewritesWithWarn
            self.liveShapeCount = liveShapeCount
            self.latex = latex
            self.answerOnEquals = answerOnEquals
        }
    }

    public struct Decision: Equatable, Sendable {
        public var echo: Bool
        /// none, ok, warn, solved
        public var badge: String
        public var showResult: Bool
        public var runLlmCheck: Bool
        public var allowHint: Bool
        public var allowSteps: Bool
        public var revealChemBalance: Bool
        public var offerHintPrompt: Bool
        public var capped: Bool
    }

    static let silentKinds: Set<String> = ["label", "incomplete", "text"]
    static let checkableKinds: Set<String> = ["equation", "expression", "inequality", "assignment"]
    static let unjudgedKinds: Set<String> = ["label", "incomplete", "text", "unknown"]

    public static func badge(_ mode: LiveMode, _ analysis: LineAnalysis?) -> String {
        guard mode != .off, let analysis else { return "none" }
        if analysis.solved == true { return "solved" }
        switch analysis.verdict {
        case "ok": return "ok"
        case "mismatch": return "warn"
        default: return "none"
        }
    }

    public static func decide(_ input: Input) -> Decision {
        let mode = input.mode
        let analysis = input.analysis
        let kind = analysis?.kind ?? "unknown"
        let verdict = analysis?.verdict ?? "unknown"
        let capped = input.liveShapeCount >= LiveLimits.maxLiveShapesPerBoard
        let unasked = input.auto || mode == .off

        let loneSymbol = input.latex.map(isSingleSymbolLatex) == true && analysis?.bareAnswer != true
        let echo = !silentKinds.contains(kind) && !loneSymbol && input.confidence >= LiveLimits.minConfidence

        let badge = echo && !capped && (unasked || input.userAsked) ? Self.badge(mode, analysis) : "none"

        let hasResult = !(analysis?.resultLatex ?? "").isEmpty
        let trailingEquals = kind == "incomplete" || (analysis?.math ?? "").range(of: #"=\s*$"#, options: .regularExpression) != nil
            || endsWithRelation(input.latex ?? "")
        let answerAllowedHere = !trailingEquals || mode == .answer
        // the grown-ups asked for answers after `=` (homework checking): at once, in any mode, asked or not
        let answerNow = input.answerOnEquals && trailingEquals
        let showResult = echo && hasResult && (answerNow || (answerAllowedHere && (input.userAsked || (unasked && input.settled))))

        var runLlmCheck = false
        if mode != .off && echo && !capped {
            runLlmCheck = input.userAsked || (input.auto && input.settled && verdict == "unknown" && checkableKinds.contains(kind))
        }

        let allowHint = (mode == .suggest || mode == .answer) && !capped && (unasked || input.userAsked)
            && input.hintsShownForLine < LiveLimits.maxHintsPerLine && input.openHintCount == 0
        let allowSteps = mode == .answer && input.userAsked && !capped
        let revealChemBalance = mode == .answer && !capped && (unasked || input.userAsked)
        let offerHintPrompt = mode != .off && input.rewritesWithWarn >= 2

        return Decision(echo: echo, badge: badge, showResult: showResult, runLlmCheck: runLlmCheck, allowHint: allowHint,
                        allowSteps: allowSteps, revealChemBalance: revealChemBalance, offerHintPrompt: offerHintPrompt, capped: capped)
    }

    // MARK: - lone symbols, relations

    static let loneSymbolCommands: Set<String> = [
        "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta",
        "iota", "kappa", "lambda", "mu", "nu", "xi", "pi", "varpi", "rho", "varrho", "sigma", "varsigma",
        "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega",
        "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega",
        "checkmark", "square", "blacksquare", "triangle", "triangledown", "bigtriangleup", "circ", "bullet",
        "cdot", "cdots", "ldots", "dots", "vdots", "star", "bigstar", "dagger", "ast", "times", "div",
        "pm", "mp", "infty", "angle", "measuredangle", "parallel", "perp", "nabla", "partial", "prime",
        "rightarrow", "leftarrow", "leftrightarrow", "Rightarrow", "Leftarrow", "uparrow", "downarrow",
        "to", "hbar", "ell", "wp", "Re", "Im", "aleph", "emptyset", "varnothing", "top", "bot", "neg", "lnot",
        "sim", "approx", "equiv", "propto", "therefore", "because", "S", "P", "copyright", "quad", "qquad",
    ]

    /// One symbol alone (`\checkmark`, `\Delta`, `x`, `7`): a drawing or a label, never an echo.
    public static func isSingleSymbolLatex(_ latex: String) -> Bool {
        var s = latex.replacingOccurrences(of: #"\\(?:text|mathrm|mathbf|mathit|textrm|textbf|operatorname)\s*\{([^{}]*)\}"#,
                                           with: " $1 ", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\\(?:left|right|,|;|:|!|quad|qquad)\b"#, with: " ", options: .regularExpression)
        s = s.replacingOccurrences(of: #"[{}~]"#, with: " ", options: .regularExpression)
        s = s.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return false }
        let tokens = matches(#"\\[a-zA-Z]+|[^\s]"#, in: s)
        guard !tokens.isEmpty else { return false }
        if tokens.count == 1 {
            let t = tokens[0]
            if t.hasPrefix("\\") { return loneSymbolCommands.contains(String(t.dropFirst())) }
            return t.range(of: #"^[a-zA-Z0-9.\-+*/=|:'"`^_,;?!()\[\]<>]$"#, options: .regularExpression) != nil
        }
        return tokens.allSatisfy { t in
            if t.hasPrefix("\\") { return loneSymbolCommands.contains(String(t.dropFirst())) }
            return t.range(of: #"^[.\-+*/|:'"`^_,;?!()\[\]<>]$"#, options: .regularExpression) != nil
        }
    }

    static let relations = ["\\approx", "\\Rightarrow", "\\rightarrow", "\\implies", "\\equiv", "\\neq", "\\ne",
                            "\\leq", "\\le", "\\geq", "\\ge", "\\to", "=", "<", ">"]

    /// `36 + 2 =`: the kid asked for the answer (answer.ts `endsWithRelation`).
    public static func endsWithRelation(_ latex: String) -> Bool {
        let s = latex.replacingOccurrences(of: #"\s+$"#, with: "", options: .regularExpression)
        return relations.contains { s.hasSuffix($0) }
    }

    /// `= 38`: an answer that carries its own relation.
    public static func startsWithRelation(_ latex: String) -> Bool {
        let s = latex.replacingOccurrences(of: #"^\s+"#, with: "", options: .regularExpression)
        for op in relations where s.hasPrefix(op) {
            if op.hasPrefix("\\"), let next = s.dropFirst(op.count).first, next.isLetter { continue }
            return true
        }
        return false
    }

    /// `3x + 24 =`: ended with `=` (not `\le`, `<=`, `!=`).
    public static func endsWithEquals(_ latex: String) -> Bool {
        latex.range(of: #"=\s*$"#, options: .regularExpression) != nil && latex.range(of: #"[<>!]=\s*$"#, options: .regularExpression) == nil
    }

    /// A relation alone, or with a minus: an answer started, its number still to come.
    public static func isAnswerStart(_ latex: String) -> Bool {
        var s = latex.replacingOccurrences(of: #"\\(?:text|mathrm)\s*\{([^{}]*)\}"#, with: "$1", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\\[,;:! ]|[{}\s~]"#, with: "", options: .regularExpression)
        if s.range(of: #"^(?:=|<|>|\\(?:le|ge|leq|geq|lt|gt|ne|neq|approx))$"#, options: .regularExpression) != nil { return true }
        return s == "-" || s.range(of: #"^(?:=|<|>|\\(?:le|ge|leq|geq|lt|gt))-$"#, options: .regularExpression) != nil
    }

    /// Why the tutor cannot judge a line it has read (`unread`: write it again; `unjudged`: nothing
    /// in it to check), or nil.
    public static func unjudgedReason(latex: String, confidence: Double, provider: ReadProvider, analysis: LineAnalysis?) -> String? {
        if provider == .none && analysis == nil { return nil }
        if isAnswerStart(latex) { return nil }
        if latex.trimmingCharacters(in: .whitespaces).isEmpty || confidence < LiveLimits.minConfidence { return "unread" }
        guard let analysis else { return nil }
        if analysis.bareAnswer == true { return nil }
        if isSingleSymbolLatex(latex) || unjudgedKinds.contains(analysis.kind) { return "unjudged" }
        return nil
    }

    /// Prose (a word problem): a `\text{…}` with words in it (`readCheck.ts` `isProse`).
    public static func isProse(_ latex: String) -> Bool {
        let s = latex.replacingOccurrences(of: #"\\(?:text|textrm|mbox)\s*\{\s*(?:of|to)\s*\}"#, with: " ", options: .regularExpression)
        for m in matches(#"\\(?:text|textrm|textbf|textit|textsf|mbox)\s*\{([^{}]*)\}"#, in: s, group: 1) {
            if m.range(of: "[A-Za-z]{2,}", options: .regularExpression) != nil { return true }
        }
        return false
    }

    /// A word problem's line: prose of at least four words (`isProblemProse`).
    public static func isProblemProse(latex: String, analysis: LineAnalysis?) -> Bool {
        guard analysis?.kind == "text" else { return false }
        var plain = latex.replacingOccurrences(of: #"\\(?:text|mathrm|textrm|textbf|mathbf|operatorname)\s*\{([^{}]*)\}"#,
                                               with: " $1 ", options: .regularExpression)
        plain = plain.replacingOccurrences(of: #"\\[a-zA-Z]+"#, with: " ", options: .regularExpression)
        plain = plain.replacingOccurrences(of: "[{}]", with: " ", options: .regularExpression)
        return matches("[A-Za-z0-9]+", in: plain).count >= 4
    }

    static func matches(_ pattern: String, in s: String, group: Int = 0) -> [String] {
        guard let re = try? NSRegularExpression(pattern: pattern) else { return [] }
        let ns = s as NSString
        return re.matches(in: s, range: NSRange(location: 0, length: ns.length)).compactMap { m in
            let r = m.range(at: group)
            return r.location == NSNotFound ? nil : ns.substring(with: r)
        }
    }
}
