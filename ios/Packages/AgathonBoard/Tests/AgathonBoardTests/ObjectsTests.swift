import CoreGraphics
import Foundation
import ImageIO
import Testing
import UniformTypeIdentifiers
@testable import AgathonBoard

struct MathExprTests {
    func near(_ a: Double, _ b: Double, _ eps: Double = 1e-9) -> Bool { abs(a - b) <= eps * max(1, abs(b)) }

    @Test func mathjsPrecedence() {
        #expect(near(MathExpr.evaluate("x ^ 2", x: 3), 9))
        #expect(near(MathExpr.evaluate("-x ^ 2", x: 3), -9)) // -(x^2)
        #expect(near(MathExpr.evaluate("2 ^ 3 ^ 2", x: 0), 512)) // right-associative
        #expect(near(MathExpr.evaluate("2 * x + 3", x: 4), 11))
        #expect(near(MathExpr.evaluate("2 x + 1", x: 4), 9)) // implicit multiplication
        #expect(near(MathExpr.evaluate("2(x + 1)", x: 4), 10))
        #expect(near(MathExpr.evaluate("(x + 1)(x - 1)", x: 4), 15))
        #expect(near(MathExpr.evaluate("1 / 2 x", x: 4), 2)) // mathjs rule 2: (1/2)·x
        #expect(near(MathExpr.evaluate("x / 2 x", x: 4), 0.5)) // not rule 2 (x is not a number): implicit binds tighter, x / (2x)
        #expect(near(MathExpr.evaluate("2 ^ -x", x: 1), 0.5))
        #expect(near(MathExpr.evaluate("3!", x: 0), 6))
        #expect(near(MathExpr.evaluate("7 mod 3", x: 0), 1))
        #expect(near(MathExpr.evaluate("-7 mod 3", x: 0), 2)) // mathjs: the divisor's sign
        #expect(near(MathExpr.evaluate("1e-3 * x", x: 1000), 1))
    }

    @Test func functionsAndConstants() {
        #expect(near(MathExpr.evaluate("sqrt(x)", x: 16), 4))
        #expect(MathExpr.evaluate("sqrt(x)", x: -1).isNaN) // complex: not plotted
        #expect(near(MathExpr.evaluate("abs((3 * x + 6))", x: -4), 6))
        #expect(near(MathExpr.evaluate("log(x, 2)", x: 8), 3))
        #expect(near(MathExpr.evaluate("log(x)", x: M_E), 1))
        #expect(near(MathExpr.evaluate("nthRoot(x, 3)", x: -8), -2))
        #expect(near(MathExpr.evaluate("cbrt(x)", x: 27), 3))
        #expect(near(MathExpr.evaluate("sin(pi / 2)", x: 0), 1))
        #expect(near(MathExpr.evaluate("e ^ x", x: 1), M_E))
        #expect(MathExpr.evaluate("x ^ 0.5", x: -4).isNaN)
        #expect(near(MathExpr.evaluate("(-8) ^ 3", x: 0), -512))
        #expect(MathExpr.evaluate("1 / x", x: 0).isInfinite)
    }

    @Test func otherSymbolsDoNotCompile() {
        #expect(MathExpr.compile("a * x + b") == nil)
        #expect(MathExpr.compile("2 * t") == nil)
        #expect(MathExpr.compile("x +") == nil)
        #expect(MathExpr.compile("foo(x)") == nil)
        #expect(MathExpr.compile("sqrt(x, 2)") == nil)
        #expect(MathExpr.compile("x + i") == nil)
    }

    /// Every graph expression the engine wrote in the brain's golden cases compiles and plots.
    @Test func theEnginesGraphExpressionsCompile() {
        let exprs = [
            "x ^ 2", "2 * x + 3", "((x ^ 2 - 4) / (x ^ 2 - x - 2))", "x ^ 2 - 3 * x", "((12) / (x))", "2 * (x - 3) ^ 2 + 1",
            "abs(x)", "sqrt(x)", "-x + 7", "x ^ 3", "((1) / (2)) * x + 3", "0.5 * x + 2", "-x ^ 2 + 4 * x + 1", "(x + 4) ^ 2 - 7",
            "200 * (1.5) ^ x", "-((2) / (3)) * x + 2", "-((3) / (4)) * x - ((5) / (2))", "(sqrt((2 * x - 6)))", "2 ^ x",
            "(abs((3 * x + 6)))", "((1) / (x - 2)) + 3", "((x) + 6)", "-2 * ((x) ^ 2)", "((2 * x) ^ 2)", "-(abs((x + 2))) + 3",
            "(((1) / ((x - 2)))) + 3", "3 * (2 ^ (x)) - 1", "((x ^ 3) / (x ^ 2 - 1))",
        ]
        for e in exprs {
            let f = MathExpr.compile(e)
            #expect(f != nil, "\(e)")
            #expect(f.map { g in (-10...10).contains { x in g(Double(x) + 0.37).isFinite } } == true, "\(e)")
        }
        #expect(near(MathExpr.evaluate("((x ^ 2 - 4) / (x ^ 2 - x - 2))", x: 3), 5.0 / 4))
        #expect(near(MathExpr.evaluate("200 * (1.5) ^ x", x: 2), 450))
    }
}

