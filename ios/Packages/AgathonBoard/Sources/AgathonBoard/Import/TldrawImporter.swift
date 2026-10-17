import CoreGraphics
import Foundation

/// Reads a board the web app saved (a tldraw 4 snapshot) into an Agathon document. First cut
/// (Phase 0): pages → screens, `draw` and `highlight` → strokes, the tutor's marks → marks over
/// their strokes, echoes → lines + readbacks, `math`, `graph`, `geo`, `line`, `arrow`, `image`.
/// Everything else is counted in the report and left out (`text`, `note`, `frame` itself, `embed`,
/// `bookmark`, `video`, arrow bindings): Phase 1 finishes the converter.
///
/// Accepts both stored forms: `{"document":{"store":{…},"schema":{…}},"session":{…}}` and a bare
/// `{"store":{…},"schema":{…}}`. The original is never changed: the web keeps it in `whiteboards.data`.
public enum TldrawImporter {
    public struct Report: Sendable, Equatable {
        public var screens = 0
        public var strokes = 0
        public var tutorStrokes = 0
        public var shapes = 0
        public var images = 0
        public var maths = 0
        public var graphs = 0
        public var lines = 0
        public var marks = 0
        /// tldraw shape types left out, with how many
        public var skipped: [String: Int] = [:]
        public var grownScreens = 0
        public var warnings: [String] = []
    }

    public struct Result: Sendable {
        public var document: BoardDocument
        public var report: Report
        /// the screen tldraw had open (`session.currentPageId`)
        public var currentScreen: RecordID?
    }

    public enum ImportError: Error, Equatable {
        case notASnapshot
        case noPages
    }

    /// tldraw's STROKE_SIZES and FONT_SIZES
    static let strokeSizes: [String: Double] = ["s": 2, "m": 3.5, "l": 5, "xl": 10]
    static let fontSizes: [String: Double] = ["s": 18, "m": 24, "l": 36, "xl": 44]
    static let mathFontSizes: [String: Double] = ["s": 18, "m": 24, "l": 32]
    /// the web's LEGACY_PAD (screens.ts)
    static let legacyPad = 40.0

    public static func importSnapshot(_ data: Data) throws -> Result {
        let root: JSONValue
        do { root = try JSONValue.parse(data) } catch { throw ImportError.notASnapshot }
        return try importSnapshot(root)
    }

