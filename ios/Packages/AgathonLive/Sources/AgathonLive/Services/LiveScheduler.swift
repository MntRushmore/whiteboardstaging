import Foundation
import QuartzCore

/// The loop's clock and timers. Every wait the loop makes (the quiet gate, the settle, a retry, a
/// back-off) goes through here, so a test can run the loop on a clock it moves by hand
/// (`ManualScheduler` in the tests) and the app on the real one.
@MainActor
public protocol LiveScheduler: AnyObject {
    /// ms, monotonic
    var now: Double { get }
    /// Runs `body` on the main actor after `ms`. Cancel the token to stop it.
    @discardableResult
    func after(_ ms: Double, _ body: @escaping @MainActor () -> Void) -> LiveTimer
}

/// A timer the loop can stop. Cancelling twice, or after it fired, does nothing.
@MainActor
public final class LiveTimer {
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

/// The real clock: `CACurrentMediaTime`, timers on the main queue.
@MainActor
public final class MainScheduler: LiveScheduler {
    public init() {}

    public var now: Double { CACurrentMediaTime() * 1000 }

    @discardableResult
    public func after(_ ms: Double, _ body: @escaping @MainActor () -> Void) -> LiveTimer {
        let timer = LiveTimer()
        // the queue holds the timer until it is due: a token nobody kept still fires
        DispatchQueue.main.asyncAfter(deadline: .now() + max(0, ms) / 1000) {
            MainActor.assumeIsolated {
                guard !timer.isCancelled else { return }
                timer.cancel()
                body()
            }
        }
        return timer
    }
}
