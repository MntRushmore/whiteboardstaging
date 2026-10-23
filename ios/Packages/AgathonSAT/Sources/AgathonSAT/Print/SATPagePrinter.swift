#if os(iOS)
import AgathonBoard
import AgathonDesign
import CoreGraphics
import CoreText
import Foundation
import UIKit

/// The printed page's colours, in one place (grown-up Blocks: ink on white, chalk wells, flat fills;
/// cobalt is the tutor's alone and is never printed). Provisional until the owner reacts to the
/// mockups.
public enum SATPrintStyle {
    static func cg(_ rgb: RGB) -> CGColor { CGColor(srgbRed: rgb.r, green: rgb.g, blue: rgb.b, alpha: 1) }

    public static let ink = cg(DS.Palette.ink)
    public static let inkSecondary = cg(DS.Palette.ink2)
    public static let grid = cg(DS.Palette.line)
    public static let well = cg(DS.Palette.chalk)
    public static let paper = cg(DS.Palette.paper)
    public static let success = cg(DS.Palette.green)
    public static let tryAgain = cg(DS.Palette.sunny)
    public static let bar = cg(DS.Palette.ink2)
    /// the chosen card's ring and letter
    public static let chosen = cg(DS.Palette.ink)
    /// a struck choice's words
    public static let struck = cg(DS.Palette.ink2.mixed(with: DS.Palette.paper, amount: 0.25))
    public static let ringWidth: CGFloat = 4
}

/// How an answer card looks, from the question's state (the panel's rules of v1, on the page).
public enum SATCardLook: Hashable, Sendable {
    case plain, chosen, right, tried, struck
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
            return item.tries.contains(key) ? .tried : .plain
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

/// A question as printed on its page: the stem, the figure and the answers, as two prints (the
/// question never changes; the answers redraw as a card is chosen or struck).
public struct SATPagePrinter {
    public let question: SATQuestion
    public let layout: SATPageLayout
    public let style: SATPageStyle
    let text = SATPrintText()

    public init(question: SATQuestion, style: SATPageStyle = .standard) {
        self.question = question
        self.style = style
        layout = SATPageLayout.make(question, measure: SATPrintText(), style: style)
    }

    /// The stem and the figure.
    public func questionPrint() -> PagePrint {
        var items = text.lay(question.stem, size: style.stemSize, maxWidth: layout.stem.w, color: SATPrintStyle.ink)
            .items(at: CGPoint(x: layout.stem.x, y: layout.stem.y))
        if let figure = question.figure, let art = layout.figureArt {
            items += SATFigurePrinter(style: style, text: text).items(figure, in: art.cg, plotGrid: layout.plotGrid?.cg)
            if let note = figure.note, let r = layout.note {
                items += text.lay(note, size: style.noteSize, maxWidth: r.w, color: SATPrintStyle.inkSecondary).items(at: CGPoint(x: r.x, y: r.y))
            }
        }
        return PagePrint(key: "q:\(question.id):\(question.version ?? 0)", items: items)
    }

    /// The answer cards (or the grid-in box) as `item` has them.
    public func answersPrint(_ item: SATPractice.Item) -> PagePrint {
        var items: [PagePrint.Item] = []
        var key = "a:\(question.id)"
        for card in layout.cards {
            let look = SATCardLook.of(card.key, question, item)
            key += "|\(card.key)\(look)"
            items += cardItems(card, look: look, locked: item.verdict.isLocked)
        }
        if let box = layout.gridIn {
            key += "|\(item.typed)|\(item.verdict)"
            items += gridInItems(box, typed: item.typed, verdict: item.verdict)
        }
        return PagePrint(key: key, items: items)
    }

    // MARK: - a card