    public static func importSnapshot(_ root: JSONValue) throws -> Result {
        guard let store = (root["document"]?["store"] ?? root["store"])?.objectValue else { throw ImportError.notASnapshot }
        let session = root["session"]

        var pages: [(index: String, rec: [String: JSONValue])] = []
        var shapes: [String: [String: JSONValue]] = [:]
        var assets: [String: [String: JSONValue]] = [:]
        for (id, value) in store {
            guard let rec = value.objectValue, let typeName = rec["typeName"]?.stringValue else { continue }
            switch typeName {
            case "page": pages.append((rec["index"]?.stringValue ?? "a1", rec))
            case "shape": shapes[id] = rec
            case "asset": assets[id] = rec
            default: break
            }
        }
        guard !pages.isEmpty else { throw ImportError.noPages }
        pages.sort { a, b in
            a.index != b.index ? a.index.utf8.lexicographicallyPrecedes(b.index.utf8)
                : (a.rec["id"]?.stringValue ?? "") < (b.rec["id"]?.stringValue ?? "")
        }

        // children by parent, in index order
        var children: [String: [[String: JSONValue]]] = [:]
        for (_, s) in shapes {
            guard let parent = s["parentId"]?.stringValue else { continue }
            children[parent, default: []].append(s)
        }
        for k in children.keys {
            children[k]!.sort { a, b in
                let ia = a["index"]?.stringValue ?? ""
                let ib = b["index"]?.stringValue ?? ""
                return ia != ib ? ia.utf8.lexicographicallyPrecedes(ib.utf8) : (a["id"]?.stringValue ?? "") < (b["id"]?.stringValue ?? "")
            }
        }

        var report = Report()
        var records: [BoardRecord] = []
        let screenKeys = try OrderKey.sequence(pages.count)
        var currentScreen: RecordID?
        let currentPageID = session?["currentPageId"]?.stringValue
            ?? session?["pageStates"]?.arrayValue?.first?["pageId"]?.stringValue

        for (pi, page) in pages.enumerated() {
            let pageID = page.rec["id"]?.stringValue ?? "page:\(pi)"
            let screenID = RecordID.converted(.screen, from: pageID)
            if pageID == currentPageID { currentScreen = screenID }

            // flatten the page's shapes in drawing order, each with its page transform
            var flat: [(shape: [String: JSONValue], transform: CGAffineTransform, rotation: Double)] = []
            func walk(_ parent: String, _ t: CGAffineTransform, _ rot: Double) {
                for s in children[parent] ?? [] {
                    let x = s["x"]?.numberValue ?? 0
                    let y = s["y"]?.numberValue ?? 0
                    let r = s["rotation"]?.numberValue ?? 0
                    let local = CGAffineTransform(translationX: x, y: y).rotated(by: r).concatenating(t)
                    flat.append((s, local, rot + r))
                    if let id = s["id"]?.stringValue, children[id] != nil { walk(id, local, rot + r) }
                }
            }
            walk(pageID, .identity, 0)

            var converted: [BoardRecord] = []
            var markStrokes: [String: (kind: MarkKind, lineId: String?, why: String?, strokes: [RecordID])] = [:]
            var echoLines: [BoardRecord] = []

            for (s, t, rot) in flat {
                let type = s["type"]?.stringValue ?? "?"
                let props = s["props"]?.objectValue ?? [:]
                let meta = s["meta"]?.objectValue ?? [:]
                let sid = s["id"]?.stringValue ?? UUID().uuidString
                let opacity = s["opacity"]?.numberValue ?? 1
                let origin = Vec2(t.tx, t.ty)
                switch type {
                case "draw", "highlight":
                    guard let stroke = drawStroke(id: sid, type: type, props: props, meta: meta, screen: screenID, origin: origin, rotation: rot) else {
                        report.warnings.append("\(sid): a draw shape with no points")
                        continue
                    }
                    var st = stroke
                    if opacity < 1 { st.meta["opacity"] = .number(opacity) }
                    converted.append(.stroke(st))
                    report.strokes += 1
                    if st.author == .tutor { report.tutorStrokes += 1 }
                    if let key = meta["mark"]?.stringValue, let kind = markKind(key) {
                        var m = markStrokes[key] ?? (kind, meta["lineId"]?.stringValue, meta["markWhy"]?.stringValue, [])
                        m.strokes.append(st.id)
                        markStrokes[key] = m
                    }
                case "geo", "line", "arrow":
                    if let shape = shapeRecord(id: sid, type: type, props: props, meta: meta, screen: screenID, origin: origin, rotation: rot) {
                        converted.append(.shape(shape))
                        report.shapes += 1
                    }
                case "image":
                    let assetID = props["assetId"]?.stringValue
                    let asset = assetID.flatMap { assets[$0] }?["props"]?.objectValue
                    let src = asset?["src"]?.stringValue ?? ""
                    let rec = ImageRecord(
                        id: .converted(.image, from: sid), screen: screenID, order: "a0", author: authorOf(meta),
                        x: origin.x, y: origin.y, w: props["w"]?.numberValue ?? 100, h: props["h"]?.numberValue ?? 100, rotation: rot,
                        asset: AssetRef(src: src, mime: asset?["mimeType"]?.stringValue, w: asset?["w"]?.numberValue, h: asset?["h"]?.numberValue),
                        meta: keptMeta(meta))
                    if src.hasPrefix("data:") { report.warnings.append("\(sid): an inline data URL image (offload it first)") }
                    converted.append(.image(rec))
                    report.images += 1
                case "math":
                    let source = props["source"]?.stringValue ?? "ai"
                    let role: MathRole = source == "echo" ? .readback : source == "student" ? .note : .answer
                    let lineId = props["lineId"]?.stringValue ?? meta["lineId"]?.stringValue
                    let lineRecordID = lineId.flatMap { $0.isEmpty ? nil : RecordID("line:\($0)") }
                    let rec = MathRecord(
                        id: .converted(.math, from: sid), screen: screenID, order: "a0", author: source == "student" ? .kid : .tutor,
                        role: role, latex: props["latex"]?.stringValue ?? "", x: origin.x, y: origin.y,
                        w: props["w"]?.numberValue ?? 0, h: props["h"]?.numberValue ?? 0,
                        fontSize: mathFontSizes[props["size"]?.stringValue ?? "m"] ?? 24, line: lineRecordID, meta: keptMeta(meta))
                    converted.append(.math(rec))
                    report.maths += 1
                    // an echo is what the recognizer read from a line of the kid's ink: that is a Line
                    if source == "echo", let lineRecordID {
                        let anchors = props["anchorIds"]?.arrayValue?.compactMap(\.stringValue) ?? []
                        let verdict = Verdict(rawValue: props["status"]?.stringValue ?? "none") ?? .none
                        echoLines.append(.line(LineRecord(
                            id: lineRecordID, screen: screenID, strokes: anchors.map { RecordID.converted(.stroke, from: $0) },
                            latex: props["latex"]?.stringValue ?? "", verdict: verdict)))
                    }
                case "graph":
                    let fns: [GraphFunction] = props["fns"]?.arrayValue?.compactMap { f in
                        guard let o = f.objectValue else { return nil }
                        return GraphFunction(
                            id: o["id"]?.stringValue ?? "", expr: o["expr"]?.stringValue ?? "", latex: o["latex"]?.stringValue ?? "",
                            color: InkColor.fromTldraw(o["color"]?.stringValue ?? "blue", author: .tutor))
                    } ?? []
                    let pts: [GraphPoint] = props["points"]?.arrayValue?.compactMap { p in
                        guard let x = p["x"]?.numberValue, let y = p["y"]?.numberValue else { return nil }
                        return GraphPoint(x: x, y: y, label: p["label"]?.stringValue ?? "")
                    } ?? []
                    let lineId = props["lineId"]?.stringValue
                    let rec = GraphRecord(
                        id: .converted(.graph, from: sid), screen: screenID, order: "a0", author: authorOf(meta),
                        x: origin.x, y: origin.y, w: props["w"]?.numberValue ?? 400, h: props["h"]?.numberValue ?? 300,
                        functions: fns, points: pts,
                        window: GraphWindow(
                            xMin: props["xMin"]?.numberValue ?? -10, xMax: props["xMax"]?.numberValue ?? 10,
                            yMin: props["yMin"]?.numberValue ?? -10, yMax: props["yMax"]?.numberValue ?? 10,
                            autoY: props["autoY"]?.boolValue ?? false),
                        grid: props["grid"]?.boolValue ?? true, title: props["title"]?.stringValue ?? "",
                        line: lineId.flatMap { $0.isEmpty ? nil : RecordID("line:\($0)") }, meta: keptMeta(meta))
                    converted.append(.graph(rec))
                    report.graphs += 1
                case "group":
                    break // its children are walked in its place
                case "frame":
                    report.skipped["frame", default: 0] += 1 // the frame's own box; its children are kept
                default:
                    report.skipped[type, default: 0] += 1
                }
            }

            // drawing order → fresh fractional keys
            let keys = try OrderKey.sequence(converted.count)
            for i in converted.indices { converted[i] = withOrder(converted[i], keys[i]) }

            // the screen: as stored, or grown around the ink of a page that predates screens
            var rect: Box
            if let s = page.rec["meta"]?["screen"], let x = s["x"]?.numberValue, let y = s["y"]?.numberValue,
               let w = s["w"]?.numberValue, let h = s["h"]?.numberValue, w > 0, h > 0
            {
                rect = Box(x: x, y: y, w: w, h: h)
            } else {
                rect = screenForContent(contentBounds(converted))
                report.grownScreens += 1
            }
            var screenMeta = keptMeta(page.rec["meta"]?.objectValue ?? [:])
            screenMeta["screen"] = nil
            records.append(.screen(ScreenRecord(
                id: screenID, order: screenKeys[pi], rect: rect, name: page.rec["name"]?.stringValue, meta: screenMeta)))
            records += converted
            report.screens += 1

            // lines read from echoes, then marks over their strokes
            var seenLines = Set<RecordID>()
            for l in echoLines where seenLines.insert(l.id).inserted {
                records.append(l)
                report.lines += 1
            }
            for (key, m) in markStrokes.sorted(by: { $0.key < $1.key }) {
                records.append(.mark(MarkRecord(
                    id: RecordID("mark:\(screenID.key)-\(stableHash(key))"), screen: screenID, kind: m.kind,
                    target: m.lineId.flatMap { $0.isEmpty ? nil : RecordID("line:\($0)") }, strokes: m.strokes, why: m.why)))
                report.marks += 1
            }
        }
        return Result(document: BoardDocument(records), report: report, currentScreen: currentScreen)
    }

