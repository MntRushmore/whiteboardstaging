import AgathonBoard
import AgathonBrain
import Foundation

/// What every bench shares — the in-app auto bench (the real board, a kid's pace), Debug's autowrite and
/// the headless bench (`TrainingBenchTests`: the loop on a test board, the real routes, no UI) — so a case
/// is written in the same places and judged the same way wherever it runs:
///
///  - `origin`: where a line goes on a problem page;
///  - `observe`: what the tutor did with each written line, read off the loop and the board, ready for
///    `TrainingJudge`.
public enum TrainingBench {
    // MARK: - where a line goes

    /// Where a line `ink` (page units, its box at 0, 0) goes on a problem page, in the layout's own units
    /// (1600 × 900): the next guide line under the work so far (`bottom`), the answer spot, the problem
    /// area, or beside the line before (`beside`).
    public static func origin(for ink: [[Vec2]], place: TrainingPlace, dx: Double, workTop: Double, bottom: Double, beside: Box?) -> Vec2 {
        let h = ink.flatMap { $0 }.map(\.y).max() ?? 0
        switch place {
        case .problem:
            return Vec2(ProblemPageLayout.problemOrigin.x + dx, ProblemPageLayout.problemOrigin.y + 10)
        case .answer:
            let a = ProblemPageLayout.answer
            return Vec2(a.x + 210 + dx, a.y + max(4, (a.h - h) / 2))
        case .beside where beside != nil:
            return Vec2(beside!.maxX + 70 + dx, beside!.maxY - h)
        case .work, .beside:
            let rules = ProblemPageLayout.rules(workTop: workTop)
            let g = rules.first { $0 - h + 8 >= bottom + 14 } ?? (bottom + 14 + h - 8)
            return Vec2(140 + dx, g - h + 8)
        }
    }

    // MARK: - what the tutor did

    /// Each written line of `spec` as the tutor took it: `ids[k]` are line k's strokes (empty once rubbed
    /// out: `erased`), observed on `loop` (`trainingObserve`) and not yet judged. A kid's own tick written
    /// beside a line (`beside`, `quiet`) may share that line's tutor line without it being a merge.
    @MainActor
    public static func observe(spec: TrainingCase, ids: [[RecordID]], erased: Set<Int>, loop: LiveLoop) -> [TrainingLineResult] {
        let besideQuiet = Set(spec.lines.indices.filter { spec.lines[$0].place == .beside && spec.lines[$0].expect == .quiet })
        var results: [TrainingLineResult] = []
        for (k, line) in spec.lines.enumerated() {
            var r = TrainingLineResult(index: k, written: line.latex, meaning: line.meaning, expect: line.expect, value: line.value, place: line.place)
            guard k < ids.count, !erased.contains(k) else {
                // rubbed out: nothing to judge (a mark left behind would show on the next line's)
                r.expect = nil
                results.append(r)
                continue
            }
            let others = Set(ids.enumerated().filter { $0.offset != k && !besideQuiet.contains($0.offset) }.flatMap { $0.element.map(\.rawValue) })
            let obs = loop.trainingObserve(strokes: ids[k], others: others)
            r.lineId = obs.lineIds.first
            r.read = obs.latex
            r.provider = obs.provider
            r.confidence = obs.confidence
            r.reading = obs.reading
            r.verdict = obs.verdict
            r.kind = obs.kind
            r.result = obs.result
            r.mark = obs.mark
            r.released = obs.released
            r.readMs = obs.readMs
            r.markMs = obs.markMs
            r.pieces = obs.merged ? 0 : obs.lineIds.count
            if besideQuiet.contains(k) && (obs.merged || obs.lineIds.isEmpty) {
                // a kid's own tick taken in with the line it ticks: as it should be
                r.pieces = 1
                r.mark = .none
            }
            results.append(r)
        }
        return results
    }
}