    func cardItems(_ card: SATPageLayout.Card, look: SATCardLook, locked: Bool) -> [PagePrint.Item] {
        let S = SATPrintStyle.self
        let r = CGFloat(style.cardRadius)
        let frame = card.frame.cg
        var items: [PagePrint.Item] = []
        let fill = look == .right || look == .answer ? S.paper : S.well
        items.append(.fill(CGPath(roundedRect: frame, cornerWidth: r, cornerHeight: r, transform: nil), fill))
        let ring: CGColor? = switch look {
        case .chosen: S.chosen
        case .right, .answer: S.success
        case .tried: S.tryAgain
        default: nil
        }
        if let ring {
            let inset = frame.insetBy(dx: S.ringWidth / 2, dy: S.ringWidth / 2)
            items.append(.stroke(CGPath(roundedRect: inset, cornerWidth: r - 2, cornerHeight: r - 2, transform: nil), ring, width: S.ringWidth, dash: []))
        }
        // the letter in its circle (chosen: filled ink; right: green with a tick)
        let circle = card.letter.cg
        let (bg, fg): (CGColor, CGColor) = switch look {
        case .chosen: (S.chosen, S.paper)
        case .right, .answer: (S.success, S.paper)
        case .tried: (S.tryAgain, S.ink)
        case .struck: (S.paper, S.inkSecondary)
        case .plain: (S.paper, S.ink)
        }
        items.append(.fill(CGPath(ellipseIn: circle, transform: nil), bg))
        if look == .right || look == .answer {
            items.append(.stroke(Self.tick(in: circle.insetBy(dx: circle.width * 0.27, dy: circle.height * 0.3)), fg, width: 4.5, dash: []))
        } else {
            items.append(centered(card.key, size: style.choiceSize * 0.8, weight: .semibold, color: fg, in: circle))
        }
        // the choice
        let color = look == .struck ? S.struck : S.ink
        let laid = text.lay(choiceText(card.key), size: style.choiceSize, maxWidth: card.text.w, color: color, displayLone: true)
        items += laid.items(at: CGPoint(x: card.text.x, y: card.frame.midY - laid.size.h / 2))
        if look == .struck {
            let line = CGMutablePath()
            let y = card.frame.midY
            line.move(to: CGPoint(x: card.text.x - 4, y: y))
            line.addLine(to: CGPoint(x: card.text.x + laid.size.w + 4, y: y))
            items.append(.stroke(line, S.inkSecondary, width: 2.5, dash: []))
        }
        // the eliminator: the letter in a small ring with a line through it; struck, "Undo"
        if !locked {
            let s = card.strike.cg
            if look == .struck {
                items.append(centered("Undo", size: 19, weight: .semibold, color: S.ink, in: s))
            } else {
                let d: CGFloat = 32
                let ring = CGRect(x: s.midX - d / 2, y: s.midY - d / 2, width: d, height: d)
                items.append(.stroke(CGPath(ellipseIn: ring, transform: nil), S.inkSecondary, width: 2, dash: []))
                items.append(centered(card.key, size: 16, weight: .semibold, color: S.inkSecondary, in: ring))
                let slash = CGMutablePath()
                slash.move(to: CGPoint(x: ring.minX - 4, y: ring.maxY + 2))
                slash.addLine(to: CGPoint(x: ring.maxX + 4, y: ring.minY - 2))
                items.append(.stroke(slash, S.inkSecondary, width: 2, dash: []))
            }
        }
        return items
    }

    func choiceText(_ key: String) -> String { question.choices?.first { $0.key == key }?.text ?? "" }

    // MARK: - the grid-in

    func gridInItems(_ box: SATRect, typed: String, verdict: SATPractice.Verdict) -> [PagePrint.Item] {
        let S = SATPrintStyle.self
        let r = CGFloat(style.gridInRadius)
        let frame = box.cg
        var items: [PagePrint.Item] = [.fill(CGPath(roundedRect: frame, cornerWidth: r, cornerHeight: r, transform: nil), S.well)]
        let ring: CGColor? = switch verdict {
        case .right: S.success
        case .lookAgain, .missed: S.tryAgain
        case .open: typed.isEmpty ? nil : S.chosen
        }
        if let ring {
            items.append(.stroke(CGPath(roundedRect: frame.insetBy(dx: 2, dy: 2), cornerWidth: r - 2, cornerHeight: r - 2, transform: nil),
                                 ring, width: S.ringWidth, dash: []))
        }
        let label = RenderFonts.line(SATCopy.gridInLabel, size: style.gridInLabelSize, weight: .semibold, color: S.inkSecondary)
        items.append(.text(label, at: CGPoint(x: frame.minX + 26, y: frame.minY + 36)))
        let shown = typed.isEmpty ? SATCopy.gridInTap : SATGridIn.display(typed)
        let value = RenderFonts.line(shown, size: typed.isEmpty ? style.gridInLabelSize : style.gridInValueSize, weight: typed.isEmpty ? .regular : .semibold,
                                     color: typed.isEmpty ? S.inkSecondary : S.ink)
        items.append(.text(value, at: CGPoint(x: frame.minX + 26, y: frame.maxY - 22)))
        // the rules beside the box
        let rules = text.lay(SATCopy.gridInRules, size: 19, maxWidth: min(560, style.right - frame.maxX - 40), color: S.inkSecondary)
        items += rules.items(at: CGPoint(x: frame.maxX + 32, y: frame.midY - rules.size.h / 2))
        return items
    }

    // MARK: - small parts

    func centered(_ s: String, size: Double, weight: RenderFonts.Weight, color: CGColor, in rect: CGRect) -> PagePrint.Item {
        let line = RenderFonts.line(s, size: size, weight: weight, color: color)
        var a: CGFloat = 0, d: CGFloat = 0, l: CGFloat = 0
        let w = CTLineGetTypographicBounds(line, &a, &d, &l)
        return .text(line, at: CGPoint(x: rect.midX - w / 2, y: rect.midY + (a - d) / 2))
    }

    static func tick(in r: CGRect) -> CGPath {
        let p = CGMutablePath()
        p.move(to: CGPoint(x: r.minX, y: r.minY + r.height * 0.55))
        p.addLine(to: CGPoint(x: r.minX + r.width * 0.38, y: r.maxY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.minY))
        return p
    }
}

extension SATRect {
    var cg: CGRect { CGRect(x: x, y: y, width: w, height: h) }
}
#endif
