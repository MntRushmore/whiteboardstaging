import Foundation
import Testing
@testable import AgathonBoard

/// The full converter (Phase 1): every shape kind the web ever saved, on all-shapes.tldraw.json
/// (Tools/fixtures/make-fixtures.mjs), and nothing dropped.
struct ConverterTests {
    static func allShapes() throws -> (TldrawImporter.Result, [String: [String: JSONValue]]) {
        let data = try Fixtures.data("all-shapes.tldraw.json")
        let store = try #require(JSONValue.parse(data)["document"]?["store"]?.objectValue)
        var shapes: [String: [String: JSONValue]] = [:]
        for (id, v) in store { if let o = v.objectValue { shapes[id] = o } }
        return (try TldrawImporter.importSnapshot(data), shapes)
    }

    static func records<T>(_ doc: BoardDocument, _ pick: (BoardRecord) -> T?) -> [T] {
        doc.records.values.compactMap(pick)
    }

    @Test func countsEveryKind() throws {
        let (r, _) = try Self.allShapes()
        let rep = r.report
        #expect(rep.screens == 2)
        #expect(rep.texts == 3)
        #expect(rep.notes == 3)
        #expect(rep.frames == 1)
        #expect(rep.links == 2) // the embed and the bookmark
        #expect(rep.videos == 1)
        #expect(rep.droppedOverlays == 1) // the suggest overlay nobody accepted
        #expect(rep.images == 4) // inline, cropped, the accepted overlay, the feedback overlay
        #expect(rep.inlineImages == 1)
        #expect(rep.attachedEnds == 2)
        #expect(rep.shapes == 23 + 3 + 1) // geo (20 kinds, the frame's box child, the group's two), arrows, line
        #expect(rep.maths == 3)
        #expect(rep.graphs == 1)
        #expect(rep.lines == 1 && rep.marks == 1)
        #expect(rep.skipped.isEmpty)
        #expect(rep.kept == 1) // the dropped overlay's asset, kept whole
        #expect(rep.grownScreens == 1)
        #expect(r.currentScreen == r.document.screens[1].id)
    }

    @Test func geoKinds() throws {
        let (r, shapes) = try Self.allShapes()
        let geo = Self.records(r.document) { rec -> ShapeRecord? in
            if case .shape(let s) = rec, let id = shapes["shape:\(s.id.key)"], id["type"]?.stringValue == "geo", id["parentId"]?.stringValue?.hasPrefix("page:") == true { return s }
            return nil
        }
        #expect(geo.count == 20)
        for s in geo {
            let kind = shapes["shape:\(s.id.key)"]?["props"]?["geo"]?.stringValue ?? ""
            switch kind {
            case "rectangle": #expect(s.kind == .rect && s.meta["geo"] == nil)
            case "ellipse": #expect(s.kind == .ellipse && s.meta["geo"] == nil)
            case "oval", "cloud": #expect(s.kind == .ellipse && s.meta["geo"]?.stringValue == kind)
            case "x-box", "check-box": #expect(s.kind == .rect && s.meta["geo"]?.stringValue == kind)
            default:
                // a closed outline through its box
                #expect(s.kind == .line && s.meta["geo"]?.stringValue == kind, "\(kind)")
                #expect(s.points.first == s.points.last && s.points.count >= 4, "\(kind) is closed")
                let b = try #require(Box.around(s.points))
                if kind != "heart" {
                    // tldraw's own star falls a little short of its box; the rest span it exactly
                    let tol = kind == "star" ? 1.0 : 1e-6
                    let spans = abs(b.x) < tol && abs(b.y) < tol && abs(b.w - s.w) < tol && abs(b.h - s.h) < tol
                    #expect(spans, "\(kind) spans its box: \(b) vs \(s.w) x \(s.h)")
                }
            }
            #expect(s.w > 0 && s.h > 0)
            #expect(s.meta["tldraw"]?["type"]?.stringValue == "geo")
            #expect(s.meta["t"]?.numberValue != nil, "a shape keeps its replay time in meta")
        }
        let byKind = Dictionary(uniqueKeysWithValues: geo.map { (shapes["shape:\($0.id.key)"]?["props"]?["geo"]?.stringValue ?? "", $0) })
        #expect(byKind["rectangle"]?.meta["label"]?.stringValue == "start")
        #expect(byKind["cloud"]?.meta["label"]?.stringValue == "two\nlines")
        let grownH = byKind["rhombus-2"]?.h ?? 0
        #expect(abs(grownH - 104) < 1e-9, "growY: \(grownH)")
        #expect(byKind["diamond"]?.meta["locked"] == true)
        #expect(byKind["pentagon"]?.meta["opacity"]?.numberValue == 0.5)
        #expect(byKind["star"]?.rotation == 0.3)
        #expect(byKind["hexagon"]?.meta["dash"]?.stringValue == "solid")
        #expect(byKind["triangle"]?.fill == FillStyle.fromTldraw("solid"))
    }

