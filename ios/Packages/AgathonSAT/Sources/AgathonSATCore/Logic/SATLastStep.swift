import Foundation

/// Rung 2 when the next step IS the answer (the 2026-10-23 review of the live run: on a two-step
/// question Help me's one step wrote `h = \frac{3}{2}w + 6`, choice B, on the page). The tutor does not
/// write the answer: it writes a cobalt pointer without the result, "One step left: divide both sides
/// by 3.", from the step's own explanation (the model's), else the bank's step text, the result taken out.
public enum SATLastStep {
    /// Does writing `latex` give the question's answer away: its last side is the right choice's maths
    /// (`26x + 50`, `h = \frac{3}{2}w + 6`), or the value of the answer (the right choice's number, any
    /// accepted grid-in form)?
    public static func revealsAnswer(_ latex: String, of q: SATQuestion) -> Bool {
        let line = SATHintLadder.key(latex)
        guard !line.isEmpty else { return false }
        let sides = line.split(separator: "=", omittingEmptySubsequences: true).map(String.init)
        guard let last = sides.last else { return false }
        // the last side as written (its braces kept, for `\frac{17}{3}`'s value)
        let lastWritten = latex.components(separatedBy: "=").last ?? latex
        for answer in answers(q) {
            let a = SATHintLadder.key(answer)
            if a.isEmpty { continue }
            // the whole choice (`h=\frac32w+6`), or its right side
            if line == a || line.hasSuffix("=" + a) || last == a { return true }
            if let ar = a.split(separator: "=").last.map(String.init), a.contains("="), last == ar, sides.count > 1 { return true }
            if let v = value(answer), let s = value(lastWritten), abs(v - s) < 1e-9 * max(1, abs(v)) { return true }
        }
        return false
    }

    /// The answer as the question states it: the right choice's text (its maths), or every accepted grid-in form.
    static func answers(_ q: SATQuestion) -> [String] {
        if let key = q.answer.key, let choice = q.choices?.first(where: { $0.key == key }) {
            return [choice.text.replacingOccurrences(of: "$", with: "")]
        }
        return q.answer.accepted ?? []
    }

    /// A plain number written in LaTeX (`19`, `-\frac{17}{3}`, `0.4`, `3/4`), or nil.
    public static func value(_ latex: String) -> Double? {
        var t = SATHintLadder.key(latex)
        var negative = false
        if t.hasPrefix("-") {
            negative = true
            t.removeFirst()
        }
        var v: Double?
        if let m = t.range(of: #"^\\[dt]?frac([0-9.]+)([0-9.]+)$"#, options: .regularExpression), m.lowerBound == t.startIndex {
            // `\frac{17}{3}` with its braces gone is `\frac173`: ambiguous, so read it from the source
            v = fraction(latex)
        } else if t.contains("/") {
            let p = t.split(separator: "/")
            if p.count == 2, let a = Double(p[0]), let b = Double(p[1]), b != 0 { v = a / b }
        } else {
            v = Double(t)
        }
        guard let v else { return nil }
        return negative ? -v : v
    }

