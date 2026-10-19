import CoreGraphics
import Foundation

/// Reads a board the web app saved (a tldraw 4 snapshot) into an Agathon document: every shape
/// kind the web ever saved, and nothing dropped. docs/BOARD-FORMAT.md, "Converting a tldraw board",
/// has the table; in short:
///
/// - pages → screens (`meta.screen`, or a screen grown around the ink of a page that predates them)
/// - `draw` / `highlight` → strokes (timed from `meta.t` / `t1`, the tutor's from `createdAt`)
/// - the tutor's marks → marks over their strokes; echoes → lines + readbacks
/// - `geo` (every kind), `line`, `arrow` (bindings → attached ends), `note`, a `frame`'s own box → shapes
/// - `text` → a typed note (`math`, role `note`); `math`, `graph` → themselves
/// - `image`, `video`, `embed`, `bookmark` → images (the last three as placeholders that keep their link)
/// - groups and frames are flattened (their children keep where they were drawn)
/// - anything else is kept whole as an `UnknownRecord` (`tldraw.shape`, `tldraw.record`)
///
/// What the board does not model yet (a label's rich text, an arrow's bend, a crop…) is kept on the
/// record in `meta.tldraw` (`{type, props, asset?}`), so the trip back to tldraw (the web's
/// read-only view, src/lib/boards/agathonDoc.ts) loses nothing.
///
/// Inline `data:` images stay as they are here; `importSnapshot(_:boardId:assets:)` uploads them.
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
        /// `text` shapes, now typed notes (`math`, role `note`)
        public var texts = 0
        /// sticky notes, now shapes with their text in `meta.label`
        public var notes = 0
        /// frames: their own box, now a shape (children are flattened either way)
        public var frames = 0
        /// `embed` and `bookmark` shapes, now image placeholders with `meta.link`
        public var links = 0
        /// `video` shapes, now image placeholders
        public var videos = 0
        /// arrow ends attached to a shape (`meta.attach`)
        public var attachedEnds = 0
        /// records kept whole because the board does not know them (`UnknownRecord`)
        public var kept = 0
        /// the retired image pipeline's proposals nobody accepted (the web drops them on load too)
        public var droppedOverlays = 0
        /// images whose picture is inline (`data:`): `importSnapshot(_:boardId:assets:)` uploads them
        public var inlineImages = 0
        /// inline pictures uploaded to the asset store, and the ones that could not be (kept inline)
        public var uploadedImages = 0
        public var failedUploads = 0
        /// tldraw shape types left out, with how many (only what cannot be read at all)
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
    /// tldraw's NOTE_SIZE (a note is this square, grown downwards by `growY`)
    static let noteSize = 200.0
    /// tldraw's text line height
    static let textLineHeight = 1.35
    /// the web's LEGACY_PAD (screens.ts)
    static let legacyPad = 40.0
    /// points an arrow's bend is drawn with (its arc, sampled)
    static let arcSegments = 16

    public static func importSnapshot(_ data: Data) throws -> Result {
        let root: JSONValue
        do { root = try JSONValue.parse(data) } catch { throw ImportError.notASnapshot }
        return try importSnapshot(root)
    }

    /// One shape of a page, flattened: where it is on the page and what holds it.
    struct Placed {
        var shape: [String: JSONValue]
        var id: String
        var type: String
        /// shape space → page space
        var transform: CGAffineTransform
        /// page rotation (radians)
        var rotation: Double
        /// the group or frame it was in
        var parent: String?
    }

    public static func importSnapshot(_ root: JSONValue) throws -> Result {
        guard let store = (root["document"]?["store"] ?? root["store"])?.objectValue else { throw ImportError.notASnapshot }
        let session = root["session"]

        var pages: [(index: String, rec: [String: JSONValue])] = []
        var shapes: [String: [String: JSONValue]] = [:]
        var assets: [String: [String: JSONValue]] = [:]
        var bindings: [[String: JSONValue]] = []
        var others: [[String: JSONValue]] = []
        var documentRecord: [String: JSONValue]?
        for (id, value) in store {
            guard let rec = value.objectValue, let typeName = rec["typeName"]?.stringValue else { continue }
            switch typeName {
            case "page": pages.append((rec["index"]?.stringValue ?? "a1", rec))
            case "shape": shapes[id] = rec
            case "asset": assets[id] = rec
            case "binding": bindings.append(rec)
            case "document": documentRecord = rec
            default: others.append(rec)
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

        // arrow bindings by arrow (the rest are kept whole)
        var arrowBindings: [String: [String: [String: JSONValue]]] = [:]
        var usedBindings = Set<String>()
        for b in bindings where b["type"]?.stringValue == "arrow" {
            guard let from = b["fromId"]?.stringValue, let terminal = b["props"]?["terminal"]?.stringValue,
                  shapes[from]?["type"]?.stringValue == "arrow" else { continue }
            arrowBindings[from, default: [:]][terminal] = b
        }

        var report = Report()
        var records: [BoardRecord] = []
        let screenKeys = try OrderKey.sequence(pages.count)
        var currentScreen: RecordID?
        let currentPageID = session?["currentPageId"]?.stringValue
            ?? session?["pageStates"]?.arrayValue?.first?["pageId"]?.stringValue
        var referencedAssets = Set<String>()

        for (pi, page) in pages.enumerated() {
            let pageID = page.rec["id"]?.stringValue ?? "page:\(pi)"
            let screenID = RecordID.converted(.screen, from: pageID)
            if pageID == currentPageID { currentScreen = screenID }

            // flatten the page's shapes in drawing order, each with its page transform
            var flat: [Placed] = []
            func walk(_ parent: String, _ t: CGAffineTransform, _ rot: Double, _ holder: String?) {
                for s in children[parent] ?? [] {
                    let x = s["x"]?.numberValue ?? 0
                    let y = s["y"]?.numberValue ?? 0
                    let r = s["rotation"]?.numberValue ?? 0
                    let local = CGAffineTransform(translationX: x, y: y).rotated(by: r).concatenating(t)
                    let id = s["id"]?.stringValue ?? UUID().uuidString
                    let type = s["type"]?.stringValue ?? "?"
                    flat.append(Placed(shape: s, id: id, type: type, transform: local, rotation: rot + r, parent: holder))
                    if children[id] != nil { walk(id, local, rot + r, id) }
                }
            }
            walk(pageID, .identity, 0, nil)
            var placedByID: [String: Placed] = [:]
            for p in flat { placedByID[p.id] = p }

            var converted: [BoardRecord] = []
            var markStrokes: [String: (kind: MarkKind, lineId: String?, why: String?, strokes: [RecordID])] = [:]
            var echoLines: [BoardRecord] = []

            for p in flat {
                let s = p.shape
                let type = p.type
                let props = s["props"]?.objectValue ?? [:]
                let meta = s["meta"]?.objectValue ?? [:]
                let sid = p.id
                let origin = Vec2(p.transform.tx, p.transform.ty)
                let rot = p.rotation
                // what every converted record keeps besides its fields
                var common: Meta = [:]
                if let opacity = s["opacity"]?.numberValue, opacity < 1 { common["opacity"] = .number(opacity) }
                if s["isLocked"]?.boolValue == true && meta["aiOverlay"]?.boolValue != true { common["locked"] = true }
                if let parent = p.parent { common["parent"] = .string(parent) }

                switch type {
                case "draw", "highlight":
                    guard var st = drawStroke(id: sid, type: type, props: props, meta: meta, screen: screenID, origin: origin, rotation: rot) else {
                        report.warnings.append("\(sid): a draw shape with no points")
                        report.skipped[type, default: 0] += 1
                        continue
                    }
                    st.meta.merge(common) { _, new in new }
                    converted.append(.stroke(st))
                    report.strokes += 1
                    if st.author == .tutor { report.tutorStrokes += 1 }
                    if let key = meta["mark"]?.stringValue, let kind = markKind(key) {
                        var m = markStrokes[key] ?? (kind, meta["lineId"]?.stringValue, meta["markWhy"]?.stringValue, [])
                        m.strokes.append(st.id)
                        markStrokes[key] = m
                    }
                case "geo", "line", "note", "frame":
                    guard var shape = shapeRecord(id: sid, type: type, props: props, meta: meta, screen: screenID, origin: origin, rotation: rot) else {
                        report.warnings.append("\(sid): a \(type) shape that could not be read")
                        report.skipped[type, default: 0] += 1
                        continue
                    }
                    shape.meta.merge(common) { _, new in new }
                    converted.append(.shape(shape))
                    switch type {
                    case "note": report.notes += 1
                    case "frame": report.frames += 1
                    default: report.shapes += 1
                    }
                case "arrow":
                    guard var shape = arrowRecord(
                        id: sid, props: props, meta: meta, screen: screenID, placed: p,
                        bindings: arrowBindings[sid] ?? [:], placedByID: placedByID, report: &report)
                    else {
                        report.warnings.append("\(sid): an arrow with no ends")
                        report.skipped[type, default: 0] += 1
                        continue
                    }
                    for b in (arrowBindings[sid] ?? [:]).values { if let bid = b["id"]?.stringValue { usedBindings.insert(bid) } }
                    shape.meta.merge(common) { _, new in new }
                    converted.append(.shape(shape))
                    report.shapes += 1
                case "text":
                    var rec = textRecord(id: sid, props: props, meta: meta, screen: screenID, origin: origin, rotation: rot)
                    rec.meta.merge(common) { _, new in new }
                    converted.append(.math(rec))
                    report.texts += 1
                case "image", "video", "embed", "bookmark":
                    if type == "image" && isPendingOverlay(meta) {
                        report.droppedOverlays += 1
                        continue
                    }
                    let assetID = props["assetId"]?.stringValue
                    if let assetID { referencedAssets.insert(assetID) }
                    var rec = imageRecord(
                        id: sid, type: type, props: props, meta: meta, asset: assetID.flatMap { assets[$0] },
                        screen: screenID, origin: origin, rotation: rot)
                    rec.meta.merge(common) { _, new in new }
                    if rec.asset.src.hasPrefix("data:") { report.inlineImages += 1 }
                    converted.append(.image(rec))
                    switch type {
                    case "video": report.videos += 1
                    case "embed", "bookmark": report.links += 1
                    default: report.images += 1
                    }
                case "math":
                    let source = props["source"]?.stringValue ?? "ai"
                    let role: MathRole = source == "echo" ? .readback : source == "student" ? .note : .answer
                    let lineId = props["lineId"]?.stringValue ?? meta["lineId"]?.stringValue
                    let lineRecordID = lineId.flatMap { $0.isEmpty ? nil : RecordID("line:\($0)") }
                    var keep = meta
                    keep.merge(common) { _, new in new }
                    if rot != 0 { keep["rotation"] = .number(rot) }
                    // what the board does not model: the echo's state and the tutor's notes on it
                    var extra: [String: JSONValue] = [:]
                    for k in ["status", "resultLatex", "note", "tone", "anchorIds"] { if let v = props[k] { extra[k] = v } }
                    if !extra.isEmpty { keep["tldraw"] = .object(["type": "math", "props": .object(extra)]) }
                    let rec = MathRecord(
                        id: .converted(.math, from: sid), screen: screenID, order: "a0",
                        author: source == "student" ? (meta["live"]?.boolValue == true ? .tutor : .kid) : .tutor,
                        role: role, latex: props["latex"]?.stringValue ?? "", x: origin.x, y: origin.y,
                        w: props["w"]?.numberValue ?? 0, h: props["h"]?.numberValue ?? 0,
                        fontSize: mathFontSizes[props["size"]?.stringValue ?? "m"] ?? 24, line: lineRecordID, meta: keep)
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
                    var rec = graphRecord(id: sid, props: props, meta: meta, screen: screenID, origin: origin)
                    rec.meta.merge(common) { _, new in new }
                    if rot != 0 { rec.meta["rotation"] = .number(rot) }
                    converted.append(.graph(rec))
                    report.graphs += 1
                case "group":
                    break // its children are walked in its place
                default:
                    // a shape this build does not know: kept whole, where it was on the page
                    let keptID = RecordID.converted(.tldraw, from: sid)
                    converted.append(.unknown(UnknownRecord(
                        id: keptID, type: "tldraw.shape",
                        json: [
                            "id": .string(keptID.rawValue), "type": "tldraw.shape",
                            "screen": .string(screenID.rawValue), "x": .number(origin.x), "y": .number(origin.y),
                            "rotation": .number(rot), "shape": .object(s),
                        ])))
                    report.kept += 1
                }
            }

            // drawing order → fresh fractional keys (records kept whole have no order)
            let drawable = converted.indices.filter { converted[$0].isDrawable }
            let keys = try OrderKey.sequence(drawable.count)
            for (k, i) in drawable.enumerated() { converted[i] = withOrder(converted[i], keys[k]) }

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
            var screenMeta = page.rec["meta"]?.objectValue ?? [:]
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

        // everything else in the store, kept whole: bindings that are not an arrow's, assets no
        // shape uses (an inline one is left out: the original keeps it), other record types
        var leftovers: [[String: JSONValue]] = others
        leftovers += bindings.filter { !usedBindings.contains($0["id"]?.stringValue ?? "") }
        for (id, a) in assets.sorted(by: { $0.key < $1.key }) where !referencedAssets.contains(id) {
            if a["props"]?["src"]?.stringValue?.hasPrefix("data:") == true {
                report.warnings.append("\(id): an unused inline asset (left in the original)")
                continue
            }
            leftovers.append(a)
        }
        for rec in leftovers {
            guard let id = rec["id"]?.stringValue else { continue }
            records.append(.unknown(UnknownRecord(
                id: RecordID("tldraw:\(id)"), type: "tldraw.record",
                json: ["id": .string("tldraw:\(id)"), "type": "tldraw.record", "record": .object(rec)])))
            report.kept += 1
        }

        var docMeta: Meta = [:]
        var origin: [String: JSONValue] = ["format": "tldraw"]
        if let schema = root["document"]?["schema"] ?? root["schema"] { origin["schema"] = schema }
        if let documentRecord {
            var d = documentRecord
            d["typeName"] = nil
            d["id"] = nil
            if !(d.isEmpty) { origin["document"] = .object(d) }
        }
        docMeta["convertedFrom"] = .object(origin)
        return Result(document: BoardDocument(records, meta: docMeta), report: report, currentScreen: currentScreen)
    }

    // MARK: - who and what is kept

    static func authorOf(_ meta: [String: JSONValue]) -> Author {
        meta["live"]?.boolValue == true ? .tutor : .kid
    }

    /// A stroke's meta: everything except the replay stamps, which become its fields.
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

    /// The retired image pipeline's suggest / answer overlay nobody accepted: a proposal, not part
    /// of the board (the web's `dropPendingAiOverlays` removes it when the board opens).
    static func isPendingOverlay(_ meta: [String: JSONValue]) -> Bool {
        meta["aiOverlay"]?.boolValue == true && meta["mode"]?.stringValue != "feedback" && meta["accepted"]?.boolValue != true
    }

    /// `props` without some keys, as `meta.tldraw.props`.
    static func props(_ props: [String: JSONValue], without keys: Set<String>) -> JSONValue {
        .object(props.filter { !keys.contains($0.key) })
    }

    // MARK: - ink

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
        } else if let t0 = meta["t"]?.numberValue, let t1 = meta["t1"]?.numberValue, t1 > t0, pts.count == 1 {
            // a dot: the pen-up time rides on its one point
            pts[0].t = Float(t1 - t0).rounded()
        }
        let fill = FillStyle.fromTldraw(props["fill"]?.stringValue ?? "none")
        return StrokeRecord(
            id: .converted(.stroke, from: id), screen: screen, order: "a0", author: author,
            color: InkColor.fromTldraw(props["color"]?.stringValue ?? "black", author: author),
            width: width, pressure: isPen ? .real : .simulated, x: origin.x, y: origin.y, rotation: rotation,
            points: PointCodec.normalize(pts), start: start, closed: props["isClosed"]?.boolValue ?? false, fill: fill, meta: keep)
    }

    // MARK: - shapes

    /// A geo, line, note or frame shape.
    static func shapeRecord(
        id: String, type: String, props: [String: JSONValue], meta: [String: JSONValue],
        screen: RecordID, origin: Vec2, rotation: Double
    ) -> ShapeRecord? {
        let scale = props["scale"]?.numberValue ?? 1
        let width = (strokeSizes[props["size"]?.stringValue ?? "m"] ?? 3.5) * scale
        let author = authorOf(meta)
        let color = InkColor.fromTldraw(props["color"]?.stringValue ?? "black", author: author)
        let fill = FillStyle.fromTldraw(props["fill"]?.stringValue ?? "none")
        var keep: Meta = meta
        if let dash = props["dash"]?.stringValue, dash != "draw" { keep["dash"] = .string(dash) }
        switch type {
        case "geo":
            let geo = props["geo"]?.stringValue ?? "rectangle"
            let w = props["w"]?.numberValue ?? 100
            let h = (props["h"]?.numberValue ?? 100) + (props["growY"]?.numberValue ?? 0)
            if geo != "rectangle" && geo != "ellipse" { keep["geo"] = .string(geo) }
            let label = TldrawRichText.plainText(props["richText"] ?? props["text"])
            if !label.isEmpty { keep["label"] = .string(label) }
            // (`fill` stays: tldraw's pattern and lined-fill are both our `semi`)
            keep["tldraw"] = .object(["type": "geo", "props": Self.props(props, without: ["w", "h", "growY", "geo", "color", "size", "scale", "dash"])])
            let kind: ShapeKind
            var points: [Vec2] = []
            if let outline = GeoOutline.polygon(geo, w: w, h: h) {
                kind = .line
                points = outline
            } else {
                kind = GeoOutline.isRound(geo) ? .ellipse : .rect
            }
            return ShapeRecord(
                id: .converted(.shape, from: id), screen: screen, order: "a0", author: author, kind: kind,
                x: origin.x, y: origin.y, rotation: rotation, w: w, h: h, points: points,
                color: color, width: width, fill: fill, meta: keep)
        case "line":
            let handles = props["points"]?.objectValue?.values.compactMap { $0.objectValue } ?? []
            let sorted = handles.sorted { ($0["index"]?.stringValue ?? "").utf8.lexicographicallyPrecedes(($1["index"]?.stringValue ?? "").utf8) }
            let pts = sorted.compactMap { h -> Vec2? in
                guard let x = h["x"]?.numberValue, let y = h["y"]?.numberValue else { return nil }
                return Vec2(x, y)
            }
            guard pts.count >= 2 else { return nil }
            if let spline = props["spline"]?.stringValue, spline != "line" { keep["spline"] = .string(spline) }
            keep["tldraw"] = .object(["type": "line", "props": Self.props(props, without: ["color", "size", "scale", "dash", "spline"])])
            return ShapeRecord(
                id: .converted(.shape, from: id), screen: screen, order: "a0", author: author, kind: .line,
                x: origin.x, y: origin.y, rotation: rotation, points: pts, color: color, width: width, meta: keep)
        case "note":
            let label = TldrawRichText.plainText(props["richText"] ?? props["text"])
            if !label.isEmpty { keep["label"] = .string(label) }
            keep["note"] = true
            keep["tldraw"] = .object(["type": "note", "props": Self.props(props, without: ["color", "scale", "growY"])])
            let growY = props["growY"]?.numberValue ?? 0
            return ShapeRecord(
                id: .converted(.shape, from: id), screen: screen, order: "a0", author: author, kind: .rect,
                x: origin.x, y: origin.y, rotation: rotation, w: noteSize * scale, h: (noteSize + growY) * scale,
                color: color, width: 1, fill: .semi, meta: keep)
        case "frame":
            let name = props["name"]?.stringValue ?? ""
            if !name.isEmpty { keep["label"] = .string(name) }
            keep["frame"] = true
            keep["tldraw"] = .object(["type": "frame", "props": Self.props(props, without: ["w", "h", "color"])])
            return ShapeRecord(
                id: .converted(.shape, from: id), screen: screen, order: "a0", author: author, kind: .rect,
                x: origin.x, y: origin.y, rotation: rotation, w: props["w"]?.numberValue ?? 160, h: props["h"]?.numberValue ?? 90,
                color: props["color"]?.stringValue.map { InkColor.fromTldraw($0, author: author) } ?? .grey, width: 1, meta: keep)
        default:
            return nil
        }
    }

    /// An arrow: its ends where tldraw draws them (an end bound to a shape is attached to it, in
    /// `meta.attach`), its bend drawn as an arc.
    static func arrowRecord(
        id: String, props: [String: JSONValue], meta: [String: JSONValue], screen: RecordID, placed: Placed,
        bindings: [String: [String: JSONValue]], placedByID: [String: Placed], report: inout Report
    ) -> ShapeRecord? {
        func vec(_ v: JSONValue?) -> Vec2? {
            guard let x = v?["x"]?.numberValue, let y = v?["y"]?.numberValue else { return nil }
            return Vec2(x, y)
        }
        guard var a = vec(props["start"]), var b = vec(props["end"]) else { return nil }
        let scale = props["scale"]?.numberValue ?? 1
        let width = (strokeSizes[props["size"]?.stringValue ?? "m"] ?? 3.5) * scale
        let author = authorOf(meta)
        var keep: Meta = meta
        if let dash = props["dash"]?.stringValue, dash != "draw" { keep["dash"] = .string(dash) }
        let label = TldrawRichText.plainText(props["richText"] ?? props["text"])
        if !label.isEmpty { keep["label"] = .string(label) }

        // bound ends: where tldraw puts them (getArrowTerminalInArrowSpace), then clipped to the
        // target's outline unless the binding is exact
        let toArrow = placed.transform.inverted()
        let sameTarget = bindings["start"]?["toId"]?.stringValue != nil && bindings["start"]?["toId"]?.stringValue == bindings["end"]?["toId"]?.stringValue
        var attach: [String: JSONValue] = [:]
        var targets: [String: (placed: Placed, box: Box, exact: Bool)] = [:]
        for terminal in ["start", "end"] {
            guard let binding = bindings[terminal], let to = binding["toId"]?.stringValue, let target = placedByID[to],
                  let box = localBounds(target) else { continue }
            let bp = binding["props"]?.objectValue ?? [:]
            let anchor = vec(bp["normalizedAnchor"]) ?? Vec2(0.5, 0.5)
            let precise = bp["isPrecise"]?.boolValue ?? false
            let exact = bp["isExact"]?.boolValue ?? false
            let at = precise || sameTarget ? anchor : Vec2(0.5, 0.5)
            let local = Vec2(box.x + at.x * box.w, box.y + at.y * box.h)
            let page = local.cgPoint.applying(target.transform)
            let inArrow = page.applying(toArrow)
            if terminal == "start" { a = Vec2(inArrow.x, inArrow.y) } else { b = Vec2(inArrow.x, inArrow.y) }
            targets[terminal] = (target, box, exact)
            var entry: [String: JSONValue] = [
                "to": .string(convertedID(for: target).rawValue),
                "anchor": ["x": .number(anchor.x), "y": .number(anchor.y)],
            ]
            if precise { entry["precise"] = true }
            if exact { entry["exact"] = true }
            if let bid = binding["id"]?.stringValue { entry["binding"] = .string(bid) }
            if let snap = bp["snap"]?.stringValue, snap != "none" { entry["snap"] = .string(snap) }
            attach[terminal] = .object(entry)
            report.attachedEnds += 1
        }
        let bend = props["bend"]?.numberValue ?? 0
        if bend == 0 {
            // clip a bound end to its target's outline, as tldraw draws a straight arrow: each along
            // the line between the two terminals (both ends from the same, unclipped line)
            let (a0, b0) = (a, b)
            if let t = targets["start"], !t.exact, let hit = clip(from: b0, to: a0, target: t.placed, box: t.box, arrow: placed.transform) { a = hit }
            if let t = targets["end"], !t.exact, let hit = clip(from: a0, to: b0, target: t.placed, box: t.box, arrow: placed.transform) { b = hit }
        }
        if !attach.isEmpty { keep["attach"] = .object(attach) }
        keep["tldraw"] = .object(["type": "arrow", "props": Self.props(props, without: ["start", "end", "color", "size", "scale", "dash"])])
        var points = [a, b]
        if bend != 0, let arc = arcPoints(a, b, bend: bend) { points = arc }
        return ShapeRecord(
            id: .converted(.shape, from: id), screen: screen, order: "a0", author: author, kind: .arrow,
            x: placed.transform.tx, y: placed.transform.ty, rotation: placed.rotation, points: points,
            color: InkColor.fromTldraw(props["color"]?.stringValue ?? "black", author: author), width: width,
            fill: FillStyle.fromTldraw(props["fill"]?.stringValue ?? "none"), meta: keep)
    }

    /// The id a tldraw shape gets once converted (what an arrow's `meta.attach.to` names).
    static func convertedID(for p: Placed) -> RecordID {
        switch p.type {
        case "draw", "highlight": return .converted(.stroke, from: p.id)
        case "geo", "line", "arrow", "note", "frame": return .converted(.shape, from: p.id)
        case "image", "video", "embed", "bookmark": return .converted(.image, from: p.id)
        case "math", "text": return .converted(.math, from: p.id)
        case "graph": return .converted(.graph, from: p.id)
        default: return .converted(.tldraw, from: p.id)
        }
    }

    /// A shape's geometry bounds in its own space, as tldraw measures them (nil when unknown).
    static func localBounds(_ p: Placed) -> Box? {
        let props = p.shape["props"]?.objectValue ?? [:]
        let scale = props["scale"]?.numberValue ?? 1
        switch p.type {
        case "geo":
            return Box(x: 0, y: 0, w: props["w"]?.numberValue ?? 100, h: (props["h"]?.numberValue ?? 100) + (props["growY"]?.numberValue ?? 0))
        case "note":
            return Box(x: 0, y: 0, w: noteSize * scale, h: (noteSize + (props["growY"]?.numberValue ?? 0)) * scale)
        case "image", "video", "embed", "bookmark", "frame", "math", "graph":
            guard let w = props["w"]?.numberValue, let h = props["h"]?.numberValue else { return nil }
            return Box(x: 0, y: 0, w: w, h: h)
        case "text":
            let fs = (fontSizes[props["size"]?.stringValue ?? "m"] ?? 24) * scale
            let lines = max(1, TldrawRichText.plainText(props["richText"] ?? props["text"]).split(separator: "\n", omittingEmptySubsequences: false).count)
            return Box(x: 0, y: 0, w: (props["w"]?.numberValue ?? 100) * scale, h: Double(lines) * fs * textLineHeight)
        case "draw", "highlight":
            var pts: [Vec2] = []
            for seg in props["segments"]?.arrayValue ?? [] {
                for q in seg["points"]?.arrayValue ?? [] {
                    if let x = q["x"]?.numberValue, let y = q["y"]?.numberValue { pts.append(Vec2(x, y)) }
                }
            }
            return Box.around(pts)
        default:
            return nil
        }
    }

    /// Where the segment `from` → `to` (arrow space) first meets the target's outline (a box, or an
    /// ellipse for round geo), in arrow space; nil when it never does (`from` inside the target).
    static func clip(from: Vec2, to: Vec2, target: Placed, box: Box, arrow: CGAffineTransform) -> Vec2? {
        // into the target's space
        let toTarget = arrow.concatenating(target.transform.inverted())
        let p0 = from.cgPoint.applying(toTarget)
        let p1 = to.cgPoint.applying(toTarget)
        let a = Vec2(p0.x, p0.y)
        let b = Vec2(p1.x, p1.y)
        let d = b - a
        var best: Double?
        let round = target.type == "geo" && GeoOutline.isRound(target.shape["props"]?["geo"]?.stringValue ?? "")
        if round {
            let c = box.center
            let rx = box.w / 2, ry = box.h / 2
            guard rx > 0, ry > 0 else { return nil }
            let ox = (a.x - c.x) / rx, oy = (a.y - c.y) / ry
            let dx = d.x / rx, dy = d.y / ry
            let qa = dx * dx + dy * dy
            let qb = 2 * (ox * dx + oy * dy)
            let qc = ox * ox + oy * oy - 1
            let disc = qb * qb - 4 * qa * qc
            if qa > 0, disc >= 0 {
                for t in [(-qb - disc.squareRoot()) / (2 * qa), (-qb + disc.squareRoot()) / (2 * qa)] where t >= 0 && t <= 1 {
                    best = min(best ?? t, t)
                }
            }
        } else {
            func edge(_ t: Double?) { if let t, t >= 0, t <= 1 { best = min(best ?? t, t) } }
            if d.x != 0 {
                for x in [box.minX, box.maxX] {
                    let t = (x - a.x) / d.x
                    let y = a.y + d.y * t
                    if y >= box.minY - 1e-9 && y <= box.maxY + 1e-9 { edge(t) }
                }
            }
            if d.y != 0 {
                for y in [box.minY, box.maxY] {
                    let t = (y - a.y) / d.y
                    let x = a.x + d.x * t
                    if x >= box.minX - 1e-9 && x <= box.maxX + 1e-9 { edge(t) }
                }
            }
        }
        // `from` inside the target: no outline between them worth stopping at
        guard let t = best, t > 1e-6 else { return nil }
        let hit = a + d * t
        let back = hit.cgPoint.applying(toTarget.inverted())
        return Vec2(back.x, back.y)
    }

    /// The arc tldraw draws for a bent arrow (through the ends and the bend's middle handle), sampled.
    static func arcPoints(_ a: Vec2, _ b: Vec2, bend: Double) -> [Vec2]? {
        let d = b - a
        guard d.length > 0 else { return nil }
        let u = d.unit
        // tldraw: middle = med + u.per() * -bend, with per (x, y) → (y, -x)
        let m = (a + b) / 2 + Vec2(u.y, -u.x) * -bend
        // the circle through a, m, b
        let ax = a.x, ay = a.y, bx = m.x, by = m.y, cx = b.x, cy = b.y
        let den = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
        guard abs(den) > 1e-9 else { return nil }
        let ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / den
        let uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / den
        let center = Vec2(ux, uy)
        let r = a.dist(center)
        let a0 = atan2(a.y - center.y, a.x - center.x)
        let am = atan2(m.y - center.y, m.x - center.x)
        let a1 = atan2(b.y - center.y, b.x - center.x)
        // the sweep from a to b that passes through m
        func norm(_ x: Double) -> Double { var v = x.truncatingRemainder(dividingBy: 2 * .pi); if v < 0 { v += 2 * .pi }; return v }
        var sweep = norm(a1 - a0)
        if norm(am - a0) > sweep { sweep -= 2 * .pi }
        return (0...arcSegments).map { i in
            let t = a0 + sweep * Double(i) / Double(arcSegments)
            return i == 0 ? a : i == arcSegments ? b : Vec2(center.x + r * cos(t), center.y + r * sin(t))
        }
    }

    // MARK: - text, pictures, graphs

    /// A text shape: a typed note (`math`, role `note`), its text as LaTeX text mode and in `meta.text`.
    static func textRecord(
        id: String, props: [String: JSONValue], meta: [String: JSONValue], screen: RecordID, origin: Vec2, rotation: Double
    ) -> MathRecord {
        let scale = props["scale"]?.numberValue ?? 1
        let text = TldrawRichText.plainText(props["richText"] ?? props["text"])
        let fontSize = (fontSizes[props["size"]?.stringValue ?? "m"] ?? 24) * scale
        let lines = max(1, text.split(separator: "\n", omittingEmptySubsequences: false).count)
        var keep: Meta = meta
        keep["text"] = .string(text)
        if rotation != 0 { keep["rotation"] = .number(rotation) }
        keep["tldraw"] = .object(["type": "text", "props": Self.props(props, without: ["w"])])
        return MathRecord(
            id: .converted(.math, from: id), screen: screen, order: "a0", author: authorOf(meta), role: .note,
            latex: TldrawRichText.latexText(text), x: origin.x, y: origin.y,
            w: (props["w"]?.numberValue ?? 100) * scale, h: Double(lines) * fontSize * textLineHeight,
            fontSize: fontSize, meta: keep)
    }

    /// An image, or a placeholder for a video, an embed or a bookmark (its link in `meta.link`).
    static func imageRecord(
        id: String, type: String, props: [String: JSONValue], meta: [String: JSONValue], asset: [String: JSONValue]?,
        screen: RecordID, origin: Vec2, rotation: Double
    ) -> ImageRecord {
        let ap = asset?["props"]?.objectValue ?? [:]
        var keep: Meta = meta
        var tl: [String: JSONValue] = ["type": .string(type), "props": Self.props(props, without: ["w", "h", "assetId"])]
        if let assetID = props["assetId"]?.stringValue { tl["assetId"] = .string(assetID) }
        if var a = asset {
            // the asset record without what the image record carries (src, mime type, size)
            var keptProps = ap
            for k in ["src", "mimeType", "w", "h"] { keptProps[k] = nil }
            a["props"] = .object(keptProps)
            a["typeName"] = nil
            tl["asset"] = .object(a)
        }
        var ref = AssetRef(src: ap["src"]?.stringValue ?? "", mime: ap["mimeType"]?.stringValue, w: ap["w"]?.numberValue, h: ap["h"]?.numberValue)
        switch type {
        case "video":
            keep["video"] = true
        case "embed":
            ref = AssetRef(src: "")
            if let url = props["url"]?.stringValue { keep["link"] = .string(url) }
        case "bookmark":
            // its preview picture, when the bookmark has one
            ref = AssetRef(src: ap["image"]?.stringValue ?? "")
            if let url = props["url"]?.stringValue ?? ap["src"]?.stringValue { keep["link"] = .string(url) }
            if let title = ap["title"]?.stringValue, !title.isEmpty { keep["title"] = .string(title) }
        default:
            break
        }
        if ref.src.isEmpty, let url = props["url"]?.stringValue, !url.isEmpty, type == "image" { ref.src = url }
        keep["tldraw"] = .object(tl)
        return ImageRecord(
            id: .converted(.image, from: id), screen: screen, order: "a0", author: authorOf(meta),
            x: origin.x, y: origin.y, w: props["w"]?.numberValue ?? 100, h: props["h"]?.numberValue ?? 100, rotation: rotation,
            asset: ref, meta: keep)
    }

    /// The web's graph colours (GRAPH_COLORS, hex) as palette tokens; the hex is kept in `meta.fnColors`.
    static let graphHex: [String: InkColor] = [
        "#2563eb": .tutor, "#dc2626": .red, "#16a34a": .green, "#7c3aed": .violet, "#ea580c": .orange, "#0891b2": .lightBlue,
    ]

    static func graphRecord(id: String, props: [String: JSONValue], meta: [String: JSONValue], screen: RecordID, origin: Vec2) -> GraphRecord {
        var keep: Meta = meta
        var hexes: [String: JSONValue] = [:]
        let fns: [GraphFunction] = props["fns"]?.arrayValue?.compactMap { f in
            guard let o = f.objectValue else { return nil }
            let fid = o["id"]?.stringValue ?? ""
            let raw = o["color"]?.stringValue ?? "blue"
            var color = InkColor.fromTldraw(raw, author: .tutor)
            if InkColor(rawValue: raw) == nil && raw != "blue" {
                color = graphHex[raw.lowercased()] ?? .tutor
                hexes[fid] = .string(raw)
            }
            return GraphFunction(id: fid, expr: o["expr"]?.stringValue ?? "", latex: o["latex"]?.stringValue ?? "", color: color)
        } ?? []
        if !hexes.isEmpty { keep["fnColors"] = .object(hexes) }
        let pts: [GraphPoint] = props["points"]?.arrayValue?.compactMap { p in
            guard let x = p["x"]?.numberValue, let y = p["y"]?.numberValue else { return nil }
            return GraphPoint(x: x, y: y, label: p["label"]?.stringValue ?? "")
        } ?? []
        let lineId = props["lineId"]?.stringValue
        return GraphRecord(
            id: .converted(.graph, from: id), screen: screen, order: "a0", author: authorOf(meta),
            x: origin.x, y: origin.y, w: props["w"]?.numberValue ?? 400, h: props["h"]?.numberValue ?? 300,
            functions: fns, points: pts,
            window: GraphWindow(
                xMin: props["xMin"]?.numberValue ?? -10, xMax: props["xMax"]?.numberValue ?? 10,
                yMin: props["yMin"]?.numberValue ?? -10, yMax: props["yMax"]?.numberValue ?? 10,
                autoY: props["autoY"]?.boolValue ?? false),
            grid: props["grid"]?.boolValue ?? true, title: props["title"]?.stringValue ?? "",
            line: lineId.flatMap { $0.isEmpty ? nil : RecordID("line:\($0)") }, meta: keep)
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
                if (s.kind == .line || s.kind == .arrow) && !(s.w > 0 && s.h > 0) {
                    add(Box.around(s.points.map { $0.rotated(by: s.rotation) + Vec2(s.x, s.y) }))
                } else {
                    add(corners(s.x, s.y, s.w, s.h, s.rotation))
                }
            case .image(let i): add(corners(i.x, i.y, i.w, i.h, i.rotation))
            case .math(let m): add(corners(m.x, m.y, m.w, m.h, m.meta["rotation"]?.numberValue ?? 0))
            case .graph(let g): add(corners(g.x, g.y, g.w, g.h, g.meta["rotation"]?.numberValue ?? 0))
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

extension RecordID {
    /// The id of a tldraw record kept whole (`UnknownRecord`): `tldraw:` + its key.
    static func converted(_ prefix: KeptPrefix, from sourceID: String) -> RecordID {
        let key = sourceID.firstIndex(of: ":").map { String(sourceID[sourceID.index(after: $0)...]) } ?? sourceID
        return RecordID("\(prefix.rawValue):\(key)")
    }

    enum KeptPrefix: String {
        case tldraw
    }
}
