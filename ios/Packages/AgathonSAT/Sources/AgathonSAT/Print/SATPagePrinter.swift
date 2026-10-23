#if os(iOS)
import AgathonBoard
import AgathonDesign
import CoreGraphics
import CoreText
import Foundation
import UIKit

/// The printed page's colours, in one place (grown-up Blocks, docs/sat2/DESIGN-NOTES.md "Colours":
/// ink on white, chalk wells, flat fills; cobalt is the tutor's alone and is never printed; sunny is
/// Look again, green only on the checked right card).
public enum SATPrintStyle {
    static func cg(_ rgb: RGB) -> CGColor { CGColor(srgbRed: rgb.r, green: rgb.g, blue: rgb.b, alpha: 1) }

    public static let ink = cg(DS.Palette.ink)
    public static let inkSecondary = cg(DS.Palette.ink2)
    /// the grid, the table's hairlines
    public static let line = cg(DS.Palette.line)
    public static let well = cg(DS.Palette.chalk)
    public static let paper = cg(DS.Palette.paper)
    public static let success = cg(DS.Palette.green)
    public static let tryAgain = cg(DS.Palette.sunny)
    public static let focus = cg(DS.Palette.cobalt)
    /// a crossed-out choice, the eliminator's ×
    public static let faint = cg(RGB(0xA3A6B4))
    /// the keypad's symbol keys
    public static let guide = cg(RGB(0xE6E8EE))
    public static let bar = cg(DS.Palette.ink2)
    /// the dotted paper (`templateDot`)
    public static let dot = cg(RGB(0xD3D6DF))
}

/// How an answer card looks, from the question's state.
public enum SATCardLook: Hashable, Sendable {
    case plain, chosen, struck
    /// checked and not right: Look again (sunny, never red)
    case tried
    /// checked right
    case right
    /// the right answer, shown once the question is missed
    case answer

    public static func of(_ key: String, _ q: SATQuestion, _ item: SATPractice.Item) -> SATCardLook {
        switch item.verdict {
        case .right:
            return key == item.chosen ? .right : (item.eliminated.contains(key) ? .struck : .plain)
        case .missed:
            if key == q.answer.key { return .answer }
            if item.tries.contains(key) { return .tried }
            return item.eliminated.contains(key) ? .struck : .plain
        case .lookAgain, .open:
            if item.eliminated.contains(key) { return .struck }
            if key == item.chosen { return item.tries.contains(key) ? .tried : .chosen }
            // a choice tried before, now not chosen: back to plain (its note said why)
            return .plain
        }
    }

    public var spoken: String {
        switch self {
        case .plain: ""
        case .chosen: "Chosen"
        case .right: "Right"
        case .tried: "Not this one"
        case .struck: "Crossed out"
        case .answer: "The answer"
        }
    }
}

/// A question as printed on its page: the number, the stem and the figure (one print, never
/// changing) and the answer row (another, drawn again as a card is chosen or struck, or the grid-in
/// is typed).
public struct SATPagePrinter {
    public let question: SATQuestion
    public let layout: SATPageLayout
    public let style: SATPageStyle
    public let number: Int
    let text = SATPrintText()

    public init(question: SATQuestion, number: Int, viewport: SATViewport, lowestInk: Double? = nil, style: SATPageStyle = .standard) {
        self.question = question
        self.style = style
        self.number = number
        layout = SATPageLayout.make(question, measure: SATPrintText(), viewport: viewport, lowestInk: lowestInk, style: style)
    }

    /// The number, the stem and the figure.
    public func questionPrint() -> PagePrint {
        let S = SATPrintStyle.self
        var items: [PagePrint.Item] = []
        if let box = layout.number {
            let r = CGFloat(style.numberRadius)
            items.append(.fill(CGPath(roundedRect: box.cg, cornerWidth: r, cornerHeight: r, transform: nil), S.ink))
            items.append(centered("\(number)", size: style.numberSize, weight: .semibold, color: S.paper, in: box.cg))
        }
        items += text.lay(question.stem, size: style.stemSize, maxWidth: layout.stem.w, color: S.ink, lineHeight: style.stemLine,
                          paragraphGap: style.paragraphGap).items(at: CGPoint(x: layout.stem.x, y: layout.stem.y))
        if let figure = question.figure, let art = layout.figureArt {
            items += SATFigurePrinter(style: style, text: text).items(figure, in: art.cg, plotGrid: layout.plotGrid?.cg)
            if let note = figure.note, let r = layout.note {
                items += text.lay(note, size: style.noteSize, maxWidth: max(r.w, 300), color: S.inkSecondary).items(at: CGPoint(x: r.x, y: r.y))
            }
        }
        return PagePrint(key: "q:\(question.id):\(question.version ?? 0):\(number)", items: items)
    }

