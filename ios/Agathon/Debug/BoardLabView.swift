#if DEBUG
import AgathonBoard
import AgathonBoardUI
import AgathonDesign
import SwiftUI
import UIKit

/// Board Lab: the engine on its own, for the board lane's measurements (plain UI; the real board's
/// design comes from the brand lane). Reach it with the launch argument `-boardLab`.
///
/// Launch arguments (all optional, for screenshots and measurements):
///   -boardLabFixture <kid-algebra|legacy-noscreen|legacy-small|synthetic-2000|dense-600|dense-5000|board-lab>
///   -boardLabScreen <n>      show screen n (1-based)
///   -boardLabZoom <z>        zoom (1 = the whole screen); -boardLabZoomAt x,y keeps that page point in place
///   -boardLabDemo YES        write a few lines through the input path, then the tutor marks them
///   -boardLabErase YES       after the demo, rub out its middle line with the eraser
///   -boardLabSave YES        save the board to Documents/board-lab.json afterwards (then `-boardLabFixture board-lab` loads it)
///   -boardLabNoChrome YES    no tool strip or stats (measures the canvas without SwiftUI updating beside it)
///   -boardLabTiles surface   settled ink in IOSurface tiles (default: CGImage tiles)
///   -boardLabSweep YES       zoom 1× → 4× → 1× while panning, and report the frames
///   -boardLabStats YES       print the numbers to the console after loading / the demo
///   -boardLabEditor YES      show the board in the Blocks editor (AgathonBoardUI) instead of the Lab's strip
///   -boardLabSelect <ids>    select these records (comma-separated, or `all`) with the Select tool
///   -boardLabPanel <shapes|picture|more|colors>   open a dock panel (screenshots)
///   -boardLabHelp YES        fill the Live lane's slots with stand-ins (Help me, a status pill)
///   -boardLabWidth <pt>      the editor in a narrower column (a split view)
///   -boardLabLandscape YES   ask for landscape (screenshots)
///   -boardLabFrame 1376x1032 the editor laid out at another screen size, scaled to fit (a landscape shot)
struct BoardLabView: View {
    @StateObject private var lab = BoardLabModel()
    /// open straight in the Blocks editor, on the objects board when no fixture is named
    var startInEditor = false

    init(startInEditor: Bool = false) {
        self.startInEditor = startInEditor
        BoardCanvasView.surfaceTiles = UserDefaults.standard.string(forKey: "boardLabTiles") == "surface"
    }

    var body: some View {
        Group {
            if lab.editor {
                editor
            } else {
                ZStack(alignment: .top) {
                    BoardCanvas(controller: lab.controller, insets: CameraConstraints(top: 150, left: 16, bottom: 16, right: 16)) { canvas in
                        lab.attach(canvas)
                    }
                    .ignoresSafeArea()
                    if !UserDefaults.standard.bool(forKey: "boardLabNoChrome") {
                        LabChrome(lab: lab, controller: lab.controller)
                    }
                }
            }
        }
        .task {
            if UserDefaults.standard.bool(forKey: "boardLabLandscape"),
               let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
                // screenshots: the iPad on its side, without touching the Simulator
                scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeLeft)) { _ in }
            }
            if startInEditor { lab.editor = true }
            await lab.start(defaultFixture: startInEditor ? "objects" : nil)
        }
    }

    /// The board in the Blocks editor (the Lab's back button returns to the plain Lab).
    @ViewBuilder private var editor: some View {
        let width = Double(UserDefaults.standard.string(forKey: "boardLabWidth") ?? "")
        let panel = DockPanel(rawValue: UserDefaults.standard.string(forKey: "boardLabPanel") ?? "")
        // -boardLabHelp YES: the Live lane's slots filled with stand-ins (Help me, a status pill)
        let view: AnyView = UserDefaults.standard.bool(forKey: "boardLabHelp")
            ? AnyView(BoardEditorView(controller: lab.controller, title: lab.title, onBack: { lab.editor = false },
                                      onCanvas: { lab.attach($0) }, initialPanel: panel,
                                      topTrailing: { StatusPill("Checking…") }, helpButton: { HelpMeButton {} }, overlay: { _ in EmptyView() }))
            : AnyView(BoardEditorView(controller: lab.controller, title: lab.title, onBack: { lab.editor = false },
                                      onCanvas: { lab.attach($0) }, initialPanel: panel))
        let frame = (UserDefaults.standard.string(forKey: "boardLabFrame") ?? "").split(separator: "x").compactMap { Double($0) }
        if frame.count == 2 {
            // another iPad's screen (landscape on a portrait simulator), scaled to fit: screenshots
            GeometryReader { geo in
                let k = min(geo.size.width / frame[0], geo.size.height / frame[1])
                view.frame(width: frame[0], height: frame[1])
                    .scaleEffect(k)
                    .frame(width: geo.size.width, height: geo.size.height)
            }
            .background(Color.black)
            .ignoresSafeArea()
        } else if let width {
            HStack(spacing: 0) {
                view.frame(width: width)
                Color.black.opacity(0.85).ignoresSafeArea()
            }
        } else {
            view
        }
    }
}

