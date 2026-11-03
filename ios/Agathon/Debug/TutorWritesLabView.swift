#if DEBUG
import AgathonBoard
import AgathonBoardUI
import AgathonBrain
import AgathonDesign
import AgathonKit
import AgathonLive
import os
import SwiftUI

/// Tutor Writes Lab (docs/TUTOR-WRITES.md): "the tutor writes it out" on the real Blocks board, with no
/// server. The kid's work is written in a synthetic student hand (`StudentHand`) through the canvas's
/// own input path, and read back perfectly by a stand-in recognizer that knows what was written — so
/// the moment can be shown, recorded and UI-tested anywhere, at no cost, with no real kid's ink.
///
/// Launch arguments:
///   -lab tutorWrites              open it
///   -tutorWritesDemo <name>       equation | fractions | column | long | slip (default equation)
///   -tutorWritesMode <mode>       hint | step | solve (default step: Help me writes the next step)
///   -tutorWritesAnswers           the grown-ups allow answers ("Show the answer when I write =")
/// `tutorWrites.probe` (accessibility) says what the tutor has done, for the UI test.
struct TutorWritesLabView: View {
    @StateObject private var lab = TutorWritesLab()

    var body: some View {
        BoardEditorView(controller: lab.controller, title: lab.title, onCanvas: { lab.attach($0) },
                        topTrailing: { EmptyView() },
                        helpButton: {
                            if let loop = lab.loop { LiveHelpBar(loop: loop) }
                        },
                        overlay: { _ in
                            if let loop = lab.loop, let board = lab.board {
                                LiveOverlay(loop: loop, geometry: board, onSpeak: nil, showsOutOfInk: false)
                            }
                            TutorWritesProbe(lab: lab)
                        })
    }
}

/// What the tutor has done, as one accessibility label: `read 2 | steps 1 | writing no | card Next step: Subtract 3 from both sides.`
private struct TutorWritesProbe: View {
    @ObservedObject var lab: TutorWritesLab

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.25)) { _ in
            Color.clear.frame(width: 2, height: 2)
                .accessibilityElement()
                .accessibilityLabel(lab.summary)
                .accessibilityIdentifier("tutorWrites.probe")
        }
        .allowsHitTesting(false)
    }
}

@MainActor
final class TutorWritesLab: ObservableObject {
    static let log = Logger(subsystem: "app.agathon.ios", category: "live")

    /// The scenarios: the kid's lines, one under another (a stacked sum is its rows, then a rule).
    struct Demo {
        var lines: [String]
        var stack: [String]?
    }

    static let demos: [String: Demo] = [
        "equation": Demo(lines: ["2x + 3 = 11"]),
        "slip": Demo(lines: ["2x + 3 = 11", "2x = 9"]),
        "fractions": Demo(lines: ["\\frac{1}{2} + \\frac{1}{3} ="]),
        "column": Demo(lines: [], stack: ["286", "+680"]),
        "long": Demo(lines: [], stack: ["46", "\\times 23"]),
    ]

    let controller = BoardController()
    let services = TutorWritesOracle()
    @Published private(set) var board: CanvasLiveBoard?
    @Published private(set) var loop: LiveLoop?
    private(set) weak var canvas: BoardCanvasView?
    private var read = 0
    private let demoName: String

    init() {
        let args = ProcessInfo.processInfo.arguments
        func arg(_ name: String) -> String? {
            guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
            return args[i + 1]
        }
        demoName = arg("-tutorWritesDemo") ?? "equation"
        self.mode = switch arg("-tutorWritesMode") {
        case "hint": .feedback
        case "solve": .answer
        default: .suggest
        }
        answers = args.contains("-tutorWritesAnswers")
    }

    private let mode: LiveMode
    private let answers: Bool

    var title: String { "Tutor writes it out" }

