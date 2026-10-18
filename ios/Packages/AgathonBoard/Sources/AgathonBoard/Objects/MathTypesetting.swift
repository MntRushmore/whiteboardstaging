import CoreGraphics
import CoreText
import Foundation

/// Typeset maths, ready to draw: its size, and a function that draws it with its baseline's left end
/// at a point of a y-down context (page space). Safe to draw from any thread.
public struct TypesetMath: @unchecked Sendable {
    public var width: Double
    public var ascent: Double
    public var descent: Double
    /// typeset by the fallback (the maths as plain text): the renderer could not read the LaTeX
    public var isFallback: Bool
    public var draw: @Sendable (_ ctx: CGContext, _ baseline: CGPoint) -> Void

    public init(width: Double, ascent: Double, descent: Double, isFallback: Bool = false, draw: @escaping @Sendable (CGContext, CGPoint) -> Void) {
        self.width = width
        self.ascent = ascent
        self.descent = descent
        self.isFallback = isFallback
        self.draw = draw
    }

    public var height: Double { ascent + descent }
}

/// Turns LaTeX into `TypesetMath`. The engine ships a plain-text one (`PlainMathTypesetter`); the app
/// installs a real one (AgathonBoardUI's SwiftMath typesetter) with `MathRendering.install`.
public protocol MathTypesetter: Sendable {
    func typeset(_ latex: String, fontSize: Double, color: CGColor) -> TypesetMath
}

/// The typesetter the renderer uses, and the fonts its words are set in.
public enum MathRendering {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var current: MathTypesetter = PlainMathTypesetter()

    public static var typesetter: MathTypesetter {
        lock.lock()
        defer { lock.unlock() }
        return current
    }

    /// Installs the app's typesetter (before the first board is drawn).
    public static func install(_ t: MathTypesetter) {
        lock.lock()
        current = t
        lock.unlock()
    }

    public static func typeset(_ latex: String, fontSize: Double, color: CGColor) -> TypesetMath {
        typesetter.typeset(latex, fontSize: fontSize, color: color)
    }
}

/// The fonts the board's own words use (a graph's ticks and labels). The system font until the app
/// sets its brand font (`RenderFonts.install`).
public enum RenderFonts {
    public enum Weight: Sendable { case regular, medium, semibold }

    private static let lock = NSLock()
    nonisolated(unsafe) private static var names: [Weight: String] = [:]

    /// PostScript names per weight (fonts registered process-wide by the app).
    public static func install(regular: String, medium: String, semibold: String) {
        lock.lock()
        names = [.regular: regular, .medium: medium, .semibold: semibold]
        lock.unlock()
    }

    public static func font(_ size: Double, _ weight: Weight = .regular) -> CTFont {
        lock.lock()
        let name = names[weight]
        lock.unlock()
        if let name {
            let f = CTFontCreateWithName(name as CFString, size, nil)
            // CoreText hands back a stand-in for a name it does not know: use the system font then
            if (CTFontCopyPostScriptName(f) as String) == name { return f }
        }
        let ui: CTFontUIFontType = weight == .regular ? .system : .emphasizedSystem
        return CTFontCreateUIFontForLanguage(ui, size, nil) ?? CTFontCreateWithName("Helvetica" as CFString, size, nil)
    }

    /// One line of text, for drawing in page space (y down) with `RenderItem`'s text op.
    public static func line(_ s: String, size: Double, weight: Weight = .regular, color: CGColor) -> CTLine {
        let attrs: [CFString: Any] = [kCTFontAttributeName: font(size, weight), kCTForegroundColorAttributeName: color]
        let str = CFAttributedStringCreate(nil, s as CFString, attrs as CFDictionary)!
        return CTLineCreateWithAttributedString(str)
    }
}

/// The fallback: the maths as it reads, in plain text (`\frac{1}{2} + x` → "1/2 + x"), never a LaTeX
/// command (the web's `mathText`).
public struct PlainMathTypesetter: MathTypesetter {
    public init() {}

    public func typeset(_ latex: String, fontSize: Double, color: CGColor) -> TypesetMath {
        Self.plain(LatexText.plain(latex), fontSize: fontSize, color: color)
    }

