import AgathonBoard
import AgathonBrain
import Foundation

/// What SAT mode needs of the loop (docs/SAT-MODE.md). On an SAT page the tutor starts off and the
/// free tutor's pass is claimed on the student's first ink; the loop then reads what was written
/// while the pass was being asked for, so the first strokes are never lost. And Graph it keeps
/// working without the tutor: a typed equation is graphed on the iPad (the brain), no call made.
extension LiveLoop {
    /// Ink written on the page on show while help was off (the first strokes on an SAT page, before
    /// its pass came back): read now, as if just written. Nothing when help is off.
    public func takeInInk() {
        guard started, settings.enabled else { return }
        let strokes = board.store.kidStrokes(on: board.currentScreenID)
        guard !strokes.isEmpty else { return }
        for s in strokes { dirtyStrokes.insert(s.id) }
        armQuietTimer()
    }

    /// Why a typed graph didn't go on the board.
    public enum TypedGraphResult: Equatable, Sendable {
        case graphed
        /// the engine reads it as no function of x
        case notAFunction
        /// no room left on the page
        case noRoom
    }

    /// "Graph an equation" (SAT mode's panel): `typed` ("y = 2x + 1", "x^2 - 3", "f(x) = 3x") as the
    /// board's own graph object on the page on show, beside the work, in the tutor's colour. On the
    /// iPad alone (the engine's analysis and sketch in the brain): it works with the tutor off.
    @discardableResult
    public func graphTyped(_ typed: String) async -> TypedGraphResult {
        var latex = typed.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "−", with: "-").replacingOccurrences(of: "·", with: "\\cdot ")
        guard !latex.isEmpty else { return .notAFunction }
        if !latex.contains("=") { latex = "y = " + latex }
        guard let analysis = try? await brain.analyzeLine(latex, context: AnalyzeContext(mode: .feedback)),
              analysis.kind == "function", let plot = analysis.plot else { return .notAFunction }
        // an SAT question with a plane: onto it, in its coordinates (SAT v2)
        if graphOntoQuestion(expr: plot.expr, latex: latex, lineId: nil, source: "typed") { return .graphed }
        let sketch = try? await brain.sketchGraph([latex], explicit: true)
        let id = "typed_\(UUID().uuidString.prefix(8).lowercased())"
        let content = Self.graphContent(sketch, plot: plot, latex: latex, lineId: id)
        // beside the top of the work area, else wherever there is room on the page
        let rect = board.screenRect
        let k = rect.w / Box.screen.w
        let top = board.currentProblemPage?.resolvedWorkTop ?? ProblemPageLayout.defaultWorkTop
        let anchor = BrainRect(x: rect.x + ProblemPageLayout.ruleLeft * k, y: rect.y + (top + 40) * k, w: 1, h: 40 * k)
        guard let slot = graphSlot(beside: anchor) ?? graphSlot(beside: BrainRect(x: rect.x + 40 * k, y: rect.y + 40 * k, w: 1, h: 1)) else {
            return .noRoom
        }
        let screen = board.currentScreenID
        let meta: Meta = [LiveMeta.live: true, LiveMeta.source: "typed", LiveMeta.graphFor: .string(latex),
                          LiveMeta.createdAt: .number((Date().timeIntervalSince1970 * 1000).rounded())]
        let record = GraphRecord(screen: screen, order: board.store.nextOrder(on: screen), author: .tutor,
                                 x: slot.x, y: slot.y, w: slot.w, h: slot.h, functions: content.functions, points: content.points,
                                 window: content.window, line: nil, meta: meta)
        board.store.put(.graph(record), origin: .tutor)
        return .graphed
    }
}
