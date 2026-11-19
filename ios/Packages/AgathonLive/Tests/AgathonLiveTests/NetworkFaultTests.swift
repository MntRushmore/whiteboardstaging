import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation
import Testing
@testable import AgathonLive

/// The Live routes with faults scripted per call: reads go to a `FakeServices` (its registered ink),
/// check and solve answer each call with the next script (events, then an error or the end).
final class FaultServices: LiveServices, @unchecked Sendable {
    struct Script {
        var events: [LiveEvent] = []
        var error: Error?
    }

    let base = FakeServices()
    private let lock = NSLock()
    private var checks: [Script] = []
    private var solves: [Script] = []
    private var setupErrors: [Error] = []
    private(set) var checkCalls = 0
    private(set) var solveCalls = 0

    func scriptCheck(_ events: [LiveEvent] = [], error: Error? = nil) { lock.withLock { checks.append(Script(events: events, error: error)) } }
    func scriptSolve(_ events: [LiveEvent] = [], error: Error? = nil) { lock.withLock { solves.append(Script(events: events, error: error)) } }

    func capabilities() async throws -> LiveCapabilities { try await base.capabilities() }
    func recognize(_ request: RecognizeRequest) async throws -> RecognizeResponse { try await base.recognize(request) }
    func reread(_ request: RereadRequest) async throws -> RereadResponse { try await base.reread(request) }
    func setup(_ request: SetupRequest) async throws -> SetupResponse { try await base.setup(request) }

    func check(_ request: CheckRequest) -> LiveEventStream {
        let script = lock.withLock { () -> Script in
            checkCalls += 1
            return checks.isEmpty ? Script(events: [.done(count: 0, ms: 1)]) : checks.removeFirst()
        }
        return Self.play(script)
    }

    func solve(_ request: SolveRequest) -> LiveEventStream {
        let script = lock.withLock { () -> Script in
            solveCalls += 1
            return solves.isEmpty ? Script(events: [.done(count: 0, ms: 1)]) : solves.removeFirst()
        }
        return Self.play(script)
    }

    static func play(_ script: Script) -> LiveEventStream {
        LiveEventStream { continuation in
            for e in script.events { continuation.yield(e) }
            if let error = script.error { continuation.finish(throwing: error) } else { continuation.finish() }
        }
    }
}

/// `Harness`, on `FaultServices`.
@MainActor
final class FaultHarness {
    let board = TestBoard()
    let scheduler = ManualScheduler()
    let services = FaultServices()
    let connectivity = ManualConnectivity()
    let loop: LiveLoop

    init(mode: LiveMode = .feedback, auto: Bool = false) {
        loop = LiveLoop(board: board, boardId: "test-board", services: services,
                        settings: LiveSettings(enabled: true, mode: mode, auto: auto, handwriting: true, celebrations: true, checking: .asIGo),
                        brain: TestBrain.shared, background: TestBrain.background, scheduler: scheduler, connectivity: connectivity)
    }

    func start() async {
        loop.start()
        await idle()
    }

    func idle() async {
        for _ in 0..<3 {
            await loop.waitUntilIdle(timeout: .seconds(20))
            await Task.yield()
        }
    }

    func write(_ latex: String, at: Vec2, reads: String? = nil) async {
        let ids = board.kidWrites(KidHands.strokes(latex, at: at))
        let set = Set(ids.map(\.rawValue))
        let strokes = board.store.kidStrokes(on: board.currentScreenID).filter { set.contains($0.id) }
        if let payload = try? await TestBrain.shared.recognizerPayload(strokes) {
            services.base.register(payload, as: RecognizeResponse(latex: reads ?? latex, confidence: 0.995))
        }
    }

    func pass(_ ms: Double) async {
        var left = ms
        while left > 0 {
            let step = min(left, 100)
            scheduler.advance(step)
            left -= step
            await idle()
        }
    }

    /// The kid's slip: `x = 5` under `2x = 8` (the engine finds it).
    func slip() async {
        await write("2x + 3 = 11", at: Vec2(200, 120))
        await write("2x = 8", at: Vec2(200, 220))
        await write("x = 5", at: Vec2(200, 320))
        await pass(700)
    }