    // MARK: - shapes

    static func authorOf(_ meta: [String: JSONValue]) -> Author {
        meta["live"]?.boolValue == true ? .tutor : .kid
    }

    /// meta kept on a converted record: everything except the replay stamps, which become fields
    static func keptMeta(_ meta: [String: JSONValue]) -> Meta {
        var m = meta
        m["t"] = nil
        m["t1"] = nil
        return m
    }

    static func markKind(_ key: String) -> MarkKind? {
        if key.hasPrefix("check:") { return .tick }
        if key.hasPrefix("circle:") { return .ring }
        if key.hasPrefix("question:") { return .question }
        return nil
    }

    static func drawStroke(
        id: String, type: String, props: [String: JSONValue], meta: [String: JSONValue],
        screen: RecordID, origin: Vec2, rotation: Double
    ) -> StrokeRecord? {
        let isPen = props["isPen"]?.boolValue ?? false
        var pts: [InkPoint] = []
        for seg in props["segments"]?.arrayValue ?? [] {
            let raw = seg["points"]?.arrayValue ?? []
            let segPts: [InkPoint] = raw.compactMap { p in
                guard let x = p["x"]?.numberValue, let y = p["y"]?.numberValue else { return nil }
                let z = p["z"]?.numberValue ?? 0.5
                return InkPoint(x: Float(x), y: Float(y), pressure: Float(min(1, max(0, z))))
            }
            if seg["type"]?.stringValue == "straight", segPts.count >= 2 {
                // tldraw interpolates a straight segment at draw time: max(4, ⌊length / 16⌋) points
                let a = segPts[0]
                let b = segPts[segPts.count - 1]
                let len = Double(hypot(b.x - a.x, b.y - a.y))
                let n = max(4, Int(len / 16))
                for i in 0..<n {
                    let t = Float(i) / Float(n - 1)
                    pts.append(InkPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, pressure: a.pressure + (b.pressure - a.pressure) * t))
                }
            } else {
                pts += segPts
            }
        }
        guard !pts.isEmpty else { return nil }
        let author = authorOf(meta)
        let scale = props["scale"]?.numberValue ?? 1
        let size = props["size"]?.stringValue ?? "m"
        var width = ((strokeSizes[size] ?? 3.5) + 1) * scale
        var keep = keptMeta(meta)
        if type == "highlight" {
            width = (fontSizes[size] ?? 24) * 1.12 * scale
            keep["highlight"] = true
        }
        if let dash = props["dash"]?.stringValue, dash != "draw" { keep["dash"] = .string(dash) }

