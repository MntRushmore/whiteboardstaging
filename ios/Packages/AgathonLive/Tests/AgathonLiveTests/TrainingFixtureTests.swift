import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation
import Testing
@testable import AgathonLive

/// The Training Center's regression tests: every case saved with "Save as regression test" (a JSON
/// fixture in `Fixtures/training/`, put there by the simulator's Debug build or by
/// `npm run training:fixtures` from the server's flagged rows) replayed through the loop — its page,
/// its strokes where they were written, the recognizer answering with the reads recorded when it ran
/// (no Mathpix: the test is the tutor's logic alone) — and each line's mark judged against what a
/// teacher wants (`TrainingJudge`, as the bench judged it).
///
/// A fixture's `status`: `open` while the tutor still gets it wrong (a known issue: the test says so
/// when it starts passing, so someone flips it to `fixed`), `fixed` once it is right (it must stay so).
@MainActor
@Suite(.serialized)
struct TrainingFixtureTests {
    /// Every fixture in the test bundle's `Fixtures/training`.
    static func fixtures() -> [(name: String, fixture: TrainingFixture)] {
        guard let folder = Bundle.module.url(forResource: "training", withExtension: nil, subdirectory: "Fixtures"),
              let files = try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) else { return [] }
        return files.filter { $0.pathExtension == "json" }.sorted { $0.lastPathComponent < $1.lastPathComponent }.compactMap { url in
            guard let data = try? Data(contentsOf: url), let f = try? TrainingFixture.decoder.decode(TrainingFixture.self, from: data) else { return nil }
            return (url.lastPathComponent, f)
        }
    }

    @Test func everySavedFixtureDecodes() throws {
        guard let folder = Bundle.module.url(forResource: "training", withExtension: nil, subdirectory: "Fixtures") else { return }
        let files = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil).filter { $0.pathExtension == "json" }
        for url in files {
            #expect(throws: Never.self, "\(url.lastPathComponent)") {
                _ = try TrainingFixture.decoder.decode(TrainingFixture.self, from: Data(contentsOf: url))
            }
        }
    }

    @Test func everySavedFixtureReplaysAsATeacherWants() async throws {
        for (name, fixture) in Self.fixtures() {
            let outcome = await Self.replay(fixture)
            let failures = outcome.lines.filter { $0.pass == false }.map { "\($0.written): \($0.why?.text ?? "")" } + (outcome.why.map { [$0.text] } ?? [])
            if fixture.status == "fixed" {
                #expect(outcome.pass != false, "\(name) (\(fixture.title)) regressed: \(failures)")
            } else {
                withKnownIssue("\(name) (\(fixture.title)) is open: \(fixture.why ?? "")", isIntermittent: true) {
                    #expect(outcome.pass != false, "\(name): \(failures)")
                }
            }
        }
    }

    /// The replay itself, on a fixture made here: a right two-step equation and a slip, the reads
    /// "recorded" from the brain's own payloads of the fixture ink. It must judge them as the bench would.
    @Test func theReplayJudgesARightPageAndASlip() async throws {
        try await TestBrain.shared.load()
        let right = try await Self.syntheticFixture(problem: ["2x + 3 = 11"], lines: [("2x = 8", .tick, .work), ("x = 4", .tick, .answer)], solved: true)
        let r = await Self.replay(right)
        #expect(!right.reads.isEmpty)
        #expect(r.pass == true, "\(r.lines.map { "\($0.written) \($0.mark) \($0.why?.text ?? "")" })")
        #expect(r.lines.map(\.mark) == [.tick, .tick])
        let slip = try await Self.syntheticFixture(problem: ["2x + 3 = 11"], lines: [("2x = 8", .tick, .work), ("x = 5", .ring, .answer)], solved: false)
        let s = await Self.replay(slip)
        #expect(s.pass == true, "\(s.lines.map { "\($0.written) \($0.mark) \($0.why?.text ?? "")" })")
        #expect(s.lines.map(\.mark) == [.tick, .ring])
        // and a wrong expectation fails, with its reason
        var wrong = slip
        wrong.lines[1].expect = .tick
        let w = await Self.replay(wrong)
        #expect(w.pass == false && w.lines[1].why?.code == .wrongRing)
    }

    // MARK: - the replay

    struct Outcome {
        var lines: [TrainingLineResult]
        var pass: Bool?
        var why: TrainingWhy?
    }

    /// A fixture on a test board: its page (the tutor's problem at the top, or a page of the writer's
    /// own), each line's strokes where they were written, the clock moving at a kid's pace, then Check.
    static func replay(_ f: TrainingFixture, labeling: LabelingServices? = nil) async -> Outcome {
        let board = TestBoard()
        let scheduler = ManualScheduler()
        let services: LiveServices = labeling ?? ReplayServices(reads: f.reads)
        let checking = CheckTiming(rawValue: f.settings.checking) ?? .whenDone
        let loop = LiveLoop(board: board, boardId: "training-fixture", services: services,
                            settings: LiveSettings(enabled: true, mode: LiveMode(rawValue: f.settings.mode) ?? .feedback, auto: f.settings.auto,
                                                   handwriting: true, celebrations: true, checking: checking, showReadings: true),
                            brain: TestBrain.shared, background: TestBrain.background, scheduler: scheduler, connectivity: ManualConnectivity())
        loop.pages.extras = true
        func idle() async {
            for _ in 0..<3 {
                await loop.waitUntilIdle(timeout: .seconds(20))
                await Task.yield()
            }
        }
        func pass(_ ms: Double) async {
            var left = ms
            while left > 0 {
                scheduler.advance(min(left, 100))
                left -= 100
                await idle()
            }
        }
        loop.start()
        await idle()
        // the page as the headless bench makes it (the problem in the tutor's hand, as the desk writes a
        // practice page), so a case saved from a bench run replays exactly
        _ = await HeadlessBench.page(f.problem, on: board, loop: loop, brain: TestBrain.shared)
        await pass(300)
        var ids: [[RecordID]] = []
        for line in f.lines {
            let strokes = line.strokes.map { s in zip(s.x, s.y).map { Vec2($0, $1) } }
            labeling?.current = line.read ?? line.written
            ids.append(board.kidWrites(strokes))
            await pass(1_400)
        }
        await pass(2_000)
        if checking == .whenDone { loop.checkPage() }
        await pass(3_000)
        // judged as the bench judges (`TrainingBench.observe`): a line with no strokes was rubbed out
        let spec = TrainingCase(id: f.caseKey, category: f.category, grade: f.grade ?? .g56, topic: "", problem: f.problem,
                                lines: f.lines.map { TrainingLineSpec($0.written, $0.expect, value: $0.value, place: $0.place) }, solved: f.solved)
        let erased = Set(f.lines.indices.filter { f.lines[$0].strokes.isEmpty })
        var results = TrainingBench.observe(spec: spec, ids: ids, erased: erased, loop: loop)
        // the fixture's own read of a line is what "right" means here (a misread is the recorder's)
        for (k, line) in f.lines.enumerated() {
            if let recorded = line.read { results[k].meaning = recorded }
        }
        let judged = TrainingJudge.judge(lines: results, solvedExpected: f.solved, solvedGot: loop.trainingSolved)
        loop.stop()
        return Outcome(lines: judged.lines, pass: judged.pass, why: judged.why)
    }

    /// A fixture made from the scoreboard's fixture ink, its reads recorded as the brain's payloads of
    /// that ink (what the bench would have recorded).
    static func syntheticFixture(problem: [String]?, lines: [(String, TrainingExpect, TrainingPlace)], solved: Bool?) async throws -> TrainingFixture {
        var flines: [TrainingFixture.Line] = []
        var y = 268.0
        for (latex, expect, place) in lines {
            let at = place == .answer ? Vec2(300, 768) : Vec2(160, y)
            let ink = KidHands.strokes(latex, hand: "clean", at: at, scale: 1.4)
            y += 90
            flines.append(TrainingFixture.Line(written: latex, expect: expect, value: nil, place: place,
                                               strokes: ink.map { TrainingStroke(x: $0.map(\.x), y: $0.map(\.y)) }, read: latex, mark: .none))
        }
        let r = TrainingCaseResult(kind: .bench, caseKey: "synthetic", category: .multiStep, grade: .g56, topic: "algebra", hand: "clean",
                                   problem: problem ?? [], spec: nil, lines: [], strokes: [], solvedExpected: solved,
                                   solvedGot: false, pass: nil)
        var f = TrainingFixture(r, settings: .init())
        f.lines = flines
        f.status = "fixed"
        // the reads, recorded as a run records them: a first pass whose recognizer reads each line as
        // what was written there, keeping the requests (the payloads the loop itself built)
        let labeling = LabelingServices()
        _ = await replay(f, labeling: labeling)
        f.reads = labeling.recorded
        return f
    }
}

