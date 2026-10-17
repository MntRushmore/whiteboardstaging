import Foundation
import Testing
@testable import AgathonBoard

/// One of every record type.
func everyRecordDocument() -> BoardDocument {
    let screen = ScreenRecord(id: "screen:a", order: "a0", rect: .screen, name: "Screen 1", meta: ["note": "hi"])
    var kid = makeStroke("stroke:k", order: "a1", xy: [(10, 10), (12, 14), (20, 30), (25, 31)])
    kid.points[2].altitude = 1.1
    kid.points[2].azimuth = 0.7
    let tutor = StrokeRecord(
        id: "stroke:t", screen: "screen:a", order: "a2", author: .tutor, color: .tutor, width: 3, pressure: .real,
        x: 300, y: 200, rotation: 0.25, points: [InkPoint(x: 0, y: 0, pressure: 0.45), InkPoint(x: 30, y: 4, pressure: 0.5, t: 120)],
        start: 1_760_000_000_500, closed: true, fill: .semi, meta: ["live": true, "handBlock": "hb_1", "handLine": "x = 4"])
    return BoardDocument([
        .screen(screen),
        .stroke(kid),
        .stroke(tutor),
        .shape(ShapeRecord(id: "shape:r", screen: "screen:a", order: "a3", kind: .rect, x: 50, y: 60, w: 100, h: 40, color: .red, width: 3.5, fill: .semi)),
        .shape(ShapeRecord(id: "shape:a", screen: "screen:a", order: "a4", kind: .arrow, x: 10, y: 400, points: [Vec2(0, 0), Vec2(120, -30)], color: .green, width: 3.5)),
        .image(ImageRecord(id: "image:p", screen: "screen:a", order: "a5", x: 900, y: 100, w: 320, h: 240,
                           asset: AssetRef(src: "https://example.supabase.co/storage/v1/object/public/board-assets/u/b/p.png", mime: "image/png", w: 640, h: 480))),
        .math(MathRecord(id: "math:e", screen: "screen:a", order: "a6", role: .readback, latex: "2x+3=11", x: 400, y: 20, w: 120, h: 40, fontSize: 18, line: "line:1")),
        .graph(GraphRecord(id: "graph:g", screen: "screen:a", order: "a7", x: 1100, y: 500, w: 320, h: 240,
                           functions: [GraphFunction(id: "f1", expr: "x^2-4", latex: "x^{2}-4")], points: [GraphPoint(x: 2, y: 0, label: "(2, 0)")],
                           window: GraphWindow(xMin: -5, xMax: 5, yMin: -5, yMax: 5), line: "line:1")),
        .mark(MarkRecord(id: "mark:1", screen: "screen:a", kind: .tick, target: "line:1", strokes: ["stroke:t"], why: nil)),
        .line(LineRecord(id: "line:1", screen: "screen:a", strokes: ["stroke:k"], latex: "2x+3=11", verdict: .ok, problem: "problem:1")),
        .problem(ProblemRecord(id: "problem:1", screen: "screen:a", lines: ["line:1"], latex: "2x+3=11", origin: "student")),
    ], meta: ["app": "ios 1.0"])
}

@MainActor
struct SerializationTests {
    @Test func roundTripEveryRecordType() throws {
        // through the store, so strokes are normalized exactly as the app keeps them
        let store = BoardStore(document: BoardDocument())
        store.transact(.kid) { tx in everyRecordDocument().records.values.forEach { tx.put($0) } }
        store.documentMeta = ["app": "ios 1.0"]
        let doc = store.document
        let data = try doc.encoded()
        let back = try BoardDocument.decode(data)
        #expect(back == doc)
        #expect(back.records.count == 11)
        // deterministic: same document, same bytes
        #expect(try back.encoded() == data)
    }

    @Test func jsonShape() throws {
        let data = try everyRecordDocument().encoded()
        let json = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(json["format"] as? String == "agathon.board")
        #expect(json["schema"] as? Int == 1)
        let records = try #require(json["records"] as? [String: [String: Any]])
        let stroke = try #require(records["stroke:k"])
        #expect(stroke["type"] as? String == "stroke")
        #expect(stroke["points"] is String) // compact, base64
        #expect(stroke["rotation"] == nil) // defaults left out
        #expect(stroke["meta"] == nil)
        #expect(records["stroke:t"]?["closed"] as? Bool == true)
    }