struct GraphPlotTests {
    @Test func asymptotesBreakTheCurve() {
        let g = GraphRecord(screen: "screen:a", order: "a1", x: 0, y: 0, w: 400, h: 300,
                            functions: [GraphFunction(id: "f", expr: "1 / x", latex: "\\frac{1}{x}")], window: GraphWindow(xMin: -5, xMax: 5, yMin: -5, yMax: 5))
        let p = GraphPlot.build(g, w: 400, h: 300)
        #expect(p.curves.count == 1)
        #expect(p.curves[0].runs.count == 2) // either side of x = 0
        let tan = GraphPlot.build(GraphRecord(screen: "screen:a", order: "a1", x: 0, y: 0, w: 400, h: 300,
                                              functions: [GraphFunction(id: "t", expr: "tan(x)", latex: "")], window: GraphWindow(xMin: -5, xMax: 5, yMin: -5, yMax: 5)), w: 400, h: 300)
        // poles at ±π/2 and ±3π/2 (and, as on the web, a sample shooting up beside a pole starts its own run)
        #expect(tan.curves[0].runs.count >= 5)
        for run in tan.curves[0].runs {
            let xs = run.map { -5 + ($0.x - GraphPlot.pad) / (400 - 2 * GraphPlot.pad) * 10 }
            for pole in [-3 * Double.pi / 2, -Double.pi / 2, Double.pi / 2, 3 * Double.pi / 2] {
                #expect(!(xs.contains { $0 < pole } && xs.contains { $0 > pole }))
            }
        }
        let sqrt = GraphPlot.build(GraphRecord(screen: "screen:a", order: "a1", x: 0, y: 0, w: 400, h: 300,
                                               functions: [GraphFunction(id: "s", expr: "sqrt(x)", latex: "")]), w: 400, h: 300)
        #expect(sqrt.curves[0].runs.count == 1)
        #expect(sqrt.curves[0].runs[0].allSatisfy { $0.x >= 199 }) // only where x ≥ 0 (the middle)
    }

    @Test func ticksAxesAndWindow() {
        #expect(GraphPlot.niceTicks(-10, 10, target: 4) == [-10, -5, 0, 5, 10])
        #expect(GraphPlot.niceTicks(0, 1, target: 5) == [0, 0.2, 0.4, 0.6, 0.8, 1])
        #expect(GraphPlot.formatTick(0.30000000000000004) == "0.3")
        #expect(GraphPlot.formatTick(-2) == "-2")
        #expect(GraphPlot.formatTick(2_500_000) == "2.5e+06")
        let p = GraphPlot.build(GraphRecord(screen: "screen:a", order: "a1", x: 0, y: 0, w: 408, h: 308, points: [GraphPoint(x: 2, y: 4, label: "(2, 4)")],
                                            window: GraphWindow(xMin: -10, xMax: 10, yMin: -10, yMax: 10)), w: 408, h: 308)
        #expect(p.axisX == 204 && p.axisY == 154) // the middle
        let pt = try! #require(p.points.first?.at)
        #expect(abs(pt.x - 244) < 1e-9 && abs(pt.y - 94) < 1e-9)
        #expect(!p.gridLines.isEmpty)
        #expect(!p.labels.contains { $0.text == "0" }) // the origin is not labelled twice
    }

    @Test func autoYFollowsTheFunction() {
        let g = GraphRecord(screen: "screen:a", order: "a1", x: 0, y: 0, w: 400, h: 300,
                            functions: [GraphFunction(id: "f", expr: "x ^ 2", latex: "x^2")], window: GraphWindow(xMin: -3, xMax: 3, yMin: -10, yMax: 10, autoY: true))
        let p = GraphPlot.build(g, w: 400, h: 300)
        // the web's padded 5th–95th percentiles: about -0.8 … 8.9 for x² on -3…3
        #expect(p.yRange.lowerBound < 0 && p.yRange.lowerBound > -1.5)
        #expect(p.yRange.upperBound > 8 && p.yRange.upperBound < 10)
    }

