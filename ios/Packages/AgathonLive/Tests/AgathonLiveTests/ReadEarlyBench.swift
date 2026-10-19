import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation
import QuartzCore
import Testing
@testable import AgathonLive

/// The timing bench for reading early: the loop on the real clock (`MainScheduler`), the four fixture
/// hands replayed at a kid's pace (`KidPace`, per stroke: pen down, draw, pen up, pause), the
/// recognizer a fake that answers in 400 ± 60 ms (the round trip the tutor lane measured). Three
/// right chains per hand (12 chains, 36 lines, 24 ticks) per configuration, all at once.
///
/// Off by default (a few minutes of real time):
///
///     TEST_RUNNER_LIVE_BENCH=1 xcodebuild test-without-building -scheme AgathonLive \
///       -only-testing:AgathonLiveTests/ReadEarlyBench -destination …
///
/// Prints one `BENCH` line per configuration: pen-up → tick (median, p90), pen-up → read, recognize
/// calls per line, early reads started / used / stopped, and lines that ended wrong (must be 0).
@MainActor
@Suite(.serialized, .enabled(if: ProcessInfo.processInfo.environment["LIVE_BENCH"] == "1"))
struct ReadEarlyBench {
    struct Config {
        var name: String
        var pace: KidPace
        var early: Bool
        var hover = false
        var delay: Double?
    }

    struct ChainResult {
        var markMs: [Double] = []
        var readMs: [Double] = []
        var calls = 0
        var lines = 0
        var early = 0
        var used = 0
        var cancelled = 0
        var flushes = 0
        var wrong = 0
        var realReads: [String] = []
    }

    static let chains = [["2x + 3 = 11", "2x = 8", "x = 4"], ["3x - 5 = 10", "3x = 15", "x = 5"], ["5x + 2 = 17", "5x = 15", "x = 3"]]
    static let hands = ["clean", "slanted", "steep", "messy"]
    static let brains: [Brain] = [TestBrain.shared, Brain(), Brain(), Brain()]

    @Test func readingEarly() async throws {
        for b in Self.brains { _ = try await b.load() }
        var configs: [Config] = []
        for pace in [KidPace.typical, .brisk, .slow] {
            configs.append(Config(name: "gate only", pace: pace, early: false))
            configs.append(Config(name: "early", pace: pace, early: true))
            configs.append(Config(name: "early + hover", pace: pace, early: true, hover: true))
        }
        for d in [150.0, 200.0, 250.0] {
            configs.append(Config(name: "early, fixed \(Int(d)) ms", pace: .typical, early: true, delay: d))
        }
        for config in configs {
            let results = await withTaskGroup(of: ChainResult.self) { group in
                var i = 0
                for (h, hand) in Self.hands.enumerated() {
                    for (c, chain) in Self.chains.enumerated() {
                        let brain = Self.brains[i % Self.brains.count]
                        let seed = UInt64(1_000 + h * 10 + c)
                        group.addTask { @MainActor in await self.play(chain, hand: hand, config: config, brain: brain, seed: seed) }
                        i += 1
                    }
                }
                var all: [ChainResult] = []
                for await r in group { all.append(r) }
                return all
            }
            report(config, results)
        }
    }

    func report(_ config: Config, _ rs: [ChainResult]) {
        let marks = rs.flatMap(\.markMs), reads = rs.flatMap(\.readMs)
        let lines = rs.reduce(0) { $0 + $1.lines }, calls = rs.reduce(0) { $0 + $1.calls }
        func pct(_ xs: [Double], _ p: Double) -> String {
            guard !xs.isEmpty else { return "–" }
            let s = xs.sorted()
            return String(format: "%.0f", s[min(s.count - 1, Int((p * Double(s.count)).rounded(.up)) - 1)])
        }
        let sum = { (k: KeyPath<ChainResult, Int>) in rs.reduce(0) { $0 + $1[keyPath: k] } }
        print("BENCH pace=\(config.pace.name) config=\"\(config.name)\" tick_p50=\(pct(marks, 0.5)) tick_p90=\(pct(marks, 0.9)) (n=\(marks.count)) "
              + "read_p50=\(pct(reads, 0.5)) read_p90=\(pct(reads, 0.9)) (n=\(reads.count)) calls_per_line=\(String(format: "%.3f", Double(calls) / Double(max(lines, 1)))) "
              + "calls=\(calls) lines=\(lines) early=\(sum(\.early)) used=\(sum(\.used)) stopped=\(sum(\.cancelled)) flushes=\(sum(\.flushes)) wrong=\(sum(\.wrong))")
    }

