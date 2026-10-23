import AgathonBoard
import AgathonBrain
import Foundation

extension LiveLoop {
    // MARK: - analysis

    /// Every line of a column analysed by the engine against its column — the last right line above
    /// it (a ringed step is not what the next one is judged against: a fix under a slip is ticked),
    /// the column's first relation, and a problem the tutor wrote above it — then rendered.
    func analyze(column: Int, quiet: Bool = false) async {
        guard engineReady else { return }
        if analyzing.contains(column) {
            analyzeAgain.insert(column)
            return
        }
        analyzing.insert(column)
        defer { analyzing.remove(column) }
        repeat {
            analyzeAgain.remove(column)
            let gen = generation
            let mode = settings.mode
            var previous: LineAnalysis?
            var original: LineAnalysis?
            func take(_ a: LineAnalysis?) {
                guard let a, !["label", "incomplete", "unknown", "operation", "continuation"].contains(a.kind) else { return }
                previous = a
                if original == nil && (a.kind == "equation" || a.kind == "inequality") { original = a }
            }
            // the tutor's problem above the column is its first line
            let columnHead = head(for: column)
            if var head = columnHead {
                if head.analyses.count != head.lines.count {
                    head.analyses = (try? await brain.analyzeColumn(head.lines, mode: mode)) ?? []
                    if let i = heads.firstIndex(where: { $0.id == head.id }) { heads[i].analyses = head.analyses }
                }
                head.analyses.forEach(take)
            }
            // the problem the column works (`arithmeticLines`): the tutor's, else the column's first
            // line; in arithmetic a young student's working is judged against it (`judgeLine`: a lone
            // number is the answer, `14` under `18 + 15 - 19`)
            var problem = columnHead?.lines ?? columnLines(column).first { !$0.latex.isEmpty }.map { [$0.latex] } ?? []
            // the student's lines above, as read, and the step right above when it is a slip
            var above: [String] = []
            var slip: LineAnalysis?
            var changed: [String] = []
            // a line solved the problem above it: a new relation after it starts the kid's own (pages)
            var solvedAbove = false
            // what the student's line above ended in (`400 + 364 = 764` → 764), for a line that goes
            // on from it (`+3 = 767`: `ContinuationLine`)
            var running: String?
            // a page that continues a problem ("More room"): its first column goes on from where the
            // work at the bottom of the page before ended (`LiveLoop+MoreRoom`)
            if let c = carryIn(column: column) {
                previous = c.previous ?? previous
                original = c.original ?? original
                if !c.problem.isEmpty { problem = c.problem }
                above = c.above
                slip = c.slip
                running = c.running
                solvedAbove = c.solvedAbove
            }
            for st in columnLines(column) {
                guard !st.latex.isEmpty else { continue }
                // a line crossed out: never judged, and no step of the column (`LiveLoop+Chain`)
                if isStruck(st) {
                    guard gen == generation, var cur = lines[st.id], cur.latex == st.latex else {
                        analyzeAgain.insert(column)
                        break
                    }
                    if cur.analysis != LineAnalysis.quiet {
                        cur.analysis = LineAnalysis.quiet
                        cur.rewritesWithWarn = 0
                        lines[st.id] = cur
                        changed.append(st.id)
                    }
                    continue
                }
                // a stacked sum: worked as a sum by the brain, never as a line, and no step of the
                // column — the lines under it are not judged against it (`LiveLoop+Stacks`)
                if let s = await stackedAnalysis(st, problem: problem) {
                    guard gen == generation, var cur = lines[st.id], cur.latex == st.latex else {
                        analyzeAgain.insert(column)
                        break
                    }
                    if cur.analysis != s {
                        cur.rewritesWithWarn = s.verdict == "mismatch" ? cur.rewritesWithWarn + (cur.analysis?.verdict == "mismatch" ? 1 : 0) : 0
                        cur.analysis = s
                        lines[st.id] = cur
                        changed.append(st.id)
                    }
                    if s.solved == true { solvedAbove = true }
                    continue
                }
                // a running total (`+3 = 767`) is judged as the child means it, `764 + 3 = 767`; with
                // nothing above to go on from it is never judged (read alone it is `3 = 767`, false)
                let judged: String?
                if let c = ContinuationLine.parse(st.latex) {
                    judged = running.map { ContinuationLine.rewritten(c, after: $0) }
                } else {
                    // a bare number in a problem page's answer spot answers the problem's letter (`LiveLoop+Pages`)
                    judged = judgedForm(st)
                }
                // the grown-ups want answers after `=`: the engine works a sum ended with one out
                // as in Solve (the policy still decides what is shown)
                let lineMode = settings.answerOnEquals && LivePolicy.endsWithRelation(st.latex) ? LiveMode.answer : mode
                let ctx = AnalyzeContext(mode: lineMode, previous: previous, original: original)
                let key = "\(lineMode.rawValue)|\(judged ?? "quiet:" + st.latex)|\(previous?.math ?? "")|\(previous?.kind ?? "")|\(original?.math ?? "")"
                    + "|\(problem.joined(separator: ";"))|\(above.joined(separator: ";"))|\(slip?.math ?? "")"
                var raw: LineAnalysis
                if let hit = analysisCache[key] {
                    raw = hit
                } else if let judged {
                    do {
                        // on a one-line problem's row, after it: the problem's end written again,
                        // then the answer (`3 = 7` after the tutor's `4 +`, the web's `answerBeside`)
                        let beside = columnHead.map { $0.lines.count == 1 && Self.besideProblem(st.bounds, $0.rect) } ?? false
                        raw = try await brain.judgeLine(judged, context: ctx, problem: problem, above: above, slip: slip, beside: beside)
                    } catch {
                        raw = LineAnalysis.unknown
                    }
                    analysisCache[key] = raw
                } else {
                    raw = LineAnalysis.quiet
                    analysisCache[key] = raw
                }
                // never ring a correct line: a true relation of plain numbers (`=431` going on from
                // `767-336` above it too) is at worst quiet, whatever problem the column was judged
                // against (`ArithmeticTruth`)
                // — nor one true as the child means it (two facts side by side, an `=` read as a `-`)
                if raw.verdict == "mismatch",
                   ArithmeticTruth.holds(judged ?? st.latex, above: above.last) == true || ArithmeticTruth.trueAsMeant(judged ?? st.latex) {
                    raw.verdict = "none"
                    raw.carried = nil
                }
                // the page's rules before anything is marked (docs/PROBLEM-PAGES.md; off until they ship)
                let review = await reviewOnPage(st, raw, judged: judged ?? st.latex, solvedAbove: solvedAbove, problem: problem, original: original)
                let a = review.analysis
                if review.ownHead { pages.ownHeads.insert(st.id) } else { pages.ownHeads.remove(st.id) }
                above.append(judged ?? st.latex)
                running = judged.flatMap(ContinuationLine.result(of:))
                // the step right above that is a slip: a label, an operation line, a half-written
                // or unread one in between is no step, and leaves it as it was (the web's `slipAbove`)
                if !["label", "incomplete", "unknown", "operation", "continuation"].contains(a.kind) {
                    slip = a.verdict == "mismatch" || a.carried == true ? a : nil
                }
                guard gen == generation, var cur = lines[st.id], cur.latex == st.latex else {
                    // the line changed while it was analysed: its own read analyses the column again
                    analyzeAgain.insert(column)
                    break
                }
                if cur.analysis != a {
                    let wasWarn = cur.analysis?.verdict == "mismatch"
                    let isWarn = a.verdict == "mismatch"
                    cur.rewritesWithWarn = isWarn ? cur.rewritesWithWarn + (wasWarn ? 1 : 0) : 0
                    cur.analysis = a
                    lines[st.id] = cur
                    changed.append(st.id)
                }
                if review.ownHead {
                    // the kid's own problem: what follows is judged against it, not the page's
                    previous = nil
                    original = nil
                    problem = [st.latex]
                    above = []
                    slip = nil
                    solvedAbove = false
                    take(try? await brain.analyzeLine(judged ?? st.latex, context: AnalyzeContext(mode: mode)))
                } else if !(a.verdict == "mismatch" || a.carried == true || cur.isModelFlagged || review.side) {
                    // a slip is not what the next line follows from, nor side work (a sum beside the
                    // problem, an identity, one root of two)
                    take(a)
                }
                if a.solved == true { solvedAbove = true }
            }
            // how the column ends: the next page of the problem goes on from it ("More room")
            noteColumnEnd(column, PageCarry(previous: previous, original: original, problem: problem, above: above, slip: slip,
                                            running: running, solvedAbove: solvedAbove))
            guard gen == generation else { return }
            for st in columnLines(column) where !st.latex.isEmpty {
                render(st.id, quiet: quiet && !changed.contains(st.id))
            }
            persistProblems()
        } while analyzeAgain.contains(column) && started
    }

