import AgathonBoard
import AgathonBrain
import Foundation

/// "The tutor writes it out" (docs/TUTOR-WRITES.md): when a kid is stuck and asks, the tutor writes the
/// NEXT step of their work in its own blue hand, live, where it belongs — one step per ask, like a
/// teacher at the whiteboard.
///
///  - **Asks.** Help me on Next step, Show me on a hint card (after a ring, or a hint), Ask's "what's
///    next?" (its `help_board`), and Show me on the offer after a long stall. Nothing is written
///    uninvited: the stall only offers.
///  - **One step.** The brain picks it (`tutorStep`, `stackStep`): the step after the kid's last right
///    line (the right one beside a ringed slip), the next column of a stacked sum with its carry, long
///    multiplication's next row. A second ask writes the following step, going on from the tutor's own.
///  - **Right, or nothing.** Every step is checked by the engine before it is written. When the engine
///    has none, the model may propose one (`/api/live/solve`), and it is written only if the engine
///    checks it too (`checkStep`). Otherwise a kind card says the tutor won't guess.
///  - **The answer.** The step that is the final answer is held back ("One step left: …") unless the
///    grown-ups allow answers (Solve it on the dial, or "Show the answer when I write ="); then the
///    card offers Show the answer, a further ask.
///  - **Where.** Under the work, its `=` under the kid's `=`; after the kid's own `=` when their line
///    ends with one; beside a ringed line; a stacked sum's digits in their columns.
///  - **Ink.** Real tutor strokes (cobalt, `InkColor.tutor`) at the hand's natural pace, saved with the
///    board; the kid can rub them out, and the next ask goes on from whatever is left.
extension LiveLoop {
    // MARK: - the ask

    /// The grown-ups allow the tutor to write a final answer.
    var answersAllowed: Bool { settings.mode == .answer || settings.answerOnEquals }

    /// Show me: the next step of the work, in the tutor's hand. `answer`: the kid asked for the answer
    /// itself (the card's Show the answer) — written only when the grown-ups allow answers.
    public func showNextStep(lineId: String? = nil, answer: Bool = false) {
        guard settings.enabled else { return }
        hints.removeAll()
        // the pen is moving already: one step at a time
        if writer?.isWriting == true { return }
        let target = lineId.flatMap { lines[$0] } ?? helpTargetLine()
        if let target, reading.contains(target.id) {
            whenRead(target.id) { [weak self] in self?.showNextStep(lineId: target.id, answer: answer) }
            return
        }
        if let target, needsLook(target), !stackLike(target) {
            syncMark(target, .question, LivePolicy.unjudgedReason(latex: target.latex, confidence: target.confidence, provider: target.provider, analysis: target.analysis) ?? "unread")
            openHint(target, message: LiveCopy.Hint.unread, question: nil, level: 1)
            return
        }
        let askedAt = scheduler.now
        let gen = generation
        // SAT v2 decides its own last step (`beforeWritingSteps`: the question's answer is a pointer there)
        let allow = (answer && answersAllowed) || beforeWritingSteps != nil
        track { [weak self] in
            guard let self else { return }
            if let target, self.stackLike(target) {
                await self.writeStackStep(target, answer: allow, askedAt: askedAt, gen: gen)
            } else {
                await self.writeLineStep(target, answer: allow, askedAt: askedAt, gen: gen)
            }
        }
    }

    /// Runs `then` once the line is read (or after the wait Help me gives a read).
    func whenRead(_ id: String, then: @escaping @MainActor () -> Void) {
        let deadline = scheduler.now + LiveTiming.helpReadWaitMs
        func look() {
            _ = scheduler.after(100) { [weak self] in
                guard let self else { return }
                if self.reading.contains(id) && self.scheduler.now < deadline { look() } else { then() }
            }
        }
        look()
    }

    // MARK: - a line of work

