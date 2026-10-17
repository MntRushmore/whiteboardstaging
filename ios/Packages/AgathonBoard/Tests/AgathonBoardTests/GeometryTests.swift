import CoreGraphics
import Foundation
import Testing
@testable import AgathonBoard

struct FreehandTests {
    func input(_ n: Int, pressure: (Int) -> Double = { _ in 0.5 }) -> [FreehandInput] {
        (0..<n).map { FreehandInput(Vec2(Double($0) * 2, sin(Double($0) / 6) * 10), pressure($0)) }
    }

    @Test func outlineSurroundsTheLine() {
        let pts = input(60)
        let o = InkStyle.options(width: 6, pressure: .simulated, complete: true)
        let outline = Freehand.outline(pts, o)
        #expect(outline.count > 20)
        #expect(outline.allSatisfy { $0.x.isFinite && $0.y.isFinite })
        let ob = Box.around(outline)!
        let ib = Box.around(pts.map(\.p))!
        // the outline is the line widened by at most the pen's radius (plus the round caps)
        #expect(ob.minX <= ib.minX && ob.maxX >= ib.maxX - 1)
        #expect(ob.minX >= ib.minX - o.size && ob.maxX <= ib.maxX + o.size)
        #expect(ob.h <= ib.h + o.size * 1.5)
    }

    @Test func aDotIsACircle() {
        let o = InkStyle.options(width: 6, pressure: .real, complete: true)
        let outline = Freehand.outline([FreehandInput(Vec2(10, 10), 0.5)], o)
        #expect(outline.count >= 12)
        let b = Box.around(outline)!
        #expect(b.w > 2 && b.w < o.size * 2)
        #expect(abs(b.w - b.h) < 1.5)
    }

    @Test func emptyAndZeroSize() {
        #expect(Freehand.outline([], FreehandOptions()).isEmpty)
        var o = FreehandOptions()
        o.size = 0
        #expect(Freehand.outline(input(10), o).isEmpty)
    }

    @Test func pressureWidensRealInk() {
        func width(_ p: Double) -> Double {
            let pts = (0..<80).map { FreehandInput(Vec2(Double($0) * 2, 0), p) }
            return Box.around(Freehand.outline(pts, InkStyle.options(width: 6, pressure: .real, complete: true)))!.h
        }
        #expect(width(0.9) > width(0.2) * 1.4)
    }

    @Test func biggerPenWiderInk() {
        let pts = input(80)
        let thin = Box.around(Freehand.outline(pts, InkStyle.options(width: 4.5, pressure: .simulated, complete: true)))!
        let thick = Box.around(Freehand.outline(pts, InkStyle.options(width: 11, pressure: .simulated, complete: true)))!
        #expect(thick.h > thin.h)
    }

    @Test func deterministic() {
        let pts = input(50, pressure: { 0.3 + Double($0 % 7) / 10 })
        let o = InkStyle.options(width: 6, pressure: .real, complete: true)
        #expect(Freehand.outline(pts, o) == Freehand.outline(pts, o))
    }

    @Test func pathIsClosedAndCoversTheInk() {
        let s = makeStroke("stroke:a", order: "a1", xy: (0..<40).map { (Double($0) * 3 + 100, 200) })
        let item = RenderGeometry.stroke(s)
        let path = try! #require(item.fill)
        #expect(path.contains(CGPoint(x: 160, y: 200)))
        #expect(!path.contains(CGPoint(x: 160, y: 230)))
        #expect(item.bounds.contains(Vec2(100, 200)) && item.bounds.contains(Vec2(217, 200)))
    }

    @Test func pencilPressureMapsLikeTldraw() {
        #expect(InkStyle.pencilPressure(force: 2, maximumForce: 4) == 0.625)
        #expect(InkStyle.pencilPressure(force: 4, maximumForce: 4) == 1)
        #expect(InkStyle.pencilPressure(force: 1, maximumForce: 0) == 0.5)
    }
}

@MainActor
struct EraserTests {
    @Test func hitsWithinTheMarginOnly() {
        let s = line("stroke:a", 100, 300, y: 200, order: "a1") // width 6: 3 either side
        // a vertical pass 18 above the line: 16 reach + 3 half-width = 19 → hit
        #expect(HitTest.eraserHits(s, from: Vec2(200, 170), to: Vec2(200, 182), margin: 16))
        // 22 above: miss
        #expect(!HitTest.eraserHits(s, from: Vec2(200, 160), to: Vec2(200, 178), margin: 16))
        // crossing it: hit, even with no margin
        #expect(HitTest.eraserHits(s, from: Vec2(150, 150), to: Vec2(150, 250), margin: 0))
        // past its end
        #expect(!HitTest.eraserHits(s, from: Vec2(330, 150), to: Vec2(330, 250), margin: 16))
    }

