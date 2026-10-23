import AgathonBoard
import AgathonBrain
import Foundation

/// "Graph it" beside a line the engine reads as a function (`y = 2x + 1`, `f(x) = x^{2}`).
public struct GraphOffer: Identifiable, Equatable, Sendable {
    /// the line's id
    public let id: String
    /// the line as read
    public let latex: String
    /// the line's ink (page units): the chip sits just right of it
    public let anchor: BrainRect
}

/// "Graph it" (Calculator's Math Notes graphs, kid-safe): when the kid writes a line the engine reads
/// as a function, a small chip beside it offers its graph; a tap puts the board's own graph object
/// near the line (plotted, movable, resizable, in the tutor's colour). Nothing is graphed unasked,
/// and a graph is no answer: it pictures the line the kid wrote. The chip shows for a while after
/// the line is read (`graphOfferMs`), once per reading of the line.
extension LiveLoop {
    /// Graph sizes tried, biggest first (page units; a screen is 1600 × 900).
    static let graphSizes: [(w: Double, h: Double)] = [(400, 320), (340, 272), (280, 224)]

    /// The line was rendered after a read: a function line not yet graphed is offered its graph.
    func offerGraph(_ st: LiveLine) {
        guard settings.enabled, settings.mode != .off, st.analysis?.kind == "function", st.analysis?.plot != nil,
              !st.latex.isEmpty, graphOffered[st.id] != st.latex, !hasGraph(st) else { return }
        graphOffered[st.id] = st.latex
        graphOffers.removeAll { $0.id == st.id }
        graphOffers.append(GraphOffer(id: st.id, latex: st.latex, anchor: st.bounds))
        let id = st.id
        let latex = st.latex
        graphOfferTimers[id]?.cancel()
        graphOfferTimers[id] = scheduler.after(LiveTiming.graphOfferMs) { [weak self] in
            self?.graphOffers.removeAll { $0.id == id && $0.latex == latex }
            self?.graphOfferTimers[id] = nil
        }
    }

    /// The offer for a line goes (its line changed or went, Live was switched off).
    func withdrawGraphOffer(_ id: String) {
        graphOffers.removeAll { $0.id == id }
        graphOfferTimers[id]?.cancel()
        graphOfferTimers[id] = nil
    }

    func withdrawGraphOffers() {
        for id in graphOffers.map(\.id) { withdrawGraphOffer(id) }
    }

    func hasGraph(_ st: LiveLine) -> Bool {
        board.store.liveRecords(on: board.currentScreenID, lineId: st.id).contains { $0.meta.string(LiveMeta.graphFor) == st.latex }
    }

    /// "Graph it": the line's graph on the board, beside the line (else under it), clear of
    /// everything on the screen. The engine picks the window (its intercepts and turning points in
    /// view, `sketchGraph`); the line's own reading is the fallback.
    public func graphIt(_ lineId: String) {
        withdrawGraphOffer(lineId)
        guard settings.enabled, let st = lines[lineId], st.analysis?.kind == "function", let plot = st.analysis?.plot, !hasGraph(st) else { return }
        let latex = st.latex
        // an SAT question's page with a plane: the line goes onto the question's own graph
        if graphOntoQuestion(expr: plot.expr, latex: latex, lineId: lineId, source: "ai") { return }
        let gen = generation
        track { [weak self] in
            guard let self else { return }
            let sketch = try? await self.brain.sketchGraph([latex], explicit: true)
            guard gen == self.generation, let cur = self.lines[lineId], cur.latex == latex, !self.hasGraph(cur) else { return }
            let content = Self.graphContent(sketch, plot: plot, latex: latex, lineId: lineId)
            guard let slot = self.graphSlot(beside: cur.bounds) else {
                self.say(LiveCopy.Graph.noRoom)
                return
            }
            let screen = self.board.currentScreenID
            let meta: Meta = [LiveMeta.live: true, LiveMeta.source: "ai", LiveMeta.lineId: .string(lineId), LiveMeta.graphFor: .string(latex),
                              LiveMeta.createdAt: .number((Date().timeIntervalSince1970 * 1000).rounded())]
            let record = GraphRecord(screen: screen, order: self.board.store.nextOrder(on: screen), author: .tutor,
                                     x: slot.x, y: slot.y, w: slot.w, h: slot.h, functions: content.functions, points: content.points,
                                     window: content.window, line: RecordID("line:\(lineId)"), meta: meta)
            self.board.store.put(.graph(record), origin: .tutor)
        }
    }

