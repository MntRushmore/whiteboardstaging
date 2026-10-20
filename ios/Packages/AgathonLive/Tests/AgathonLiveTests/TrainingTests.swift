import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation
import Testing
@testable import AgathonLive

/// The Training Center's core (docs/TRAINING-CENTER.md): the comparison of what the tutor did with
/// what a teacher wants, the run's numbers, the catalogue and the generators (every line writable by
/// the hand, expectations that make sense), the synthetic hands (bit for bit the web scoreboard's),
/// and the training services (the flag on every paid call, the budget, the record of reads).
@MainActor
@Suite(.serialized)
struct TrainingTests {
    func line(_ written: String, expect: TrainingExpect?, read: String? = nil, mark: TrainingMark = .none, released: Bool = true,
              pieces: Int = 1, value: String? = nil, result: String? = nil, reading: String? = nil) -> TrainingLineResult {
        TrainingLineResult(index: 0, written: written, meaning: written, expect: expect, value: value, place: .work, read: read ?? written,
                           reading: reading, result: result, mark: mark, released: released, pieces: pieces)
    }

    // MARK: - the comparison

    @Test func expectationsAcceptTheMarksATeacherWould() {
        #expect(TrainingExpect.tick.accepts(.tick) && !TrainingExpect.tick.accepts(.none))
        #expect(TrainingExpect.quiet.accepts(.none) && !TrainingExpect.quiet.accepts(.tick) && !TrainingExpect.quiet.accepts(.question))
        #expect(TrainingExpect.ring.accepts(.ring) && !TrainingExpect.ring.accepts(.tick))
        #expect(TrainingExpect.calm.accepts(.tick) && TrainingExpect.calm.accepts(.none))
        #expect(!TrainingExpect.calm.accepts(.ring) && !TrainingExpect.calm.accepts(.question))
    }

    @Test func aLineFailsWithTheReasonTheOwnerCanActOn() {
        let ok = TrainingJudge.judge(line("2x = 8", expect: .tick, mark: .tick))
        #expect(ok.pass == true && ok.why == nil && ok.readRight == true)
        // the owner's iPad: `+3 = 767` ringed
        let wrongRing = TrainingJudge.judge(line("+3 = 767", expect: .tick, mark: .ring))
        #expect(wrongRing.pass == false && wrongRing.why?.code == .wrongRing)
        let missed = TrainingJudge.judge(line("= 421", expect: .ring, mark: .none))
        #expect(missed.why?.code == .missedRing)
        let misread = TrainingJudge.judge(line("= 431", expect: .tick, read: "= 481", mark: .ring))
        #expect(misread.why?.code == .misread && misread.readRight == false)
        #expect(misread.why?.text.contains("481") == true)
        let held = TrainingJudge.judge(line("x = 4", expect: .tick, mark: .none, released: false))
        #expect(held.why?.code == .held)
        let asked = TrainingJudge.judge(line("x = 5", expect: .ring, mark: .none, reading: "asking"))
        #expect(asked.why?.code == .asked)
        let unread = TrainingJudge.judge(line("x = 5", expect: .ring, read: "", mark: .question))
        #expect(unread.why?.code == .unread)
        let split = TrainingJudge.judge(line("3.45 + 2.80 = 6.25", expect: .tick, mark: .tick, pieces: 2))
        #expect(split.why?.code == .split)
        let merged = TrainingJudge.judge(line("x = 4", expect: .tick, mark: .tick, pieces: 0))
        #expect(merged.why?.code == .merged)
        // ringed for the wrong reason: the tutor's value is not the right one
        let value = TrainingJudge.judge(line("= 421", expect: .ring, mark: .ring, value: "431", result: "411"))
        #expect(value.pass == false && value.why?.code == .wrongValue)
        let rightValue = TrainingJudge.judge(line("= 421", expect: .ring, mark: .ring, value: "431", result: "431"))
        #expect(rightValue.pass == true)
        // not judged: nothing expected
        #expect(TrainingJudge.judge(line("x", expect: nil)).pass == nil)
    }

