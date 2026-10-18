import AgathonBoard
import AgathonBrain
import Foundation

extension LiveLoop {
    // MARK: - the board's changes

    func storeChanged(_ change: ChangeSet) {
        guard started else { return }
        let screen = board.currentScreenID
        switch change.origin {
        case .load:
            // a whole board opened: its lines come back from their records
            resetRuntime()
            screenSeen = board.currentScreenID
            rebuild()
            return
        case .tutor, .remote, .system:
            noteTutorChanges(change, screen: screen)
            return
        case .kid, .history:
            break
        }
        guard settings.enabled else { return }

        var penUp = false
        var inkChanged = false
        var erased = false
        var finished: [StrokeRecord] = []
        var fresh: StrokeRecord?
        var touched: [BrainRect] = []
        var touchedIds = Set<String>()
        for (id, record) in change.added {
            guard case .stroke(let s) = record, s.author == .kid, s.screen == screen else { continue }
            dirtyStrokes.insert(id.rawValue)
            finished.append(s)
            penUp = true
            touched.append(StrokeBounds.of(s))
            // a fresh stroke of the pen (not one brought back by Undo): Help follows it
            if change.origin == .kid {
                penStrokeId = id.rawValue
                lastPenUpAt[id.rawValue] = scheduler.now
                fresh = s
            }
        }
        for (id, update) in change.updated {
            guard case .stroke(let s) = update.after, s.author == .kid, s.screen == screen else { continue }
            dirtyStrokes.insert(id.rawValue)
            inkChanged = true
            touchedIds.insert(id.rawValue)
            touched.append(StrokeBounds.of(s))
        }
        for (id, record) in change.removed {
            switch record {
            case .stroke(let s) where s.author == .kid && s.screen == screen:
                if let line = lineOfStroke(id.rawValue) {
                    line.ink.strokeIds.forEach { dirtyStrokes.insert($0) }
                }
                dirtyStrokes.insert(id.rawValue)
                erased = true
                touchedIds.insert(id.rawValue)
            case .stroke(let s) where s.author == .tutor:
                // the kid rubbed out a mark of the tutor's: a ring waiting to count no longer does
                let lineId = s.meta.string(LiveMeta.lineId)
                if !s.meta.string(LiveMeta.mark).isEmpty, !lineId.isEmpty { settler.removed(lineId) }
            default:
                break
            }
        }
        guard penUp || inkChanged || erased else { return }
        // early reads of a line this ink is in are stopped; a fresh stroke may start one sooner
        earlyInkChanged(boxes: touched, ids: touchedIds)
        if let fresh, !inkChanged && !erased {
            earlyInk(stroke: fresh, box: StrokeBounds.of(fresh))
        } else {
            earlyTimer?.cancel()
            earlyTimer = nil
            earlyStroke = nil
        }
        markUnsettled()
        for s in finished {
            let box = StrokeBounds.of(s)
            settler.ink(box)
            unringGrowingLine(box)
        }
        // the kid is working again: the tutor puts the pen down, finishing what it began
        cancelHandwriting()
        let rewrite = dirtyStrokes.contains { id in lineOfStroke(id).map { !($0.latex.isEmpty) } ?? false }
        pendingRewrite = pendingRewrite || rewrite
        armQuietTimer()
    }

    /// The tutor's own changes (and another device's): nothing to read, but a mark rubbed out by
    /// the kid's Undo of nothing… only bookkeeping here.
    func noteTutorChanges(_ change: ChangeSet, screen: RecordID) {}

    /// The kid's pen on the board (from the board's touch observer, or the Lab's replay).
    func pen(_ down: Bool) {
        penDown = down
        earlyPen(down)
        if down {
            markUnsettled()
        }
    }

    func lineOfStroke(_ strokeId: String) -> LiveLine? {
        lines.values.first { $0.ink.strokeIds.contains(strokeId) }
    }

    /// A ringed line the kid is still writing (a pause before the last stroke of the 12 read
    /// `2x = 12` as `2x = 1`): the ring comes off now, not when the line is read again.
    func unringGrowingLine(_ ink: BrainRect) {
        for st in lines.values {
            guard rt[st.id]?.markKey.map({ $0.hasPrefix("circle:") }) == true else { continue }
            guard MarkSettler.inkExtendsLine(ink, st.bounds) else { continue }
            syncMark(st, nil)
        }
    }

