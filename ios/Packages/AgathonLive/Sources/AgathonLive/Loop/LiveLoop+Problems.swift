import AgathonBoard
import AgathonBrain
import Foundation

/// Problems the tutor wrote on the board OUTSIDE the loop, as heads of the columns under them, so a
/// kid's answer under one is judged against it (the web's `readProblemCells` +
/// `refreshProblemColumns`, src/lib/live/chat/cells.ts):
///
///  - Ask's `write_problems` (practice, "3 more like these", Today's practice): every stroke of a
///    problem carries `meta.chatProblem = { n, lines, cell }`;
///  - the onboarding's first board: the problems are the tutor's strokes marked `problem: true`,
///    each carrying its line's LaTeX (`HandPace.lineMeta`).
///
/// The loop's own heads are `problem` records (`writeProblem`), so these become `problem` records
/// too (origin `chat` / `practice`, keyed by `problemKey` in their meta): saved with the board, put
/// back on the next open without reading anything again, removed when their ink is rubbed out or
/// cleared.
extension LiveLoop {
    /// The meta key on a problem record made from the tutor's strokes (what the record stands for).
    static let problemKeyMeta = "problemKey"

    /// The problems on the current screen changed outside the loop (Ask wrote or cleared some, or the
    /// board opened on a screen with some): their records follow the ink, and the columns under them
    /// are cut again. Cheap and idempotent; safe to call on every screen change.
    public func problemsChanged() {
        guard started else { return }
        syncProblemRecords(on: board.currentScreenID)
        refreshHeads()
        reanchorLines()
    }

    /// One problem written in the tutor's strokes: its key, LaTeX lines and where its ink is, and the
    /// id its record takes (a chat problem's is its hand block, so the learning record's key for it,
    /// `<screen>#cell:<block>`, is the same whether it comes from the strokes or the record).
    struct StrokeProblem: Equatable {
        var key: String
        var lines: [String]
        var head: BrainRect
        var origin: String
        var recordId: RecordID?
    }

    /// The problems in the tutor's strokes on `screen`, top to bottom.
    static func strokeProblems(on screen: RecordID, in store: BoardStore) -> [StrokeProblem] {
        var byKey: [String: StrokeProblem] = [:]
        for record in store.drawables(on: screen) {
            // the tutor's hand, or its problems typeset (the grown-ups switched the hand off): both
            // head the columns under them
            let meta: Meta
            let b: BrainRect
            switch record {
            case .stroke(let s) where s.author == .tutor && !s.points.isEmpty:
                meta = s.meta
                b = StrokeBounds.of(s)
            case .math(let m) where m.author == .tutor && m.meta["chatProblem"] != nil && m.w > 0 && m.h > 0:
                meta = m.meta
                b = BrainRect(x: m.x, y: m.y, w: m.w, h: m.h)
            default:
                continue
            }
            let found: (key: String, lines: [String], origin: String, id: RecordID?)?
            if let cell = Self.chatProblem(meta, bounds: b) {
                // the learning record's own key for a chat problem (its hand block); without a block,
                // the screen keeps two alike problems on two screens apart
                let block = meta.string(HandPace.blockMeta)
                let id = RecordID("problem:\(block.isEmpty ? "\(screen.key)-\(cell.key)" : cell.key)")
                found = ("chat:\(cell.key)", cell.lines, "chat", id)
            } else if meta["problem"]?.boolValue == true, let latex = meta[HandPace.lineMeta]?.stringValue, !latex.isEmpty {
                found = ("first:\(latex)", [latex], "practice", nil)
            } else {
                found = nil
            }
            guard let found else { continue }
            if var cur = byKey[found.key] {
                let x0 = min(cur.head.x, b.x), y0 = min(cur.head.y, b.y)
                cur.head = BrainRect(x: x0, y: y0, w: max(cur.head.maxX, b.maxX) - x0, h: max(cur.head.maxY, b.maxY) - y0)
                byKey[found.key] = cur
            } else {
                byKey[found.key] = StrokeProblem(key: found.key, lines: found.lines, head: b, origin: found.origin, recordId: found.id)
            }
        }
        return byKey.values.sorted { ($0.head.y, $0.head.x) < ($1.head.y, $1.head.x) }
    }

    /// Puts, updates and removes the screen's stroke-made problem records to match its ink.
    func syncProblemRecords(on screen: RecordID) {
        let store = board.store
        let wanted = Self.strokeProblems(on: screen, in: store)
        var existing: [String: ProblemRecord] = [:]
        for case .problem(let p) in store.semantic(on: screen) {
            guard let key = p.meta[Self.problemKeyMeta]?.stringValue else { continue }
            existing[key] = p
        }
        var stale = Set(existing.keys)
        for w in wanted {
            stale.remove(w.key)
            let latex = w.lines.joined(separator: "\n")
            let rect = w.head.meta
            if var p = existing[w.key] {
                guard p.latex != latex || p.meta[LiveMeta.rect] != rect else { continue }
                p.latex = latex
                p.meta[LiveMeta.rect] = rect
                store.put(.problem(p), origin: .tutor)
            } else {
                let record = ProblemRecord(id: w.recordId ?? .make(.problem), screen: screen, latex: latex, origin: w.origin,
                                           meta: [LiveMeta.rect: rect, Self.problemKeyMeta: .string(w.key)])
                store.put(.problem(record), origin: .tutor)
            }
        }
        let gone = stale.compactMap { existing[$0]?.id }
        if !gone.isEmpty { store.remove(gone, origin: .tutor) }
    }
}
