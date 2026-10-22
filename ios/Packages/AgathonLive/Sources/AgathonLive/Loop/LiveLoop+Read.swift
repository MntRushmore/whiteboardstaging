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
        guard let before = lines[id] else { return }
        // to a check, the line is still being read until its reading is on it
        pages.applying.insert(id)
        defer { pages.applying.remove(id) }
        // a young hand's read put right (the web's `youngRead`): a wobbly `=` is an `=`, and under a
        // problem of plain numbers an answer's signs are its ink's (`-54` from a wobbly `=` is `= 54`)
        let raw = reread ?? res.latex
        var read = raw
        // a stacked sum read whole as something else, built again from its rows (`stackFromRows`)
        var rowsConfidence: Double?
        if !raw.isEmpty {
            let ids = Set(before.ink.strokeIds)
            let ink = board.store.kidStrokes(on: board.currentScreenID).filter { ids.contains($0.id) }
            // a division bar and the number under it: "divide both sides" (`\div 3`; the web's `barDivisionLatex`)
            let bar = before.ink.strokeIds.contains(where: barStrokeIds.contains)
            read = (try? await brain.youngRead(raw, problem: head(for: before.column)?.lines ?? [], strokes: ink, bar: bar)) ?? raw
            // what a messy read may have been, as the ink shows it (`readAsInkShows`)
            if let v = await readAsInkShows(before, read, ink) { read = v }
            if reread == nil, let built = await stackFromRows(before, read, ink) {
                read = built.latex
                rowsConfidence = built.confidence
            }
        }
        guard var st = lines[id] else { return }
        // ink read in this session: new work for the learning record
        learnFresh(id)
        // the kid's own reading of this ink stands over any read of it ("Fix what I read")
        let fixed = fixedReading(id, hash: st.ink.hash)
        st.latex = fixed ?? read
        st.confidence = fixed != nil ? 1 : reread == nil ? (rowsConfidence ?? res.confidence) : max(res.confidence, LiveLimits.minConfidence)
        st.provider = fixed != nil ? .fixed : reread == nil ? (res.provider == "vision" ? .vision : .mathpix) : .reread
        noteSecondOpinion(id, res, read: st.latex)
        st.updatedAt = scheduler.now
        if st.modelWarned != nil && st.modelWarned != st.latex { st.modelWarned = nil }
        if let (last, up) = st.ink.strokeIds.compactMap({ s in lastPenUpAt[s].map { (s, $0) } }).max(by: { $0.1 < $1.1 }) {
            metrics.readAfterPenUp[last] = scheduler.now - up
        }
        lines[id] = st
        pages.applying.remove(id)
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
    // MARK: - a stacked sum read row by row

    /// A stacked sum in the ink (`stackOf`) whose read is no column sum — Mathpix took the rows for a
    /// fraction (`\frac{18}{26}`, `\frac{627}{\times 243}`, `\frac{13}{+4}`): each row read on its own
    /// (one read a row, only on that disagreement, cached like any read) and the sum built from them,
    /// `\begin{array}{r} 13 \\ +4 \\ \hline 17 \end{array}`. Its confidence is the least sure row's:
    /// a wrong digit is ringed only when every row read is sure (`STACK_RING_CONFIDENCE`), else the sum
    /// is ticked or left quiet. Nil when a row reads as no number, offline, or for long multiplication.
    func stackFromRows(_ st: LiveLine, _ read: String, _ ink: [BrainStroke]) async -> (latex: String, confidence: Double)? {
        guard let stack = stackOf(st), !Self.isColumnRead(read), stack["more"] != .bool(true),
              case .array(let rowValues)? = stack["rows"],
              let answer = stack["answer"]?["rect"].flatMap(Self.rectOf) else { return nil }
        let rects = rowValues.compactMap { $0["rect"].flatMap(Self.rectOf) }
        guard rects.count >= 2, rects.count == rowValues.count else { return nil }
        var skip = Set<String>()
        if let rule = stack["rule"]?.stringValue { skip.insert(rule) }
        if case .array(let marks)? = stack["marks"] { marks.compactMap(\.stringValue).forEach { skip.insert($0) } }
        var rows: [String] = []
        var least = 1.0
        for r in rects + [answer] {
            // the row's strokes: their middles in its band, its operator a little to its left
            let strokes = ink.filter { s in
                guard !skip.contains(s.id), let minX = s.x.min(), let maxX = s.x.max(), let minY = s.y.min(), let maxY = s.y.max() else { return false }
                let cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
                return cy >= r.y - 0.15 * r.h && cy <= r.y + 1.15 * r.h && cx >= r.x - 2 * r.h && cx <= r.x + r.w + 0.5 * r.h
            }
            guard !strokes.isEmpty, let payload = try? await brain.recognizerPayload(strokes) else { return nil }
            let res: RecognizeResponse
            if let hit = cache[payload.hash] {
                res = hit
            } else {
                guard connectivity.isOnline else { return nil }
                await acquireReadSlot()
                count("recognize")
                let reply = try? await services.recognize(RecognizeRequest(boardId: boardId, lineId: st.id, payload: payload))
                releaseReadSlot()
                guard let reply else { return nil }
                cache[payload.hash] = reply
                res = reply
            }
            guard let row = Self.stackRowLatex(res.latex) else { return nil }
            rows.append(row)
            least = min(least, res.confidence)
        }
        guard let last = rows.popLast() else { return nil }
        // the rows as the problem has them: a carry written into the first row's line (`627` for
        // `27`), the operator the kid left out (`18` over `7` for `18 × 7`). Only rows that are the
        // problem's own numbers may ring; any other row-built read is ticked or left quiet
        var confidence = LiveLimits.minConfidence
        if let aligned = Self.alignedToProblem(rows, problem: head(for: st.column)?.lines ?? []) {
            rows = aligned
            // every row sure: a wrong digit may be ringed; else, read enough to tick (not a "?")
            confidence = max(least, LiveLimits.minConfidence)
        }
        Self.log.notice("live: a stacked sum read again row by row")
        return ("\\begin{array}{r} \(rows.joined(separator: " \\\\ ")) \\\\ \\hline \(last) \\end{array}", confidence)
    }

    /// Two rows read from a stacked sum, as the one-line problem `A op B` it works (`27 \times 9`):
    /// each row the problem's number, or that number with one digit before it (a carry written into
    /// the row), the second row's operator its own or else the problem's. Nil when they are not the
    /// problem's numbers.
    static func alignedToProblem(_ rows: [String], problem: [String]) -> [String]? {
        guard rows.count == 2, problem.count == 1 else { return nil }
        let flat = problem[0].replacingOccurrences(of: " ", with: "")
        let ns = flat as NSString
        guard let m = try? NSRegularExpression(pattern: #"^(\d+)(\+|-|\\times|\\cdot|×|x)(\d+)$"#)
            .firstMatch(in: flat, range: NSRange(location: 0, length: ns.length)) else { return nil }
        let a = ns.substring(with: m.range(at: 1)), op = ns.substring(with: m.range(at: 2)), b = ns.substring(with: m.range(at: 3))
        func digits(_ row: String) -> String { row.filter(\.isNumber) }
        func same(_ row: String, _ n: String) -> Bool {
            let d = digits(row)
            return d == n || (d.hasSuffix(n) && d.count == n.count + 1)
        }
        guard same(rows[0], a), same(rows[1], b) else { return nil }
        let own = rows[1].hasPrefix("\\times") ? "\\times " : rows[1].hasPrefix("+") ? "+" : rows[1].hasPrefix("-") ? "-" : nil
        let theirs = op == "+" ? "+" : op == "-" ? "-" : "\\times "
        return [a, (own ?? theirs) + b]
    }

    /// A read that is a column sum already: an array with a rule.
    static func isColumnRead(_ latex: String) -> Bool {
        latex.range(of: #"^\s*\\begin\{(?:array|aligned|gathered)\}"#, options: .regularExpression) != nil
            && latex.range(of: #"\\hline|\\underline"#, options: .regularExpression) != nil
    }

    /// One row of a stacked sum as read: a whole number, its operator before it (`+47`, `\times 243`,
    /// `-6`); nil for anything else.
    static func stackRowLatex(_ latex: String) -> String? {
        var t = latex.replacingOccurrences(of: #"\\(?:mathrm|text)\s*\{\s*([^{}]*)\s*\}"#, with: "$1", options: .regularExpression)
        t = t.replacingOccurrences(of: #"\s+"#, with: "", options: .regularExpression)
        guard let m = t.range(of: #"^(?:\+|-|\\times|\\cdot|×|x)?\d+(?:\.\d+)?$"#, options: .regularExpression), m == t.startIndex..<t.endIndex else { return nil }
        if t.hasPrefix("×") || t.hasPrefix("x") { t = "\\times " + t.dropFirst() }
        else if t.hasPrefix("\\times") { t = "\\times " + t.dropFirst(6) }
        else if t.hasPrefix("\\cdot") { t = "\\times " + t.dropFirst(5) }
        return t
    }

    static func rectOf(_ v: AgathonBrain.JSONValue) -> BrainRect? {
        guard let x = v["x"]?.numberValue, let y = v["y"]?.numberValue, let w = v["w"]?.numberValue, let h = v["h"]?.numberValue, w > 0, h > 0 else { return nil }
        return BrainRect(x: x, y: y, w: w, h: h)
    }

    /// What a messy read of a step may have been, as its ink shows it (`Brain.readVariants`: the minus
    /// her ink starts with that the read left out, a plus written high, her `x` read as `\times`, a side
    /// note behind a left arrow): taken only when the read as given does not follow from the line above
    /// (or from the problem, for the first step under it) and the variant does. It can only take a mark
    /// away — the right step `-5x + 20 - 6x` read `5 x^{+} 20-6 x` was ringed — never make a ring: a kid
    /// who really left the minus out has no minus stroke, and is ringed (MisreadsTests).
    func readAsInkShows(_ st: LiveLine, _ read: String, _ ink: [BrainStroke]) async -> String? {
        let above = previousLine(st)
        let problem = head(for: st.column)?.lines ?? []
        guard above != nil || !problem.isEmpty else { return nil }
        let keep = (above.map { [$0.latex] } ?? []) + problem
        guard let variants = try? await brain.readVariants(read, strokes: ink, keep: keep), !variants.isEmpty else { return nil }
        if await stepFollows(st, above, problem, read) { return nil }
        for v in variants where await stepFollows(st, above, problem, v) {
            Self.log.notice("live: a read taken as its ink shows it")
            return v
        }
        return nil
    }

    /// Would the step follow, read as `latex`: from the line above it, else from the problem's last line.
    func stepFollows(_ st: LiveLine, _ above: LiveLine?, _ problem: [String], _ latex: String) async -> Bool {
        if let above { return await follows(st, above, above.latex, latex) }
        guard let last = problem.last else { return false }
        let mode = settings.mode
        let previous = try? await brain.analyzeLine(last, context: AnalyzeContext(mode: mode))
        let ctx = AnalyzeContext(mode: mode, previous: previous, original: previous)
        guard let a = try? await brain.judgeLine(latex, context: ctx, problem: problem, above: [], slip: nil, beside: false) else { return false }
        return a.verdict == "ok" || a.solved == true
    }

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
              let st = lines[ink.id], st.latex == res.latex, st.provider != .fixed, !stackLike(st) else { return }
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

    /// A line the loop leaves alone, never judged and never a "?" (`ContinuationLine` with nothing
    /// above to go on from).
    static var quiet: LineAnalysis {
        try! JSONDecoder().decode(LineAnalysis.self, from: Data(#"{"kind":"continuation","math":"","resultLatex":"","verdict":"none","note":""}"#.utf8))
    }
}
