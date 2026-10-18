import Foundation

/// Time for the save queue: when it is, and work to run later. The app uses `LiveScheduler`; tests
/// use `ManualScheduler` and move the clock themselves.
@MainActor
public protocol SaveScheduler: AnyObject {
    var now: Date { get }
    /// Runs `work` on the main actor after `seconds` (cancel the result to drop it).
    @discardableResult
    func after(_ seconds: TimeInterval, _ work: @escaping @MainActor () -> Void) -> ScheduledWork
}

/// Work waiting on a `SaveScheduler`.
@MainActor
public final class ScheduledWork {
    private var onCancel: (() -> Void)?
    public private(set) var isCancelled = false

    public init(onCancel: (() -> Void)? = nil) {
        self.onCancel = onCancel
    }

    public func cancel() {
        guard !isCancelled else { return }
        isCancelled = true
        onCancel?()
        onCancel = nil
    }
}

/// Real time.
@MainActor
public final class LiveScheduler: SaveScheduler {
    public init() {}

    public var now: Date { Date() }

    @discardableResult
    public func after(_ seconds: TimeInterval, _ work: @escaping @MainActor () -> Void) -> ScheduledWork {
        let task = Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(max(0, seconds) * 1_000_000_000))
            guard !Task.isCancelled else { return }
            work()
        }
        return ScheduledWork { task.cancel() }
    }
}

/// A clock that only moves when told (tests).
@MainActor
public final class ManualScheduler: SaveScheduler {
    public private(set) var now: Date
    private var queue: [(at: Date, seq: Int, work: @MainActor () -> Void, handle: ScheduledWork)] = []
    private var seq = 0

    public init(start: Date = Date(timeIntervalSince1970: 1_760_000_000)) {
        now = start
    }

    @discardableResult
    public func after(_ seconds: TimeInterval, _ work: @escaping @MainActor () -> Void) -> ScheduledWork {
        seq += 1
        let handle = ScheduledWork()
        queue.append((now.addingTimeInterval(max(0, seconds)), seq, work, handle))
        return handle
    }

    /// Work waiting, not cancelled.
    public var pending: Int { queue.filter { !$0.handle.isCancelled }.count }

    /// The next waiting work's time, if any.
    public var nextDue: Date? { queue.filter { !$0.handle.isCancelled }.map(\.at).min() }

    /// Moves the clock `seconds` ahead, running everything that falls due on the way, in order.
    public func advance(by seconds: TimeInterval) {
        let end = now.addingTimeInterval(seconds)
        while true {
            queue.removeAll { $0.handle.isCancelled }
            guard let next = queue.enumerated().filter({ $0.element.at <= end }).min(by: { ($0.element.at, $0.element.seq) < ($1.element.at, $1.element.seq) }) else { break }
            queue.remove(at: next.offset)
            now = max(now, next.element.at)
            next.element.handle.cancel()
            next.element.work()
        }
        now = end
    }
}

/// The first of `operation` finishing and `seconds` passing: nil when the time ran out (the
/// operation's task is then cancelled; its result, if it ever comes, is dropped). A write that hangs
/// must not leave "Saving…" up forever and hold back every later save.
@MainActor
func withTimeout<T: Sendable>(_ seconds: TimeInterval, on scheduler: SaveScheduler, _ operation: @escaping @Sendable () async -> T) async -> T? {
    let race = TimeoutRace()
    return await withCheckedContinuation { (continuation: CheckedContinuation<T?, Never>) in
        race.task = Task { @MainActor in
            let value = await operation()
            guard !race.done else { return }
            race.done = true
            race.timer?.cancel()
            continuation.resume(returning: value)
        }
        race.timer = scheduler.after(seconds) {
            guard !race.done else { return }
            race.done = true
            race.task?.cancel()
            continuation.resume(returning: nil)
        }
    }
}

/// `withTimeout`'s shared state (main actor only).
@MainActor
final class TimeoutRace {
    var done = false
    var timer: ScheduledWork?
    var task: Task<Void, Never>?
}