    /// What the graph shows: the engine's curves, points and window for the line, else the line's own plot.
    static func graphContent(_ sketch: GraphSketch?, plot: LineAnalysis.Plot, latex: String, lineId: String) -> (functions: [GraphFunction], points: [GraphPoint], window: GraphWindow) {
        var functions: [GraphFunction] = []
        var points: [GraphPoint] = []
        if let intent = sketch?.intent, intent["kind"]?.stringValue == "plane", case .array(let curves)? = intent["curves"] {
            for (i, c) in curves.enumerated() {
                guard c["kind"]?.stringValue == "function", (c["op"]?.stringValue ?? "=") == "=", let expr = c["expr"]?.stringValue, !expr.isEmpty else { continue }
                functions.append(GraphFunction(id: "f_\(lineId)_\(i)", expr: expr, latex: c["latex"]?.stringValue ?? latex))
            }
            if case .array(let ps)? = intent["points"] {
                for p in ps {
                    guard let x = p["x"]?.numberValue, let y = p["y"]?.numberValue, x.isFinite, y.isFinite else { continue }
                    let labelled = p["label"].map { v -> Bool in
                        if case .bool(let b) = v { return b }
                        return !(v.stringValue ?? "").isEmpty
                    } ?? false
                    points.append(GraphPoint(x: x, y: y, label: labelled ? "(\(Self.short(x)), \(Self.short(y)))" : ""))
                }
            }
        }
        if functions.isEmpty {
            functions = [GraphFunction(id: "f_\(lineId)_0", expr: plot.expr, latex: latex)]
            points = []
        }
        var window = GraphWindow(autoY: true)
        if let w = sketch?.window, let x0 = w["xMin"]?.numberValue, let x1 = w["xMax"]?.numberValue,
           let y0 = w["yMin"]?.numberValue, let y1 = w["yMax"]?.numberValue, x1 > x0, y1 > y0 {
            window = GraphWindow(xMin: x0, xMax: x1, yMin: y0, yMax: y1, autoY: false)
        }
        return (Array(functions.prefix(6)), points, window)
    }

    static func short(_ v: Double) -> String {
        let r = (v * 1000).rounded() / 1000
        return r == r.rounded() ? String(Int(r)) : String(r)
    }

    /// A place for a graph beside the line (right of it and its mark), else under it: on the screen
    /// and clear of everything there. Smaller sizes are tried before giving up.
    func graphSlot(beside line: BrainRect) -> BrainRect? {
        let screen = board.screenRect
        let margin = LivePlacement.viewportMargin
        let avoid = board.store.drawables(on: board.currentScreenID).compactMap(Self.pageBox).map { $0.expanded(6) }
        let markEnd = max(line.maxX, LiveMarks.markRect(.check, line).maxX)
        func fits(_ r: BrainRect) -> Bool {
            r.x >= screen.x + margin && r.y >= screen.y + margin && r.maxX <= screen.maxX - margin && r.maxY <= screen.maxY - margin
                && !avoid.contains { $0.intersects(r) }
        }
        for size in Self.graphSizes {
            let top = min(max(screen.y + margin, line.y + line.h / 2 - size.h / 2), screen.maxY - margin - size.h)
            var candidates = [BrainRect(x: markEnd + 32, y: top, w: size.w, h: size.h),
                              BrainRect(x: line.x, y: line.maxY + 24, w: size.w, h: size.h)]
            // slide along the side, then down under the line, past what is in the way
            for k in 1...6 { candidates.append(BrainRect(x: markEnd + 32 + Double(k) * 60, y: top, w: size.w, h: size.h)) }
            for k in 1...4 { candidates.append(BrainRect(x: line.x, y: line.maxY + 24 + Double(k) * 60, w: size.w, h: size.h)) }
            if let r = candidates.first(where: fits) { return r }
        }
        return nil
    }

    /// A drawn record's page box (rotation left out).
    static func pageBox(_ r: BoardRecord) -> BrainRect? {
        switch r {
        case .stroke(let s): return StrokeBounds.of(s)
        case .math(let m): return BrainRect(x: m.x, y: m.y, w: max(m.w, 1), h: max(m.h, 1))
        case .graph(let g): return BrainRect(x: g.x, y: g.y, w: g.w, h: g.h)
        case .image(let i): return BrainRect(x: i.x, y: i.y, w: i.w, h: i.h)
        case .shape(let s):
            if s.points.isEmpty { return BrainRect(x: s.x, y: s.y, w: s.w, h: s.h) }
            let xs = s.points.map { $0.x + s.x }, ys = s.points.map { $0.y + s.y }
            return BrainRect(x: xs.min() ?? s.x, y: ys.min() ?? s.y, w: (xs.max() ?? s.x) - (xs.min() ?? s.x), h: (ys.max() ?? s.y) - (ys.min() ?? s.y))
        default: return nil
        }
    }
}