/// A recognizer that reads every line as `current` (the line just written) and records each request
/// with its answer, as `TrainingServices` does in a real run.
final class LabelingServices: LiveServices, @unchecked Sendable {
    var current = ""
    private(set) var recorded: [RecordedRead] = []

    func capabilities() async throws -> LiveCapabilities { LiveCapabilities(recognizer: "mathpix", liveEnabled: true, models: nil) }

    func recognize(_ request: RecognizeRequest) async throws -> RecognizeResponse {
        let latex = current
        recorded.append(RecordedRead(lineId: request.lineId, x: request.strokes.x, y: request.strokes.y, w: request.bounds.w, h: request.bounds.h,
                                     latex: latex, confidence: 0.995, provider: "mathpix", ms: 300, error: nil, at: 0))
        return RecognizeResponse(latex: latex, confidence: 0.995)
    }

    func reread(_ request: RereadRequest) async throws -> RereadResponse { RereadResponse(latex: request.latex, changed: false, model: "label", ms: 1) }
    func setup(_ request: SetupRequest) async throws -> SetupResponse { throw APIError.timeout }
    func check(_ request: CheckRequest) -> LiveEventStream { LiveEventStream { $0.finish() } }
    func solve(_ request: SolveRequest) -> LiveEventStream { LiveEventStream { $0.finish() } }
}

