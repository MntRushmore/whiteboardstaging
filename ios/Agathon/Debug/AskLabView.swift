#if DEBUG
import AgathonAsk
import AgathonBoard
import AgathonBoardUI
import AgathonBrain
import AgathonDesign
import AgathonKit
import AgathonLive
import os
import SwiftUI

/// Ask Lab: the board editor in Blocks with Ask beside it (docked when the iPad is on its side, a
/// sheet when it is upright), on a sample board with a kid's line of work on it.
///
/// Two ways to talk to it:
///  - **Scripted** (the default): a made-up tutor streams replies word by word and sends real board
///    actions, which the brain plans and the tutor's pen writes. No network, nothing spent.
///  - **Live** (`-askLabLive YES`): the backend this run talks to (a Debug run's local stack:
///    AGATHON_API_URL, SUPABASE_URL, SUPABASE_ANON_KEY), with the real model, voice and mic. Each
///    ask costs money. AGATHON_TEST_EMAIL / AGATHON_TEST_PASSWORD sign the QA user in, and the Lab
///    makes a board for the chat to be saved on.
///
/// Launch arguments (all optional):
///   -askLabOpen YES          Ask open from the start
///   -askLabAsk "<words>"     send these words once the board is up (`a|b`: one after the other)
///   -askLabLive YES          the live backend instead of the scripted tutor
/// Every step is logged as `ASKLAB …` (subsystem app.agathon.Agathon, category ask).
struct AskLabView: View {
    @Environment(AgathonBackend.self) private var backend
    @StateObject private var lab = AskLabModel()

    var body: some View {
        AskPanelContainer(isOpen: $lab.open, ask: lab.parts) {
            BoardEditorView(
                controller: lab.controller, title: "Ask Lab",
                onCanvas: { canvas in lab.attach(canvas, backend: backend) },
                topTrailing: {
                    HStack(spacing: DS.Space.xs) {
                        Menu {
                            Button("Sample board") { lab.sample() }
                            Button("Blank board") { lab.blank() }
                            Divider()
                            ForEach(AskLabModel.prompts, id: \.self) { p in Button(p) { lab.ask(p) } }
                        } label: {
                            DSIcon(.bug, size: 22).foregroundStyle(DS.Color.ink)
                                .frame(width: DS.Size.round, height: DS.Size.round)
                                .background(Circle().fill(DS.Color.surface))
                        }
                        .accessibilityLabel("Ask Lab")
                        if !lab.open {
                            PillButton(AskCopy.button, icon: .chat, kind: .primary) { lab.open = true }
                                .accessibilityIdentifier("ask.open")
                        }
                    }
                },
                helpButton: { EmptyView() },
                overlay: { _ in EmptyView() }
            )
        }
        .ignoresSafeArea(.keyboard)
        // room under the Lab for its Close button (LabsMenu), clear of the composer's Send
        .padding(.bottom, 56)
        .background(DS.Color.ground.ignoresSafeArea())
    }
}

/// The Lab's board, its Ask, and the scripted tutor.
@MainActor
final class AskLabModel: ObservableObject {
    static let log = Logger(subsystem: "app.agathon.Agathon", category: "ask")
    static let prompts = [
        "How do I add 1/2 and 1/4?",
        "3 more like these",
        "Graph y = x² − 4",
        "Show me 4 × 6 as an array",
        "Explain it step by step",
        "Clear your writing",
    ]

    let controller = BoardController()
    @Published var open = UserDefaults.standard.bool(forKey: "askLabOpen")
    @Published private(set) var parts: AskParts?
    private(set) var driver: AskBoardDriver?
    private weak var canvas: BoardCanvasView?
    private var board: CanvasLiveBoard?

    init() {
        sample()
    }

