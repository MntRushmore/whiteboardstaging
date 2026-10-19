import AgathonBoard
import AgathonDesign
import CoreGraphics
import Foundation
import ImageIO
import PDFKit
import Testing
import UIKit
import UniformTypeIdentifiers
@testable import AgathonBoardUI

enum Fixtures {
    static func url(_ name: String) -> URL {
        Bundle.module.url(forResource: name, withExtension: nil, subdirectory: "Fixtures")!
    }
}

struct DockLayoutTests {
    let help: CGFloat = 216 // Help me's width (DS HelpMeButton)

    @Test func everythingFitsOnABigIPadOnItsSide() {
        // iPad Pro 13-inch landscape: 1376 pt, 40 pt margins
        #expect(DockLayout.fitting(width: 1376 - 80, helpWidth: help, pages: 3) == DockLayout(fit: .row, helpAbove: false))
    }

    @Test func itFoldsAsTheBoardNarrows() {
        // iPad Pro 11-inch landscape (1194): Shapes, Picture and Redo behind More
        #expect(DockLayout.fitting(width: 1194 - 80, helpWidth: help, pages: 3).fit == .fold)
        // iPad Pro 13-inch portrait (1032): the pens behind Color too
        #expect(DockLayout.fitting(width: 1032 - 48, helpWidth: help, pages: 3).fit == .foldColors)
        // iPad Pro 11-inch portrait (834): Help me goes above, the dock keeps as much as fits
        let p11 = DockLayout.fitting(width: 834 - 48, helpWidth: help, pages: 3)
        #expect(p11.helpAbove && p11.fit == .foldColors)
        // a narrow split view: the most folded dock, Help me above
        let split = DockLayout.fitting(width: 500, helpWidth: help, pages: 3)
        #expect(split.helpAbove && split.fit == .compact && split.newPageInMore)
        // no Help me (the slot empty): more room for the dock
        #expect(DockLayout.fitting(width: 1000, helpWidth: 0, pages: 3).fit == .row)
        // never wider than the room it was given, once it fits beside or above
        for w in stride(from: 600.0, through: 1400, by: 20) {
            let l = DockLayout.fitting(width: CGFloat(w), helpWidth: help, pages: 2)
            let need = DockLayout.width(l.fit, pages: 2) + (l.helpAbove ? 0 : help + DockLayout.Size.helpGap)
            #expect(need <= CGFloat(w))
        }
    }

    @Test func oneShortWordUnderEachTool() {
        let words = [DockCopy.select, DockCopy.pen, DockCopy.eraser, DockCopy.shapes, DockCopy.picture, DockCopy.undo, DockCopy.redo,
                     DockCopy.more, DockCopy.color, DockCopy.line, DockCopy.arrow, DockCopy.box, DockCopy.circle, DockCopy.photos,
                     DockCopy.camera, DockCopy.files, DockCopy.copy, DockCopy.delete]
        for w in words {
            #expect(!w.contains(" ") && w.count <= 7, "\(w)")
            #expect(w.first?.isUppercase == true)
        }
        #expect(DockCopy.newPage == "New page") // the web's two words, the dock's widest
        #expect(DockCopy.color == "Color") // US English
        #expect(DockCopy.pageOf(2, 3) == "Page 2 of 3")
        // a problem page in a set says where in the set (docs/PROBLEM-PAGES.md); a kid's own page, a page
        // of no set, says the page
        #expect(DockCopy.whereAmI(ProblemPage(setId: "daily:x", index: 2, count: 5), screen: 3, of: 7) == "Problem 2 of 5")
        #expect(DockCopy.whereAmI(ProblemPage(kind: .done, setId: "daily:x"), screen: 7, of: 7) == "All done")
        #expect(DockCopy.whereAmI(ProblemPage(origin: "student"), screen: 4, of: 7) == "Page 4 of 7")
        #expect(DockCopy.whereAmI(ProblemPage(setId: "nyt:1", index: 1, count: 1), screen: 2, of: 2) == "Page 2 of 2")
        #expect(DockCopy.whereAmI(nil, screen: 1, of: 1) == "Page 1 of 1")
        // kind words: never "wrong"
        for s in [DockCopy.pictureFailed, DockCopy.pdfFailed, DockCopy.deleteMessage, DockCopy.boardFullMessage] {
            #expect(!s.lowercased().contains("wrong"))
        }
    }
}

struct PenColourTests {
    @Test func theBoardDrawsThePensTheDockShows() {
        #expect(InkColor.kidPalette.map(\.rawValue) == DS.KidPen.all.map(\.id))
        for pen in DS.KidPen.all {
            let ink = InkColor(rawValue: pen.id)!
            #expect(abs(ink.rgb.r - pen.rgb.r) < 0.002 && abs(ink.rgb.g - pen.rgb.g) < 0.002 && abs(ink.rgb.b - pen.rgb.b) < 0.002, "\(pen.id)")
        }
        let tutor = DS.ColorTokens.tutorInk.light
        #expect(abs(InkColor.tutor.rgb.r - tutor.r) < 0.002 && abs(InkColor.tutor.rgb.b - tutor.b) < 0.002)
    }
}

