import Foundation

// SAT v2, "the question is the page" (docs/SAT-V2.md; the design lane's rules,
// docs/sat2/DESIGN-NOTES.md on feat/sat2-design): where the printed question goes on its page, in
// page units on a page 1600 wide in both orientations. The number in the margin, the stem at the
// top, its figure beside it when it fits (else under it), dotted work paper in an L round them, the
// answer row at the bottom over the dock's lane. A long question, or ink low on the page, makes the
// page taller, never the work area smaller than its minimums.
//
// Pure geometry: text is measured through `SATTextMeasuring` (the iPad's typesetter, or a fake in the
// tests), so the same question in the same window always gets the same page.

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

    func offset(_ dy: Double) -> SATRect { SATRect(x, y + dy, w, h) }
}

/// Measures a stem, a choice or a label as the page prints it: Markdown-lite with inline maths,
/// wrapped at `maxWidth` (`.infinity`: one line). The size of the ink, in page units.
public protocol SATTextMeasuring {
    func measure(_ source: String, size: Double, weight: SATTextWeight, maxWidth: Double) -> SATSize
    /// The stem, as printed: its fixed line (40) and paragraph gap (14).
    func measureStem(_ source: String, style: SATPageStyle, maxWidth: Double) -> SATSize
}

extension SATTextMeasuring {
    public func measureStem(_ source: String, style: SATPageStyle, maxWidth: Double) -> SATSize {
        measure(source, size: style.stemSize, weight: .regular, maxWidth: maxWidth)
    }
}

public enum SATTextWeight: Hashable, Sendable {
    case regular, semibold
}

/// The window the page is shown in, in page units (the camera fits the page's width: 1 u is
/// window width / 1600 points). Landscape on a 13-inch iPad: 1366 × 1024 pt → 1600 × 1199 u, a dock
/// lane of 110 pt = 129 u. Upright: 1024 × 1366 pt → 1600 × 2134 u, a lane of 172 u.
public struct SATViewport: Hashable, Sendable {
    /// the window's height
    public var height: Double
    /// the last 110 pt of the window, where the dock floats
    public var dockLane: Double

    public init(height: Double, dockLane: Double) {
        self.height = height
        self.dockLane = dockLane
    }

    /// A window of `width` × `height` points.
    public init(points width: Double, _ height: Double, dockPoints: Double = 110) {
        let k = width > 0 ? width / 1600 : 1
        self.init(height: (height / k).rounded(), dockLane: (dockPoints / k).rounded())
    }

    public static let landscape = SATViewport(points: 1366, 1024)
    public static let portrait = SATViewport(points: 1024, 1366)
}

/// Every size and gap of the printed page, in one place (page units; the design notes' numbers).
/// The owner's reaction restyles these; nothing else holds a number.
public struct SATPageStyle: Hashable, Sendable {
    public var pageWidth = 1600.0
    /// the margins: cards and dots from 72 to 1528
    public var left = 72.0
    public var right = 1528.0
    /// blank paper under the top bar
    public var topLane = 104.0

    // the question number, in the margin like a printed test booklet (owner question 6: kept)
    public var showsNumber = true
    public var number = SATRect(72, 106, 44, 44)
    public var numberRadius = 12.0
    public var numberSize = 22.0

    // the stem
    public var stemX = 140.0
    public var stemSize = 25.0
    public var stemLine = 40.0
    public var paragraphGap = 14.0
    /// beside a figure, and alone
    public var stemBeside = 680.0
    public var stemAlone = 1388.0
    /// beside a figure the stem may run to this many lines, else the figure goes under it
    public var stemBesideMaxHeight = 360.0

    // the figure
    public var figureX = 880.0
    public var figureTop = 108.0
    public var figureMaxBeside = 648.0
    public var figureBelowGap = 28.0
    public var noteSize = 18.0
    public var noteGap = 10.0
    /// a coordinate plane: a 640 × 470 box, room left for the ticks and the turned y name, below for
    /// the ticks and the x name
    public var plotBox = SATSize(640, 470)
    public var plotPadLeft = 92.0
    public var plotPadRight = 14.0
    public var plotPadTop = 12.0
    public var plotPadBottom = 70.0
    /// a geometry figure: this many page units a figure unit, and its padding across and down
    public var shapeUnit = 52.0
    public var shapePadX = 50.0
    public var shapePadY = 40.0
    // a table, at its natural size
    public var tableHeaderRow = 56.0
    public var tableRow = 54.0
    public var tableCellPadX = 22.0
    public var tableSize = 21.0
    public var tableHeaderSize = 19.0