    /// One entry of the work as the brain gets it: a kid's line (with the tutor's inline step after
    /// its `=`), or a step the tutor wrote under it.
    struct WorkEntry {
        var latex: String
        var rect: BrainRect
        /// the kid's line, when it is one
        var line: LiveLine?
        /// where the `=` of a tutor's step is (page x), remembered on its strokes
        var equalsX: Double?
        /// how far it is trusted as read (the messy-handwriting guard); the tutor's own steps are `tutor`
        var trust: TutorStep.Trust = .tutor
    }

    /// How far a kid's line is trusted as read: confirmed (they said so, or typed it), unsure (the
    /// tutor would ask "Is this right?": a low-confidence read, the second opinion disagreeing, a
    /// look-alike letter, an unread line), else sure.
    func readTrust(_ st: LiveLine) -> TutorStep.Trust {
        switch readingState(st) {
        case .fixed: return .confirmed
        case .asking, .unread: return .unsure
        default: return .sure
        }
    }

    /// The tutor's step strokes on this screen, by step (`TutorWrites.stepId`).
    func tutorStepBlocks() -> [(id: String, latex: String, rect: BrainRect, inlineFor: String?, equalsX: Double?)] {
        var byId: [String: (latex: String, rect: BrainRect, inlineFor: String?, equalsX: Double?)] = [:]
        for r in board.store.drawables(on: board.currentScreenID) {
            guard case .stroke(let s) = r, let id = s.meta[TutorWrites.stepId]?.stringValue,
                  let latex = s.meta[TutorWrites.stepMeta]?.stringValue else { continue }
            let b = StrokeBounds.of(s)
            if var cur = byId[id] {
                cur.rect = BrainRect.around([cur.rect, b]) ?? cur.rect
                byId[id] = cur
            } else {
                byId[id] = (latex, b, s.meta[TutorWrites.inlineFor]?.stringValue, s.meta[TutorWrites.equalsX]?.numberValue)
            }
        }
        return byId.map { ($0.key, $0.value.latex, $0.value.rect, $0.value.inlineFor, $0.value.equalsX) }
    }

    /// The work of `target`'s column (or, with nothing written, the page's problem), top to bottom:
    /// the kid's lines and the tutor's steps among them.
    func workEntries(_ target: LiveLine?) -> (problem: ProblemHead?, entries: [WorkEntry]) {
        let column = target?.column
        let head = column.flatMap { self.head(for: $0) } ?? (target == nil ? heads.first : nil)
        var entries: [WorkEntry] = []
        if let column, let target {
            for st in columnLines(column) where !st.latex.isEmpty && st.analysis?.kind != "operation" && st.row <= target.row {
                entries.append(WorkEntry(latex: st.latex, rect: st.bounds, line: st, trust: readTrust(st)))
            }
        }
        // the column's stretch of the page: its lines and its problem
        let span = BrainRect.around(entries.map(\.rect) + (head.map { [$0.rect] } ?? []))
        let top = span?.y ?? 0
        for block in tutorStepBlocks() {
            if let kid = block.inlineFor, let i = entries.firstIndex(where: { $0.line?.id == kid }) {
                entries[i].latex += " \(block.latex)"
                continue
            }
            guard block.inlineFor == nil, let span, block.rect.y >= top - 4,
                  block.rect.x < span.maxX + span.w * 0.25, block.rect.maxX > span.x - 40 else { continue }
            entries.append(WorkEntry(latex: block.latex, rect: block.rect, equalsX: block.equalsX))
        }
        entries.sort { $0.rect.y + $0.rect.h / 2 < $1.rect.y + $1.rect.h / 2 }
        return (head, entries)
    }

