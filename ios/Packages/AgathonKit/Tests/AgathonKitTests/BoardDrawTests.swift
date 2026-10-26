import Foundation
import Testing
@testable import AgathonKit

/// The picture tutor's client: the NDJSON stream (lines split anywhere), its events, its errors, and
/// cancelling the request.
struct BoardDrawTests {
    private static let png = Data([0x89, 0x50, 0x4E, 0x47, 1, 2, 3, 4])

    private static var doneLine: String {
        let b64 = png.base64EncodedString()
        return #"{"type":"done","overlay":"data:image/png;base64,\#(b64)","picture":"data:image/png;base64,\#(b64)","width":1440,"height":810,"instructions":"Add a tick","strokes":[{"points":[1,2,3,4,6,8],"width":3}],"timings":{"tutorMs":2100,"paintMs":3300,"diffMs":40,"traceMs":30,"totalMs":5900},"costUsd":0.012}"# + "\n"
    }

    private func collect(_ stream: AsyncThrowingStream<BoardDrawEvent, Error>) async throws -> [BoardDrawEvent] {
        var events: [BoardDrawEvent] = []
        for try await e in stream { events.append(e) }
        return events
    }

    private func request() -> BoardDrawRequest {
        BoardDrawRequest(png: Self.png, mode: .suggest, source: .auto, boardId: "b1", clientRunId: "c1")
    }

    // MARK: lines

    @Test func linesSplitAnywhereComeBackWhole() {
        var buffer = NDJSONLineBuffer()
        let text = "{\"a\":1}\n{\"b\":\r\n2}\n\n{\"c\":3}"
        var lines: [String] = []
        // one byte at a time: the worst a stream can do
        for byte in Data(text.utf8) { lines += buffer.push(Data([byte])).map { String(decoding: $0, as: UTF8.self) } }
        #expect(lines == ["{\"a\":1}", "{\"b\":", "2}"])
        lines += buffer.finish().map { String(decoding: $0, as: UTF8.self) }
        // a CR before the newline is dropped, blank lines are skipped, and the last had no newline
        #expect(lines == ["{\"a\":1}", "{\"b\":", "2}", "{\"c\":3}"])
    }

    @Test func aDoneLineInManyChunksDecodes() {
        var buffer = NDJSONLineBuffer()
        let bytes = Data(Self.doneLine.utf8)
        var lines: [Data] = []
        var i = 0
        while i < bytes.count {
            lines += buffer.push(bytes[i..<min(bytes.count, i + 17)])
            i += 17
        }
        #expect(lines.count == 1)
        guard case .done(let r)? = lines.first.flatMap(BoardDrawDecoding.event) else {
            Issue.record("not a done event")
            return
        }
        #expect(r.overlay == Self.png)
        #expect(r.picture == Self.png)
        #expect(r.width == 1440 && r.height == 810)
        #expect(r.strokes == [BoardDrawStroke(points: [1, 2, 3, 4, 6, 8], width: 3)])
        #expect(r.timings?.totalMs == 5900)
        #expect(r.timings?.traceMs == 30)
        #expect(r.costUsd == 0.012)
    }

    @Test func eventsDecode() {
        func e(_ s: String) -> BoardDrawEvent? { BoardDrawDecoding.event(Data(s.utf8)) }
        #expect(e(#"{"type":"status","stage":"reading","runId":"r1"}"#) == .status(.reading, runId: "r1", instructions: nil))
        #expect(e(#"{"type":"status","stage":"drawing","instructions":"x"}"#) == .status(.drawing, runId: nil, instructions: "x"))
        #expect(e(#"{"type":"none","reason":"fine"}"#) == .none(reason: "fine"))
        #expect(e(#"{"type":"none","reason":"right","correct":true}"#) == .none(reason: "right", correct: true))
        #expect(e(#"{"type":"error","message":"m","retryable":true}"#) == .error(message: "m", retryable: true))
        // a newer server's event, a stage this app doesn't know, junk: skipped
        #expect(e(#"{"type":"progress","pct":40}"#) == nil)
        #expect(e(#"{"type":"status","stage":"thinking"}"#) == nil)
        #expect(e("not json") == nil)
        // strokes missing: an empty list (the reveal fades instead)
        if case .done(let r)? = e(#"{"type":"done","overlay":"data:image/png;base64,AAAA","width":2,"height":2}"#) {
            #expect(r.strokes.isEmpty)
        } else {
            Issue.record("done without strokes should decode")
        }
    }

    @Test func strokeLength() {
        #expect(BoardDrawStroke(points: [0, 0, 3, 4, 3, 10], width: 1).length == 11)
        #expect(BoardDrawStroke(points: [5, 5], width: 1).length == 0)
    }

    // MARK: the stream