    func step(_ i: Int, _ latex: String, final: Bool = false) throws -> LiveEvent {
        .step(try JSONDecoder().decode(SolveStep.self, from: Data(#"{"index":\#(i),"latex":"\#(latex)","explanation":"","final":\#(final)}"#.utf8)))
    }
}

/// The network failing under the loop (the v1 speed lane): every failure ends in something the kid
/// can see within its deadline: a mark, a note, Try again. Nothing silent, nothing stuck.
@MainActor
@Suite(.serialized)
struct NetworkFaultTests {
    static func http(_ status: Int, _ body: String, headers: [String: String] = [:]) -> APIError {
        .http(HTTPFailure(status: status, header: { headers[$0] }, body: Data(body.utf8)))
    }

    /// A problem page of a set with the tutor's problem at its top (as ProblemPagesLoopTests does).
    func problemPage(_ h: Harness, _ problem: [String]) {
        let screen = h.board.currentScreenID
        h.board.setProblemPage(ProblemPage(setId: "daily:test", index: 1, count: 3, origin: "practice"), on: screen)
        let meta: Meta = ["chatProblem": .object(["n": 1, "lines": .array(problem.map { .string($0) }),
                                                  "cell": .object(["x": 40, "y": 40, "w": 1520, "h": 840])]),
                          "lineId": "chat", "live": true, "source": "ai"]
        for k in 0..<3 {
            let s = StrokeRecord(screen: screen, order: h.board.store.nextOrder(on: screen), author: .tutor, color: .tutor, width: 4,
                                 pressure: .real, x: 88, y: 64 + Double(k) * 20,
                                 points: [InkPoint(x: 0, y: 0), InkPoint(x: 160, y: 6), InkPoint(x: 320, y: 0)], meta: meta)
            h.board.store.put(.stroke(s), origin: .tutor)
        }
        h.loop.problemsChanged()
    }

    func whenDone(auto: Bool = true) -> Harness {
        let h = Harness(mode: .feedback, auto: auto, checking: .whenDone)
        h.loop.pages.extras = true
        h.loop.settings.showReadings = true
        return h
    }

    // MARK: - offline, then the network back (the known flake: read, never ticked)

    /// The kid writes offline and stops; the long pause and the safety net go by while the line waits
    /// for the network. The network comes back: the line is read — and it is checked (ticked) on its
    /// own, without the kid writing again or tapping Check.
    @Test func aLineReadAfterTheNetworkIsBackIsTickedWithoutANewStroke() async throws {
        let h = whenDone()
        await h.start()
        problemPage(h, ["2x + 3 = 11"])
        h.connectivity.isOnline = false
        await h.write("2x = 8", at: Vec2(200, 280))
        // the long pause (9 s) and the safety net (+3 s) both go by offline
        await h.pass(15_000)
        #expect(h.services.recognizeRequests.isEmpty)
        #expect(h.board.marks.isEmpty)
        h.connectivity.isOnline = true
        // read on reconnect, then checked within a few seconds (never 90)
        await h.pass(3_000)
        #expect(h.loop.lines.values.first?.latex == "2x = 8")
        #expect(h.board.mark(on: "2x = 8") == .tick, "\(h.loop.checkDiagnosis)")
    }

    /// The same with the device saying "online" all along while every request drops (a captive Wi-Fi,
    /// a dead router): the offline queue's own replays read the line, and it is ticked.
    @Test func aLineReadOnTheQueuesOwnReplayIsTicked() async throws {
        let h = whenDone()
        await h.start()
        problemPage(h, ["2x + 3 = 11"])
        let lost = APIError.network(.networkConnectionLost)
        h.services.failNextReads([lost, lost, lost, lost])
        await h.write("2x = 8", at: Vec2(200, 280))
        // replays at 2, 4, 8, 15 s: the fifth read gets through about 30 s in
        await h.pass(32_000)
        #expect(h.loop.lines.values.first?.latex == "2x = 8", "\(h.services.recognizeRequests.count) reads")
        await h.pass(3_000)
        #expect(h.board.mark(on: "2x = 8") == .tick, "\(h.loop.checkDiagnosis)")
    }

    // MARK: - Help me (check) failing

    static let provider503 = http(503, #"{"error":"upstream_error","reason":"provider_unavailable","message":"The tutor is unavailable right now. Try again in a few minutes."}"#)
    static let ink402 = http(402, #"{"error":"ink_empty","message":"Out of ink","remaining":0,"cost":3}"#)

    func annotation(_ lineId: String) throws -> Annotation {
        try JSONDecoder().decode(Annotation.self, from: Data(#"{"lineId":"\#(lineId)","verdict":"warn","kind":"arithmetic","message":"Look again at how you divided 8 by 2.","confidence":0.9}"#.utf8))
    }

    /// Help me's check times out (or the platform cuts it off): tried once more on its own, and the
    /// model's hint comes on the second try. The kid never sees the blip.
    @Test func helpMeRetriesABlipOnceAndTheHintComes() async throws {
        for blip in [APIError.timeout, APIError.incomplete, APIError.http(HTTPFailure(status: 500, code: "internal_error", message: "x"))] {
            let h = FaultHarness()
            await h.start()
            await h.slip()
            let id = try #require(h.loop.lines.values.first { $0.latex == "x = 5" }?.id)
            h.services.scriptCheck(error: blip)
            h.services.scriptCheck([.meta(requestId: "r", model: "m"), .annotation(try annotation(id)), .done(count: 1, ms: 1)])
            h.loop.helpMe()
            await h.pass(100)
            #expect(h.loop.activity == .checking, "\(blip): still checking while it waits to try again")
            await h.pass(LiveTiming.helpRetryMs + 200)
            #expect(h.services.checkCalls == 2, "\(blip)")
            #expect(h.loop.hints.first?.message == "Look again at how you divided 8 by 2.", "\(blip)")
            #expect(h.loop.activity == .idle, "\(blip)")
        }
    }

    /// Help me's check fails twice: the engine's own words come on the card. Help is never an error.
    @Test func helpMeThatFailsTwiceGetsTheEnginesWords() async throws {
        let h = FaultHarness()
        await h.start()
        await h.slip()
        h.services.scriptCheck(error: APIError.timeout)
        h.services.scriptCheck(error: APIError.timeout)
        h.loop.helpMe()
        await h.pass(LiveTiming.helpRetryMs + 400)
        #expect(h.services.checkCalls == 2, "one retry, no more")
        #expect(h.loop.hints.first?.message.isEmpty == false, "a hint card, in the engine's words")
        #expect(h.loop.activity == .idle, "no error on top of the hint")
        await h.pass(5_000)
        #expect(h.services.checkCalls == 2)
    }

    /// The provider's credits ran out (OpenRouter's 402, sent as a 503 provider_unavailable): Help me
    /// still gets the engine's hint, no retry (nothing would change in a second), and never "out of ink".
    @Test func providerCreditsOutOnHelpMeIsTheEnginesHintNeverOutOfInk() async throws {
        let h = FaultHarness()
        await h.start()
        await h.slip()
        h.services.scriptCheck(error: Self.provider503)
        h.loop.helpMe()
        await h.pass(200)
        #expect(h.services.checkCalls == 1)
        #expect(h.loop.hints.first?.message.isEmpty == false)
        #expect(h.loop.activity != .outOfInk)
        // the same inside a stream: Ask's word for it, `credits_exhausted`, is the provider's too
        let s = FaultHarness()
        await s.start()
        await s.slip()
        s.services.scriptCheck([.meta(requestId: "r", model: "m"), .error(StreamError(code: "credits_exhausted", message: "resting", status: 503))])
        s.loop.helpMe()
        await s.pass(200)
        #expect(s.loop.activity != .outOfInk)
        #expect(s.loop.hints.first?.message.isEmpty == false)
    }

    /// Our own ink running out is still the grown-ups' job: help pauses, no retry, no hint pretending.
    @Test func ourOwnInkOnHelpMeStillPausesHelp() async throws {
        let h = FaultHarness()
        await h.start()
        await h.slip()
        h.services.scriptCheck(error: Self.ink402)
        h.loop.helpMe()
        await h.pass(LiveTiming.helpRetryMs + 400)
        #expect(h.services.checkCalls == 1)
        #expect(h.loop.activity == .outOfInk)
    }

    /// A rate limit on Help me: the kid sees the wait (the countdown), and nothing is sent meanwhile.
    @Test func aRateLimitOnHelpMeShowsTheWait() async throws {
        let h = FaultHarness()
        await h.start()
        await h.slip()
        h.services.scriptCheck(error: Self.http(429, #"{"error":"rate_limited","message":"Slow down","retryAfterMs":5000}"#))
        h.loop.helpMe()
        await h.pass(200)
        guard case .slowDown(_, false) = h.loop.activity else {
            Issue.record("expected the countdown, got \(h.loop.activity)")
            return
        }
        #expect(h.services.checkCalls == 1)
    }

    // MARK: - Solve it / Show me failing

    /// The model's solve fails like a blip before any step: tried once more, and the steps are written.
    @Test func solveRetriesABlipOnceAndWrites() async throws {
        let h = FaultHarness(mode: .answer)
        await h.start()
        // the engine cannot solve this one (the fake reader reads the ink as an ODE)
        await h.write("x = 3", at: Vec2(200, 120), reads: "y'' + y = 0")
        await h.pass(700)
        h.services.scriptSolve([.meta(requestId: "s", model: "m")], error: APIError.incomplete)
        h.services.scriptSolve([.meta(requestId: "s", model: "m"), try h.step(1, "r^{2} + 1 = 0"), .done(count: 1, ms: 1)])
        h.loop.solveIt()
        await h.pass(100)
        #expect(h.loop.activity == .solving)
        await h.pass(LiveTiming.helpRetryMs + 300)
        #expect(h.services.solveCalls == 2)
        #expect(!h.board.tutorStrokes(withMeta: "solvedLatex").isEmpty, "written on the second try")
        #expect(h.loop.activity == .idle)
    }

    /// Solve fails twice: Try again, in the kid's words; the provider out: the tutor is resting (never
    /// "ask a grown-up", never out of ink), and no retry.
    @Test func solveThatKeepsFailingSaysSoAndTheProviderOutIsResting() async throws {
        let h = FaultHarness(mode: .answer)
        await h.start()
        await h.write("x = 3", at: Vec2(200, 120), reads: "y'' + y = 0")
        await h.pass(700)
        h.services.scriptSolve(error: APIError.timeout)
        h.services.scriptSolve(error: APIError.timeout)
        h.loop.solveIt()
        await h.pass(LiveTiming.helpRetryMs + 400)
        #expect(h.services.solveCalls == 2)
        #expect(h.loop.activity == .trouble(retry: true))
        #expect(h.loop.troubleWords == LiveCopy.Status.trouble)

        let p = FaultHarness(mode: .answer)
        await p.start()
        await p.write("x = 3", at: Vec2(200, 120), reads: "y'' + y = 0")
        await p.pass(700)
        p.services.scriptSolve(error: Self.provider503)
        p.loop.solveIt()
        await p.pass(LiveTiming.helpRetryMs + 400)
        #expect(p.services.solveCalls == 1)
        #expect(p.loop.activity == .trouble(retry: true))
        #expect(p.loop.troubleWords == LiveCopy.Status.resting)
        // a stream's own error frame saying so
        let q = FaultHarness(mode: .answer)
        await q.start()
        await q.write("x = 3", at: Vec2(200, 120), reads: "y'' + y = 0")
        await q.pass(700)
        q.services.scriptSolve([.meta(requestId: "s", model: "m"),
                                .error(StreamError(code: "upstream_error", message: "x", reason: "provider_unavailable"))])
        q.loop.solveIt()
        await q.pass(LiveTiming.helpRetryMs + 400)
        #expect(q.loop.troubleWords == LiveCopy.Status.resting)
        #expect(q.loop.activity != .outOfInk)
    }

    /// Steps came, then the platform cut the stream off: the steps stand, no error.
    @Test func aSolveCutOffAfterItsStepsKeepsThem() async throws {
        let h = FaultHarness(mode: .answer)
        await h.start()
        await h.write("x = 3", at: Vec2(200, 120), reads: "y'' + y = 0")
        await h.pass(700)
        h.services.scriptSolve([.meta(requestId: "s", model: "m"), try h.step(1, "r^{2} + 1 = 0")], error: APIError.incomplete)
        h.loop.solveIt()
        await h.pass(300)
        #expect(h.services.solveCalls == 1)
        #expect(!h.board.tutorStrokes(withMeta: "solvedLatex").isEmpty)
        #expect(h.loop.activity == .idle)
    }

    /// Offline, Help me is held for the network; back online it runs once.
    @Test func helpMeOfflineRunsWhenTheNetworkIsBack() async throws {
        let h = FaultHarness()
        await h.start()
        await h.slip()
        h.connectivity.isOnline = false
        h.loop.helpMe()
        await h.pass(200)
        #expect(h.services.checkCalls == 0)
        #expect(h.loop.activity == .offline(waiting: 0))
        h.connectivity.isOnline = true
        await h.pass(500)
        #expect(h.services.checkCalls == 1)
        #expect(h.loop.hints.first?.message.isEmpty == false)
    }
}
