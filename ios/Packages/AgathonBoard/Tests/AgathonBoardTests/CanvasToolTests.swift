#if canImport(UIKit)
import CoreGraphics
import Foundation
import Testing
import UIKit
@testable import AgathonBoard

/// Select, move, resize, lasso and shapes through the real canvas (synthetic Pencil input, the
/// same path a touch takes), on an iPad Pro 13-inch sized view.
@MainActor
struct CanvasToolTests {
    func canvas(_ records: [BoardRecord]) -> (BoardController, BoardCanvasView) {
        let doc = BoardDocument([.screen(ScreenRecord(id: "screen:a", order: "a0"))] + records)
        let c = BoardController(document: doc, defaults: UserDefaults(suiteName: "test.canvas.\(UUID())")!)
        let v = BoardCanvasView(controller: c)
        v.frame = CGRect(x: 0, y: 0, width: 1376, height: 1032)
        v.layoutIfNeeded()
        c.resetScene()
        return (c, v)
    }

    @Test func tapPicksDragMovesAsOneStep() {
        let s = line("stroke:a", 200, 400, y: 300, order: "a1")
        let (c, v) = canvas([.stroke(s)])
        c.tool = .select
        v.simulateTap(at: v.camera.toView(Vec2(300, 300)))
        #expect(c.selection == ["stroke:a"])
        // drag the selection 100 units right and 50 down
        v.simulateDrag(from: v.camera.toView(Vec2(300, 300)), to: v.camera.toView(Vec2(400, 350)))
        let moved = try! #require(c.store.stroke("stroke:a"))
        #expect(abs(moved.x - (s.x + 100)) < 0.1 && abs(moved.y - (s.y + 50)) < 0.1)
        #expect(c.store.history.undoCount == 1)
        #expect(!c.isTransforming)
        c.undo()
        #expect(c.store.stroke("stroke:a") == s)
    }

    @Test func aDragOnUnpickedInkPicksItUpAndMovesIt() {
        let s = line("stroke:a", 200, 400, y: 300, order: "a1")
        let (c, v) = canvas([.stroke(s)])
        c.tool = .select
        v.simulateDrag(from: v.camera.toView(Vec2(250, 300)), to: v.camera.toView(Vec2(250, 500)))
        #expect(c.selection == ["stroke:a"])
        #expect(abs((c.store.stroke("stroke:a")?.y ?? 0) - (s.y + 200)) < 0.1)
    }

    @Test func theCornerHandleResizesAboutTheOppositeCorner() throws {
        let r = ShapeRecord(id: "shape:r", screen: "screen:a", order: "a1", kind: .rect, x: 400, y: 300, w: 200, h: 100, color: .black, width: 5)
        let (c, v) = canvas([.shape(r)])
        c.tool = .select
        c.select(["shape:r"])
        let b = try #require(c.selectionBounds)
        // the bottom-right handle sits the frame's padding outside the ink's corner
        let pad = 10 / v.camera.scale
        let handle = Vec2(b.maxX + pad, b.maxY + pad)
        let stretched = Vec2(b.minX + (handle.x - b.minX) * 1.5, b.minY + (handle.y - b.minY) * 1.5)
        v.simulateDrag(from: v.camera.toView(handle), to: v.camera.toView(stretched), steps: 20)
        guard case .shape(let out)? = c.store["shape:r"] else {
            Issue.record("no shape")
            return
        }
        #expect(out.w > 280 && out.w < 330 && abs(out.w / out.h - 2) < 0.01) // uniform
        #expect(abs(out.x - (b.minX + (r.x - b.minX) * (out.w / r.w))) < 1)
        #expect(c.store.history.undoCount == 1)
    }

    @Test func aLoopRoundInkSelectsIt() {
        let a = line("stroke:a", 200, 300, y: 300, order: "a1")
        let b = line("stroke:b", 700, 800, y: 300, order: "a2")
        let (c, v) = canvas([.stroke(a), .stroke(b)])
        c.tool = .select
        let loop = (0...40).map { i -> CGPoint in
            let t = Double(i) / 40 * 2 * .pi
            return v.camera.toView(Vec2(250 + cos(t) * 120, 300 + sin(t) * 60))
        }
        v.simulatePath(loop)
        #expect(c.selection == ["stroke:a"])
        // a tap on empty paper puts it down
        v.simulateTap(at: v.camera.toView(Vec2(1200, 800)))
        #expect(c.selection.isEmpty)
    }

    @Test func aShapeDragMakesTheShapeSnapped() {
        let (c, v) = canvas([])
        c.tool = .shapes
        c.shapeKind = .arrow
        c.color = .green
        v.simulateDrag(from: v.camera.toView(Vec2(300, 300)), to: v.camera.toView(Vec2(600, 312)))
        let shapes = c.store.records.values.compactMap { r -> ShapeRecord? in if case .shape(let s) = r { return s } else { return nil } }
        #expect(shapes.count == 1)
        #expect(shapes.first?.kind == .arrow && shapes.first?.color == .green)
        #expect(abs(shapes.first?.points.last?.y ?? 1) < 1e-9) // 2.3° off flat: flat
        // a tap is not a shape
        v.simulateTap(at: v.camera.toView(Vec2(900, 600)))
        #expect(c.store.records.values.filter { $0.type == .shape }.count == 1)
    }

    @Test func theEraserLeavesPicturesAndPDFPagesAlone() {
        let ink = line("stroke:ink", 200, 600, y: 300, order: "a2")
        let photo = ImageRecord(id: "image:p", screen: "screen:a", order: "a1", x: 150, y: 250, w: 500, h: 100, asset: AssetRef(src: "memory://x/p.png"))
        let (c, v) = canvas([.image(photo), .stroke(ink)])
        c.tool = .eraser
        v.simulatePath((0...30).map { v.camera.toView(Vec2(180 + Double($0) * 15, 300)) })
        #expect(c.store["stroke:ink"] == nil)
        #expect(c.store["image:p"] != nil)
    }
}
#endif
