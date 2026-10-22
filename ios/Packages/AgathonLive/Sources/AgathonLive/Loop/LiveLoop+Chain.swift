import AgathonBrain
import Foundation

/// Two guards before a ring (the Training Center's bench, 2026-10-22):
///
///  - **a line crossed out** (`StruckLine`) is the kid's "not this one": never judged, never marked,
///    and no step the lines under it follow from;
///  - **a second look before a ring** (the web's `holdRing` / `checkChain`, src/lib/live/liveLoop.ts):
///    the engine says a step does not follow from the line above, and on messy ink that is as often
///    a misread as a slip (a problem's `12` read as `17` rings the right step under it). So when either
///    line is a read of Mathpix's the second reader has not seen, both are read again first, and the
///    ring waits for them (at most `chainHoldMs`). The second look can take a ring back, never move
///    one: a re-read is taken only when it is a near transcription (two characters at most) AND it
///    makes the step follow. Once per pair of inks; never offline.
extension LiveLoop {
    /// how long a ring waits for its second look, at most (the web's `LIVE_TIMING.chainHoldMs`)
    static let chainHoldMs = 4_000.0
    /// a chain re-read may change this many characters of Mathpix's read, no more (`CHAIN_MAX_EDIT`)
    static let chainMaxEdit = 2

    // MARK: - crossed out

    /// The kid crossed this line out (a stroke through its writing, or a read that says so).
    func isStruck(_ st: LiveLine) -> Bool {
        if StruckLine.readStruck(st.latex) { return true }
        let key = st.ink.hash.isEmpty ? st.ink.strokeIds.joined(separator: ",") : st.ink.hash
        if let hit = struckCache[key] { return hit }
        let ids = Set(st.ink.strokeIds)
        let strokes = board.store.kidStrokes(on: board.currentScreenID).filter { ids.contains($0.id) }
        let struck = StruckLine.strike(in: strokes) != nil
        if struckCache.count > LiveLimits.cacheEntries { struckCache.removeAll() }
        struckCache[key] = struck
        return struck
    }

    // MARK: - the second look before a ring

    /// The step this one follows from: the nearest read line above it in its column (no stacked sum,
    /// nothing crossed out).
    func previousLine(_ st: LiveLine) -> LiveLine? {
        columnLines(st.column).last { $0.row < st.row && !$0.latex.isEmpty && !stackLike($0) && !isStruck($0) }
    }

    /// Does this step's ring wait for a second look? Starts it when it is due.
    func holdRing(_ st: LiveLine) -> Bool {
        if stackLike(st) { return false }
        guard let above = previousLine(st), !above.ink.hash.isEmpty, !st.ink.hash.isEmpty else { return false }
        let key = "\(above.ink.hash)|\(st.ink.hash)"
        if chainHolds[st.id] == key { return true }
        if chainsDone.contains(key) || !engineReady || !started || !connectivity.isOnline || inkOut { return false }
        let due = [above, st].filter { $0.provider == .mathpix && rereads[$0.ink.hash] == nil }
        if due.isEmpty { return false }
        chainHolds[st.id] = key
        checkChain(st.id, key, due: due, above: above.id)
        return true
    }

