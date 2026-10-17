import Foundation

/// How requests reach the network. `URLSessionTransport` in the app; tests pass a fake.
public protocol HTTPTransport: Sendable {
    /// One request, its whole body.
    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse)
    /// One request whose body arrives over time (Server-Sent Events): the response as soon as its
    /// headers are in, and the body in chunks. Cancelling the iteration cancels the request.
    func stream(for request: URLRequest) async throws -> (HTTPURLResponse, AsyncThrowingStream<Data, Error>)
}

/// The transport on URLSession.
public final class URLSessionTransport: HTTPTransport {
    public let session: URLSession

    public init(session: URLSession = URLSessionTransport.makeSession()) {
        self.session = session
    }

    /// A session for the API: nothing cached, and a request that receives no bytes for
    /// `stallTimeout` seconds fails (URLSession's request timeout is reset by every byte that
    /// arrives, so it is a stall timeout, not a limit on a long answer).
    public static func makeSession(stallTimeout: TimeInterval = 30) -> URLSession {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = stallTimeout
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.waitsForConnectivity = false
        return URLSession(configuration: configuration)
    }

    public func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }

    public func stream(for request: URLRequest) async throws -> (HTTPURLResponse, AsyncThrowingStream<Data, Error>) {
        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse else {
            bytes.task.cancel()
            throw URLError(.badServerResponse)
        }
        let dataTask = bytes.task
        let chunks = AsyncThrowingStream<Data, Error> { continuation in
            let reader = Task {
                do {
                    // URLSession hands bytes over one at a time from its own buffer; pass them on a
                    // line at a time (SSE is line based), or every 4 KB of a long line.
                    var chunk = Data()
                    chunk.reserveCapacity(4096)
                    for try await byte in bytes {
                        chunk.append(byte)
                        if byte == 0x0A || chunk.count >= 4096 {
                            continuation.yield(chunk)
                            chunk.removeAll(keepingCapacity: true)
                        }
                    }
                    if !chunk.isEmpty { continuation.yield(chunk) }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in
                reader.cancel()
                dataTask.cancel()
            }
        }
        return (http, chunks)
    }
}
