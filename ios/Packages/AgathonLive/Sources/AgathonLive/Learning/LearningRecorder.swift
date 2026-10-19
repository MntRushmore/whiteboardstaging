import AgathonBrain
import AgathonKit
import Foundation

/// One board's learning runtime: the web's `startBoardLearning` (src/lib/learning/boardLearning.ts)
/// on the iPad. It hands the board's signals to the attempt tracker in order (each problem's skill
/// asked of the brain first), publishes each attempt as it changes, saves what changed about 5 s
/// after a change (no more often than every 15 s while the student keeps working), backs off when a
/// save fails for a reason a retry can fix and stops for the session when it cannot.
///
/// What is not saved yet is kept on the device (`LearningDevice`): written a moment after each change
/// (an app killed mid-board loses nothing it showed), after each save, and when the app goes to the
/// background — and saved first at the next board's start, closed (`unfinished`) when a visit ended
/// without closing it. Each board's attempts are kept too, so coming back to a problem goes on with
/// its attempt. A record is only ever saved for its own student: one kept for a board deleted since
/// (RLS refuses it) is saved without its board, and only while that student is the one signed in.
@MainActor
public final class LearningRecorder {
    public let boardId: String
    public let userId: String
    public let course: String?
    let store: LearningAttemptStore
    let storage: LearningDeviceStorage?
    let classifier: LearningClassifier
    let scheduler: LiveScheduler
    /// ms since the epoch, whole (`Date.now()`)
    let clock: () -> Double
    public private(set) var tracker: AttemptTracker!
    public private(set) var saves: LearningSaveScheduler!
    /// each attempt's latest state, as it changes
    var onPublish: ((LearningRecord) -> Void)?
    /// a save went through or failed (the Lab's line, the logs)
    var onSaveResult: ((String?) -> Void)?

    /// what the last visits left on the device, saved first
    private(set) var replay: [LearningRecord]
    private var queue: [LearningSignal] = []
    private var pumping = false
    private var drainWaiters: [CheckedContinuation<Void, Never>] = []
    private var tickTimer: LiveTimer?
    private var persistTimer: LiveTimer?
    private(set) var stopped = false
    private var stopping = false

    /// How soon after a change the device copy is written (several changes, one write).
    static let persistDelayMs = 1_000.0

    public init(boardId: String, userId: String, course: String?, store: LearningAttemptStore, storage: LearningDeviceStorage?,
                brain: Brain, scheduler: LiveScheduler, clock: @escaping () -> Double = LearningTime.now,
                newId: @escaping () -> String = { UUID().uuidString.lowercased() }) {
        self.boardId = boardId
        self.userId = userId
        self.course = course
        self.store = store
        self.storage = storage
        self.scheduler = scheduler
        self.clock = clock
        let classifier = LearningClassifier(brain: brain, course: course)
        self.classifier = classifier
        replay = LearningDevice.readPending(userId, storage).map { $0.closedPending() }
        tracker = AttemptTracker(deps: .init(
            now: clock,
            newId: newId,
            course: course,
            classify: { classifier.skill($0) },
            save: { [weak self] records in try await self?.store.save(records) },
            publish: { [weak self] record in self?.published(record) },
            classifyMistake: { await classifier.mistake(previous: $0, latex: $1) }))
        saves = LearningSaveScheduler(
            flush: { [weak self] in try await self?.flushAll() },
            scheduler: scheduler,
            onSaved: { [weak self] in
                self?.persist()
                self?.onSaveResult?(nil)
            },
            onFailed: { [weak self] code, _ in
                self?.persist()
                self?.onSaveResult?(code)
            })
        // this board's attempts from the last visit: a problem worked again goes on with its attempt
        tracker.restore(LearningDevice.readBoardAttempts(userId, boardId: boardId, storage))
        if !replay.isEmpty { saves.changed() }
        armTick()
    }

    // MARK: - signals

    /// One signal from the board (this board's; another's is dropped). Handled in order: each waits
    /// for its problem's skill.
    public func handle(_ signal: LearningSignal) {
        guard !stopped else { return }
        if let b = signal.boardId, b != boardId { return }
        queue.append(signal)
        pump()
    }

