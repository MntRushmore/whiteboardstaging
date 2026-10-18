#if DEBUG
import AgathonBoard
import AgathonBrain
import AgathonKit
import AgathonLive
import SwiftUI

/// Live Lab: the tutor on the board, on the real canvas, against whichever backend this run talks to
/// (a Debug run's local stack). The simulator has no Pencil, so the Lab replays the kid's
/// handwriting from the web's handwriting scoreboard (the four student hands; ink in
/// Packages/AgathonLive/Tests/AgathonLiveTests/Fixtures/kid-hands.json, read from the Mac's disk).
/// Sign in first (the Labs menu works from the sign-in screen too: it signs in the QA user from
/// AGATHON_TEST_EMAIL / AGATHON_TEST_PASSWORD when set).
struct LiveLabView: View {
    @Environment(AgathonBackend.self) private var backend
    @StateObject private var lab = LiveLabModel()

    var body: some View {
        ZStack(alignment: .top) {
            BoardCanvas(controller: lab.controller, insets: CameraConstraints(top: 150, left: 16, bottom: 16, right: 16)) { canvas in
                lab.attach(canvas, backend: backend)
            }
            .ignoresSafeArea()
            if let loop = lab.loop, let board = lab.board {
                LiveOverlay(loop: loop, geometry: board, onSpeak: nil).ignoresSafeArea()
                VStack(spacing: 8) {
                    HStack(alignment: .top) {
                        LiveHelpBar(loop: loop)
                        Spacer()
                        LiveStatusView(loop: loop)
                        GrownUpLiveButton(loop: loop)
                    }
                    labRow
                    Spacer()
                }
                .padding(12)
            }
        }
    }

    private var labRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Picker("Hand", selection: $lab.hand) {
                    ForEach(LiveLabModel.hands, id: \.self) { Text($0).tag($0) }
                }
                .pickerStyle(.segmented)
                .frame(width: 300)
                ForEach(LiveLabModel.scenarios, id: \.name) { s in
                    Button(s.name) { Task { await lab.play(s) } }
                }
                Button("Blank") { lab.blank() }
                Text(lab.status).font(.footnote.monospaced()).foregroundStyle(.secondary).lineLimit(1)
            }
            .buttonStyle(.bordered)
            .fixedSize()
        }
        .padding(8)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
    }
}

@MainActor
final class LiveLabModel: ObservableObject {
    struct Scenario {
        let name: String
        let lines: [String]
    }

    static let hands = ["clean", "slanted", "steep", "messy"]
    static let scenarios = [
        Scenario(name: "Slip: 2x+3=11 / 2x=8 / x=5", lines: ["2x + 3 = 11", "2x = 8", "x = 5"]),
        Scenario(name: "Right: 3x-5=10 / 3x=15 / x=5", lines: ["3x - 5 = 10", "3x = 15", "x = 5"]),
        Scenario(name: "Fix: x=4", lines: ["x = 4"]),
        Scenario(name: "36+2=", lines: ["36 + 2 ="]),
        Scenario(name: "5x+2=17", lines: ["5x + 2 = 17"]),
    ]

    let controller = BoardController()
    private(set) weak var canvas: BoardCanvasView?
    @Published private(set) var board: CanvasLiveBoard?
    @Published private(set) var loop: LiveLoop?
    @Published var hand = "clean"
    @Published var status = ""
    private var nextY = 140.0

    static let fixtureURL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("Packages/AgathonLive/Tests/AgathonLiveTests/Fixtures/kid-hands.json")

    private lazy var hands: [String: [String: [[Double]]]] = {
        // latex → hand → strokes as [x0, y0, x1, y1, …]
        guard let data = try? Data(contentsOf: Self.fixtureURL),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let lines = json["lines"] as? [String: [String: [[String: [Double]]]]] else { return [:] }
        return lines.mapValues { byHand in
            byHand.mapValues { strokes in strokes.map { s in zip(s["x"] ?? [], s["y"] ?? []).flatMap { [$0, $1] } } }
        }
    }()

    func attach(_ canvas: BoardCanvasView, backend: AgathonBackend) {
        guard self.canvas == nil else { return }
        self.canvas = canvas
        let board = CanvasLiveBoard(controller: controller, canvas: canvas)
        let loop = LiveLoop(board: board, boardId: "ipad-live-lab", services: LiveAPIServices(backend: backend),
                            settings: LiveSettings(enabled: true, mode: .feedback, auto: true))
        self.board = board
        self.loop = loop
        loop.start()
        Task { await signInIfAsked(backend) }
    }

    private func signInIfAsked(_ backend: AgathonBackend) async {
        let env = ProcessInfo.processInfo.environment
        guard backend.auth.phase != .signedIn, let email = env["AGATHON_TEST_EMAIL"], let password = env["AGATHON_TEST_PASSWORD"] else { return }
        do {
            try await backend.auth.signIn(email: email, password: password)
            status = "signed in as \(email)"
        } catch {
            status = "sign-in failed: \(error.localizedDescription)"
        }
    }

    func blank() {
        controller.load(.blank())
        nextY = 140
    }

    /// Writes the scenario's lines one under another, through the canvas's own input path, at a
    /// kid's pace, pausing between lines as a kid does.
    func play(_ s: Scenario) async {
        guard let canvas, let board else { return }
        for latex in s.lines {
            guard let strokes = hands[latex]?[hand] else {
                status = "no ink for \(latex)"
                continue
            }
            board.notePen(true)
            for flat in strokes {
                var pts: [Vec2] = []
                for i in stride(from: 0, to: flat.count - 1, by: 2) { pts.append(Vec2(200 + flat[i] * 1.5, nextY + flat[i + 1] * 1.5)) }
                let view = densify(pts).map { canvas.camera.toView($0) }
                let length = zip(pts, pts.dropFirst()).reduce(0) { $0 + $1.0.dist($1.1) }
                await withCheckedContinuation { (k: CheckedContinuation<Void, Never>) in
                    canvas.simulateStroke(view, duration: max(0.08, length / 700)) { k.resume() }
                }
                try? await Task.sleep(nanoseconds: 70_000_000)
            }
            board.notePen(false)
            nextY += 95
            try? await Task.sleep(nanoseconds: 900_000_000)
        }
    }

    private func densify(_ p: [Vec2]) -> [Vec2] {
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
