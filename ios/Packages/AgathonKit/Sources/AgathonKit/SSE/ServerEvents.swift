import Foundation

/// A stream from a streaming route, as an async sequence. Iterating it sends the request (each
/// iteration sends its own); the request is cancelled when the iteration stops for any reason:
/// the last event, an error, a `break`, or the iterating task being cancelled.
///
/// (A bare AsyncThrowingStream would keep its request running after a `break`: its producer holds
/// the continuation, so nothing tells it the consumer left.)
public struct ServerEvents<Element: Sendable>: AsyncSequence, Sendable {
    let start: @Sendable () -> (AsyncThrowingStream<Element, Error>, Task<Void, Never>)

    init(start: @escaping @Sendable () -> (AsyncThrowingStream<Element, Error>, Task<Void, Never>)) {
        self.start = start
    }

    public func makeAsyncIterator() -> Iterator {
        let (stream, task) = start()
        return Iterator(base: stream.makeAsyncIterator(), lifetime: Lifetime(task))
    }

    public struct Iterator: AsyncIteratorProtocol {
        var base: AsyncThrowingStream<Element, Error>.AsyncIterator
        let lifetime: Lifetime

        public mutating func next() async throws -> Element? {
            try await base.next()
        }
    }

    /// Cancels the request when the last copy of the iterator goes away.
    final class Lifetime: Sendable {
        let task: Task<Void, Never>

        init(_ task: Task<Void, Never>) {
            self.task = task
        }

        deinit {
            task.cancel()
        }
    }
}
