import Foundation

// SAT v2, "the question is the page" (docs/SAT-V2.md): where the printed question goes on its
// problem page, in page units on the board's 1600-wide screen. The stem at the top, its figure beside
// it when the stem still reads well beside it (else under it), a roomy work area, and the answer
// cards (or the grid-in box) at the bottom. A long question makes the page taller, never the work
// area smaller than its minimum.
//
// Pure geometry: text is measured through `SATTextMeasuring` (the iPad's typesetter, or a fake in the
// tests), so the same question always gets the same page.

/// A size in page units.
public struct SATSize: Hashable, Sendable {
    public var w: Double
    public var h: Double

    public init(_ w: Double, _ h: Double) {
        self.w = w
        self.h = h
    }
}

/// A rect in page units (y down), relative to the screen's top-left.
public struct SATRect: Hashable, Sendable {
    public var x: Double
    public var y: Double
    public var w: Double
    public var h: Double

    public init(_ x: Double, _ y: Double, _ w: Double, _ h: Double) {
        self.x = x
        self.y = y
        self.w = w
        self.h = h
    }

    public var maxX: Double { x + w }
    public var maxY: Double { y + h }
    public var midX: Double { x + w / 2 }
    public var midY: Double { y + h / 2 }

    public func contains(_ px: Double, _ py: Double) -> Bool { px >= x && px <= maxX && py >= y && py <= maxY }

    public func insetBy(_ dx: Double, _ dy: Double) -> SATRect { SATRect(x + dx, y + dy, w - 2 * dx, h - 2 * dy) }

    /// Rounded to hundredths (the layout's numbers are stable to compare).
    var rounded: SATRect {
        func r(_ v: Double) -> Double { (v * 100).rounded() / 100 }
        return SATRect(r(x), r(y), r(w), r(h))
    }
}

/// Measures a stem, a choice or a label as the page prints it: Markdown-lite with inline maths,
/// wrapped at `maxWidth` (`.infinity`: one line). The size of the ink, in page units.
public protocol SATTextMeasuring {
    func measure(_ source: String, size: Double, weight: SATTextWeight, maxWidth: Double) -> SATSize
}

public enum SATTextWeight: Hashable, Sendable {
    case regular, semibold
}

/// Every size and gap of the printed page, in one place (page units on the 1600-wide screen). The
/// owner's reaction to the mockups restyles these; nothing else holds a number.
public struct SATPageStyle: Hashable, Sendable {
    public var pageWidth = 1600.0
    /// a page is never shorter than the board's 16:9 screen
    public var minHeight = 900.0
    public var left = 88.0
    public var right = 1512.0
    public var top = 60.0
    public var bottom = 36.0

    // the stem
    public var stemSize = 30.0
    // the figure
    /// beside the stem: at most this wide, and only while the stem keeps this much width
    public var figureMaxBeside = 600.0
    public var minStemBeside = 620.0
    public var figureGap = 56.0
    /// under the stem: at most this wide
    public var figureMaxBelow = 760.0
    public var stemFigureGap = 24.0
    public var noteSize = 19.0
    public var noteGap = 10.0
    /// a coordinate plane's room for its numbers and axis names round the grid
    public var plotPadLeft = 44.0
    public var plotPadRight = 34.0
    public var plotPadTop = 26.0
    public var plotPadBottom = 42.0
    public var plotMinGrid = 220.0
    public var plotMaxGrid = 400.0
    public var barGrid = 280.0
    public var shapeMinHeight = 220.0
    public var shapeMaxHeight = 380.0
    public var tableCellPadX = 22.0
    public var tableCellPadY = 12.0
    public var tableMinRow = 54.0
    public var tableSize = 25.0

    // the work area
    public var blockGap = 32.0
    /// the work area keeps at least this (four of the template's 80-unit rows)
    public var workMin = 340.0
    public var answerGap = 28.0

    // the answer cards
    public var choiceSize = 28.0
    public var cardGap = 18.0
    public var cardPadX = 20.0
    public var cardPadY = 18.0
    public var cardMinHeight = 92.0
    public var cardRadius = 24.0
    /// the letter's circle, and the gap after it
    public var letter = 52.0
    public var letterGap = 18.0
    /// the eliminator's target at the card's right end
    public var strike = 64.0

    // the grid-in
    public var gridInWidth = 560.0
    public var gridInHeight = 104.0
    public var gridInRadius = 24.0
    public var gridInLabelSize = 22.0
    public var gridInValueSize = 40.0

    public init() {}

    public static let standard = SATPageStyle()

    public var contentWidth: Double { right - left }
}

/// Where everything of one question goes on its page.
public struct SATPageLayout: Hashable, Sendable {
    public enum FigurePlace: String, Hashable, Sendable {
        case none, beside, below
    }

    /// How the answer cards sit: all four in a row, two by two, or one under another.
    public enum CardArrangement: String, Hashable, Sendable {
        case row, grid, column
    }

