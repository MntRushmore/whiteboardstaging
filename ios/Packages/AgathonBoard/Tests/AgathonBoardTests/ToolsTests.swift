import CoreGraphics
import Foundation
import Testing
@testable import AgathonBoard

@MainActor
private func controllerWith(_ records: [BoardRecord]) -> BoardController {
    let screen = ScreenRecord(id: "screen:a", order: "a0")
    let c = BoardController(document: BoardDocument([.screen(screen)] + records), defaults: UserDefaults(suiteName: "test.tools.\(UUID())")!)
    c.resetScene()
    return c
}

private func box(_ id: String, _ x: Double, _ y: Double, _ w: Double, _ h: Double, order: OrderKey, fill: FillStyle = .none, kind: ShapeKind = .rect) -> ShapeRecord {
    ShapeRecord(id: RecordID(id), screen: "screen:a", order: order, kind: kind, x: x, y: y, w: w, h: h, color: .black, width: 5, fill: fill)
}

private func picture(_ id: String, _ x: Double, _ y: Double, _ w: Double, _ h: Double, order: OrderKey, meta: Meta = [:]) -> ImageRecord {
    ImageRecord(id: RecordID(id), screen: "screen:a", order: order, x: x, y: y, w: w, h: h, asset: AssetRef(src: "memory://board-assets/t/\(id).png"), meta: meta)
}

@MainActor
struct SelectionTests {
    @Test func tapPicksTheTopmostInkWithinReach() {
        let a = line("stroke:a", 100, 300, y: 100, order: "a1")
        let b = line("stroke:b", 100, 300, y: 104, order: "a2") // on top, 4 units below
        let c = controllerWith([.stroke(a), .stroke(b)])
        #expect(c.hit(at: Vec2(200, 102), margin: 6) == "stroke:b")
        #expect(c.hit(at: Vec2(200, 160), margin: 6) == nil)
        // a hollow box is picked on its line, not inside
        let c2 = controllerWith([.shape(box("shape:r", 400, 400, 200, 100, order: "a1"))])
        #expect(c2.hit(at: Vec2(500, 401), margin: 6) == "shape:r")
        #expect(c2.hit(at: Vec2(500, 450), margin: 6) == nil)
        // a filled one anywhere inside
        let c3 = controllerWith([.shape(box("shape:f", 400, 400, 200, 100, order: "a1", fill: .solid))])
        #expect(c3.hit(at: Vec2(500, 450), margin: 6) == "shape:f")
        // an ellipse on its outline
        let c4 = controllerWith([.shape(box("shape:e", 400, 400, 200, 100, order: "a1", kind: .ellipse))])
        #expect(c4.hit(at: Vec2(500, 402), margin: 6) == "shape:e")
        #expect(c4.hit(at: Vec2(500, 450), margin: 6) == nil)
    }

    @Test func lassoTakesWhatItGoesRound() {
        let inside = line("stroke:in", 120, 200, y: 120, order: "a1")
        let half = line("stroke:half", 180, 400, y: 150, order: "a2") // mostly outside
        let outside = line("stroke:out", 600, 700, y: 120, order: "a3")
        let c = controllerWith([.stroke(inside), .stroke(half), .stroke(outside)])
        let loop = [Vec2(100, 100), Vec2(260, 95), Vec2(265, 180), Vec2(95, 185)]
        #expect(c.ids(inLasso: loop) == ["stroke:in"])
    }

    @Test func lockedPagesAndOtherScreensAreNotSelectable() {
        let pdf = picture("image:pdf", 100, 100, 800, 600, order: "a1", meta: ["locked": true, "kind": "pdf"])
        let c = controllerWith([.image(pdf)])
        #expect(c.hit(at: Vec2(400, 400), margin: 6) == nil)
        c.select(["image:pdf"])
        #expect(c.selection.isEmpty)
        // nor does the eraser take it, nor any picture
        #expect(!BoardController.erasable(.image(pdf)))
        #expect(!BoardController.erasable(.image(picture("image:p", 0, 0, 10, 10, order: "a2"))))
        #expect(BoardController.erasable(.stroke(line("stroke:x", 0, 10, y: 0, order: "a3"))))
    }

