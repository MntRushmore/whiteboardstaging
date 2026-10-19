import AgathonBoard
import AgathonBrain
import Foundation

/// Check when done (docs/PROBLEM-PAGES.md): the tutor reads every line as it is written but says
/// nothing about it until the kid is done — they write in the answer spot, tap Check, stop for a long
/// pause (Auto on), or ask for help. Then every finished line on the page is released and marked: small
/// ticks on right steps, the first real slip ringed with a hint. A line is held again when its reading
/// changes. "As I go" (the grown-ups' switch) is the tutor as it was: every line marked once read.
extension LiveLoop {
    // MARK: - held lines

    var checksWhenDone: Bool { settings.checking == .whenDone }

    /// The line waits for a check: its reading is not the one it was checked at.
    func isHeld(_ st: LiveLine) -> Bool {
        checksWhenDone && !st.latex.isEmpty && pages.released[st.id] != st.latex
    }

    /// What `render` does for a held line: nothing the kid sees but its "I read" — no mark (one from an
    /// earlier reading comes off), no verdict shown, no "Graph it". The learning record hears it when
    /// it is checked.
    func renderHeld(_ st: LiveLine) {
        syncMark(st, nil, learn: false)
        updateVerdict(st, "none")
        withdrawGraphOffer(st.id)
        refreshPage()
    }

    /// Work on the page not checked yet (or still being read).
    func hasUncheckedWork() -> Bool {
        guard checksWhenDone else { return false }
        return lines.values.contains { !$0.latex.isEmpty && isHeld($0) } || !reading.isEmpty || !dirtyStrokes.isEmpty
    }

    // MARK: - checking

    /// Check: the kid says they are done.
    public func checkPage() {
        check(.button)
    }

    /// A check: the lines still being read (or waiting in the quiet gate) are read first, then every
    /// finished line on the page is released and marked.
    func check(_ reason: CheckReason) {
        guard started, settings.enabled, settings.mode != .off else { return }
        pages.pauseTimer?.cancel()
        pages.pauseTimer = nil
        if reason == .answer || reason == .button {
            pages.answerTimer?.cancel()
            pages.answerTimer = nil
        }
        if lines.isEmpty && dirtyStrokes.isEmpty {
            if reason == .button { say(LiveCopy.Pages.nothingToCheck) }
            return
        }
        if !reading.isEmpty || !dirtyStrokes.isEmpty || (rt.values.contains { $0.readRetryTimer != nil }) {
            // the strongest reason waits (a tap beats a pause)
            if pages.pendingCheck == nil || reason == .button { pages.pendingCheck = reason }
            if !dirtyStrokes.isEmpty && !penDown && !board.isPenDown {
                quietTimer?.cancel()
                quietTimer = nil
                pendingRewrite = false
                flush()
            }
            pages.pendingCheckTimer?.cancel()
            pages.pendingCheckTimer = scheduler.after(PageTiming.readWaitMs) { [weak self] in self?.runPendingCheck(force: true) }
            return
        }
        if reason == .button && !connectivity.isOnline && lines.values.contains(where: { $0.latex.isEmpty && $0.provider == .none }) {
            say(LiveCopy.Pages.checkOffline)
        }
        runCheck(reason)
    }

    /// A check that waited for reads: run it once they are in (`force`: the wait ran out).
    func runPendingCheck(force: Bool = false) {
        guard let reason = pages.pendingCheck else { return }
        guard force || (reading.isEmpty && dirtyStrokes.isEmpty && !(rt.values.contains { $0.readRetryTimer != nil })) else { return }
        pages.pendingCheck = nil
        pages.pendingCheckTimer?.cancel()
        pages.pendingCheckTimer = nil
        runCheck(reason)
    }

    /// Releases every finished line on the page and marks it.
    func runCheck(_ reason: CheckReason) {
        let now = scheduler.now
        var released: [LiveLine] = []
        for st in lines.values.sorted(by: { ($0.column, $0.row) < ($1.column, $1.row) }) where !st.latex.isEmpty {
            if unfinished(st, reason: reason, now: now) { continue }
            release(st)
            released.append(st)
        }
        guard !released.isEmpty else {
            if reason == .button { say(LiveCopy.Pages.nothingToCheck) }
            refreshPage()
            return
        }
        // a check is the kid's own ask: with Auto off these lines are marked too
        for st in released { askedLines[st.id] = st.latex }
        for st in released { render(st.id) }
        afterCheck(released.compactMap { lines[$0.id] }, reason: reason)
    }

    /// The line is checked at its reading now (saved on its record, so a board opened again keeps
    /// its marks without a new check).
    func release(_ st: LiveLine) {
        guard pages.released[st.id] != st.latex else { return }
        pages.released[st.id] = st.latex
        persistLine(st.id)
    }

    /// Releases the finished lines of one column (Help me on a line there; a reading fixed there).
    func releaseColumn(_ column: Int, reason: CheckReason) {
        guard checksWhenDone else { return }
        let now = scheduler.now
        for st in columnLines(column) where !st.latex.isEmpty && isHeld(st) && !unfinished(st, reason: reason, now: now) {
            release(st)
            askedLines[st.id] = st.latex
            render(st.id)
        }
    }