    /// Every column again (the engine loaded, the dial moved).
    func analyzeAll(quiet: Bool = false) async {
        for column in Set(lines.values.map(\.column)).sorted() {
            await analyze(column: column, quiet: quiet)
        }
    }

    func reanalyzeAll() {
        analysisCache = LRUCache(capacity: 2_000)
        for i in heads.indices { heads[i].analyses = [] }
        track { [weak self] in await self?.analyzeAll(quiet: true) }
    }

    // MARK: - the policy for a line

    func policyInput(_ st: LiveLine, userAsked: Bool = false, settled: Bool? = nil) -> LivePolicy.Input {
        LivePolicy.Input(
            mode: settings.mode, analysis: st.analysis, confidence: judgedConfidence(st), settled: settled ?? self.settled,
            auto: autoFor(st), userAsked: userAsked, hintsShownForLine: st.hintsShown, openHintCount: hints.count,
            rewritesWithWarn: st.rewritesWithWarn, liveShapeCount: liveShapeCount(), latex: st.latex,
            answerOnEquals: settings.answerOnEquals, held: isHeld(st), checksUnjudged: checksUnjudgedLines)
    }

    func decision(_ st: LiveLine, userAsked: Bool = false, settled: Bool? = nil) -> LivePolicy.Decision {
        LivePolicy.decide(policyInput(st, userAsked: userAsked, settled: settled))
    }

