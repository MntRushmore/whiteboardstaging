import AgathonBoard
import AgathonBrain
import Foundation

extension LiveLoop {
    // MARK: - the tutor's hand

    /// Starts writing a block (one at a time: a new one finishes the last, whole lines only).
    @discardableResult
    func startHandwriting(_ plan: HandPlan, lineId: String, meta extra: Meta = [:], onDone: (() -> Void)? = nil) -> TutorPen {
        cancelHandwriting()
        var meta = extra
        meta[LiveMeta.lineId] = .string(lineId)
        let pen = writeBlock(plan, meta: meta, onDone: onDone)
        if pen.isWriting {
            writer = pen
            writerFor = lineId
        }
        return pen
    }

    /// Writes a plan's lines in the tutor's hand (without taking the solution pen).
    func writeBlock(_ plan: HandPlan, meta: Meta, onDone: (() -> Void)? = nil) -> TutorPen {
        // the tutor writing for a line is its answer: the line's readback makes way
        if let lineId = meta[LiveMeta.lineId]?.stringValue { readbacks.removeAll { $0.id == lineId } }
        var penRef: TutorPen?
        let pen = board.write(Self.tutorLines(plan), meta: meta) { [weak self] in
            guard let self else { return }
            if let p = penRef, self.writer === p {
                self.writer = nil
                self.writerFor = nil
            }
            onDone?()
        }
        penRef = pen
        return pen
    }

    /// A brain hand plan as the board's tutor lines (page coordinates).
    static func tutorLines(_ plan: HandPlan) -> [TutorLine] {
        plan.lines.map { line in
            TutorLine(strokes: line.strokes.sorted { $0.order < $1.order }.map { s in
                TutorStroke(points: s.points.map { FreehandInput(Vec2($0.x + line.x, $0.y + line.y), $0.z) }, weight: s.weight ?? 1)
            }, latex: line.latex)
        }
    }

    /// The tutor puts its pen down: what it began is finished, the rest is not written.
    func cancelHandwriting() {
        let w = writer
        writer = nil
        writerFor = nil
        w?.cancel()
    }

    /// Stops the model calls in flight for a line (its ink changed).
    func abortLlm(_ id: String) {
        rt[id]?.checkTask?.cancel()
        rt[id]?.checkTask = nil
        rt[id]?.solveTask?.cancel()
        rt[id]?.solveTask = nil
    }

    /// The hand for `steps` at the kid's size on this board; nil when the hand cannot draw them all
    /// (the safety interlock: a dropped `\frac` would show wrong maths, so a block is never drawn in part).
    func plan(_ steps: [String], lineHeight: Double, inline: Bool = false, seedKey: String,
              origin: AgathonBrain.Point? = nil, baseline: HandwritingRequest.Baseline? = nil) async -> HandPlan? {
        let request = HandwritingRequest(steps: steps, lineHeight: lineHeight, inline: inline, zoom: board.fitZoom, seedKey: seedKey, origin: origin, baseline: baseline)
        guard let result = try? await brain.layoutHandwriting(request), result.unsupported.isEmpty, let plan = result.plan else { return nil }
        return plan
    }

    static func moved(_ plan: HandPlan, to at: AgathonBrain.Point) -> HandPlan {
        var p = plan
        let dx = at.x - plan.bounds.x, dy = at.y - plan.bounds.y
        p.lines = plan.lines.map { var l = $0; l.x += dx; l.y += dy; return l }
        p.bounds.x = at.x
        p.bounds.y = at.y
        return p
    }

    /// Everything on the screen but this line's own ink: what the tutor's writing keeps clear of.
    func avoidRects(except id: String? = nil) -> [BrainRect] {
        let own = Set(id.flatMap { lines[$0]?.ink.strokeIds } ?? [])
        return board.store.drawables(on: board.currentScreenID).compactMap { r -> BrainRect? in
            if own.contains(r.id.rawValue) { return nil }
            if case .stroke(let s) = r { return StrokeBounds.of(s).expanded(2) }
            if case .math(let m) = r { return BrainRect(x: m.x, y: m.y, w: m.w, h: m.h) }
            return nil
        }
    }

    // MARK: - an answer after the kid's `=`