    func writeLineStep(_ target: LiveLine?, answer: Bool, askedAt: Double, gen: Int) async {
        let (head, entries) = workEntries(target)
        let problem = head?.lines ?? []
        if entries.isEmpty && problem.isEmpty {
            say(LiveCopy.Help.nothingYet)
            return
        }
        let snapshot = entries.map(\.latex)
        // the messy-handwriting guard: how far each line is trusted as read, and whether the problem is known
        guard let r = try? await brain.tutorStep(problem: problem, work: snapshot, answer: answer, trust: entries.map(\.trust),
                                                 known: beforeWritingSteps != nil),
              gen == generation, workEntries(target).entries.map(\.latex) == snapshot else { return }
        let anchor = entries.last?.rect ?? head?.rect ?? board.screenRect
        let anchorId = target?.id ?? head.map { "work:\($0.id.key)" } ?? "work"
        switch r.kind {
        case .step, .answer:
            await writeChecked(r.step, why: r.why, inline: r.inline, slip: r.slip - problem.count, entries: entries, head: head,
                               target: target, anchorId: anchorId, final: r.kind == .answer, askedAt: askedAt)
        case .lastStep:
            openStepCard(anchorId, anchor: anchor, title: LiveCopy.Writes.lastStepTitle, message: r.why,
                         action: answersAllowed ? .answer : .none)
            if let target { tracker.helped(problem: problemKey(for: target), solved: false) }
        case .readback:
            // a line the step would rest on may be misread: "I read: … Is that right?" first
            let i = (r.readback ?? -1) - problem.count
            if i >= 0, i < entries.count, let line = entries[i].line {
                openReadback(line, reading: MathText.plain(line.latex), target: target, answer: answer)
            } else {
                openStepCard(anchorId, anchor: anchor, title: LiveCopy.Writes.unsureTitle, message: LiveCopy.Writes.unsure, action: .none)
            }
        case .solved:
            say(LiveCopy.Writes.solved)
        case .nothing:
            say(LiveCopy.Help.nothingYet)
        case .unsure:
            // the engine had none: the model may propose one, which the engine must check too
            if await modelStep(entries: entries, problem: problem, head: head, target: target, anchorId: anchorId,
                               from: r.from, answer: answer, askedAt: askedAt, gen: gen) { return }
            guard gen == generation else { return }
            openStepCard(anchorId, anchor: anchor, title: LiveCopy.Writes.unsureTitle, message: LiveCopy.Writes.unsure, action: .none)
        }
    }

    /// The model's first step from the last right line, written only when the engine checks it.
    func modelStep(entries: [WorkEntry], problem: [String], head: ProblemHead?, target: LiveLine?, anchorId: String,
                   from: Int, answer: Bool, askedAt: Double, gen: Int) async -> Bool {
        guard let target, connectivity.isOnline, !inkOut, slowUntil <= scheduler.now,
              let built = buildCheckLines(target.column) else { return false }
        let all = problem + entries.map(\.latex)
        let fromLatex = from >= 0 && from < all.count ? all[from] : (all.last ?? "")
        guard !fromLatex.isEmpty else { return false }
        let request = SolveRequest(boardId: boardId, region: built.region.region, lines: built.lines, fromLineId: target.id, goal: nil)
        count("solve")
        do {
            for try await event in services.solve(request) {
                guard gen == generation, !Task.isCancelled else { return true }
                guard case .step(let s) = event else { continue }
                let step = SolveSteps.unwrapBoxed(s.latex)
                guard let check = try? await brain.checkStep(from: fromLatex, step: step, written: all), check.ok else { continue }
                if check.solved && !answer {
                    openStepCard(anchorId, anchor: entries.last?.rect ?? target.bounds, title: LiveCopy.Writes.lastStepTitle,
                                 message: LiveCopy.Writes.lastStepPlain, action: answersAllowed ? .answer : .none)
                    return true
                }
                await writeChecked(step, why: "", inline: false, slip: -1, entries: entries, head: head, target: target,
                                   anchorId: anchorId, final: check.solved, askedAt: askedAt)
                return true
            }
        } catch {
            Self.log.notice("tutor writes: the model's step failed: \(String(describing: error), privacy: .public)")
        }
        return false
    }

