import AgathonBoard
import AgathonBrain
import Foundation

/// Trust in reading (docs/PROBLEM-PAGES.md): "I read" beside every read line, quiet; it asks ("Is this
/// right?") only with a reason — the second opinion disagrees, Mathpix's strokes confidence is under
/// 0.99, or a look-alike of one of the page's letters is in the read. A tap opens "Fix what I read":
/// yes it's right, one of the readings it may have been, or typed on the maths keypad. Nothing is ever
/// swapped without a tap. A line the tutor is asking about is never ringed until it is trusted.
extension LiveLoop {
    // MARK: - the chips

    /// How far to trust a line's reading.
    func readingState(_ st: LiveLine) -> LineReading.State {
        if st.provider == .fixed || (pages.confirmed[st.id] != nil && pages.confirmed[st.id] == st.latex) { return .fixed }
        if st.latex.isEmpty || st.confidence < LiveLimits.minConfidence { return .unread }
        if let second = pages.second[st.id], second.read == st.latex, !second.agree { return .asking }
        // Mathpix's own doubt (a read restored from the board, or the second reader's, is trusted as it was)
        if st.provider == .mathpix && st.confidence < PageTiming.askBelowConfidence { return .asking }
        if ReadingContext.asks(st.latex, letters: problemLetters(for: st)) { return .asking }
        return .read
    }

    /// The tutor is not sure it read this line: it never rings it until the kid says.
    func readingInDoubt(_ st: LiveLine) -> Bool {
        let s = readingState(st)
        return s == .asking || s == .unread
    }

    /// "I read" for each read line on the page (and the lines that could not be read).
    func refreshReadings() {
        guard settings.enabled, settings.showReadings, settings.mode != .off else {
            if !pages.readings.isEmpty { pages.readings = [] }
            return
        }
        var out: [LineReading] = []
        for st in lines.values.sorted(by: { ($0.column, $0.row) < ($1.column, $1.row) }) {
            if reading.contains(st.id) || st.ink.strokeIds.isEmpty { continue }
            // nothing read yet (never asked, or waiting for the network): no chip
            if st.latex.isEmpty && st.provider == .none && st.analysis == nil { continue }
            // a lone label or a scratch mark is no line to read back
            if !st.latex.isEmpty, st.analysis?.kind == "label", LivePolicy.isSingleSymbolLatex(st.latex) { continue }
            out.append(LineReading(id: st.id, latex: st.latex, state: readingState(st), anchor: st.bounds, at: chipPoint(st)))
        }
        if pages.readings != out { pages.readings = out }
    }

    /// Where a line's chip goes (page units: its left edge and middle): in a problem page's margin lane,
    /// or after the line's mark when the line runs long; elsewhere just after the mark. In the answer
    /// spot, just after the mark too: the lane's end of that row is the action corner (Check, Next).
    func chipPoint(_ st: LiveLine) -> AgathonBrain.Point {
        let end = max(st.bounds.maxX, LiveMarks.markRect(.check, st.bounds).maxX) + 16
        var x = end
        if let page = board.currentProblemPage, page.kind == .problem, !inAnswerSpot(st.bounds) {
            let lane = ProblemPageLayout.place(Vec2(ProblemPageLayout.laneX, 0), on: board.screenRect.box).x
            x = max(end, lane)
        }
        return AgathonBrain.Point(x: x, y: st.bounds.y + st.bounds.h / 2)
    }

    // MARK: - the second opinion

    /// What the second opinion said of this read (when asked for and the route's flag is on).
    func noteSecondOpinion(_ id: String, _ res: RecognizeResponse, read latex: String) {
        guard let agree = res.agree, let second = res.second else {
            pages.second[id] = nil
            return
        }
        pages.second[id] = (second.latex, agree, latex)
    }

    /// The reading the kid gave for this ink, if any (it stands over any read of the same ink).
    func fixedReading(_ id: String, hash: String) -> String? {
        guard let f = pages.fixed[id], !hash.isEmpty, f.hash == hash else { return nil }
        return f.latex
    }

    // MARK: - Fix what I read

    /// Opens "Fix what I read" on a line: the readings it may have been come in a moment (each read by
    /// the engine as maths; one that follows from the line above first).
    public func openFix(_ lineId: String) {
        guard let st = lines[lineId] else { return }
        let unread = st.latex.isEmpty
        pages.fixing = ReadingFix(id: lineId, latex: st.latex, unread: unread)
        guard !unread else { return }
        let letters = problemLetters(for: st)
        var prior: [String] = []
        if let second = pages.second[lineId], !second.agree { prior.append(second.latex) }
        let reread = st.ink.hash.isEmpty ? nil : (rereads[st.ink.hash] ?? nil)
        let raw = ReadingAlternatives.candidates(st.latex, letters: letters, prior: prior, also: reread.map { [$0] } ?? [])
        let previous = lastGoodLineAbove(st)?.analysis
        track { [weak self] in
            guard let self else { return }
            var follows: [String] = []
            var reads: [String] = []
            for c in raw {
                guard await self.engineReads(c) else { continue }
                if let previous, let a = try? await self.brain.analyzeLine(c, context: AnalyzeContext(mode: .feedback, previous: previous)), a.verdict == "ok" {
                    follows.append(c)
                } else {
                    reads.append(c)
                }
            }
            guard self.pages.fixing?.id == lineId else { return }
            self.pages.fixing?.alternatives = Array((follows + reads).prefix(3))
        }
    }