/// The Lab's tool strip and stats, watching the board controller.
private struct LabChrome: View {
    @ObservedObject var lab: BoardLabModel
    @ObservedObject var controller: BoardController

    var body: some View {
        VStack(spacing: 6) {
            toolRow
            labRow
            Spacer()
            HStack {
                statsPanel
                Spacer()
            }
        }
        .padding(10)
    }

    private var toolRow: some View {
        ScrollView(.horizontal, showsIndicators: false) { toolButtons }
            .padding(8)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
    }

    private var toolButtons: some View {
        HStack(spacing: 8) {
            Picker("Tool", selection: $controller.tool) {
                Text("Pen").tag(BoardTool.pen)
                Text("Eraser").tag(BoardTool.eraser)
            }
            .pickerStyle(.segmented)
            .frame(width: 150)
            ForEach(InkColor.kidPalette, id: \.self) { c in
                Button {
                    controller.color = c
                    controller.tool = .pen
                } label: {
                    Circle()
                        .fill(Color(cgColor: RenderGeometry.cgColor(c)))
                        .frame(width: 28, height: 28)
                        .overlay(Circle().stroke(Color.primary, lineWidth: controller.color == c ? 3 : 0).padding(-4))
                }
                .accessibilityLabel(c.rawValue)
            }
            Picker("Size", selection: $controller.penSize) {
                Text("Regular").tag(InkStyle.PenSize.regular)
                Text("Fine").tag(InkStyle.PenSize.fine)
            }
            .pickerStyle(.segmented)
            .frame(width: 150)
            Button("Undo") { controller.undo() }.disabled(!controller.canUndo)
            Button("Redo") { controller.redo() }.disabled(!controller.canRedo)
            Divider().frame(height: 24)
            Button("‹") { controller.previousScreen() }.disabled(controller.screenIndex <= 1)
            Text("\(controller.screenIndex) / \(controller.screenCount)").monospacedDigit()
            Button("›") { controller.nextScreen() }.disabled(controller.screenIndex >= controller.screenCount)
            Button("New screen") { controller.addScreen() }
            Toggle("Draw with finger", isOn: $controller.drawWithFinger)
                .fixedSize()
        }
        .buttonStyle(.bordered)
        .lineLimit(1)
        .fixedSize()
    }

    private var labRow: some View {
        ScrollView(.horizontal, showsIndicators: false) { labButtons }
            .padding(8)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
    }

    private var labButtons: some View {
        HStack(spacing: 8) {
            Menu("Load fixture") {
                ForEach(BoardLabModel.fixtures, id: \.self) { name in
                    Button(name) { Task { await lab.load(name) } }
                }
            }
            Button("Save JSON") { lab.saveJSON() }
            Button("Load JSON") { Task { await lab.load("board-lab") } }
            Button("Blank") { controller.load(.blank()) }
            Button("Blocks editor") { lab.editor = true }
            Divider().frame(height: 24)
            Button("Demo writing") { Task { await lab.demo() } }
            Button("Tutor marks") { lab.tutorMarks() }
            Divider().frame(height: 24)
            ForEach([1.0, 2.0, 4.0], id: \.self) { z in
                Button("\(Int(z))×") { lab.canvas?.setZoom(z) }
            }
            Text(lab.status).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
        }
        .buttonStyle(.bordered)
        .lineLimit(1)
        .fixedSize()
    }