    /// The answer row as `item` has it; `active`: the grid-in's field is being typed in.
    public func answersPrint(_ item: SATPractice.Item, active: Bool = false) -> PagePrint {
        var items: [PagePrint.Item] = []
        var key = "a:\(question.id):\(layout.rowTop)"
        for card in layout.cards {
            let look = SATCardLook.of(card.key, question, item)
            key += "|\(card.key)\(look)"
            items += cardItems(card, look: look, locked: item.verdict.isLocked)
        }
        if let field = layout.gridIn {
            key += "|\(item.typed)|\(item.verdict)|\(active)"
            items += gridInItems(field, typed: item.typed, verdict: item.verdict, active: active)
        }
        return PagePrint(key: key, items: items)
    }

    // MARK: - a card

    func cardItems(_ card: SATPageLayout.Card, look: SATCardLook, locked: Bool) -> [PagePrint.Item] {
        let S = SATPrintStyle.self
        let r = CGFloat(style.cardRadius)
        let frame = card.frame.cg
        let (fill, textColor, letterFill, letterText): (CGColor, CGColor, CGColor, CGColor) = switch look {
        case .plain: (S.well, S.ink, S.paper, S.ink)
        case .chosen: (S.ink, S.paper, S.paper, S.ink)
        case .struck: (S.well, S.faint, S.paper, S.faint)
        case .tried: (S.tryAgain, S.ink, S.paper, S.ink)
        case .right, .answer: (S.success, S.paper, S.paper, S.ink)
        }
        var items: [PagePrint.Item] = [.fill(CGPath(roundedRect: frame, cornerWidth: r, cornerHeight: r, transform: nil), fill)]
        let circle = card.letter.cg
        items.append(.fill(CGPath(ellipseIn: circle, transform: nil), letterFill))
        items.append(centered(card.key, size: style.letterSize, weight: .semibold, color: letterText, in: circle))
        // the choice, a fraction in display style so it reads at full size
        let laid = text.lay(choiceText(card.key), size: style.choiceSize, maxWidth: card.text.w, color: textColor, displayLone: true)
        let origin = CGPoint(x: card.text.x, y: card.frame.midY - laid.size.h / 2)
        items += laid.items(at: origin)
        let s = card.strike.cg
        let d = CGFloat(style.strikeCircle)
        let ring = CGRect(x: s.midX - d / 2 - 6, y: s.midY - d / 2, width: d, height: d)
        switch look {
        case .struck:
            // a stroke through the choice at −18°, so it never hides in a fraction bar
            let w = laid.size.w + 16, cx = origin.x + laid.size.w / 2, cy = card.frame.midY
            let dx = CGFloat(cos(18 * Double.pi / 180)) * w / 2, dy = CGFloat(sin(18 * Double.pi / 180)) * w / 2
            let slash = CGMutablePath()
            slash.move(to: CGPoint(x: cx - dx, y: cy + dy))
            slash.addLine(to: CGPoint(x: cx + dx, y: cy - dy))
            items.append(.stroke(slash, S.inkSecondary, width: 3, dash: []))
            // the eliminator becomes undo (↺) on a paper circle
            items.append(.fill(CGPath(ellipseIn: ring, transform: nil), S.paper))
            items.append(.stroke(Self.undo(in: ring.insetBy(dx: 12, dy: 12)), S.ink, width: 2.6, dash: []))
        case .right, .answer:
            items.append(.stroke(Self.tick(in: ring.insetBy(dx: 10, dy: 13)), S.paper, width: 4, dash: []))
        case .plain, .chosen:
            if !locked { items.append(.stroke(Self.cross(in: ring.insetBy(dx: 15, dy: 15)), look == .chosen ? S.faint : S.faint, width: 2.6, dash: [])) }
        case .tried:
            break
        }
        return items
    }

    func choiceText(_ key: String) -> String { question.choices?.first { $0.key == key }?.text ?? "" }

    // MARK: - the grid-in

