#if DEBUG
import AgathonBoard
import AgathonBrain
import AgathonDesign
import AgathonKit
import AgathonLive
import os
import SwiftUI

/// Live Lab: the tutor on the board, on the real canvas, against whichever backend this run talks to
/// (a Debug run's local stack: AGATHON_API_URL, SUPABASE_URL, SUPABASE_ANON_KEY). The simulator has no
/// Pencil, so the Lab replays the kid's handwriting from the web's handwriting scoreboard (the four
/// student hands; ink in Packages/AgathonLive/Tests/AgathonLiveTests/Fixtures/kid-hands.json, read
/// from the Mac's disk) through the canvas's own input path, at a kid's pace.
///
/// Launch arguments (all optional):
///   -liveLab                 open the Lab at launch (LabsMenu)
///   -liveLabHand <hand>      clean | slanted | steep | messy
///   -liveLabDemo <name>      run a script: `e2e` (a slip ticked and ringed, a hint, the next step,
///                            Solve and Now you try), `slip`, `solve`
/// Environment: AGATHON_TEST_EMAIL / AGATHON_TEST_PASSWORD sign the QA user in when signed out.
/// Every step and latency is logged as `LIVELAB …` (subsystem app.agathon.Agathon, category live).
struct LiveLabView: View {
    @Environment(AgathonBackend.self) private var backend
    @StateObject private var lab = LiveLabModel()

