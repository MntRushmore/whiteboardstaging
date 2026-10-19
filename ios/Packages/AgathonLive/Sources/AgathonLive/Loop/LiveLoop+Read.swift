import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation

extension LiveLoop {
    // MARK: - reading one line

    /// Reads one line (or, for ink that only moved, puts its marks where it is now). Failures are
    /// handled here, never thrown.
    func processLine(_ ink: InkLine, moveOnly: Bool) {
        let id = ink.id
        var r = rt[id] ?? LineRuntime()
        r.processing += 1
        let ticket = r.processing
        r.unreadableTimer?.cancel()
        r.unreadableTimer = nil
        r.readRetryTimer?.cancel()
        r.readRetryTimer = nil
        rt[id] = r
        lastTouchedLineId = id
        hints.removeAll { $0.lineId == id }
        let screen = board.currentScreenID
        let strokes = board.store.kidStrokes(on: screen).filter { ink.strokeIds.contains($0.id) }
        let gen = generation
        track { [weak self] in
            guard let self else { return }
            let payload: RecognizerPayload?
            do {
                payload = try await self.brain.recognizerPayload(strokes, line: PayloadLine(id: id, strokeIds: ink.strokeIds, bounds: ink.bounds))
            } catch {
                payload = nil
            }
            guard self.current(id, ticket, gen) else { return }
            guard let payload else {
                self.applyUnknown(id)
                return
            }
            let prevHash = self.lines[id]?.ink.hash ?? ""
            let read = !(self.lines[id]?.latex.isEmpty ?? true)
            self.lines[id]?.ink.hash = payload.hash
            if moveOnly && read && (prevHash == payload.hash || prevHash.isEmpty) {
                // the same ink, moved: no read, its marks follow it
                self.persistLine(id)
                self.render(id, quiet: true)
                return
            }
            await self.read(id, ticket: ticket, gen: gen, payload: payload, strokes: strokes)
        }
    }

    /// The line still holds the ink this read was for.
    func current(_ id: String, _ ticket: Int, _ gen: Int) -> Bool {
        gen == generation && rt[id]?.processing == ticket && lines[id] != nil
    }

    func read(_ id: String, ticket: Int, gen: Int, payload: RecognizerPayload, strokes: [BrainStroke]) async {
        // new ink on the line: whatever was in flight for it, and its errors, are stale
        abortLlm(id)
        if case .recognize(let lid)? = lastFailure?.retry, lid == id { clearFailure() }
        rt[id]?.readRefused = false
        rt[id]?.unreadableShown = false
        reading.insert(id)
        let hash = payload.hash
        let started = scheduler.now
        readingLabelTimer?.cancel()
        readingLabelTimer = scheduler.after(LiveTiming.readingLabelDelayMs) { [weak self] in
            guard let self, !self.reading.isEmpty else { return }
            self.readingLabelShown = true
        }
        defer {
            if rt[id]?.processing == ticket && rt[id]?.readRetryTimer == nil { reading.remove(id) }
            if reading.isEmpty {
                readingLabelTimer?.cancel()
                readingLabelShown = false
            }
        }
        // offline, and never read before: it waits for the network
        if !connectivity.isOnline && cache.peek(hash) == nil {
            queueOffline(id)
            return
        }
        // rate limited: it waits out the back-off
        if slowUntil > scheduler.now && cache.peek(hash) == nil {
            queueOffline(id, wait: slowUntil - scheduler.now)
            return
        }
        do {
            let (res, cached) = try await recognize(id, payload: payload, strokes: strokes)
            guard current(id, ticket, gen) else { return }
            reading.remove(id)
            if cached {
                metrics.cacheHits += 1
            } else {
                metrics.recognize.append(scheduler.now - started)
            }
            noteSuccess()
            let accepted = rereads[hash] ?? nil
            await applyRecognition(id, res, reread: accepted)
            if accepted == nil, rereads[hash] == nil, let ink = lines[id]?.ink { secondRead(ink, res) }
        } catch {
            guard current(id, ticket, gen) else { return }
            reading.remove(id)
            readFailed(id, hash: hash, error: error)
            // a check waiting for this read goes on without it
            runPendingCheck()
            refreshPage()
        }
    }