    /// A line still being written, or that asks for what comes next: never judged (docs: "Never
    /// judge an unfinished line").
    func unfinished(_ st: LiveLine, reason: CheckReason, now: Double) -> Bool {
        if reading.contains(st.id) || offlineQueue.contains(st.id) { return true }
        if st.analysis?.kind == "incomplete" || LivePolicy.isAnswerStart(st.latex) { return true }
        // `4x =`: the kid has not written its other side (Solve, or the grown-ups' answers, answer it)
        if LivePolicy.endsWithRelation(st.latex) && settings.mode != .answer && !settings.answerOnEquals { return true }
        if (penDown || board.isPenDown) && penLineId == st.id { return true }
        if reason == .pause || reason == .answer {
            let last = st.ink.strokeIds.compactMap { pages.strokeAt[$0] }.max() ?? -.infinity
            if now - last < PageTiming.unfinishedMs { return true }
        }
        return false
    }

    /// After the marks: one hint (the first real slip on the page), a kind word when all is right so
    /// far, Auto's model checks of what the engine could not judge.
    func afterCheck(_ released: [LiveLine], reason: CheckReason) {
        let slip = released.first { st in
            (st.analysis?.verdict == "mismatch" || st.isModelFlagged) && !unsureOfProblem(st) && !pages.ownHeads.contains(st.id)
        }
        if let slip {
            if readingInDoubt(slip) {
                askAboutReading(slip)
            } else if settings.mode == .feedback && hints.isEmpty {
                hint(slip)
            }
        } else if !pages.solved && released.contains(where: { pages.partial.contains($0.id) }) {
            say(LiveCopy.Pages.oneAnswer)
        } else if !pages.solved && !released.contains(where: { $0.analysis?.solved == true }) && reason != .pause {
            let answerSpot = board.currentProblemPage.map { $0.kind == .problem && $0.answer } ?? false
            say(answerSpot ? LiveCopy.Pages.keepGoingAnswer : LiveCopy.Pages.keepGoing)
        }
        autoChecks(column: nil, stopped: true)
        refreshPage()
    }

    // MARK: - triggers

    /// The kid's ink on the page changed (`storeChanged`): the long pause starts again, a stroke in the
    /// answer spot starts its quiet, the chips step aside.
    func pageInk(fresh: StrokeRecord?, changed ids: [String]) {
        let now = scheduler.now
        pages.lastInkAt = now
        for id in ids { pages.strokeAt[id] = now }
        hideChips()
        guard checksWhenDone, settings.enabled, settings.mode != .off else { return }
        pages.pauseTimer?.cancel()
        pages.pauseTimer = settings.auto ? scheduler.after(PageTiming.checkPauseMs) { [weak self] in self?.pauseCheck() } : nil
        if let fresh, inAnswerSpot(StrokeBounds.of(fresh)) {
            pages.answerTimer?.cancel()
            pages.answerTimer = scheduler.after(PageTiming.answerQuietMs) { [weak self] in self?.answerCheck() }
        }
        refreshPage()
    }

    /// A long pause with no ink.
    func pauseCheck() {
        pages.pauseTimer = nil
        guard checksWhenDone, settings.auto, settings.enabled, settings.mode != .off else { return }
        if penDown || board.isPenDown {
            pages.pauseTimer = scheduler.after(1_000) { [weak self] in self?.pauseCheck() }
            return
        }
        guard hasUncheckedWork() else { return }
        check(.pause)
    }

    /// The answer spot has been quiet a moment since a stroke there.
    func answerCheck() {
        pages.answerTimer = nil
        guard checksWhenDone, settings.enabled, settings.mode != .off else { return }
        if penDown || board.isPenDown {
            pages.answerTimer = scheduler.after(500) { [weak self] in self?.answerCheck() }
            return
        }
        check(.answer)
    }

    /// `box` (page units) is written in the page's answer spot.
    func inAnswerSpot(_ box: BrainRect) -> Bool {
        guard let page = board.currentProblemPage, page.kind == .problem, page.answer else { return false }
        let local = ProblemPageLayout.unplace(box.box, from: board.screenRect.box)
        return ProblemPageLayout.isInAnswer(local)
    }

    // MARK: - the page's state

    /// The page on show, its action corner (Check, Next), its chips and its offer, from what the loop
    /// knows now. Cheap; called whenever something it shows may have changed.
    func refreshPage() {
        guard started else { return }
        let page = board.currentProblemPage
        if pages.page != page { pages.page = page }
        let solved = lines.values.contains { st in
            st.analysis?.solved == true && !isHeld(st) && ownHeadAbove(st) == nil && rt[st.id]?.markKey?.hasPrefix("check:") == true
        }
        pages.solved = solved
        let action: PageAction?
        if let page, page.kind == .problem, page.inSet, solved {
            action = .next(last: page.isLast)
        } else if settings.enabled && settings.mode != .off && page?.kind != .done && hasUncheckedWork()
                    && lines.values.contains(where: { !$0.latex.isEmpty }) {
            action = .check
        } else {
            action = nil
        }
        if pages.action != action { pages.action = action }
        refreshReadings()
        refreshOffer()
        if page?.kind == .done { refreshSetProblems() } else if !pages.setProblems.isEmpty { pages.setProblems = [] }
    }

    /// The "I read" chips step aside while the pen writes, and come back a moment after.
    func hideChips() {
        if !pages.chipsHidden { pages.chipsHidden = true }
        pages.chipsTimer?.cancel()
        pages.chipsTimer = scheduler.after(PageTiming.chipsBackMs) { [weak self] in
            guard let self else { return }
            if self.penDown || self.board.isPenDown {
                self.hideChips()
                return
            }
            self.pages.chipsHidden = false
        }
    }
}
