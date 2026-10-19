import AgathonDesign
import SwiftUI

/// A line of maths from LaTeX, as plain text for now: `\frac{3}{4}` reads 3/4, `\times` ×. The
/// lead swaps the body for the TOOLS lane's renderer; screens only ever say `MathLabel(latex)`.
struct MathLabel: View {
    let latex: String
    var size: CGFloat = 22
    var color: Color = DS.Color.ink

    init(_ latex: String, size: CGFloat = 22, color: Color = DS.Color.ink) {
        self.latex = latex
        self.size = size
        self.color = color
    }

    var body: some View {
        Text(Self.plain(latex))
            .font(DS.Font.fixed(.numeral, size: size))
            .foregroundStyle(color)
            .accessibilityLabel(Self.spoken(latex))
    }

    /// LaTeX as plain text.
    static func plain(_ latex: String) -> String {
        var s = latex
        // \frac{a}{b} → a/b (innermost first, so nested fractions come out too)
        let frac = try! NSRegularExpression(pattern: #"\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}"#)
        for _ in 0 ..< 6 {
            let range = NSRange(s.startIndex..., in: s)
            let next = frac.stringByReplacingMatches(in: s, range: range, withTemplate: "$1/$2")
            if next == s { break }
            s = next
        }
        let sqrt = try! NSRegularExpression(pattern: #"\\sqrt\s*\{([^{}]*)\}"#)
        s = sqrt.stringByReplacingMatches(in: s, range: NSRange(s.startIndex..., in: s), withTemplate: "√$1")
        // Longest names first: \left before \le, \leq before \le, \neq before \ne.
        let replacements: [(String, String)] = [
            (#"\left"#, ""), (#"\right"#, ""), (#"\times"#, "×"), (#"\cdot"#, "·"), (#"\div"#, "÷"), (#"\pm"#, "±"),
            (#"\leq"#, "≤"), (#"\geq"#, "≥"), (#"\le"#, "≤"), (#"\ge"#, "≥"), (#"\neq"#, "≠"), (#"\ne"#, "≠"),
            (#"\pi"#, "π"), (#"\degree"#, "°"), (#"^{\circ}"#, "°"), (#"^\circ"#, "°"), (#"\,"#, " "), (#"\;"#, " "),
            (#"\!"#, ""), (#"\%"#, "%"), (#"\ "#, " "), (#"\text"#, ""), (#"\mathrm"#, ""), (#"\quad"#, "  "),
        ]
        for (from, to) in replacements { s = s.replacingOccurrences(of: from, with: to) }
        // powers: ^2 and ^{12} as superscripts where there are superscript digits
        let superscripts: [Character: Character] = ["0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻", "n": "ⁿ", "x": "ˣ"]
        let power = try! NSRegularExpression(pattern: #"\^\{([0-9n\-x]+)\}|\^([0-9nx])"#)
        let ns = s as NSString
        var out = ""
        var last = 0
        for match in power.matches(in: s, range: NSRange(location: 0, length: ns.length)) {
            out += ns.substring(with: NSRange(location: last, length: match.range.location - last))
            let group = match.range(at: 1).location != NSNotFound ? match.range(at: 1) : match.range(at: 2)
            out += String(ns.substring(with: group).map { superscripts[$0] ?? $0 })
            last = match.range.location + match.range.length
        }
        out += ns.substring(from: last)
        s = out.replacingOccurrences(of: "{", with: "").replacingOccurrences(of: "}", with: "")
        s = s.replacingOccurrences(of: "\\", with: "")
        // spaces round = and the operators, one each
        for op in ["=", "+", "×", "÷", "<", ">", "≤", "≥"] {
            s = s.replacingOccurrences(of: op, with: " \(op) ")
        }
        s = s.split(separator: " ", omittingEmptySubsequences: true).joined(separator: " ")
        // A minus between two terms gets room either side; every hyphen is a real minus sign.
        let binary = try! NSRegularExpression(pattern: #"(?<=[0-9A-Za-z)²³⁴⁵⁶⁷⁸⁹⁰¹ⁿˣ])\s*-\s*(?=[0-9A-Za-z(√])"#)
        s = binary.stringByReplacingMatches(in: s, range: NSRange(s.startIndex..., in: s), withTemplate: " − ")
        return s.replacingOccurrences(of: "-", with: "−")
    }

    /// What VoiceOver says: the plain text with the signs in words.
    static func spoken(_ latex: String) -> String {
        plain(latex)
            .replacingOccurrences(of: "×", with: " times ")
            .replacingOccurrences(of: "÷", with: " divided by ")
            .replacingOccurrences(of: "=", with: " equals ")
            .replacingOccurrences(of: "−", with: " minus ")
            .replacingOccurrences(of: "  ", with: " ")
    }
}