    /// One read: from the cache, else the network (two at a time), with ONE retry carrying a crop
    /// when the server had nothing to fall back on (`needsCrop`).
    func recognize(_ id: String, payload: RecognizerPayload, strokes: [BrainStroke]) async throws -> (RecognizeResponse, Bool) {
        var request = RecognizeRequest(boardId: boardId, lineId: id, payload: payload)
        do {
            // read early (LiveLoop+ReadEarly): its reply, in the cache or on its way, is this read
            if let early = try await earlyReply(payload.hash) { return (early, true) }
        } catch {
            return try await recognizeAgain(after: error, request: request, id: id, hash: payload.hash)
        }
        if let hit = cache[payload.hash] { return (hit, true) }
        await acquireReadSlot()
        defer { releaseReadSlot() }
        if let hit = cache[payload.hash] { return (hit, true) }
        if recognizer == "vision" { request.crop = crop(id) }
        // the second opinion (docs/PROBLEM-PAGES.md): the route reads the crop too, behind its own flag
        if pages.secondOpinion {
            if request.crop == nil { request.crop = crop(id) }
            if request.crop != nil { request.secondOpinion = true }
        }
        count("recognize")
        do {
            let res = try await services.recognize(request)
            cache[payload.hash] = res
            return (res, false)
        } catch {
            return try await recognizeAgain(after: error, request: request, id: id, hash: payload.hash)
        }
    }

    /// A read that failed: ONE more with a crop of the line when the server had nothing to fall
    /// back on (`needsCrop`); any other failure is the read's.
    func recognizeAgain(after error: Error, request: RecognizeRequest, id: String, hash: String) async throws -> (RecognizeResponse, Bool) {
        let failure = LiveFailure.from(error)
        guard case .needsCrop(let down) = failure, request.crop == nil else { throw error }
        if down { recognizer = "vision" }
        guard let crop = crop(id) else { throw LiveFailure.unreadable }
        var request = request
        request.crop = crop
        request.cropOnly = true
        count("recognize")
        let res = try await services.recognize(request)
        cache[hash] = res
        return (res, false)
    }

    func acquireReadSlot() async {
        if readsInFlight < LiveLimits.concurrentReads {
            readsInFlight += 1
            return
        }
        await withCheckedContinuation { readWaiters.append($0) }
    }

    func releaseReadSlot() {
        if readWaiters.isEmpty {
            readsInFlight = max(0, readsInFlight - 1)
        } else {
            readWaiters.removeFirst().resume()
        }
    }

    /// A JPEG of this line's ink (the vision reader, the second reader).
    func crop(_ id: String) -> String? {
        guard let line = lines[id] else { return nil }
        let strokes = line.ink.strokeIds.compactMap { board.store.stroke(RecordID($0)) }
        return InkCrop.dataURL(strokes: strokes, bounds: line.bounds)
    }

    func count(_ route: String) {
        metrics.calls[route, default: 0] += 1
        lastCallAt = scheduler.now
    }

    // MARK: - a read that failed

    func readFailed(_ id: String, hash: String, error: Error) {
        let failure = LiveFailure.from(error)
        switch failure {
        case .offline:
            // the queue reads it again: on reconnect, or on its own if the device says online
            queueOffline(id)
        case .outOfInk, .signedOut:
            rt[id]?.readRefused = true
            fail(error, kind: "recognize", lineId: id, retry: .recognize(lineId: id))
        case .rateLimited(let ms, _):
            fail(error, kind: "recognize", lineId: id, retry: .recognize(lineId: id))
            queueOffline(id, wait: ms)
        case .unreadable:
            applyUnreadable(id)
        case .transient where rt[id]?.readRetriedHash != hash:
            // a blip: the same ink is read once more on its own before the kid hears about it
            rt[id]?.readRetriedHash = hash
            reading.insert(id)
            let ticket = rt[id]?.processing
            rt[id]?.readRetryTimer = scheduler.after(LiveTiming.readRetryMs) { [weak self] in
                guard let self, self.rt[id]?.processing == ticket, let line = self.lines[id] else {
                    self?.reading.remove(id)
                    return
                }
                self.rt[id]?.readRetryTimer = nil
                line.ink.strokeIds.forEach { self.dirtyStrokes.insert($0) }
                self.forceRecognize.insert(id)
                if self.quietTimer == nil { self.armQuietTimer(0) }
            }
        default:
            fail(error, kind: "recognize", lineId: id, retry: .recognize(lineId: id))
            applyFailedRead(id)
        }
        questionIfSettled(id)
    }

    /// The recognizer could not make sense of this ink: after a moment (the kid may still be writing
    /// it), the gentle "?" — no pill, no error: nothing failed that Retry would fix.
    func applyUnreadable(_ id: String) {
        lines[id]?.latex = ""
        lines[id]?.confidence = 0
        lines[id]?.provider = .none
        lines[id]?.analysis = LineAnalysis.unknown
        noteSuccess()
        scheduleUnreadableMark(id)
        persistLine(id)
    }