    /// A line the kid ended with `=` that the engine works out (`36 + 2 =`): in Solve, once the kid
    /// stops (or asks), the answer is written after their `=`, in their line, in the tutor's hand.
    /// True when the answer is (or is about to be) on the page.
    func inlineAnswer(_ st: LiveLine, _ d: LivePolicy.Decision) -> Bool {
        guard engineReady, !d.capped, let a = st.analysis, a.kind == "expression", !a.resultLatex.isEmpty,
              LivePolicy.endsWithRelation(st.latex) else { return false }
        let answer = a.resultLatex
        if hasAnswer(st, answer) { return true }
        guard d.showResult else { return false }
        if writerFor == st.id { return true }
        let id = st.id
        let latex = st.latex
        track { [weak self] in
            guard let self, let plan = await self.inlinePlan(st, answer), self.lines[id]?.latex == latex else { return }
            self.startHandwriting(plan, lineId: id, meta: [LiveMeta.answerFor: .string(latex), LiveMeta.answerLatex: .string(answer)])
            self.tracker.helped(problem: self.problemKey(for: st), solved: true)
            // the learning record: the tutor answered it — the student's ask, or the settle's (Auto)
            self.learnInlineAnswer(self.lines[id] ?? st)
        }
        return true
    }

    func hasAnswer(_ st: LiveLine, _ answer: String) -> Bool {
        board.store.liveRecords(on: board.currentScreenID, lineId: st.id).contains {
            ($0.meta.string(LiveMeta.answerFor) == st.latex && $0.meta.string(LiveMeta.answerLatex) == answer)
                || $0.meta.string(LiveMeta.nextStepFor) == st.latex
        }
    }

    /// Something of the tutor's already follows this line's `=`: its answer, or Help's step after it.
    /// One answer, once.
    func answeredAfterEquals(_ st: LiveLine) -> Bool {
        board.store.liveRecords(on: board.currentScreenID, lineId: st.id).contains {
            $0.meta.string(LiveMeta.answerFor) == st.latex || $0.meta.string(LiveMeta.nextStepFor) == st.latex
        }
    }

    /// The answer on the kid's writing line, after their last glyph, in a hand their size. Nil when it
    /// would run off the screen or into something.
    func inlinePlan(_ st: LiveLine, _ answer: String) async -> HandPlan? {
        let ink = st.bounds
        let text = answer
        guard let placed = await plan([text], lineHeight: ink.h, inline: true, seedKey: "\(st.id):answer",
                                      baseline: HandwritingRequest.Baseline(x: ink.maxX + LivePlacement.inlineAnswerGap(ink.h), baselineY: ink.maxY)) else { return nil }
        if placed.bounds.maxX > board.screenRect.maxX - LivePlacement.viewportMargin { return nil }
        if avoidRects(except: st.id).contains(where: { $0.intersects(placed.bounds) }) { return nil }
        return placed
    }

    // MARK: - the right next step beside a ring

    /// The last line above this one that is not itself wrong: where the work was still right.
    func lastGoodLineAbove(_ st: LiveLine) -> LiveLine? {
        columnLines(st.column).filter { !$0.latex.isEmpty && $0.row < st.row && $0.analysis?.kind != "operation" }
            .last { $0.analysis?.verdict != "mismatch" && !$0.isModelFlagged }
    }

    /// The step that should have come after the last good line, from the engine alone (never one of
    /// the kid's own lines offered back). Nil when the engine cannot say.
    func rightNextStep(_ st: LiveLine) async -> String? {
        let good = lastGoodLineAbove(st)
        let head = head(for: st.column)?.lines ?? []
        // (the first lines of a page that continues a problem: the work went right as far as the
        // page before's last right step, "More room")
        let carried = good == nil ? (carryIn(column: st.column)?.previousLatex).map { [$0] } ?? [] : []
        guard good != nil || !head.isEmpty || !carried.isEmpty else { return nil }
        let column = columnLines(st.column).filter { !$0.latex.isEmpty }
        let upto = good.map { g in column.filter { $0.row <= g.row }.map(\.latex) } ?? []
        let work = head + carried + upto
        let own = Set(column.map { SolveSteps.key($0.latex) })
        guard let local = try? await brain.localSolve(work, options: LocalSolveOptions(targetIndex: work.count - 1, handwriting: true)) else { return nil }
        return local.steps.first { !own.contains(SolveSteps.key($0)) }
    }

