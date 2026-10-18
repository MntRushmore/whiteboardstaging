import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation
import Testing
@testable import AgathonLive

/// The real client stack (AgathonKit's API client, SSE parser and typed events, `LiveAPIServices`)
/// on a transport that answers like the server: bytes in, records on the board out.
final class ScriptedTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    /// path → JSON body (a 200), or a stream of raw SSE chunks
    var json: [String: (Int, String)] = [:]
    var sse: [String: [String]] = [:]
    private(set) var paths: [String] = []
    private(set) var bodies: [String: Data] = [:]

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let path = request.url?.path ?? ""
        let reply = lock.withLock { () -> (Int, String)? in
            paths.append(path)
            bodies[path] = request.httpBody
            return json[path]
        }
        guard let (status, body) = reply else { throw URLError(.resourceUnavailable) }
        return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!)
    }

    func stream(for request: URLRequest) async throws -> (HTTPURLResponse, AsyncThrowingStream<Data, Error>) {
        let path = request.url?.path ?? ""
        let chunks = lock.withLock { () -> [String] in
            paths.append(path)
            bodies[path] = request.httpBody
            return sse[path] ?? []
        }
        let stream = AsyncThrowingStream<Data, Error> { c in
            for chunk in chunks { c.yield(Data(chunk.utf8)) }
            c.finish()
        }
        return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/event-stream"])!, stream)
    }

    func body(_ path: String) -> AgathonKit.JSONValue? {
        lock.withLock { bodies[path] }.flatMap { AgathonKit.JSONValue.parse($0) }
    }
}

@MainActor
@Suite(.serialized)
struct SSETests {
    func harness(_ transport: ScriptedTransport, mode: LiveMode) -> (TestBoard, ManualScheduler, LiveLoop) {
        let api = APIClient(baseURL: URL(string: "https://example.test")!, transport: transport, token: { "token" })
        let services = LiveAPIServices(api: api, live: LiveAPI(sse: SSEClient(api: api)))
        let board = TestBoard()
        let scheduler = ManualScheduler()
        let loop = LiveLoop(board: board, boardId: "sse-board", services: services,
                            settings: LiveSettings(enabled: true, mode: mode, auto: true), brain: TestBrain.shared,
                            background: TestBrain.background, scheduler: scheduler, connectivity: ManualConnectivity())
        return (board, scheduler, loop)
    }

    func pass(_ loop: LiveLoop, _ scheduler: ManualScheduler, _ ms: Double) async {
        var left = ms
        while left > 0 {
            scheduler.advance(min(100, left))
            left -= 100
            for _ in 0..<3 { await loop.waitUntilIdle(timeout: .seconds(20)) }
        }
    }