    /// Auto acts on this line: the switch is on, or (off) the kid asked about its problem and it
    /// still reads as it did then.
    func autoFor(_ st: LiveLine) -> Bool {
        settings.auto || askedLines[st.id] == st.latex
    }

    /// The tutor's marks and blocks on the screen (a written block counts once), for the cap.
    func liveShapeCount() -> Int {
        var n = 0
        var blocks = Set<String>()
        for r in board.store.liveDrawables(on: board.currentScreenID) {
            if let b = r.meta["handBlock"]?.stringValue { blocks.insert(b) } else { n += 1 }
        }
        return n + blocks.count
    }

    // MARK: - render: what the tutor puts on a line

    /// The tutor's mark for the line, as the policy says (a tick after a right step, a ring round a
    /// slip, a "?" under the tutor's problem when it cannot judge it), and what follows a ring.
    func render(_ id: String, userAsked: Bool = false, quiet: Bool = false) {
        guard settings.enabled, let st = lines[id] else { return }
        dropStale(st)
        if isHeld(st) {
            // check when done: quiet until the kid is done (the grown-ups' answers after `=` still come)
            let d = decision(st)
            if d.echo && inlineAnswer(st, d) {
                syncMark(st, nil, learn: false)
                updateVerdict(st, "none")
                refreshPage()
                return
            }
            renderHeld(st)
            return
        }
        defer { refreshPage() }
        let d = decision(st, userAsked: userAsked)
        // a right answer Mathpix was unsure of: no "?" while one more look decides (`lookAgainAtUnsureAnswer`)
        if !d.echo && lookAgainAtUnsureAnswer(st) { return }
        if !d.echo {
            if !quiet {
                let why = questionNow(st)
                let unread = why == nil && (rt[id]?.unreadableShown ?? false) && settings.mode != .off && unreadableRead(st)
                // check as I go: no "?" on a line still being written (`stillGrowing`)
                if why != nil || unread, !userAsked, let wait = stillGrowing(st) {
                    syncMark(st, nil, learn: false)
                    renderWhenFinished(id, after: wait)
                } else {
                    syncMark(st, why != nil || unread ? .question : nil, why ?? (unread ? "unread" : nil))
                }
            }
            if unreadableRead(st), !(rt[id]?.unreadableShown ?? false), rt[id]?.unreadableTimer == nil, !quiet {
                scheduleUnreadableMark(id)
            }
            updateVerdict(st, "none")
            return
        }
        // a finished sum wants its answer, not its line read back
        if inlineAnswer(st, d) {
            syncMark(st, nil)
            updateVerdict(st, "none")
            return
        }
        if settings.mode == .off {
            // Off keeps what is on the page: nothing new is marked (the learning record still hears
            // the line, marked as its verdict says)
            learnLine(st, nil)
            updateVerdict(st, "none")
            return
        }
        let auto = autoFor(st)
        var marked = auto || d.capped ? d.badge : LivePolicy.badge(settings.mode, st.analysis)
        // a line the loop cannot place for sure is never ringed: a right answer is never marked wrong
        if marked == "warn" && unsureOfProblem(st) { marked = "none" }
        // nor a stray beside the work (a digit or a mark alone, in a column no problem heads)
        if marked == "warn" && looksLikeStray(st) { marked = "none" }
        // nor a read the tutor is not sure of (it asks first: "Is this right?"), nor a problem of the
        // kid's own (docs/PROBLEM-PAGES.md)
        let doubt = pages.extras && (readingInDoubt(st) || pages.ownHeads.contains(st.id) || st.analysis?.misreadLikely == true)
        if marked == "warn" && doubt { marked = "none" }
        let ring = marked == "warn" || (marked != "ok" && marked != "solved" && st.isModelFlagged && !unsureOfProblem(st) && !doubt)
        // a crossed-out line is never marked
        if isStruck(st) {
            syncMark(st, nil, learn: false)
            updateVerdict(st, "none")
            return
        }
        // a step about to be ringed waits while it and the line above are read again (`holdRing`)
        if ring && holdRing(st) {
            syncMark(st, nil, learn: false)
            updateVerdict(st, "none")
            return
        }
        let tick = marked == "ok" || marked == "solved"
        let why = ring || tick ? nil : questionNow(st)
        // check as I go: no ring and no "?" on a line still being written (`stillGrowing`)
        if ring || why != nil, !userAsked, let wait = stillGrowing(st) {
            syncMark(st, nil, learn: false)
            updateVerdict(st, "none")
            renderWhenFinished(id, after: wait)
            return
        }
        syncMark(st, ring ? .circle : tick ? .check : why != nil ? .question : nil, why)
        updateVerdict(st, ring ? "warn" : marked == "solved" ? "solved" : tick ? "ok" : "none")
        if ring && !quiet && auto { suggestNextStep(id) }
        // a ring is where Help me's hint comes next: the iPad's writer loads now, not at launch
        if ring { hintWriter?.prewarm() }
        if marked == "solved" { problemSolved(st) }
        if tick || ring { tracker.marked(problem: problemKey(for: st), right: tick) }
        if !quiet { offerGraph(st) }
    }

