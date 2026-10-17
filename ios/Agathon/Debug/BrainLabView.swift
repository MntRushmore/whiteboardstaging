import AgathonBrain
import SwiftUI

/// The brain lab: loads `brain.js` in JavaScriptCore, runs a few calls and shows what they took.
/// A developer screen, not part of the app: open it with the launch argument `-brainLab`
/// (Product > Scheme > Edit Scheme > Run > Arguments, or `xcrun simctl launch … -brainLab`).
enum BrainLab {
    /// Debug builds only; a Release build never shows the lab.
    static var isRequested: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("-brainLab")
        #else
        false
        #endif
    }
}

struct BrainLabView: View {
    struct Result: Identifiable {
        let id = UUID()
        let name: String
        let ms: Double
        let detail: String
    }

    @State private var results: [Result] = []
    @State private var load: BrainLoadReport?
    @State private var ink: HandPlan?
    @State private var tick: HandPlan?
    @State private var footprintMB: Double = 0
    @State private var error: String?
    @State private var running = false

    var body: some View {
        NavigationStack {
            List {
                Section("Load") {
                    if let load {
                        row("read brain.js", load.readMs, "\(load.bytes / 1024) KB")
                        row("evaluate", load.evaluateMs, "API \(load.api)")
                        row("engine (mathjs \(load.mathjs) create(all))", load.engineMs, "")
                        row("total", load.totalMs, String(format: "footprint %.0f MB", footprintMB))
                    } else if error == nil {
                        ProgressView()
                    }
                }
                if let ink {
                    Section("The tutor's hand, then read back as ink") {
                        InkCanvas(plans: [ink] + (tick.map { [$0] } ?? []))
                            .frame(height: max(80, ink.bounds.h + 40))
                    }
                }
                Section("Calls") {
                    ForEach(results) { r in row(r.name, r.ms, r.detail) }
                }
                if let error {
                    Section("Error") { Text(error).foregroundStyle(.red).font(.callout.monospaced()) }
                }
            }
            .navigationTitle("Brain lab")
            .toolbar {
                Button("Run again") { Task { await run() } }.disabled(running)
            }
        }
        .task { await run() }
    }