    @Test func aPageAlsoFailsWhenItsSolvedIsWrong() {
        let lines = [line("2x = 8", expect: .tick, mark: .tick)]
        let solved = TrainingJudge.judge(lines: lines, solvedExpected: true, solvedGot: true)
        #expect(solved.pass == true)
        let missed = TrainingJudge.judge(lines: lines, solvedExpected: true, solvedGot: false)
        #expect(missed.pass == false && missed.why?.code == .notSolved)
        let falsely = TrainingJudge.judge(lines: lines, solvedExpected: false, solvedGot: true)
        #expect(falsely.why?.code == .falselySolved)
        #expect(TrainingJudge.judge(lines: lines, solvedExpected: nil, solvedGot: false).pass == true, "solved not judged")
    }

    @Test func readsAreTheSameMathsGiveOrTakeSpelling() {
        #expect(TrainingJudge.sameMaths("2 x+3=11", "2x + 3 = 11"))
        #expect(TrainingJudge.sameMaths("\\frac{3}{4}", "\\dfrac {3}{4}"))
        #expect(TrainingJudge.sameMaths("3 \\cdot 4 = 12", "3 \\times 4 = 12"))
        #expect(TrainingJudge.sameMaths("x=4.", "x = 4"))
        #expect(TrainingJudge.sameMaths("\\left(x-2\\right)(x-3)=0", "(x - 2)(x - 3) = 0"))
        #expect(!TrainingJudge.sameMaths("0=5", "a = 5"))
        #expect(!TrainingJudge.sameMaths("= 481", "= 431"))
    }

    @Test func theSummaryCutsByCategoryHandAndGrade() {
        func result(_ cat: TrainingCategory, _ hand: String, _ grade: TrainingGrade, pass: [Bool], readMs: Double) -> TrainingCaseResult {
            let lines = pass.enumerated().map { i, p in
                TrainingLineResult(index: i, written: "x", meaning: "x", expect: .tick, value: nil, place: .work, read: "x", mark: p ? .tick : .ring,
                                   released: true, pieces: 1, readMs: readMs, readRight: true, pass: p, why: p ? nil : TrainingWhy(.wrongRing, "ringed"))
            }
            return TrainingCaseResult(kind: .bench, caseKey: "k", category: cat, grade: grade, topic: "t", hand: hand, problem: [], spec: nil,
                                      lines: lines, strokes: [], solvedExpected: nil, solvedGot: false, pass: pass.allSatisfy { $0 },
                                      calls: ["recognize": pass.count, "check": 1], checkMs: 1_000)
        }
        let s = TrainingSummary([
            result(.runningTotal, "messy", .g34, pass: [true, false], readMs: 400),
            result(.runningTotal, "clean", .g34, pass: [true, true], readMs: 500),
            result(.fractions, "messy", .g56, pass: [true], readMs: 900),
        ])
        #expect(s.cases == 3 && s.passed == 2 && s.lines == 5 && s.linesPassed == 4)
        #expect(s.byCategory.first { $0.name == TrainingCategory.runningTotal.title }?.lines == 4)
        #expect(s.byHand.first { $0.name == "messy" }?.linesPassed == 2)
        #expect(s.byGrade.map(\.name) == ["3-4", "5-6"])
        #expect(s.reasons.first?.code == .wrongRing && s.wrongRings == 1)
        #expect(s.readP50 == 500 && s.readP90 == 900)
        #expect(s.calls == ["recognize": 5, "check": 3])
        #expect(s.ink == 5 + 9, "a recognize is 1 ink, a check 3")
        #expect(TrainingSummary.percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9) == 9)
    }

    // MARK: - the catalogue and the generators