    /// A read Mathpix was unsure of: the "?" is for it (after a moment).
    func unreadableRead(_ st: LiveLine) -> Bool {
        !st.latex.isEmpty && judgedConfidence(st) < LiveLimits.minConfidence
    }

    /// The confidence a line is judged with: Mathpix's, or — a right answer it was unsure of that a
    /// second look read as the same value (`lookAgainAtUnsureAnswer`) — enough to be ticked.
    func judgedConfidence(_ st: LiveLine) -> Double {
        unsureAnswerLooks[st.ink.hash] == .some(true) ? max(st.confidence, LiveLimits.minConfidence) : st.confidence
    }

    /// Under a problem the tutor wrote, a line it cannot judge gets its "?" once the kid has stopped
    /// (silence there reads as a broken tutor). Everywhere else silence stands: kids write labels
    /// and scratch numbers.
    func questionFor(_ st: LiveLine) -> String? {
        guard settings.enabled, settings.mode != .off, head(for: st.column) != nil else { return nil }
        // a stacked sum the engine cannot work is read back, never marked (the web's `stackAnalysis`)
        if stackLike(st) { return nil }
        // nor is a line crossed out
        if isStruck(st) { return nil }
        if rt[st.id]?.readRefused == true || rt[st.id]?.checkTask != nil { return nil }
        if reading.contains(st.id) || offlineQueue.contains(st.id) || pendingChecks[st.id] != nil { return nil }
        if liveShapeCount() >= LiveLimits.maxLiveShapesPerBoard { return nil }
        return LivePolicy.unjudgedReason(latex: st.latex, confidence: judgedConfidence(st), provider: st.provider, analysis: st.analysis)
    }

    func questionNow(_ st: LiveLine) -> String? {
        guard let why = questionFor(st) else { return nil }
        if settled { return why }
        // a "?" already on this line stays through a re-render
        return rt[st.id]?.markKey == LiveMarks.key(.question, st.bounds) ? why : nil
    }

