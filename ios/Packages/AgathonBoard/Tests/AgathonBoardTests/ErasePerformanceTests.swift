#if canImport(UIKit)
import CoreGraphics
import Foundation
import QuartzCore
import Testing
import UIKit
@testable import AgathonBoard

/// The eraser on a dense board, through the real canvas: hit test, store, scene and the tile redraw,
/// per touch event (two 240 Hz Pencil samples a 120 Hz frame). The board lane measured 2–7 ms a hit
/// on the old path (every sample its own erase and every erased stroke its own tile redraw), and one
/// frame over budget; the budget is one 120 Hz frame.
@MainActor
struct ErasePerformanceTests {
    struct Result {
        var perEvent: [Double] = []
        var erase: [Double] = []
        var flush: [Double] = []
        var ids = Set<RecordID>()
        var erased = 0
        var tiles: [Int] = []
        var p50: Double { BoardStats.percentile(perEvent, 0.5) }
        var p95: Double { BoardStats.percentile(perEvent, 0.95) }
        var max: Double { perEvent.max() ?? 0 }
    }

    /// A fresh 5,000-stroke canvas the size of an iPad Pro 13-inch in landscape, drawn.
    func canvas() async -> (BoardController, BoardCanvasView) {
        let doc = SyntheticBoards.handwriting(strokes: 5000)
        let c = BoardController(document: doc, defaults: UserDefaults(suiteName: "test.eraseperf.\(UUID())")!)
        let view = BoardCanvasView(controller: c)
        view.frame = CGRect(x: 0, y: 0, width: 1376, height: 1032)
        view.layoutIfNeeded()
        await withCheckedContinuation { (k: CheckedContinuation<Void, Never>) in c.resetScene { k.resume() } }
        c.tool = .eraser
        return (c, view)
    }

    /// Three passes of the eraser through dense writing, 6 page units a sample.
    func paths(_ view: BoardCanvasView) -> [[CGPoint]] {
        [140.0, 430, 720].map { y in
            stride(from: 40.0, through: 1560, by: 6).map { x in view.camera.toView(Vec2(x, y + sin(x / 40) * 18)) }
        }
    }

    func sample(_ p: CGPoint, _ t: TimeInterval) -> BoardCanvasView.Sample {
        BoardCanvasView.Sample(view: p, pressure: 0.5, altitude: -1, azimuth: 0, timestamp: t)
    }

    /// The new path: one erase and one tile flush a touch event.
    func batched(_ c: BoardController, _ view: BoardCanvasView) -> Result {
        var r = Result()
        var gone = Set<RecordID>()
        let sub = c.store.observe { ch in gone.formUnion(ch.removed.keys) }
        defer {
            _ = sub
        }
        var t = CACurrentMediaTime()
        for path in paths(view) {
            view.inkBegan(sample(path[0], t), pencil: true)
            view.flushTiles()
            var i = 1
            while i + 1 < path.count {
                t += 1.0 / 120
                let before = c.store.strokeCount
                let t0 = CACurrentMediaTime()
                view.inkMoved([sample(path[i], t - 1.0 / 240), sample(path[i + 1], t)], predicted: [])
                let t1 = CACurrentMediaTime()
                view.flushTiles() // what the run loop does before Core Animation commits
                let ms = (CACurrentMediaTime() - t0) * 1000
                if c.store.strokeCount < before {
                    r.perEvent.append(ms)
                    r.erase.append((t1 - t0) * 1000)
                    r.flush.append((CACurrentMediaTime() - t1) * 1000)
                    r.erased += before - c.store.strokeCount
                    r.tiles.append(view.lastTileFlush.tiles)
                }
                i += 2
            }
            view.inkEnded([], eventTime: t)
        }
        r.ids = gone
        return r
    }

    /// The old path, for comparison: an erase per sample, each redrawn at once.
    func perSample(_ c: BoardController, _ view: BoardCanvasView) -> Result {
        var r = Result()
        var gone = Set<RecordID>()
        let sub = c.store.observe { ch in gone.formUnion(ch.removed.keys) }
        defer {
            _ = sub
        }
        for path in paths(view) {
            c.beginErase()
            var last = view.camera.toPage(path[0])
            for i in stride(from: 1, to: path.count - 1, by: 2) {
                let before = c.store.strokeCount
                let t0 = CACurrentMediaTime()
                for p in [path[i], path[i + 1]] {
                    let page = view.camera.toPage(p)
                    c.erase(from: last, to: page, margin: BoardController.eraserReach / view.camera.scale)
                    view.flushTiles()
                    last = page
                }
                let ms = (CACurrentMediaTime() - t0) * 1000
                if c.store.strokeCount < before {
                    r.perEvent.append(ms)
                    r.erased += before - c.store.strokeCount
                }
            }
            c.endErase()
        }
        r.ids = gone
        return r
    }

    @Test func erasingAFiveThousandStrokeBoardStaysInAFrame() async throws {
        let (c0, v0) = await canvas()
        let old = perSample(c0, v0)
        let (c, v) = await canvas()
        let new = batched(c, v)
        #expect(new.erased > 100)
        let onlyOld = old.ids.subtracting(new.ids), onlyNew = new.ids.subtracting(old.ids)
        print("ERASE DIFF only per-sample: \(onlyOld.sorted().prefix(8)) only batched: \(onlyNew.sorted().prefix(8))")
        print(String(format: "PERF erase breakdown: hit test + store + scene %.2f ms median (%.2f p95), tile flush %.2f ms median (%.2f p95)",
                     BoardStats.percentile(new.erase, 0.5), BoardStats.percentile(new.erase, 0.95), BoardStats.percentile(new.flush, 0.5), BoardStats.percentile(new.flush, 0.95)))
        #expect(new.ids == old.ids) // the same strokes go either way
        // one undo step for each pass, and Undo brings every stroke back
        #expect(c.store.history.undoCount == 3)
        c.undo(); c.undo(); c.undo()
        #expect(c.store.strokeCount == 5000)
        print(String(format: "PERF erase on 5,000 strokes, %d events that erased (%d strokes): per event %.2f ms median, %.2f p95, %.2f max (tiles a flush: %.1f mean) | per sample, redrawn at once: %.2f median, %.2f p95, %.2f max",
                     new.perEvent.count, new.erased, new.p50, new.p95, new.max, Double(new.tiles.reduce(0, +)) / Double(max(1, new.tiles.count)),
                     old.p50, old.p95, old.max))
        // A 120 Hz frame is 8.3 ms. This is a Debug build on a shared, busy simulator host (other lanes
        // build beside it), so the bound here is loose; the batched path must beat the old one.
        // TODO(tools lane): pin the per-event budget on a device / an idle host (see the report).
        #expect(new.p50 < 16)
        #expect(new.p50 < old.p50)
    }
}
#endif
