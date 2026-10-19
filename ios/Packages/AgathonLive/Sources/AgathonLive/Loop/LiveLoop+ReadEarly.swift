import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation

/// A read started before the quiet gate ran out.
struct EarlyRead {
    let task: Task<RecognizeResponse, Error>
    /// the line's strokes when it started (new ink touching them stops it)
    let strokeIds: Set<String>
    /// the line's ink box when it started
    let box: BrainRect
    let startedAt: Double
}

/// Why a line is read early.
enum EarlyTrigger: String {
    /// the kid paused a little longer than they do inside a line, on a line that looks finished
    case pause
    /// the hovering Pencil left the line
    case hover
}

/// Reading early: the tick lands sooner without reading anything twice.
///
/// The quiet gate waits 600 ms after the kid's last stroke, then the read takes ~400 ms, so a tick
/// comes ~1 s after the pen lifts. Here the read starts as soon as the line looks finished:
///
/// - **a pause on a finished-looking line:** a little longer than nine in ten of the kid's own pauses
///   inside a line (`PenRhythm.delayMs`, 200–450 ms; 450 until their rhythm is known; never for a
///   kid whose long pauses are longer than that), when the stroke just written ends the line's
///   ink on the right and the line is a relation with its right side under way (`2x = 8`) — or, when
///   an answer is wanted after `=` (Solve, or the grown-ups' setting), ends with its `=`
///   (`LineShape.looksFinished`);
/// - **the Pencil hovering away from the line** (iPads that report hover), at once.
///
/// Its reply goes in the payload-hash cache. When it lands and the kid has not written since, the
/// gate is done waiting (the kid has been quiet the gate's time by then). When the gate runs out
/// first, its read waits for this one instead of asking again. New ink in that line stops it (its
/// reply would be for ink that is gone). Never more than the limiter's slots, never offline, rate
/// limited, out of ink, or with the vision reader (it needs a crop of a line not yet made).
extension LiveLoop {
    // MARK: - the kid's pen

    /// A fresh kid stroke landed (`storeChanged`): the rhythm learns from it, and an early read is armed.
    func earlyInk(stroke s: StrokeRecord, box: BrainRect) {
        rhythm.stroke(box, at: scheduler.now)
        earlyTimer?.cancel()
        earlyTimer = nil
        guard readsEarly, settings.enabled else {
            earlyStroke = nil
            return
        }
        earlyStroke = (s.id.rawValue, inkSeq)
        // a pause alone reads it only for a kid whose pauses inside a line are short enough
        guard let delay = earlyDelayOverride ?? rhythm.delayMs else { return }
        earlyTimer = scheduler.after(delay) { [weak self] in
            self?.earlyTimer = nil
            self?.readEarly(.pause)
        }
    }

    /// The kid's ink changed (any stroke added, moved or rubbed out): early reads of a line that
    /// ink touches are stopped and dropped.
    func earlyInkChanged(boxes: [BrainRect], ids: Set<String>) {
        inkSeq += 1
        for (hash, early) in earlyReads where !early.strokeIds.isDisjoint(with: ids) || boxes.contains(where: { PenRhythm.joins($0, early.box) }) {
            early.task.cancel()
            earlyReads[hash] = nil
            metrics.readsEarlyCancelled += 1
        }
    }

    /// The pen went down: no early read starts while it is (the line may be growing).
    func earlyPen(_ down: Bool) {
        guard down else { return }
        rhythm.penDown(at: scheduler.now)
        earlyTimer?.cancel()
        earlyTimer = nil
        warmRoad()
    }

    /// A hovering Pencil moved (page units), or the hover ended (nil). Leaving the line just
    /// written reads it now.
    public func penHover(_ at: AgathonBrain.Point?) {
        guard let at, earlyStroke != nil, !penDown, rhythm.leftLine(at) else { return }
        readEarly(.hover)
    }

    /// Everything early on this screen goes (a reset, a screen left).
    func dropEarlyReads() {
        earlyTimer?.cancel()
        earlyTimer = nil
        earlyStroke = nil
        for early in earlyReads.values { early.task.cancel() }
        earlyReads.removeAll()
        earlyUnused.removeAll()
        earlyFailures.removeAll()
        rhythm.reset()
    }

    // MARK: - the read

    /// The server can be asked now, the way an early read is.
    var canReadEarly: Bool {
        started && engineReady && settings.enabled && connectivity.isOnline && !inkOut && !signedOut
            && slowUntil <= scheduler.now && recognizer == "mathpix" && readsInFlight < LiveLimits.concurrentReads
    }

    /// An answer after the kid's `=` is wanted (Solve, or the grown-ups' setting): a line ending with
    /// its `=` is finished.
    var answerAfterEqualsWanted: Bool {
        settings.mode == .answer || settings.answerOnEquals
    }