    @Test func unknownRecordTypesSurvive() throws {
        let json = """
        {"format":"agathon.board","schema":1,"records":{
          "sticker:1":{"id":"sticker:1","type":"sticker","screen":"screen:a","emoji":"⭐️","x":5},
          "screen:a":{"id":"screen:a","type":"screen","order":"a0","rect":{"x":0,"y":0,"w":1600,"h":900}}}}
        """
        let doc = try BoardDocument.decode(Data(json.utf8))
        guard case .unknown(let u) = doc.records["sticker:1"] else {
            Issue.record("not kept")
            return
        }
        #expect(u.type == "sticker")
        let again = try BoardDocument.decode(try doc.encoded())
        #expect(again == doc)
    }

    @Test func newerSchemaIsRefused() {
        let json = #"{"format":"agathon.board","schema":2,"records":{}}"#
        #expect(throws: BoardDocument.BoardFormatError.newerSchema(2)) { try BoardDocument.decode(Data(json.utf8)) }
        #expect(throws: BoardDocument.BoardFormatError.notABoard) { try BoardDocument.decode(Data(#"{"store":{}}"#.utf8)) }
    }

    @Test func migrationHookRunsStepsInOrder() throws {
        // a made-up schema 0 where screens were called "pages" and kept "w"/"h" flat
        let v0 = """
        {"format":"agathon.board","schema":0,"records":{
          "screen:a":{"id":"screen:a","type":"page","order":"a0","w":1600,"h":900}}}
        """
        let migrations = BoardMigrations(current: 1, steps: [
            0: { json in
                guard case .object(var records) = json["records"] ?? .null else { return }
                for (id, r) in records {
                    guard case .object(var o) = r, o["type"] == "page" else { continue }
                    o["type"] = "screen"
                    o["rect"] = ["x": 0, "y": 0, "w": o["w"] ?? 1600, "h": o["h"] ?? 900]
                    o["w"] = nil
                    o["h"] = nil
                    records[id] = .object(o)
                }
                json["records"] = .object(records)
            },
        ])
        let doc = try BoardDocument.decode(Data(v0.utf8), migrations: migrations)
        #expect(doc.screens.first?.rect == .screen)
        // no step for a schema: refused, not guessed
        #expect(throws: BoardDocument.BoardFormatError.noMigration(from: 0)) {
            try BoardDocument.decode(Data(v0.utf8), migrations: BoardMigrations(current: 1, steps: [:]))
        }
    }
}

struct PointCodecTests {
    @Test func roundTripIsExactAfterNormalizing() throws {
        var pts: [InkPoint] = []
        for i in 0..<500 {
            let t = Double(i)
            pts.append(InkPoint(x: Float(sin(t / 9) * 120 + t * 0.7), y: Float(cos(t / 7) * 40), pressure: Float(0.3 + 0.5 * abs(sin(t / 30))),
                                altitude: Float(0.8 + 0.2 * sin(t)), azimuth: Float(t / 100), t: Float(t * 4.166)))
        }
        let norm = PointCodec.normalize(pts)
        #expect(try PointCodec.decode(PointCodec.encode(norm)) == norm)
        // within the quantum of the original
        for (a, b) in zip(pts, norm) {
            #expect(abs(a.x - b.x) <= 1 / 32 + 1e-4)
            #expect(abs(a.pressure - b.pressure) <= 0.5 / 255 + 1e-4)
            #expect(abs(a.t - b.t) <= 0.5 + 1e-3)
        }
    }

    /// The worked example in docs/BOARD-FORMAT.md: pins the byte layout other readers decode.
    @Test func knownEncoding() throws {
        let pts = [
            InkPoint(x: 0, y: 0, pressure: 0.5, t: 0),
            InkPoint(x: 1.5, y: -2, pressure: 1, t: 4.2),
            InkPoint(x: 3.0625, y: -2, pressure: 0.25, t: 9),
        ]
        #expect(PointCodec.encode(pts) == "AQUDAACAADA//wQyAEAF")
        let back = try PointCodec.decode("AQUDAACAADA//wQyAEAF")
        #expect(back.map(\.x) == [0, 1.5, 3.0625])
        #expect(back.map(\.y) == [0, -2, -2])
        #expect(back.map(\.t) == [0, 4, 9])
    }

