import CoreGraphics
import Foundation
import Testing
@testable import AgathonBoard

/// SAT v2 (docs/SAT-V2.md, "the question is the page"): what is printed on a page, a taller page
/// for a long question, its work area's own bottom, and ink tagged as it is committed.
@MainActor
struct PagePrintTests {
    private func rgb(_ v: CGFloat) -> CGColor { CGColor(srgbRed: v, green: v, blue: v, alpha: 1) }

    @Test func aPrintDrawsAndKnowsItsBounds() throws {
        let card = CGPath(roundedRect: CGRect(x: 88, y: 772, width: 342, height: 92), cornerWidth: 24, cornerHeight: 24, transform: nil)
        let rule = CGMutablePath()
        rule.move(to: CGPoint(x: 100, y: 100))
        rule.addLine(to: CGPoint(x: 300, y: 100))
        let line = RenderFonts.line("Which equation represents the line?", size: 30, color: rgb(0.1))
        let math = MathRendering.typeset("2x + y = 4", fontSize: 30, color: rgb(0.1))
        let print = PagePrint(key: "q", items: [.fill(card, rgb(0.9)), .stroke(rule, rgb(0.2), width: 4, dash: [6, 4]),
                                                .text(line, at: CGPoint(x: 88, y: 90)), .math(math, at: CGPoint(x: 160, y: 830)),
                                                .clip(CGRect(x: 0, y: 0, width: 50, height: 50), [.fill(card, rgb(0))])])
        let b = try #require(print.bounds)
        #expect(b.minX <= 88 && b.maxY >= 864 && b.minY < 90)
        #expect(PagePrint.empty.bounds == nil)
        // drawn into a page-space bitmap: the card's fill lands where it should
        let w = 1600, h = 900
        let ctx = try #require(CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                         space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        ctx.translateBy(x: 0, y: CGFloat(h))
        ctx.scaleBy(x: 1, y: -1)
        print.draw(in: ctx)
        let data = try #require(ctx.data).assumingMemoryBound(to: UInt8.self)
        func alpha(_ x: Int, _ y: Int) -> UInt8 { data[(y * w + x) * 4 + 3] }
        #expect(alpha(400, 860) > 0, "inside the card")
        #expect(alpha(800, 500) == 0, "the work area stays clear")
    }

    @Test func aTallerPagesWorkAreaHasItsOwnBottom() throws {
        let page = ProblemPage(setId: "sat:s:1", index: 4, count: 10, origin: "sat", workTop: 560, answer: false, workBottom: 992)
        var screen = ScreenRecord(id: "screen:q4", order: "a1", rect: Box(x: 0, y: 0, w: 1600, h: 1056))
        screen.problemPage = page
        let read = try #require(try BoardDocument.decode(BoardDocument([.screen(screen)]).encoded()).screens.first)
        #expect(read.problemPage == page)
        #expect(read.rect.h == 1056)
        #expect(read.problemPage?.resolvedWorkBottom == 992)
        #expect(ProblemPage().resolvedWorkBottom == ProblemPageLayout.workBottom)
        // the guide lines run down to the page's own bottom (560 + 74 … 954), More room past them
        #expect(ProblemPageLayout.rules(workTop: 560, bottom: 992) == [634, 714, 794, 874, 954])
        #expect(read.problemPage?.fullBand == 892)
        let t = try #require(PageTemplate(page: page, screen: read.rect))
        #expect(t.rules.boundingBoxOfPath.maxY > 900)
    }

    @Test func aScreenCanBeMadeTallerAsTheTutors() throws {
        let c = BoardController(document: BoardDocument([.screen(ScreenRecord(id: "screen:a", order: "a0"))]), defaults: UserDefaults(suiteName: "test.print.\(UUID())")!)
        let id = try #require(c.insertScreen(meta: [:], rect: Box(x: 0, y: 0, w: 1600, h: 1100), origin: .tutor, go: false))
        #expect(c.store[id]?.screen?.rect.h == 1100)
        c.setScreenRect(Box(x: 0, y: 0, w: 1600, h: 1000), on: "screen:a")
        #expect(c.store["screen:a"]?.screen?.rect.h == 1000)
        #expect(!c.store.canUndo, "the tutor's pages are no kid undo step")
    }

    @Test func inkIsTaggedAsItIsCommitted() throws {
        let c = BoardController(document: BoardDocument([.screen(ScreenRecord(id: "screen:a", order: "a0"))]), defaults: UserDefaults(suiteName: "test.print.\(UUID())")!)
        c.strokeTagger = { s in s.x > 900 ? ["figure": "plot"] : [:] }
        c.commitStroke(line("stroke:a", 1000, 1100, y: 200, order: "a1"))
        c.commitStroke(line("stroke:b", 100, 200, y: 600, order: "a2"))
        #expect(c.store["stroke:a"]?.meta["figure"]?.stringValue == "plot")
        #expect(c.store["stroke:b"]?.meta["figure"] == nil)
    }

    @Test func anSATPageIsDottedPaperRoundItsQuestion() throws {
        let stem = Box(x: 64, y: 80, w: 780, h: 118), figure = Box(x: 856, y: 84, w: 744, h: 522)
        let page = ProblemPage(setId: "sat:s:1", index: 4, count: 10, origin: "sat", workTop: 104, answer: false, workBottom: 926,
                               paper: .dots, keepOut: [stem, figure])
        var screen = ScreenRecord(id: "screen:q4", order: "a1", rect: Box(x: 0, y: 0, w: 1600, h: 1199))
        screen.problemPage = page
        #expect(try BoardDocument.decode(BoardDocument([.screen(screen)]).encoded()).screens.first?.problemPage == page)
        let dots = ProblemPageLayout.dots(workTop: 104, bottom: 926, keepOut: [stem, figure])
        #expect(!dots.isEmpty)
        #expect(!dots.contains { stem.contains($0) || figure.contains($0) })
        // 36 apart, across the page and down to the work area's bottom
        #expect(Set(dots.map(\.x)).count == 41)
        #expect(dots.allSatisfy { $0.y <= 926 })
        let t = try #require(PageTemplate(page: page, screen: screen.rect))
        #expect(!t.dots.isEmpty)
        #expect(t.rules.isEmpty && t.label.isEmpty, "no guide lines, no invitation")
        #expect(try #require(PageTemplate(page: ProblemPage(), screen: .screen)).dots.isEmpty)
    }

    @Test func aFittedWidthCameraScrollsATallPage() {
        let c = CameraConstraints(top: 0, left: 0, bottom: 0, right: 0, fitsWidth: true)
        let size = CGSize(width: 1366, height: 1024)
        let tall = Box(x: 0, y: 0, w: 1600, h: 1800)
        let fit = c.fit(tall, in: size)
        #expect(abs(fit.scale - 1366.0 / 1600) < 1e-9)
        #expect(fit.offset.y == 0)
        // scrolled down as far as it goes: the page's bottom at the window's
        var down = fit
        down.offset.y = -5000
        let held = c.clamp(down, screen: tall, in: size)
        #expect(abs(held.offset.y - (1024 - 1800 * fit.scale)) < 1e-6)
    }
}