    func questionIfSettled(_ id: String) {
        guard settled, let st = lines[id], let why = questionFor(st) else { return }
        syncMark(st, .question, why)
    }

    // MARK: - marks

    /// Puts the tutor's mark for this line on the board (tick, ring, "?") or takes it off. Written
    /// again only when its kind or the line's place changes; one already on the page with the same
    /// key (after a reload) is kept. With Auto off, nothing is written on a line nobody asked about.
    func syncMark(_ st: LiveLine, _ kind: LiveMarks.Kind?, _ why: String? = nil, learn: Bool = true) {
        // the learning record hears the mark decided, drawn or not (the hand off, Auto off, the cap)
        if learn { learnLine(st, kind) }
        let id = st.id
        var r = rt[id] ?? LineRuntime()
        // (round the line, or after it; a stacked sum's after its answer row, round its wrong digit)
        let want = kind.map { LiveMarks.key($0, markBox($0, st)) }
        if r.markDecided && r.markKey == want { return }
        r.markDecided = true
        r.markKey = want
        r.markPen?.cancel()
        r.markPen = nil
        r.markBusySince = scheduler.now
        rt[id] = r

        let screen = board.currentScreenID
        let store = board.store
        let lineRecord = RecordID("line:\(id)")
        let marks = store.liveRecords(on: screen, lineId: id).filter { !$0.meta.string(LiveMeta.mark).isEmpty }
        let staleStrokes = marks.filter { $0.meta.string(LiveMeta.mark) != want }.map(\.id)
        let staleRecords = store.semantic(on: screen).compactMap { rec -> RecordID? in
            if case .mark(let m) = rec, m.target == lineRecord, m.meta.string(LiveMeta.mark) != want { return m.id }
            return nil
        }
        if !staleStrokes.isEmpty || !staleRecords.isEmpty {
            if marks.contains(where: { $0.meta.string(LiveMeta.mark).hasPrefix("circle:") && $0.meta.string(LiveMeta.mark) != want }) {
                settler.removed(id)
                if kind != .circle { ringWithdrawn(id) }
            }
            store.remove(staleStrokes + staleRecords, origin: .tutor)
        }
        guard let want, let kind, !marks.contains(where: { $0.meta.string(LiveMeta.mark) == want }) else {
            markDone(id, pen: nil)
            return
        }
        guard autoFor(st) else {
            // unasked with Auto off: none written, none remembered, so an ask writes it
            rt[id]?.markKey = nil
            rt[id]?.markDecided = false
            markDone(id, pen: nil)
            return
        }
        if let (last, up) = st.ink.strokeIds.compactMap({ s in lastPenUpAt[s].map { (s, $0) } }).max(by: { $0.1 < $1.1 }) {
            metrics.penUpToMark.append(scheduler.now - up)
            metrics.markAfterPenUp[last] = scheduler.now - up
            for s in st.ink.strokeIds { lastPenUpAt[s] = nil }
        }
        let job = UUID().uuidString
        var meta: Meta = [LiveMeta.lineId: .string(id), LiveMeta.mark: .string(want), LiveMeta.job: .string(job)]
        if kind == .question { meta[LiveMeta.markWhy] = .string(why ?? "unread") }
        // a ring beside one of the tutor's problems keeps off its ink
        let besideHead = head(for: st.column).map(\.rect).flatMap { Self.besideProblem(st.bounds, $0) ? $0 : nil }
        let box = kind == .circle ? LiveMarks.ringBox(markBox(.circle, st), clearOf: besideHead) : markBox(kind, st)
        let line = TutorLine(strokes: LiveMarks.strokes(kind, line: box, lineId: id))
        var penRef: TutorPen?
        penRef = board.write([line], meta: meta) { [weak self] in
            guard let self else { return }
            self.markWritten(lineId: id, job: job, kind: kind, key: want, why: why)
            self.markDone(id, pen: penRef)
        }
        if penRef?.isWriting == true { rt[id]?.markPen = penRef }
        settler.mark(id, kind, line: st.bounds)
    }