    @Test func channelsAreLeftOutWhenUnused() throws {
        // a finger stroke: no pressure, no tilt, no time → 2 bytes header + count + xy only
        let pts = (0..<100).map { InkPoint(x: Float($0), y: Float($0) * 0.5) }
        let bytes = PointCodec.encodeBytes(pts)
        #expect(bytes[1] == 0)
        #expect(bytes.count <= 2 + 1 + 100 * 2 + 2)
        let back = try PointCodec.decode(PointCodec.encode(pts))
        #expect(back.allSatisfy { $0.pressure == 0.5 && !$0.hasTilt && $0.t == 0 })
    }

    @Test func badInputThrows() {
        #expect(throws: PointCodec.DecodeError.badBase64) { try PointCodec.decode("%%%") }
        #expect(throws: PointCodec.DecodeError.badVersion(9)) { try PointCodec.decodeBytes(Data([9, 0, 0])) }
        #expect(throws: PointCodec.DecodeError.truncated) { try PointCodec.decodeBytes(Data([1, 1, 5, 2])) }
        #expect(throws: PointCodec.DecodeError.tooMany(2_000_000)) {
            var d = [UInt8]([1, 0])
            PointCodec.putVarint(2_000_000, &d)
            _ = try PointCodec.decodeBytes(Data(d))
        }
    }

    @Test func negativeAndLargeCoordinates() throws {
        let pts = [InkPoint(x: -3000.5, y: 12000.25), InkPoint(x: 4000, y: -9000), InkPoint(x: 0, y: 0)]
        #expect(try PointCodec.decode(PointCodec.encode(pts)) == PointCodec.normalize(pts))
        #expect(PointCodec.normalize(pts)[0].x == -3000.5)
    }

    /// A dense screen's bytes, against the same ink as tldraw stores it.
    @Test func denseScreenSize() throws {
        func report(_ label: String, _ doc: BoardDocument) throws -> (bytes: Int, tldraw: Int, points: Int) {
            let bytes = try doc.encoded(sortedKeys: false).count
            let strokes = doc.strokes
            let points = strokes.reduce(0) { $0 + $1.points.count }
            let tl = try tldrawBytes(strokes)
            print(String(format: "SIZE %@: %d strokes, %d points: %.1f KB (%.1f B/point, %.0f B/stroke); tldraw JSON %.1f KB (%.1f B/point) → %.1f× smaller",
                         label, strokes.count, points, Double(bytes) / 1000, Double(bytes) / Double(points), Double(bytes) / Double(strokes.count),
                         Double(tl) / 1000, Double(tl) / Double(points), Double(tl) / Double(bytes)))
            return (bytes, tl, points)
        }
        let full = try report("a full screen of Pencil writing", SyntheticBoards.handwriting(strokes: 600))
        let dense = try report("5,000 strokes on one screen", SyntheticBoards.handwriting(strokes: 5000))
        let tilt = try report("5,000 strokes with the Pencil's tilt kept", SyntheticBoards.handwriting(strokes: 5000, tilt: true))
        let finger = try report("5,000 finger strokes", SyntheticBoards.handwriting(strokes: 5000, pencil: false))
        #expect(full.bytes < 350_000)
        #expect(dense.bytes < 3_000_000) // the autosave's hard limit is 4 MB
        #expect(tilt.bytes > dense.bytes)
        #expect(Double(dense.tldraw) / Double(dense.bytes) > 5)
        #expect(finger.bytes < dense.bytes)
    }

    /// The same strokes as tldraw 4.2 `draw` shapes (points to 0.01, z to 0.01, as its pen stores them).
    func tldrawBytes(_ strokes: [StrokeRecord]) throws -> Int {
        var store: [String: Any] = [:]
        for s in strokes {
            let pts = s.points.map { ["x": (Double($0.x) * 100).rounded() / 100, "y": (Double($0.y) * 100).rounded() / 100, "z": (Double($0.pressure) * 125).rounded() / 100] }
            store["shape:\(s.id.key)"] = [
                "id": "shape:\(s.id.key)", "typeName": "shape", "type": "draw", "x": s.x, "y": s.y, "rotation": 0, "index": s.order.rawValue,
                "parentId": "page:page", "isLocked": false, "opacity": 1, "meta": ["t": s.start ?? 0, "t1": s.end ?? 0],
                "props": ["color": "black", "fill": "none", "dash": "draw", "size": "l", "segments": [["type": "free", "points": pts]],
                          "isComplete": true, "isClosed": false, "isPen": true, "scale": 1],
            ] as [String: Any]
        }
        return try JSONSerialization.data(withJSONObject: ["document": ["store": store]]).count
    }
}
