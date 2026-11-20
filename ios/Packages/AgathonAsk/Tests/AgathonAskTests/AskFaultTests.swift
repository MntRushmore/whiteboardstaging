@testable import AgathonAsk
import AgathonKit
import Foundation
import Testing

/// Ask failing under the network (the v1 speed lane): every failure ends the "thinking" bubble with
/// words the kid can act on, and the provider's credits are never the family's ink.
@MainActor
struct AskFaultTests {
    func session(_ transport: FakeTransport) -> AskSession {
        AskSession(boardId: "board-1", transport: transport, board: FakeBoard(), speech: nil, grade: 4)
    }

    static func provider(_ status: Int = 503) -> APIError {
        .http(HTTPFailure(status: status, header: { _ in nil },
                          body: Data(#"{"error":"upstream_error","reason":"provider_unavailable","message":"The tutor is unavailable right now."}"#.utf8)))
    }

    /// The provider's credits ran out before the stream (a 503 with `reason`): the tutor is resting,
    /// Try again offered, never "ask a grown-up".
    @Test func theProviderOutBeforeTheStreamIsResting() async {
        let t = FakeTransport()
        t.script([.fail(Self.provider())])
        let s = session(t)
        s.send("help")
        #expect(await eventually { !s.busy })
        let m = s.messages[1]
        #expect(m.state == .error)
        #expect(m.text == AskCopy.Errors.resting)
        #expect(m.retryText == "help")
        #expect(!m.text.contains("grown-up"))
    }

    /// The same inside the stream (an `error` frame with the reason, or Ask's `credits_exhausted`).
    @Test func theProviderOutInsideTheStreamIsResting() {
        #expect(ChatView.error(for: StreamError(code: "upstream_error", message: "x", reason: "provider_unavailable")).message == AskCopy.Errors.resting)
        #expect(ChatView.error(for: StreamError(code: "credits_exhausted", message: "x", status: 503)).message == AskCopy.Errors.resting)
        // our own ink is still a grown-up's job
        #expect(ChatView.error(for: APIError.http(HTTPFailure(status: 402, code: "ink_empty", message: "x"))).kind == .ink)
    }

    /// A slow first word, then a stall the deadline ends (AgathonKit throws APIError.timeout): the
    /// bubble says the tutor took too long, with Try again.
    @Test func aStallAfterAFewWordsEndsWithTryAgain() async {
        let t = FakeTransport()
        t.script([.event(.model("m")), .event(.delta("Let's ")), .fail(APIError.timeout)])
        let s = session(t)
        s.send("why")
        #expect(await eventually { !s.busy })
        let m = s.messages[1]
        #expect(m.state == .error)
        #expect(m.error?.kind == .timeout)
        #expect(m.retryText == "why")
    }

    /// Offline, and a cut-off stream: each says so, with Try again.
    @Test func offlineAndCutOffSaySoWithTryAgain() async {
        for (error, kind) in [(APIError.network(.notConnectedToInternet), ChatError.Kind.network), (APIError.incomplete, .other)] {
            let t = FakeTransport()
            t.script([.fail(error)])
            let s = session(t)
            s.send("hi")
            #expect(await eventually { !s.busy })
            #expect(s.messages[1].state == .error)
            #expect(s.messages[1].error?.kind == kind)
            #expect(s.messages[1].retryText == "hi")
        }
    }
}