    private var statsPanel: some View {
        let s = controller.publishedStats
        return VStack(alignment: .leading, spacing: 2) {
            Text("strokes \(s.strokeCount) · records \(s.recordCount) · doc \(BoardLabModel.bytes(s.docBytes))")
            Text(String(format: "touch→commit %.1f ms (p50 %.1f, p95 %.1f) · commit work %.2f ms (scene %.2f, tiles %.2f)", s.lastTouchToCommitMs, s.commitP50, s.commitP95, s.lastCommitWorkMs, s.lastSceneMs, s.lastTilesMs))
            Text(String(format: "live path max %.2f ms · frames %.1f ms mean, %.1f max, %d dropped @ %.0f Hz", s.lastLivePathMaxMs, s.drawingFrameMeanMs, s.drawingFrameMaxMs, s.drawingFramesDropped, s.displayHz))
            Text(String(format: "load %.0f ms (%@) · erase %.2f ms", s.lastLoadMs, s.lastLoadBreakdown, s.lastEraseMs))
            Text("Pencil seen: \(controller.pencilSeen ? "yes" : "no") · finger draws: \(controller.fingerDraws ? "yes" : "no")")
        }
        .font(.system(size: 12, design: .monospaced))
        .padding(8)
        .background(.black.opacity(0.72), in: RoundedRectangle(cornerRadius: 8))
        .foregroundStyle(.white)
        .accessibilityIdentifier("boardLab.stats")
    }
}

@MainActor
final class BoardLabModel: ObservableObject {
    let controller = BoardController()
    private(set) weak var canvas: BoardCanvasView?
    private var writer: TutorWriter?
    @Published var status = ""
    /// the board shown in the Blocks editor (AgathonBoardUI)
    @Published var editor = UserDefaults.standard.bool(forKey: "boardLabEditor")
    @Published var title = "Board Lab"

    init() {
        // pictures added in the Lab stay in memory
        controller.assetStore = MemoryBoardAssetStore()
        controller.boardId = "board-lab"
    }

    static let fixtures = ["objects", "kid-algebra", "legacy-noscreen", "legacy-small", "synthetic-2000", "dense-600", "dense-5000", "board-lab"]

    /// The package's test fixtures, read from the Mac's disk (the simulator can; a device cannot).
    static let fixtureDir = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("Packages/AgathonBoard/Tests/AgathonBoardTests/Fixtures")

