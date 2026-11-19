import Foundation
import Testing
@testable import AgathonKit

/// Fault injection under the AI calls (the v1 speed lane): each failure ends as a typed error the
/// app can put words to, within its deadline. Never a call that waits forever, never "out of ink" for
/// the provider's own credits.
struct NetworkFaultKitTests {
    private func live(_ transport: FakeTransport) -> LiveAPI {
        LiveAPI(sse: SSEClient(api: Fixtures.client(transport)))
    }

    private func drain<E>(_ stream: ServerEvents<E>) async throws -> [E] {
        var events: [E] = []
        for try await event in stream { events.append(event) }
        return events
    }

    /// The route keeps pinging while its model never answers: the stall watchdog never fires, the
    /// deadline does.
    @Test func aCheckThatOnlyPingsEndsAtItsDeadline() async throws {
        var steps: [FakeTransport.Step] = [.chunk("event: meta\ndata: {\"requestId\":\"r\",\"model\":\"m\"}\n\n")]
        for _ in 0..<40 { steps += [.wait(.milliseconds(50)), .chunk(": ping\n\n")] }
        let transport = FakeTransport(streams: [.init(steps: steps)])
        let started = ContinuousClock.now
        await #expect(throws: APIError.timeout) {
            _ = try await drain(try live(transport).check(["boardId": "b"], stallTimeout: .seconds(5), deadline: .milliseconds(400)))
        }
        #expect(ContinuousClock.now - started < .seconds(2))
        #expect(transport.terminatedStreams == 1, "the request is cancelled")
    }

    /// The platform ends the route at its maxDuration: the connection closes with no `done`. That is
    /// a cut-off answer (retryable), never a check that found nothing.
    @Test func aCheckCutOffWithoutDoneIsIncomplete() async throws {
        let transport = FakeTransport(streams: [.init(steps: [
            .chunk("event: meta\ndata: {\"requestId\":\"r\",\"model\":\"m\"}\n\n"),
            .chunk(": ping\n\n"),
        ])])
        await #expect(throws: APIError.incomplete) {
            _ = try await drain(try live(transport).check(["boardId": "b"]))
        }
        let solve = FakeTransport(streams: [.init(steps: [.chunk("event: meta\ndata: {\"requestId\":\"r\",\"model\":\"m\"}\n\n")])])
        await #expect(throws: APIError.incomplete) {
            _ = try await drain(try live(solve).solve(["boardId": "b"]))
        }
        #expect(APIError.incomplete.isRetryable)
    }

    /// A `done` or `error` frame always ends the stream, whatever it carries.
    @Test func doneAndErrorFramesEndTheStreamWhateverTheyCarry() async throws {
        let transport = FakeTransport(streams: [.init(steps: [.chunk("event: done\ndata: {}\n\n"), .hang])])
        let events = try await drain(try live(transport).check(["boardId": "b"], deadline: .seconds(2)))
        #expect(events == [.done(count: 0, ms: 0)])

        let failing = FakeTransport(streams: [.init(steps: [
            .chunk("event: error\ndata: {\"error\":\"upstream_error\",\"reason\":\"provider_unavailable\",\"message\":\"The tutor is unavailable right now.\"}\n\n"),
            .hang,
        ])])
        let ended = try await drain(try live(failing).solve(["boardId": "b"], deadline: .seconds(2)))
        guard case .error(let e)? = ended.first else {
            Issue.record("expected an error event, got \(ended)")
            return
        }
        #expect(e.isProviderUnavailable)
        #expect(e.code == "upstream_error")
    }

    /// Ask with a model that never speaks while the route pings: its deadline ends it.
    @Test func anAskThatNeverAnswersEndsAtItsDeadline() async throws {
        var steps: [FakeTransport.Step] = [.chunk("event: model\ndata: {\"model\":\"m\"}\n\n")]
        for _ in 0..<40 { steps += [.wait(.milliseconds(50)), .chunk(": ping\n\n")] }
        let transport = FakeTransport(streams: [.init(steps: steps)])
        await #expect(throws: APIError.timeout) {
            _ = try await drain(try live(transport).ask(["boardId": "b"], deadline: .milliseconds(400)))
        }
    }

    /// The provider's credits ran out: a 503 with `reason: provider_unavailable` (or Ask's
    /// `credits_exhausted` at 503) is never "out of ink"; our own 402 `ink_empty` still is.
    @Test func theProvidersCreditsAreNeverTheFamilysInk() {
        let provider = HTTPFailure(status: 503, header: { _ in nil },
                                   body: Data(#"{"error":"upstream_error","reason":"provider_unavailable","message":"The tutor is unavailable right now. Try again in a few minutes."}"#.utf8))
        #expect(provider.isProviderUnavailable)
        #expect(!provider.isOutOfInk)
        #expect(APIError.http(provider).isRetryable)

        let askWord = HTTPFailure(status: 503, header: { _ in nil }, body: Data(#"{"code":"credits_exhausted","message":"resting","status":503}"#.utf8))
        #expect(askWord.isProviderUnavailable && !askWord.isOutOfInk)

        let ink = HTTPFailure(status: 402, header: { _ in nil }, body: Data(#"{"error":"ink_empty","message":"Out of ink","remaining":0,"cost":3}"#.utf8))
        #expect(ink.isOutOfInk && !ink.isProviderUnavailable)
        // a server from before ink: 402 credits_exhausted is the family's
        let old = HTTPFailure(status: 402, header: { _ in nil }, body: Data(#"{"error":"credits_exhausted","message":"Out"}"#.utf8))
        #expect(old.isOutOfInk && !old.isProviderUnavailable)

        #expect(StreamError(code: "credits_exhausted", message: "resting", status: 503).isProviderUnavailable)
        #expect(!StreamError(code: "timeout", message: "slow").isProviderUnavailable)
    }

    /// A token refresh that never answers is a timeout, not a call that waits forever.
    @Test func aTokenThatNeverComesIsATimeout() async throws {
        let transport = FakeTransport(replies: [.json(200, "{}")])
        let started = ContinuousClock.now
        let task = Task {
            let client = APIClient(baseURL: Fixtures.baseURL, transport: transport, token: {
                try await Task.sleep(for: .seconds(3600))
                return Fixtures.token
            })
            return try await withDeadline(.milliseconds(300)) { try await client.currentToken() }
        }
        await #expect(throws: APIError.timeout) { _ = try await task.value }
        #expect(ContinuousClock.now - started < .seconds(2))
        #expect(transport.requests.isEmpty)
        #expect(AIDeadline.token <= .seconds(10))
    }

    /// `withDeadline` returns the body's value when it is in time, and its error when it fails.
    @Test func withDeadlinePassesTheBodyThrough() async throws {
        let value = try await withDeadline(.seconds(2)) { 42 }
        #expect(value == 42)
        await #expect(throws: APIError.network(.notConnectedToInternet)) {
            _ = try await withDeadline(.seconds(2)) { () async throws -> Int in throw APIError.network(.notConnectedToInternet) }
        }
        await #expect(throws: APIError.timeout) {
            _ = try await withDeadline(.milliseconds(50)) { () async throws -> Int in
                try await Task.sleep(for: .seconds(5))
                return 1
            }
        }
    }

    /// The transport's session: a stall timeout, and a backstop on the whole request.
    @Test func theSessionHasAStallTimeoutAndABackstop() {
        let session = URLSessionTransport.makeSession()
        #expect(session.configuration.timeoutIntervalForRequest == 30)
        #expect(session.configuration.timeoutIntervalForResource == 120)
    }
}