    @Test func aCheckStreamBecomesARingAndAHintCard() async throws {
        let t = ScriptedTransport()
        t.json["/api/live/recognize"] = (200, #"{"latex":"x = 5","text":"","kind":"math","confidence":0.97,"provider":"mathpix","ms":420}"#)
        let (board, scheduler, loop) = harness(t, mode: .feedback)
        loop.start()
        await loop.waitUntilIdle()
        board.kidWrites(KidHands.strokes("x = 5", at: Vec2(300, 200)))
        await pass(loop, scheduler, 700)
        let line = try #require(loop.lines.values.first)
        #expect(line.latex == "x = 5")
        #expect(board.marks.isEmpty, "a lone x = 5 has nothing to be checked against")
        // the kid asks for a hint; the server streams one annotation, split across chunks, with a ping
        t.sse["/api/live/check"] = [
            "event: meta\ndata: {\"requestId\":\"req_1\",\"model\":\"google/gemini-3.5-flash\"}\n\n",
            ": ping\n\n",
            "event: annotation\ndata: {\"lineId\":\"\(line.id)\",\"verdict\":\"warn\",\"kind\":\"arith",
            "metic\",\"message\":\"Check the number on the right side.\",\"confidence\":0.8}\n\n",
            "event: done\ndata: {\"count\":1,\"ms\":812}\n\n",
        ]
        // (a lone right line gets the engine's own words from Help me; the check is what a ring asks)
        loop.startCheck(column: line.column, focus: line.id, userAsked: true, forceHint: true)
        await pass(loop, scheduler, 100)
        let body = try #require(t.body("/api/live/check"))
        #expect(body["focusLineId"]?.stringValue == line.id)
        #expect(body["userAsked"]?.boolValue == true)
        #expect(body["lines"]?.arrayValue?.first?["latex"]?.stringValue == "x = 5")
        #expect(loop.hints.first?.message == "Check the number on the right side.")
        #expect(board.mark(on: "x = 5") == .ring, "the model's warn rings the line")
        #expect(board.lineRecords.first?.meta["aiWarnLatex"]?.stringValue == "x = 5")
    }

    @Test func aSolveStreamIsWrittenAsOneBlockOfSteps() async throws {
        let t = ScriptedTransport()
        t.json["/api/live/recognize"] = (200, #"{"latex":"y'' + y = 0","text":"","kind":"math","confidence":0.95,"provider":"mathpix","ms":380}"#)
        t.sse["/api/live/solve"] = [
            "event: meta\ndata: {\"requestId\":\"req_2\",\"model\":\"anthropic/claude-sonnet-5\"}\n\n",
            "event: step\ndata: {\"index\":1,\"latex\":\"r^{2} + 1 = 0\",\"explanation\":\"Characteristic equation\",\"final\":false}\n\n",
            "event: step\ndata: {\"index\":2,\"latex\":\"r = \\\\pm i\",\"explanation\":\"\",\"final\":false}\n\n",
            "event: step\ndata: {\"index\":3,\"latex\":\"\\\\boxed{y = A \\\\cos x + B \\\\sin x}\",\"explanation\":\"\",\"final\":true}\n\n",
            "event: done\ndata: {\"count\":3,\"ms\":2100}\n\n",
        ]
        let (board, scheduler, loop) = harness(t, mode: .answer)
        loop.start()
        await loop.waitUntilIdle()
        board.kidWrites(KidHands.strokes("x = 3", at: Vec2(300, 200)))
        await pass(loop, scheduler, 700)
        loop.solveIt()
        await pass(loop, scheduler, 100)
        let written = board.tutorStrokes(withMeta: "solvedLatex").compactMap { $0.meta["handLine"]?.stringValue }
        #expect(Set(written).contains("r^{2} + 1 = 0"))
        #expect(Set(written).contains("y = A \\cos x + B \\sin x"))
        #expect(t.body("/api/live/solve")?["lines"]?.arrayValue?.count == 1)
    }

    @Test func anErrorFrameIsShownWithRetry() async throws {
        let t = ScriptedTransport()
        t.json["/api/live/recognize"] = (200, #"{"latex":"y'' + y = 0","text":"","kind":"math","confidence":0.95,"provider":"mathpix","ms":380}"#)
        t.sse["/api/live/solve"] = [
            "event: meta\ndata: {\"requestId\":\"req_3\",\"model\":\"m\"}\n\n",
            "event: error\ndata: {\"error\":\"upstream_error\",\"message\":\"The tutor service had a hiccup\"}\n\n",
        ]
        let (board, scheduler, loop) = harness(t, mode: .answer)
        loop.start()
        await loop.waitUntilIdle()
        board.kidWrites(KidHands.strokes("x = 3", at: Vec2(300, 200)))
        await pass(loop, scheduler, 700)
        loop.solveIt()
        await pass(loop, scheduler, 100)
        #expect(loop.activity == .trouble(retry: true))
        #expect(board.tutorStrokes(withMeta: "solvedLatex").isEmpty)
    }

    @Test func outOfInkBeforeTheStreamIsAPauseNotAnError() async throws {
        let t = ScriptedTransport()
        t.json["/api/live/recognize"] = (402, #"{"error":"ink_empty","message":"Help needs Agathon Unlimited.","remaining":0,"cost":1}"#)
        let (board, scheduler, loop) = harness(t, mode: .feedback)
        loop.start()
        await loop.waitUntilIdle()
        board.kidWrites(KidHands.strokes("x = 3", at: Vec2(300, 200)))
        await pass(loop, scheduler, 700)
        #expect(loop.activity == .outOfInk)
    }
}