    static var savedURL: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("board-lab.json")
    }

    static let titles = ["objects": "Pictures, maths and graphs", "kid-algebra": "Solving for x", "legacy-noscreen": "My first board",
                         "legacy-small": "Shapes and lines", "synthetic-2000": "Lots of writing", "dense-600": "A full page", "dense-5000": "5,000 strokes"]

    static func bytes(_ n: Int) -> String {
        n >= 1_000_000 ? String(format: "%.2f MB", Double(n) / 1_000_000) : String(format: "%.1f KB", Double(n) / 1000)
    }

    func attach(_ canvas: BoardCanvasView) {
        self.canvas = canvas
        writer = TutorWriter(controller: controller, canvas: canvas)
        // a canvas made again (the Lab ⇄ the editor): draw the board into it
        controller.resetScene()
    }

    private var args: UserDefaults { .standard }

    func start(defaultFixture: String? = nil) async {
        // the canvas laid out and its first screen drawn before anything is written on it
        while canvas == nil || (canvas?.bounds.width ?? 0) == 0 || controller.isLoading {
            try? await Task.sleep(nanoseconds: 50_000_000)
        }
        try? await Task.sleep(nanoseconds: 300_000_000)
        guard let name = args.string(forKey: "boardLabFixture") ?? defaultFixture else {
            if args.bool(forKey: "boardLabDemo") { await demo() }
            return
        }
        await load(name)
        if let n = Int(args.string(forKey: "boardLabScreen") ?? ""), n > 1 {
            let ids = controller.store.screenIDs
            if n <= ids.count {
                await drawn { controller.goToScreen(ids[n - 1]); controller.resetScene(onDrawn: $0) }
            }
        }
        if let z = Double(args.string(forKey: "boardLabZoom") ?? ""), z > 1, let canvas {
            try? await Task.sleep(nanoseconds: 300_000_000)
            // -boardLabZoomAt x,y: the page point to keep where it is
            let at = (args.string(forKey: "boardLabZoomAt") ?? "").split(separator: ",").compactMap { Double($0) }
            canvas.setZoom(z, around: at.count == 2 ? canvas.camera.toView(Vec2(at[0], at[1])) : nil)
        }
        if args.bool(forKey: "boardLabDemo") { await demo() }
        if let pick = args.string(forKey: "boardLabSelect") {
            controller.tool = .select
            let ids = pick == "all" ? Set(controller.store.drawableIDs(on: controller.currentScreenID))
                : Set(pick.split(separator: ",").map { RecordID(String($0)) })
            controller.select(ids)
        }
        if args.bool(forKey: "boardLabSweep"), let canvas {
            let (frames, workMax, detailMs) = await withCheckedContinuation { (k: CheckedContinuation<([Double], Double, Double), Never>) in
                canvas.sweepCamera { k.resume(returning: ($0, $1, $2)) }
            }
            let expected = 1000 / max(1, controller.stats.displayHz > 0 ? controller.stats.displayHz : 60)
            let mean = frames.reduce(0, +) / Double(max(1, frames.count))
            log(String(format: "BOARDLAB sweep 1×→4×→3× | %d frames, mean %.2f ms, max %.2f ms, %d over 1.5× budget | camera work max %.2f ms | detail tiles %d on screen %.0f ms after the camera stopped",
                       frames.count, mean, frames.max() ?? 0, frames.filter { $0 > expected * 1.5 }.count, workMax, canvas.detailTileCount, detailMs))
        }
        if args.bool(forKey: "boardLabSave") {
            saveJSON()
            log("saved: \(status)")
        }
    }

    /// Waits for `body`'s drawing to finish.
    private func drawn(_ body: (@escaping () -> Void) -> Void) async {
        await withCheckedContinuation { (k: CheckedContinuation<Void, Never>) in body { k.resume() } }
    }

    func load(_ name: String) async {
        let t0 = CFAbsoluteTimeGetCurrent()
        var doc: BoardDocument
        var screen: RecordID?
        var detail = ""
        do {
            switch name {
            case "dense-600":
                doc = SyntheticBoards.handwriting(strokes: 600)
            case "dense-5000":
                doc = SyntheticBoards.handwriting(strokes: 5000)
            case "objects":
                let (d, store) = await BoardFixtures.objects()
                doc = d
                controller.assetStore = store
            case "board-lab":
                let data = try Data(contentsOf: Self.savedURL)
                let t1 = CFAbsoluteTimeGetCurrent()
                doc = try await Task.detached { try BoardDocument.decode(data) }.value
                detail = String(format: "read %.0f ms, decode %.0f ms (%@)", (t1 - t0) * 1000, (CFAbsoluteTimeGetCurrent() - t1) * 1000, Self.bytes(data.count))
            default:
                let data = try Data(contentsOf: Self.fixtureDir.appendingPathComponent("\(name).tldraw.json"))
                let t1 = CFAbsoluteTimeGetCurrent()
                let result = try await Task.detached { try TldrawImporter.importSnapshot(data) }.value
                doc = result.document
                screen = result.currentScreen
                let r = result.report
                detail = String(format: "read %.0f ms, convert %.0f ms; %d screens, %d strokes (%d tutor), %d shapes, %d maths, %d lines, %d marks, skipped %@",
                                (t1 - t0) * 1000, (CFAbsoluteTimeGetCurrent() - t1) * 1000, r.screens, r.strokes, r.tutorStrokes, r.shapes, r.maths, r.lines, r.marks,
                                r.skipped.map { "\($0.key)×\($0.value)" }.sorted().joined(separator: ","))
            }
        } catch {
            status = "\(name): \(error)"
            return
        }
        let t2 = CFAbsoluteTimeGetCurrent()
        await drawn { done in
            controller.load(doc, screen: screen)
            controller.resetScene(onDrawn: done)
        }
        let total = (CFAbsoluteTimeGetCurrent() - t0) * 1000
        title = Self.titles[name] ?? name
        status = String(format: "%@: open %.0f ms total — %@", name, total, detail)
        log("load \(name): total \(Int(total)) ms; before store \(Int((t2 - t0) * 1000)) ms; \(detail); scene \(controller.stats.lastLoadBreakdown)")
        if args.bool(forKey: "boardLabStats") { printStats("after load \(name)") }
    }

    func saveJSON() {
        do {
            let data = try controller.documentJSON()
            try data.write(to: Self.savedURL)
            status = "saved \(Self.bytes(data.count)) to \(Self.savedURL.lastPathComponent)"
        } catch {
            status = "save failed: \(error)"
        }
    }

    // MARK: - Demo: writing through the input path

    /// Writes three lines of maths through the same path a touch takes (one sample a frame, Pencil-like),
    /// then has the tutor tick them at handwriting pace.
    func demo() async {
        guard let canvas else { return }
        controller.tool = .pen
        controller.color = .black
        let lines: [(String, Vec2)] = [("2x+3=11", Vec2(140, 120)), ("2x=8", Vec2(140, 300)), ("x=4", Vec2(160, 480))]
        var boxes: [Box] = []
        for (text, at) in lines {
            var box: Box?
            for stroke in DemoFont.strokes(text, at: at, size: 90) {
                let view = stroke.map { canvas.camera.toView($0) }
                let length = zip(stroke, stroke.dropFirst()).reduce(0) { $0 + $1.0.dist($1.1) }
                await withCheckedContinuation { (k: CheckedContinuation<Void, Never>) in
                    canvas.simulateStroke(view, duration: max(0.12, length / 900)) { k.resume() }
                }
                let b = Box.around(stroke)!
                box = box.map { $0.union(b) } ?? b
                try? await Task.sleep(nanoseconds: 60_000_000)
            }
            if let box { boxes.append(box) }
        }
        tutorMarks(boxes: boxes)
        if args.bool(forKey: "boardLabErase"), boxes.count > 1 {
            // the eraser through the middle line, like a finger rubbing it out
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            controller.tool = .eraser
            let b = boxes[1]
            let path = stride(from: b.minX - 20, through: b.maxX + 20, by: 6).map { x in
                canvas.camera.toView(Vec2(x, b.center.y + sin(x / 30) * b.h * 0.3))
            }
            await withCheckedContinuation { (k: CheckedContinuation<Void, Never>) in
                canvas.simulateStroke(path, duration: 0.6, pencil: false) { k.resume() }
            }
            controller.tool = .pen
        }
        if args.bool(forKey: "boardLabStats") {
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            printStats("after demo")
        }
    }

    /// The tutor ticks the lines (or the last three lines of kid ink it can find) at handwriting pace.
    func tutorMarks(boxes: [Box]? = nil) {
        guard let writer else { return }
        let targets = boxes ?? []
        var lines: [TutorLine] = []
        for (i, b) in targets.enumerated() {
            lines.append(TutorLine(strokes: TutorMarks.strokes(.tick, line: b, seed: UInt32(i + 7)), latex: "\\checkmark"))
        }
        if lines.isEmpty, let screen = controller.currentScreen {
            let b = Box(x: screen.rect.x + 200, y: screen.rect.y + 200, w: 300, h: 80)
            lines = [TutorLine(strokes: TutorMarks.strokes(.ring, line: b, seed: 3)), TutorLine(strokes: TutorMarks.strokes(.tick, line: b, seed: 4))]
        }
        lines.append(TutorLine(strokes: DemoFont.strokes("x=4", at: Vec2((targets.last?.maxX ?? 600) + 160, (targets.last?.y ?? 480) + 10), size: 60).map {
            TutorStroke($0.map { ($0.x, $0.y) })
        }, latex: "x = 4"))
        writer.write(lines)
    }

    private func printStats(_ label: String) {
        let s = controller.stats
        let line = String(
            format: "BOARDLAB %@ | strokes %d records %d doc %d B | touch→commit last %.2f p50 %.2f p95 %.2f ms (n=%d) | commit work %.2f ms (scene %.2f tiles %.2f: draw %.2f image %.2f; flush %.2f) | live path max %.2f ms | frames mean %.2f max %.2f dropped %d @ %.0f Hz | load %.0f ms (%@) | erase %.2f ms",
            label, s.strokeCount, s.recordCount, s.docBytes, s.lastTouchToCommitMs, s.commitP50, s.commitP95, s.commits.count,
            s.lastCommitWorkMs, s.lastSceneMs, s.lastTilesMs, s.lastPaintMs.draw, s.lastPaintMs.image, s.lastFlushMs, s.lastLivePathMaxMs, s.drawingFrameMeanMs, s.drawingFrameMaxMs, s.drawingFramesDropped, s.displayHz,
            s.lastLoadMs, s.lastLoadBreakdown, s.lastEraseMs)
        log(line)
    }

    private func log(_ s: String) {
        print(s)
        BoardSignposts.log.notice("\(s, privacy: .public)")
    }
}

