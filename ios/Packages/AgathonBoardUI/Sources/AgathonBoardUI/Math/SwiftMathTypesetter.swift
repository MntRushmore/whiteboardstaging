import AgathonBoard
import CoreGraphics
import CoreText
import Foundation
import SwiftMath
import UIKit

/// The board's typeset maths, natively: SwiftMath (vendored, MIT) with Latin Modern Math, the look of
/// the KaTeX the web drew converted boards with. Fractions, exponents, roots, `\text{}`, `aligned`
/// and `cases` typeset as they are; the few commands the tutor's corpus uses that SwiftMath lacks are
/// rewritten first (`LatexPrep`), a one-column `array` (a sum worked in columns, with its rules) is
/// laid out here, and anything else falls back to the maths as text, never a red error.
///
/// Thread-safe: tiles are drawn off the main thread. Results are cached.
public struct SwiftMathTypesetter: MathTypesetter {
    public init() {}

    final class Box: @unchecked Sendable {
        let value: TypesetMath
        init(_ v: TypesetMath) { value = v }
    }

    nonisolated(unsafe) static let cache: NSCache<NSString, Box> = {
        let c = NSCache<NSString, Box>()
        c.countLimit = 2000
        return c
    }()

    public func typeset(_ latex: String, fontSize: Double, color: CGColor) -> TypesetMath {
        let key = "\(fontSize)|\(color.components ?? [])|\(latex)" as NSString
        if let hit = Self.cache.object(forKey: key) { return hit.value }
        let out = Self.make(latex, fontSize: fontSize, color: color)
        Self.cache.setObject(Box(out), forKey: key)
        return out
    }

    /// Typesets without the cache (tests count fallbacks with it).
    public static func make(_ latex: String, fontSize: Double, color: CGColor) -> TypesetMath {
        let src = LatexPrep.prepare(latex)
        if let column = LatexPrep.column(src) {
            return stacked(column, fontSize: fontSize, color: color) ?? fallback(latex, fontSize, color)
        }
        return line(src, fontSize: fontSize, color: color) ?? fallback(latex, fontSize, color)
    }

    static func fallback(_ latex: String, _ size: Double, _ color: CGColor) -> TypesetMath {
        PlainMathTypesetter.plain(LatexText.plain(latex), fontSize: size, color: color)
    }

    /// One line of maths.
    static func line(_ latex: String, fontSize: Double, color: CGColor) -> TypesetMath? {
        guard let font = MTTypesetting.latinModern(size: CGFloat(fontSize)) else { return nil }
        let (display, error) = MTTypesetting.display(latex: latex, font: font, style: .text, color: UIColor(cgColor: color))
        guard error == nil, let display, display.width > 0 || latex.isEmpty else { return nil }
        let d = SendableDisplay(display)
        return TypesetMath(width: Double(display.width), ascent: Double(display.ascent), descent: Double(display.descent)) { ctx, baseline in
            ctx.saveGState()
            ctx.translateBy(x: baseline.x, y: baseline.y)
            // SwiftMath draws y-up with CoreText; the board is y-down
            ctx.scaleBy(x: 1, y: -1)
            ctx.textMatrix = .identity
            ctx.setFillColor(color)
            ctx.setStrokeColor(color)
            // SwiftMath strokes fraction bars and the radical's rule with UIBezierPath, and sets glyph
            // colours with UIColor.setFill: both draw into UIKit's current context (per thread), so
            // the tile's context must be it
            UIGraphicsPushContext(ctx)
            d.display.draw(ctx)
            UIGraphicsPopContext()
            ctx.restoreGState()
        }
    }

    /// A sum or product worked in columns: rows right-aligned, a rule where the tutor ruled one.
    static func stacked(_ column: LatexPrep.Column, fontSize: Double, color: CGColor) -> TypesetMath? {
        var rows: [TypesetMath] = []
        for r in column.rows {
            guard let t = r.isEmpty ? TypesetMath(width: 0, ascent: fontSize * 0.7, descent: fontSize * 0.2, draw: { _, _ in }) : line(r, fontSize: fontSize, color: color) else { return nil }
            rows.append(t)
        }
        guard !rows.isEmpty else { return nil }
        let gap = fontSize * 0.25
        let width = rows.map(\.width).max() ?? 0
        // y of each row's baseline below the top, and the rules between rows
        var y = 0.0
        var baselines: [Double] = []
        var rules: [Double] = []
        for (i, r) in rows.enumerated() {
            if column.rulesAbove.contains(i) {
                y += gap
                rules.append(y)
                y += gap
            }
            y += r.ascent
            baselines.append(y)
            y += r.descent + (i + 1 < rows.count ? gap : 0)
        }
        if column.rulesAbove.contains(rows.count) {
            y += gap
            rules.append(y)
        }
        let ascent = rows[0].ascent
        let total = y
        let rowsCopy = rows
        let thickness = max(1, fontSize * 0.06)
        return TypesetMath(width: width, ascent: ascent, descent: total - ascent) { ctx, baseline in
            let top = baseline.y - ascent
            for (i, r) in rowsCopy.enumerated() {
                r.draw(ctx, CGPoint(x: baseline.x + width - r.width, y: top + baselines[i]))
            }
            ctx.saveGState()
            ctx.setFillColor(color)
            for ry in rules {
                ctx.fill(CGRect(x: baseline.x, y: top + ry - thickness / 2, width: width, height: thickness))
            }
            ctx.restoreGState()
        }
    }
}