struct MathRenderTests {
    static let corpus: [String] = {
        let data = try! Data(contentsOf: Fixtures.url("latex-corpus.json"))
        return try! JSONDecoder().decode([String].self, from: data)
    }()

    /// Every line of the tutor's corpus (the brain's golden cases: the kid's lines as read, the
    /// tutor's steps and answers) typesets and draws without a crash; nearly all of it really
    /// typeset, not the plain-text fallback.
    @Test func theTutorsLatexCorpusTypesets() throws {
        let colour = RenderGeometry.cgColor(.tutor)
        var fallbacks: [String] = []
        let ctx = try #require(TileRasterizer.makeContext(rect: Box(x: 0, y: 0, w: 1600, h: 400), scale: 0.5))
        for latex in Self.corpus {
            let t = SwiftMathTypesetter.make(latex, fontSize: 24, color: colour)
            #expect(t.width.isFinite && t.ascent.isFinite && t.descent.isFinite)
            if t.isFallback { fallbacks.append(latex) }
            t.draw(ctx, CGPoint(x: 10, y: 100))
        }
        print("MATH corpus \(Self.corpus.count) lines, \(fallbacks.count) as plain text: \(fallbacks.prefix(10))")
        #expect(Self.corpus.count > 3000)
        #expect(Double(fallbacks.count) < Double(Self.corpus.count) * 0.005)
    }

    @Test func whatTheBriefNames() {
        let colour = RenderGeometry.cgColor(.tutor)
        for latex in ["\\frac{3}{4}", "x^{2} + 2^{10}", "\\sqrt{x + 1}", "\\sqrt[3]{27}", "\\text{area} = 12 \\text{ cm}^2",
                      "\\begin{aligned} 2x + 3 &= 11 \\\\ x &= 4 \\end{aligned}", "\\begin{cases} x & x > 0 \\\\ -x & x \\le 0 \\end{cases}",
                      "\\operatorname{med} = 4", "8^{2} + 15^{2} \\stackrel{?}{=} 17^{2}", "9 \\longdiv { 144 }", "\\dfrac{1}{2}"] {
            let t = SwiftMathTypesetter.make(latex, fontSize: 24, color: colour)
            #expect(!t.isFallback, "\(latex)")
            #expect(t.width > 5, "\(latex)")
        }
        // aligned stacks its lines: taller than one line
        let one = SwiftMathTypesetter.make("2x + 3 = 11", fontSize: 24, color: colour)
        let two = SwiftMathTypesetter.make("\\begin{aligned} 2x + 3 &= 11 \\\\ x &= 4 \\end{aligned}", fontSize: 24, color: colour)
        #expect(two.height > one.height * 1.6)
    }

    @Test func aSumInColumnsKeepsItsRules() {
        let c = LatexPrep.column("\\begin{array}{r} 286 \\\\ +680 \\\\ \\hline 966 \\end{array}")
        #expect(c == LatexPrep.Column(rows: ["286", "+680", "966"], rulesAbove: [2]))
        let t = SwiftMathTypesetter.make("\\begin{array}{r} 286 \\\\ +680 \\\\ \\hline 966 \\end{array}", fontSize: 24, color: RenderGeometry.cgColor(.tutor))
        #expect(!t.isFallback && t.height > 60)
        // a two-column array is a matrix, not a column
        #expect(LatexPrep.column("\\begin{array}{ll} a & b \\end{array}") == nil)
        #expect(LatexPrep.prepare("\\begin{array}{ll} a & b \\end{array}").contains("matrix"))
    }

    @Test @MainActor func installedTheBoardDrawsMathsTypeset() throws {
        BoardEditorSetup.install()
        let m = MathRecord(id: "math:a", screen: "screen:a", order: "a1", role: .answer, latex: "\\frac{1}{2}", x: 0, y: 0, w: 0, h: 0, fontSize: 40)
        let item = try #require(RenderGeometry.item(for: .math(m)))
        // a fraction is taller than a line of text
        #expect(item.bounds.h > 60)
    }
}

