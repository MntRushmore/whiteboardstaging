import AgathonBoard
import Combine
import Foundation

/// The autosave's state, for the save indicator (the web's `SyncState`).
public struct SyncState: Equatable, Sendable {
    public enum Status: String, Sendable {
        /// everything is on the server
        case saved
        /// edits wait for the debounce
        case dirty
        case saving
        /// no network: saved when it comes back
        case offline
        /// another device saved first: merging its records with ours
        case merging
        /// a write failed (retrying), or the board is gone, or the merge gave up (reload)
        case error
        /// the board cannot be saved as it is (too big)
        case refused
        /// this server cannot hold the app's board yet: edits are kept on this device (backed up)
        /// and saved once it can (the next open after the migration)
        case localOnly
    }

    public var status: Status = .saved
    /// why, for `error`, `refused`, `offline`
    public var message: String?
    /// a standing note from the last write (the board is nearly full)
    public var notice: String?
    public var lastSavedAt: Date?
    /// the row version the board on screen is based on
    public var version: Int?
    /// edits not on the server yet
    public var pending = false
    /// failed attempts in a row (the backoff)
    public var attempt = 0
    /// the last backup of unsaved work could not be written (the device is full)
    public var backupFailed = false

    public init(version: Int? = nil) {
        self.version = version
    }
}

/// The save queue's words (kid copy: short, kind).
public enum SaveCopy {
    public static let boardGone = "This board isn't there any more."
    public static let mergeFailed = "This board changed on another device. Reload to keep going."
    public static let offline = "You're offline. Your work will save when you're back online."
    public static let saveFailed = "Couldn't save. Trying again…"
    public static let saveTimeout = "Saving is taking a while. Trying again…"
    public static let boardFull = "This board is full. Start a new board to keep going."
    public static let boardNearlyFull = "This board is almost full. Start a new board soon."
    public static let restored = "We put back work that wasn't saved yet."
    public static let staleRestore = "Some work from this iPad was older than the board and wasn't put back."
    public static let notSavedYet = "Not saved yet. Your work is kept on this iPad."
}

/// What the queue's `build` made: the write, and the records it holds (for the merge and the backup).
public enum BuiltUpdate: Sendable {
    case update(write: BoardWrite, records: [RecordID: BoardRecord], bytes: Int, notice: String?)
    /// the board cannot be saved as it is
    case refused(String)
}

/// Debounced, retrying, conflict-aware autosave of one board (a port of the web's `createSaveQueue`,
/// src/lib/sync/saveQueue.ts, over the board store's dirty sets):
///
///     markDirty → (debounce: 2 s after the last edit, 10 s at most into a burst) → cycle:
///       take the dirty sets → build (waits for the pen; encodes; the thumbnail) → write with the version
///       ok        → saved; the version the trigger bumped; the backup cleared
///       conflict  → merging: fetch the server's board, merge record by record (ours win), write again
///                   (at most `maxConflictRounds` rounds, then ask to reload)
///       offline / timeout / other → the dirty sets go back; retry after 2, 5, 15, 60, 60… s
///       too large → refused until the next edit
///       gone      → stop
///
/// One cycle at a time. Nothing to save (every pending record is as the server has it) writes nothing.
/// A write with no answer after 30 s plus 1 ms per 20 bytes is cancelled and retried.
@MainActor
public final class BoardSaveQueue: ObservableObject {
    public static let debounce: TimeInterval = 2
    public static let maxSaveWait: TimeInterval = 10
    public static let backupDebounce: TimeInterval = 0.5
    public static let maxBackupWait: TimeInterval = 2
    public static let retryBackoff: [TimeInterval] = [2, 5, 15, 60]
    public static let maxConflictRounds = 3
    public static let persistTimeout: TimeInterval = 30
    public static let persistTimeoutBytesPerMs = 20.0

    public static func backoff(_ attempt: Int) -> TimeInterval {
        retryBackoff[min(max(attempt, 1), retryBackoff.count) - 1]
    }

    public static func persistTimeout(bytes: Int) -> TimeInterval {
        persistTimeout + Double(max(0, bytes)) / persistTimeoutBytesPerMs / 1000
    }

    @Published public private(set) var state: SyncState

    public let boardId: String
    let store: BoardStore
    let remote: any BoardRemote
    let scheduler: SaveScheduler
    let build: @MainActor () async -> BuiltUpdate
    /// the server's board now (decoded or converted), or nil when it is gone
    let fetchRemote: @MainActor () async throws -> (records: [RecordID: BoardRecord], version: Int)?
    let backup: BoardBackupStore?
    let isOnline: @MainActor () -> Bool

