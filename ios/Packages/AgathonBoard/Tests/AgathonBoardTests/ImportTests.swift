import CoreGraphics
import Foundation
import ImageIO
import Testing
import UniformTypeIdentifiers
@testable import AgathonBoard

struct TldrawImportTests {
    func load(_ name: String) throws -> TldrawImporter.Result {
        try TldrawImporter.importSnapshot(Fixtures.data(name))
    }

    @Test func kidAlgebraBoard() throws {
        let r = try load("kid-algebra.tldraw.json")
        let rep = r.report
        #expect(rep.screens == 2)
        #expect(rep.strokes == 50)
        #expect(rep.tutorStrokes == 12)
        #expect(rep.shapes == 4)
        #expect(rep.maths == 4)
        #expect(rep.graphs == 1)
        #expect(rep.lines == 4)
        #expect(rep.marks == 4)
        #expect(rep.skipped.isEmpty)
        #expect(rep.grownScreens == 0)
        let doc = r.document
        let screens = doc.screens
        #expect(screens.map(\.id) == ["screen:page", "screen:1wnTlXTPXU95SNCbXXEXt"])
        #expect(screens.allSatisfy { $0.rect == .screen })
        #expect(r.currentScreen == "screen:page")

        // the kid's ink is never in the tutor's colour; the tutor's always is (or its sketch colours)
        for s in doc.strokes {
            if s.author == .kid { #expect(s.color != .tutor) }
        }
        let p1 = doc.drawables(on: "screen:page").compactMap(\.stroke)
        #expect(p1.filter { $0.author == .tutor }.allSatisfy { $0.color == .tutor && $0.pressure == .real && $0.width <= 3 })
        // the kid's Pencil ink: real pressure, tldraw "l" (6), timed from meta.t / t1
        let kid = try #require(p1.first { $0.author == .kid })
        #expect(kid.pressure == .real && kid.width == 6)
        #expect(kid.start != nil)
        #expect((kid.points.last?.t ?? 0) > 0)
        #expect(kid.meta["t"] == nil && kid.meta["t1"] == nil)

        // marks over their strokes, aimed at their lines
        let marks = doc.records.values.compactMap { r -> MarkRecord? in if case .mark(let m) = r { return m }; return nil }
        #expect(marks.filter { $0.kind == .tick }.count == 3)
        #expect(marks.filter { $0.kind == .ring }.count == 1)
        for m in marks {
            #expect(!m.strokes.isEmpty)
            #expect(m.strokes.allSatisfy { doc.records[$0]?.stroke?.author == .tutor })
            if let t = m.target { #expect(doc.records[t] != nil, "mark target \(t)") }
        }
        // echoes became lines over the kid's strokes
        let lines = doc.records.values.compactMap { r -> LineRecord? in if case .line(let l) = r { return l }; return nil }
        #expect(lines.count == 4)
        #expect(lines.allSatisfy { !$0.strokes.isEmpty && $0.strokes.allSatisfy { doc.records[$0]?.stroke?.author == .kid } })
        #expect(Set(lines.map(\.verdict)) == [.ok, .warn])

        // page 2: shapes and the tutor's filled shapes
        let p2 = doc.drawables(on: "screen:1wnTlXTPXU95SNCbXXEXt")
        let kinds = p2.compactMap { r -> ShapeKind? in if case .shape(let s) = r { return s.kind }; return nil }
        #expect(Set(kinds) == [.rect, .ellipse, .arrow, .line])
        let filled = p2.compactMap(\.stroke).filter { $0.closed && $0.fill != .none }
        #expect(filled.count >= 2)
        let finger = p2.compactMap(\.stroke).filter { $0.author == .kid }
        #expect(finger.allSatisfy { $0.pressure == .simulated && $0.width == 4.5 })
    }

    @Test func legacyBoardGrowsItsScreen() throws {
        let r = try load("legacy-noscreen.tldraw.json")
        #expect(r.report.screens == 1 && r.report.grownScreens == 1)
        let rect = try #require(r.document.screens.first?.rect)
        // the web grows it to 2330 × 1311 (the reference render's viewport)
        #expect(rect.x == 0 && rect.y == 0)
        #expect(abs(rect.w - 2330) <= 1 && abs(rect.h - 1311) <= 1)
        #expect(r.report.strokes == 9) // 8 draw + 1 highlight
        #expect(r.report.images == 1)
        #expect(r.report.texts == 1 && r.report.skipped.isEmpty) // the text is a typed note now
        // group children land where the group puts them, rotated with it
        let strokes = r.document.strokes
        #expect(strokes.contains { abs($0.rotation - 0.4) < 1e-9 })
        #expect(strokes.contains { abs($0.rotation + 0.35) < 1e-9 })
        #expect(strokes.contains { $0.width == 22 }) // xl at scale 2
        #expect(strokes.contains { $0.points.count == 1 }) // the dot
        #expect(strokes.contains { $0.meta["highlight"] == true })
        let image = try #require(r.document.records.values.compactMap { r -> ImageRecord? in if case .image(let i) = r { return i }; return nil }.first)
        #expect(image.asset.src.hasPrefix("https://"))
    }

    @Test func syntheticBoardAndBareForm() throws {
        let r = try load("synthetic-2000.tldraw.json")
        #expect(r.report.screens == 5)
        #expect(r.report.strokes == 2224)
        #expect(r.report.maths == 224)
        let small = try load("legacy-small.tldraw.json")
        #expect(small.report.strokes == 1 && small.report.shapes == 1 && small.report.texts == 1 && small.report.skipped.isEmpty)
    }

    @Test func convertedBoardsRoundTripAndConvertTheSameTwice() throws {
        for name in ["kid-algebra.tldraw.json", "legacy-noscreen.tldraw.json", "synthetic-2000.tldraw.json", "legacy-small.tldraw.json", "all-shapes.tldraw.json"] {
            let a = try load(name).document
            let b = try load(name).document
            #expect(a == b, "\(name) converts the same way twice")
            let back = try BoardDocument.decode(a.encoded())
            #expect(back == a, "\(name) round trip")
        }
    }

    @Test func rejectsWhatIsNotASnapshot() {
        #expect(throws: TldrawImporter.ImportError.notASnapshot) { try TldrawImporter.importSnapshot(Data("[1,2]".utf8)) }
        #expect(throws: TldrawImporter.ImportError.noPages) { try TldrawImporter.importSnapshot(Data(#"{"store":{}}"#.utf8)) }
    }

    @Test func boardsAreMuchSmallerThanTldraws() throws {
        let raw = try Fixtures.data("synthetic-2000.tldraw.json")
        let ours = try load("synthetic-2000.tldraw.json").document.encoded(sortedKeys: false)
        print(String(format: "SIZE synthetic-2000: tldraw %.0f KB → Agathon %.0f KB (%.1f× smaller)", Double(raw.count) / 1000, Double(ours.count) / 1000, Double(raw.count) / Double(ours.count)))
        #expect(ours.count * 2 < raw.count)
    }
}

/// Our render of a converted board against tldraw's own render of the original (reference PNGs made
/// by Tools/fixtures/tldraw-reference.mjs with tldraw's svgInk): the ink lands where tldraw's does,
/// at about the same weight.
struct RenderComparisonTests {
    struct Mask {
        let w: Int, h: Int
        var bits: [Bool]
        func at(_ x: Int, _ y: Int) -> Bool { x >= 0 && y >= 0 && x < w && y < h && bits[y * w + x] }
        func dilated(_ r: Int) -> Mask {
            var out = self
            for y in 0..<h {
                for x in 0..<w where !bits[y * w + x] {
                    search: for dy in -r...r {
                        for dx in -r...r where at(x + dx, y + dy) {
                            out.bits[y * w + x] = true
                            break search
                        }
                    }
                }
            }
            return out
        }
        var count: Int { bits.reduce(0) { $0 + ($1 ? 1 : 0) } }
    }

    static func rgba(_ image: CGImage, w: Int, h: Int) -> [UInt8] {
        var buf = [UInt8](repeating: 255, count: w * h * 4)
        buf.withUnsafeMutableBytes { raw in
            let ctx = CGContext(data: raw.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
            ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        }
        return buf
    }

    /// pixels clearly inked (not white, not a pale tint)
    static func mask(_ px: [UInt8], w: Int, h: Int) -> Mask {
        var bits = [Bool](repeating: false, count: w * h)
        for i in 0..<(w * h) {
            let r = Int(px[i * 4]), g = Int(px[i * 4 + 1]), b = Int(px[i * 4 + 2])
            bits[i] = min(r, g, b) < 150
        }
        return Mask(w: w, h: h, bits: bits)
    }

    func compare(_ fixture: String, page: Int, reference: String) throws -> (precision: Double, weight: Double, out: URL) {
        let result = try TldrawImporter.importSnapshot(Fixtures.data(fixture))
        let screen = result.document.screens[page]
        let strokes = result.document.drawables(on: screen.id).compactMap(\.stroke).filter { $0.meta["highlight"] == nil }
        let items = strokes.map(RenderGeometry.stroke)
        let w = Int(screen.rect.w.rounded(.up)), h = Int(screen.rect.h.rounded(.up))
        let ctx = try #require(TileRasterizer.render(items, rect: screen.rect, scale: 1))
        let ours = try #require(ctx.makeImage())
        let ref = try #require(CGImageSourceCreateWithURL(Fixtures.url("reference/\(reference)") as CFURL, nil).flatMap { CGImageSourceCreateImageAtIndex($0, 0, nil) })
        #expect(ref.width == w && ref.height == h)
        let a = Self.mask(Self.rgba(ours, w: w, h: h), w: w, h: h)
        let b = Self.mask(Self.rgba(ref, w: w, h: h), w: w, h: h)
        let bd = b.dilated(1)
        let ad = a.dilated(3)
        var aInB = 0, bNearA = 0
        for i in 0..<(w * h) {
            if a.bits[i] && bd.bits[i] { aInB += 1 }
            if b.bits[i] && ad.bits[i] { bNearA += 1 }
        }
        // write ours for eyes (and the report's side-by-side)
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("agathon-board-render", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let out = dir.appendingPathComponent("ours-\(reference)")
        func write(_ image: CGImage, to url: URL) {
            guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { return }
            let flat = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                 bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            flat.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
            flat.fill(CGRect(x: 0, y: 0, width: w, height: h))
            flat.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
            CGImageDestinationAddImage(dest, flat.makeImage()!, nil)
            CGImageDestinationFinalize(dest)
        }
        write(ours, to: out)
        // and everything on the screen, for eyes
        let all = result.document.drawables(on: screen.id).compactMap { RenderGeometry.item(for: $0) }
        if let full = TileRasterizer.render(all, rect: screen.rect, scale: 1)?.makeImage() {
            write(full, to: dir.appendingPathComponent("ours-full-\(reference)"))
        }
        return (Double(aInB) / Double(max(1, a.count)), Double(a.count) / Double(max(1, bNearA)), out)
    }

    @Test func kidAlgebraInkMatchesTldraw() throws {
        let r = try compare("kid-algebra.tldraw.json", page: 0, reference: "kid-algebra-p1.png")
        print(String(format: "RENDER kid-algebra p1: %.1f%% of our ink where tldraw's is; ink weight %.2f× tldraw's → %@", r.precision * 100, r.weight, r.out.path))
        #expect(r.precision > 0.93)
        #expect(r.weight > 0.8 && r.weight < 1.25)
    }

    @Test func fingerInkMatchesTldraw() throws {
        let r = try compare("kid-algebra.tldraw.json", page: 1, reference: "kid-algebra-p2.png")
        print(String(format: "RENDER kid-algebra p2: %.1f%% of our ink where tldraw's is; ink weight %.2f× tldraw's → %@", r.precision * 100, r.weight, r.out.path))
        #expect(r.precision > 0.9)
        #expect(r.weight > 0.75 && r.weight < 1.33)
    }

    @Test func legacyInkMatchesTldraw() throws {
        let r = try compare("legacy-noscreen.tldraw.json", page: 0, reference: "legacy-noscreen-p1.png")
        print(String(format: "RENDER legacy-noscreen: %.1f%% of our ink where tldraw's is; ink weight %.2f× tldraw's → %@", r.precision * 100, r.weight, r.out.path))
        #expect(r.precision > 0.85)
        #expect(r.weight > 0.7 && r.weight < 1.4)
    }
}