    /// The step and the line it follows, read again side by side (without the column: shown the next
    /// line, a model can make a line "follow" by changing it); the fewest reads that make the step
    /// follow are taken. Then the step is drawn as it reads now (`releaseRing`).
    func checkChain(_ lineId: String, _ key: String, due: [LiveLine], above aboveId: String) {
        let ids = Array(Set(due.map(\.id) + [lineId]))
        let hashes = ids.reduce(into: [String: String]()) { $0[$1] = lines[$1]?.ink.hash }
        ids.forEach { reading.insert($0) }
        let timer = scheduler.after(Self.chainHoldMs) { [weak self] in self?.releaseRing(lineId, key) }
        track { [weak self] in
            guard let self else { return }
            var reads: [(id: String, hash: String, mathpix: String, confidence: Double, latex: String?)] = []
            await withTaskGroup(of: (Int, String?).self) { group in
                for (k, s) in due.enumerated() {
                    guard let crop = self.crop(s.id) else { continue }
                    let request = RereadRequest(boardId: self.boardId, lineId: s.id, crop: crop, latex: s.latex, above: [], below: [])
                    let services = self.services
                    group.addTask { (k, try? await services.reread(request).latex) }
                }
                for await (k, latex) in group {
                    let s = due[k]
                    self.count("reread")
                    self.rereads[s.ink.hash] = .some(nil)
                    guard let latex else { continue }
                    let others = self.columnLines(s.column).filter { $0.id != s.id && !$0.latex.isEmpty }.map(\.latex)
                    var taken: String?
                    if let c = ReadCheck.candidate(mathpix: s.latex, reread: latex, others: others),
                       ReadCheck.distance(c, s.latex) <= Self.chainMaxEdit, await self.engineReads(c) { taken = c }
                    reads.append((s.id, s.ink.hash, s.latex, s.confidence, taken))
                }
            }
            timer.cancel()
            for r in await self.chainFix(lineId, aboveId, reads.map { ($0.id, $0.mathpix, $0.latex) }) {
                guard let read = reads.first(where: { $0.id == r }), let latex = read.latex,
                      let cur = self.lines[r], cur.ink.hash == read.hash, cur.latex == read.mathpix else { continue }
                self.rereads[read.hash] = .some(latex)
                Self.log.notice("live: second look before a ring took its read")
                await self.applyRecognition(r, RecognizeResponse(latex: latex, confidence: max(read.confidence, LiveLimits.minConfidence), provider: "mathpix"),
                                            reread: latex)
            }
            for id in ids where self.lines[id] == nil || self.lines[id]?.ink.hash == hashes[id] { self.reading.remove(id) }
            self.releaseRing(lineId, key)
        }
    }

    /// The fewest of the second look's reads that make the step follow from the line above — one of
    /// them alone first, the line above's before the step's, then both. None: Mathpix's reads stand.
    func chainFix(_ lineId: String, _ aboveId: String, _ reads: [(id: String, mathpix: String, latex: String?)]) async -> [String] {
        guard let step = lines[lineId], let above = lines[aboveId] else { return [] }
        let options = reads.filter { $0.latex != nil && lines[$0.id]?.latex == $0.mathpix }
            .sorted { a, _ in a.id == aboveId }
        var sets = options.map { [$0] }
        if options.count > 1 { sets.append(options) }
        for set in sets {
            func read(_ s: LiveLine) -> String { set.first { $0.id == s.id }?.latex ?? s.latex }
            if await follows(step, above, read(above), read(step)) { return set.map(\.id) }
        }
        return []
    }

    /// Would the step follow from the line above, the two read as given? Judged as `analyze` judges it.
    func follows(_ step: LiveLine, _ above: LiveLine, _ aboveLatex: String, _ stepLatex: String) async -> Bool {
        if ArithmeticTruth.holds(stepLatex, above: aboveLatex) == true { return true }
        let mode = settings.mode
        let column = columnLines(step.column).filter { $0.row < step.row && !$0.latex.isEmpty && !isStruck($0) }
        let lines = column.map { $0.id == above.id ? aboveLatex : $0.latex }
        let problem = head(for: step.column)?.lines ?? (lines.first.map { [$0] } ?? [])
        let previous = try? await brain.analyzeLine(aboveLatex, context: AnalyzeContext(mode: mode))
        let ctx = AnalyzeContext(mode: mode, previous: previous, original: nil)
        guard let a = try? await brain.judgeLine(stepLatex, context: ctx, problem: problem, above: lines, slip: nil, beside: false) else { return false }
        return a.verdict == "ok" || a.solved == true
    }

    /// The second look is over (or took too long): the step is drawn as it reads now.
    func releaseRing(_ lineId: String, _ key: String) {
        guard chainHolds[lineId] == key else { return }
        chainHolds[lineId] = nil
        chainsDone.insert(key)
        if chainsDone.count > LiveLimits.cacheEntries { chainsDone.removeAll() }
        guard started, lines[lineId] != nil else { return }
        render(lineId)
    }
}

extension ReadCheck {
    /// Characters changed between two reads (the web's `readDistance`: an edit distance, spacing and
    /// braces left out).
    public static func distance(_ a: String, _ b: String) -> Int {
        let s = Array(comparable(a)), t = Array(comparable(b))
        var prev = Array(0...t.count)
        for i in 1...max(1, s.count) where !s.isEmpty {
            var row = [i] + Array(repeating: 0, count: t.count)
            for j in stride(from: 1, through: t.count, by: 1) {
                row[j] = min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (s[i - 1] == t[j - 1] ? 0 : 1))
            }
            prev = row
        }
        return prev[t.count]
    }
}