    /// Writes a checked step where it belongs, and its why on a card.
    func writeChecked(_ step: String, why: String, inline: Bool, slip: Int, entries: [WorkEntry], head: ProblemHead?,
                      target: LiveLine?, anchorId: String, final: Bool, askedAt: Double) async {
        // SAT v2 says the step another way when it is the question's answer: nothing is written
        if let ask = beforeWritingSteps, ask([step], why.isEmpty ? nil : why) { return }
        let lineH = Self.lineHeight(entries.compactMap(\.line), fallback: head?.rect.h ?? 44)
        let seed = "\(anchorId):step:\(entries.count)"
        var placed: HandPlan?
        var meta: Meta = [TutorWrites.stepMeta: .string(step), TutorWrites.stepId: .string(UUID().uuidString)]
        if !why.isEmpty { meta[TutorWrites.whyMeta] = .string(why) }
        // after the kid's own `=`, on their line
        if inline, let kid = entries.last?.line {
            if let p = await inlineStep(kid, step, lineHeight: lineH, seed: seed) {
                placed = p
                meta[TutorWrites.inlineFor] = .string(kid.id)
            }
        }
        let written = placed == nil && inline ? "= \(step)" : step
        if placed == nil { meta[TutorWrites.stepMeta] = .string(written) }
        // beside a ringed line: the step that should have been there
        if placed == nil, slip >= 0, slip < entries.count, let wrong = entries[slip].line,
           let plan = await plan([written], lineHeight: lineH, inline: true, seedKey: seed) {
            let k = LivePlacement.inkScale(board.fitZoom)
            let ring = LiveMarks.ringRect(wrong.bounds)
            let candidate = BrainRect(x: ring.maxX + LivePlacement.sideGap * k / 2, y: wrong.bounds.y + wrong.bounds.h / 2 - plan.bounds.h / 2,
                                      w: plan.bounds.w, h: plan.bounds.h)
            let slot = LivePlacement.findFreeSlot(LivePlacement.keepInsideX(candidate, bounds: board.screenRect), avoid: avoidRects(except: wrong.id),
                                                  line: wrong.bounds, prefer: .right, scale: k)
            placed = Self.moved(plan, to: AgathonBrain.Point(x: slot.x, y: slot.y))
            meta[LiveMeta.suggestFor] = .string(wrong.latex)
        }
        // under the work, its `=` under theirs
        if placed == nil {
            placed = await planUnder(written, entries: entries, head: head, lineHeight: lineH, seed: seed, meta: &meta)
        }
        guard let plan = placed else {
            // the hand cannot draw it (a symbol it lacks): typeset under the work
            if let last = entries.last ?? head.map({ WorkEntry(latex: "", rect: $0.rect) }) {
                typeset([written], under: last.rect, column: last.rect, lineId: anchorId, meta: meta)
            }
            return
        }
        let anchorLine = target?.id ?? anchorId
        startHandwriting(plan, lineId: anchorLine, meta: meta) { [weak self] in
            // a long stall after the step: the offer comes again
            self?.armStuck()
        }
        metrics.solveFirstStep.append(scheduler.now - askedAt)
        tutorSteps[board.currentScreenID, default: []].append(written)
        if let target {
            tracker.helped(problem: problemKey(for: target), solved: final)
            learnWrote(target.id, final ? .solve : .step)
        }
        openStepCard(anchorLine, anchor: plan.bounds, title: final ? LiveCopy.Writes.answerTitle : LiveCopy.Writes.stepTitle,
                     message: why.isEmpty ? LiveCopy.Writes.stepPlain : why, action: final ? .none : .next)
    }