    private func row(_ name: String, _ ms: Double, _ detail: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                if !detail.isEmpty { Text(detail).font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(3) }
            }
            Spacer()
            Text(String(format: "%.1f ms", ms)).font(.body.monospacedDigit())
        }
    }

    private func run() async {
        running = true
        defer { running = false }
        results = []
        error = nil
        let brain = Brain.shared
        do {
            load = try await brain.load()
            footprintMB = Double(BrainDiagnostics.physicalFootprint()) / 1_048_576

            let probe = try await timed { try await brain.jitProbe() }
            let jit = probe.0.ms > 50 ? "no JIT: the interpreter, as on an iPad" : "JIT on (the simulator JITs; an iPad app does not)"
            results.append(Result(name: "jitProbe (5M-iteration loop)", ms: probe.1, detail: String(format: "%.1f ms inside JS: %@", probe.0.ms, jit)))

            let analysis = try await timed { try await brain.analyzeLine("2x + 3 = 11") }
            results.append(Result(name: "analyzeLine 2x + 3 = 11", ms: analysis.1, detail: "\(analysis.0.kind), x = \(analysis.0.solutions?.joined(separator: ", ") ?? "?")"))

            let step = try await timed { try await brain.analyzeLine("2x = 14", context: AnalyzeContext(previous: analysis.0, original: analysis.0)) }
            results.append(Result(name: "analyzeLine 2x = 14 under it", ms: step.1, detail: "verdict \(step.0.verdict)"))

            let trig = try await timed { try await brain.analyzeLine("2\\cos x = 1, 0^{\\circ} \\le x < 360^{\\circ}") }
            results.append(Result(name: "analyzeLine (a trig equation in a domain)", ms: trig.1, detail: trig.0.solutions?.joined(separator: ", ") ?? ""))

            let solve = try await timed { try await brain.localSolve(["x^{2} - 5x + 6 = 0"]) }
            results.append(Result(name: "localSolve x² − 5x + 6 = 0", ms: solve.1, detail: solve.0.steps.joined(separator: "   ")))

            let steps = ["x^{2} - 5x + 6 = 0", "(x - 2)(x - 3) = 0", "x = 2, \\ x = 3"]
            let hand = try await timed { try await brain.layoutHandwriting(HandwritingRequest(steps: steps, lineHeight: 44, seedKey: "lab", origin: Point(x: 20, y: 20))) }
            let handStrokes = (hand.0.plan?.lines ?? []).reduce(0) { $0 + $1.strokes.count }
            let writeMs = Int(hand.0.plan?.totalMs ?? 0)
            results.append(Result(name: "layoutHandwriting (3 lines)", ms: hand.1, detail: "\(handStrokes) strokes, \(writeMs) ms to write"))
            ink = hand.0.plan

            // the tutor's ink read back as if a student had written it
            var strokes: [BrainStroke] = []
            for line in hand.0.plan?.lines ?? [] {
                for stroke in line.strokes {
                    let xs = stroke.points.map { $0.x + line.x }
                    let ys = stroke.points.map { $0.y + line.y }
                    strokes.append(BrainStroke(id: "s\(strokes.count)", x: xs, y: ys))
                }
            }
            let clustered = try await timed { try await brain.clusterStrokes(ClusterRequest(strokes: strokes)) }
            let columns = Set(clustered.0.lines.map { $0.column }).count
            results.append(Result(name: "clusterStrokes (\(strokes.count) strokes)", ms: clustered.1, detail: "\(clustered.0.lines.count) lines, \(columns) column(s)"))

            if let first = clustered.0.lines.first {
                let payload = try await timed { try await brain.recognizerPayload(strokes, line: PayloadLine(strokeIds: first.strokeIds)) }
                results.append(Result(name: "recognizerPayload (first line)", ms: payload.1, detail: "\(payload.0?.points ?? 0) points, sha-1 \(payload.0?.hash.prefix(12) ?? "–")"))
                let mark = try await timed { try await brain.mark(.check, around: first.bounds, seedKey: "\(first.id):check") }
                results.append(Result(name: "marks (a tick)", ms: mark.1, detail: mark.0.key))
                tick = mark.0.plan
            }

            let next = try await timed { try await brain.variantOf(["2x + 3 = 11"], seed: 7) }
            results.append(Result(name: "Now you try (variantOf)", ms: next.1, detail: next.0?.joined(separator: "; ") ?? "none"))

            let practice = try await timed { try await brain.practice(skill: "two_step_equations", count: 4, seed: 1) }
            results.append(Result(name: "practice (4 problems)", ms: practice.1, detail: practice.0.map { $0.joined(separator: "; ") }.joined(separator: "   ")))

            footprintMB = Double(BrainDiagnostics.physicalFootprint()) / 1_048_576
        } catch {
            self.error = String(describing: error)
        }
    }

    private func timed<T>(_ body: () async throws -> T) async rethrows -> (T, Double) {
        let start = DispatchTime.now().uptimeNanoseconds
        let value = try await body()
        return (value, Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000)
    }
}

/// The plans' strokes as plain polylines (the board lane renders real ink).
private struct InkCanvas: View {
    let plans: [HandPlan]

    var body: some View {
        Canvas { context, _ in
            for plan in plans {
                for line in plan.lines {
                    for stroke in line.strokes where stroke.points.count > 1 {
                        var path = Path()
                        path.addLines(stroke.points.map { CGPoint(x: $0.x + line.x, y: $0.y + line.y) })
                        context.stroke(path, with: .color(.blue), style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                    }
                }
            }
        }
    }
}

#Preview {
    BrainLabView()
}