    /// Reads the line of the kid's last stroke now, if it is still waiting for its gate, looks
    /// finished (a pause) or was left (hover), and is not read or being read already.
    func readEarly(_ trigger: EarlyTrigger) {
        guard readsEarly, let target = earlyStroke, target.seq == inkSeq, !penDown, !board.isPenDown,
              quietTimer != nil, dirtyStrokes.contains(target.id), canReadEarly else { return }
        // once per stroke
        earlyStroke = nil
        earlyTimer?.cancel()
        earlyTimer = nil
        let screen = board.currentScreenID
        let strokes = board.store.kidStrokes(on: screen)
        let previous = lines.values.map(\.ink)
        let previousDiagrams = diagrams
        let zoom = board.fitZoom
        let gen = generation
        let seq = inkSeq
        let answerWanted = answerAfterEqualsWanted
        track { [weak self] in
            guard let self else { return }
            guard let result = try? await self.brain.clusterStrokes(ClusterRequest(strokes: strokes, previousLines: previous, previousDiagrams: previousDiagrams, zoom: zoom)),
                  self.stillQuiet(gen, seq, screen),
                  let line = result.lines.first(where: { $0.strokeIds.contains(target.id) }) else { return }
            let ids = Set(line.strokeIds)
            let mine = strokes.filter { ids.contains($0.id) }
            if trigger == .pause {
                let boxes = mine.map(Self.box)
                guard let last = mine.first(where: { $0.id == target.id }).map(Self.box),
                      LineShape.looksFinished(boxes, last: last, answerAfterEquals: answerWanted) else { return }
            }
            guard let payload = try? await self.brain.recognizerPayload(mine, line: PayloadLine(id: line.id, strokeIds: line.strokeIds, bounds: line.bounds)),
                  self.stillQuiet(gen, seq, screen), self.quietTimer != nil, self.dirtyStrokes.contains(target.id),
                  self.cache.peek(payload.hash) == nil, self.earlyReads[payload.hash] == nil, self.canReadEarly else { return }
            self.startEarlyRead(payload, line: line, seq: seq, trigger: trigger)
        }
    }

    /// Nothing moved since the early read was decided: the same screen, no new ink, the pen up.
    func stillQuiet(_ gen: Int, _ seq: Int, _ screen: RecordID) -> Bool {
        gen == generation && seq == inkSeq && screen == board.currentScreenID && !penDown && !board.isPenDown
    }

    func startEarlyRead(_ payload: RecognizerPayload, line: InkLine, seq: Int, trigger: EarlyTrigger) {
        let hash = payload.hash
        let request = RecognizeRequest(boardId: boardId, lineId: line.id, payload: payload)
        let services = self.services
        readsInFlight += 1
        count("recognize")
        metrics.readsEarly += 1
        let started = scheduler.now
        let gen = generation
        let task = Task<RecognizeResponse, Error> { try await services.recognize(request) }
        earlyReads[hash] = EarlyRead(task: task, strokeIds: Set(line.strokeIds), box: line.bounds, startedAt: started)
        Self.log.debug("live: early read (\(trigger.rawValue, privacy: .public)) of \(line.id, privacy: .public)")
        track { [weak self] in
            let result = await task.result
            guard let self else { return }
            self.releaseReadSlot()
            let mine = self.earlyReads[hash]?.startedAt == started
            if mine { self.earlyReads[hash] = nil }
            guard gen == self.generation else { return }
            let res: RecognizeResponse
            switch result {
            case .success(let r):
                res = r
            case .failure(let error):
                // not stopped by new ink: the gate's read of the same ink ends the same way, without asking again
                if mine, LiveFailure.from(error) != .other("cancelled") { self.earlyFailures[hash] = error }
                return
            }
            self.metrics.recognize.append(self.scheduler.now - started)
            if self.cache.peek(hash) == nil {
                self.cache[hash] = res
                self.earlyUnused.insert(hash)
            }
            // the kid has not written since: they have been quiet the gate's time, the gate is done
            guard seq == self.inkSeq, !self.penDown, !self.board.isPenDown, let gate = self.quietTimer else { return }
            gate.cancel()
            self.quietTimer = nil
            self.pendingRewrite = false
            self.metrics.earlyFlushes += 1
            self.flush()
        }
    }

    /// The gate's read of `hash`: an early read's reply when there is one (in the cache, still on
    /// its way, or the error it ended with). nil: there is none, read it.
    func earlyReply(_ hash: String) async throws -> RecognizeResponse? {
        if earlyUnused.remove(hash) != nil {
            metrics.readsEarlyUsed += 1
            return cache.peek(hash)
        }
        if let error = earlyFailures.removeValue(forKey: hash) {
            metrics.readsEarlyUsed += 1
            throw error
        }
        guard let early = earlyReads[hash] else { return nil }
        metrics.readsEarlyUsed += 1
        do {
            let res = try await early.task.value
            earlyUnused.remove(hash)
            cache[hash] = res
            return res
        } catch {
            if LiveFailure.from(error) == .other("cancelled") { return nil }
            throw error
        }
    }

    /// A stroke's page box, from the brain's stroke (its points).
    static func box(_ s: BrainStroke) -> BrainRect {
        guard let x0 = s.x.min(), let x1 = s.x.max(), let y0 = s.y.min(), let y1 = s.y.max() else { return BrainRect(x: 0, y: 0, w: 0, h: 0) }
        return BrainRect(x: x0, y: y0, w: x1 - x0, h: y1 - y0)
    }

    // MARK: - a warm road

    /// The first pen-down after a long quiet asks the recognize route for its capabilities (free:
    /// no ink, no recognizer): the connection, the server and its sign-in cache are warm again by
    /// the time the line is read.
    func warmRoad() {
        guard started, settings.enabled, connectivity.isOnline, !signedOut, scheduler.now - lastCallAt > LiveTiming.warmAfterMs else { return }
        lastCallAt = scheduler.now
        metrics.calls["warm", default: 0] += 1
        let services = self.services
        Task { _ = try? await services.capabilities() }
    }
}