    /// Suggest (and Solve): beside a ringed line, the tutor writes the step that should have been
    /// there. An answer, so it waits for the kid to stop unless they asked (`now`). Engine only.
    @discardableResult
    func suggestNextStep(_ id: String, now: Bool = false) -> Bool {
        guard settings.enabled, settings.mode != .off else { return false }
        if !now && settings.mode != .suggest && settings.mode != .answer { return false }
        guard let st = lines[id], !st.latex.isEmpty, !unsureOfProblem(st) else { return false }
        if hasSuggestion(st) || (rt[id]?.stepFor == st.latex && rt[id]?.stepPen?.isWriting == true) { return true }
        if !now && !settled {
            pendingSuggestions.insert(id)
            return true
        }
        if afterMark(id, { [weak self] in self?.suggestNextStep(id, now: now) }) { return true }
        guard liveShapeCount() < LiveLimits.maxLiveShapesPerBoard else { return false }
        rt[id]?.stepFor = st.latex
        let latex = st.latex
        track { [weak self] in
            guard let self else { return }
            guard let step = await self.rightNextStep(st), let cur = self.lines[id], cur.latex == latex,
                  let plan = await self.plan([step], lineHeight: st.bounds.h, seedKey: "\(id):suggest") else {
                if self.rt[id]?.stepFor == latex { self.rt[id]?.stepFor = nil }
                if now { self.escalateWithoutEngine(id) }
                return
            }
            let ink = cur.bounds
            let k = LivePlacement.inkScale(self.board.fitZoom)
            let ring = LiveMarks.ringRect(ink)
            let candidate = BrainRect(x: ring.maxX + LivePlacement.sideGap * k / 2, y: ink.y + ink.h / 2 - plan.bounds.h / 2, w: plan.bounds.w, h: plan.bounds.h)
            let slot = LivePlacement.findFreeSlot(LivePlacement.keepInsideX(candidate, bounds: self.board.screenRect), avoid: self.avoidRects(except: id), line: ink, prefer: .right, scale: k)
            let pen = self.writeBlock(Self.moved(plan, to: AgathonBrain.Point(x: slot.x, y: slot.y)),
                                      meta: [LiveMeta.lineId: .string(id), LiveMeta.suggestFor: .string(latex)])
            if pen.isWriting { self.rt[id]?.stepPen = pen }
            self.tracker.helped(problem: self.problemKey(for: cur), solved: false)
            // the learning record: the tutor wrote the step — unasked beside a ring (Auto), or asked (Help)
            self.learnWrote(id, .step, auto: !now ? true : self.learnAutoFor(id))
        }
        return true
    }

    func hasSuggestion(_ st: LiveLine) -> Bool {
        board.store.liveRecords(on: board.currentScreenID, lineId: st.id).contains { $0.meta.string(LiveMeta.suggestFor) == st.latex }
    }

    /// The engine had no right step for a wrong line the kid asked about: the model's next step
    /// from the last good line.
    func escalateWithoutEngine(_ id: String) {
        guard let st = lines[id] else { return }
        let from = lastGoodLineAbove(st) ?? st
        startSolve(column: st.column, fromLineId: from.id, lineId: from.id, onlyFirstStep: true)
    }

    // MARK: - Help's step after a line's `=`

    /// Stuck on a line ending in `=` the engine works out (`LineAnalysis.nextStep`): its first step,
    /// after their `=`. False when the engine has none.
    func writeNextStep(_ st: LiveLine) -> Bool {
        guard let step = st.analysis?.nextStep, !step.isEmpty else { return false }
        // the line's `=` is answered already (Solve, or the grown-ups' answers): nothing more to write
        if answeredAfterEquals(st) { return true }
        let id = st.id
        track { [weak self] in
            guard let self else { return }
            if let inline = await self.inlinePlan(st, step) {
                self.startHandwriting(inline, lineId: id, meta: [LiveMeta.nextStepFor: .string(st.latex)])
            } else {
                await self.writeSteps(["= \(step)"], for: st, column: st.column, meta: [LiveMeta.nextStepFor: .string(st.latex)])
            }
            self.tracker.helped(problem: self.problemKey(for: st), solved: false)
            self.learnWrote(id, .step)
        }
        return true
    }

    // MARK: - steps under the work