    // MARK: - the two clocks

    /// The quiet gate: the line is finished when no ink has come for 600 ms (450 for a rewrite).
    func armQuietTimer(_ delay: Double? = nil) {
        quietTimer?.cancel()
        let ms = delay ?? (pendingRewrite ? LiveTiming.rewriteQuietMs : LiveTiming.quietMs)
        quietTimer = scheduler.after(ms) { [weak self] in
            guard let self else { return }
            self.quietTimer = nil
            // never read while the pen is down: the half-drawn stroke would be read without its end
            if self.penDown || self.board.isPenDown {
                self.armQuietTimer(LiveTiming.quietRecheckMs)
                return
            }
            self.pendingRewrite = false
            self.flush()
        }
    }

    /// The kid touched the board: the settle starts again. An answer waiting for it is cancelled,
    /// not queued (it comes at the next stop, never in a rush).
    func markUnsettled() {
        autoInk()
        settled = false
        settleTimer?.cancel()
        settleTimer = scheduler.after(LiveTiming.settleMs) { [weak self] in self?.settleNow() }
    }

    func settleNow() {
        settleTimer?.cancel()
        settleTimer = nil
        settled = true
        renderSettled()
    }

    /// The kid has stopped writing everywhere: the answers the lines were holding back, the "?"s
    /// under the tutor's problems, the right steps beside rings, then Auto's turn.
    func renderSettled() {
        guard settings.enabled, engineReady else { return }
        for st in lines.values where !st.latex.isEmpty && !(st.analysis?.resultLatex ?? "").isEmpty {
            render(st.id)
        }
        for id in lines.keys { questionIfSettled(id) }
        let waiting = pendingSuggestions
        pendingSuggestions.removeAll()
        for id in waiting { suggestNextStep(id) }
        autoPause(stopped: settled)
        armStuck()
    }

    // MARK: - flush: the gate ran out

    /// Clusters the screen's ink into lines (the brain), keeps line ids stable, and reads the lines
    /// that are new or changed. One flush at a time; a flush asked for meanwhile runs after it.
    func flush() {
        guard settings.enabled else {
            dirtyStrokes.removeAll()
            return
        }
        if flushing {
            flushAgain = true
            return
        }
        if !offlineQueue.isEmpty && connectivity.isOnline && slowUntil <= scheduler.now { absorbOfflineQueue() }
        let dirty = dirtyStrokes
        dirtyStrokes.removeAll()
        let force = forceRecognize
        forceRecognize.removeAll()
        let screen = board.currentScreenID
        let gen = generation
        let strokes = board.store.kidStrokes(on: screen)
        let previous = lines.values.map(\.ink)
        let previousDiagrams = diagrams
        let zoom = board.fitZoom
        flushing = true
        track { [weak self] in
            guard let self else { return }
            defer {
                self.flushing = false
                if self.flushAgain {
                    self.flushAgain = false
                    self.flush()
                }
            }
            let result: ClusterResult
            do {
                result = try await self.brain.clusterStrokes(ClusterRequest(strokes: strokes, previousLines: previous, previousDiagrams: previousDiagrams, zoom: zoom))
            } catch {
                Self.log.error("live: clustering failed: \(String(describing: error), privacy: .public)")
                return
            }
            guard gen == self.generation, screen == self.board.currentScreenID else { return }
            self.apply(result, dirty: dirty, force: force, strokes: strokes)
        }
    }