    /// A read that failed for a reason Retry can fix: keep the line, and the "?" says so on it.
    func applyFailedRead(_ id: String) {
        lines[id]?.latex = ""
        lines[id]?.confidence = 0
        lines[id]?.provider = .none
        lines[id]?.analysis = LineAnalysis.unknown
        if let st = lines[id], settings.mode != .off { syncMark(st, .question, "unread") }
    }

    func applyUnknown(_ id: String) {
        lines[id]?.latex = ""
        lines[id]?.confidence = 0
        lines[id]?.provider = .none
        lines[id]?.analysis = LineAnalysis.unknown
        if let st = lines[id] { syncMark(st, nil) }
    }

    func scheduleUnreadableMark(_ id: String) {
        rt[id]?.unreadableTimer?.cancel()
        let ticket = rt[id]?.processing
        rt[id]?.unreadableTimer = scheduler.after(LiveTiming.unreadableChipMs) { [weak self] in
            guard let self, self.rt[id]?.processing == ticket, self.settings.enabled, let st = self.lines[id] else { return }
            self.rt[id]?.unreadableTimer = nil
            self.rt[id]?.unreadableShown = true
            if self.settings.mode != .off { self.syncMark(st, .question, "unread") }
        }
    }

    // MARK: - the offline queue

    /// The line waits for the network (or the end of a back-off of `wait` ms).
    func queueOffline(_ id: String, wait: Double? = nil) {
        offlineQueue.insert(id)
        refreshActivity()
        if let wait {
            scheduleReplay(after: wait)
        } else if connectivity.isOnline {
            // the device says online but the request dropped: replay on our own, 2, 4, 8, 15 s
            let ms = LiveTiming.offlineReplayMs[min(offlineReplayStep, LiveTiming.offlineReplayMs.count - 1)]
            offlineReplayStep += 1
            scheduleReplay(after: ms)
        }
    }

    func scheduleReplay(after ms: Double) {
        guard offlineReplayTimer == nil else { return }
        offlineReplayTimer = scheduler.after(ms) { [weak self] in
            guard let self else { return }
            self.offlineReplayTimer = nil
            self.refreshActivity()
            guard self.connectivity.isOnline, !self.offlineQueue.isEmpty else { return }
            if self.slowUntil > self.scheduler.now {
                self.scheduleReplay(after: self.slowUntil - self.scheduler.now)
                return
            }
            // the replay rides the next flush, so a kid mid-line keeps their quiet gate
            if self.quietTimer == nil { self.armQuietTimer(0) }
        }
    }

    /// Connectivity changed.
    func setOnline(_ online: Bool) {
        guard online != lastOnline else { return }
        lastOnline = online
        refreshActivity()
        if online { replayOffline() }
    }

    /// Back online: the queued lines are read (through the normal path, cache first), then the
    /// checks and the solve the kid asked for meanwhile run once.
    func replayOffline() {
        absorbOfflineQueue()
        if !dirtyStrokes.isEmpty { armQuietTimer() }
        let checks = pendingChecks
        pendingChecks.removeAll()
        let solve = pendingSolve
        pendingSolve = nil
        guard settings.enabled, settings.mode != .off else { return }
        for (id, asked) in checks {
            guard let st = lines[id], !st.latex.isEmpty else { continue }
            startCheck(column: st.column, focus: id, userAsked: asked)
        }
        if let solve, settings.mode == .answer, lines[solve] != nil { requestSolve(lineId: solve) }
    }

    /// Moves the queue (and lines never read) into the next flush.
    func absorbOfflineQueue() {
        var ids = offlineQueue
        for st in lines.values where st.provider == .none && st.latex.isEmpty && !(rt[st.id]?.readRefused ?? false) { ids.insert(st.id) }
        offlineQueue.removeAll()
        for id in ids {
            guard let st = lines[id] else { continue }
            st.ink.strokeIds.forEach { dirtyStrokes.insert($0) }
            forceRecognize.insert(id)
        }
        refreshActivity()
    }

    // MARK: - successes and failures

    /// A call came back: the network is up, the back-off and an out-of-ink pause are over.
    func noteSuccess() {
        offlineReplayStep = 0
        var changed = false
        if inkOut {
            inkOut = false
            changed = true
        }
        if signedOut {
            signedOut = false
            changed = true
        }
        if case .recognize? = lastFailure?.retry { lastFailure = nil; changed = true }
        if changed || !offlineQueue.isEmpty { refreshActivity() }
        if !offlineQueue.isEmpty && connectivity.isOnline && offlineReplayTimer == nil { scheduleReplay(after: 0) }
    }

