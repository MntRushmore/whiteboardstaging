import AgathonBrain
import Foundation

/// Stacked (column) sums, as the web's board does them (`LiveLoop.stackLike` / `stackAnalysis` /
/// `markRect` in src/lib/live/liveLoop.ts):
///
///        286
///     + 680        one line (the brain's `clusterStrokes` sets the layout aside and groups it), read
///     -----        as `\begin{array}{r} 286 \\ +680 \\ \hline 966 \end{array}` and worked column by
///       966        column by the brain (`stackedLine`) — never judged as a line, never a fraction.
///
/// A right sum is ticked after its answer row, a wrong digit ringed where it sits (only on a read sure
/// of it), a partial answer left alone, a block the engine cannot work left quiet (no "?"). A stack is
/// no step of the column: the lines under it are not judged against it. Before this, the iPad judged
/// the array as a line (the engine cannot) and put a "?" on every stacked sum, right or wrong (the
/// Training Center's `cs-own-ok`).
extension LiveLoop {
    /// The stacked sum in the ink that this line is (its rule is one of the line's strokes), if any.
    func stackOf(_ st: LiveLine) -> AgathonBrain.JSONValue? {
        let ids = Set(st.ink.strokeIds)
        return stacks.first { $0["rule"]?.stringValue.map(ids.contains) ?? false }
    }

    /// The line is a stacked sum, or its read is one (an array with a rule, or a sum's last row over
    /// its answer read as a fraction): the brain works it as a sum, never as a line.
    func stackLike(_ st: LiveLine) -> Bool {
        stackOf(st) != nil || Self.looksStacked(st.latex)
    }

    /// The web's `isStackRead` or `MISREAD_STACK` (src/lib/live/engine/columnWork.ts), as a cheap test
    /// before the brain's own.
    static func looksStacked(_ latex: String) -> Bool {
        let array = latex.range(of: #"^\s*\\begin\{(?:array|aligned|gathered|matrix|tabular)\}"#, options: .regularExpression) != nil
            && latex.range(of: #"\\hline|\\underline"#, options: .regularExpression) != nil
        let fraction = latex.range(of: #"^\s*\\frac\s*\{\s*(?:\+|\\times(?![a-zA-Z])|\\cdot(?![a-zA-Z]))"#, options: .regularExpression) != nil
        return array || fraction
    }

    /// The stacked sum's analysis (and where its marks go), or nil when the line is none.
    func stackedAnalysis(_ st: LiveLine, problem: [String]) async -> LineAnalysis? {
        guard stackLike(st) else {
            stackMarks[st.id] = nil
            return nil
        }
        let stack = stackOf(st)
        guard let r = try? await brain.stackedLine(st.latex, confidence: st.confidence, stack: stack, problem: problem, mode: settings.mode),
              r.stacked else {
            stackMarks[st.id] = nil
            return stack != nil ? LineAnalysis.unknown : nil
        }
        stackMarks[st.id] = (r.tick, r.ring)
        return r.analysis ?? LineAnalysis.unknown
    }

    /// Where a mark of this kind goes on the line: round it or after it — on a stacked sum, after its
    /// answer row and round the first wrong digit (`markRect`).
    func markBox(_ kind: LiveMarks.Kind, _ st: LiveLine) -> BrainRect {
        guard let m = stackMarks[st.id] else { return st.bounds }
        switch kind {
        case .check: return m.tick ?? st.bounds
        case .circle: return m.ring ?? st.bounds
        case .question: return st.bounds
        }
    }
}