    @Test func rotatedStroke() {
        var s = line("stroke:r", 0, 100, y: 0, order: "a1")
        s.x = 500
        s.y = 500
        s.rotation = .pi / 2 // now runs down from (500, 500) to (500, 600)
        #expect(HitTest.eraserHits(s, from: Vec2(490, 560), to: Vec2(510, 560), margin: 4))
        #expect(!HitTest.eraserHits(s, from: Vec2(550, 500), to: Vec2(600, 500), margin: 4))
    }

    @Test func eraserDragIsOneUndoStep() {
        let c = BoardController(document: BoardDocument([.screen(ScreenRecord(id: "screen:a", order: "a0"))]),
                                defaults: UserDefaults(suiteName: "test.erase.\(UUID())")!)
        for i in 0..<5 { c.commitStroke(line("stroke:\(i)", 100, 400, y: 100 + Double(i) * 40, order: OrderKey("a\(i + 1)"))) }
        #expect(c.store.strokeCount == 5)
        c.beginErase()
        var erased: [RecordID] = []
        // a drag down through the first three lines, in small steps like touch samples
        var last = Vec2(250, 80)
        for y in stride(from: 84.0, through: 190, by: 4) {
            erased += c.erase(from: last, to: Vec2(250, y), margin: 16)
            last = Vec2(250, y)
        }
        c.endErase()
        #expect(Set(erased) == ["stroke:0", "stroke:1", "stroke:2"])
        #expect(c.store.strokeCount == 2)
        c.undo()
        #expect(c.store.strokeCount == 5)
    }

    @Test func gridFindsNeighbours() {
        var g = SpatialGrid(cell: 100)
        g.insert("a", Box(x: 0, y: 0, w: 50, h: 50))
        g.insert("b", Box(x: 1000, y: 1000, w: 50, h: 50))
        g.insert("c", Box(x: -250, y: 90, w: 400, h: 20))
        #expect(g.query(Box(x: 40, y: 40, w: 20, h: 60)) == ["a", "c"])
        g.remove("c")
        #expect(g.query(Box(x: 40, y: 40, w: 20, h: 60)) == ["a"])
        g.insert("a", Box(x: 2000, y: 0, w: 10, h: 10)) // moved
        #expect(g.query(Box(x: 0, y: 0, w: 100, h: 100)).isEmpty)
        #expect(g.count == 2)
    }
}

struct CameraTests {
    let k = CameraConstraints(top: 132, left: 16, bottom: 16, right: 16, maxZoom: 4)
    let size = CGSize(width: 1376, height: 1032) // iPad Pro 13-inch, landscape

    @Test func fitsTheScreenInTheInsets() {
        let c = k.fit(.screen, in: size)
        #expect(abs(c.scale - 1344.0 / 1600) < 1e-9)
        let tl = c.toView(Vec2(0, 0))
        let br = c.toView(Vec2(1600, 900))
        #expect(abs(tl.x - 16) < 1e-9 && abs(br.x - (1376 - 16)) < 1e-9)
        #expect(tl.y >= 132 && br.y <= 1032 - 16)
        #expect(c.toPage(c.toView(Vec2(123, 456))).dist(Vec2(123, 456)) < 1e-9)
    }

    @Test func zoomIsHeldBetweenFitAndFourTimes() {
        let fit = k.fit(.screen, in: size)
        var c = fit
        c.scale *= 10
        #expect(abs(k.clamp(c, screen: .screen, in: size).scale - fit.scale * 4) < 1e-9)
        c.scale = fit.scale / 3
        #expect(abs(k.clamp(c, screen: .screen, in: size).scale - fit.scale) < 1e-9)
    }

    @Test func panStaysOnTheScreen() {
        var c = k.fit(.screen, in: size)
        c.scale *= 2
        c.offset = Vec2(5000, 5000) // far off to the right and down
        let held = k.clamp(c, screen: .screen, in: size)
        // the screen's top-left corner can come no further than the insets
        #expect(abs(held.toView(Vec2(0, 0)).x - 16) < 1e-9)
        #expect(abs(held.toView(Vec2(0, 0)).y - 132) < 1e-9)
        c.offset = Vec2(-50000, -50000)
        let held2 = k.clamp(c, screen: .screen, in: size)
        #expect(abs(held2.toView(Vec2(1600, 900)).x - (1376 - 16)) < 1e-9)
    }
}