    @Test func moveIsOneUndoStep() {
        let a = line("stroke:a", 100, 300, y: 100, order: "a1")
        let r = box("shape:r", 400, 400, 200, 100, order: "a2")
        let c = controllerWith([.stroke(a), .shape(r)])
        c.select(["stroke:a", "shape:r"])
        let before = c.selectionBounds
        c.moveSelection(by: Vec2(50, -20))
        #expect(c.store.stroke("stroke:a")?.x == a.x + 50)
        if case .shape(let s)? = c.store["shape:r"] { #expect(s.x == 450 && s.y == 380) } else { Issue.record("no shape") }
        // (the moved ink is quantized to 1/16 unit as it is stored)
        #expect(abs((c.selectionBounds?.x ?? 0) - ((before?.x ?? 0) + 50)) < 0.1)
        #expect(c.store.history.undoCount == 1)
        c.undo()
        #expect(c.store.stroke("stroke:a")?.x == a.x)
        if case .shape(let s)? = c.store["shape:r"] { #expect(s.x == 400 && s.y == 400) }
        c.redo()
        #expect(c.store.stroke("stroke:a")?.x == a.x + 50)
    }

    @Test func resizeScalesAboutTheAnchorAndKeepsPenWidth() {
        let a = line("stroke:a", 100, 300, y: 100, order: "a1")
        let r = box("shape:r", 100, 200, 200, 100, order: "a2")
        let m = MathRecord(id: "math:m", screen: "screen:a", order: "a3", role: .answer, latex: "x=4", x: 100, y: 320, w: 60, h: 30, fontSize: 24)
        let c = controllerWith([.stroke(a), .shape(r), .math(m)])
        c.select(["stroke:a", "shape:r", "math:m"])
        c.scaleSelection(by: 2, about: Vec2(100, 100))
        let s = try! #require(c.store.stroke("stroke:a"))
        #expect(s.x == 100 && s.y == 100)
        #expect(s.width == a.width)
        let last = s.pagePoint(s.points.last!)
        #expect(abs(last.x - 500) < 0.1)
        if case .shape(let sh)? = c.store["shape:r"] {
            #expect(sh.x == 100 && sh.y == 300 && sh.w == 400 && sh.h == 200 && sh.width == 5)
        }
        if case .math(let mm)? = c.store["math:m"] { #expect(mm.fontSize == 48 && mm.y == 540) }
        c.undo()
        #expect(c.store.stroke("stroke:a") == a)
    }

    @Test func graphsNeverShrinkBelowTheirLeastSize() {
        let g = GraphRecord(id: "graph:g", screen: "screen:a", order: "a1", x: 0, y: 0, w: 240, h: 200)
        if case .graph(let out) = SelectionGeometry.scaled(.graph(g), by: 0.25, about: .zero) {
            #expect(out.w == SelectionGeometry.graphMin.w && out.h == SelectionGeometry.graphMin.h)
        }
    }

    @Test func deleteAndUndo() {
        let a = line("stroke:a", 100, 300, y: 100, order: "a1")
        let b = line("stroke:b", 100, 300, y: 200, order: "a2")
        let c = controllerWith([.stroke(a), .stroke(b)])
        c.select(["stroke:a", "stroke:b"])
        c.deleteSelection()
        #expect(c.store.strokeCount == 0)
        #expect(c.selection.isEmpty)
        c.undo()
        #expect(c.store.strokeCount == 2)
    }

    @Test func duplicateMakesTheKidsCopiesOnTopAndSelectsThem() {
        let tutor = line("stroke:t", 100, 300, y: 100, order: "a1", author: .tutor)
        var t = tutor
        t.color = .tutor
        t.meta = ["live": true, "lineId": "l1", "handBlock": "hb_1"]
        let k = line("stroke:k", 100, 300, y: 200, order: "a2")
        let c = controllerWith([.stroke(t), .stroke(k)])
        c.select(["stroke:t", "stroke:k"])
        c.duplicateSelection()
        #expect(c.store.strokeCount == 4)
        #expect(c.selection.count == 2)
        #expect(!c.selection.contains("stroke:t") && !c.selection.contains("stroke:k"))
        let copies = c.selection.compactMap { c.store.stroke($0) }
        for s in copies {
            #expect(s.author == .kid)
            #expect(s.color != .tutor) // the tutor-ink rule holds for copies
            #expect(s.meta["live"] == nil && s.meta["lineId"] == nil && s.meta["handBlock"] == nil)
        }
        // on top of the originals, in the same order
        let ids = c.store.drawableIDs(on: "screen:a")
        #expect(Set(ids.suffix(2)) == c.selection)
        #expect(c.store.history.undoCount == 1)
        c.undo()
        #expect(c.store.strokeCount == 2)
        #expect(c.selection.isEmpty) // pruned: the copies are gone
    }

    @Test func selectionFollowsUndoAndScreens() {
        let a = line("stroke:a", 100, 300, y: 100, order: "a1")
        let c = controllerWith([.stroke(a)])
        c.select(["stroke:a"])
        c.tool = .pen // another tool puts the selection down
        #expect(c.selection.isEmpty)
        c.tool = .select
        c.select(["stroke:a"])
        c.addScreen()
        #expect(c.selection.isEmpty)
    }
}

@MainActor
struct ShapeToolTests {
    @Test func linesSnapGentlyToTheEightDirections() {
        let a = Vec2(100, 100)
        // 4° off flat: flat
        let flat = BoardController.snapped(from: a, to: a + Vec2(cos(0.07), sin(0.07)) * 200)
        #expect(abs(flat.y - 100) < 1e-9 && abs(flat.x - 300) < 1e-6)
        // 5° off the diagonal: the diagonal
        let diag = BoardController.snapped(from: a, to: a + Vec2(cos(.pi / 4 + 0.087), sin(.pi / 4 + 0.087)) * 100)
        #expect(abs((diag.x - a.x) - (diag.y - a.y)) < 1e-6)
        // 5° off upright: upright (y down: -90°)
        let up = BoardController.snapped(from: a, to: a + Vec2(cos(-.pi / 2 + 0.08), sin(-.pi / 2 + 0.08)) * 100)
        #expect(abs(up.x - 100) < 1e-6)
        // 20° is meant: kept
        let free = a + Vec2(cos(0.35), sin(0.35)) * 100
        #expect(BoardController.snapped(from: a, to: free) == free)
        // length kept
        #expect(abs(diag.dist(a) - 100) < 1e-6)
    }

    @Test func dragsMakeShapesInThePensColour() {
        let c = controllerWith([])
        c.color = .red
        let r = try! #require(c.shapeRecord(.rect, from: Vec2(300, 200), to: Vec2(100, 400)))
        #expect(r.x == 100 && r.y == 200 && r.w == 200 && r.h == 200 && r.color == .red && r.author == .kid)
        #expect(r.width == InkStyle.PenSize.regular.shapeWidth)
        let arrow = try! #require(c.shapeRecord(.arrow, from: Vec2(100, 100), to: Vec2(300, 104)))
        #expect(arrow.kind == .arrow && arrow.points.count == 2 && arrow.points[1].y == 0) // snapped flat
        // a tap is not a shape
        #expect(c.shapeRecord(.ellipse, from: Vec2(100, 100), to: Vec2(102, 101)) == nil)
        c.commitShape(r)
        #expect(c.store.history.undoCount == 1)
        if case .shape(let s)? = c.store[r.id] { #expect(s == r) }
    }
}

@MainActor
struct HighlighterTests {
    @Test func highlightsAreTldrawsTwoPassesUnderTheInk() throws {
        var h = line("stroke:h", 100, 400, y: 100, order: "a2")
        h.meta = ["highlight": true]
        h.width = InkStyle.highlighterWidth
        h.color = .black
        let item = RenderGeometry.stroke(h)
        #expect(item.underlay != nil && item.paintsUnder)
        #expect(item.underlay.map { $0.color.alpha } == 0.82)
        if case .stroke(_, let c, let w, _, _, _)? = item.ops.first {
            #expect(abs(c.alpha - 0.35) < 1e-9 && w == CGFloat(h.width))
        } else {
            Issue.record("no overlay")
        }
    }

    @Test func inkWrittenBeforeAHighlightStaysDark() throws {
        // ink first, then a highlighter over it (later in z-order)
        let ink = line("stroke:ink", 100, 400, y: 100, order: "a1")
        var h = line("stroke:h", 100, 400, y: 100, order: "a2")
        h.meta = ["highlight": true]
        h.width = InkStyle.highlighterWidth
        let items = [RenderGeometry.stroke(ink.normalized()), RenderGeometry.stroke(h.normalized())]
        let rect = Box(x: 0, y: 0, w: 500, h: 200)
        let ctx = try #require(TileRasterizer.render(items, rect: rect, scale: 1))
        let image = try #require(ctx.makeImage())
        func luminance(_ x: Int, _ y: Int) -> (l: Double, b: Double) {
            let px = RenderComparisonTests.rgba(image, w: 500, h: 200)
            let i = (y * 500 + x) * 4
            let r = Double(px[i]) / 255, g = Double(px[i + 1]) / 255, b = Double(px[i + 2]) / 255
            return (0.2126 * r + 0.7152 * g + 0.0722 * b, b)
        }
        // on the ink: dark (the strong half is under it, only the faint half over it)
        #expect(luminance(250, 100).l < 0.45)
        // beside the ink, under the marker: yellow (blue channel low, bright)
        let marker = luminance(250, 112)
        #expect(marker.l > 0.6 && marker.b < 0.45)
    }

    @Test func aHighlightIsRedrawnUnderNotPaintedOnTop() {
        let c = controllerWith([.stroke(line("stroke:a", 100, 300, y: 100, order: "a1"))])
        let spy = SpyRenderer()
        c.renderer = spy
        c.tool = .highlighter
        var s = c.strokeTemplate(pressure: .simulated, at: Vec2(100, 100), start: 0)
        #expect(s.meta["highlight"]?.boolValue == true && s.width == InkStyle.highlighterWidth)
        s.points = (0..<20).map { InkPoint(x: Double($0) * 10, y: 0) }
        c.commitStroke(s)
        #expect(spy.deltas.last?.appendsOnTop == false)
        c.tool = .pen
        var p = c.strokeTemplate(pressure: .simulated, at: Vec2(100, 300), start: 0)
        p.points = (0..<20).map { InkPoint(x: Double($0) * 10, y: 0) }
        c.commitStroke(p)
        #expect(spy.deltas.last?.appendsOnTop == true)
    }
}

struct DashTests {
    @Test func dashedAndDottedStrokesFollowTldraw() {
        var s = line("stroke:d", 100, 400, y: 100, order: "a1")
        s.meta = ["dash": "dashed"]
        let dashed = RenderGeometry.stroke(s)
        guard case .stroke(_, _, let w, let dash, _, let cap)? = dashed.ops.first else {
            Issue.record("no dashed op")
            return
        }
        #expect(w == CGFloat(s.width) && dash == [CGFloat(s.width * 2), CGFloat(s.width * 2)] && cap == .butt)
        s.meta = ["dash": "dotted"]
        guard case .stroke(_, _, _, let dots, _, let dotCap)? = RenderGeometry.stroke(s).ops.first else {
            Issue.record("no dotted op")
            return
        }
        #expect(dots == [0.1, CGFloat(s.width * 2)] && dotCap == .round)
        s.meta = ["dash": "solid"]
        guard case .stroke(_, _, _, let solid, _, _)? = RenderGeometry.stroke(s).ops.first else {
            Issue.record("no solid op")
            return
        }
        #expect(solid.isEmpty)
        s.meta = [:]
        #expect(RenderGeometry.stroke(s).ops.isEmpty && RenderGeometry.stroke(s).fill != nil) // freehand
    }

    @Test func perfectDashesFitASideExactly() {
        // tldraw: dashes of 2w, whole ones at both ends
        let p = PerfectDash.pattern(length: 200, width: 5, style: .dashed)
        #expect(p.lengths.count == 2)
        let dash = Double(p.lengths[0]), gap = Double(p.lengths[1])
        let total = 200.0 + 10 // outset: half of tldraw's first dash (2w) beyond each end
        let n = ((total + gap) / (dash + gap)).rounded()
        #expect(abs(n * dash + (n - 1) * gap - total) < 1e-6)
        #expect(abs(Double(p.phase) - 5) < 1e-6) // half of tldraw's first dash (2w)
        // a closed ellipse's dashes go round evenly
        let e = PerfectDash.pattern(length: 300, width: 4, style: .dashed, closed: true)
        let count = 300 / Double(e.lengths[0] + e.lengths[1])
        #expect(abs(count - count.rounded()) < 1e-6)
    }

    @Test func dashedShapesDrawPerSide() {
        var r = ShapeRecord(id: "shape:r", screen: "screen:a", order: "a1", kind: .rect, x: 0, y: 0, w: 200, h: 100, color: .black, width: 3.5)
        r.meta = ["dash": "dashed"]
        let item = RenderGeometry.item(for: .shape(r))!
        #expect(item.ops.count == 4 && item.stroke == nil)
        r.meta = [:]
        #expect(RenderGeometry.item(for: .shape(r))!.stroke != nil)
    }

    @Test func centerlinePathIsTldrawsQuadraticChain() {
        let pts = (0..<6).map { Vec2(Double($0) * 10, Double($0 % 2) * 4) }
        let path = RenderGeometry.centerlinePath(pts)
        var quads = 0, lines = 0
        path.applyWithBlock { e in
            switch e.pointee.type {
            case .addQuadCurveToPoint: quads += 1
            case .addLineToPoint: lines += 1
            default: break
            }
        }
        // M p0 Q p1 mid(p1,p2) T mid(p2,p3) mid(p3,p4) mid(p4,p5) L p5
        #expect(quads == 4 && lines == 1)
        #expect(path.currentPoint == pts[5].cgPoint)
    }
}

@MainActor
struct ScreenManagementTests {
    @Test func deleteTakesEverythingOnTheScreenAndUndoBringsItBack() {
        let a = ScreenRecord(id: "screen:a", order: "a0")
        let b = ScreenRecord(id: "screen:b", order: "a1")
        let s1 = line("stroke:1", 0, 100, y: 10, order: "a1", screen: "screen:b")
        let l1 = LineRecord(id: "line:1", screen: "screen:b", strokes: ["stroke:1"], latex: "x")
        let m1 = MarkRecord(id: "mark:1", screen: "screen:b", kind: .tick, target: "line:1")
        let keep = line("stroke:keep", 0, 100, y: 10, order: "a1", screen: "screen:a")
        let c = BoardController(document: BoardDocument([.screen(a), .screen(b), .stroke(s1), .line(l1), .mark(m1), .stroke(keep)]),
                                defaults: UserDefaults(suiteName: "test.screens.\(UUID())")!)
        c.goToScreen("screen:b")
        #expect(c.deleteScreen("screen:b"))
        #expect(c.currentScreenID == "screen:a")
        #expect(c.store.screenIDs == ["screen:a"])
        #expect(c.store["stroke:1"] == nil && c.store["line:1"] == nil && c.store["mark:1"] == nil)
        #expect(c.store["stroke:keep"] != nil)
        #expect(c.screenCount == 1)
        // never the only screen
        #expect(!c.deleteScreen("screen:a"))
        c.undo()
        #expect(c.store.screenIDs == ["screen:a", "screen:b"])
        #expect(c.store["stroke:1"] != nil && c.store["line:1"] != nil && c.store["mark:1"] != nil)
        #expect(c.screenCount == 2)
    }

    @Test func reorderIsOneUndoStep() {
        let ids: [RecordID] = ["screen:a", "screen:b", "screen:c", "screen:d"]
        let keys = try! OrderKey.sequence(4)
        let doc = BoardDocument(zip(ids, keys).map { BoardRecord.screen(ScreenRecord(id: $0.0, order: $0.1)) })
        let c = BoardController(document: doc, defaults: UserDefaults(suiteName: "test.reorder.\(UUID())")!)
        c.moveScreen("screen:d", to: 0)
        #expect(c.store.screenIDs == ["screen:d", "screen:a", "screen:b", "screen:c"])
        c.moveScreen("screen:a", to: 3)
        #expect(c.store.screenIDs == ["screen:d", "screen:b", "screen:c", "screen:a"])
        c.moveScreen("screen:b", to: 2)
        #expect(c.store.screenIDs == ["screen:d", "screen:c", "screen:b", "screen:a"])
        c.undo()
        #expect(c.store.screenIDs == ["screen:d", "screen:b", "screen:c", "screen:a"])
        c.undo()
        c.undo()
        #expect(c.store.screenIDs == ids)
        #expect(c.strip.items.map(\.id) == ids)
        #expect(c.strip.items.map(\.number) == [1, 2, 3, 4])
    }

    @Test func theStripSaysWhatCanBeDone() {
        let c = BoardController(defaults: UserDefaults(suiteName: "test.strip.\(UUID())")!)
        #expect(c.strip.count == 1 && !c.strip.canDelete && c.strip.canAdd && c.strip.current == 1)
        c.addScreen()
        #expect(c.strip.count == 2 && c.strip.canDelete && c.strip.current == 2)
        for _ in 0..<48 { c.addScreen() }
        #expect(c.strip.count == 50 && !c.strip.canAdd)
        #expect(!c.addScreen())
        #expect(c.notice?.kind == .boardFull)
        // a change on a screen moves its revision (thumbnails redraw)
        let r0 = c.revision(of: c.currentScreenID)
        c.commitStroke(line("stroke:z", 0, 50, y: 10, order: c.store.nextOrder(on: c.currentScreenID), screen: c.currentScreenID))
        #expect(c.revision(of: c.currentScreenID) > r0)
    }
}

@MainActor
struct EraserBatchTests {
    @Test func onePathOneChange() {
        let strokes = (0..<10).map { line("stroke:\($0)", 100, 300, y: 50 + Double($0) * 20, order: OrderKey("a\($0)")) }
        let c = controllerWith(strokes.map { .stroke($0) })
        var changes = 0
        let sub = c.store.observe { _ in changes += 1 }
        c.beginErase()
        let path = stride(from: 40.0, through: 260, by: 10).map { Vec2(200, $0) }
        let hit = c.erase(along: path, margin: 8)
        c.endErase()
        #expect(hit.count == 10 && changes == 1)
        #expect(c.store.history.undoCount == 1)
        c.undo()
        #expect(c.store.strokeCount == 10)
        _ = sub
    }

    @Test func aLongEraseGroupStaysOneStepAndUndoesExactly() {
        // (under 200 records, so the scene is laid out at once, not off the main thread)
        let keys = try! OrderKey.sequence(180)
        var strokes: [StrokeRecord] = []
        for i in 0..<180 {
            let x0 = Double(i % 30) * 50
            let y = 20 + Double(i / 30) * 80
            strokes.append(line("stroke:\(i)", x0, x0 + 40, y: y, order: keys[i]))
        }
        let c = controllerWith(strokes.map { BoardRecord.stroke($0) })
        c.beginErase()
        for row in 0..<6 {
            for x in stride(from: 0.0, through: 1500, by: 25) {
                c.erase(from: Vec2(x, 20 + Double(row) * 80), to: Vec2(x + 25, 20 + Double(row) * 80), margin: 4)
            }
        }
        c.endErase()
        #expect(c.store.strokeCount == 0)
        #expect(c.store.history.undoCount == 1)
        c.undo()
        #expect(c.store.strokeCount == 180)
        let back: [StrokeRecord] = c.store.records.values.compactMap { $0.stroke }
        #expect(Set(back) == Set(strokes))
    }
}

struct EstimationTrackerTests {
    @Test func latePencilValuesFindTheirPoints() {
        var t = EstimationTracker()
        t.expect(updateIndex: 41, point: 0)
        t.expect(updateIndex: 42, point: 1)
        #expect(t.point(for: 42) == 1 && t.count == 2)
        t.settle(41)
        #expect(t.point(for: 41) == nil && !t.isEmpty)
        t.settle(42)
        #expect(t.isEmpty)
        #expect(t.point(for: 7) == nil)
    }
}

/// Records what the controller hands the renderer.
@MainActor
final class SpyRenderer: BoardRendering {
    var deltas: [SceneDelta] = []
    var resets = 0
    func sceneReset(_ index: SceneIndex, screen: ScreenRecord, done: @escaping () -> Void) {
        resets += 1
        done()
    }
    func sceneChanged(_ delta: SceneDelta, index: SceneIndex) { deltas.append(delta) }
}

extension StrokeRecord: Hashable {
    public func hash(into h: inout Hasher) { h.combine(id) }
}