    func gridInItems(_ field: SATRect, typed: String, verdict: SATPractice.Verdict, active: Bool) -> [PagePrint.Item] {
        let S = SATPrintStyle.self
        let r = CGFloat(style.gridInRadius)
        let box = field.cg
        var items: [PagePrint.Item] = []
        // "YOUR ANSWER" over the field
        let label = RenderFonts.line(SATCopy.gridInLabel.uppercased(), size: style.gridInLabelSize, weight: .semibold, color: S.inkSecondary)
        items.append(.text(label, at: CGPoint(x: box.minX, y: layout.rowTop + 10)))
        let fill: CGColor = switch verdict {
        case .right: S.success
        case .lookAgain, .missed: S.tryAgain
        case .open: S.well
        }
        items.append(.fill(CGPath(roundedRect: box, cornerWidth: r, cornerHeight: r, transform: nil), fill))
        if active && !verdict.isLocked {
            items.append(.stroke(CGPath(roundedRect: box.insetBy(dx: 1.5, dy: 1.5), cornerWidth: r - 1, cornerHeight: r - 1, transform: nil), S.focus, width: 3, dash: []))
        }
        let valueColor = verdict == .right(firstTry: true) || verdict == .right(firstTry: false) ? S.paper : S.ink
        var caretX = box.minX + 28
        if !typed.isEmpty {
            let value = RenderFonts.line(SATGridIn.display(typed), size: style.gridInValueSize, weight: .medium, color: valueColor)
            items.append(.text(value, at: CGPoint(x: box.minX + 28, y: box.midY + 14)))
            caretX += CTLineGetTypographicBounds(value, nil, nil, nil) + 3
        } else if !active {
            let hint = RenderFonts.line(SATCopy.gridInTap, size: 20, color: S.inkSecondary)
            items.append(.text(hint, at: CGPoint(x: box.minX + 28, y: box.midY + 7)))
        }
        if active && !verdict.isLocked {
            // the caret, cobalt
            items.append(.fill(CGPath(rect: CGRect(x: caretX, y: box.midY - 22, width: 3, height: 44), transform: nil), S.focus))
        }
        if let rules = layout.gridInRules, rules.w > 80 {
            let laid = text.lay(SATCopy.gridInRulesShort, size: style.gridInRulesSize, maxWidth: rules.w, color: S.inkSecondary)
            items += laid.items(at: CGPoint(x: rules.x, y: rules.midY - laid.size.h / 2))
        }
        // the keypad: digits on chalk, the symbols and delete on guide grey
        if !verdict.isLocked {
            let kr = CGFloat(style.keyRadius)
            for k in layout.keys {
                let f = k.frame.cg
                let digit: Bool = if case .digit = k.key { true } else { false }
                items.append(.fill(CGPath(roundedRect: f, cornerWidth: kr, cornerHeight: kr, transform: nil), digit ? S.well : S.guide))
                if k.key == .delete {
                    items.append(.stroke(Self.deleteGlyph(in: f.insetBy(dx: 32, dy: 20)), S.ink, width: 2.6, dash: []))
                } else {
                    let ch = k.key == .minus ? "−" : String(k.key.character ?? " ")
                    items.append(centered(ch, size: style.keySize, weight: .semibold, color: S.ink, in: f))
                }
            }
        }
        return items
    }

    // MARK: - small parts

    func centered(_ s: String, size: Double, weight: RenderFonts.Weight, color: CGColor, in rect: CGRect) -> PagePrint.Item {
        let line = RenderFonts.line(s, size: size, weight: weight, color: color)
        var a: CGFloat = 0, d: CGFloat = 0, l: CGFloat = 0
        let w = CTLineGetTypographicBounds(line, &a, &d, &l)
        // centred on the cap height (digits and capitals sit in the middle)
        let cap = CTFontGetCapHeight(RenderFonts.font(size, weight))
        return .text(line, at: CGPoint(x: rect.midX - w / 2, y: rect.midY + cap / 2))
    }

    static func tick(in r: CGRect) -> CGPath {
        let p = CGMutablePath()
        p.move(to: CGPoint(x: r.minX, y: r.minY + r.height * 0.55))
        p.addLine(to: CGPoint(x: r.minX + r.width * 0.38, y: r.maxY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.minY))
        return p
    }

    static func cross(in r: CGRect) -> CGPath {
        let p = CGMutablePath()
        p.move(to: CGPoint(x: r.minX, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY))
        p.move(to: CGPoint(x: r.maxX, y: r.minY))
        p.addLine(to: CGPoint(x: r.minX, y: r.maxY))
        return p
    }

    /// ↺: most of a circle and its arrowhead.
    static func undo(in r: CGRect) -> CGPath {
        let p = CGMutablePath()
        let c = CGPoint(x: r.midX, y: r.midY), rad = r.width / 2
        p.addArc(center: c, radius: rad, startAngle: -.pi * 0.85, endAngle: .pi * 0.75, clockwise: false)
        let start = CGPoint(x: c.x + rad * cos(-.pi * 0.85), y: c.y + rad * sin(-.pi * 0.85))
        p.move(to: CGPoint(x: start.x - 1, y: start.y - 7))
        p.addLine(to: start)
        p.addLine(to: CGPoint(x: start.x + 7, y: start.y + 1))
        return p
    }

    /// ⌫: a key outline pointing left, an × in it.
    static func deleteGlyph(in r: CGRect) -> CGPath {
        let p = CGMutablePath()
        let tip = r.height * 0.45
        p.move(to: CGPoint(x: r.minX, y: r.midY))
        p.addLine(to: CGPoint(x: r.minX + tip, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY))
        p.addLine(to: CGPoint(x: r.minX + tip, y: r.maxY))
        p.closeSubpath()
        let cx = r.minX + tip + (r.width - tip) / 2, cy = r.midY, s = r.height * 0.22
        p.move(to: CGPoint(x: cx - s, y: cy - s))
        p.addLine(to: CGPoint(x: cx + s, y: cy + s))
        p.move(to: CGPoint(x: cx + s, y: cy - s))
        p.addLine(to: CGPoint(x: cx - s, y: cy + s))
        return p
    }
}

extension SATRect {
    var cg: CGRect { CGRect(x: x, y: y, width: w, height: h) }
}
#endif
