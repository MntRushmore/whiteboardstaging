import Foundation

/// When the board's attempts are saved: the web's `SaveScheduler` (src/lib/learning/boardLearning.ts).
/// `changed` after each change: a save is due `debounceMs` after the last change, but no later than
/// `intervalMs` after the first unsaved one, and no sooner than `intervalMs` after the last save;
/// after a failure a retry can fix, no sooner than the backoff's next wait. A failure no retry fixes
/// (`unavailable`, `unauthorized`) stops it for the session (`halted`); `invalid` does not (the store
/// saved what it could). `flushNow` saves at once (the app going to the background, the board closing).
@MainActor
public final class LearningSaveScheduler {
    /// LEARNING_SAVE.
    public enum Timing {
        public static let debounceMs = 5_000.0
        public static let intervalMs = 15_000.0
        public static let backoffMs: [Double] = [15_000, 30_000, 60_000, 120_000, 300_000]
        /// how often idle attempts are closed (`AttemptTracker.tick`)
        public static let tickMs = 60_000.0
    }

    private let flush: () async throws -> Void
    private let scheduler: LiveScheduler
    private let onSaved: (() -> Void)?
    private let onFailed: ((String, Bool) -> Void)?
    private var timer: LiveTimer?
    private var firstChange: Double?
    private var lastChange = 0.0
    private var lastSave = -Double.infinity
    private var retryAt = -Double.infinity
    private var failures = 0
    private var running: Task<Void, Never>?
    private var stopped = false
    /// the store said no for good this session (`unavailable`, `unauthorized`)
    public private(set) var halted: String?

    /// - Parameters:
    ///   - flush: saves everything changed (throws the store's error)
    ///   - onSaved: a save went through
    ///   - onFailed: a save failed (its code); `halted`: no more tries this session
    public init(flush: @escaping () async throws -> Void, scheduler: LiveScheduler, onSaved: (() -> Void)? = nil,
                onFailed: ((String, Bool) -> Void)? = nil) {
        self.flush = flush
        self.scheduler = scheduler
        self.onSaved = onSaved
        self.onFailed = onFailed
    }

    public func changed() {
        if stopped || halted != nil { return }
        let now = scheduler.now
        lastChange = now
        if firstChange == nil { firstChange = now }
        schedule()
    }

    /// Saves now, whatever the schedule says (after a save in flight); never throws.
    public func flushNow() async {
        if halted != nil { return }
        clear()
        if let running { await running.value }
        if halted != nil { return }
        await run(now: true)
    }

    public func stop() {
        stopped = true
        clear()
    }

    /// When the next save is due (ms, the scheduler's clock), or nil with nothing to save.
    public func dueAt() -> Double? {
        guard let firstChange else { return nil }
        let settled = min(lastChange + Timing.debounceMs, firstChange + Timing.intervalMs)
        return max(settled, lastSave + Timing.intervalMs, retryAt)
    }

    /// A save is running now.
    public var isSaving: Bool { running != nil }

    private func clear() {
        timer?.cancel()
        timer = nil
    }

    private func schedule() {
        if running != nil || stopped || halted != nil { return }
        clear()
        guard let due = dueAt() else { return }
        timer = scheduler.after(max(0, due - scheduler.now)) { [weak self] in
            guard let self else { return }
            self.timer = nil
            // the save's time is the timer's, as the web's runs in its callback
            let at = self.scheduler.now
            Task { @MainActor in await self.run(now: false, at: at) }
        }
    }

    private func run(now: Bool, at: Double? = nil) async {
        if running != nil || halted != nil || (stopped && !now) { return }
        let t = at ?? scheduler.now
        firstChange = nil
        lastSave = t
        let flush = self.flush
        let saving = Task { @MainActor () -> Error? in
            do {
                try await flush()
                return nil
            } catch {
                return error
            }
        }
        running = Task { _ = await saving.value }
        let failure = await saving.value
        defer {
            running = nil
            schedule()
        }
        guard let failure else {
            failures = 0
            retryAt = -.infinity
            onSaved?()
            return
        }
        let code = LearningStoreErrorCode.of(failure)
        if code == "invalid" {
            // what could be saved was; whatever this round did not reach yet goes in the next save
            if firstChange == nil { firstChange = t }
            onFailed?(code, false)
            return
        }
        if code != "network" && code != "unknown" {
            halted = code
            clear()
            onFailed?(code, true)
            return
        }
        retryAt = scheduler.now + Timing.backoffMs[min(failures, Timing.backoffMs.count - 1)]
        failures += 1
        // what failed is still to save
        if firstChange == nil { firstChange = t }
        onFailed?(code, false)
    }
}
