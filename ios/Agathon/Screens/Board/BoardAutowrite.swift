#if DEBUG
import AgathonBoard
import AgathonDesign
import AgathonLive
import SwiftUI

/// Debug only: a kid's handwriting on the real board, for the simulator (no Pencil) and the UI tests.
///
/// `-boardAutowrite "2x + 3 = 11|2x = 8|x = 5"` shows a small button in the board's top bar; each tap
/// writes the next line in a kid's hand (the web's handwriting scoreboard, the clean hand: the Live
/// Lab's fixture on this Mac's disk) through the canvas's own touch path, under what is on the page.
/// `newpage` as a line adds a page and goes to it. Never in a Release build.
struct BoardAutowriteButton: View {
    @ObservedObject var model: BoardScreenModel
    @ObservedObject private var progress = BoardAutowriter.progress
    private var next: Int {
        get { progress.next }
        nonmutating set { progress.next = newValue }
    }
    private var busy: Bool {
        get { progress.busy }
        nonmutating set { progress.busy = newValue }
    }

    static var lines: [String]? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-boardAutowrite"), i + 1 < args.count else { return nil }
        let lines = args[i + 1].split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return lines.isEmpty ? nil : lines
    }

    var body: some View {
        if let lines = Self.lines, model.tutor != nil {
            Button {
                guard !busy, next < lines.count else { return }
                busy = true
                let line = lines[next]
                next += 1
                Task { @MainActor in
                    await BoardAutowriter.write(line, model: model)
                    busy = false
                }
            } label: {
                Text(busy ? "writing…" : next < lines.count ? "✎ \(lines[next])" : "✎ done")
                    .font(.caption.monospaced())
                    .foregroundStyle(DS.Color.inkSecondary)
                    .padding(.horizontal, 10)
                    .frame(minHeight: 32)
                    .background(Capsule().strokeBorder(DS.Color.line))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("debug.autowrite")
            .accessibilityValue(busy ? "busy" : "\(next)")
        }
    }
}

@MainActor
enum BoardAutowriter {
    /// Where the script is (one per launch: the button may be laid out again, a board reopened).
    final class Progress: ObservableObject {
        @Published var next = 0
        @Published var busy = false
    }

    static let progress = Progress()

    /// latex → strokes as [x0, y0, x1, y1, …] (the clean hand)
    static let hand: [String: [[Double]]] = {
        guard let data = try? Data(contentsOf: LiveLabModel.fixtureURL),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let lines = json["lines"] as? [String: [String: [[String: [Double]]]]] else { return [:] }
        return lines.compactMapValues { byHand in
            byHand["clean"]?.map { s in zip(s["x"] ?? [], s["y"] ?? []).flatMap { [$0, $1] } }
        }
    }()

    static func write(_ latex: String, model: BoardScreenModel) async {
        guard let tutor = model.tutor, let canvas = tutor.liveBoard.canvas else { return }
        let controller = tutor.liveBoard.controller
        if latex == "newpage" {
            _ = controller.addScreen()
            try? await Task.sleep(for: .milliseconds(600))
            return
        }
        guard let strokes = hand[latex] else {
            BoardScreenModel.log.error("autowrite: no ink for \(latex, privacy: .public)")
            return
        }
        // under what is on the page, at the left
        let screen = controller.currentScreenID
        let rect = controller.currentScreen?.rect ?? .screen
        let bottom = controller.store.drawables(on: screen).compactMap { r -> Double? in
            guard case .stroke(let s) = r else { return nil }
            return s.points.map { s.pagePoint($0).y }.max()
        }.max()
        let x = rect.x + 140
        let y = bottom.map { $0 + 60 } ?? rect.y + 140
        let page: [[Vec2]] = strokes.map { flat in
            stride(from: 0, to: flat.count - 1, by: 2).map { i in Vec2(x + flat[i] * 1.6, y + flat[i + 1] * 1.6) }
        }
        controller.tool = .pen
        tutor.liveBoard.notePen(true)
        for pts in page {
            let view = densify(pts).map { canvas.camera.toView($0) }
            let length = zip(pts, pts.dropFirst()).reduce(0) { $0 + $1.0.dist($1.1) }
            await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
                canvas.simulateStroke(view, duration: max(0.08, length / 650)) { done.resume() }
            }
            try? await Task.sleep(for: .milliseconds(60))
        }
        tutor.liveBoard.notePen(false)
        BoardScreenModel.log.notice("autowrite: wrote \(latex, privacy: .public)")
    }

    private static func densify(_ p: [Vec2]) -> [Vec2] {
        guard p.count >= 2 else { return p }
        var out: [Vec2] = [p[0]]
        for (a, b) in zip(p, p.dropFirst()) {
            let n = max(1, Int(a.dist(b) / 2))
            for k in 1...n { out.append(a.lerp(b, Double(k) / Double(n))) }
        }
        return out
    }
}
#endif

#if DEBUG
/// Debug only: what the tutor made of the board, as one line VoiceOver could read, for the UI tests
/// (marks are ink on the canvas, which XCUITest cannot see). Refreshed twice a second.
/// `debug.live` = "lines: 2x + 3 = 11=tick; 2x = 8=tick; x = 5=ring | hints 1 | chat 14 | problems 2 | save saved v4"
struct BoardDebugProbe: View {
    @ObservedObject var model: BoardScreenModel

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.5)) { _ in
            Color.clear
                .frame(width: 2, height: 2)
                .accessibilityElement()
                .accessibilityLabel(summary)
                .accessibilityIdentifier("debug.live")
        }
        .allowsHitTesting(false)
    }

    private var summary: String {
        guard let tutor = model.tutor else { return "no tutor" }
        let store = tutor.liveBoard.controller.store
        let screen = tutor.liveBoard.controller.currentScreenID
        var marks: [RecordID: String] = [:]
        var problems = 0
        for record in store.records.values {
            if case .mark(let m) = record, m.screen == screen, let target = m.target { marks[target] = m.kind.rawValue }
            if case .problem(let p) = record, p.screen == screen { problems += 1 }
        }
        let lines = tutor.loop.lines.values.sorted { ($0.column, $0.row) < ($1.column, $1.row) }.map { line in
            "\(line.latex.isEmpty ? "…" : line.latex)=\(marks[RecordID("line:\(line.id)")] ?? "none")"
        }
        let chat = store.drawables(on: screen).filter { $0.meta["lineId"]?.stringValue == "chat" }.count
        let save = model.phase.session.map { BoardSaveStatus.detail($0) } ?? "-"
        return "lines: \(lines.joined(separator: "; ")) | hints \(tutor.loop.hints.count) | chat \(chat) | problems \(problems) | activity \(tutor.loop.activity) | save \(save)"
    }
}
#endif