        // replay times: pen down `t`, pen up `t1` (the kid's ink since 2026-10-08); the tutor's `createdAt`
        var start: Double? = meta["t"]?.numberValue
        if start == nil, author == .tutor { start = meta["createdAt"]?.numberValue }
        if let t0 = meta["t"]?.numberValue, let t1 = meta["t1"]?.numberValue, t1 > t0, pts.count > 1 {
            // only the ends are known: spread the time along the stroke by its length
            var lens: [Float] = [0]
            for i in 1..<pts.count { lens.append(lens[i - 1] + hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)) }
            let total = max(lens.last ?? 0, 0.0001)
            let dur = Float(t1 - t0)
            for i in pts.indices { pts[i].t = (lens[i] / total * dur).rounded() }
        }
        let fill = FillStyle.fromTldraw(props["fill"]?.stringValue ?? "none")
        return StrokeRecord(
            id: .converted(.stroke, from: id), screen: screen, order: "a0", author: author,
            color: InkColor.fromTldraw(props["color"]?.stringValue ?? "black", author: author),
            width: width, pressure: isPen ? .real : .simulated, x: origin.x, y: origin.y, rotation: rotation,
            points: PointCodec.normalize(pts), start: start, closed: props["isClosed"]?.boolValue ?? false, fill: fill, meta: keep)
    }

    static func shapeRecord(
        id: String, type: String, props: [String: JSONValue], meta: [String: JSONValue],
        screen: RecordID, origin: Vec2, rotation: Double
    ) -> ShapeRecord? {
        let scale = props["scale"]?.numberValue ?? 1
        let width = (strokeSizes[props["size"]?.stringValue ?? "m"] ?? 3.5) * scale
        let author = authorOf(meta)
        let color = InkColor.fromTldraw(props["color"]?.stringValue ?? "black", author: author)
        let fill = FillStyle.fromTldraw(props["fill"]?.stringValue ?? "none")
        var keep = keptMeta(meta)
        switch type {
        case "geo":
            let geo = props["geo"]?.stringValue ?? "rectangle"
            if geo != "rectangle" && geo != "ellipse" { keep["geo"] = .string(geo) }
            return ShapeRecord(
                id: .converted(.shape, from: id), screen: screen, order: "a0", author: author,
                kind: geo == "ellipse" || geo == "oval" ? .ellipse : .rect, x: origin.x, y: origin.y, rotation: rotation,
                w: props["w"]?.numberValue ?? 100, h: (props["h"]?.numberValue ?? 100) + (props["growY"]?.numberValue ?? 0),
                color: color, width: width, fill: fill, meta: keep)
        case "line":
            let handles = props["points"]?.objectValue?.values.compactMap { $0.objectValue } ?? []
            let sorted = handles.sorted { ($0["index"]?.stringValue ?? "").utf8.lexicographicallyPrecedes(($1["index"]?.stringValue ?? "").utf8) }
            let pts = sorted.compactMap { h -> Vec2? in
                guard let x = h["x"]?.numberValue, let y = h["y"]?.numberValue else { return nil }
                return Vec2(x, y)
            }
            guard pts.count >= 2 else { return nil }
            return ShapeRecord(
                id: .converted(.shape, from: id), screen: screen, order: "a0", author: author, kind: .line,
                x: origin.x, y: origin.y, rotation: rotation, points: pts, color: color, width: width, meta: keep)
        case "arrow":
            func vec(_ v: JSONValue?) -> Vec2? {
                guard let x = v?["x"]?.numberValue, let y = v?["y"]?.numberValue else { return nil }
                return Vec2(x, y)
            }
            guard let a = vec(props["start"]), let b = vec(props["end"]) else { return nil }
            return ShapeRecord(
                id: .converted(.shape, from: id), screen: screen, order: "a0", author: author, kind: .arrow,
                x: origin.x, y: origin.y, rotation: rotation, points: [a, b], color: color, width: width, meta: keep)
        default:
            return nil
        }
    }

    static func withOrder(_ r: BoardRecord, _ k: OrderKey) -> BoardRecord {
        switch r {
        case .stroke(var s): s.order = k; return .stroke(s)
        case .shape(var s): s.order = k; return .shape(s)
        case .image(var s): s.order = k; return .image(s)
        case .math(var s): s.order = k; return .math(s)
        case .graph(var s): s.order = k; return .graph(s)
        default: return r
        }
    }

    // MARK: - screens

    /// The page-space bounds of converted records as tldraw measures a page's content
    /// (`getShapePageBounds`): a stroke by its smoothed centre line, ink width left out, a speck as a
    /// circle of its pen width; a box by its corners. (nil when there are none)
    static func contentBounds(_ records: [BoardRecord]) -> Box? {
        var box: Box?
        func add(_ b: Box?) {
            guard let b, b.w.isFinite, b.h.isFinite else { return }
            box = box.map { $0.union(b) } ?? b
        }
        func corners(_ x: Double, _ y: Double, _ w: Double, _ h: Double, _ r: Double) -> Box? {
            let o = Vec2(x, y)
            return Box.around([Vec2(0, 0), Vec2(w, 0), Vec2(w, h), Vec2(0, h)].map { $0.rotated(by: r) + o })
        }
        for r in records {
            switch r {
            case .stroke(let s):
                let input = s.points.map { FreehandInput(Vec2(Double($0.x), Double($0.y)), Double($0.pressure)) }
                guard let local = Box.around(input.map(\.p)) else { continue }
                if local.w < s.width * 2 && local.h < s.width * 2 {
                    add(corners(s.x - s.width, s.y - s.width, s.width * 2, s.width * 2, 0))
                    continue
                }
                var o = InkStyle.options(width: s.width, pressure: s.pressure, complete: true)
                o.size = s.width
                if s.pressure == .real { o.streamline = 0.62 }
                let pts = Freehand.strokePoints(input, o).map { s.pagePoint(InkPoint(x: Float($0.point.x), y: Float($0.point.y))) }
                add(Box.around(pts))
            case .shape(let s):
                if s.kind == .line || s.kind == .arrow {
                    add(Box.around(s.points.map { $0.rotated(by: s.rotation) + Vec2(s.x, s.y) }))
                } else {
                    add(corners(s.x, s.y, s.w, s.h, s.rotation))
                }
            case .image(let i): add(corners(i.x, i.y, i.w, i.h, i.rotation))
            case .math(let m): add(Box(x: m.x, y: m.y, w: m.w, h: m.h))
            case .graph(let g): add(Box(x: g.x, y: g.y, w: g.w, h: g.h))
            default: break
            }
        }
        return box
    }

    /// The web's `screenForContent`: the default screen grown (keeping 16:9) to hold the content.
    public static func screenForContent(_ content: Box?) -> Box {
        guard let c = content, c.w > 0 || c.h > 0 else { return .screen }
        let d = Box.screen
        let x0 = min(d.x, c.x - legacyPad)
        let y0 = min(d.y, c.y - legacyPad)
        let x1 = max(d.maxX, c.maxX + legacyPad)
        let y1 = max(d.maxY, c.maxY + legacyPad)
        var w = x1 - x0
        var h = y1 - y0
        let aspect = d.w / d.h
        if w / h > aspect { h = w / aspect } else { w = h * aspect }
        return Box(x: x0.rounded(.down), y: y0.rounded(.down), w: w.rounded(.up), h: h.rounded(.up))
    }

    static func stableHash(_ s: String) -> String {
        var h: UInt32 = 2_166_136_261
        for b in s.utf8 {
            h ^= UInt32(b)
            h = h &* 16_777_619
        }
        return String(h, radix: 36)
    }
}