    // the work area (an L round the question)
    public var underStem = 48.0
    public var underFigure = 24.0
    /// the stem column keeps this much, and a full-width band this much under the whole question
    public var workMinUnderStem = 360.0
    public var workMinBand = 200.0
    public var aboveRow = 32.0
    // the dotted paper (owner question 5: dots)
    public var dotPitch = 36.0
    public var dotRadius = 1.8
    public var keepOutStem = 24.0
    public var keepOutFigure = 24.0
    public var keepOutFigureBelow = 28.0

    // the answer cards
    public var cardGap = 24.0
    public var rowHeight = 112.0
    /// a choice with a fraction (shown in display style) or a grid-in
    public var rowHeightTall = 132.0
    public var cardRadius = 26.0
    public var cardPadLeft = 22.0
    public var cardPadRight = 20.0
    public var letter = 52.0
    public var letterGap = 18.0
    public var letterSize = 23.0
    public var choiceSize = 28.0
    /// the eliminator's circle, and its target at the card's right end
    public var strikeCircle = 44.0
    public var strikeTarget = 72.0

    // the grid-in (owner question 4: the keypad only)
    public var gridInField = SATSize(400, 84)
    public var gridInFieldTop = 24.0
    public var gridInRadius = 26.0
    public var gridInLabelSize = 17.0
    public var gridInValueSize = 40.0
    public var gridInRulesX = 496.0
    public var gridInRulesSize = 17.0
    public var key = SATSize(96, 60)
    public var keyGapX = 10.0
    public var keyGapY = 12.0
    public var keyRadius = 18.0
    public var keySize = 28.0

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
        /// the eliminator's target (its circle is centred in it)
        public var strike: SATRect
    }

    /// One key of the grid-in's keypad.
    public struct Key: Hashable, Sendable {
        public var key: SATGridIn.Key
        public var frame: SATRect
    }

    public var pageHeight: Double
    public var number: SATRect?
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
    /// the work area: an L, from under the stem on the stem's side and under the figure on its side
    public var workTop: Double
    public var workTopFigureSide: Double
    public var workBottom: Double
    /// where the dotted paper is not: the stem's box and the figure's (to the page's edge)
    public var keepOut: [SATRect]
    public var rowTop: Double
    public var rowHeight: Double
    public var arrangement: CardArrangement?
    public var cards: [Card]
    /// the grid-in: its field, the rules beside it, its keypad
    public var gridIn: SATRect?
    public var gridInRules: SATRect?
    public var keys: [Key]

    /// The work area's height in the stem's column.
    public var workHeight: Double { workBottom - workTop }

    /// The card a page point is on, and whether it is on its eliminator.
    public func card(at x: Double, _ y: Double) -> (key: String, strike: Bool)? {
        for c in cards where c.frame.contains(x, y) { return (c.key, c.strike.contains(x, y)) }
        return nil
    }

    /// The keypad's key at a page point.
    public func key(at x: Double, _ y: Double) -> SATGridIn.Key? {
        keys.first { $0.frame.contains(x, y) }?.key
    }

    // MARK: - laying out a question

    /// The page for `question` in `viewport`. `lowestInk`: the bottom of the ink already on the page
    /// (the answer row never moves up onto it: the page grows instead). Deterministic.
    public static func make(_ q: SATQuestion, measure: SATTextMeasuring, viewport: SATViewport = .landscape, lowestInk: Double? = nil,
                            style s: SATPageStyle = .standard) -> SATPageLayout {
        // the figure beside the stem when it fits there (at most 648 wide, the stem in 9 lines),
        // else the stem full width and the figure under it
        var place: FigurePlace = .none
        var figSize: SATSize?
        var stemInk = measure.measureStem(q.stem, style: s, maxWidth: s.stemAlone)
        var stemW = s.stemAlone
        if let figure = q.figure {
            let natural = Self.figureSize(figure, maxWidth: s.figureMaxBeside, measure: measure, style: s)
            let besideInk = measure.measureStem(q.stem, style: s, maxWidth: s.stemBeside)
            if natural.w <= s.figureMaxBeside, besideInk.h <= s.stemBesideMaxHeight {
                place = .beside
                figSize = natural
                stemInk = besideInk
                stemW = s.stemBeside
            } else {
                place = .below
                figSize = Self.figureSize(figure, maxWidth: s.stemAlone, measure: measure, style: s)
            }
        }
        let stem = SATRect(s.stemX, s.topLane, stemW, stemInk.h)

        var figure: SATRect?
        var art: SATRect?
        var note: SATRect?
        if let fig = q.figure, let size = figSize {
            let noteInk = fig.note.flatMap { $0.isEmpty ? nil : measure.measure($0, size: s.noteSize, weight: .regular, maxWidth: max(size.w, 300)) }
            let origin = place == .beside ? (s.figureX, s.figureTop) : (s.stemX, stem.maxY + s.figureBelowGap)
            art = SATRect(origin.0, origin.1, size.w, size.h)
            if let n = noteInk { note = SATRect(origin.0, origin.1 + size.h + s.noteGap, n.w, n.h) }
            figure = SATRect(origin.0, origin.1, max(size.w, noteInk?.w ?? 0), size.h + (noteInk.map { s.noteGap + $0.h } ?? 0))
        }
        let numberBottom = s.showsNumber ? s.number.maxY : 0
        let stemBottom = max(stem.maxY, numberBottom)
        let questionBottom = max(stemBottom, figure?.maxY ?? 0)

        // the L: under the stem in its column, under the figure on its side
        let workTop: Double
        let workTopFigure: Double
        switch place {
        case .beside:
            workTop = stemBottom + s.underStem
            workTopFigure = (figure?.maxY ?? stemBottom) + s.underFigure
        case .below:
            workTop = (figure?.maxY ?? stemBottom) + s.underFigure
            workTopFigure = workTop
        case .none:
            workTop = stemBottom + s.underStem
            workTopFigure = workTop
        }

        // the answer row, then the page
        let rowH = q.format == .spr || (q.choices ?? []).contains { $0.text.contains("frac") } ? s.rowHeightTall : s.rowHeight
        let answers = answerBlock(q, rowHeight: rowH, measure: measure, style: s)
        let tail = s.aboveRow + answers.height + viewport.dockLane
        var pageH = max(viewport.height, workTop + s.workMinUnderStem + tail, questionBottom + s.aboveRow + s.workMinBand + tail)
        if let ink = lowestInk { pageH = max(pageH, ink + tail) }
        pageH = pageH.rounded(.up)
        let rowTop = pageH - viewport.dockLane - answers.height
        let workBottom = rowTop - s.aboveRow

        var plotGrid: SATRect?
        if case .plot? = q.figure, let art {
            plotGrid = SATRect(art.x + s.plotPadLeft, art.y + s.plotPadTop, art.w - s.plotPadLeft - s.plotPadRight,
                               art.h - s.plotPadTop - s.plotPadBottom).rounded
        }
        var keepOut = [SATRect(s.left - 8, stem.y - s.keepOutStem, stem.maxX - s.left + 8 + s.keepOutStem, stemBottom - stem.y + 2 * s.keepOutStem)]
        if let f = figure {
            keepOut.append(SATRect(f.x - s.keepOutFigure, f.y - s.keepOutFigure, s.pageWidth - f.x + s.keepOutFigure,
                                   f.h + s.keepOutFigure + s.keepOutFigureBelow))
        }
        return SATPageLayout(
            pageHeight: pageH, number: s.showsNumber ? s.number : nil, stem: stem.rounded, figurePlace: place, figure: figure?.rounded,
            figureArt: art?.rounded, plotGrid: plotGrid, note: note?.rounded, questionBottom: r2(questionBottom), workTop: r2(workTop),
            workTopFigureSide: r2(workTopFigure), workBottom: r2(workBottom), keepOut: keepOut.map(\.rounded), rowTop: r2(rowTop),
            rowHeight: rowH, arrangement: answers.arrangement,
            cards: answers.cards.map { c in
                Card(key: c.key, frame: c.frame.offset(rowTop).rounded, letter: c.letter.offset(rowTop).rounded,
                     text: c.text.offset(rowTop).rounded, strike: c.strike.offset(rowTop).rounded)
            },
            gridIn: answers.gridIn?.offset(rowTop).rounded, gridInRules: answers.rules?.offset(rowTop).rounded,
            keys: answers.keys.map { Key(key: $0.key, frame: $0.frame.offset(rowTop).rounded) })
    }

    static func r2(_ v: Double) -> Double { (v * 100).rounded() / 100 }

    /// A figure's size: a table at its natural size, a plane in its 640 × 470 box, a geometry figure
    /// at 52 units a figure unit (smaller only to fit `maxWidth`).
    public static func figureSize(_ figure: SATFigure, maxWidth: Double, measure: SATTextMeasuring, style s: SATPageStyle = .standard) -> SATSize {
        switch figure {
        case .table(let t):
            let widths = tableColumns(t, measure: measure, style: s)
            let h = s.tableHeaderRow + Double(t.rows.count) * s.tableRow
            return SATSize(widths.reduce(0, +).rounded(), h)
        case .plot:
            let w = min(maxWidth, s.plotBox.w)
            return SATSize(w, s.plotBox.h)
        case .shape(let sh):
            guard let b = sh.bounds else { return SATSize(min(maxWidth, 400), 300) }
            var w = (b.maxX - b.minX) * s.shapeUnit + 2 * s.shapePadX
            var h = (b.maxY - b.minY) * s.shapeUnit + 2 * s.shapePadY
            if w > maxWidth {
                let k = maxWidth / w
                w *= k
                h *= k
            }
            return SATSize(w.rounded(), h.rounded())
        }
    }

    /// A table's column widths: each as wide as its widest cell and the padding.
    public static func tableColumns(_ t: SATTable, measure: SATTextMeasuring, style s: SATPageStyle = .standard) -> [Double] {
        let columns = max(t.headers.count, t.rows.map(\.count).max() ?? 0)
        var widths = [Double](repeating: 0, count: columns)
        for (r, row) in ([t.headers] + t.rows).enumerated() {
            for c in 0..<columns {
                let text = c < row.count ? row[c] : ""
                let ink = measure.measure(text.isEmpty ? " " : text, size: r == 0 ? s.tableHeaderSize : s.tableSize,
                                          weight: r == 0 ? .semibold : .regular, maxWidth: .infinity)
                widths[c] = max(widths[c], max(88, ink.w + 2 * s.tableCellPadX))
            }
        }
        return widths.map { $0.rounded() }
    }

    // MARK: - the answers

    struct Answers {
        var height: Double
        var arrangement: CardArrangement?
        /// y relative to the row's top
        var cards: [Card] = []
        var gridIn: SATRect?
        var rules: SATRect?
        var keys: [Key] = []
    }

    static func answerBlock(_ q: SATQuestion, rowHeight rowH: Double, measure: SATTextMeasuring, style s: SATPageStyle) -> Answers {
        let width = s.contentWidth
        switch q.format {
        case .spr:
            let field = SATRect(s.left, s.gridInFieldTop, s.gridInField.w, s.gridInField.h)
            // the keypad: 7 × 2, right-aligned in the row
            let rows: [[SATGridIn.Key]] = [
                [.digit(1), .digit(2), .digit(3), .digit(4), .digit(5), .digit(6), .digit(7)],
                [.digit(8), .digit(9), .digit(0), .point, .slash, .minus, .delete],
            ]
            let padW = 7 * s.key.w + 6 * s.keyGapX
            let padH = 2 * s.key.h + s.keyGapY
            let x0 = s.right - padW, y0 = (rowH - padH) / 2
            var keys: [Key] = []
            for (r, row) in rows.enumerated() {
                for (c, k) in row.enumerated() {
                    keys.append(Key(key: k, frame: SATRect(x0 + Double(c) * (s.key.w + s.keyGapX), y0 + Double(r) * (s.key.h + s.keyGapY), s.key.w, s.key.h)))
                }
            }
            let rules = SATRect(s.gridInRulesX, field.y, max(0, x0 - 24 - s.gridInRulesX), field.h)
            return Answers(height: rowH, arrangement: nil, gridIn: field, rules: rules, keys: keys)
        case .mcq:
            let choices = q.choices ?? []
            guard !choices.isEmpty else { return Answers(height: 0, arrangement: nil) }
            let chrome = s.cardPadLeft + s.letter + s.letterGap + s.strikeTarget
            let oneLine = choices.map { measure.measure($0.text, size: s.choiceSize, weight: .regular, maxWidth: .infinity) }
            func cardWidth(_ perRow: Int) -> Double { (width - Double(perRow - 1) * s.cardGap) / Double(perRow) }
            // all in a row while every choice fits its card on one line; two by two while each fits
            // a half-width card; else one under another
            let arrangement: CardArrangement
            if oneLine.allSatisfy({ $0.w <= cardWidth(choices.count) - chrome }) {
                arrangement = .row
            } else if choices.count > 2, oneLine.allSatisfy({ $0.w <= cardWidth(2) - chrome }) {
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
                let h = max(rowH, (inks.map(\.h).max() ?? 0) + 40)
                for (k, c) in row.enumerated() {
                    let x = s.left + Double(k) * (cw + s.cardGap)
                    let frame = SATRect(x, y, cw, h)
                    let letter = SATRect(x + s.cardPadLeft, y + (h - s.letter) / 2, s.letter, s.letter)
                    let text = SATRect(letter.maxX + s.letterGap, y + (h - inks[k].h) / 2, textW, inks[k].h)
                    let strike = SATRect(frame.maxX - s.strikeTarget, y, s.strikeTarget, h)
                    cards.append(Card(key: c.key, frame: frame, letter: letter, text: text, strike: strike))
                }
                y += h + s.cardGap
                i += perRow
            }
            return Answers(height: y - s.cardGap, arrangement: arrangement, cards: cards)
        }
    }
}