/// The recognizer as the fixture recorded it; the rest of the routes say nothing.
final class ReplayServices: LiveServices, @unchecked Sendable {
    let reads: [RecordedRead]

    init(reads: [RecordedRead]) {
        self.reads = reads
    }

    func capabilities() async throws -> LiveCapabilities {
        LiveCapabilities(recognizer: "mathpix", liveEnabled: true, models: nil)
    }

    func recognize(_ request: RecognizeRequest) async throws -> RecognizeResponse {
        guard let r = TrainingReplay.match(x: request.strokes.x, y: request.strokes.y, in: reads), let latex = r.latex else {
            throw APIError.http(HTTPFailure(status: 503, code: "recognizer_failed", message: "not in the fixture", body: .object(["unreadable": .bool(true)])))
        }
        return RecognizeResponse(latex: latex, confidence: r.confidence ?? 0.99, provider: r.provider ?? "mathpix", ms: r.ms)
    }

    func reread(_ request: RereadRequest) async throws -> RereadResponse {
        RereadResponse(latex: request.latex, changed: false, model: "fixture", ms: 1)
    }

    func setup(_ request: SetupRequest) async throws -> SetupResponse {
        throw APIError.http(HTTPFailure(status: 502, code: "upstream_error", message: "no setup in a fixture"))
    }

    func check(_ request: CheckRequest) -> LiveEventStream {
        LiveEventStream { $0.finish() }
    }

    func solve(_ request: SolveRequest) -> LiveEventStream {
        LiveEventStream { $0.finish() }
    }
}