    func apply(_ result: ClusterResult, dirty: Set<String>, force: Set<String>, strokes: [BrainStroke]) {
        diagrams = result.diagrams
        let next = result.lines
        let nextIds = Set(next.map(\.id))
        for id in Array(lines.keys) where !nextIds.contains(id) { dropLine(id) }

        var affected: [(InkLine, Bool)] = []
        for line in next {
            guard var prev = lines[line.id] else {
                lines[line.id] = LiveLine(ink: line, updatedAt: scheduler.now)
                affected.append((line, false))
                continue
            }
            let same = Set(prev.ink.strokeIds) == Set(line.strokeIds)
            let forced = force.contains(line.id)
            let touched = forced || line.strokeIds.contains(where: dirty.contains) || !same
            var ink = line
            ink.hash = same ? prev.ink.hash : ""
            prev.ink = ink
            lines[line.id] = prev
            if touched { affected.append((ink, same && !forced)) }
        }
        // where the kid last wrote: Help me acts there
        if let pen = penStrokeId, let line = next.first(where: { $0.strokeIds.contains(pen) }) { penLineId = line.id }
        refreshHeads()
        for (line, moveOnly) in affected { processLine(line, moveOnly: moveOnly) }
    }

    /// A line whose ink is gone: its records, marks and the tutor's writing for it go too.
    func dropLine(_ id: String) {
        if let r = rt[id] {
            r.checkTask?.cancel()
            r.solveTask?.cancel()
            r.markPen?.cancel()
            r.stepPen?.cancel()
            r.unreadableTimer?.cancel()
            r.readRetryTimer?.cancel()
        }
        rt[id] = nil
        reading.remove(id)
        offlineQueue.remove(id)
        pendingSuggestions.remove(id)
        hints.removeAll { $0.lineId == id }
        readbacks.removeAll { $0.id == id }
        withdrawGraphOffer(id)
        graphOffered[id] = nil
        celebrate.forget(id)
        settler.removed(id)
        lines[id] = nil
        let screen = board.currentScreenID
        let lineRecord = RecordID("line:\(id)")
        let owned = board.store.liveRecords(on: screen, lineId: id).map(\.id)
        let marks = board.store.semantic(on: screen).compactMap { r -> RecordID? in
            if case .mark(let m) = r, m.target == lineRecord { return m.id }
            return nil
        }
        let gone = owned + marks + (board.store[lineRecord] != nil ? [lineRecord] : [])
        if !gone.isEmpty { board.store.remove(gone, origin: .tutor) }
        refreshActivity()
    }

    // MARK: - rebuild: a board opened, a screen switched

    /// The current screen's lines from their `line` records: no re-reading, no model call. The ink
    /// is clustered again (ids carried over from the records), the lines analysed and their marks
    /// kept (a mark already on the page with the same key is not written again).
    func rebuild() {
        guard engineReady else { return }
        let screen = board.currentScreenID
        let store = board.store
        var seeds: [InkLine] = []
        var reads: [String: (latex: String, confidence: Double, warned: String?)] = [:]
        for case .line(let l) in store.semantic(on: screen) {
            let ids = l.strokes.map(\.rawValue).filter { store[RecordID($0)] != nil }
            guard !ids.isEmpty else { continue }
            let boxes = ids.compactMap { store.stroke(RecordID($0)).map(StrokeBounds.of) }
            guard let bounds = BrainRect.around(boxes) else { continue }
            let key = String(l.id.key)
            seeds.append(InkLine.make(id: key, strokeIds: ids, bounds: bounds, hash: l.meta.string(LiveMeta.hash)))
            if !l.latex.isEmpty {
                reads[key] = (l.latex, l.meta[LiveMeta.confidence]?.numberValue ?? 1, l.meta[LiveMeta.aiWarnLatex]?.stringValue)
            }
        }
        let strokes = store.kidStrokes(on: screen)
        let gen = generation
        let zoom = board.fitZoom
        track { [weak self] in
            guard let self else { return }
            guard let result = try? await self.brain.clusterStrokes(ClusterRequest(strokes: strokes, previousLines: seeds, zoom: zoom)),
                  gen == self.generation, screen == self.board.currentScreenID else { return }
            self.diagrams = result.diagrams
            var unread: [InkLine] = []
            for ink in result.lines {
                var line = LiveLine(ink: ink, updatedAt: self.scheduler.now)
                if let read = reads[ink.id], Set(seeds.first(where: { $0.id == ink.id })?.strokeIds ?? []) == Set(ink.strokeIds) {
                    line.latex = read.latex
                    line.confidence = read.confidence
                    line.provider = .restored
                    line.modelWarned = read.warned
                } else {
                    unread.append(ink)
                }
                self.lines[ink.id] = line
            }
            self.refreshHeads()
            await self.analyzeAll(quiet: true)
            // what was on the screen before this session had its pauses then: Auto leaves it be
            for st in self.lines.values where !st.latex.isEmpty { _ = self.autoOnce(self.autoKey("check", st)) }
            // ink never read (written with Live off, or offline before a reload): read now
            for ink in unread { self.processLine(ink, moveOnly: false) }
        }
    }