    private static func fraction(_ latex: String) -> Double? {
        guard let r = latex.range(of: #"\\[dt]?frac\s*\{\s*([0-9.]+)\s*\}\s*\{\s*([0-9.]+)\s*\}"#, options: .regularExpression) else { return nil }
        let nums = latex[r].split(whereSeparator: { !"0123456789.".contains($0) }).compactMap { Double($0) }
        guard nums.count == 2, nums[1] != 0 else { return nil }
        return nums[0] / nums[1]
    }

    /// The pointer for the last step: "One step left: " and how, the result taken out. `explanation` is
    /// the model's words for the step (the live tutor's); else the bank's last step's text; else a plain
    /// "One step left: finish it from your last line."
    public static func pointer(explanation: String?, for q: SATQuestion) -> String {
        let bankText = q.solution.steps.last(where: { $0.math != nil })?.text
        for source in [explanation, bankText] {
            guard let s = source, let how = withoutResult(s, of: q), !how.isEmpty else { continue }
            return "One step left: " + wordsOnly(how)
        }
        return "One step left: finish it from your last line."
    }

    /// `s` with the answer taken out ("Divide both sides by 3 to get x = 19." → "divide both sides by 3."),
    /// first letter lowercased; nil when nothing that says how is left ("So the equation is", "The answer is 19").
    static func withoutResult(_ s: String, of q: SATQuestion) -> String? {
        var t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        // maths that holds the answer goes, with what leads into it ("to get", "so", "giving", "=")
        let segments = mathSegments(t)
        for seg in segments where revealsAnswer(seg.math, of: q) || answers(q).contains(where: { SATHintLadder.key($0) == SATHintLadder.key(seg.math) }) {
            t = t.replacingOccurrences(of: seg.source, with: "⟂")
        }
        for a in answers(q) where value(a) != nil {
            // the bare number in words (`19`, `-17/3`), not inside another number
            let n = NSRegularExpression.escapedPattern(for: a)
            t = t.replacingOccurrences(of: #"(?<![0-9.])"# + n + #"(?![0-9]|\.[0-9])"#, with: "⟂", options: .regularExpression)
        }
        if let cut = t.firstIndex(of: "⟂") {
            var head = String(t[..<cut])
            // the clause that led into the result goes too: "… to get x =", "… to get a", "…, so y is"
            let lead = #"(?:to get|to find|giving|which gives|so that|so|and get|gives)"#
            let tails = [#"\s*(?:=|\bis\b|\bare\b|\bequals\b)\s*$"#,
                         #",?\s*\b"# + lead + #"\s+[a-zA-Z](?:\([a-z0-9]\))?\s*$"#,
                         #",?\s*\b"# + lead + #"\s*$"#, #",\s*$"#]
            var changed = true
            while changed {
                changed = false
                for tail in tails {
                    if let r = head.range(of: tail, options: [.regularExpression, .caseInsensitive]) {
                        head.removeSubrange(r)
                        changed = true
                    }
                }
            }
            t = head
        }
        t = t.trimmingCharacters(in: CharacterSet(charactersIn: " ,:;.").union(.whitespacesAndNewlines))
        // nothing of how left: a sentence that only announced the result
        let bare = t.lowercased()
        if t.count < 6 || ["so the equation", "the answer", "so the answer", "the value", "so the value", "the equation", "the length", "so"].contains(where: { bare == $0 || bare.hasPrefix($0 + " is") }) {
            return nil
        }
        // an answer that is maths (`h = \frac{3}{2}w + 6`, `d = 4t + 18`) written out in the words, or every
        // number of it named ("use slope 4 and starting depth 18": the live run, 2026-10-23): none of them
        let said = numbers(t)
        for a in answers(q) where value(a) == nil {
            let own = numbers(plain(a))
            if !own.isEmpty && own.isSubset(of: said) { return nil }
        }
        let flat = plain(t)
        for a in answers(q) where value(a) == nil {
            let k = plain(a)
            let right = k.split(separator: "=").last.map(String.init) ?? k
            if (k.count >= 3 && flat.contains(k)) || (right.count >= 3 && flat.contains(right)) { return nil }
        }
        return t.prefix(1).lowercased() + t.dropFirst() + "."
    }

    /// The pointer's maths as plain words (the page's cobalt words are not typeset): `$t=0$` → `t = 0`,
    /// `\frac{3}{2}` → `3/2` (the live run showed "at $t=0$ is 51").
    static func wordsOnly(_ s: String) -> String {
        var t = s.replacingOccurrences(of: #"\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}"#, with: "$1/$2", options: .regularExpression)
        for (a, b) in [(#"\cdot"#, "·"), (#"\times"#, "×"), (#"\le"#, "≤"), (#"\ge"#, "≥"), (#"\ne"#, "≠"), (#"\pi"#, "π"), ("$", ""), ("{", ""), ("}", "")] {
            t = t.replacingOccurrences(of: a, with: b)
        }
        t = t.replacingOccurrences(of: #"\s*=\s*"#, with: " = ", options: .regularExpression)
        return t.replacingOccurrences(of: #"\\[a-zA-Z]+"#, with: "", options: .regularExpression)
    }

    /// The numbers written in `s` (`3`, `2.5`).
    static func numbers(_ s: String) -> Set<String> {
        guard let re = try? NSRegularExpression(pattern: #"[0-9]+(?:\.[0-9]+)?"#) else { return [] }
        let ns = s as NSString
        return Set(re.matches(in: s, range: NSRange(location: 0, length: ns.length)).map { ns.substring(with: $0.range) })
    }

    /// Maths as words write it, for a match: `\frac{3}{2}` as `3/2`, no spaces, no `$`.
    static func plain(_ s: String) -> String {
        let f = s.replacingOccurrences(of: #"\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}"#, with: "$1/$2", options: .regularExpression)
        return SATHintLadder.key(f)
    }

    private static func mathSegments(_ s: String) -> [(source: String, math: String)] {
        guard let re = try? NSRegularExpression(pattern: #"\$\$([^$]+)\$\$|\$([^$]+)\$"#) else { return [] }
        let ns = s as NSString
        return re.matches(in: s, range: NSRange(location: 0, length: ns.length)).map { m in
            let inner = m.range(at: 1).location != NSNotFound ? m.range(at: 1) : m.range(at: 2)
            return (ns.substring(with: m.range), ns.substring(with: inner))
        }
    }
}