    func attach(_ canvas: BoardCanvasView, backend: AgathonBackend) {
        guard self.canvas == nil else { return }
        self.canvas = canvas
        let board = CanvasLiveBoard(controller: controller, canvas: canvas)
        self.board = board
        let live = UserDefaults.standard.bool(forKey: "askLabLive")
        Task {
            var boardId = "ask-lab"
            if live {
                await signInIfAsked(backend)
                if let made = try? await backend.boards.create(title: "Ask Lab \(Date().formatted(date: .abbreviated, time: .shortened))") {
                    boardId = made.id
                }
                let (parts, driver) = AskParts.live(backend: backend, boardId: boardId, board: board, userId: backend.auth.userId, grade: 4)
                self.parts = parts
                self.driver = driver
            } else {
                let driver = AskBoardDriver(canvasBoard: board)
                let voice = AskVoice(source: nil)
                let speech = AskSpeech(voice: voice, grade: 4)
                let session = AskSession(boardId: boardId, transport: ScriptedAskTransport(), board: driver, speech: speech.queue, grade: 4)
                self.parts = AskParts(session: session, speech: speech, mic: AskMic(stt: ScriptedSpeechToText()))
                self.driver = driver
            }
            Self.log.notice("ASKLAB ready (\(live ? "live" : "scripted", privacy: .public), board \(boardId, privacy: .public))")
            // the asks to send, one after another (`|` between them), each once the last is done
            let asks = (UserDefaults.standard.string(forKey: "askLabAsk") ?? "").split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            for words in asks {
                try? await Task.sleep(for: .milliseconds(900))
                while parts?.session.busy == true { try? await Task.sleep(for: .milliseconds(200)) }
                // a moment to look at the last answer and its drawing before the next ask
                try? await Task.sleep(for: .seconds(5))
                open = true
                ask(words)
                try? await Task.sleep(for: .milliseconds(600))
            }
        }
    }

    func ask(_ words: String) {
        open = true
        guard let session = parts?.session else { return }
        Task {
            // the panel appears, then the words go (as a kid's tap would)
            try? await Task.sleep(for: .milliseconds(300))
            session.send(words)
            Self.log.notice("ASKLAB asked: \(words, privacy: .public)")
        }
    }

    private func signInIfAsked(_ backend: AgathonBackend) async {
        let env = ProcessInfo.processInfo.environment
        guard backend.auth.phase != .signedIn, let email = env["AGATHON_TEST_EMAIL"], let password = env["AGATHON_TEST_PASSWORD"] else { return }
        do {
            try await backend.auth.signIn(email: email, password: password)
            Self.log.notice("ASKLAB signed in as the QA user")
        } catch {
            Self.log.error("ASKLAB sign-in failed: \(String(describing: error), privacy: .public)")
        }
    }

    func blank() {
        controller.load(.blank())
    }

    /// A screen with a kid's line of work on it ("2x + 3 = 11", from the handwriting scoreboard's
    /// clean hand when it is on this Mac, else a few strokes), and a fraction drawn as a pizza.
    func sample() {
        var doc = BoardDocument.blank()
        guard let screen = doc.records.values.compactMap({ $0.screen }).first else { return }
        var records: [BoardRecord] = []
        var order = OrderKey.first
        func stroke(_ pts: [Vec2]) {
            guard let o = pts.first else { return }
            records.append(.stroke(StrokeRecord(screen: screen.id, order: order, author: .kid, color: .black, width: 6, pressure: .simulated,
                                                x: o.x, y: o.y, points: pts.map { InkPoint(x: $0.x - o.x, y: $0.y - o.y) }, start: 0)))
            order = OrderKey.after(order)
        }
        let hand = Self.kidHand("2x + 3 = 11")
        if hand.isEmpty {
            for i in 0..<6 { stroke([Vec2(120 + Double(i) * 46, 140), Vec2(140 + Double(i) * 46, 190)]) }
        } else {
            for s in hand { stroke(s.map { Vec2(110 + $0.x * 1.7, 110 + $0.y * 1.7) }) }
        }
        // a pizza cut in four, one slice shaded with lines (a kid's drawing the maths cannot say)
        let c = Vec2(330, 560), r = 120.0
        stroke((0...72).map { k in let a = Double(k) / 72 * 2 * .pi; return Vec2(c.x + r * cos(a), c.y + r * sin(a)) })
        stroke([Vec2(c.x - r, c.y), Vec2(c.x + r, c.y)])
        stroke([Vec2(c.x, c.y - r), Vec2(c.x, c.y + r)])
        for k in 1...5 { let d = Double(k) * 20; stroke([Vec2(c.x + d, c.y - 4), Vec2(c.x + 4, c.y - d)]) }
        for rec in records { doc.records[rec.id] = rec }
        controller.load(doc)
    }

    /// One line of the handwriting scoreboard's clean hand (Live Lab's fixture, on this Mac's disk).
    static func kidHand(_ latex: String) -> [[Vec2]] {
        guard let data = try? Data(contentsOf: LiveLabModel.fixtureURL),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let lines = json["lines"] as? [String: [String: [[String: [Double]]]]],
              let strokes = lines[latex]?["clean"] else { return [] }
        return strokes.map { s in zip(s["x"] ?? [], s["y"] ?? []).map { Vec2($0, $1) } }
    }
}