    private var disposed = false
    private var dirty = false
    private var halted = false
    private var onlineHint: Bool?
    private var inFlight: Task<SyncState, Never>?
    private var inFlightToken: BoardStore.DirtyToken?
    private var inFlightSent: [RecordID: BoardRecord]?
    private var unacked: [(sent: [RecordID: BoardRecord], ids: Set<RecordID>)] = []
    private var serverKnown = true
    private var debounceTimer: ScheduledWork?
    private var retryTimer: ScheduledWork?
    private var backupTimer: ScheduledWork?
    private var saveBurstAt: Date?
    private var backupBurstAt: Date?
    /// the records as the server has them at `state.version` (loaded, written or merged in)
    private(set) var persisted: [RecordID: BoardRecord]
    private var subscription: StoreSubscription?

    /// Saving is off: this server cannot hold the app's board (no `doc` column yet). Edits are
    /// backed up on the device and never written; the board shows "Not saved yet".
    public private(set) var localOnly: Bool

    /// Writes so far (the QA numbers); and the last write's size.
    public private(set) var writes = 0
    public private(set) var lastWriteBytes = 0

    public init(
        boardId: String, store: BoardStore, initialVersion: Int?, persisted: [RecordID: BoardRecord],
        remote: any BoardRemote, scheduler: SaveScheduler,
        build: @escaping @MainActor () async -> BuiltUpdate,
        fetchRemote: @escaping @MainActor () async throws -> (records: [RecordID: BoardRecord], version: Int)?,
        backup: BoardBackupStore?, isOnline: @escaping @MainActor () -> Bool = { true }, localOnly: Bool = false
    ) {
        self.localOnly = localOnly
        self.boardId = boardId
        self.store = store
        self.remote = remote
        self.scheduler = scheduler
        self.build = build
        self.fetchRemote = fetchRemote
        self.backup = backup
        self.isOnline = isOnline
        self.persisted = persisted
        state = SyncState(version: initialVersion)
        // every change that needs saving (the kid's, the tutor's, the board's own) arms the queue
        subscription = store.observe { [weak self] change in
            guard change.origin.marksDirty else { return }
            self?.markDirty()
        }
    }

    private func online() -> Bool { onlineHint ?? isOnline() }
    private var hasPending: Bool { dirty || store.hasUnsavedChanges }
    private func patch(_ body: (inout SyncState) -> Void) {
        var s = state
        body(&s)
        if s != state { state = s }
    }

    private func burstDelay(since: Date, wait: TimeInterval, max cap: TimeInterval) -> TimeInterval {
        Swift.max(0, Swift.min(wait, since.addingTimeInterval(cap).timeIntervalSince(scheduler.now)))
    }

    // MARK: - edits

    /// A change that needs saving happened (the store's observer calls it).
    public func markDirty() {
        guard !disposed else { return }
        dirty = true
        scheduleBackup()
        if localOnly {
            patch { $0.status = .localOnly; $0.message = SaveCopy.notSavedYet; $0.pending = true }
            return
        }
        if halted {
            patch { $0.pending = true }
            return
        }
        if inFlight != nil {
            // part of the next save's burst
            if saveBurstAt == nil { saveBurstAt = scheduler.now }
            patch { $0.pending = true }
            return
        }
        if !online() {
            patch { $0.status = .offline; $0.message = SaveCopy.offline; $0.pending = true }
        } else if retryTimer != nil {
            // a retry is waiting and will take this change too; keep the error showing
            patch { $0.pending = true }
            return
        } else {
            patch { $0.status = .dirty; $0.message = nil; $0.pending = true }
        }
        scheduleSave()
    }

    private func scheduleSave() {
        if saveBurstAt == nil { saveBurstAt = scheduler.now }
        debounceTimer?.cancel()
        debounceTimer = scheduler.after(burstDelay(since: saveBurstAt!, wait: Self.debounce, max: Self.maxSaveWait)) { [weak self] in
            self?.debounceTimer = nil
            self?.start()
        }
    }

    private func scheduleRetry(_ attempt: Int) {
        retryTimer?.cancel()
        retryTimer = scheduler.after(Self.backoff(attempt)) { [weak self] in
            self?.retryTimer = nil
            self?.start()
        }
    }

    private func scheduleBackup() {
        guard backup != nil else { return }
        if backupBurstAt == nil { backupBurstAt = scheduler.now }
        backupTimer?.cancel()
        backupTimer = scheduler.after(burstDelay(since: backupBurstAt!, wait: Self.backupDebounce, max: Self.maxBackupWait)) { [weak self] in
            self?.backupTimer = nil
            self?.backupBurstAt = nil
            self?.writeBackupNow()
        }
    }

    // MARK: - the backup