    @Test func theGraphRendersItsCurveInTheTutorsInk() throws {
        let g = GraphRecord(id: "graph:g", screen: "screen:a", order: "a1", author: .tutor, x: 40, y: 40, w: 480, h: 360,
                            functions: [GraphFunction(id: "f", expr: "x ^ 2 - 4", latex: "y = x^2 - 4", color: .black)],
                            window: GraphWindow(xMin: -5, xMax: 5, yMin: -6, yMax: 10))
        let item = try #require(RenderGeometry.item(for: .graph(g)))
        let strokes = item.ops.compactMap { op -> CGColor? in
            if case .stroke(_, let c, let w, _, _, _) = op, w >= 2 { return c }
            return nil
        }
        #expect(strokes.contains { $0 == RenderGeometry.cgColor(.tutor) })
        // drawn, not an empty grid: some tutor-ink pixels in the plot
        let ctx = try #require(TileRasterizer.render([item], rect: Box(x: 0, y: 0, w: 560, h: 440), scale: 1))
        let px = RenderComparisonTests.rgba(try #require(ctx.makeImage()), w: 560, h: 440)
        var cobalt = 0
        for i in stride(from: 0, to: px.count, by: 4) where px[i + 2] > 200 && px[i] < 120 && px[i + 1] < 150 { cobalt += 1 }
        #expect(cobalt > 300)
    }
}

@MainActor
struct PictureTests {
    static func pngData(w: Int, h: Int, color: CGColor) -> Data {
        let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.setFillColor(color)
        ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
        let out = NSMutableData()
        let dest = CGImageDestinationCreateWithData(out, UTType.png.identifier as CFString, 1, nil)!
        CGImageDestinationAddImage(dest, ctx.makeImage()!, nil)
        CGImageDestinationFinalize(dest)
        return out as Data
    }