    @Test func streamsEventsAndSendsTheContract() async throws {
        let transport = FakeTransport(streams: [.init(headers: ["Content-Type": "application/x-ndjson"], steps: [
            .chunk(#"{"type":"status","stage":"reading","runId":"r1"}"# + "\n"),
            .chunk(#"{"type":"status","stage":"drawing","instructions":"Add a tick"}"# + "\n"),
            .chunk(String(Self.doneLine.prefix(100))),
            .chunk(String(Self.doneLine.dropFirst(100))),
            .hang,
        ])])
        let client = BoardDrawClient(api: Fixtures.client(transport))
        let events = try await collect(client.draw(request()))
        #expect(events.count == 3)
        #expect(events[0] == .status(.reading, runId: "r1", instructions: nil))
        if case .done = events[2] {} else { Issue.record("no done") }
        // the done ended it: the hanging request was let go
        #expect(transport.terminatedStreams == 1)

        let sent = try #require(transport.requests.first)
        #expect(sent.url?.absoluteString == "https://example.test/api/board/draw")
        #expect(sent.httpMethod == "POST")
        #expect(sent.value(forHTTPHeaderField: "Accept") == "application/x-ndjson")
        #expect(sent.value(forHTTPHeaderField: "Authorization") == "Bearer \(Fixtures.token)")
        let body = try #require(Fixtures.bodyJSON(sent))
        #expect(body["image"]?.stringValue == "data:image/png;base64,\(Self.png.base64EncodedString())")
        #expect(body["mode"]?.stringValue == "suggest")
        #expect(body["source"]?.stringValue == "auto")
        #expect(body["boardId"]?.stringValue == "b1")
        #expect(body["clientRunId"]?.stringValue == "c1")
    }

    @Test func noneEndsQuietly() async throws {
        let transport = FakeTransport(streams: [.init(steps: [
            .chunk(#"{"type":"status","stage":"reading"}"# + "\n" + #"{"type":"none","reason":"looks fine"}"# + "\n"),
        ])])
        let events = try await collect(BoardDrawClient(api: Fixtures.client(transport)).draw(request()))
        #expect(events.last == .none(reason: "looks fine"))
    }

    @Test func aStreamCutShortIsIncomplete() async {
        let transport = FakeTransport(streams: [.init(steps: [.chunk(#"{"type":"status","stage":"reading"}"# + "\n")])])
        await #expect(throws: APIError.incomplete) {
            _ = try await collect(BoardDrawClient(api: Fixtures.client(transport)).draw(request()))
        }
    }

    @Test(arguments: [400, 401, 404, 413, 429, 503])
    func refusalsAreHTTPErrors(status: Int) async {
        let transport = FakeTransport(streams: [.init(status: status, headers: ["Content-Type": "application/json"],
                                                     steps: [.chunk(#"{"error":"nope"}"#)])])
        do {
            _ = try await collect(BoardDrawClient(api: Fixtures.client(transport)).draw(request()))
            Issue.record("expected a failure")
        } catch let error as APIError {
            #expect(error.status == status)
        } catch {
            Issue.record("unexpected \(error)")
        }
    }

    @Test func stallTimesOut() async {
        let transport = FakeTransport(streams: [.init(steps: [.hang])])
        let client = BoardDrawClient(api: Fixtures.client(transport), stallTimeout: .milliseconds(80))
        await #expect(throws: APIError.timeout) { _ = try await collect(client.draw(request())) }
    }

    @Test func cancellingTheConsumerCancelsTheRequest() async throws {
        let transport = FakeTransport(streams: [.init(steps: [.chunk(#"{"type":"status","stage":"reading"}"# + "\n"), .hang])])
        let client = BoardDrawClient(api: Fixtures.client(transport))
        let task = Task {
            var n = 0
            for try await _ in client.draw(request()) { n += 1 }
            return n
        }
        // the first event arrives, then the kid writes again
        for _ in 0..<200 where transport.requests.isEmpty { try await Task.sleep(for: .milliseconds(5)) }
        try await Task.sleep(for: .milliseconds(50))
        task.cancel()
        _ = try? await task.value
        for _ in 0..<200 where transport.terminatedStreams == 0 { try await Task.sleep(for: .milliseconds(5)) }
        #expect(transport.terminatedStreams == 1)
    }

    @Test func reportsTheOutcome() async throws {
        let transport = FakeTransport(replies: [.init(status: 204)])
        try await BoardDrawClient(api: Fixtures.client(transport)).report(runId: "r1", outcome: .accepted)
        let sent = try #require(transport.requests.first)
        #expect(sent.url?.absoluteString == "https://example.test/api/board/draw/outcome")
        let body = try #require(Fixtures.bodyJSON(sent))
        #expect(body["runId"]?.stringValue == "r1")
        #expect(body["outcome"]?.stringValue == "accepted")
    }
}
