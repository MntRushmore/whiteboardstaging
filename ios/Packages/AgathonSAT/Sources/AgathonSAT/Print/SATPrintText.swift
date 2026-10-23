#if os(iOS)
import AgathonBoard
import AgathonDesign
import CoreGraphics
import CoreText
import Foundation
import UIKit

/// A stem, a choice or a label set for the printed page (SAT v2, docs/SAT-V2.md): `SATRichText`'s
/// Markdown-lite in Lexend, the maths typeset by the board's typesetter (SwiftMath, Latin Modern) on
/// the words' baseline, wrapped at a width, in page units. The layout engine measures with it
/// (`SATTextMeasuring`), so what is measured is what is printed.
public struct SATPrintText: SATTextMeasuring {
    public init() {
        _ = DSFonts.register()
    }

    /// The words and maths of `source`, set at `size` in `color`, wrapped at `maxWidth`.
    public struct Laid {
        public var size: SATSize
        /// items relative to the text's top-left
        let items: [PagePrint.Item]

        /// The items with the text's top-left at `origin`.
        public func items(at origin: CGPoint) -> [PagePrint.Item] {
            guard origin != .zero else { return items }
            let t = CGAffineTransform(translationX: origin.x, y: origin.y)
            return items.map { $0.moved(t) }
        }
    }

    public func measure(_ source: String, size: Double, weight: SATTextWeight, maxWidth: Double) -> SATSize {
        lay(source, size: size, weight: weight, maxWidth: maxWidth, color: SATPrintStyle.ink).size
    }

    /// One piece a line is made of.
    private enum Piece {
        case word(String, bold: Bool)
        case space
        case math(TypesetMath)
        case newline
    }

    public func lay(_ source: String, size: Double, weight: SATTextWeight = .regular, maxWidth: Double, color: CGColor,
                    align: Align = .leading, displayLone: Bool = false) -> Laid {
        let blocks = SATRichText.parse(source)
        var pieces: [Piece] = []
        func inline(_ nodes: [SATInline], bold: Bool) {
            for n in nodes {
                switch n {
                case .text(let t):
                    let parts = t.components(separatedBy: " ")
                    for (i, p) in parts.enumerated() {
                        if i > 0 { pieces.append(.space) }
                        if !p.isEmpty { pieces.append(.word(Self.numeral(p), bold: bold)) }
                    }
                case .bold(let c): inline(c, bold: true)
                case .math(let latex):
                    var l = latex
                    // a choice that is one fraction sets it full size, as the test does
                    if displayLone, nodes.count == 1, l.contains("frac") { l = "\\displaystyle " + l }
                    pieces.append(.math(math(l, size: size, color: color, display: false)))
                }
            }
        }
        for (i, b) in blocks.enumerated() {
            if i > 0 { pieces.append(.newline) }
            switch b {
            case .paragraph(let nodes): inline(nodes, bold: weight == .semibold)
            case .math(let latex): pieces.append(.math(math(latex, size: size, color: color, display: true)))
            case .bullets(let items):
                for (k, item) in items.enumerated() {
                    if k > 0 { pieces.append(.newline) }
                    pieces.append(.word("•", bold: false))
                    pieces.append(.space)
                    inline(item, bold: weight == .semibold)
                }
            }
        }
        return layout(pieces, size: size, maxWidth: maxWidth, color: color, align: align)
    }

    public enum Align { case leading, center }

    // MARK: - lines

    private struct Run {
        var x: Double
        var width: Double
        var ascent: Double
        var descent: Double
        var item: (CGPoint) -> PagePrint.Item
    }

