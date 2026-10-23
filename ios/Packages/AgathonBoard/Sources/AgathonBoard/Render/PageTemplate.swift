import CoreGraphics
import CoreText
import Foundation

/// A problem page's template as vector paths in page space (docs/PROBLEM-PAGES.md, "The page"):
/// "Work it out here", the guide lines, the answer spot and its "Answer:" — and, for a problem that
/// needed more room, "Problem 2, continued" at the top of the pages after its first and "Answer on the
/// next page" where the answer spot was on the pages before its last. Never ink, never a
/// record: the canvas draws it under the ink (`BoardCanvasView`'s template layer, crisp at any zoom),
/// the thumbnail draws it on white. Text is turned into glyph outlines, so it is vector too.
public struct PageTemplate: @unchecked Sendable {
    /// What the template draws, each part in one colour.
    public struct Colors: Equatable, @unchecked Sendable {
        /// the guide lines
        public var rule: CGColor
        /// "Work it out here"
        public var label: CGColor
        /// the answer spot's fill
        public var answer: CGColor
        /// "Answer:"
        public var answerLabel: CGColor

        public init(rule: CGColor, label: CGColor, answer: CGColor, answerLabel: CGColor) {
            self.rule = rule
            self.label = label
            self.answer = answer
            self.answerLabel = answerLabel
        }

        private static func rgb(_ hex: UInt32) -> CGColor {
            CGColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
        }

        /// Blocks (flat): rules a shade off the chalk, a light grey label, the answer spot in chalk,
        /// "Answer:" in ink secondary.
        public static let blocks = Colors(rule: rgb(0xE6E8EE), label: rgb(0xA3A6B4), answer: rgb(0xF1F2F6), answerLabel: rgb(0x5B5E6E))
    }

    /// stroked at `ruleWidth`, round caps
    public let rules: CGPath
    public let ruleWidth: CGFloat
    /// filled in `label`
    public let label: CGPath
    /// filled in `answer`
    public let answer: CGPath
    /// filled in `answerLabel`
    public let answerLabel: CGPath
    /// filled in `answerLabel` too: "Problem 2, continued", "Answer on the next page" ("More room")
    public let notes: CGPath

    /// The work label's and the answer label's words (kid copy).
    public static let workWords = "Work it out here"
    public static let answerWords = "Answer:"
    /// "More room": the top of a page that continues a problem, and where the answer spot was
    public static func continuedWords(_ index: Int?) -> String { index.map { "Problem \($0), continued" } ?? "Continued" }
    public static let answerOnNextWords = "Answer on the next page"

    /// The template for `page` on a screen of `rect` (page units); nil for the All done page, which
    /// draws nothing on the page.
    public init?(page: ProblemPage, screen rect: Box) {
        guard page.kind == .problem else { return nil }
        let k = rect.w / Box.screen.w
        let L = ProblemPageLayout.self
        let top = page.resolvedWorkTop
        func at(_ x: Double, _ y: Double) -> CGPoint { L.place(Vec2(x, y), on: rect).cgPoint }

        let rules = CGMutablePath()
        for y in L.rules(workTop: top, bottom: page.resolvedWorkBottom) {
            rules.move(to: at(L.ruleLeft, y))
            rules.addLine(to: at(L.ruleRight, y))
        }
        self.rules = rules
        ruleWidth = CGFloat(L.ruleWidth * k)

        // a continued page says so at its top, and its work needs no invitation
        let notes = CGMutablePath()
        if page.isContinuation {
            label = CGMutablePath()
            notes.addPath(Self.text(Self.continuedWords(page.inSet ? page.index : nil), size: L.continuedSize * k, weight: .semibold,
                                    baseline: at(L.problemOrigin.x, L.continuedBaseline)))
        } else {
            label = Self.text(Self.workWords, size: L.workLabelSize * k, weight: .regular, baseline: at(L.ruleLeft, top + L.workLabelBaseline))
            // a page whose problem is shown elsewhere says which it is, small (SAT mode: "Q3 · Linear functions")
            if let heading = page.heading, !heading.isEmpty {
                notes.addPath(Self.text(heading, size: L.continuedSize * k, weight: .semibold, baseline: at(L.problemOrigin.x, L.continuedBaseline)))
            }
        }

        if page.hasAnswerSpot {
            let box = L.place(L.answer, on: rect)
            let r = CGFloat(L.answerRadius * k)
            answer = CGPath(roundedRect: box.cgRect, cornerWidth: r, cornerHeight: r, transform: nil)
            // "Answer:" sits on the box's middle: its baseline a third of its size below the middle
            let size = L.answerLabelSize * k
            answerLabel = Self.text(Self.answerWords, size: size, weight: .semibold,
                                    baseline: CGPoint(x: box.x + L.answerLabelInset * k, y: box.y + box.h / 2 + size * 0.36))
        } else {
            answer = CGMutablePath()
            answerLabel = CGMutablePath()
            if page.more && page.answer {
                // the answer spot moved on: where it was, a word to say so
                let box = L.place(L.answer, on: rect)
                let size = L.workLabelSize * k
                notes.addPath(Self.text(Self.answerOnNextWords, size: size, weight: .semibold,
                                        baseline: CGPoint(x: box.x, y: box.y + box.h / 2 + size * 0.36)))
            }
        }
        self.notes = notes
    }

    /// The template drawn into a page-space context (y down), under the ink.
    public func draw(in ctx: CGContext, colors: Colors) {
        ctx.saveGState()
        ctx.setFillColor(colors.answer)
        ctx.addPath(answer)
        ctx.fillPath()
        ctx.setFillColor(colors.answerLabel)
        ctx.addPath(answerLabel)
        ctx.addPath(notes)
        ctx.fillPath()
        ctx.setFillColor(colors.label)
        ctx.addPath(label)
        ctx.fillPath()
        ctx.setStrokeColor(colors.rule)
        ctx.setLineWidth(ruleWidth)
        ctx.setLineCap(.round)
        ctx.addPath(rules)
        ctx.strokePath()
        ctx.restoreGState()
    }

    /// `words` as glyph outlines, its baseline starting at `baseline` (page space, y down).
    static func text(_ words: String, size: Double, weight: RenderFonts.Weight, baseline: CGPoint) -> CGPath {
        let font = RenderFonts.font(size, weight)
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: words, attributes: [kCTFontAttributeName as NSAttributedString.Key: font]))
        let out = CGMutablePath()
        guard let runs = CTLineGetGlyphRuns(line) as? [CTRun] else { return out }
        for run in runs {
            let n = CTRunGetGlyphCount(run)
            guard n > 0 else { continue }
            // the run's own font (CoreText may have fallen back for a glyph)
            let attrs = CTRunGetAttributes(run) as NSDictionary
            let runFont: CTFont
            if let f = attrs[kCTFontAttributeName as String] {
                runFont = f as! CTFont
            } else {
                runFont = font
            }
            var glyphs = [CGGlyph](repeating: 0, count: n)
            var positions = [CGPoint](repeating: .zero, count: n)
            CTRunGetGlyphs(run, CFRange(location: 0, length: n), &glyphs)
            CTRunGetPositions(run, CFRange(location: 0, length: n), &positions)
            for i in 0..<n {
                guard let glyph = CTFontCreatePathForGlyph(runFont, glyphs[i], nil) else { continue }
                // a glyph's outline is y up from its baseline: flip it into page space (y down)
                let t = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: baseline.x + positions[i].x, ty: baseline.y - positions[i].y)
                out.addPath(glyph, transform: t)
            }
        }
        return out
    }
}