    /// A failed call, as the kid sees it: out of ink pauses help, a rate limit slows down, the rest
    /// shows with Retry. Auto's own calls fail without a word.
    func fail(_ error: Error, kind: String, lineId: String?, retry: RetryContext?) {
        let failure = LiveFailure.from(error)
        if case .other("cancelled") = failure { return }
        switch failure {
        case .outOfInk:
            inkOut = true
        case .signedOut:
            signedOut = true
        case .rateLimited(let ms, let fairUse):
            slowUntil = max(slowUntil, scheduler.now + ms)
            slowFairUse = fairUse
            slowTimer?.cancel()
            slowTimer = scheduler.after(ms) { [weak self] in self?.refreshActivity() }
        case .offline:
            break
        default:
            if let lineId, kind != "recognize", autoLines.contains(lineId) {
                Self.log.notice("live: auto \(kind, privacy: .public) failed quietly")
                return
            }
            lastFailure = (failure, retry)
        }
        Self.log.notice("live: \(kind, privacy: .public) failed: \(String(describing: failure), privacy: .public)")
        refreshActivity()
    }

    func clearFailure() {
        lastFailure = nil
        refreshActivity()
    }

    /// The pill's Retry (or the kid's "Try again"): the failed call again.
    public func retry() {
        guard let failure = lastFailure else {
            if slowUntil <= scheduler.now { refreshActivity() }
            return
        }
        lastFailure = nil
        autoLines.removeAll()
        refreshActivity()
        switch failure.retry {
        case .recognize(let id)?:
            recognizeNow(id)
        case .check(let id, let asked, let force)?:
            if let st = lines[id] { startCheck(column: st.column, focus: id, userAsked: asked, forceHint: force) }
        case .solve(let id, let first)?:
            if first { escalate(id) } else { requestSolve(lineId: id) }
        case nil:
            break
        }
    }

    /// "OK" on a trouble line: it goes (the kid just writes on; a read refused again says so again).
    public func dismissTrouble() {
        lastFailure = nil
        if slowFairUse { slowUntil = scheduler.now; slowFairUse = false }
        refreshActivity()
    }

    /// A grown-up sorted the ink out (the billing screens call this): help comes back on.
    public func inkRestored() {
        inkOut = false
        refreshActivity()
        if !offlineQueue.isEmpty { scheduleReplay(after: 0) }
        for st in lines.values where st.latex.isEmpty && (rt[st.id]?.readRefused ?? false) {
            rt[st.id]?.readRefused = false
            st.ink.strokeIds.forEach { dirtyStrokes.insert($0) }
            forceRecognize.insert(st.id)
        }
        if !dirtyStrokes.isEmpty { armQuietTimer() }
    }

    /// Reads one line now, with its current ink (no quiet gate).
    func recognizeNow(_ id: String) {
        guard let st = lines[id] else { return }
        quietTimer?.cancel()
        quietTimer = nil
        pendingRewrite = false
        offlineQueue.remove(id)
        st.ink.strokeIds.forEach { dirtyStrokes.insert($0) }
        forceRecognize.insert(id)
        flush()
    }

    // MARK: - a read in

    func applyRecognition(_ id: String, _ res: RecognizeResponse, reread: String?) async {
        guard var st = lines[id] else { return }
        // ink read in this session: new work for the learning record
        learnFresh(id)
        // the kid's own reading of this ink stands over any read of it ("Fix what I read")
        let fixed = fixedReading(id, hash: st.ink.hash)
        st.latex = fixed ?? reread ?? res.latex
        st.confidence = fixed != nil ? 1 : reread == nil ? res.confidence : max(res.confidence, LiveLimits.minConfidence)
        st.provider = fixed != nil ? .fixed : reread == nil ? (res.provider == "vision" ? .vision : .mathpix) : .reread
        noteSecondOpinion(id, res, read: st.latex)
        st.updatedAt = scheduler.now
        if st.modelWarned != nil && st.modelWarned != st.latex { st.modelWarned = nil }
        if let (last, up) = st.ink.strokeIds.compactMap({ s in lastPenUpAt[s].map { (s, $0) } }).max(by: { $0.1 < $1.1 }) {
            metrics.readAfterPenUp[last] = scheduler.now - up
        }
        lines[id] = st
        tracker.wrote(problem: problemKey(for: st))
        persistLine(id)
        await analyze(column: st.column)
        showReadback(id)
        // a read that lands after the kid stopped (a slow network) is due at once: Auto's check of
        // its column, and in Solve its finish (the settle already ran without it)
        if settled, let st = lines[id] {
            autoChecks(column: st.column)
            autoSolve()
        }
        // a check waiting for the reads goes now, if this was the last
        runPendingCheck()
        refreshPage()
    }

