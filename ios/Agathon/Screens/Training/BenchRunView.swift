import AgathonDesign
import AgathonKit
import AgathonLive
import SwiftUI

/// An AUTO BENCH run on screen: the real board writing each case in its hand, the run's progress in
/// the top bar (case n of N, calls of the budget, failures so far), Stop; the results once it ends.
struct BenchRunView: View {
    let config: TrainingConfig
    let close: () -> Void
    @Environment(AgathonBackend.self) private var backend
    @StateObject private var holder = Holder()

    @MainActor final class Holder: ObservableObject {
        @Published var runner: BenchRunner?
    }

    var body: some View {
        ZStack {
            DS.Color.ground.ignoresSafeArea()
            if let runner = holder.runner {
                BenchBoard(runner: runner, close: {
                    runner.close()
                    close()
                })
            }
        }
        .task {
            guard holder.runner == nil else { return }
            let r = BenchRunner(backend: backend, config: config)
            holder.runner = r
            r.start()
        }
    }
}

private struct BenchBoard: View {
    @ObservedObject var runner: BenchRunner
    let close: () -> Void
    @State private var showResults = false

    var body: some View {
        TrainingBoardView(board: runner.board, title: "Auto bench", onBack: close) {
            let failed = runner.run.cases.filter { $0.pass == false }.count
            TrainingPill(text: progress)
                .accessibilityIdentifier("bench.progress")
                .accessibilityValue(runner.finished ? "finished" : "running")
            TrainingPill(text: "\(runner.calls)/\(runner.config.budget) calls")
            if failed > 0 { TrainingPill(text: "\(failed) failed", tint: DS.Color.onInk, fill: DS.Color.tomato) }
            if runner.finished {
                PillButton("Results", icon: .chart, kind: .primary) { showResults = true }
                    .fixedSize()
                    .accessibilityIdentifier("bench.results")
            } else {
                PillButton("Stop", icon: .pause, kind: .secondary) { runner.stop() }
                    .fixedSize()
                    .accessibilityIdentifier("bench.stop")
            }
        }
        .overlay(alignment: .bottom) {
            if !runner.now.isEmpty {
                Text(runner.now)
                    .dsFont(.caption)
                    .foregroundStyle(DS.Color.inkSecondary)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 28)
                    .background(Capsule().fill(DS.Color.surface))
                    .padding(.bottom, 8)
                    .allowsHitTesting(false)
            }
        }
        .onChange(of: runner.finished) { _, done in if done { showResults = true } }
        .fullScreenCover(isPresented: $showResults) {
            TrainingResultsView(run: runner.run, runner: runner, close: { showResults = false })
        }
    }

    private var progress: String {
        switch runner.phase {
        case .idle, .planning: return "Getting ready…"
        case .running: return "Case \(min(runner.index + 1, runner.planned.count)) of \(runner.planned.count)"
        case .finished(let status):
            switch status {
            case .budget: return "Stopped: budget"
            case .stopped: return "Stopped"
            case .failed: return "Couldn't run"
            default: return "Done: \(runner.run.cases.count) cases"
            }
        }
    }
}