    /// Writes the unsaved records' backup now (the app is leaving the screen). False when nothing
    /// was written.
    @discardableResult
    public func writeBackupNow() -> Bool {
        guard !disposed, let backup else { return false }
        var pending = store.peekDirty()
        // what a write that may land (or may have landed) sent, for an id still unsaved
        var sent: [String: BoardRecord?]?
        var writes: [(sent: [RecordID: BoardRecord], ids: Set<RecordID>)] = []
        if let token = inFlightToken, let s = inFlightSent { writes.append((s, token.changed.union(token.removed))) }
        writes += unacked.reversed()
        for id in pending.changed.union(pending.removed) {
            if let w = writes.first(where: { $0.ids.contains(id) }) {
                if sent == nil { sent = [:] }
                sent![id.rawValue] = .some(w.sent[id])
            }
        }
        if let token = inFlightToken {
            for id in token.changed where !pending.removed.contains(id) { pending.changed.insert(id) }
            for id in token.removed where !pending.changed.contains(id) { pending.removed.insert(id) }
        }
        if pending.isEmpty {
            backup.clear(boardId)
            noteBackup(true)
            return false
        }
        var records: [String: BoardRecord] = [:]
        var base: [String: BoardRecord] = [:]
        for id in pending.changed {
            if let r = store[id] { records[id.rawValue] = r }
            if let p = persisted[id] { base[id.rawValue] = p }
        }
        for id in pending.removed { if let p = persisted[id] { base[id.rawValue] = p } }
        let ok = backup.write(BoardBackup(
            boardId: boardId, baseVersion: state.version, changed: pending.changed.sorted(), removed: pending.removed.sorted(),
            records: records, base: base, sent: sent, at: scheduler.now))
        return noteBackup(ok)
    }

    @discardableResult
    private func noteBackup(_ ok: Bool) -> Bool {
        if state.backupFailed == !ok { return ok }
        patch { $0.backupFailed = !ok }
        return ok
    }

    // MARK: - the cycle

    /// True when every pending change leaves its record as the server has it (rewritten the same,
    /// or changed and changed back).
    private func nothingToSave() -> Bool {
        guard serverKnown else { return false }
        let p = store.peekDirty()
        for id in p.changed where store[id] != persisted[id] { return false }
        for id in p.removed where persisted[id] != nil { return false }
        return true
    }

    private func fail(_ token: BoardStore.DirtyToken, _ body: (inout SyncState) -> Void) {
        store.restoreDirty(token)
        dirty = true
        patch {
            body(&$0)
            $0.pending = true
        }
    }

    private func start() {
        _ = run()
    }

    @discardableResult
    private func run() -> Task<SyncState, Never> {
        if let inFlight { return inFlight }
        let task = Task { @MainActor [weak self] () -> SyncState in
            guard let self else { return SyncState() }
            let result = await self.cycle()
            self.inFlight = nil
            self.inFlightToken = nil
            // edits that came in while saving wait for their own debounce
            if !self.disposed, !self.halted, self.state.status == .saved, self.hasPending { self.scheduleSave() }
            return result
        }
        inFlight = task
        return task
    }