    @Test func memoryStoreUploadsAndReads() async throws {
        let store = MemoryBoardAssetStore()
        let data = Self.pngData(w: 40, h: 30, color: CGColor(red: 1, green: 0, blue: 0, alpha: 1))
        let url = try await store.upload(data, mimeType: "image/png", boardId: "b1", width: 40, height: 30, source: "photo")
        #expect(url.scheme == "memory" && url.path.hasPrefix("/b1/") && url.pathExtension == "png")
        #expect(try await store.data(for: url) == data)
        let uploads = await store.uploads
        #expect(uploads.count == 1 && uploads[0].width == 40 && uploads[0].source == "photo")
        await store.setFailing(true)
        await #expect(throws: MemoryBoardAssetStore.StoreError.uploadFailed) {
            _ = try await store.upload(data, mimeType: "image/png", boardId: "b1", width: 40, height: 30, source: "photo")
        }
        await #expect(throws: MemoryBoardAssetStore.StoreError.self) {
            _ = try await store.data(for: URL(string: "memory://nope")!)
        }
    }

    @Test func picturesAreDownsampledToWhatTheScreenShows() throws {
        let big = Self.pngData(w: 4000, h: 3000, color: CGColor(red: 0, green: 0.5, blue: 1, alpha: 1))
        let img = try #require(BoardImageCache.decode(big, maxPixels: 1000))
        #expect(max(img.width, img.height) == 1000)
        #expect(BoardImageCache.pixels(forPageSize: 400, 300) == 1000)
        #expect(BoardImageCache.pixels(forPageSize: 3000, 2000) == 2560)
        #expect(BoardImageCache.pixels(forPageSize: 20, 20) == 256)
        let inline = "data:image/png;base64," + Self.pngData(w: 2, h: 2, color: CGColor(gray: 0, alpha: 1)).base64EncodedString()
        #expect(BoardImageCache.dataURLBytes(inline).flatMap { BoardImageCache.decode($0, maxPixels: 64) } != nil)
    }

    @Test func aPlaceholderUntilThePictureArrivesThenThePicture() async throws {
        let cache = BoardImageCache()
        let store = MemoryBoardAssetStore()
        let url = URL(string: "memory://board-assets/b/p.png")!
        await store.put(Self.pngData(w: 300, h: 200, color: CGColor(red: 1, green: 0, blue: 0, alpha: 1)), at: url)
        await store.setDelay(seconds: 0.2)
        let rec = ImageRecord(id: "image:p", screen: "screen:a", order: "a1", x: 100, y: 100, w: 300, h: 200, asset: AssetRef(src: url.absoluteString))
        let doc = BoardDocument([.screen(ScreenRecord(id: "screen:a", order: "a0")), .image(rec)])
        let c = BoardController(document: doc, defaults: UserDefaults(suiteName: "test.pic.\(UUID())")!, images: cache)
        let spy = SpyRenderer()
        c.renderer = spy
        c.assetStore = store
        // the placeholder: chalk and a glyph, no picture
        let first = try #require(c.scene.items["image:p"])
        #expect(!first.ops.contains { if case .image = $0 { return true } else { return false } })
        #expect(cache.state(for: url.absoluteString) == .loading)
        for _ in 0..<60 where cache.image(for: url.absoluteString) == nil { try await Task.sleep(nanoseconds: 50_000_000) }
        try await Task.sleep(nanoseconds: 50_000_000)
        let loaded = try #require(c.scene.items["image:p"])
        #expect(loaded.ops.contains { if case .image = $0 { return true } else { return false } })
        #expect(spy.deltas.contains { $0.added.contains { $0.id == "image:p" } && !$0.appendsOnTop })
        #expect(await store.reads == 1)
        // a picture that cannot be read: the placeholder says so
        let bad = ImageRecord(id: "image:bad", screen: "screen:a", order: "a2", x: 0, y: 0, w: 100, h: 100, asset: AssetRef(src: "memory://board-assets/b/missing.png"))
        await store.setDelay(seconds: 0)
        c.store.put(.image(bad), origin: .remote)
        for _ in 0..<40 where cache.state(for: bad.asset.src) != .failed { try await Task.sleep(nanoseconds: 25_000_000) }
        #expect(cache.state(for: bad.asset.src) == .failed)
    }

    @Test func insertingAPictureUploadsItThenPutsItOnTheBoard() async throws {
        let cache = BoardImageCache()
        let store = MemoryBoardAssetStore()
        let c = BoardController(defaults: UserDefaults(suiteName: "test.insert.\(UUID())")!, images: cache)
        c.assetStore = store
        c.boardId = "board-7"
        let data = Self.pngData(w: 3200, h: 2400, color: CGColor(red: 0, green: 1, blue: 0, alpha: 1))
        let img = try #require(BoardImageCache.decode(data, maxPixels: 3200))
        let id = try #require(await c.insertPicture(data, image: img, mimeType: "image/png", source: "photo"))
        guard case .image(let rec)? = c.store[id] else {
            Issue.record("no image record")
            return
        }
        // fitted in the screen with 40 units round it, never upscaled, centred
        #expect(abs(rec.h - 820) < 1e-6 && abs(rec.w - 820 * 4 / 3) < 1e-6)
        #expect(abs(rec.x + rec.w / 2 - 800) < 1e-6 && abs(rec.y - 40) < 1e-6)
        #expect(rec.asset.src.hasPrefix("memory://board-assets/board-7/"))
        #expect(rec.asset.w == 3200 && rec.author == .kid)
        #expect(cache.image(for: rec.asset.src) != nil) // shown at once, never fetched back
        #expect(c.store.history.undoCount == 1)
        #expect(c.pendingPictures.isEmpty)
        // small pictures keep their size
        let small = c.fitInScreen(CGSize(width: 200, height: 100))
        #expect(small.w == 200 && small.h == 100)
        // a failed upload leaves nothing on the board, and says so
        await store.setFailing(true)
        let none = await c.insertPicture(data, image: img, mimeType: "image/png", source: "photo")
        #expect(none == nil && c.notice?.kind == .pictureFailed)
        #expect(c.store.records.values.filter { $0.type == .image }.count == 1)
    }
}

@MainActor
struct MathRecordTests {
    @Test func readbacksAreGreyChipsAndAnswersAreTheTutors() throws {
        let rb = MathRecord(id: "math:r", screen: "screen:a", order: "a1", role: .readback, latex: "2x+3=11", x: 100, y: 100, w: 0, h: 0, fontSize: 24)
        let look = RenderGeometry.mathLook(rb)
        #expect(look.chip && look.color == nil && look.fontSize < 24)
        let ans = MathRecord(id: "math:a", screen: "screen:a", order: "a1", role: .answer, latex: "x = 4", x: 100, y: 100, w: 0, h: 0, fontSize: 24)
        #expect(RenderGeometry.mathLook(ans).color == .tutor && !RenderGeometry.mathLook(ans).chip)
        let note = MathRecord(id: "math:n", screen: "screen:a", order: "a1", author: .kid, role: .note, latex: "x", x: 0, y: 0, w: 0, h: 0)
        #expect(RenderGeometry.mathLook(note).color == .black)
        // the fallback reads the maths as text, never a command
        #expect(LatexText.plain("\\frac{1}{2} + x") == "1/2 + x")
        #expect(LatexText.plain("\\text{area} = 12 \\times 3") == "area = 12 × 3")
        #expect(LatexText.plain("x^{2} \\le \\sqrt{9}") == "x^2 ≤ √(9)")
        let item = try #require(RenderGeometry.item(for: .math(rb)))
        #expect(item.bounds.w > 40 && item.bounds.h > 10)
    }
}