    public func closeFix() {
        pages.fixing = nil
    }

    /// "Yes, that's right": the reading is trusted (remembered for this line), and judged.
    public func confirmReading(_ lineId: String) {
        pages.fixing = nil
        guard let st = lines[lineId], !st.latex.isEmpty else { return }
        pages.confirmed[lineId] = st.latex
        hints.removeAll { $0.lineId == lineId }
        persistLine(lineId)
        recheck(st)
    }

    /// A reading picked or typed: the line's reading from now on (for this ink), and judged again.
    public func useReading(_ lineId: String, latex: String) {
        pages.fixing = nil
        let reading = latex.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var st = lines[lineId], !reading.isEmpty else { return }
        let hash = st.ink.hash
        st.latex = reading
        st.confidence = 1
        st.provider = .fixed
        st.modelWarned = nil
        st.updatedAt = scheduler.now
        lines[lineId] = st
        if !hash.isEmpty {
            pages.fixed[lineId] = (hash, reading)
            // the same ink read again (a flush, a move) gives this reading, and the second reader keeps it
            cache[hash] = RecognizeResponse(latex: reading, confidence: 1, provider: "mathpix")
            rereads[hash] = .some(reading)
        }
        pages.confirmed[lineId] = nil
        pages.second[lineId] = nil
        rt[lineId]?.unreadableTimer?.cancel()
        rt[lineId]?.unreadableTimer = nil
        rt[lineId]?.unreadableShown = false
        hints.removeAll { $0.lineId == lineId }
        // the learning record: new work (the kid's own reading of their line)
        learnFresh(lineId)
        persistLine(lineId)
        let column = st.column
        track { [weak self] in
            guard let self else { return }
            await self.analyze(column: column)
            if let cur = self.lines[lineId] { self.recheck(cur) }
        }
    }

    /// A reading fixed or confirmed is checked again at once (when done: released, with its column's
    /// finished lines; as I go: marked as any line).
    func recheck(_ st: LiveLine) {
        if checksWhenDone {
            releaseColumn(st.column, reason: .fixed)
            if !isHeld(st) {
                askedLines[st.id] = st.latex
                render(st.id)
            }
        } else {
            render(st.id, userAsked: !settings.auto)
        }
        refreshPage()
    }

    /// A check found a slip on a line the tutor is not sure it read: it asks first (its chip opens
    /// "Is this right?", a card says so). No ring, no help counted.
    func askAboutReading(_ st: LiveLine) {
        guard hints.isEmpty else { return }
        hints = [HintCard(id: "\(st.id):read", lineId: st.id, anchor: st.bounds, title: LiveCopy.Reading.isThisRight,
                          message: LiveCopy.Reading.didIReadThis, question: nil, level: 1)]
    }

    // MARK: - the line record

    /// What a line record keeps of problem pages: the reading it was checked at, the kid's own reading
    /// (and its ink), the reading they confirmed, the second opinion.
    func pageMeta(for id: String, into meta: inout Meta) {
        if let checked = pages.released[id] { meta[PageMeta.checked] = .string(checked) }
        if let f = pages.fixed[id] {
            meta[PageMeta.fixed] = .string(f.latex)
            meta[PageMeta.fixedHash] = .string(f.hash)
        }
        if let c = pages.confirmed[id] { meta[PageMeta.confirmed] = .string(c) }
        if let s = pages.second[id] {
            meta[PageMeta.second] = .string(s.latex)
            meta[PageMeta.agree] = .bool(s.agree)
        }
        if pages.keptHere.contains(id) { meta[PageMeta.keptHere] = .bool(true) }
    }

    /// A board opened (or a page shown again): what its line records say of problem pages comes back.
    /// A line with a mark on the page from before check-when-done counts as checked (its marks stay).
    func restorePageState(_ l: LineRecord, key: String, latex: String, marked: Bool) {
        if let checked = l.meta[PageMeta.checked]?.stringValue {
            pages.released[key] = checked
        } else if marked && !latex.isEmpty {
            pages.released[key] = latex
        }
        if let f = l.meta[PageMeta.fixed]?.stringValue, let h = l.meta[PageMeta.fixedHash]?.stringValue { pages.fixed[key] = (h, f) }
        if let c = l.meta[PageMeta.confirmed]?.stringValue { pages.confirmed[key] = c }
        if let s = l.meta[PageMeta.second]?.stringValue, let agree = l.meta[PageMeta.agree]?.boolValue { pages.second[key] = (s, agree, latex) }
        if l.meta[PageMeta.keptHere]?.boolValue == true { pages.keptHere.insert(key) }
    }
}
