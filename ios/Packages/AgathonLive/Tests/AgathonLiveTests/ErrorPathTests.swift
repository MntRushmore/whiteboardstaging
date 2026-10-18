import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation
import Testing
@testable import AgathonLive

/// Out of ink, rate limits, offline, a recognizer with nothing to fall back on, a blip.
@MainActor
@Suite(.serialized)
struct ErrorPathTests {
    static func http(_ status: Int, _ body: String, headers: [String: String] = [:]) -> APIError {
        .http(HTTPFailure(status: status, header: { headers[$0] }, body: Data(body.utf8)))
    }

    @Test func outOfInkPausesHelpAndAReadThatGetsThroughBringsItBack() async throws {
        let h = Harness(mode: .feedback)
        await h.start()
        h.services.failNextReads([Self.http(402, #"{"error":"ink_empty","message":"Help needs Agathon Unlimited.","remaining":0,"cost":1}"#)])
        await h.write("2x = 8", at: Vec2(200, 150))
        await h.pass(700)
        #expect(h.loop.activity == .outOfInk)
        #expect(h.board.marks.isEmpty, "no \"?\" on a line refused for ink: writing again would not help")
        // Auto spends nothing while out of ink
        await h.pass(3_000)
        #expect(h.services.checkRequests.isEmpty)
        // a grown-up sorted it: the line is read now
        h.loop.inkRestored()
        await h.pass(700)
        #expect(h.loop.activity == .idle)
        #expect(h.loop.lines.values.first?.latex == "2x = 8")
    }

    @Test func aRateLimitSlowsDownThenTheLineIsRead() async throws {
        let h = Harness()
        await h.start()
        h.services.failNextReads([Self.http(429, #"{"error":"rate_limited","message":"Slow down","retryAfterMs":5000}"#)])
        await h.write("2x = 8", at: Vec2(200, 150))
        await h.pass(700)
        guard case .slowDown(_, let fairUse) = h.loop.activity else {
            Issue.record("expected slowDown, got \(h.loop.activity)")
            return
        }
        #expect(!fairUse)
        #expect(h.loop.offlineWaiting == 1)
        await h.pass(2_000)
        #expect(h.services.recognizeRequests.count == 1, "nothing is sent during the back-off")
        await h.pass(4_000)
        #expect(h.services.recognizeRequests.count == 2)
        #expect(h.loop.lines.values.first?.latex == "2x = 8")
        #expect(h.loop.activity == .idle)
    }

    @Test func fairUseIsTheDaysCapNotOutOfInk() async throws {
        let h = Harness()
        await h.start()
        h.services.failNextReads([Self.http(429, #"{"error":"rate_limited","reason":"fair_use","message":"Lots of help today","retryAfterMs":7200000}"#)])
        await h.write("2x = 8", at: Vec2(200, 150))
        await h.pass(700)
        guard case .slowDown(let until, true) = h.loop.activity else {
            Issue.record("expected the fair-use pause, got \(h.loop.activity)")
            return
        }
        #expect(until - h.scheduler.now > 7_000_000, "hours, not seconds")
        // OK: the line goes (a read that is refused again says so again)
        h.loop.dismissTrouble()
        #expect(h.loop.activity != .outOfInk)
    }

    @Test func offlineLinesWaitAndAreReadWhenTheNetworkIsBack() async throws {
        let h = Harness(mode: .feedback)
        await h.start()
        h.connectivity.isOnline = false
        await h.write("2x + 3 = 11", at: Vec2(200, 120))
        await h.write("2x = 8", at: Vec2(200, 220))
        await h.pass(700)
        #expect(h.services.recognizeRequests.isEmpty)
        #expect(h.loop.activity == .offline(waiting: 2))
        h.connectivity.isOnline = true
        await h.pass(700)
        #expect(h.services.recognizeRequests.count == 2)
        #expect(h.loop.activity == .idle)
        #expect(h.board.mark(on: "2x = 8") == .tick)
    }

    @Test func aDroppedRequestWhileOnlineIsReplayedOnItsOwn() async throws {
        let h = Harness()
        await h.start()
        h.services.failNextReads([APIError.network(.networkConnectionLost)])
        await h.write("2x = 8", at: Vec2(200, 150))
        await h.pass(700)
        #expect(h.loop.offlineWaiting == 1)
        await h.pass(2_100)
        #expect(h.services.recognizeRequests.count == 2)
        #expect(h.loop.lines.values.first?.latex == "2x = 8")
    }

    @Test func needsCropSendsTheLineOnceMoreWithItsPicture() async throws {
        let h = Harness()
        await h.start()
        h.services.failNextReads([Self.http(503, #"{"error":"recognizer_failed","message":"no read","needsCrop":true}"#)])
        await h.write("2x = 8", at: Vec2(200, 150))
        await h.pass(700)
        let reqs = h.services.recognizeRequests
        #expect(reqs.count == 2)
        #expect(reqs[0].crop == nil)
        #expect(reqs[1].crop?.hasPrefix("data:image/jpeg;base64,") == true)
        #expect(reqs[1].cropOnly == true)
        #expect(h.loop.lines.values.first?.latex == "2x = 8")
    }

    @Test func aBlipIsTriedOnceMoreBeforeTheKidHears() async throws {
        let h = Harness()
        await h.start()
        h.services.failNextReads([APIError.timeout])
        await h.write("2x = 8", at: Vec2(200, 150))
        await h.pass(700)
        #expect(h.loop.activity == .idle, "a blip is not shown")
        await h.pass(1_600)
        #expect(h.services.recognizeRequests.count == 2)
        #expect(h.loop.lines.values.first?.latex == "2x = 8")
    }

    @Test func twoBlipsShowTroubleWithRetry() async throws {
        let h = Harness(mode: .feedback)
        await h.start()
        h.services.failNextReads([APIError.timeout, APIError.timeout])
        await h.write("2x = 8", at: Vec2(200, 150))
        await h.pass(700)
        await h.pass(1_600)
        #expect(h.loop.activity == .trouble(retry: true))
        #expect(h.board.marks.first?.kind == .question, "the line says so: its \"?\"")
        h.loop.retry()
        await h.pass(100)
        #expect(h.loop.lines.values.first?.latex == "2x = 8")
        #expect(h.loop.activity == .idle)
    }

    @Test func unreadableInkGetsAGentleQuestionMarkAfterAMoment() async throws {
        let h = Harness(mode: .feedback)
        await h.start()
        h.services.failNextReads([Self.http(503, #"{"error":"recognizer_failed","message":"unreadable","unreadable":true}"#)])
        await h.write("2x = 8", at: Vec2(200, 150))
        await h.pass(700)
        #expect(h.board.marks.isEmpty)
        #expect(h.loop.activity == .idle, "no pill, no error: nothing failed that Retry would fix")
        await h.pass(3_000)
        #expect(h.board.marks.first?.kind == .question)
        #expect(h.board.marks.first?.why == "unread")
    }

    @Test func theVisionRecognizerSendsACropWithEveryRead() async throws {
        let h = Harness()
        h.services.capabilitiesRecognizer = "vision"
        await h.start()
        await h.write("2x = 8", at: Vec2(200, 150))
        await h.pass(700)
        #expect(h.services.recognizeRequests.first?.crop != nil)
    }
}