/// A tiny stroke font for the Lab's demo writing (digits, x and a few signs on a 10 × 14 box),
/// smoothed with Catmull-Rom and sampled every 1.5 page units like a Pencil.
enum DemoFont {
    static let glyphs: [Character: [[(Double, Double)]]] = [
        "0": [[(5, 1), (2, 3), (1.5, 7), (2.5, 11.5), (5, 13), (7.5, 11.5), (8.5, 7), (8, 3), (5, 1)]],
        "1": [[(3, 3.5), (5.5, 1), (5.5, 13)]],
        "2": [[(2, 4), (3.5, 1.5), (6, 1), (8, 3), (7.5, 6), (2, 13), (8.5, 12.8)]],
        "3": [[(2, 2.5), (5, 1), (8, 3), (5.5, 6.5), (8.5, 9.5), (6, 13), (2, 12)]],
        "4": [[(6.5, 1), (1.5, 9), (9, 9)], [(7, 5), (7, 13.5)]],
        "5": [[(8, 1), (3, 1.2), (2.5, 6), (6, 5.5), (8.5, 8.5), (7, 12.5), (2.5, 12.5)]],
        "6": [[(7, 1), (3, 4.5), (2, 9.5), (4.5, 13), (7.5, 11.5), (7.5, 8), (4.5, 7), (2.2, 9)]],
        "7": [[(2, 1.5), (8.5, 1.2), (4, 13.5)]],
        "8": [[(5, 7), (2.5, 4.5), (5, 1), (7.5, 4), (5, 7), (2, 10), (5, 13), (8, 10), (5, 7)]],
        "9": [[(8, 5), (5, 7), (2, 5), (4, 1), (7.5, 2), (8, 6), (7, 13.5)]],
        "x": [[(2, 5), (8, 13)], [(8, 5), (2, 13)]],
        "+": [[(5, 5), (5, 13)], [(1.5, 9), (8.5, 9)]],
        "=": [[(2, 7.5), (8.5, 7.3)], [(2, 11), (8.5, 10.8)]],
        "-": [[(2, 9), (8, 9)]],
    ]