    /// The mark's strokes are on the board: its `mark` record says what they mean.
    func markWritten(lineId: String, job: String, kind: LiveMarks.Kind, key: String, why: String?) {
        let screen = board.currentScreenID
        let strokes = board.store.liveRecords(on: screen, lineId: lineId).filter { $0.meta.string(LiveMeta.job) == job }.map(\.id)
        guard !strokes.isEmpty else { return }
        let record = MarkRecord(screen: screen, kind: kind.board, target: RecordID("line:\(lineId)"), strokes: strokes,
                                why: kind == .question ? (why ?? "unread") : (kind == .circle ? "mismatch" : nil),
                                meta: [LiveMeta.mark: .string(key), LiveMeta.lineId: .string(lineId)])
        board.store.put(.mark(record), origin: .tutor)
    }

    /// The line's mark is written (or none was wanted): what waited for it goes now.
    func markDone(_ id: String, pen: TutorPen?) {
        guard var r = rt[id] else { return }
        if let pen, let mine = r.markPen, mine !== pen { return }
        r.markBusySince = 0
        r.markPen = nil
        let next = r.afterMark
        r.afterMark = []
        rt[id] = r
        for fn in next { fn() }
    }

    /// Runs `fn` once the tutor's pen lifts from this line's mark (one pen at a time: the step beside
    /// a ring comes after the ring). False: nothing is being written there, run it now.
    func afterMark(_ id: String, _ fn: @escaping () -> Void) -> Bool {
        guard let r = rt[id], r.markBusySince > 0, scheduler.now - r.markBusySince < LiveTiming.markBusyMaxMs, r.markPen?.isWriting == true else { return false }
        rt[id]?.afterMark.append(fn)
        return true
    }

    // MARK: - celebrations

    /// A mark counted (`MarkSettler`): a cheer, a streak, a burst.
    func verdictLanded(_ id: String, _ kind: LiveMarks.Kind) {
        guard settings.celebrations, let st = lines[id], let outcome = celebrate.mark(id, kind) else { return }
        let rect = LiveMarks.markRect(kind, st.bounds)
        let at = AgathonBrain.Point(x: rect.maxX, y: rect.y + rect.h / 2)
        cheerSeq += 1
        let cheer: Cheer
        switch outcome {
        case .win(let text, let streak, let big):
            let solved = st.analysis?.solved == true
            cheer = Cheer(id: cheerSeq, lineId: id, tone: solved ? .solved : .win, text: solved ? LiveCopy.Cheers.solved : text,
                          streak: streak, big: big || solved, at: at)
        case .miss(let text):
            cheer = Cheer(id: cheerSeq, lineId: id, tone: .miss, text: text, streak: 0, big: false, at: at)
        }
        cheers = Array(cheers.suffix(2)) + [cheer]
        if cheer.big { bigBurst += 1 }
        refreshReadings()
        let cid = cheer.id
        scheduler.after(2_200) { [weak self] in
            self?.cheers.removeAll { $0.id == cid }
            self?.refreshReadings()
        }
    }

    // MARK: - records

    /// The line's `line` record: its strokes, its read and its verdict (origin `.tutor`).
    func persistLine(_ id: String) {
        guard let st = lines[id] else { return }
        let rid = RecordID("line:\(id)")
        var meta: Meta = [LiveMeta.confidence: .number((st.confidence * 1000).rounded() / 1000), LiveMeta.provider: .string(st.provider.rawValue)]
        if !st.ink.hash.isEmpty { meta[LiveMeta.hash] = .string(st.ink.hash) }
        if let w = st.modelWarned { meta[LiveMeta.aiWarnLatex] = .string(w) }
        // checked at, the kid's own reading, the second opinion (problem pages)
        pageMeta(for: id, into: &meta)
        var record = LineRecord(id: rid, screen: board.currentScreenID, strokes: st.ink.strokeIds.map { RecordID($0) }, latex: st.latex,
                                verdict: verdictOf(st), problem: nil, meta: meta)
        if case .line(let old)? = board.store[rid] {
            record.problem = old.problem
            if old == record { return }
        }
        board.store.put(.line(record), origin: .tutor)
    }

    func verdictOf(_ st: LiveLine) -> Verdict {
        if reading.contains(st.id) { return .pending }
        if st.latex.isEmpty { return st.provider == .none && st.analysis == nil ? .pending : .unknown }
        switch LivePolicy.badge(settings.mode == .off ? .feedback : settings.mode, st.analysis) {
        case "ok": return .ok
        case "warn": return .warn
        case "solved": return .solved
        default: return st.isModelFlagged ? .warn : .none
        }
    }