    /// The step after the kid's own `=`, on their line: the size of their writing (a fraction's two
    /// storeys counted as one line), its middle level with theirs. Nil when it would run off the page
    /// or into something.
    func inlineStep(_ st: LiveLine, _ step: String, lineHeight: Double, seed: String) async -> HandPlan? {
        guard let p = await plan([step], lineHeight: lineHeight, inline: true, seedKey: "\(seed):inline") else { return nil }
        let ink = st.bounds
        let at = AgathonBrain.Point(x: ink.maxX + LivePlacement.inlineAnswerGap(lineHeight), y: ink.y + ink.h / 2 - p.bounds.h / 2)
        let placed = Self.moved(p, to: at)
        if placed.bounds.maxX > board.screenRect.maxX - LivePlacement.viewportMargin { return nil }
        if avoidRects(except: st.id).contains(where: { $0.intersects(placed.bounds) }) { return nil }
        return placed
    }

    /// The step under the last line of the work, its `=` lined up under the line above's `=`.
    func planUnder(_ step: String, entries: [WorkEntry], head: ProblemHead?, lineHeight: Double, seed: String, meta: inout Meta) async -> HandPlan? {
        guard let plan = await plan([step], lineHeight: lineHeight, inline: true, seedKey: seed) else { return nil }
        let k = LivePlacement.inkScale(board.fitZoom)
        let last = entries.last?.rect ?? head?.rect ?? BrainRect(x: board.screenRect.x + 140, y: board.screenRect.y + 100, w: 200, h: lineHeight)
        let span = BrainRect.around(entries.map(\.rect)) ?? last
        var x = span.x
        // the `=` of the line above (the kid's ink, or the tutor's own step), and of the step
        let aboveEq: Double? = entries.last.flatMap { e in e.line.flatMap { equalsX(of: $0) } ?? e.equalsX }
        let ownEq = await equalsOffset(step, plan: plan, lineHeight: lineHeight, seed: seed)
        if let aboveEq, let ownEq { x = max(board.screenRect.x + LivePlacement.viewportMargin, aboveEq - ownEq) }
        let candidate = BrainRect(x: x, y: last.maxY + LivePlacement.stepGap * k + lineHeight * 0.45, w: plan.bounds.w, h: plan.bounds.h)
        var avoid = avoidRects()
        avoid.append(contentsOf: entries.map(\.rect))
        let kept = LivePlacement.keepOnScreen(candidate, screen: board.screenRect, column: span, sideGap: LivePlacement.sideGap * k)
        let slot = LivePlacement.findFreeSlot(kept, avoid: avoid, line: last, prefer: .below, scale: k)
        if let ownEq { meta[TutorWrites.equalsX] = .number(slot.x + ownEq) }
        return Self.moved(plan, to: AgathonBrain.Point(x: slot.x, y: slot.y))
    }

    /// Where the `=` of a step is from its left edge (page units), in the hand it is written in: the
    /// middle of the gap the `=` makes between its left side alone and its left side with the `=`.
    func equalsOffset(_ step: String, plan: HandPlan, lineHeight: Double, seed: String) async -> Double? {
        let t = step.trimmingCharacters(in: .whitespaces)
        if t.hasPrefix("=") {
            guard let eq = await self.plan(["="], lineHeight: lineHeight, inline: true, seedKey: seed) else { return nil }
            return eq.bounds.w / 2
        }
        guard let i = t.firstIndex(of: "="), i > t.startIndex else { return nil }
        let left = String(t[..<i]).trimmingCharacters(in: .whitespaces)
        guard let a = await self.plan([left], lineHeight: lineHeight, inline: true, seedKey: seed),
              let b = await self.plan(["\(left) ="], lineHeight: lineHeight, inline: true, seedKey: seed) else { return nil }
        return (a.bounds.w + b.bounds.w) / 2 + (b.bounds.w - a.bounds.w) * 0.1
    }