    @Test func theCatalogueCoversEveryKindOfWritingWithRightAndWrongWork() {
        let all = TrainingCatalogue.all
        #expect(all.count >= 100, "\(all.count) cases")
        #expect(Set(all.map(\.id)).count == all.count, "ids are unique")
        for category in TrainingCategory.allCases where category != .generated {
            #expect(!TrainingCatalogue.cases(in: category).isEmpty, "\(category) has cases")
        }
        #expect(all.filter(\.wrong).count >= 30, "deliberately wrong work: \(all.filter(\.wrong).count)")
        for c in all {
            #expect(!c.lines.isEmpty, "\(c.id)")
            // a wrong solution has a ring somewhere, and is never solved
            if c.wrong { #expect(c.lines.contains { $0.expect == .ring } && c.solved != true, "\(c.id)") }
            // the writer's own problem comes first, on a page with no tutor problem
            if c.lines.contains(where: { $0.place == .problem }) { #expect(c.problem == nil && c.lines.first?.place == .problem, "\(c.id)") }
            // a ring's right value differs from what was written
            for l in c.lines where l.expect == .ring { if let v = l.value { #expect(!TrainingJudge.sameMaths(v, l.latex), "\(c.id): \(l.latex)") } }
        }
        // the owner's own cases are in it
        #expect(all.contains { $0.lines.contains { $0.latex == "+3 = 767" } })
        #expect(all.contains { $0.problem == ["767 - 336"] && $0.lines.contains { $0.latex == "= 431" } })
    }

    @Test func everyCatalogueLineIsOneTheHandCanWrite() async throws {
        try await TestBrain.shared.load()
        var unwritable: [String] = []
        for c in TrainingCatalogue.all {
            for l in c.lines {
                let ink = try await StudentHand.ink(l.latex, hand: .messy, brain: TestBrain.shared)
                if ink?.isEmpty != false { unwritable.append("\(c.id): \(l.latex)") }
            }
        }
        #expect(unwritable.isEmpty, "\(unwritable)")
    }

    @Test func thePlanIsSeededAndKeepsToTheConfig() async throws {
        try await TestBrain.shared.load()
        var config = TrainingConfig(grades: [.k2, .g34], categories: [.runningTotal, .facts, .equalsNextLine, .generated], count: 10,
                                    hands: ["clean", "messy", "steep"], includeWrong: true, includeGenerated: true, seed: 4)
        let a = await TrainingGenerator.plan(config, brain: TestBrain.shared)
        let b = await TrainingGenerator.plan(config, brain: TestBrain.shared)
        #expect(a == b, "the same seed, the same cases in the same hands")
        #expect(a.count == 10)
        #expect(Set(a.map(\.hand.name)) == ["clean", "messy", "steep"])
        for p in a {
            #expect([TrainingGrade.k2, .g34].contains(p.spec.grade), "\(p.spec.id) \(p.spec.grade)")
            #expect([TrainingCategory.runningTotal, .facts, .equalsNextLine, .generated].contains(p.spec.category))
        }
        #expect(a.contains { $0.spec.source == .practice }, "the brain's practice problems are mixed in")
        config.includeWrong = false
        config.includeGenerated = false
        let right = await TrainingGenerator.plan(config, brain: TestBrain.shared)
        #expect(right.allSatisfy { !$0.spec.wrong && $0.spec.source == .catalogue })
        config.seed = 5
        #expect(await TrainingGenerator.plan(config, brain: TestBrain.shared).map(\.spec.id) != right.map(\.spec.id), "another seed, another order")
    }

    @Test func practiceProblemsAreWorkedByTheEngineRightAndWithASlip() async throws {
        try await TestBrain.shared.load()
        let cases = await TrainingGenerator.practiceCases(grades: [.g78], count: 6, seed: 3, includeWrong: true, brain: TestBrain.shared)
        #expect(cases.count >= 4, "\(cases.map(\.id))")
        let right = cases.filter { !$0.wrong }
        let slips = cases.filter(\.wrong)
        #expect(!right.isEmpty && !slips.isEmpty)
        for c in right {
            #expect(c.solved == true && c.lines.last?.expect == .tick && c.lines.last?.place == .answer, "\(c.id)")
            // the engine says its own last step solves the problem
            let a = try await TestBrain.shared.judgeLine(c.lines.last!.latex, problem: c.problem, above: c.lines.dropLast().map(\.latex))
            #expect(a.verdict != "mismatch", "\(c.id): \(c.lines.map(\.latex)) \(a.verdict)")
        }
        for c in slips {
            let last = try #require(c.lines.last)
            #expect(last.expect == .ring && c.solved == false && last.value != nil, "\(c.id)")
        }
        #expect(TrainingGenerator.bump("x = 4")! == ("x = 5", "4"))
        #expect(TrainingGenerator.bump("85")! == ("86", "85"))
        #expect(TrainingGenerator.bump("x") == nil)
    }

    // MARK: - the hands

    /// The Swift hands are the web scoreboard's `handInk`, bit for bit (to the fixture's 0.01): the
    /// same glyphs (the brain's `layoutMath`), the same pen (`mulberry32`, the warp, the slant, the tilt).
    @Test func theSyntheticHandsAreTheScoreboardsOwn() async throws {
        try await TestBrain.shared.load()
        var compared = 0
        for (latex, byHand) in KidHands.file.lines {
            for (name, strokes) in byHand {
                let hand = try #require(TrainingHand.named(name))
                let ink = try #require(try await StudentHand.scoreboardInk(latex, hand: hand, brain: TestBrain.shared), "\(latex) \(name)")
                #expect(ink.count == strokes.count, "\(latex) \(name): \(ink.count) strokes vs \(strokes.count)")
                let x0 = ink.flatMap { $0 }.map(\.x).min()!, y0 = ink.flatMap { $0 }.map(\.y).min()!
                var worst = 0.0
                for (mine, theirs) in zip(ink, strokes) {
                    for (p, (x, y)) in zip(mine, zip(theirs.x, theirs.y)) {
                        worst = max(worst, abs((p.x - x0) - x), abs((p.y - y0) - y))
                    }
                }
                #expect(worst < 0.011, "\(latex) \(name): off by \(worst)")
                compared += 1
            }
        }
        #expect(compared >= 40)
    }

    @Test func aKidSizedHandIsBiggerAndStartsAtZero() async throws {
        try await TestBrain.shared.load()
        let clean = try #require(try await StudentHand.ink("2x + 3 = 11", hand: .clean, brain: TestBrain.shared))
        let big = try #require(try await StudentHand.ink("2x + 3 = 11", hand: .big, brain: TestBrain.shared))
        let pts = clean.flatMap { $0 }
        #expect(abs(pts.map(\.x).min()!) < 0.001 && abs(pts.map(\.y).min()!) < 0.001)
        #expect(big.flatMap { $0 }.map(\.x).max()! > pts.map(\.x).max()! * 1.2)
        // what the hand has no glyph for is refused, never drawn wrong
        #expect(try await StudentHand.ink("9 \\longdiv { 144 }", hand: .clean, brain: TestBrain.shared) == nil)
    }

    // MARK: - the services

    @Test func trainingCallsCarryTheFlagAndStopAtTheBudget() async throws {
        let transport = RecordingTransport()
        let api = APIClient(baseURL: URL(string: "http://localhost:9")!, transport: transport, token: { "token" })
        let services = TrainingServices(api: api, live: LiveAPI(sse: SSEClient(api: api)), budget: 2)
        let payload = try JSONDecoder().decode(RecognizerPayload.self, from: Data(#"{"strokes":{"x":[[1,2]],"y":[[3,4]]},"bounds":{"w":10,"h":5},"hash":"h","points":2}"#.utf8))
        let res = try await services.recognize(RecognizeRequest(boardId: "b", lineId: "ln_1", payload: payload))
        #expect(res.latex == "x=4")
        let body = try #require(transport.bodies.first)
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(json["training"] as? Bool == true, "the flag rides with the body")
        #expect(json["lineId"] as? String == "ln_1", "the request's own fields are all there")
        #expect(services.reads.first?.latex == "x=4" && services.reads.first?.x == [[1, 2]], "the read is recorded with its strokes")
        _ = try await services.recognize(RecognizeRequest(boardId: "b", lineId: "ln_2", payload: payload))
        await #expect(throws: TrainingBudgetSpent.self) {
            _ = try await services.recognize(RecognizeRequest(boardId: "b", lineId: "ln_3", payload: payload))
        }
        #expect(transport.bodies.count == 2, "a call past the budget is never made")
        #expect(services.calls == ["recognize": 2] && services.refused == 1 && services.spent)
        // capabilities are free: not counted, and allowed past the budget
        _ = try? await services.capabilities()
        #expect(services.totalCalls == 2)
    }

    @Test func aFixtureRoundTripsAndItsReadsAreFoundAgain() throws {
        let read = RecordedRead(lineId: "ln_1", x: [[0, 10, 20]], y: [[0, 5, 0]], w: 20, h: 5, latex: "2x=8", confidence: 0.99, provider: "mathpix",
                                ms: 300, error: nil, at: 1)
        let r = TrainingCaseResult(kind: .bench, caseKey: "ms-2x3-ok", category: .multiStep, grade: .g56, topic: "algebra", hand: "messy",
                                   problem: ["2x + 3 = 11"], spec: nil,
                                   lines: [TrainingLineResult(index: 0, written: "2x = 8", meaning: "2x = 8", expect: .tick, value: nil, place: .work,
                                                              read: "2x=8", mark: .ring, pass: false, why: TrainingWhy(.wrongRing, "ringed"))],
                                   strokes: [[TrainingStroke(x: [100, 110], y: [300, 305])]], reads: [read], solvedExpected: true, solvedGot: false,
                                   pass: false)
        let fixture = TrainingFixture(r, settings: .init())
        let back = try TrainingFixture.decoder.decode(TrainingFixture.self, from: fixture.encoded())
        #expect(back == fixture)
        #expect(back.status == "open" && back.lines.first?.expect == .tick && back.lines.first?.mark == .ring)
        #expect(back.fileName.hasPrefix("ms-2x3-ok-") && back.fileName.hasSuffix(".json"))
        #expect(TrainingReplay.match(x: [[0, 10, 20]], y: [[0, 5, 0]], in: [read])?.latex == "2x=8", "the same strokes")
        #expect(TrainingReplay.match(x: [[0.2, 10.1, 19.9]], y: [[0, 5.2, 0]], in: [read])?.latex == "2x=8", "a point rounded differently")
        #expect(TrainingReplay.match(x: [[0, 50]], y: [[0, 5]], in: [read]) == nil, "another line")
        // My Pencil: a 👎 that says "ring it" becomes the expectation
        var pencil = r
        pencil.lines[0].expect = nil
        pencil.lines[0].review = TrainingReview(thumbsUp: false, should: .quiet)
        #expect(TrainingFixture(pencil, settings: .init()).lines[0].expect == .quiet)
        pencil.lines[0].review = TrainingReview(thumbsUp: true)
        #expect(TrainingFixture(pencil, settings: .init()).lines[0].expect == .ring, "a 👍 keeps the mark it got")
    }
}

/// A transport that answers every POST with a recognizer read, keeping the bodies.
final class RecordingTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var _bodies: [Data] = []
    var bodies: [Data] { lock.withLock { _bodies } }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        if let body = request.httpBody { lock.withLock { _bodies.append(body) } }
        let json = request.httpMethod == "GET"
            ? #"{"recognizer":"mathpix","liveEnabled":true}"#
            : #"{"latex":"x=4","text":"x=4","kind":"math","confidence":0.99,"provider":"mathpix","ms":120}"#
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        return (Data(json.utf8), response)
    }

    func stream(for request: URLRequest) async throws -> (HTTPURLResponse, AsyncThrowingStream<Data, Error>) {
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
        return (response, AsyncThrowingStream { $0.finish() })
    }
}