    @Test func boundArrowEndsAreAttachedAndClipped() throws {
        let (r, shapes) = try Self.allShapes()
        let arrows = Self.records(r.document) { rec -> ShapeRecord? in if case .shape(let s) = rec, s.kind == .arrow { return s }; return nil }
        #expect(arrows.count == 3)
        let bound = try #require(arrows.first { $0.meta["attach"] != nil })
        func onPage(_ geo: String) -> [String: JSONValue]? {
            shapes.values.first { $0["props"]?["geo"]?.stringValue == geo && $0["parentId"]?.stringValue?.hasPrefix("page:") == true }
        }
        let rect = try #require(onPage("rectangle"))
        let ellipse = try #require(onPage("ellipse"))
        #expect(bound.meta["attach"]?["start"]?["to"]?.stringValue == "shape:\(RecordID(rect["id"]!.stringValue!).key)")
        #expect(bound.meta["attach"]?["end"]?["to"]?.stringValue == "shape:\(RecordID(ellipse["id"]!.stringValue!).key)")
        #expect(bound.meta["attach"]?["end"]?["precise"] == true)
        #expect(bound.meta["attach"]?["start"]?["binding"]?.stringValue?.hasPrefix("binding:") == true)
        // the start leaves the rectangle (40,40 100x80) through its right side; the end stops on the ellipse's outline
        let a = bound.points[0] + Vec2(bound.x, bound.y)
        let b = bound.points[1] + Vec2(bound.x, bound.y)
        #expect(abs(a.x - 140) < 0.01 && a.y > 80 && a.y < 100, "start \(a)")
        let e = (x: 190.0 + 50, y: 40.0 + 40)
        let onOutline = pow((b.x - e.x) / 50, 2) + pow((b.y - e.y) / 40, 2)
        #expect(abs(onOutline - 1) < 0.01, "end \(b) on the ellipse (\(onOutline))")

        let bent = try #require(arrows.first { $0.meta["label"]?.stringValue == "look here" })
        #expect(bent.points.count == TldrawImporter.arcSegments + 1)
        #expect(bent.points.first == Vec2(0, 0) && bent.points.last == Vec2(260, 40))
        // the arc's middle sits `bend` off the chord
        let mid = bent.points[TldrawImporter.arcSegments / 2]
        let chord = Vec2(260, 40)
        let off = abs(chord.x * mid.y - chord.y * mid.x) / chord.length
        #expect(abs(off - 40) < 1, "bend \(off)")
        #expect(bent.meta["tldraw"]?["props"]?["bend"]?.numberValue == 40)
        #expect(bent.meta["tldraw"]?["props"]?["arrowheadStart"]?.stringValue == "dot")
        #expect(bent.meta["dash"]?.stringValue == "dashed")
        let elbow = try #require(arrows.first { $0.meta["tldraw"]?["props"]?["kind"]?.stringValue == "elbow" })
        #expect(elbow.points == [Vec2(0, 0), Vec2(200, 120)])
    }

