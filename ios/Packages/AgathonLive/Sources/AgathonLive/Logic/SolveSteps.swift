import Foundation

/// What the tutor writes for a worked solution (src/lib/live/solveSteps.ts): the model's steps are
/// checked before they are drawn, and a step is never written twice.
public enum SolveSteps {
    /// Every `\boxed{…}` taken off: the hand and the step check want the maths inside.
    public static func unwrapBoxed(_ latex: String) -> String {
        var s = latex.trimmingCharacters(in: .whitespacesAndNewlines)
        for _ in 0..<8 {
            guard let r = s.range(of: #"\\boxed\s*\{"#, options: .regularExpression) else { return s }
            let chars = Array(s)
            let start = s.distance(from: s.startIndex, to: r.upperBound) - 1
            var depth = 0
            var end = -1
            var i = start
            while i < chars.count {
                if chars[i] == "{" { depth += 1 } else if chars[i] == "}" {
                    depth -= 1
                    if depth == 0 {
                        end = i
                        break
                    }
                }
                i += 1
            }
            guard end > start else { return s }
            let before = String(chars[0..<s.distance(from: s.startIndex, to: r.lowerBound)])
            let inner = String(chars[(start + 1)..<end])
            let after = String(chars[(end + 1)...])
            s = (before + inner + after).trimmingCharacters(in: .whitespaces)
        }
        return s
    }

    /// A step's identity: spacing, sizing, braces and multiplication signs ignored.
    public static func key(_ latex: String) -> String {
        var s = unwrapBoxed(latex)
        s = s.replacingOccurrences(of: #"\\(?:left|right|,|;|!|quad|qquad)|~|\s"#, with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: "[{}]", with: "", options: .regularExpression)
        return s.replacingOccurrences(of: #"\\cdot|\\times|\*"#, with: "", options: .regularExpression)
    }

    /// The leading relation off a step (`= 3(x + 8)` → `3(x + 8)`).
    public static func withoutRelation(_ step: String) -> String {
        let s = step.replacingOccurrences(of: #"^\s*=\s*"#, with: "", options: .regularExpression).trimmingCharacters(in: .whitespaces)
        return s.isEmpty ? step : s
    }

    /// A bare number or a monomial: an answer, though the engine calls it a label on its own.
    public static func isBareAnswer(_ latex: String) -> Bool {
        let body = withoutRelation(unwrapBoxed(latex)).replacingOccurrences(of: #"\\,|[\s,]"#, with: "", options: .regularExpression)
        if body.range(of: #"^[-+]?\d+(?:\.\d+)?$"#, options: .regularExpression) != nil { return true }
        return body.range(of: #"^[-+]?(?:\d+(?:\.\d+)?|\\frac\{\d+\}\{\d+\})?[a-zA-Z]{1,3}$"#, options: .regularExpression) != nil
    }

    /// Setup and steps as one block, each line once (`setupBlock`).
    public static func block(_ setup: [String], _ steps: [String], onlyFirst: Bool = false) -> [String] {
        if onlyFirst { return Array(setup.prefix(1)) }
        var out: [String] = []
        var seen = Set<String>()
        for line in setup + steps {
            let k = key(line)
            guard !k.isEmpty, !seen.contains(k) else { continue }
            seen.insert(k)
            out.append(line)
        }
        return out
    }
}