    // MARK: - one chain

    /// - Parameter real: the real Live routes (the local stack): no fake, no registered reads
    func play(_ chain: [String], hand: String, config: Config, brain: Brain, seed: UInt64, real: LiveServices? = nil) async -> ChainResult {
        let board = TestBoard()
        let fake = FakeServices()
        let loop = LiveLoop(board: board, boardId: "ipad-fast-bench", services: real ?? fake,
                            settings: LiveSettings(enabled: true, mode: .feedback, auto: true, checking: .asIGo), brain: brain,
                            background: TestBrain.background, scheduler: MainScheduler(), connectivity: ManualConnectivity())
        loop.readsEarly = config.early
        loop.earlyDelayOverride = config.delay
        let origins = chain.indices.map { Vec2(200, 120 + Double($0) * 110) }
        if real == nil {
            await registerPrefixes(chain, hand: hand, origins: origins, services: fake, brain: brain)
            let dice = LatencyDice(seed: seed &* 7_919)
            fake.readLatency = { dice.next() }
        }
        loop.start()
        await loop.waitUntilIdle(timeout: .seconds(10))

        var rng = SplitMix(seed: seed)
        var result = ChainResult()
        var lastStrokes: [(id: String, mark: Bool)] = []
        for (i, latex) in chain.enumerated() {
            let strokes = KidHands.strokes(latex, hand: hand, at: origins[i])
            let steps = config.pace.steps(strokes, rng: &rng)
            for (pts, step) in zip(strokes, steps) {
                if step.pauseMs > 0 {
                    // hovering where the next stroke starts: over the line
                    if config.hover, let p = pts.first { board.onHover?(AgathonBrain.Point(x: p.x, y: p.y)) }
                    await Self.sleep(step.pauseMs)
                }
                board.onHover?(nil)
                board.isPenDown = true
                board.onPen?(true)
                await Self.sleep(step.drawMs)
                board.isPenDown = false
                let id = board.kidWrites([pts])
                board.onPen?(false)
                if pts == strokes.last { lastStrokes.append((id.first?.rawValue ?? "", i > 0)) }
            }
            let pause = config.pace.lineBreak(&rng)
            if config.hover, let end = strokes.last?.last {
                // the pen floats down to where the next line starts
                let next = Vec2(origins[0].x, origins[i].y + 110 + 20)
                Task { @MainActor in
                    await Self.sleep(40)
                    for k in 1...20 {
                        let p = end.lerp(next, Double(k) / 20)
                        board.onHover?(AgathonBrain.Point(x: p.x, y: p.y))
                        await Self.sleep(16)
                    }
                }
            }
            await Self.sleep(pause)
        }
        await Self.sleep(1_500)
        await loop.waitUntilIdle(timeout: .seconds(10))
        let m = loop.metrics
        for (id, mark) in lastStrokes {
            if let read = m.readAfterPenUp[id] { result.readMs.append(read) }
            if mark, let ms = m.markAfterPenUp[id] { result.markMs.append(ms) }
        }
        result.calls = m.calls["recognize"] ?? 0
        result.lines = chain.count
        result.early = m.readsEarly
        result.used = m.readsEarlyUsed
        result.cancelled = m.readsEarlyCancelled
        result.flushes = m.earlyFlushes
        // every line read whole, every step after the first ticked (a real reader may read a line its own way)
        let reads = Set(loop.lines.values.map(\.latex))
        result.wrong = chain.filter { !reads.contains($0) }.count + chain.dropFirst().filter { board.mark(on: $0) != .tick }.count
        result.realReads = loop.lines.values.sorted { $0.row < $1.row }.map(\.latex)
        loop.stop()
        return result
    }

