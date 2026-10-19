import Foundation
import Testing
@testable import AgathonKit

struct SSEClientTests {
    private func live(_ transport: FakeTransport) -> LiveAPI {
        LiveAPI(sse: SSEClient(api: Fixtures.client(transport)))
    }

    private func collect<E>(_ stream: ServerEvents<E>) async throws -> [E] {
        var events: [E] = []
        for try await event in stream { events.append(event) }
        return events
    }

    private static let askHappyPath = [
        "event: model\ndata: {\"model\":\"anthropic/sonnet\"}\n\n",
        ": ping\n\n",
        "event: delta\ndata: {\"text\":\"Let's \"}\n\n",
        "event: delta\ndata: {\"text\":\"look.\"}\n\n",
        "event: delta\ndata: {\"text\":\"\"}\n\n",
        "event: reply\ndata: {\"text\":\"Let's look.\"}\n\n",
        "event: actions\ndata: {\"actions\":[{\"type\":\"write_problems\",\"problems\":[\"2+2\"]}],\"notes\":[\"One was left out.\"]}\n\n",
        "event: done\ndata: {\"model\":\"anthropic/sonnet\",\"ms\":1234,\"turnId\":\"t1\",\"userTurnId\":\"u1\"}\n\n",
    ]

    @Test func askStreamsTypedEventsInOrder() async throws {
        let transport = FakeTransport(streams: [.init(steps: Self.askHappyPath.map { .chunk($0) })])
        let events = try await collect(try live(transport).ask(["boardId": "b1", "message": "help"]))
        #expect(events == [
            .model("anthropic/sonnet"),
            .delta("Let's "),
            .delta("look."),
            .reply("Let's look."),
            .actions(AskActions(actions: [.object(["type": .string("write_problems"), "problems": .array([.string("2+2")])])],
                                notes: ["One was left out."])),
            .done(AskDone(model: "anthropic/sonnet", ms: 1234, turnId: "t1", userTurnId: "u1")),
        ])

        let request = try #require(transport.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "https://example.test/api/live/ask")
        #expect(request.value(forHTTPHeaderField: "Accept") == "text/event-stream")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer \(Fixtures.token)")
        #expect(Fixtures.bodyJSON(request)?["message"]?.stringValue == "help")
    }

    @Test func askErrorEventEndsTheStream() async throws {
        let transport = FakeTransport(streams: [.init(steps: [
            .chunk("event: model\ndata: {\"model\":\"m\"}\n\n"),
            .chunk("event: error\ndata: {\"code\":\"timeout\",\"message\":\"The tutor took too long to answer. Please try again.\",\"status\":504}\n\n"),
            .chunk("event: delta\ndata: {\"text\":\"never read\"}\n\n"),
        ])])
        let events = try await collect(try live(transport).ask(["boardId": "b1"]))
        #expect(events == [
            .model("m"),
            .error(StreamError(code: "timeout", message: "The tutor took too long to answer. Please try again.", status: 504)),
        ])
    }

    @Test func askCutOffBeforeDoneIsIncomplete() async throws {
        let transport = FakeTransport(streams: [.init(steps: [.chunk("event: delta\ndata: {\"text\":\"Half\"}\n\n")])])
        let stream = try live(transport).ask(["boardId": "b1"])
        await #expect(throws: APIError.incomplete) {
            for try await _ in stream {}
        }
    }

    @Test func checkStreamMayEndWithoutDone() async throws {
        let transport = FakeTransport(streams: [.init(steps: [
            .chunk("event: meta\ndata: {\"requestId\":\"r1\",\"model\":\"m\"}\n\n"),
            .chunk("event: annotation\ndata: {\"lineId\":\"l1\",\"verdict\":\"warn\",\"kind\":\"sign\",\"message\":\"Check the sign on line 2.\"}\n\n"),
        ])])
        let events = try await collect(try live(transport).check(["boardId": "b1"]))
        #expect(events.count == 2)
        guard case let .annotation(note) = events[1] else { Issue.record("not an annotation"); return }
        #expect(note.verdict == .warn)
        #expect(note.confidence == 0.8)
        #expect(transport.requests.first?.url?.path == "/api/live/check")
    }

    @Test func solveStreamsSteps() async throws {
        let transport = FakeTransport(streams: [.init(steps: [
            .chunk("event: meta\ndata: {\"requestId\":\"r2\",\"model\":\"m\"}\n\n"),
            .chunk("event: step\ndata: {\"index\":1,\"latex\":\"x=2\",\"explanation\":\"Divide both sides by 3.\",\"final\":true}\n\n"),
            .chunk("event: done\ndata: {\"count\":1,\"ms\":900}\n\n"),
        ])])
        let events = try await collect(try live(transport).solve(["boardId": "b1"]))
        #expect(events == [
            .meta(requestId: "r2", model: "m"),
            .step(SolveStep(index: 1, latex: "x=2", explanation: "Divide both sides by 3.", final: true)),
            .done(count: 1, ms: 900),
        ])
    }

    @Test func unknownAndBrokenFramesAreSkipped() async throws {
        let transport = FakeTransport(streams: [.init(steps: [
            .chunk("event: sparkle\ndata: {\"x\":1}\n\n"),
            .chunk("event: delta\ndata: not json\n\n"),
            .chunk("event: reply\ndata: {\"text\":\"ok\"}\n\n"),
            .chunk("event: done\ndata: {\"model\":\"m\",\"ms\":1}\n\n"),
        ])])
        let events = try await collect(try live(transport).ask(["boardId": "b1"]))
        #expect(events == [.reply("ok"), .done(AskDone(model: "m", ms: 1))])
    }

    @Test func anErrorBeforeTheStreamIsAnHTTPFailure() async throws {
        let body = #"{"error":"rate_limited","message":"You're doing that too fast. Try again in 5 seconds.","retryAfterMs":4200}"#
        let transport = FakeTransport(streams: [.init(status: 429, headers: ["Retry-After": "5", "X-Request-Id": "req_1"],
                                                       steps: [.chunk(body)])])
        let stream = try live(transport).ask(["boardId": "b1"])
        do {
            for try await _ in stream {}
            Issue.record("expected a failure")
        } catch let error as APIError {
            let failure = try #require(error.failure)
            #expect(failure.status == 429)
            #expect(failure.code == "rate_limited")
            #expect(failure.retryAfterMs == 4200)
            #expect(failure.requestId == "req_1")
        }
    }

    @Test func silenceIsATimeout() async throws {
        let transport = FakeTransport(streams: [.init(steps: [.chunk(": ping\n\n"), .hang])])
        let stream = try live(transport).ask(["boardId": "b1"], stallTimeout: .milliseconds(150))
        let started = ContinuousClock.now
        await #expect(throws: APIError.timeout) {
            for try await _ in stream {}
        }
        #expect(ContinuousClock.now - started < .seconds(5))
    }

    @Test func pingsKeepAQuietStreamAlive() async throws {
        var steps: [FakeTransport.Step] = []
        for _ in 0 ..< 6 { steps += [.wait(.milliseconds(60)), .chunk(": ping\n\n")] }
        steps.append(.chunk("event: done\ndata: {\"model\":\"m\",\"ms\":400}\n\n"))
        let transport = FakeTransport(streams: [.init(steps: steps)])
        let events = try await collect(try live(transport).ask(["boardId": "b1"], stallTimeout: .milliseconds(200)))
        #expect(events == [.done(AskDone(model: "m", ms: 400))])
    }

    @Test func stoppingTheIterationCancelsTheRequest() async throws {
        let transport = FakeTransport(streams: [.init(steps: [
            .chunk("event: model\ndata: {\"model\":\"m\"}\n\n"),
            .hang,
        ])])
        let stream = try live(transport).ask(["boardId": "b1"], stallTimeout: .seconds(30))
        for try await event in stream {
            #expect(event == .model("m"))
            break
        }
        // The body's stream is let go soon after the consumer leaves.
        let deadline = ContinuousClock.now + .seconds(3)
        while transport.terminatedStreams == 0, ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(20))
        }
        #expect(transport.terminatedStreams == 1)
    }

    @Test func cancellingTheTaskEndsQuietly() async throws {
        let transport = FakeTransport(streams: [.init(steps: [.hang])])
        let stream = try live(transport).ask(["boardId": "b1"], stallTimeout: .seconds(30))
        let task = Task {
            var count = 0
            for try await _ in stream { count += 1 }
            return count
        }
        try await Task.sleep(for: .milliseconds(50))
        task.cancel()
        let count = try await task.value
        #expect(count == 0)
    }

    @Test func notSignedInFailsBeforeAnyRequest() async throws {
        let transport = FakeTransport(streams: [.init(steps: [])])
        let api = Fixtures.client(transport, token: nil)
        let stream = try LiveAPI(sse: SSEClient(api: api)).ask(["boardId": "b1"])
        await #expect(throws: APIError.notSignedIn) {
            for try await _ in stream {}
        }
        #expect(transport.requests.isEmpty)
    }
}