@MainActor
struct PictureImportTests {
    static func jpegWithLocation(w: Int, h: Int) -> Data {
        let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
        ctx.setFillColor(CGColor(red: 0.2, green: 0.6, blue: 0.3, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
        let out = NSMutableData()
        let dest = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil)!
        let gps: [CFString: Any] = [kCGImagePropertyGPSLatitude: 37.33, kCGImagePropertyGPSLatitudeRef: "N",
                                    kCGImagePropertyGPSLongitude: 122.03, kCGImagePropertyGPSLongitudeRef: "W"]
        CGImageDestinationAddImage(dest, ctx.makeImage()!, [kCGImagePropertyGPSDictionary: gps] as CFDictionary)
        CGImageDestinationFinalize(dest)
        return out as Data
    }

    @Test func photosLoseTheirLocationAndShrink() throws {
        let photo = Self.jpegWithLocation(w: 4032, h: 3024)
        let src = try #require(CGImageSourceCreateWithData(photo as CFData, nil))
        let before = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any]
        #expect(before?[kCGImagePropertyGPSDictionary] != nil)
        let p = try PictureImport.prepare(photo)
        #expect(p.mimeType == "image/jpeg")
        #expect(max(p.image.width, p.image.height) == PictureImport.maxPixels)
        let out = try #require(CGImageSourceCreateWithData(p.data as CFData, nil))
        let after = CGImageSourceCopyPropertiesAtIndex(out, 0, nil) as? [CFString: Any]
        #expect(after?[kCGImagePropertyGPSDictionary] == nil)
        #expect(throws: PictureImport.Failure.notAPicture) { try PictureImport.prepare(Data("not a picture".utf8)) }
    }

    @Test func aPDFPageRendersAtTheScreensResolutionAndGoesOnLocked() async throws {
        let doc = BoardFixtures.worksheetPDF()
        let page = try #require(doc.page(at: 0))
        #expect(PictureImport.pageSize(page) == CGSize(width: 612, height: 792))
        let img = try #require(PictureImport.render(page, width: 1600))
        #expect(img.width == 1600 && img.height == Int((1600.0 * 792 / 612).rounded()))
        // ink on the page (the worksheet's words), white around
        let c = BoardController(defaults: UserDefaults(suiteName: "test.pdf.\(UUID())")!, images: BoardImageCache())
        let store = MemoryBoardAssetStore()
        c.assetStore = store
        c.boardId = "b"
        let id = try #require(await c.insertPDFPage(doc, index: 0, fileName: "Fractions.pdf"))
        guard case .image(let r)? = c.store[id] else {
            Issue.record("no image")
            return
        }
        // as on the web: never scaled up, centred on the screen
        #expect(r.w == 612 && r.h == 792 && abs(r.x + r.w / 2 - 800) < 1e-9 && abs(r.y + r.h / 2 - 450) < 1e-9)
        #expect(r.meta["locked"]?.boolValue == true && r.meta["kind"]?.stringValue == "pdf" && r.meta["page"]?.numberValue == 1)
        #expect(r.asset.mime == "image/png")
        let uploads = await store.uploads
        #expect(uploads.count == 1 && uploads[0].source == "pdf")
        // locked: Select and the eraser leave it alone
        #expect(!c.isSelectable(.image(r)) && !BoardController.erasable(.image(r)))
    }

    @Test func aLockedPDFIsRefused() throws {
        let doc = BoardFixtures.worksheetPDF()
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("locked-\(UUID()).pdf")
        #expect(doc.write(to: url, withOptions: [.ownerPasswordOption: "owner", .userPasswordOption: "kid"]))
        #expect(throws: PictureImport.Failure.pdfLocked) { _ = try PictureImport.openPDF(url) }
        let ok = FileManager.default.temporaryDirectory.appendingPathComponent("open-\(UUID()).pdf")
        #expect(doc.write(to: ok))
        #expect(try PictureImport.openPDF(ok).pageCount == 1)
    }
}

@MainActor
struct FixtureAndThumbnailTests {
    @Test func theObjectsBoardHasItsPictures() async throws {
        let t0 = CFAbsoluteTimeGetCurrent()
        let (doc, store) = await BoardFixtures.objects()
        print(String(format: "FIXTURE objects board made in %.0f ms", (CFAbsoluteTimeGetCurrent() - t0) * 1000))
        #expect(doc.screens.count == 3)
        let images = doc.records.values.compactMap { r -> ImageRecord? in if case .image(let i) = r { return i } else { return nil } }
        #expect(images.count == 2)
        for i in images { #expect(try await store.data(for: URL(string: i.asset.src)!).count > 1000) }
        #expect(doc.records.values.contains { $0.type == .graph } && doc.records.values.contains { $0.type == .math })
        let t1 = CFAbsoluteTimeGetCurrent()
        let shot = try #require(ScreenThumbnail.render(doc.drawables(on: "screen:objects"), screen: .screen, width: 440))
        print(String(format: "FIXTURE thumbnail in %.0f ms", (CFAbsoluteTimeGetCurrent() - t1) * 1000))
        #expect(shot.width == 440 && shot.height == 248)
    }
}
