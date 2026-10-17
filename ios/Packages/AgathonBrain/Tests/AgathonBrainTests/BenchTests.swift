import Foundation
import Testing
@testable import AgathonBrain

/// How fast the brain is in JavaScriptCore: cold load, memory, and per-call latency over the
/// scoreboards' real inputs. Off by default (a few minutes without a JIT); run with
///
///     TEST_RUNNER_BRAIN_BENCH=1 xcodebuild test -scheme AgathonBrain \
///       -destination 'platform=iOS Simulator,name=iPad Air 11-inch (M4)' -only-testing:AgathonBrainTests/BenchTests
///
/// and `TEST_RUNNER_JSC_useJIT=false` as well to run JavaScriptCore without its JIT, as an app on
/// a device does. Prints `BENCH` lines; with `BRAIN_BENCH_OUT` set, also writes them as JSON there.
@Suite(.serialized, .enabled(if: ProcessInfo.processInfo.environment["BRAIN_BENCH"] == "1"))
struct BenchTests {
    struct Row: Codable {
        var name: String
        var n: Int
        var median: Double
        var p95: Double
        var max: Double
        var note: String
    }

    @Test func bench() async throws {
        var rows: [Row] = []
        func row(_ name: String, _ samples: [Double], note: String = "") {
            let s = BrainDiagnostics.summary(samples)
            rows.append(Row(name: name, n: samples.count, median: s.median, p95: s.p95, max: s.max, note: note))
        }
        let env = ProcessInfo.processInfo.environment
        let jitFlag = env["JSC_useJIT"] ?? "default"

        // memory: one brain, before and after loading it (the golden cases are read first)
        _ = Golden.cases.count
        let before = BrainDiagnostics.physicalFootprint()
        let brain = Brain()
        let first = try await brain.load()
        let afterLoad = BrainDiagnostics.physicalFootprint()
        row("load: first in the process (read + evaluate + engine)", [first.totalMs], note: String(format: "read %.1f, evaluate %.1f, engine %.1f ms", first.readMs, first.evaluateMs, first.engineMs))

        // the first calls after loading: mathjs builds most functions lazily, on first use
        var firsts: [String] = []
        var firstTotal = 0.0
        for name in ["analyzeLine/li-01/0", "analyzeLine/qu-01/0", "localSolve/li-01", "localSolve/qu-01", "layoutHandwriting/three-line", "clusterStrokes/page", "recognizerPayload/0/clean", "marks/check/0", "variantOf/add_within_20"] {
            guard let c = Golden.named(name) else { continue }
            let (_, ms) = try await timed { try await brain.envelopeJSON(c.method, args: c.args) }
            firsts.append(String(format: "%@ %.0f", c.method, ms))
            firstTotal += ms
        }
        row("first calls after load (cold)", [firstTotal], note: firsts.joined(separator: ", "))

        // JIT or not: a tight integer loop
        var probes: [Double] = []
        for _ in 0..<5 { probes.append(try await brain.jitProbe().ms) }
        row("jitProbe (5M-iteration loop, in JS)", probes, note: "JSC_useJIT=\(jitFlag)")

        // analyzeLine over the corpus, with the board's column context (one warm-up pass)
        let analyze = Golden.method("analyzeLine").filter { !$0.name.hasPrefix("error/") }
        for c in analyze.prefix(200) { _ = try await brain.envelopeJSON(c.method, args: c.args) }
        var analyzeMs: [Double] = []
        var slow: [(String, Double)] = []
        for c in analyze {
            let (_, ms) = try await timed { try await brain.envelopeJSON(c.method, args: c.args) }
            analyzeMs.append(ms)
            slow.append((c.name, ms))
        }
        row("analyzeLine (corpus, \(analyze.count) lines)", analyzeMs, note: Self.slowest(slow))

        var solveMs: [Double] = []
        slow = []
        for c in Golden.method("localSolve") {
            let (_, ms) = try await timed { try await brain.envelopeJSON(c.method, args: c.args) }
            solveMs.append(ms)
            slow.append((c.name, ms))
        }
        row("localSolve (corpus, \(solveMs.count) problems)", solveMs, note: Self.slowest(slow))

        // clustering a screen of ~200 strokes
        let page = try #require(Golden.named("clusterStrokes/page"))
        let strokes = (JSONCompare.parse(page.args) as? [String: Any])?["strokes"] as? [Any]
        var clusterMs: [Double] = []
        for _ in 0..<20 {
            let (_, ms) = try await timed { try await brain.envelopeJSON(page.method, args: page.args) }
            clusterMs.append(ms)
        }
        row("clusterStrokes (\(strokes?.count ?? 0) strokes, raw JSON)", clusterMs)
        let pageArgs = try JSONDecoder().decode(ClusterRequest.self, from: Data(page.args.utf8))
        var clusterTyped: [Double] = []
        for _ in 0..<10 {
            let (_, ms) = try await timed { try await brain.clusterStrokes(pageArgs) }
            clusterTyped.append(ms)
        }
        row("clusterStrokes (\(strokes?.count ?? 0) strokes, typed Swift)", clusterTyped, note: "incl. encoding the strokes and decoding the lines")
        var ink: [Double] = []
        for c in Golden.method("clusterStrokes") where !c.name.hasPrefix("error/") {
            let (_, ms) = try await timed { try await brain.envelopeJSON(c.method, args: c.args) }
            ink.append(ms)
        }
        row("clusterStrokes (all \(ink.count) golden scenes)", ink)

        // the tutor's hand: a three-line answer
        let three = try #require(Golden.named("layoutHandwriting/three-line"))
        var handRaw: [Double] = []
        for _ in 0..<30 {
            let (_, ms) = try await timed { try await brain.envelopeJSON(three.method, args: three.args) }
            handRaw.append(ms)
        }
        row("layoutHandwriting (3-line answer, raw JSON)", handRaw, note: "\(three.result.utf8.count / 1024) KB out")
        let request = HandwritingRequest(steps: ["x^{2} - 5x + 6 = 0", "(x - 2)(x - 3) = 0", "x = 2, \\ x = 3"], lineHeight: 44, seedKey: "ln_bench")
        var handTyped: [Double] = []
        for _ in 0..<30 {
            let (_, ms) = try await timed { try await brain.layoutHandwriting(request) }
            handTyped.append(ms)
        }
        row("layoutHandwriting (3-line answer, typed Swift)", handTyped, note: "incl. decoding the strokes")

        var payload: [Double] = []
        for c in Golden.method("recognizerPayload") {
            let (_, ms) = try await timed { try await brain.envelopeJSON(c.method, args: c.args) }
            payload.append(ms)
        }
        row("recognizerPayload (one line)", payload)

        var marks: [Double] = []
        for c in Golden.method("marks") {
            let (_, ms) = try await timed { try await brain.envelopeJSON(c.method, args: c.args) }
            marks.append(ms)
        }
        row("marks", marks)

        var variants: [Double] = []
        slow = []
        for c in Golden.method("variantOf") {
            let (_, ms) = try await timed { try await brain.envelopeJSON(c.method, args: c.args) }
            variants.append(ms)
            slow.append((c.name, ms))
        }
        row("variantOf / Now you try (still clock: no budget)", variants, note: Self.slowest(slow))

        var graphs: [Double] = []
        for c in Golden.method("sketchGraph") {
            let (_, ms) = try await timed { try await brain.envelopeJSON(c.method, args: c.args) }
            graphs.append(ms)
        }
        row("sketchGraph", graphs)

        var summaries: [Double] = []
        for c in Golden.method("progressSummary") {
            let (_, ms) = try await timed { try await brain.envelopeJSON(c.method, args: c.args) }
            summaries.append(ms)
        }
        row("progressSummary", summaries)

        var policies: [Double] = []
        for c in Golden.method("policy") {
            let (_, ms) = try await timed { try await brain.envelopeJSON(c.method, args: c.args) }
            policies.append(ms)
        }
        row("policy", policies, note: "the boundary's floor: a call that does almost nothing")

        let afterRun = BrainDiagnostics.physicalFootprint()
        await brain.collectGarbageForTesting()
        try await Task.sleep(nanoseconds: 2_000_000_000)
        let afterGC = BrainDiagnostics.physicalFootprint()
        let mb = { (b: UInt64) in Double(b) / 1_048_576 }
        rows.append(Row(name: "memory: process before the brain (MB)", n: 1, median: mb(before), p95: 0, max: 0, note: "phys_footprint"))
        rows.append(Row(name: "memory: + loading one brain (MB)", n: 1, median: mb(afterLoad) - mb(before), p95: 0, max: 0, note: ""))
        rows.append(Row(name: "memory: + running every golden case (MB)", n: 1, median: mb(afterRun) - mb(before), p95: 0, max: 0, note: "garbage not yet collected"))
        rows.append(Row(name: "memory: + after a full GC (MB)", n: 1, median: mb(afterGC) - mb(before), p95: 0, max: 0, note: "what the brain keeps"))

        // cold load: a new virtual machine each time, discarded after
        var evaluates: [Double] = [], engines: [Double] = [], totals: [Double] = []
        for _ in 0..<5 {
            let fresh = Brain()
            let report = try await fresh.load()
            evaluates.append(report.evaluateMs)
            engines.append(report.engineMs)
            totals.append(report.totalMs)
        }
        row("load again: evaluate brain.js", evaluates)
        row("load again: engine (mathjs create(all))", engines)
        row("load again: total", totals)

        for r in rows {
            print(String(format: "BENCH | %@ | n=%d | median %.2f | p95 %.2f | max %.2f | %@", r.name, r.n, r.median, r.p95, r.max, r.note))
        }
        if let out = env["BRAIN_BENCH_OUT"] {
            let data = try JSONEncoder().encode(rows)
            try data.write(to: URL(fileURLWithPath: out))
        }
    }

    private func timed<T>(_ body: () async throws -> T) async rethrows -> (T, Double) {
        let start = DispatchTime.now().uptimeNanoseconds
        let value = try await body()
        return (value, Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000)
    }

    private static func slowest(_ samples: [(String, Double)]) -> String {
        samples.sorted { $0.1 > $1.1 }.prefix(3).map { "\($0.0) \(String(format: "%.0f", $0.1)) ms" }.joined(separator: "; ")
    }
}
