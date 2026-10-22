import AgathonBoard
import AgathonBrain
import Foundation

/// What the tutor made of one written line, as the Training Center reads it off the loop and the
/// board: the tutor's lines the strokes ended up in, its read, the engine's word, the mark.
public struct TrainingObservation: Sendable, Equatable {
    /// the tutor's lines holding any of the written strokes (1 is right; 2+: split)
    public var lineIds: [String]
    /// the one line holds strokes of other written lines too: merged
    public var merged: Bool
    public var latex: String?
    public var confidence: Double?
    public var provider: String?
    public var verdict: String?
    public var kind: String?
    public var result: String?
    public var mark: TrainingMark
    public var released: Bool
    /// the "I read" chip's state: read, asking, fixed, unread
    public var reading: String?
    public var readMs: Double?
    public var markMs: Double?
}

extension LiveLoop {
    /// The tutor's view of the written line made of `strokes` (the kid's stroke ids on the page on
    /// show). `others`: strokes of the other written lines (a line holding some of them is merged);
    /// strokes it may share a line with without that being a merge (a kid's own tick beside it) are
    /// left out of `others` by the caller.
    public func trainingObserve(strokes: [RecordID], others: Set<String>) -> TrainingObservation {
        let mine = Set(strokes.map(\.rawValue))
        let found = lines.values.filter { !Set($0.ink.strokeIds).isDisjoint(with: mine) }
            .sorted { ($0.column, $0.row) < ($1.column, $1.row) }
        var obs = TrainingObservation(lineIds: found.map(\.id), merged: false, latex: nil, confidence: nil, provider: nil, verdict: nil,
                                      kind: nil, result: nil, mark: .none, released: false, reading: nil, readMs: nil, markMs: nil)
        guard let st = found.first else { return obs }
        obs.merged = found.count == 1 && !Set(st.ink.strokeIds).isDisjoint(with: others)
        // with two or more lines, the one holding most of the strokes speaks for it
        let main = found.max { Set($0.ink.strokeIds).intersection(mine).count < Set($1.ink.strokeIds).intersection(mine).count } ?? st
        obs.latex = main.latex.isEmpty ? nil : main.latex
        obs.confidence = main.latex.isEmpty ? nil : main.confidence
        obs.provider = main.provider == .none ? nil : main.provider.rawValue
        obs.verdict = main.analysis?.verdict
        obs.kind = main.analysis?.kind
        obs.result = main.analysis?.resultLatex.isEmpty == false ? main.analysis?.resultLatex : nil
        obs.mark = trainingMark(on: main.id)
        obs.released = !checksWhenDone || pages.released[main.id] == main.latex
        obs.reading = pages.readings.first { $0.id == main.id }?.state.rawValue
        let last = strokes.last?.rawValue
        obs.readMs = last.flatMap { metrics.readAfterPenUp[$0] } ?? main.ink.strokeIds.compactMap { metrics.readAfterPenUp[$0] }.first
        obs.markMs = last.flatMap { metrics.markAfterPenUp[$0] } ?? main.ink.strokeIds.compactMap { metrics.markAfterPenUp[$0] }.first
        return obs
    }

    /// The line is a stacked sum (one line by design: its rows are no merge).
    public func trainingStacked(_ lineId: String) -> Bool {
        lines[lineId].map(stackLike) ?? false
    }

    /// The tutor's mark on one of its lines (the page on show).
    public func trainingMark(on lineId: String) -> TrainingMark {
        let target = RecordID("line:\(lineId)")
        let screen = board.currentScreenID
        for record in board.store.records.values {
            if case .mark(let m) = record, m.screen == screen, m.target == target { return TrainingMark(m.kind) }
        }
        return .none
    }

    /// The page's problem is solved (the cheer and Next).
    public var trainingSolved: Bool { pages.solved }

    /// Nothing in flight for the page: no read, no ink waiting, no check waiting.
    public var trainingQuiet: Bool {
        reading.isEmpty && pages.applying.isEmpty && dirtyStrokes.isEmpty && pages.pendingCheck == nil && earlyReads.isEmpty
            && !rt.values.contains { $0.readRetryTimer != nil }
    }

    /// Lines on the page still held (read, not checked yet).
    public var trainingHeld: Int {
        lines.values.filter { isHeld($0) }.count
    }
}