    /// The middle of the kid's `=` in their ink (page x): two short level strokes, one over the other.
    func equalsX(of st: LiveLine) -> Double? {
        let h = max(8, st.bounds.h)
        let strokes = st.ink.strokeIds.compactMap { id -> BrainRect? in
            guard case .stroke(let s)? = board.store[RecordID(id)] else { return nil }
            return StrokeBounds.of(s)
        }
        let flat = strokes.filter { $0.w >= max(6, 2.2 * $0.h) && $0.h <= 0.3 * h && $0.w <= 1.4 * h }
        var best: Double?
        for (i, a) in flat.enumerated() {
            for b in flat[(i + 1)...] {
                let dy = abs((a.y + a.h / 2) - (b.y + b.h / 2))
                let cx = (a.x + a.w / 2, b.x + b.w / 2)
                guard dy >= 0.08 * h, dy <= 0.6 * h, abs(cx.0 - cx.1) <= 0.45 * max(a.w, b.w),
                      min(a.w, b.w) / max(a.w, b.w) >= 0.45 else { continue }
                let x = (cx.0 + cx.1) / 2
                if best == nil || x < best! { best = x }
            }
        }
        return best
    }

    /// A kid's writing height: the median of their lines (a fraction's two storeys halved).
    static func lineHeight(_ lines: [LiveLine], fallback: Double) -> Double {
        let hs = lines.map { $0.latex.contains("\\frac") ? $0.bounds.h * 0.55 : $0.bounds.h }.sorted()
        guard !hs.isEmpty else { return fallback }
        return hs[hs.count / 2]
    }

    // MARK: - a stacked sum

    func writeStackStep(_ target: LiveLine, answer: Bool, askedAt: Double, gen: Int) async {
        guard let stack = stackOf(target) else {
            openStepCard(target.id, anchor: target.bounds, title: LiveCopy.Writes.unsureTitle, message: LiveCopy.Writes.unsureColumns, action: .none)
            return
        }
        // what the tutor has written into this sum already
        let mine = board.store.liveRecords(on: board.currentScreenID, lineId: target.id).compactMap { r -> (key: String, part: String, id: RecordID)? in
            guard let key = r.meta[TutorWrites.stackFor]?.stringValue, let part = r.meta[TutorWrites.stackPart]?.stringValue else { return nil }
            return (key, part, r.id)
        }
        func ask(_ parts: [String]) async -> StackStep? {
            try? await brain.stackStep(latex: target.latex, confidence: target.confidence, stack: stack, tutor: parts, answer: answer,
                                       inkBottom: target.bounds.maxY, zoom: board.fitZoom, lineId: target.id, trust: readTrust(target),
                                       problem: head(for: target.column)?.lines ?? [], known: beforeWritingSteps != nil)
        }
        guard var r = await ask(Array(Set(mine.map(\.part)))), gen == generation, lines[target.id]?.latex == target.latex else { return }
        // the sum was rewritten: the digits the tutor wrote for the old one go
        let stale = mine.filter { $0.key != r.key }
        if !stale.isEmpty {
            board.store.remove(stale.map(\.id), origin: .tutor)
            guard let again = await ask(Array(Set(mine.filter { $0.key == r.key }.map(\.part)))), gen == generation else { return }
            r = again
        }
        switch r.kind {
        case .step, .answer, .fix:
            guard r.writes, liveShapeCount() < LiveLimits.maxLiveShapesPerBoard else { return }
            let final = r.kind == .answer
            writeParts(r.parts, lineId: target.id, key: r.key)
            metrics.solveFirstStep.append(scheduler.now - askedAt)
            tutorSteps[board.currentScreenID, default: []].append(r.parts.map(\.text).joined())
            tracker.helped(problem: problemKey(for: target), solved: final)
            learnWrote(target.id, final ? .solve : .step)
            let anchor = BrainRect.around(r.parts.map { $0.plan.bounds } + [target.bounds]) ?? target.bounds
            openStepCard(target.id, anchor: anchor, title: final ? LiveCopy.Writes.answerTitle : LiveCopy.Writes.stepTitle, message: r.why,
                         action: final || r.kind == .fix ? .none : .next)
        case .lastStep:
            openStepCard(target.id, anchor: target.bounds, title: LiveCopy.Writes.lastStepTitle, message: r.why, action: answersAllowed ? .answer : .none)
        case .hint:
            openStepCard(target.id, anchor: target.bounds, title: LiveCopy.Hint.level(1), message: r.why, action: .none)
        case .readback:
            openReadback(target, reading: r.reading ?? MathText.plain(target.latex), target: target, answer: answer)
        case .solved:
            say(LiveCopy.Writes.solved)
        case .unsure, .nothing:
            openStepCard(target.id, anchor: target.bounds, title: LiveCopy.Writes.unsureTitle, message: r.why.isEmpty ? LiveCopy.Writes.unsureColumns : r.why, action: .none)
        }
    }