    var summary: String {
        guard let loop else { return "no loop" }
        let read = loop.lines.values.filter { !$0.latex.isEmpty }.count
        let store = controller.store
        let steps = Set(store.records.values.compactMap { r -> String? in
            guard case .stroke(let s) = r, s.author == .tutor else { return nil }
            return s.meta["tutorStepId"]?.stringValue
        }).count
        let card = loop.hints.first.map { "\($0.title): \($0.message)" } ?? "-"
        let writing: Bool = {
            if case .solving = loop.activity { return true }
            return loop.busy
        }()
        // where the tutor's steps are on screen (view points), for the UI test's eraser
        let box: String = {
            guard let canvas else { return "-" }
            let pts = store.records.values.flatMap { r -> [CGPoint] in
                guard case .stroke(let s) = r, s.author == .tutor, s.meta["tutorStepId"] != nil else { return [] }
                return s.points.map { p in let v = canvas.camera.toView(s.pagePoint(p)); return canvas.convert(v, to: nil) }
            }
            guard let x0 = pts.map(\.x).min(), let x1 = pts.map(\.x).max(), let y0 = pts.map(\.y).min(), let y1 = pts.map(\.y).max() else { return "-" }
            return "\(Int(x0)),\(Int(y0)),\(Int(x1 - x0)),\(Int(y1 - y0))"
        }()
        return "read \(read) | steps \(steps) | writing \(writing ? "yes" : "no") | card \(card) | box \(box)"
    }

    func attach(_ canvas: BoardCanvasView) {
        guard self.canvas == nil else { return }
        self.canvas = canvas
        let board = CanvasLiveBoard(controller: controller, canvas: canvas)
        let settings = LiveSettings(enabled: true, mode: mode, auto: false, handwriting: true, celebrations: true, answerOnEquals: answers,
                                    checking: .asIGo, showReadings: false)
        let loop = LiveLoop(board: board, boardId: "tutor-writes-lab", services: services, settings: settings)
        self.board = board
        self.loop = loop
        loop.start()
        Task { await play() }
    }

    /// The kid's work, written in the synthetic hand through the canvas, each line registered with
    /// the stand-in reader.
    func play() async {
        guard let demo = Self.demos[demoName], let canvas, let board else { return }
        try? await Brain.shared.load()
        // a beat for the board to settle on screen
        try? await Task.sleep(for: .milliseconds(800))
        var y = 150.0
        let x = 260.0
        func write(_ latex: String, rule: Bool, readAs: String) async {
            guard let ink = try? await StudentHand.ink(latex, hand: .clean, brain: Brain.shared) else {
                Self.log.error("TUTORWRITES no ink for \(latex, privacy: .public)")
                return
            }
            var page = ink.map { s in s.map { Vec2(x + $0.x, y + $0.y) } }
            if rule {
                let pts = page.flatMap { $0 }
                let x0 = (pts.map(\.x).min() ?? x) - 16, x1 = (pts.map(\.x).max() ?? x) + 12, ry = (pts.map(\.y).max() ?? y) + 14
                page.append(stride(from: x0, through: x1, by: 4).map { Vec2($0, ry + ($0 - x0) * 0.01) })
            }
            let before = Set(kidStrokeIds())
            board.notePen(true)
            for pts in page {
                let view = Self.densify(pts).map { canvas.camera.toView($0) }
                let length = zip(pts, pts.dropFirst()).reduce(0) { $0 + $1.0.dist($1.1) }
                await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
                    canvas.simulateStroke(view, duration: max(0.06, length / 900)) { done.resume() }
                }
            }
            board.notePen(false)
            let ids = kidStrokeIds().filter { !before.contains($0) }
            await services.register(strokes: kidStrokes(ids), reads: readAs)
            y = (page.flatMap { $0 }.map(\.y).max() ?? y) + 56
            Self.log.notice("TUTORWRITES wrote \(readAs, privacy: .public)")
        }
        if let rows = demo.stack {
            let array = "\\begin{array}{r} \(rows.joined(separator: " \\\\ ")) \\end{array}"
            await write(array, rule: true, readAs: "\\begin{array}{r} \(rows.joined(separator: " \\\\ ")) \\\\ \\hline \\end{array}")
        }
        for line in demo.lines { await write(line, rule: false, readAs: line) }
    }

    private func kidStrokeIds() -> [String] {
        controller.store.drawables(on: controller.currentScreenID).compactMap { r in
            if case .stroke(let s) = r, s.author == .kid { return s.id.rawValue }
            return nil
        }
    }

    /// The kid's strokes as the brain takes them (the loop's own rounding: `BoardStore.kidStrokes`).
    private func kidStrokes(_ ids: [String]) -> [BrainStroke] {
        let set = Set(ids)
        return controller.store.drawables(on: controller.currentScreenID).compactMap { r -> BrainStroke? in
            guard case .stroke(let s) = r, set.contains(s.id.rawValue), !s.points.isEmpty else { return nil }
            var xs: [Double] = [], ys: [Double] = []
            for p in s.points {
                let v = s.pagePoint(p)
                xs.append((v.x * 100).rounded() / 100)
                ys.append((v.y * 100).rounded() / 100)
            }
            return BrainStroke(id: s.id.rawValue, x: xs, y: ys)
        }
    }

    static func densify(_ p: [Vec2]) -> [Vec2] {
        guard p.count >= 2 else { return p }
        var out: [Vec2] = [p[0]]
        for (a, b) in zip(p, p.dropFirst()) {
            let n = max(1, Int(a.dist(b) / 2))
            for k in 1...n { out.append(a.lerp(b, Double(k) / Double(n))) }
        }
        return out
    }
}