    func updateVerdict(_ st: LiveLine, _ badge: String) {
        let rid = RecordID("line:\(st.id)")
        guard case .line(var rec)? = board.store[rid] else {
            persistLine(st.id)
            return
        }
        let v: Verdict = badge == "ok" ? .ok : badge == "warn" ? .warn : badge == "solved" ? .solved : verdictOf(st)
        guard rec.verdict != v || rec.latex != st.latex else { return }
        rec.verdict = v
        rec.latex = st.latex
        board.store.put(.line(rec), origin: .tutor)
    }

    /// The kid's problems as `problem` records: one per column of their own work (its lines in
    /// order, its first line as the problem), and each line pointing at its problem.
    func persistProblems() {
        let screen = board.currentScreenID
        let store = board.store
        var wanted: [RecordID: ProblemRecord] = [:]
        var lineProblem: [RecordID: RecordID] = [:]
        for column in Set(lines.values.map(\.column)) {
            let col = columnLines(column).filter { !$0.latex.isEmpty }
            guard let first = col.first else { continue }
            let head = head(for: column)
            // (a kid's own problem begun on the page before, continued here: its record is there)
            let carried = head == nil ? carriedProblemRecord(column) : nil
            let pid = head?.id ?? carried ?? RecordID("problem:\(first.id)")
            let ids = col.map { RecordID("line:\($0.id)") }
            if head == nil && carried == nil {
                // (its lines on the problem's other pages stay: "More room")
                let old: [RecordID] = { if case .problem(let p)? = store[pid] { return p.lines } else { return [] } }()
                wanted[pid] = ProblemRecord(id: pid, screen: screen, lines: problemLines(old, here: ids), latex: first.latex, origin: "student")
            } else if case .problem(var p)? = store[pid] {
                p.lines = problemLines(p.lines, here: ids)
                wanted[pid] = p
            }
            for l in ids { lineProblem[l] = pid }
        }
        store.transact(.tutor) { tx in
            for case .problem(let p) in store.semantic(on: screen) where p.origin == "student" && wanted[p.id] == nil {
                tx.remove(p.id)
            }
            for (id, p) in wanted where tx[id] != .problem(p) { tx.put(.problem(p)) }
            for (lid, pid) in lineProblem {
                guard case .line(var l)? = tx[lid], l.problem != pid else { continue }
                l.problem = pid
                tx.put(.line(l))
            }
        }
    }

    /// What the problem a line belongs to is called, for the tracker: the tutor's problem above it,
    /// else the first line of its column.
    func problemKey(for st: LiveLine) -> String {
        if let head = head(for: st.column) { return head.lines.joined(separator: "\n") }
        return columnLines(st.column).first(where: { !$0.latex.isEmpty })?.latex ?? st.latex
    }

    // MARK: - the dial moved up

    /// Into Suggest or Solve: every ringed line gets the right next step written beside it, from
    /// the engine, once the kid has stopped. No model call.
    func checkMismatchesAfterLadderRise() {
        guard engineReady, settings.enabled else { return }
        for st in lines.values where !st.latex.isEmpty && autoFor(st) && (st.analysis?.verdict == "mismatch" || st.isModelFlagged) {
            suggestNextStep(st.id)
        }
    }

    /// Removes the tutor's writing for a line that no longer reads as it did (an answer after its
    /// `=`, a step beside it, its next step).
    func dropStale(_ st: LiveLine) {
        let screen = board.currentScreenID
        let ring = st.analysis?.verdict == "mismatch" || st.isModelFlagged
        let stale = board.store.liveRecords(on: screen, lineId: st.id).filter { r in
            let m = r.meta
            if let a = m[LiveMeta.answerFor]?.stringValue, a != st.latex { return true }
            if let n = m[LiveMeta.nextStepFor]?.stringValue, n != st.latex { return true }
            if let s = m[LiveMeta.suggestFor]?.stringValue, s != st.latex || !ring { return true }
            if let g = m[LiveMeta.graphFor]?.stringValue, g != st.latex { return true }
            return false
        }.map(\.id)
        if !stale.isEmpty {
            if rt[st.id]?.stepFor != st.latex || !ring {
                rt[st.id]?.stepPen?.cancel()
                rt[st.id]?.stepPen = nil
                rt[st.id]?.stepFor = nil
            }
            board.store.remove(stale, origin: .tutor)
        }
    }
}
