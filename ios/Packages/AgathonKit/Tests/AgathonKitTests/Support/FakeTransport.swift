import Foundation
@testable import AgathonKit

/// A scripted HTTPTransport: answers requests in order and records them.
final class FakeTransport: HTTPTransport, @unchecked Sendable {
    struct Reply {
        var status: Int
        var headers: [String: String] = [:]
        var body: Data = Data()
        /// Thrown instead of answering.
        var error: Error?

        static func json(_ status: Int, _ text: String, headers: [String: String] = [:]) -> Reply {
            Reply(status: status, headers: headers.merging(["Content-Type": "application/json"]) { a, _ in a }, body: Data(text.utf8))
        }

        static func failing(_ error: Error) -> Reply {
            Reply(status: 0, error: error)
        }
    }

    enum Step {
        case chunk(String)
        case bytes(Data)
        case wait(Duration)
        /// Never sends another byte (until cancelled).
        case hang
        case fail(Error)
    }

    struct StreamReply {
        var status: Int = 200
        var headers: [String: String] = ["Content-Type": "text/event-stream"]
        var steps: [Step]
    }

    private let lock = NSLock()
    private var replies: [Reply]
    private var streamReplies: [StreamReply]
    private var _requests: [URLRequest] = []
    private var _terminated = 0

    init(replies: [Reply] = [], streams: [StreamReply] = []) {
        self.replies = replies
        streamReplies = streams
    }

    var requests: [URLRequest] { lock.withLock { _requests } }
    /// Streams whose consumer went away or that ended.
    var terminatedStreams: Int { lock.withLock { _terminated } }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let reply: Reply = try lock.withLock {
            _requests.append(request)
            guard !replies.isEmpty else { throw URLError(.resourceUnavailable) }
            return replies.removeFirst()
        }
        if let error = reply.error { throw error }
        return (reply.body, Self.response(request, reply.status, reply.headers))
    }

    func stream(for request: URLRequest) async throws -> (HTTPURLResponse, AsyncThrowingStream<Data, Error>) {
        let reply: StreamReply = try lock.withLock {
            _requests.append(request)
            guard !streamReplies.isEmpty else { throw URLError(.resourceUnavailable) }
            return streamReplies.removeFirst()
        }
        let steps = reply.steps
        let stream = AsyncThrowingStream<Data, Error> { continuation in
            let producer = Task {
                do {
                    for step in steps {
                        switch step {
                        case let .chunk(text): continuation.yield(Data(text.utf8))
                        case let .bytes(data): continuation.yield(data)
                        case let .wait(duration): try await Task.sleep(for: duration)
                        case .hang: try await Task.sleep(for: .seconds(3600))
                        case let .fail(error): throw error
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { [weak self] _ in
                producer.cancel()
                self?.lock.withLock { self?._terminated += 1 }
            }
        }
        return (Self.response(request, reply.status, reply.headers), stream)
    }

    static func response(_ request: URLRequest, _ status: Int, _ headers: [String: String]) -> HTTPURLResponse {
        HTTPURLResponse(url: request.url ?? URL(string: "https://example.test")!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
    }
}

/// Records the sleeps an APIClient asks for, without sleeping.
final class SleepRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var _sleeps: [Duration] = []
    var sleeps: [Duration] { lock.withLock { _sleeps } }

    var sleep: APIClient.Sleep {
        { [self] duration in lock.withLock { _sleeps.append(duration) } }
    }
}

enum Fixtures {
    static let baseURL = URL(string: "https://example.test")!
    static let token = "header.payload.signature"

    static func client(_ transport: FakeTransport, token: String? = Fixtures.token, sleeper: SleepRecorder = SleepRecorder()) -> APIClient {
        APIClient(baseURL: baseURL, transport: transport, token: { token }, sleep: sleeper.sleep)
    }

    /// A JWT-shaped string with these claims (unsigned: only its payload is read).
    static func jwt(_ claims: [String: String]) -> String {
        func b64(_ data: Data) -> String {
            data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
        }
        let header = b64(Data(#"{"alg":"HS256","typ":"JWT"}"#.utf8))
        let payload = b64((try? JSONSerialization.data(withJSONObject: claims, options: [.sortedKeys])) ?? Data())
        return "\(header).\(payload).c2lnbmF0dXJl"
    }

    static func bodyJSON(_ request: URLRequest) -> JSONValue? {
        request.httpBody.flatMap(JSONValue.parse)
    }
}