    private func layout(_ pieces: [Piece], size: Double, maxWidth: Double, color: CGColor, align: Align) -> Laid {
        let regular = font(size, bold: false), semibold = font(size, bold: true)
        let space = width(" ", regular)
        let lineAscent = Double(CTFontGetAscent(regular)), lineDescent = Double(CTFontGetDescent(regular))
        let leading = size * 0.38
        var lines: [[Run]] = [[]]
        var x = 0.0
        var pendingSpace = false
        func place(_ w: Double, _ a: Double, _ d: Double, _ make: @escaping (CGPoint) -> PagePrint.Item) {
            let gap = pendingSpace && x > 0 ? space : 0
            if x > 0 && x + gap + w > maxWidth + 0.5 {
                lines.append([])
                x = 0
            } else {
                x += gap
            }
            lines[lines.count - 1].append(Run(x: x, width: w, ascent: a, descent: d, item: make))
            x += w
            pendingSpace = false
        }
        for p in pieces {
            switch p {
            case .space: pendingSpace = true
            case .newline:
                lines.append([])
                x = 0
                pendingSpace = false
            case .word(let w, let bold):
                let line = RenderFonts.line(w, size: size, weight: bold ? .semibold : .regular, color: color)
                let f = bold ? semibold : regular
                let ww = Double(CTLineGetTypographicBounds(line, nil, nil, nil))
                place(ww, Double(CTFontGetAscent(f)), Double(CTFontGetDescent(f))) { .text(line, at: $0) }
            case .math(let m):
                place(m.width, max(m.ascent, lineAscent * 0.8), m.descent) { .math(m, at: $0) }
            }
        }
        // stack the lines: each as tall as its tallest piece, a leading between
        var items: [PagePrint.Item] = []
        var y = 0.0
        var widest = 0.0
        let nonEmpty = lines.filter { !$0.isEmpty }
        for (i, line) in nonEmpty.enumerated() {
            let a = max(lineAscent, line.map(\.ascent).max() ?? 0)
            let d = max(lineDescent, line.map(\.descent).max() ?? 0)
            let w = (line.last.map { $0.x + $0.width }) ?? 0
            widest = max(widest, w)
            let dx = align == .center && maxWidth.isFinite ? (maxWidth - w) / 2 : 0
            let baseline = y + a
            for r in line { items.append(r.item(CGPoint(x: r.x + dx, y: baseline))) }
            y = baseline + d + (i + 1 < nonEmpty.count ? leading : 0)
        }
        return Laid(size: SATSize(maxWidth.isFinite && align == .center ? maxWidth : widest, y), items: items)
    }

    // MARK: - pieces

    func font(_ size: Double, bold: Bool) -> CTFont { RenderFonts.font(size, bold ? .semibold : .regular) }

    func width(_ s: String, _ f: CTFont) -> Double {
        let str = CFAttributedStringCreate(nil, s as CFString, [kCTFontAttributeName: f] as CFDictionary)!
        return Double(CTLineGetTypographicBounds(CTLineCreateWithAttributedString(str), nil, nil, nil))
    }

    /// Latin Modern runs small beside Lexend: a little bigger, a fraction bigger still (as the panel did).
    func math(_ latex: String, size: Double, color: CGColor, display: Bool) -> TypesetMath {
        let k = display ? 1.24 : latex.contains("frac") && !latex.hasPrefix("\\displaystyle") ? 1.3 : 1.12
        return MathRendering.typeset(latex, fontSize: size * k, color: color)
    }

    /// A plain negative number with a real minus sign ("-3" → "−3").
    static func numeral(_ text: String) -> String {
        text.range(of: #"^-\d"#, options: .regularExpression) != nil ? "−" + text.dropFirst() : text
    }
}

extension PagePrint.Item {
    /// The item moved by `t` (a translation).
    func moved(_ t: CGAffineTransform) -> PagePrint.Item {
        switch self {
        case .fill(let p, let c): return .fill(p.copy(using: [t]) ?? p, c)
        case .stroke(let p, let c, let w, let d): return .stroke(p.copy(using: [t]) ?? p, c, width: w, dash: d)
        case .text(let l, let at): return .text(l, at: at.applying(t))
        case .math(let m, let at): return .math(m, at: at.applying(t))
        case .clip(let r, let inner): return .clip(r.applying(t), inner.map { $0.moved(t) })
        }
    }
}

extension CGPath {
    func copy(using t: [CGAffineTransform]) -> CGPath? {
        var m = t.first ?? .identity
        return copy(using: &m)
    }
}
#endif