    /// The strokes of `text` in page units, its box's top-left at `at`, `size` tall.
    static func strokes(_ text: String, at: Vec2, size: Double) -> [[Vec2]] {
        let k = size / 14
        var x = at.x
        var out: [[Vec2]] = []
        var seed: UInt64 = 7
        for ch in text {
            if ch == " " {
                x += 6 * k
                continue
            }
            guard let g = glyphs[ch] else { continue }
            for s in g {
                seed = seed &* 6_364_136_223_846_793_005 &+ 1
                let wob = Double(seed >> 33 % 1000) / 1000 - 0.5
                let pts = s.map { Vec2(x + $0.0 * k + wob * k * 0.4, at.y + $0.1 * k + wob * k * 0.3) }
                out.append(smooth(pts, step: 1.5))
            }
            x += 11.5 * k
        }
        return out
    }

    static func smooth(_ p: [Vec2], step: Double) -> [Vec2] {
        guard p.count > 2 else {
            guard p.count == 2 else { return p }
            let n = max(2, Int(p[0].dist(p[1]) / step))
            return (0...n).map { p[0].lerp(p[1], Double($0) / Double(n)) }
        }
        var out: [Vec2] = []
        for i in 0..<(p.count - 1) {
            let p0 = p[max(0, i - 1)], p1 = p[i], p2 = p[i + 1], p3 = p[min(p.count - 1, i + 2)]
            let n = max(2, Int(p1.dist(p2) / step))
            for j in 0..<n {
                let t = Double(j) / Double(n)
                let t2 = t * t, t3 = t2 * t
                func c(_ a: Double, _ b: Double, _ cc: Double, _ d: Double) -> Double {
                    0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3)
                }
                out.append(Vec2(c(p0.x, p1.x, p2.x, p3.x), c(p0.y, p1.y, p2.y, p3.y)))
            }
        }
        out.append(p[p.count - 1])
        return out
    }
}
#endif