    /// Lays steps out under the kid's work and writes them by hand; typeset when the hand cannot
    /// draw a symbol (or the switch is off). Returns when the writing has started.
    @discardableResult
    func writeSteps(_ steps: [String], for st: LiveLine, column: Int, meta extra: Meta, onDone: (() -> Void)? = nil) async -> Bool {
        guard !steps.isEmpty else { return false }
        let work = columnLines(column).filter { !$0.latex.isEmpty }
        guard let last = work.last ?? lines[st.id] else { return false }
        let span = BrainRect.around(work.map(\.bounds)) ?? last.bounds
        let k = LivePlacement.inkScale(board.fitZoom)
        var avoid = avoidRects()
        avoid.append(contentsOf: work.map(\.bounds))
        if settings.handwriting, let plan = await plan(steps, lineHeight: st.bounds.h, seedKey: st.id) {
            let candidate = BrainRect(x: span.x, y: last.bounds.maxY + LivePlacement.stepGap * k, w: plan.bounds.w, h: plan.bounds.h)
            let placed = LivePlacement.keepOnScreen(candidate, screen: board.screenRect, column: span, sideGap: LivePlacement.sideGap * k)
            let slot = LivePlacement.findFreeSlot(placed, avoid: avoid, line: last.bounds, prefer: placed.x == candidate.x ? .below : .right, scale: k)
            startHandwriting(Self.moved(plan, to: AgathonBrain.Point(x: slot.x, y: slot.y)), lineId: st.id, meta: extra, onDone: onDone)
            return true
        }
        typeset(steps, under: last.bounds, column: span, lineId: st.id, meta: extra)
        onDone?()
        return true
    }

    /// The typeset form: `math` records (role `answer`) under the work, one per step.
    func typeset(_ steps: [String], under lastLine: BrainRect, column: BrainRect, lineId: String, meta extra: Meta) {
        let screen = board.currentScreenID
        var avoid = avoidRects()
        board.store.transact(.tutor) { tx in
            var order = board.store.nextOrder(on: screen)
            for (i, step) in steps.enumerated() {
                let w = Double(max(48, step.count * 13 + 40))
                var rect = BrainRect(x: column.x, y: lastLine.maxY + LivePlacement.stepGap + Double(i) * LivePlacement.stepPitch, w: w, h: 44)
                rect = LivePlacement.keepOnScreen(rect, screen: board.screenRect, column: column, offsetY: Double(i) * LivePlacement.stepPitch)
                rect = LivePlacement.findFreeSlot(rect, avoid: avoid, line: lastLine, prefer: .below)
                avoid.append(rect)
                var meta = extra
                meta[LiveMeta.live] = true
                meta[LiveMeta.source] = "ai"
                meta[LiveMeta.lineId] = .string(lineId)
                meta[LiveMeta.createdAt] = .number((Date().timeIntervalSince1970 * 1000).rounded())
                tx.put(.math(MathRecord(screen: screen, order: order, role: .answer, latex: step, x: rect.x, y: rect.y, w: rect.w, h: rect.h,
                                        fontSize: 24, line: RecordID("line:\(lineId)"), meta: meta)))
                order = OrderKey.after(order)
            }
        }
    }

    /// The tutor's worked output for these lines goes (a new solution replaces the old one): its
    /// blocks and typeset steps, never marks, answers or steps beside rings.
    func clearSolveOutput(_ ids: [String]) {
        let set = Set(ids)
        let gone = board.store.liveDrawables(on: board.currentScreenID).filter { r in
            let m = r.meta
            return set.contains(m.string(LiveMeta.lineId)) && m[LiveMeta.mark] == nil && m[LiveMeta.answerFor] == nil && m[LiveMeta.suggestFor] == nil
        }.map(\.id)
        if !gone.isEmpty { board.store.remove(gone, origin: .tutor) }
    }

    func hasHandSolution(_ id: String, key: String) -> Bool {
        board.store.liveRecords(on: board.currentScreenID, lineId: id).contains { $0.meta.string(LiveMeta.solvedLatex) == key }
    }
}

extension LiveLoop {
    /// The grown-ups' "Clear the tutor's marks": its marks, steps and answers on this screen go
    /// (the kid's work and what the tutor read stay). Not undoable, as on the web.
    public func clearMarks() {
        cancelHandwriting()
        hints = []
        for id in rt.keys {
            rt[id]?.markPen?.cancel()
            rt[id]?.stepPen?.cancel()
            // the marks stay off until the line changes (its key is kept)
            rt[id]?.shownHints.removeAll()
            rt[id]?.escalation = 0
        }
        for id in lines.keys {
            lines[id]?.hintsShown = 0
            lines[id]?.rewritesWithWarn = 0
        }
        let screen = board.currentScreenID
        let tutor = board.store.liveDrawables(on: screen).filter { $0.meta[LiveMeta.lineId]?.stringValue?.hasPrefix("problem:") != true }.map(\.id)
        let marks = board.store.semantic(on: screen).compactMap { r -> RecordID? in
            if case .mark(let m) = r { return m.id }
            return nil
        }
        if !(tutor + marks).isEmpty { board.store.remove(tutor + marks, origin: .tutor) }
        celebrate = CelebrateState()
        settler.reset()
    }
}