/// A made-up tutor for the Lab: replies streamed word by word, with real board actions. Nothing
/// leaves the iPad.
final class ScriptedAskTransport: AskTransport {
    func ask(_ request: AskRequest) -> AsyncThrowingStream<AskEvent, Error> {
        let (reply, actions) = Self.answer(request.message.lowercased())
        return AsyncThrowingStream { continuation in
            let task = Task {
                continuation.yield(.model("scripted"))
                try? await Task.sleep(for: .milliseconds(700))
                var words = reply.split(separator: " ", omittingEmptySubsequences: false).map(String.init)
                var first = true
                while !words.isEmpty {
                    let chunk = words.prefix(2).joined(separator: " ")
                    words.removeFirst(min(2, words.count))
                    continuation.yield(.delta((first ? "" : " ") + chunk))
                    first = false
                    try? await Task.sleep(for: .milliseconds(70))
                    if Task.isCancelled { continuation.finish(throwing: CancellationError()); return }
                }
                continuation.yield(.reply(reply))
                continuation.yield(.actions(AskActions(actions: actions, notes: [])))
                continuation.yield(.done(AskDone(model: "scripted", ms: 1200)))
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    func history(boardId: String, screen: AskHistoryScreen?) async -> (history: AskHistoryResponse?, retry: Bool) {
        let first = screen?.first ?? true
        let hello = first
            ? AskHello(greeting: "Welcome back, Maya! Last time you worked on adding fractions.", chips: ["3 more like last time", "How do I add 1/2 and 1/4?", "Why is the sky blue?"])
            : AskHello(greeting: "New screen! What should we work on?", chips: ["3 more on adding fractions"])
        return (AskHistoryResponse(turns: [], hello: hello), false)
    }

    func move(boardId: String, turnIds: [String], screenId: String) async -> Bool { true }

    static func json(_ s: String) -> AgathonKit.JSONValue { AgathonKit.JSONValue.parse(Data(s.utf8)) ?? .null }

    static func answer(_ m: String) -> (String, [AgathonKit.JSONValue]) {
        if m.contains("1/2") || m.contains("fraction") {
            return ("Great question! To add $\\frac{1}{2}$ and $\\frac{1}{4}$, make the bottoms match first:\n\n$$\\frac{1}{2} = \\frac{2}{4}$$\n\nThen add the tops: $\\frac{2}{4} + \\frac{1}{4} = \\frac{3}{4}$. I drew it on your board, so you can see the pieces.",
                    [json(#"{"type":"draw_model","model":{"kind":"fraction_bars","bars":[{"parts":2,"shaded":1,"label":"\\frac{1}{2}"},{"parts":4,"shaded":1,"label":"\\frac{1}{4}"},{"parts":4,"shaded":3,"label":"\\frac{3}{4}"}]}}"#)])
        }
        if m.contains("more like") {
            return ("Here are 3 more like yours. Try the first one, and I'll check each line as you go.",
                    [json(#"{"type":"write_problems","problems":[["3x + 4 = 19"],["5x - 2 = 13"],["2x + 7 = 15"]]}"#)])
        }
        if m.contains("graph") {
            return ("Here's the graph of $y = x^2 - 4$. It crosses the $x$-axis at $-2$ and $2$.", [json(#"{"type":"graph","relations":["y = x^{2} - 4"]}"#)])
        }
        if m.contains("array") {
            return ("Here are **4 rows** of **6**. Count them: $4 \\times 6 = 24$.", [json(#"{"type":"draw_model","model":{"kind":"array","rows":4,"cols":6}}"#)])
        }
        if m.contains("step") {
            return ("Let's solve $2x + 3 = 11$ together.\n\n1. Take 3 from both sides.\n2. Divide both sides by 2.",
                    [json(#"{"type":"teach","steps":[{"say":"Take 3 from both sides.","math":["2x + 3 = 11","2x = 8"]},{"say":"Divide both sides by 2.","math":["x = 4"]}],"answer":"x = 4"}"#)])
        }
        if m.contains("clear") {
            return ("Done! I rubbed out my writing.", [json(#"{"type":"clear_tutor"}"#)])
        }
        return ("I'm a pretend tutor in the Lab. Try one of the chips, or turn on live mode to ask the real one.", [])
    }
}

/// The Lab's mic without a backend: says it heard a fixed question.
struct ScriptedSpeechToText: SpeechToText {
    func transcribe(_ audio: Data, seconds: Double) async -> AskMicLogic.Outcome { .text("How do I add 1/2 and 1/4?") }
}
#endif