    /// One answer card: the whole card (the choose target), its letter, its text and the eliminator.
    public struct Card: Hashable, Sendable {
        public var key: String
        public var frame: SATRect
        public var letter: SATRect
        public var text: SATRect
        public var strike: SATRect
    }

    public var pageHeight: Double
    public var stem: SATRect
    public var figurePlace: FigurePlace
    /// the figure's whole box (its note included) and the drawing inside it
    public var figure: SATRect?
    public var figureArt: SATRect?
    /// a coordinate plane's grid (the axes' window), for page ↔ graph
    public var plotGrid: SATRect?
    public var note: SATRect?
    /// the question's ink ends here
    public var questionBottom: Double
    public var workTop: Double
    public var workBottom: Double
    public var arrangement: CardArrangement?
    public var cards: [Card]
    /// the grid-in's answer box (spr)
    public var gridIn: SATRect?
    /// everything at the bottom (the cards' or the box's extent)
    public var answers: SATRect

    /// The work area's height.
    public var workHeight: Double { workBottom - workTop }

    /// The card a page point is on (choose), and whether it is on its eliminator.
    public func card(at x: Double, _ y: Double) -> (key: String, strike: Bool)? {
        for c in cards where c.frame.contains(x, y) { return (c.key, c.strike.contains(x, y)) }
        return nil
    }

    // MARK: - laying out a question

    /// The page for `question`. Deterministic: the same question, measure and style give the same page.
    public static func make(_ q: SATQuestion, measure: SATTextMeasuring, style s: SATPageStyle = .standard) -> SATPageLayout {
        let width = s.contentWidth
        // the figure's own size at its widest, beside and below
        var place: FigurePlace = .none
        var stemWidth = width
        var figSize: SATSize?
        if let figure = q.figure {
            let beside = Self.figureSize(figure, maxWidth: s.figureMaxBeside, measure: measure, style: s)
            if width - beside.w - s.figureGap >= s.minStemBeside {
                place = .beside
                figSize = beside
                stemWidth = width - beside.w - s.figureGap
            } else {
                place = .below
                figSize = Self.figureSize(figure, maxWidth: min(width, s.figureMaxBelow), measure: measure, style: s)
            }
        }
        let stemInk = measure.measure(q.stem, size: s.stemSize, weight: .regular, maxWidth: stemWidth)
        let stem = SATRect(s.left, s.top, stemWidth, stemInk.h)

        var figure: SATRect?
        var art: SATRect?
        var note: SATRect?
        if let fig = q.figure, let size = figSize {
            let noteInk = fig.note.flatMap { $0.isEmpty ? nil : measure.measure($0, size: s.noteSize, weight: .regular, maxWidth: size.w) }
            let total = size.h + (noteInk.map { s.noteGap + $0.h } ?? 0)
            let origin = place == .beside ? (s.right - size.w, s.top) : (s.left, stem.maxY + s.stemFigureGap)
            figure = SATRect(origin.0, origin.1, size.w, total)
            art = SATRect(origin.0, origin.1, size.w, size.h)
            if let n = noteInk { note = SATRect(origin.0, origin.1 + size.h + s.noteGap, n.w, n.h) }
        }
        let questionBottom = max(stem.maxY, figure?.maxY ?? 0)

        // the answers' own height, then the page
        let answers = answerBlock(q, measure: measure, style: s)
        let workTop = questionBottom + s.blockGap
        let needed = workTop + s.workMin + s.answerGap + answers.height + s.bottom
        let pageHeight = max(s.minHeight, needed.rounded(.up))
        let answersTop = pageHeight - s.bottom - answers.height
        let workBottom = answersTop - s.answerGap

        var plotGrid: SATRect?
        if case .plot? = q.figure, let art {
            plotGrid = SATRect(art.x + s.plotPadLeft, art.y + s.plotPadTop, art.w - s.plotPadLeft - s.plotPadRight,
                               art.h - s.plotPadTop - s.plotPadBottom).rounded
        }
        let cards = answers.cards.map { c in
            Card(key: c.key, frame: c.frame.offset(answersTop).rounded, letter: c.letter.offset(answersTop).rounded,
                 text: c.text.offset(answersTop).rounded, strike: c.strike.offset(answersTop).rounded)
        }
        return SATPageLayout(
            pageHeight: pageHeight, stem: stem.rounded, figurePlace: place, figure: figure?.rounded, figureArt: art?.rounded, plotGrid: plotGrid,
            note: note?.rounded, questionBottom: (questionBottom * 100).rounded() / 100, workTop: (workTop * 100).rounded() / 100,
            workBottom: (workBottom * 100).rounded() / 100, arrangement: answers.arrangement, cards: cards,
            gridIn: answers.gridIn?.offset(answersTop).rounded, answers: SATRect(s.left, answersTop, width, answers.height).rounded)
    }