    private func pump() {
        guard !pumping else { return }
        pumping = true
        Task { @MainActor [weak self] in
            guard let self else { return }
            while !self.queue.isEmpty {
                let s = self.queue.removeFirst()
                await self.classifier.prepare(s)
                self.tracker.handle(s)
            }
            self.pumping = false
            let waiting = self.drainWaiters
            self.drainWaiters = []
            for w in waiting { w.resume() }
        }
    }

    /// Returns once every signal handed over so far has reached the tracker.
    public func drained() async {
        guard pumping || !queue.isEmpty else { return }
        await withCheckedContinuation { drainWaiters.append($0) }
    }

    /// The attempt id for a problem on the board, once the signals before this call have landed.
    public func attemptId(for problemKey: String) async -> String? {
        await drained()
        return tracker.attemptId(for: problemKey)
    }

    // MARK: - published, kept, saved

    private func published(_ record: LearningRecord) {
        onPublish?(record)
        saves.changed()
        schedulePersist()
    }

    /// What is not saved yet, and this board's attempts, on the device now.
    public func persist() {
        persistTimer?.cancel()
        persistTimer = nil
        LearningDevice.writePending(userId, replay + tracker.pending(), storage)
        LearningDevice.writeBoardAttempts(userId, boardId: boardId, tracker.snapshot(boardId: boardId), at: clock(), storage)
    }

    private func schedulePersist() {
        guard persistTimer == nil else { return }
        persistTimer = scheduler.after(Self.persistDelayMs) { [weak self] in
            self?.persistTimer = nil
            self?.persist()
        }
    }

    /// Saves what earlier visits left: a board deleted since refuses its attempts (RLS), so they are
    /// saved again without it — but only while this student is the one signed in.
    private func saveReplay(_ batch: [LearningRecord]) async throws {
        do {
            try await store.save(batch)
        } catch {
            guard LearningStoreErrorCode.of(error) == "unauthorized", await store.sessionUserId() == userId else { throw error }
            try await store.save(batch.map { $0.withoutBoard() })
        }
    }

    private func flushAll() async throws {
        if !replay.isEmpty {
            // kept until it is saved: the app going away mid-save still finds it on the device
            let batch = replay
            do {
                try await saveReplay(batch)
            } catch {
                // the store saved what it could of it; what it refused would fail on every visit
                if LearningStoreErrorCode.of(error) == "invalid" { replay.removeFirst(min(batch.count, replay.count)) }
                throw error
            }
            replay.removeFirst(min(batch.count, replay.count))
        }
        try await tracker.flush()
    }

    /// Saves now (the app going to the background, a test): what is pending goes, and the device
    /// copy is written before and after.
    public func flushNow() async {
        persist()
        await drained()
        await tracker.settled()
        await saves.flushNow()
        persist()
    }

    // MARK: - time

    private func armTick() {
        tickTimer = scheduler.after(LearningSaveScheduler.Timing.tickMs) { [weak self] in
            guard let self, !self.stopped else { return }
            self.tracker.tick(self.clock())
            self.armTick()
        }
    }

    // MARK: - the end

    /// The board is closing: its attempts are over, and saved now (or kept on the device).
    public func stop() {
        guard !stopped, !stopping else { return }
        stopping = true
        tickTimer?.cancel()
        tickTimer = nil
        persist()
        let at = clock()
        Task { @MainActor in
            await self.drained()
            self.stopped = true
            self.tracker.handle(.closed(at: at, boardId: self.boardId))
            await self.tracker.settled()
            self.persist()
            await self.saves.flushNow()
            self.saves.stop()
            self.persist()
        }
    }

    /// The app is being terminated: the board's attempts end now, kept on the device (no network).
    public func terminate() {
        guard !stopped else { return }
        stopped = true
        tickTimer?.cancel()
        tracker.handle(.closed(at: clock(), boardId: boardId))
        persist()
    }
}
