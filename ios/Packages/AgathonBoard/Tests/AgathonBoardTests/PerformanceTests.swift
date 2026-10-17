import CoreGraphics
import Foundation
import Testing
@testable import AgathonBoard

/// Load and lay out a 5,000-stroke screen, and the incremental paths (a stroke committed, a stroke
/// erased). Prints the numbers (`PERF …`); the bounds are loose so a Debug build on a busy machine
/// passes. The real numbers come from an optimized build on a device.
@MainActor
struct PerformanceTests {
    @Test func fiveThousandStrokes() throws {
        let doc = SyntheticBoards.handwriting(strokes: 5000)
        let points = doc.strokes.reduce(0) { $0 + $1.points.count }
        var data = Data()
        let encodeMs = try measureMs { data = try doc.encoded(sortedKeys: false) }
        var decoded = BoardDocument()
        let decodeMs = try measureMs { decoded = try BoardDocument.decode(data) }
        #expect(decoded == doc)

        var store: BoardStore!
        let loadMs = measureMs { store = BoardStore(document: decoded) }
        let screen = try #require(store.screens.first)
        let records = store.drawables(on: screen.id)
        var index = SceneIndex()
        let layoutMs = measureMs { index = SceneIndex.build(records) }
        #expect(index.count == 5000)

        // the whole screen rasterized at an iPad Pro 13-inch's fit resolution (1344 pt / 1600 × 2)
        let px: CGFloat = 1344.0 / 1600 * 2
        let tile = Double(512 / px)
        var tiles: [Box] = []
        var y = 0.0
        while y < 900 {
            var x = 0.0
            while x < 1600 {
                tiles.append(Box(x: x, y: y, w: tile, h: tile))
                x += tile
            }
            y += tile
        }
        let jobs = tiles.map { index.items(in: $0) }
        let rasterMs = measureMs {
            DispatchQueue.concurrentPerform(iterations: tiles.count) { i in
                _ = TileRasterizer.render(jobs[i], rect: tiles[i], scale: px)?.makeImage()
            }
        }

        // a stroke committed on the full board: store + its outline + painted onto its tiles
        let ctx = try #require(TileRasterizer.render(index.items(in: tiles[0]), rect: tiles[0], scale: px))
        var commits: [Double] = []
        for n in 0..<20 {
            var xy: [(Double, Double)] = []
            for i in 0..<120 {
                let t = Double(i)
                xy.append((40 + t * 1.2, 60 + Double(n) * 3 + sin(t / 9) * 20))
            }
            let stroke = makeStroke("stroke:new\(n)", screen: screen.id, order: store.nextOrder(on: screen.id), xy: xy)
            commits.append(measureMs {
                store.put(.stroke(stroke), origin: .kid)
                let item = RenderGeometry.stroke(store.stroke(stroke.id)!)
                index.upsert(item)
                item.draw(in: ctx)
                _ = ctx.makeImage()
            })
        }
        let commitMs = BoardStats.percentile(commits, 0.5)
        let commitMax = commits.max() ?? 0
        // an erase on the full board: hit test via the grid, remove, redraw the area clipped
        let target = try #require(records.compactMap(\.stroke).first)
        let p = target.pagePoint(target.points[target.points.count / 2])
        let eraseMs = measureMs {
            let near = index.ids(in: Box(x: p.x - 20, y: p.y - 20, w: 40, h: 40))
            let hits = near.filter { store.stroke($0).map { HitTest.eraserHits($0, from: p, to: p + Vec2(2, 2), margin: 16) } ?? false }
            store.remove(Array(hits), origin: .kid)
            var dirty: Box?
            for id in hits { if let b = index.remove(id)?.bounds { dirty = dirty.map { $0.union(b) } ?? b } }
            if let d = dirty {
                ctx.saveGState()
                ctx.clip(to: d.cgRect)
                ctx.clear(d.cgRect)
                for item in index.items(in: d) { item.draw(in: ctx) }
                ctx.restoreGState()
                _ = ctx.makeImage()
            }
        }
        print(String(format: "PERF 5,000 strokes (%d points, %.2f MB JSON): encode %.0f ms, decode %.0f ms, store load %.0f ms, layout (outlines + grid, parallel) %.0f ms, rasterize %d tiles (parallel) %.0f ms; commit one stroke %.2f ms (median of 20, max %.2f); erase %.2f ms",
                     points, Double(data.count) / 1_000_000, encodeMs, decodeMs, loadMs, layoutMs, tiles.count, rasterMs, commitMs, commitMax, eraseMs))
        #expect(decodeMs + loadMs + layoutMs + rasterMs < 30_000)
        #expect(commitMs < 250)
    }

    @Test func freehandThroughput() {
        // one long live stroke rebuilt as it grows: the cost per touch event at its longest
        let pts = (0..<1500).map { FreehandInput(Vec2(Double($0) * 1.2, sin(Double($0) / 15) * 30), 0.5 + 0.3 * sin(Double($0) / 40)) }
        let o = InkStyle.options(width: 6, pressure: .real, complete: false)
        let ms = measureMs(runs: 5) { _ = Freehand.path(Freehand.outline(pts, o)) }
        print(String(format: "PERF live outline of a 1,500-point stroke: %.2f ms", ms))
        #expect(ms < 100)
    }
}