struct LiveEventDecodingTests {
    @Test func askDoneAndErrorThatDoNotParseStillEndTheStream() {
        #expect(AskEvent.decode(SSEFrame(event: "done", data: "garbage")) == .done(AskDone(model: "", ms: 0)))
        #expect(AskEvent.decode(SSEFrame(event: "error", data: "{}")) == .error(StreamError(code: "upstream", message: "The tutor ran into a problem")))
    }

    @Test func askDoneCarriesRefunded() {
        let event = AskEvent.decode(SSEFrame(event: "done", data: #"{"model":"m","ms":10,"refunded":true}"#))
        #expect(event == .done(AskDone(model: "m", ms: 10, refunded: true)))
    }

    @Test func liveErrorUsesTheRouteContract() {
        let event = LiveEvent.decode(SSEFrame(event: "error", data: #"{"error":"upstream_error","message":"The AI service returned an error. Please try again."}"#))
        #expect(event == .error(StreamError(code: "upstream_error", message: "The AI service returned an error. Please try again.")))
    }

    @Test func annotationWithAnEmptyMessageIsDropped() {
        #expect(LiveEvent.decode(SSEFrame(event: "annotation", data: #"{"lineId":null,"verdict":"ok","kind":"praise","message":""}"#)) == nil)
    }

    @Test func terminalEvents() {
        #expect(AskEvent.done(AskDone(model: "m", ms: 1)).isTerminal)
        #expect(AskEvent.error(StreamError(code: "x", message: "y")).isTerminal)
        #expect(!AskEvent.delta("x").isTerminal)
        #expect(LiveEvent.done(count: 0, ms: 0).isTerminal)
        #expect(!LiveEvent.meta(requestId: "r", model: "m").isTerminal)
    }
}