    /// Writes a stacked sum's parts one after another (a beat between them), each with its own place on
    /// its strokes, as one pen: Stop finishes the digit begun and leaves the rest.
    func writeParts(_ parts: [StackStep.Part], lineId: String, key: String) {
        cancelHandwriting()
        let chain = ChainPen()
        writer = chain
        writerFor = lineId
        readbacks.removeAll { $0.id == lineId }
        let gap = board.reduceMotion ? 0 : TutorWrites.digitGapMs
        track { [weak self] in
            for (i, part) in parts.enumerated() {
                guard let self, !chain.cancelled else { break }
                let meta: Meta = [LiveMeta.lineId: .string(lineId), TutorWrites.stackFor: .string(key), TutorWrites.stackPart: .string(part.part),
                                  TutorWrites.stepMeta: .string(part.text), TutorWrites.stepId: .string("\(key)|\(part.part)")]
                await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
                    let pen = self.board.write(Self.tutorLines(part.plan), meta: meta) { done.resume() }
                    chain.current = pen
                }
                if i < parts.count - 1, gap > 0 { try? await Task.sleep(for: .milliseconds(Int(gap))) }
            }
            chain.finished = true
            if let self, self.writer === chain {
                self.writer = nil
                self.writerFor = nil
            }
            self?.armStuck()
        }
    }

    // MARK: - the card

    /// The step's words on the tutor's card beside it, with what the kid may ask next.
    func openStepCard(_ lineId: String, anchor: BrainRect, title: String, message: String, action: HintAction) {
        guard !message.isEmpty else { return }
        hints = [HintCard(id: "\(lineId):write:\(message.hashValue)", lineId: lineId, anchor: anchor, title: title, message: message,
                          question: nil, level: 3, action: action)]
    }

    // MARK: - the readback (the messy-handwriting guard)

    /// "I read: 2x + 3 = 17. Is that right?" on the line the step would rest on, before anything is
    /// written: Yes trusts the read and the tutor writes; Fix it opens "Fix what I read", and the step
    /// is written from the fixed line.
    func openReadback(_ line: LiveLine, reading: String, target: LiveLine?, answer: Bool) {
        pendingShowMe = (line.id, target?.id, answer)
        hints = [HintCard(id: "\(line.id):readback", lineId: line.id, anchor: line.bounds, title: LiveCopy.Reading.iRead,
                          message: LiveCopy.Writes.readback(reading), question: LiveCopy.Writes.readbackQuestion, level: 1, action: .readback)]
    }

    /// The card's first button: Got it — or, on a readback, Fix it (the tutor waits for the fix).
    public func cardFirstButton(_ card: HintCard) {
        guard card.action == .readback else {
            dismissHint(card.id)
            return
        }
        hints.removeAll { $0.id == card.id }
        openFix(card.lineId)
    }

    /// The kid confirmed or fixed the line the tutor read back: it writes its step now.
    func resumeShowMe(after lineId: String) {
        guard let p = pendingShowMe, p.readback == lineId else { return }
        pendingShowMe = nil
        showNextStep(lineId: p.lineId.flatMap { lines[$0] != nil ? $0 : nil } ?? lineId, answer: p.answer)
    }

    // MARK: - the offer after a long stall

    /// The kid has stopped on an unfinished problem (Auto on, help not off): the tutor OFFERS the next
    /// step on a card — nothing is written until they tap Show me. Once per state of the work.
    func offerNextStep(_ target: LiveLine?) {
        guard settings.enabled, settings.mode != .off, settings.auto, hints.isEmpty, writer == nil, !inkOut else { return }
        let anchorLine = target
        if let t = anchorLine, t.analysis?.solved == true { return }
        let key = "offer|\(board.currentScreenID)|\(anchorLine.map { autoKey("offer", $0) } ?? "page")"
        guard autoOnce(key) else { return }
        let anchor = anchorLine?.bounds ?? heads.first?.rect ?? board.screenRect
        let id = anchorLine?.id ?? heads.first.map { "work:\($0.id.key)" } ?? "work"
        hints = [HintCard(id: "\(id):offer", lineId: id, anchor: anchor, title: LiveCopy.Writes.offerTitle, message: LiveCopy.Writes.offer,
                          question: nil, level: 1, action: .offer)]
    }
}