    /// Every stroke-prefix of every line is read as the matching start of its LaTeX: a line read
    /// half-written reads as half a line, as Mathpix would.
    func registerPrefixes(_ chain: [String], hand: String, origins: [Vec2], services: FakeServices, brain: Brain) async {
        let scratch = TestBoard()
        for (i, latex) in chain.enumerated() {
            let ids = scratch.kidWrites(KidHands.strokes(latex, hand: hand, at: origins[i]))
            let all = scratch.store.kidStrokes(on: scratch.currentScreenID)
            let chars = Array(latex)
            for k in 1...ids.count {
                let set = Set(ids.prefix(k).map(\.rawValue))
                let cut = Int((Double(chars.count) * Double(k) / Double(ids.count)).rounded())
                let read = String(chars.prefix(cut)).trimmingCharacters(in: .whitespaces)
                if let payload = try? await brain.recognizerPayload(all.filter { set.contains($0.id) }) {
                    services.register(payload, as: RecognizeResponse(latex: read, confidence: 0.995))
                }
            }
        }
    }

    static func sleep(_ ms: Double) async {
        try? await Task.sleep(nanoseconds: UInt64(max(0, ms) * 1_000_000))
    }
}

/// The fake network's round trip: 400 ± 60 ms (normal, kept within 250–650), seeded.
final class LatencyDice: @unchecked Sendable {
    private let lock = NSLock()
    private var rng: SplitMix

    init(seed: UInt64) {
        rng = SplitMix(seed: seed)
    }

    func next() -> Duration {
        lock.withLock {
            let u1 = max(1e-9, Double(rng.next() % 1_000_000) / 1_000_000)
            let u2 = Double(rng.next() % 1_000_000) / 1_000_000
            let z = sqrt(-2 * log(u1)) * cos(2 * .pi * u2)
            return .milliseconds(Int(min(650, max(250, 400 + 60 * z))))
        }
    }
}

/// The same replay against the LOCAL stack's real routes (`/api/live/recognize` → Mathpix), never
/// production: one chain in two hands, the gate alone and then reading early (a fresh loop each, so
/// nothing comes from the cache). About 12–16 real reads. Skipped unless LIVE_BENCH_REAL=1:
///
///     TEST_RUNNER_LIVE_BENCH_REAL=1 TEST_RUNNER_AGATHON_API_URL=http://localhost:3801 \
///     TEST_RUNNER_SUPABASE_URL=http://127.0.0.1:54321 TEST_RUNNER_SUPABASE_ANON_KEY=<local anon key> \
///     xcodebuild test-without-building -scheme AgathonLive -only-testing:AgathonLiveTests/ReadEarlyRealBench …
@MainActor
@Suite(.serialized, .enabled(if: ProcessInfo.processInfo.environment["LIVE_BENCH_REAL"] == "1"))
struct ReadEarlyRealBench {
    @Test func readingEarlyAgainstTheLocalStack() async throws {
        let env = ProcessInfo.processInfo.environment
        let environment = try AgathonEnvironment.resolve(environment: env, allowOverrides: true)
        try #require(environment.isLocal, "only against the local stack")
        let backend = AgathonBackend(environment: environment, release: AppRelease(version: "0", build: "fast-bench"), authStorage: InMemoryAuthStorage())
        backend.auth.start()
        try await backend.auth.signIn(email: env["AGATHON_TEST_EMAIL"] ?? "qa-student@example.com", password: env["AGATHON_TEST_PASSWORD"] ?? "password123")
        let services = LiveAPIServices(backend: backend)
        _ = try await TestBrain.shared.load()
        let bench = ReadEarlyBench()
        let chain = ["2x + 3 = 11", "2x = 8", "x = 4"]
        for early in [false, true] {
            var all: [ReadEarlyBench.ChainResult] = []
            for (h, hand) in ["clean", "slanted"].enumerated() {
                let config = ReadEarlyBench.Config(name: early ? "early (real)" : "gate only (real)", pace: .typical, early: early)
                let r = await bench.play(chain, hand: hand, config: config, brain: TestBrain.shared, seed: UInt64(2_000 + h), real: services)
                print("BENCH real hand=\(hand) early=\(early) read=\(r.readMs.map { Int($0) }) tick=\(r.markMs.map { Int($0) }) calls=\(r.calls) reads=\(r.realReads)")
                all.append(r)
            }
            bench.report(ReadEarlyBench.Config(name: early ? "early (real Mathpix)" : "gate only (real Mathpix)", pace: .typical, early: early), all)
        }
        try await backend.auth.signOut(scope: .local)
    }
}