    /// "The tutor saw it": the line's readback shows for a moment.
    func showReadback(_ id: String) {
        // "I read" beside every line instead, when the grown-ups have it on (problem pages)
        if settings.showReadings {
            refreshReadings()
            return
        }
        guard let st = lines[id], !st.latex.isEmpty, settings.mode != .off,
              LivePolicy.decide(policyInput(st)).echo else { return }
        readbacks.removeAll { $0.id == id }
        readbacks.append(Readback(id: id, latex: st.latex, anchor: st.bounds))
        readbackTimers[id]?.cancel()
        readbackTimers[id] = scheduler.after(LiveTiming.readbackMs) { [weak self] in
            self?.readbacks.removeAll { $0.id == id }
            self?.readbackTimers[id] = nil
        }
    }

    // MARK: - the second reader

    /// A read that looks wrong goes to the second reader (`/api/live/reread`) with a crop of its ink
    /// and its column; its answer replaces Mathpix's only when it holds up. Once per ink version,
    /// never offline, never for a read that is not Mathpix's, silent when it fails.
    func secondRead(_ ink: InkLine, _ res: RecognizeResponse) {
        guard engineReady, !ink.hash.isEmpty, res.provider == "mathpix", rereads[ink.hash] == nil, connectivity.isOnline, !inkOut,
              let st = lines[ink.id], st.latex == res.latex, st.provider != .fixed else { return }
        let col = columnLines(st.column).filter { $0.id != st.id && !$0.latex.isEmpty }
        let above = col.filter { $0.row < st.row }.map(\.latex)
        let below = col.filter { $0.row >= st.row }.map(\.latex)
        guard let signal = ReadCheck.trigger(latex: st.latex, confidence: st.confidence, analysis: st.analysis,
                                             strokeCount: ink.strokeIds.count, others: above + below) else { return }
        rereads[ink.hash] = .some(nil)
        guard let crop = crop(ink.id) else { return }
        let id = ink.id
        let hash = ink.hash
        let mathpix = st.latex
        reading.insert(id)
        track { [weak self] in
            guard let self else { return }
            defer { self.reading.remove(id) }
            self.count("reread")
            guard let reply = try? await self.services.reread(RereadRequest(boardId: self.boardId, lineId: id, crop: crop, latex: mathpix, above: above, below: below)),
                  let cur = self.lines[id], cur.ink.hash == hash, cur.latex == mathpix else {
                self.questionIfSettled(id)
                return
            }
            guard let candidate = ReadCheck.candidate(mathpix: mathpix, reread: reply.latex, others: above + below),
                  await self.engineReads(candidate) else {
                Self.log.notice("live: second reader (\(signal, privacy: .public)) kept the read")
                self.questionIfSettled(id)
                return
            }
            self.rereads[hash] = .some(candidate)
            Self.log.notice("live: second reader (\(signal, privacy: .public)) took its read")
            self.rt[id]?.unreadableTimer?.cancel()
            self.rt[id]?.unreadableTimer = nil
            await self.applyRecognition(id, RecognizeResponse(latex: candidate, confidence: max(cur.confidence, LiveLimits.minConfidence), provider: "mathpix"), reread: candidate)
        }
    }

    /// Can the engine read this as maths (`engineReads`, simplified: its kind is not `unknown` or
    /// `text`, or it is a bare answer)?
    func engineReads(_ latex: String) async -> Bool {
        let body = latex.replacingOccurrences(of: #"=\s*\?\s*$"#, with: "= 0", options: .regularExpression)
            .replacingOccurrences(of: #"=\s*$"#, with: "", options: .regularExpression)
        if SolveSteps.isBareAnswer(body) { return true }
        guard let a = try? await brain.analyzeLine(body, context: AnalyzeContext(mode: .answer)) else { return false }
        return a.kind != "unknown" && a.kind != "text"
    }
}

extension LineAnalysis {
    /// What a line that could not be read is.
    static var unknown: LineAnalysis {
        try! JSONDecoder().decode(LineAnalysis.self, from: Data(#"{"kind":"unknown","math":"","resultLatex":"","verdict":"unknown","note":""}"#.utf8))
    }
}