    var body: some View {
        ZStack(alignment: .top) {
            DS.Color.ground.ignoresSafeArea()
            BoardCanvas(controller: lab.controller, insets: CameraConstraints(top: 168, left: 24, bottom: 24, right: 24)) { canvas in
                lab.attach(canvas, backend: backend)
            }
            .ignoresSafeArea()
            if let loop = lab.loop, let board = lab.board {
                LiveOverlay(loop: loop, geometry: board, onSpeak: { lab.speak($0) }).ignoresSafeArea()
                VStack(spacing: 10) {
                    HStack(alignment: .top, spacing: 12) {
                        LiveHelpBar(loop: loop)
                        Spacer(minLength: 12)
                        LiveStatusView(loop: loop)
                        GrownUpLiveButton(loop: loop)
                    }
                    labRow
                    Spacer()
                    HStack {
                        LabStats(loop: loop)
                        Spacer()
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
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
                    Button(s.name) { Task { await lab.play(s.lines) } }
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

/// The loop's numbers, small, for the developer.
private struct LabStats: View {
    @ObservedObject var loop: LiveLoop

    var body: some View {
        let m = loop.metrics
        let med = { (xs: [Double]) in LiveMetrics.median(xs).map { String(format: "%.0f", $0) } ?? "–" }
        VStack(alignment: .leading, spacing: 2) {
            Text("pen-up→mark \(med(m.penUpToMark)) ms (n=\(m.penUpToMark.count)) · recognize \(med(m.recognize)) ms (n=\(m.recognize.count), cache \(m.cacheHits))")
            Text("solve→first step \(med(m.solveFirstStep)) ms · check→first note \(med(m.checkFirstAnnotation)) ms · calls \(m.calls.sorted { $0.key < $1.key }.map { "\($0.key) \($0.value)" }.joined(separator: ", "))")
            Text("lines: " + loop.lines.values.sorted { ($0.column, $0.row) < ($1.column, $1.row) }.map { "\($0.latex.isEmpty ? "…" : $0.latex) [\($0.analysis?.verdict ?? "-")]" }.joined(separator: " · "))
        }
        .font(.system(size: 11, design: .monospaced))
        .padding(8)
        .background(.black.opacity(0.7), in: RoundedRectangle(cornerRadius: 8))
        .foregroundStyle(.white)
        .accessibilityIdentifier("liveLab.stats")
    }
}

@MainActor
final class LiveLabModel: ObservableObject {
    struct Scenario {
        let name: String
        let lines: [String]
    }

    static let log = Logger(subsystem: "app.agathon.Agathon", category: "live")
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
    @Published var hand = UserDefaults.standard.string(forKey: "liveLabHand") ?? "clean"
    @Published var status = ""
    private var nextY = 120.0
    private var x = 140.0
    private let speech = AVSpeech()

    static let fixtureURL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("Packages/AgathonLive/Tests/AgathonLiveTests/Fixtures/kid-hands.json")

    /// latex → hand → strokes as [x0, y0, x1, y1, …]
    private lazy var hands: [String: [String: [[Double]]]] = {
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
        Task {
            await signInIfAsked(backend)
            if let demo = UserDefaults.standard.string(forKey: "liveLabDemo") { await run(demo) }
        }
    }

    private func signInIfAsked(_ backend: AgathonBackend) async {
        let env = ProcessInfo.processInfo.environment
        guard backend.auth.phase != .signedIn, let email = env["AGATHON_TEST_EMAIL"], let password = env["AGATHON_TEST_PASSWORD"] else { return }
        do {
            try await backend.auth.signIn(email: email, password: password)
            status = "signed in"
            log("signed in as the QA user")
        } catch {
            status = "sign-in failed: \(error.localizedDescription)"
            log("sign-in failed: \(error)")
        }
    }

    func blank() {
        controller.load(.blank())
        nextY = 120
        x = 140
    }

    func speak(_ text: String) {
        speech.say(text)
    }

    private func log(_ s: String) {
        Self.log.notice("LIVELAB \(s, privacy: .public)")
    }

    /// Writes lines one under another through the canvas's own input path, at a kid's pace, with a
    /// kid's pause between lines.
    func play(_ lines: [String], pauseMs: UInt64 = 900) async {
        guard let canvas, let board else { return }
        for latex in lines {
            guard let strokes = hands[latex]?[hand] else {
                status = "no ink for \(latex)"
                continue
            }
            board.notePen(true)
            var maxY = nextY
            for flat in strokes {
                var pts: [Vec2] = []
                for i in stride(from: 0, to: flat.count - 1, by: 2) { pts.append(Vec2(x + flat[i] * 1.6, nextY + flat[i + 1] * 1.6)) }
                maxY = max(maxY, pts.map(\.y).max() ?? maxY)
                let view = densify(pts).map { canvas.camera.toView($0) }
                let length = zip(pts, pts.dropFirst()).reduce(0) { $0 + $1.0.dist($1.1) }
                await withCheckedContinuation { (k: CheckedContinuation<Void, Never>) in
                    canvas.simulateStroke(view, duration: max(0.08, length / 650)) { k.resume() }
                }
                try? await Task.sleep(nanoseconds: 60_000_000)
            }
            board.notePen(false)
            log("wrote \(latex) (\(hand))")
            nextY = maxY + 50
            try? await Task.sleep(nanoseconds: pauseMs * 1_000_000)
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

    // MARK: - scripts

    private func wait(_ seconds: Double) async {
        try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
    }

    /// Waits until the loop has nothing in flight (reads, checks, solves), at most `limit` seconds.
    private func settle(_ limit: Double = 15) async {
        guard let loop else { return }
        await loop.waitUntilIdle(timeout: .seconds(limit))
    }

    func run(_ demo: String) async {
        guard let loop else { return }
        // the canvas laid out and the brain loaded before the kid writes
        while (canvas?.bounds.width ?? 0) == 0 { await wait(0.1) }
        await wait(1.5)
        log("demo \(demo) starts")
        switch demo {
        case "slip":
            await play(["2x + 3 = 11", "2x = 8", "x = 5"])
            await wait(5)
            await settle()
        case "solve":
            loop.settings.mode = .answer
            await play(["5x + 2 = 17"])
            await wait(8)
            await settle()
        default:
            // 1. a slip: ticked and ringed (Hint mode, the default)
            await play(["2x + 3 = 11", "2x = 8", "x = 5"])
            await wait(4)
            await settle()
            log("marks after the slip: \(marks())")
            // 2. Help me: a hint card (the check model's words)
            loop.helpMe()
            await settle(20)
            await wait(1.5)
            log("hint: \(loop.hints.first?.message ?? "none")")
            // 3. More help: the right next step beside the ring, by hand
            if let card = loop.hints.first { loop.moreHelp(card) } else if let id = loop.lines.values.first(where: { $0.latex == "x = 5" })?.id { loop.escalate(id) }
            await wait(4)
            await settle()
            // 4. Solve: a new problem; the tutor finishes it at the pause, then offers one like it
            loop.settings.mode = .answer
            nextY = 120
            x = 860
            await play(["5x + 2 = 17"])
            await wait(9)
            await settle()
            log("offer: \(loop.offer?.problem.joined(separator: " ; ") ?? "none")")
            await wait(2)
            // 5. Now you try
            if loop.offer != nil { loop.takeOffer() }
            await wait(5)
            await settle()
        }
        let m = loop.metrics
        log(String(format: "metrics pen-up→mark median %.0f ms (n=%d) · recognize median %.0f ms (n=%d, cache %d) · solve→first step %@ · check→first note %@ · calls %@",
                   LiveMetrics.median(m.penUpToMark) ?? -1, m.penUpToMark.count, LiveMetrics.median(m.recognize) ?? -1, m.recognize.count, m.cacheHits,
                   m.solveFirstStep.map { String(format: "%.0f", $0) }.joined(separator: ","),
                   m.checkFirstAnnotation.map { String(format: "%.0f", $0) }.joined(separator: ","),
                   m.calls.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: ",")))
        log("penUpToMark all: \(m.penUpToMark.map { String(format: "%.0f", $0) }.joined(separator: ",")) · recognize all: \(m.recognize.map { String(format: "%.0f", $0) }.joined(separator: ","))")
        log("demo \(demo) done")
    }

    private func marks() -> String {
        guard let loop else { return "" }
        let store = controller.store
        return loop.lines.values.sorted { $0.row < $1.row }.map { line -> String in
            let rid = RecordID("line:\(line.id)")
            let kind = store.records.values.compactMap { r -> String? in
                if case .mark(let m) = r, m.target == rid { return m.kind.rawValue }
                return nil
            }.first ?? "none"
            return "\(line.latex)=\(kind)"
        }.joined(separator: ", ")
    }
}

import AVFoundation

/// The hint card's speaker in the Lab (read aloud proper is Ask's lane).
@MainActor
final class AVSpeech {
    private let synth = AVSpeechSynthesizer()
    func say(_ text: String) {
        synth.stopSpeaking(at: .immediate)
        synth.speak(AVSpeechUtterance(string: text))
    }
}
#endif