    public static func plain(_ text: String, fontSize: Double, color: CGColor) -> TypesetMath {
        let line = RenderFonts.line(text, size: fontSize, color: color)
        var ascent: CGFloat = 0, descent: CGFloat = 0, leading: CGFloat = 0
        let w = CTLineGetTypographicBounds(line, &ascent, &descent, &leading)
        return TypesetMath(width: w, ascent: ascent, descent: descent, isFallback: true) { ctx, p in
            ctx.saveGState()
            ctx.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
            ctx.textPosition = p
            CTLineDraw(line, ctx)
            ctx.restoreGState()
        }
    }
}

/// LaTeX as plain text, for the fallback and for words (`\text{area} = 12` → "area = 12").
public enum LatexText {
    static let symbols: [String: String] = [
        "times": "×", "div": "÷", "cdot": "·", "pm": "±", "mp": "∓", "le": "≤", "leq": "≤", "ge": "≥", "geq": "≥",
        "ne": "≠", "neq": "≠", "approx": "≈", "infty": "∞", "pi": "π", "theta": "θ", "alpha": "α", "beta": "β",
        "gamma": "γ", "delta": "δ", "Delta": "Δ", "lambda": "λ", "mu": "μ", "sigma": "σ", "Sigma": "Σ", "omega": "ω",
        "phi": "φ", "to": "→", "rightarrow": "→", "Rightarrow": "⇒", "implies": "⇒", "leftarrow": "←", "angle": "∠",
        "triangle": "△", "circ": "°", "degree": "°", "varnothing": "∅", "emptyset": "∅", "in": "∈", "therefore": "∴",
        "cdots": "⋯", "ldots": "…", "dots": "…", "%": "%", "$": "$", "{": "{", "}": "}", "&": "&", "#": "#",
        "checkmark": "✓", "perp": "⊥", "parallel": "∥", "sim": "∼", "cong": "≅", "lt": "<", "gt": ">",
    ]

    /// The maths as it reads.
    public static func plain(_ latex: String) -> String {
        var s = latex.trimmingCharacters(in: .whitespacesAndNewlines)
        while s.hasPrefix("$") { s.removeFirst() }
        while s.hasSuffix("$") { s.removeLast() }
        // \frac{a}{b} → a/b (inside out)
        for _ in 0..<8 {
            guard let r = s.range(of: #"\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}"#, options: .regularExpression) else { break }
            let inner = String(s[r])
            let parts = inner.replacingOccurrences(of: #"\\[dt]?frac\s*"#, with: "", options: .regularExpression)
                .dropFirst().dropLast().components(separatedBy: "}{")
            let a = parts.first ?? "", b = parts.count > 1 ? parts[1] : ""
            let wrap: (String) -> String = { $0.count > 1 ? "(\($0))" : $0 }
            s.replaceSubrange(r, with: "\(wrap(a))/\(wrap(b))")
        }
        s = s.replacingOccurrences(of: #"\\sqrt\s*\{([^{}]*)\}"#, with: "√($1)", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\\(text|mathrm|textbf|mathbf|operatorname|textit|mathit)\s*\{([^{}]*)\}"#, with: "$2", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\\left|\\right|\\big|\\Big"#, with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\\begin\{[a-z*]*\}(\{[^{}]*\})?|\\end\{[a-z*]*\}|\\hline"#, with: " ", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\\\\"#, with: "; ", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\\[,;:! ]|\\quad|\\qquad|~"#, with: " ", options: .regularExpression)
        // named symbols
        var out = ""
        var i = s.startIndex
        while i < s.endIndex {
            if s[i] == "\\" {
                var j = s.index(after: i)
                if j < s.endIndex, !s[j].isLetter {
                    let name = String(s[j])
                    out += symbols[name] ?? name
                    i = s.index(after: j)
                    continue
                }
                while j < s.endIndex, s[j].isLetter { j = s.index(after: j) }
                let name = String(s[s.index(after: i)..<j])
                out += symbols[name] ?? (["sin", "cos", "tan", "log", "ln", "lim", "max", "min", "exp"].contains(name) ? name + " " : "")
                i = j
            } else {
                out.append(s[i])
                i = s.index(after: i)
            }
        }
        // ^{2} → ²-ish: keep it readable without superscript fonts: x^2
        out = out.replacingOccurrences(of: #"\^\{([^{}]*)\}"#, with: "^$1", options: .regularExpression)
        out = out.replacingOccurrences(of: #"_\{([^{}]*)\}"#, with: "_$1", options: .regularExpression)
        out = out.replacingOccurrences(of: "{", with: "").replacingOccurrences(of: "}", with: "").replacingOccurrences(of: "&", with: " ")
        out = out.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        return out.trimmingCharacters(in: .whitespaces)
    }
}