    @Test func textNotesFramesAndGroups() throws {
        let (r, shapes) = try Self.allShapes()
        let doc = r.document
        let texts = Self.records(doc) { rec -> MathRecord? in if case .math(let m) = rec, m.meta["tldraw"]?["type"]?.stringValue == "text" { return m }; return nil }
        #expect(texts.count == 3)
        #expect(texts.allSatisfy { $0.role == .note && $0.author == .kid })
        let special = try #require(texts.first { $0.meta["text"]?.stringValue?.hasPrefix("x_1") == true })
        #expect(special.meta["text"]?.stringValue == "x_1 & y^2 {ok}\n100% $5 #1 ~ \\")
        let expected = ##"\text{x\_1 \& y\^{}2 \{ok\}} \\ \text{100\% \$5 \#1 \~{} \textbackslash{}}"##
        #expect(special.latex == expected)
        #expect(special.fontSize == 24 && special.w == 260)
        let list = try #require(texts.first { $0.meta["text"]?.stringValue?.hasPrefix("Today") == true })
        #expect(list.meta["text"]?.stringValue == "Today\nfractions\nhalves\nquarters")
        #expect(list.fontSize == 36 * 1.5 && list.w == 300 * 1.5)
        #expect(list.meta["rotation"]?.numberValue == 0.12)

        let notes = Self.records(doc) { rec -> ShapeRecord? in if case .shape(let s) = rec, s.meta["note"] == true { return s }; return nil }
        #expect(notes.count == 3)
        let grown = try #require(notes.first { $0.meta["label"]?.stringValue?.hasPrefix("Steps") == true })
        #expect(grown.kind == .rect && abs(grown.w - 160) < 1e-9 && abs(grown.h - 208) < 1e-9 && grown.color == .lightGreen && grown.fill == .semi)

        let frame = try #require(Self.records(doc) { rec -> ShapeRecord? in if case .shape(let s) = rec, s.meta["frame"] == true { return s }; return nil }.first)
        #expect(frame.meta["label"]?.stringValue == "Warm-up" && frame.w == 320 && frame.h == 220)
        let frameID = try #require(shapes.values.first { $0["type"]?.stringValue == "frame" }?["id"]?.stringValue)
        let inFrame = doc.records.values.filter { $0.meta["parent"]?.stringValue == frameID }
        #expect(inFrame.count == 2)
        // its children are where the frame put them, and above it
        for c in inFrame { #expect(c.order! > frame.order) }
        let box = try #require(inFrame.compactMap { rec -> ShapeRecord? in if case .shape(let s) = rec { return s }; return nil }.first)
        #expect(box.x == 860 + 40 && box.y == 300 + 120)

        let grouped = doc.records.values.compactMap { rec -> ShapeRecord? in
            if case .shape(let s) = rec, s.meta["parent"] != nil, s.meta["parent"]?.stringValue != frameID { return s }
            return nil
        }
        #expect(grouped.count == 2 && grouped.allSatisfy { abs($0.rotation - 0.2) < 1e-9 })
    }

    @Test func picturesAndLinks() throws {
        let (r, _) = try Self.allShapes()
        let images = Self.records(r.document) { rec -> ImageRecord? in if case .image(let i) = rec { return i }; return nil }
        #expect(images.count == 7)
        let inline = try #require(images.first { $0.asset.src.hasPrefix("data:image/png;base64,") })
        #expect(inline.asset.mime == "image/png" && inline.asset.w == 4)
        #expect(inline.meta["tldraw"]?["asset"]?["meta"]?["source"]?.stringValue == "sticker")
        let photo = try #require(images.first { $0.asset.src.hasSuffix("worksheet.jpg") })
        #expect(photo.meta["locked"] == true)
        #expect(photo.meta["tldraw"]?["props"]?["flipX"] == true)
        #expect(photo.meta["tldraw"]?["props"]?["crop"]?["topLeft"]?["x"]?.numberValue == 0.1)
        let overlays = images.filter { $0.meta["aiOverlay"] == true }
        #expect(Set(overlays.compactMap { $0.meta["mode"]?.stringValue }) == ["answer", "feedback"])
        #expect(overlays.allSatisfy { $0.meta["locked"] == nil }) // unlocked, as the web does
        let video = try #require(images.first { $0.meta["video"] == true })
        #expect(video.asset.src.hasSuffix("lesson.mp4") && video.asset.mime == "video/mp4")
        #expect(video.meta["tldraw"]?["props"]?["time"]?.numberValue == 12.5)
        let embed = try #require(images.first { $0.meta["tldraw"]?["type"]?.stringValue == "embed" })
        #expect(embed.asset.src.isEmpty && embed.meta["link"]?.stringValue?.contains("youtube.com") == true)
        let bookmark = try #require(images.first { $0.meta["tldraw"]?["type"]?.stringValue == "bookmark" })
        #expect(bookmark.asset.src.hasSuffix("fractions.png"))
        #expect(bookmark.meta["link"]?.stringValue == "https://example.com/fractions" && bookmark.meta["title"]?.stringValue == "Fractions explained")
        #expect(bookmark.meta["tldraw"]?["asset"]?["props"]?["favicon"]?.stringValue == "https://example.com/favicon.ico")
    }

    @Test func tutorWorkAndItsMetaKeys() throws {
        let (r, _) = try Self.allShapes()
        let doc = r.document
        let tutorInk = doc.strokes.filter { $0.author == .tutor }
        #expect(!tutorInk.isEmpty && tutorInk.allSatisfy { $0.color == .tutor && $0.start != nil && $0.meta["createdAt"] != nil })
        let written = tutorInk.filter { $0.meta["proofTable"] != nil }
        #expect(!written.isEmpty)
        for s in written {
            #expect(s.meta["proofRows"]?.numberValue == 2 && s.meta["chatProblem"]?.stringValue == "cp_1" && s.meta["chatBlock"]?.stringValue == "cb_2")
            #expect(s.meta["handBlock"]?.stringValue?.hasPrefix("hb_") == true && s.meta["handLine"]?.stringValue == "x = 3")
            #expect(s.meta["live"] == true && s.meta["source"]?.stringValue == "ai" && s.meta["lineId"]?.stringValue == "ln_allshapes1")
        }
        let ai = try #require(Self.records(doc) { rec -> MathRecord? in if case .math(let m) = rec, m.role == .answer { return m }; return nil }.first)
        #expect(ai.meta["chatModel"]?.stringValue == "sonnet-5.5" && ai.meta["rotation"]?.numberValue == 0.1)
        let result = #"x=\frac{y}{2}"#
        #expect(ai.meta["tldraw"]?["props"]?["resultLatex"]?.stringValue == result && ai.meta["tldraw"]?["props"]?["note"]?.stringValue == "solve for x")
        #expect(ai.fontSize == 32)
        let graph = try #require(Self.records(doc) { rec -> GraphRecord? in if case .graph(let g) = rec { return g }; return nil }.first)
        #expect(graph.functions.map(\.color) == [.tutor, .red, .green])
        #expect(graph.meta["fnColors"]?["f_1"]?.stringValue == "#2563eb" && graph.meta["fnColors"]?["f_3"] == nil)
        #expect(graph.meta["graphFor"]?.stringValue == "2x" && graph.meta["figure"]?["points"]?["A"]?["x"]?.numberValue == 1)
        let line = try #require(Self.records(doc) { rec -> LineRecord? in if case .line(let l) = rec { return l }; return nil }.first)
        #expect(line.verdict == .ok && !line.strokes.isEmpty && line.strokes.allSatisfy { doc.records[$0]?.stroke?.author == .kid })
        let mark = try #require(Self.records(doc) { rec -> MarkRecord? in if case .mark(let m) = rec { return m }; return nil }.first)
        #expect(mark.kind == .tick && mark.target == line.id)
        // the kid's strokes are timed, every point after the pen came down
        let kid = doc.strokes.filter { $0.author == .kid && $0.meta["highlight"] == nil }
        #expect(kid.allSatisfy { $0.start != nil && ($0.points.last?.t ?? 0) > 0 })
    }

    @Test func pageFromBeforeScreensGrows() throws {
        let (r, _) = try Self.allShapes()
        let old = r.document.screens[1]
        #expect(old.name == "Old page")
        // the far text (1700, 1000, rotated) is inside the grown 16:9 screen
        #expect(old.rect.maxX > 1700 && old.rect.maxY > 1000)
        #expect(abs(old.rect.w / old.rect.h - 16.0 / 9.0) < 0.01)
    }

    @Test func unknownShapesAndRecordsAreKeptWhole() throws {
        let json = #"""
        {"store":{
          "page:p":{"id":"page:p","typeName":"page","name":"P","index":"a1","meta":{}},
          "shape:s1":{"id":"shape:s1","typeName":"shape","type":"sticker","x":10,"y":20,"rotation":0,"index":"a1","parentId":"page:p","isLocked":false,"opacity":1,"props":{"kind":"star","w":64},"meta":{"t":5}},
          "custom:c1":{"id":"custom:c1","typeName":"custom","value":[1,2,3]},
          "binding:b1":{"id":"binding:b1","typeName":"binding","type":"glue","fromId":"shape:s1","toId":"shape:s1","props":{},"meta":{}}
        },"schema":{}}
        """#
        let r = try TldrawImporter.importSnapshot(Data(json.utf8))
        #expect(r.report.kept == 3 && r.report.skipped.isEmpty)
        let sticker = try #require(r.document.records["tldraw:s1"])
        guard case .unknown(let u) = sticker else { Issue.record("not kept whole"); return }
        #expect(u.type == "tldraw.shape" && u.json["shape"]?["props"]?["kind"]?.stringValue == "star" && u.json["screen"]?.stringValue == "screen:p")
        #expect(r.document.records["tldraw:custom:c1"] != nil && r.document.records["tldraw:binding:b1"] != nil)
        // kept records survive a save and a load unchanged
        let back = try BoardDocument.decode(r.document.encoded())
        #expect(back == r.document)
    }

    @Test func richTextAndLatex() {
        #expect(TldrawRichText.plainText(nil) == "")
        #expect(TldrawRichText.plainText("old text") == "old text")
        let doc: JSONValue = ["type": "doc", "content": [["type": "paragraph", "content": [["type": "text", "text": "a"]]], ["type": "paragraph"], ["type": "paragraph", "content": [["type": "text", "text": "b"]]], ["type": "paragraph"]]]
        #expect(TldrawRichText.plainText(doc) == "a\n\nb")
        #expect(TldrawRichText.latexText("") == "")
        let twoLines = #"\text{a} \\ \text{b}"#
        #expect(TldrawRichText.latexText("a\nb") == twoLines)
    }

    @Test func documentRemembersWhereItCameFrom() throws {
        let (r, _) = try Self.allShapes()
        let from = try #require(r.document.meta["convertedFrom"])
        #expect(from["format"]?.stringValue == "tldraw")
        #expect(from["schema"]?["sequences"]?["com.tldraw.shape.math"] != nil)
    }
}

/// Inline pictures go to the asset store when a board is converted.
struct InlineImageUploadTests {
    final class Recording: BoardAssetStore, @unchecked Sendable {
        var uploads: [(bytes: Int, mime: String, board: String, w: Int, h: Int, source: String)] = []
        var fail = false
        func upload(_ data: Data, mimeType: String, boardId: String, width: Int, height: Int, source: String) async throws -> URL {
            if fail { throw URLError(.notConnectedToInternet) }
            uploads.append((data.count, mimeType, boardId, width, height, source))
            return URL(string: "https://assets.example/\(boardId)/\(uploads.count).png")!
        }

        func data(for url: URL) async throws -> Data { Data() }
    }

    @Test func uploadsAndRewrites() async throws {
        let store = Recording()
        let r = try await TldrawImporter.importSnapshot(Fixtures.data("all-shapes.tldraw.json"), boardId: "b1", assets: store)
        #expect(r.report.uploadedImages == 1 && r.report.failedUploads == 0)
        #expect(store.uploads.count == 1)
        let u = try #require(store.uploads.first)
        #expect(u.mime == "image/png" && u.board == "b1" && u.w == 4 && u.h == 4 && u.source == "sticker" && u.bytes > 0)
        let srcs = r.document.records.values.compactMap { rec -> String? in if case .image(let i) = rec { return i.asset.src }; return nil }
        #expect(!srcs.contains { $0.hasPrefix("data:") })
        #expect(srcs.contains("https://assets.example/b1/1.png"))
    }

    @Test func aFailedUploadKeepsThePicture() async throws {
        let store = Recording()
        store.fail = true
        let r = try await TldrawImporter.importSnapshot(Fixtures.data("all-shapes.tldraw.json"), boardId: "b1", assets: store)
        #expect(r.report.uploadedImages == 0 && r.report.failedUploads == 1)
        let srcs = r.document.records.values.compactMap { rec -> String? in if case .image(let i) = rec { return i.asset.src }; return nil }
        #expect(srcs.contains { $0.hasPrefix("data:image/png;base64,") })
    }

    @Test func inlineData() {
        #expect(InlineData("data:image/png;base64,AAEC")?.bytes == Data([0, 1, 2]))
        #expect(InlineData("data:image/png;base64,AAEC")?.mimeType == "image/png")
        #expect(InlineData("data:text/plain,hello") == nil)
        #expect(InlineData("https://x/y.png") == nil)
    }
}