/// An MTDisplay is a class SwiftMath never mutates once laid out; drawing it from several tile
/// threads at once only reads it.
struct SendableDisplay: @unchecked Sendable {
    let display: MTMathListDisplay
    init(_ d: MTMathListDisplay) { display = d }
}

/// LaTeX rewritten for SwiftMath: the commands the tutor's corpus uses that it lacks.
public enum LatexPrep {
    public static func prepare(_ latex: String) -> String {
        var s = latex.trimmingCharacters(in: .whitespacesAndNewlines)
        while s.hasPrefix("$") { s.removeFirst() }
        while s.hasSuffix("$") { s.removeLast() }
        let rules: [(String, String)] = [
            (#"\\operatorname\s*\{([^{}]*)\}"#, #"\\mathrm{$1}"#),
            (#"\\[dt]frac"#, #"\\frac"#),
            (#"\\varnothing"#, #"\\emptyset"#),
            (#"\\stackrel\s*\{([^{}]*)\}\s*\{([^{}]*)\}"#, #"{$2}^{$1}"#),
            (#"\\overset\s*\{([^{}]*)\}\s*\{([^{}]*)\}"#, #"{$2}^{$1}"#),
            (#"\\enclose\s*\{longdiv\}\s*\{([^{}]*)\}"#, #"\\overline{)\\,$1}"#),
            (#"\\longdiv\s*\{([^{}]*)\}"#, #"\\overline{)\\,$1}"#),
            (#"\\(cancel|bcancel|boxed|textstyle)\s*\{([^{}]*)\}"#, "$2"),
            (#"\\lvert|\\rvert"#, "|"),
            (#"\\lt\b"#, "<"),
            (#"\\gt\b"#, ">"),
            (#"\\checkmark"#, #"\\surd"#),
        ]
        for (pattern, template) in rules {
            s = s.replacingOccurrences(of: pattern, with: template, options: .regularExpression)
        }
        // an array that is not a single column: a matrix (SwiftMath knows matrix, not array)
        if s.contains("\\begin{array}"), column(s) == nil {
            s = s.replacingOccurrences(of: #"\\begin\{array\}\{[^{}]*\}"#, with: #"\\begin{matrix}"#, options: .regularExpression)
            s = s.replacingOccurrences(of: #"\\end\{array\}"#, with: #"\\end{matrix}"#, options: .regularExpression)
            s = s.replacingOccurrences(of: #"\\hline"#, with: "", options: .regularExpression)
        }
        return s
    }

    /// A one-column array (`\begin{array}{r} 286 \\ +680 \\ \hline 966 \end{array}`): its rows and
    /// where the rules go (before row i; `rows.count` is under the last).
    public struct Column: Equatable, Sendable {
        public var rows: [String]
        public var rulesAbove: Set<Int>
    }

    public static func column(_ s: String) -> Column? {
        guard let r = s.range(of: #"^\\begin\{array\}\{\s*[rlc]\s*\}([\s\S]*)\\end\{array\}$"#, options: .regularExpression) else { return nil }
        var body = String(s[r])
        body = body.replacingOccurrences(of: #"^\\begin\{array\}\{\s*[rlc]\s*\}"#, with: "", options: .regularExpression)
        body = body.replacingOccurrences(of: #"\\end\{array\}$"#, with: "", options: .regularExpression)
        guard !body.contains("&") else { return nil }
        var rows: [String] = []
        var rules = Set<Int>()
        for part in body.components(separatedBy: "\\\\") {
            var p = part.trimmingCharacters(in: .whitespacesAndNewlines)
            while p.hasPrefix("\\hline") {
                rules.insert(rows.count)
                p = String(p.dropFirst(6)).trimmingCharacters(in: .whitespacesAndNewlines)
            }
            if !p.isEmpty { rows.append(p) }
        }
        return rows.isEmpty ? nil : Column(rows: rows, rulesAbove: rules)
    }
}