/// A stand-in for the Live routes: reads what the lab wrote, perfectly (by the line's payload, as the
/// recognizer gets it); no checks, no model. Nothing leaves the iPad.
final class TutorWritesOracle: LiveServices, @unchecked Sendable {
    private let lock = NSLock()
    private var reads: [[String]: String] = [:]

    static func canon(_ x: [[Double]], _ y: [[Double]]) -> [String] {
        zip(x, y).map { "\($0)|\($1)" }.sorted()
    }

    func register(strokes: [BrainStroke], reads latex: String) async {
        guard let payload = try? await Brain.shared.recognizerPayload(strokes) else { return }
        let key = Self.canon(payload.strokes.x, payload.strokes.y)
        lock.withLock { reads[key] = latex }
    }

    func capabilities() async throws -> LiveCapabilities {
        try JSONDecoder().decode(LiveCapabilities.self, from: Data(#"{"recognizer":"mathpix","liveEnabled":true}"#.utf8))
    }

    func recognize(_ request: RecognizeRequest) async throws -> RecognizeResponse {
        let key = Self.canon(request.strokes.x, request.strokes.y)
        // the lab registers a line just after writing it: a read asked a moment sooner waits for it
        for _ in 0..<40 {
            if let latex = lock.withLock({ reads[key] }) { return RecognizeResponse(latex: latex, confidence: 0.999) }
            try await Task.sleep(for: .milliseconds(50))
        }
        throw APIError.http(HTTPFailure(status: 503, code: "recognizer_failed", message: "the lab did not write this", body: .object(["unreadable": .bool(true)])))
    }

    func reread(_ request: RereadRequest) async throws -> RereadResponse {
        throw APIError.http(HTTPFailure(status: 404, code: "off", message: "no second reader in the lab", body: .object([:])))
    }

    func setup(_ request: SetupRequest) async throws -> SetupResponse {
        throw APIError.http(HTTPFailure(status: 404, code: "off", message: "no setup in the lab", body: .object([:])))
    }

    func check(_ request: CheckRequest) -> LiveEventStream {
        LiveEventStream { $0.finish() }
    }

    func solve(_ request: SolveRequest) -> LiveEventStream {
        LiveEventStream { $0.finish() }
    }
}
#endif