    /// A figure's size within `maxWidth`: a table as its cells need, a plane with square units where
    /// it can, a geometry figure in its own aspect.
    public static func figureSize(_ figure: SATFigure, maxWidth: Double, measure: SATTextMeasuring, style s: SATPageStyle = .standard) -> SATSize {
        switch figure {
        case .table(let t):
            let columns = max(t.headers.count, t.rows.map(\.count).max() ?? 0)
            guard columns > 0 else { return SATSize(0, 0) }
            var widths = [Double](repeating: 0, count: columns)
            var height = 0.0
            for (r, row) in ([t.headers] + t.rows).enumerated() {
                var rowH = s.tableMinRow
                for c in 0..<columns {
                    let text = c < row.count ? row[c] : ""
                    let ink = measure.measure(text.isEmpty ? " " : text, size: s.tableSize, weight: r == 0 ? .semibold : .regular, maxWidth: .infinity)
                    widths[c] = max(widths[c], ink.w + 2 * s.tableCellPadX)
                    rowH = max(rowH, ink.h + 2 * s.tableCellPadY)
                }
                height += rowH
            }
            // columns at least 120 wide (a table of short numbers is not a sliver), the whole within maxWidth
            let w = min(maxWidth, widths.map { max(120, $0) }.reduce(0, +))
            return SATSize(w.rounded(), height.rounded())
        case .plot(let p):
            let w = min(maxWidth, 560)
            let gridW = w - s.plotPadLeft - s.plotPadRight
            let xr = p.x.max - p.x.min, yr = p.y.max - p.y.min
            var gridH = xr > 0 && yr > 0 ? gridW * yr / xr : s.barGrid
            gridH = p.isBarChart ? s.barGrid : min(s.plotMaxGrid, max(s.plotMinGrid, gridH))
            return SATSize(w.rounded(), (gridH + s.plotPadTop + s.plotPadBottom).rounded())
        case .shape(let sh):
            let w = min(maxWidth, 520)
            guard let b = sh.bounds, b.maxX > b.minX else { return SATSize(w, s.shapeMinHeight) }
            let aspect = (b.maxY - b.minY) / (b.maxX - b.minX)
            let h = min(s.shapeMaxHeight, max(s.shapeMinHeight, w * aspect))
            return SATSize(w.rounded(), h.rounded())
        }
    }

    // MARK: - the answers

    struct Answers {
        var height: Double
        var arrangement: CardArrangement?
        /// y relative to the answers' top
        var cards: [Card]
        var gridIn: SATRect?
    }

    static func answerBlock(_ q: SATQuestion, measure: SATTextMeasuring, style s: SATPageStyle) -> Answers {
        let width = s.contentWidth
        switch q.format {
        case .spr:
            return Answers(height: s.gridInHeight, arrangement: nil, cards: [], gridIn: SATRect(s.left, 0, s.gridInWidth, s.gridInHeight))
        case .mcq:
            let choices = q.choices ?? []
            guard !choices.isEmpty else { return Answers(height: 0, arrangement: nil, cards: []) }
            let chrome = s.cardPadX + s.letter + s.letterGap + s.strike
            let oneLine = choices.map { measure.measure($0.text, size: s.choiceSize, weight: .regular, maxWidth: .infinity) }
            func cardWidth(_ perRow: Int) -> Double { (width - Double(perRow - 1) * s.cardGap) / Double(perRow) }
            // all in a row while every choice fits its card on one line; two by two while each fits
            // in two lines of a half-width card; else one under another
            let arrangement: CardArrangement
            if oneLine.allSatisfy({ $0.w <= cardWidth(choices.count) - chrome }) {
                arrangement = .row
            } else if choices.count > 2, oneLine.allSatisfy({ $0.w <= 2 * (cardWidth(2) - chrome) * 0.9 }) {
                arrangement = .grid
            } else {
                arrangement = .column
            }
            let perRow = arrangement == .row ? choices.count : arrangement == .grid ? 2 : 1
            let cw = cardWidth(perRow)
            let textW = cw - chrome
            var cards: [Card] = []
            var y = 0.0
            var i = 0
            while i < choices.count {
                let row = Array(choices[i..<min(choices.count, i + perRow)])
                let inks = row.map { measure.measure($0.text, size: s.choiceSize, weight: .regular, maxWidth: textW) }
                let rowH = max(s.cardMinHeight, (inks.map(\.h).max() ?? 0) + 2 * s.cardPadY)
                for (k, c) in row.enumerated() {
                    let x = s.left + Double(k) * (cw + s.cardGap)
                    let frame = SATRect(x, y, cw, rowH)
                    let letter = SATRect(x + s.cardPadX, y + (rowH - s.letter) / 2, s.letter, s.letter)
                    let text = SATRect(letter.maxX + s.letterGap, y + (rowH - inks[k].h) / 2, textW, inks[k].h)
                    let strike = SATRect(frame.maxX - s.strike, y, s.strike, rowH)
                    cards.append(Card(key: c.key, frame: frame, letter: letter, text: text, strike: strike))
                }
                y += rowH + s.cardGap
                i += perRow
            }
            return Answers(height: y - s.cardGap, arrangement: arrangement, cards: cards)
        }
    }
}

extension SATRect {
    func offset(_ dy: Double) -> SATRect { SATRect(x, y + dy, w, h) }
}