    // MARK: - the tutor's problems heading columns

    /// Problems the tutor wrote on this screen ("Now you try"), as the heads of the columns under them.
    func refreshHeads() {
        let screen = board.currentScreenID
        var next: [ProblemHead] = []
        for case .problem(let p) in board.store.semantic(on: screen) where p.origin != "student" {
            guard let latex = p.latex, !latex.isEmpty, let rect = p.meta[LiveMeta.rect].flatMap(BrainRect.init(meta:)) else { continue }
            let old = heads.first { $0.id == p.id }
            let lines = latex.components(separatedBy: "\n").filter { !$0.isEmpty }
            next.append(ProblemHead(id: p.id, lines: lines, rect: rect, analyses: old?.lines == lines ? old?.analyses ?? [] : []))
        }
        heads = next
    }

    /// The problem the tutor wrote above this column of the kid's work, if any: the nearest one
    /// above its first line that overlaps it side to side.
    func head(for column: Int) -> ProblemHead? {
        let col = columnLines(column)
        guard let top = col.first else { return nil }
        let span = BrainRect.around(col.map(\.bounds)) ?? top.bounds
        return heads
            .filter { $0.rect.maxY <= top.bounds.y + top.bounds.h * 0.5 && $0.rect.x < span.maxX + 40 && $0.rect.maxX > span.x - 40 && top.bounds.y - $0.rect.maxY < 360 }
            .max { $0.rect.maxY < $1.rect.maxY }
    }

    func columnLines(_ column: Int) -> [LiveLine] {
        lines.values.filter { $0.column == column }.sorted { $0.row < $1.row }
    }
}

/// A stroke's page box (its points; the pen's width left out, as the web's `getShapePageBounds` of
/// a draw shape is close enough to it for marks and placement).
enum StrokeBounds {
    static func of(_ s: StrokeRecord) -> BrainRect {
        var x0 = Double.infinity, y0 = Double.infinity, x1 = -Double.infinity, y1 = -Double.infinity
        for p in s.points {
            let v = s.pagePoint(p)
            x0 = min(x0, v.x)
            y0 = min(y0, v.y)
            x1 = max(x1, v.x)
            y1 = max(y1, v.y)
        }
        guard x1 >= x0 else { return BrainRect(x: s.x, y: s.y, w: 0, h: 0) }
        return BrainRect(x: x0, y: y0, w: x1 - x0, h: y1 - y0)
    }
}

extension BrainRect {
    init?(meta value: AgathonBoard.JSONValue) {
        guard let x = value["x"]?.numberValue, let y = value["y"]?.numberValue,
              let w = value["w"]?.numberValue, let h = value["h"]?.numberValue else { return nil }
        self.init(x: x, y: y, w: w, h: h)
    }

    var meta: AgathonBoard.JSONValue {
        .object(["x": .number((x * 100).rounded() / 100), "y": .number((y * 100).rounded() / 100),
                 "w": .number((w * 100).rounded() / 100), "h": .number((h * 100).rounded() / 100)])
    }
}

extension InkLine {
    /// A line made on this side of the boundary (the brain's type has no public initializer).
    static func make(id: String, strokeIds: [String], bounds: BrainRect, column: Int = 0, row: Int = 0, hash: String = "") -> InkLine {
        struct Raw: Encodable {
            var id: String
            var strokeIds: [String]
            var bounds: BrainRect
            var column: Int
            var row: Int
            var hash: String
        }
        // our own value, encoded and read back: cannot fail
        let data = try! JSONEncoder().encode(Raw(id: id, strokeIds: strokeIds, bounds: bounds, column: column, row: row, hash: hash))
        return try! JSONDecoder().decode(InkLine.self, from: data)
    }
}
