#if DEBUG
import AgathonBoard
import AgathonBrain
import AgathonDesign
import AgathonLive
import SwiftUI

/// Debug only: the simulator has no Pencil, so My Pencil's UI test writes through this — a small button
/// in the top bar; each tap writes the next item of `-trainingAutowrite "steps|answer|problem:3x - 5 = 10"`
/// in a synthetic hand (`-trainingHand messy`, default clean) through the canvas's own touch path, at a
/// kid's pace:
///
///  - `steps`: the engine's worked steps for the page's problem but the last, one under another;
///  - `answer`: the last worked step, in the answer spot; `slip`: the same with its number off by one;
///  - `answer:<latex>`, `problem:<latex>` (the writer's own problem, at the top), or any `<latex>` as
///    the next line of work.
struct PencilAutowriteButton: View {
    @ObservedObject var session: PencilSession
    @State private var next = 0
    @State private var busy = false

    static var items: [String]? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-trainingAutowrite"), i + 1 < args.count else { return nil }
        let items = args[i + 1].split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return items.isEmpty ? nil : items
    }

    static var hand: TrainingHand {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-trainingHand"), i + 1 < args.count else { return .clean }
        return TrainingHand.named(args[i + 1]) ?? .clean
    }

    var body: some View {
        if let items = Self.items {
            Button {
                guard !busy else { return }
                busy = true
                let item = items[next % items.count]
                next += 1
                Task { @MainActor in
                    await write(item)
                    busy = false
                }
            } label: {
                Text(busy ? "writing…" : "✎ \(items[next % items.count])")
                    .font(.caption.monospaced())
                    .foregroundStyle(DS.Color.inkSecondary)
                    .padding(.horizontal, 10)
                    .frame(minHeight: 32)
                    .background(Capsule().strokeBorder(DS.Color.line))
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("pencil.autowrite")
            .accessibilityValue(busy ? "busy" : "\(next)")
        }
    }

    private func write(_ item: String) async {
        let board = session.board
        let problem = session.page?.problem ?? []
        var lines: [(String, TrainingPlace)] = []
        switch item {
        case "steps", "answer", "slip":
            guard let steps = await TrainingGenerator.workedSteps(problem, brain: .shared), !steps.isEmpty else { return }
            if item == "steps" {
                lines = steps.dropLast().map { ($0, .work) }
            } else if item == "answer" {
                lines = [(steps.last!, .answer)]
            } else if let slip = TrainingGenerator.bump(steps.last!)?.0 {
                lines = [(slip, .answer)]
            }
        default:
            if item.hasPrefix("answer:") {
                lines = [(String(item.dropFirst("answer:".count)), .answer)]
            } else if item.hasPrefix("problem:") {
                lines = [(String(item.dropFirst("problem:".count)), .problem)]
            } else {
                lines = [(item, .work)]
            }
        }
        var rng = SplitMix(seed: UInt64(next) &* 977)
        for (latex, place) in lines {
            guard let ink = try? await StudentHand.ink(latex, hand: Self.hand, brain: .shared) else { continue }
            let so = board.workSoFar()
            let origin = TrainingBoard.origin(for: ink, place: place, dx: 0, workTop: board.page.workTop, bottom: so.bottom, beside: so.last)
            let made = await board.write(board.placed(ink, at: origin), pace: .brisk, rng: &rng)
            TrainingBoard.log.notice("TRAINING autowrite \(latex, privacy: .public) at \(Int(origin.x)),\(Int(origin.y)): \(made.count) strokes")
            try? await Task.sleep(for: .milliseconds(900))
        }
    }
}
#endif