    private func cycle() async -> SyncState {
        debounceTimer?.cancel()
        debounceTimer = nil
        retryTimer?.cancel()
        retryTimer = nil
        saveBurstAt = nil
        if disposed || localOnly { return state }
        if !online() {
            let attempt = state.attempt + 1
            patch { $0.status = .offline; $0.message = SaveCopy.offline; $0.pending = hasPending; $0.attempt = attempt }
            if hasPending { scheduleRetry(attempt) }
            return state
        }
        if nothingToSave() {
            _ = store.takeDirty()
            dirty = false
            patch { $0.status = .saved; $0.message = nil; $0.pending = false; $0.attempt = 0 }
            backup?.clear(boardId)
            noteBackup(true)
            return state
        }
        patch { $0.status = .saving; $0.message = nil }

        var round = 0
        while true {
            let token = store.takeDirty()
            inFlightToken = token
            dirty = false

            let built = await build()
            if disposed {
                store.restoreDirty(token)
                dirty = true
                return state
            }
            guard case let .update(write, records, bytes, notice) = built else {
                if case let .refused(message) = built { fail(token) { $0.status = .refused; $0.message = message } }
                return state
            }

            inFlightSent = records
            let expected = state.version
            let remote = self.remote
            let boardId = self.boardId
            let answer = await withTimeout(Self.persistTimeout(bytes: bytes), on: scheduler) {
                await remote.persist(boardId: boardId, write: write, expectedVersion: expected)
            }
            inFlightSent = nil
            writes += 1
            lastWriteBytes = bytes
            let result = answer ?? .failed(.timeout, message: SaveCopy.saveTimeout)
            if disposed {
                store.restoreDirty(token)
                dirty = true
                return state
            }

            switch result {
            case .ok(let version):
                inFlightToken = nil
                persisted = records
                serverKnown = true
                unacked = []
                let pending = hasPending
                patch {
                    $0.status = .saved
                    $0.message = nil
                    $0.notice = notice
                    $0.version = version
                    $0.lastSavedAt = scheduler.now
                    $0.attempt = 0
                    $0.pending = pending
                }
                if !pending {
                    backup?.clear(boardId)
                    noteBackup(true)
                }
                return state

            case .conflict:
                patch { $0.status = .merging; $0.message = nil }
                let fetched: (records: [RecordID: BoardRecord], version: Int)?
                do {
                    // (a read that stalls fails on the transport's own 30 s stall timeout)
                    fetched = try await fetchRemote()
                } catch {
                    let attempt = state.attempt + 1
                    let offline = !online()
                    fail(token) { $0.status = offline ? .offline : .error; $0.message = offline ? SaveCopy.offline : SaveCopy.saveFailed; $0.attempt = attempt }
                    scheduleRetry(attempt)
                    return state
                }
                if disposed {
                    store.restoreDirty(token)
                    dirty = true
                    return state
                }
                guard let remoteBoard = fetched else {
                    halted = true
                    fail(token) { $0.status = .error; $0.message = SaveCopy.boardGone }
                    return state
                }
                if round >= Self.maxConflictRounds {
                    halted = true
                    fail(token) { $0.status = .error; $0.message = SaveCopy.mergeFailed }
                    return state
                }
                // edits made during this round are unsaved too: they win as well
                let pending = store.peekDirty()
                let changed = token.changed.union(pending.changed)
                var removed = token.removed.union(pending.removed)
                removed.subtract(pending.changed)
                let merge = RecordMerge.merge(local: store.records, remote: remoteBoard.records, changed: changed, removed: removed)
                RecordMerge.apply(merge, to: store)
                // the merge only took the server's records in; ours are still unsaved
                store.restoreDirty(token)
                inFlightToken = nil
                persisted = remoteBoard.records
                serverKnown = true
                unacked = []
                patch { $0.status = .saving; $0.version = remoteBoard.version }
                round += 1
                continue

            case let .failed(kind, message):
                switch kind {
                case .tooLarge:
                    fail(token) { $0.status = .refused; $0.message = message ?? SaveCopy.boardFull }
                    return state
                case .gone:
                    halted = true
                    fail(token) { $0.status = .error; $0.message = message ?? SaveCopy.boardGone }
                    return state
                case .unsupported:
                    // the server cannot hold the board: keep it here, never retry
                    localOnly = true
                    fail(token) { $0.status = .localOnly; $0.message = SaveCopy.notSavedYet }
                    writeBackupNow()
                    return state
                case .offline, .timeout, .other:
                    // the write may have landed without our hearing so
                    serverKnown = false
                    unacked = Array(unacked.suffix(2)) + [(records, token.changed.union(token.removed))]
                    let attempt = state.attempt + 1
                    let offline = kind == .offline || !online()
                    fail(token) {
                        $0.status = offline ? .offline : .error
                        $0.message = offline ? SaveCopy.offline : kind == .timeout ? SaveCopy.saveTimeout : SaveCopy.saveFailed
                        $0.attempt = attempt
                    }
                    scheduleRetry(attempt)
                    return state
                }
            }
        }
    }

    // MARK: - controls

    /// Saves now (the app is leaving the screen, the board is closing): the debounce is skipped.
    @discardableResult
    public func flush() async -> SyncState {
        debounceTimer?.cancel()
        debounceTimer = nil
        saveBurstAt = nil
        if localOnly {
            writeBackupNow()
            return state
        }
        if let inFlight { _ = await inFlight.value }
        if !disposed, !halted, hasPending { return await run().value }
        return state
    }

    /// The kid (or the Retry button) asks again: the backoff starts over.
    @discardableResult
    public func retry() async -> SyncState {
        // nothing to try against a server that cannot hold the board
        if localOnly { return state }
        retryTimer?.cancel()
        retryTimer = nil
        halted = false
        patch { $0.attempt = 0 }
        if let inFlight { _ = await inFlight.value }
        return await run().value
    }

    public func setOnline(_ isOnline: Bool) {
        guard !disposed else { return }
        onlineHint = isOnline
        if localOnly { return }
        if isOnline {
            if hasPending && inFlight == nil && !halted {
                retryTimer?.cancel()
                retryTimer = nil
                start()
            } else if !hasPending && state.status == .offline {
                patch { $0.status = .saved; $0.message = nil }
            }
        } else if hasPending && inFlight == nil {
            patch { $0.status = .offline; $0.message = SaveCopy.offline; $0.pending = true }
        }
    }

    /// Waits for a cycle in flight (tests, closing).
    public func waitIdle() async {
        if let inFlight { _ = await inFlight.value }
    }

    public var isSaving: Bool { inFlight != nil }

    public func dispose() {
        disposed = true
        debounceTimer?.cancel()
        retryTimer?.cancel()
        backupTimer?.cancel()
        subscription?.cancel()
        subscription = nil
    }
}