/// The meta "the tutor writes it out" stamps on its strokes.
enum TutorWrites {
    /// the step's LaTeX, on every stroke of it
    static let stepMeta = "tutorStep"
    /// one step's strokes share it
    static let stepId = "tutorStepId"
    static let whyMeta = "tutorWhy"
    /// a step written after a kid's line's `=`: that line's id
    static let inlineFor = "tutorInline"
    /// where the step's `=` is (page x): the next step lines up under it
    static let equalsX = "tutorEquals"
    /// a stacked sum's digits: the sum (`+ 286 680`) and the place (`a2`)
    static let stackFor = "stackFor"
    static let stackPart = "stackPart"
    /// between two digits of a stacked sum, a beat
    static let digitGapMs = 200.0
}

/// A stacked sum's parts written one after another, as one pen.
@MainActor
final class ChainPen: TutorPen {
    var current: TutorPen?
    var cancelled = false
    var finished = false
    var isWriting: Bool { !finished && !cancelled }
    var wallMs: Double { current?.wallMs ?? 0 }
    func cancel() {
        cancelled = true
        current?.cancel()
    }
}

/// What the second button on the tutor's card does.
public enum HintAction: Equatable, Sendable {
    /// More help / Show me: the next rung (a ringed line's right step, the next step)
    case more
    /// Next step: the step after the one just written
    case next
    /// Show the answer: the final answer, asked for (the grown-ups allow answers)
    case answer
    /// the offer after a stall: Show me, or Not now
    case offer
    /// only Got it
    case none
    /// "I read: … Is that right?" before the tutor writes: Fix it, or Yes, that's right
    case readback
}

extension LiveCopy {
    /// "The tutor writes it out" (docs/TUTOR-WRITES.md).
    public enum Writes {
        public static let showMe = "Show me"
        public static let nextStep = "Next step"
        public static let showAnswer = "Show the answer"
        public static let notNow = "Not now"
        public static let stepTitle = "Next step"
        public static let answerTitle = "The answer"
        public static let lastStepTitle = "One step left"
        public static let unsureTitle = "Let's look together"
        public static let offerTitle = "Stuck?"
        public static let offer = "I can write the next step for you. Want to see it?"
        public static let stepPlain = "Here's the next step."
        public static let lastStepPlain = "Just one step left. You can do this one."
        public static let solved = "That one's finished. Nice work."
        public static let unsure = "I'm not sure of the next step here, so I won't guess. Try a hint, or ask me in Ask."
        public static let fixIt = "Fix it"
        public static func readback(_ plain: String) -> String { "I read: \(plain)" }
        public static let readbackQuestion = "Is that right? Then I'll write the next step."
        public static let unsureColumns = "I can't line up these columns for sure, so I won't guess. Write the numbers one under the other, then ask again."
    }
}
