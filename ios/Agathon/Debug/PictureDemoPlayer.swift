#if DEBUG
import AgathonBoard
import AgathonLive
import os
import SwiftUI
import UIKit

/// Debug only: the school demo's picture-tutor recordings (docs/DEMO-VIDEOS.md). A script made on the
/// Mac (scripts/demo-pen.py: a fluent single-line hand, laid out with a writer's wobble and pace) is
/// written on the real board through the canvas's own touch path, the board's real buttons are tapped
/// by the UI test (Draw now, Accept), and the picture tutor answers on production.
///
/// `-pictureDemo <script.json> [-kidRun <label>] -pictureTutor.enabled YES -pictureTutor.mode suggest`.
/// The script: `{"id", "title", "steps": [...]}`, a step one of
///   `{"write": [[[x, y], …], …], "pauses": [ms…], "durs": [ms…]}`  strokes in page layout units (1600 × 900)
///   `{"pause": seconds}`
///   `{"tap": "picture.drawNow" | "picture.accept" | "picture.reject"}`   the UI test taps it
///   `{"auto": false | true}`   the picture tutor's own look after a pause held off (while the problem is written)
///   `{"waitFor": "ghost" | "shown" | "idle" | "tick", "timeout": seconds}`
///   `{"mark": "name"}`         a moment for the edit (seconds since 1970 in the result)
/// State on `debug.session` as the kid sessions' (`running`, `await <n> <id>`, `done`); the result
/// (JSON: marks, the tutor's runs, the picture's region) goes to Documents/picture-demos/<run>/<id>.json.
struct PictureDemoControls: View {
    @ObservedObject var model: BoardScreenModel
    @ObservedObject private var player = PictureDemoPlayer.shared

    var body: some View {
        if PictureDemoPlayer.scriptPath != nil {
            HStack(spacing: 2) {
                Color.clear.frame(width: 2, height: 2)
                    .accessibilityElement()
                    .accessibilityLabel(player.status)
                    .accessibilityIdentifier("debug.session")
                Button { player.ack(found: true) } label: { Color.clear.frame(width: 22, height: 22).contentShape(Rectangle()) }
                    .accessibilityIdentifier("debug.session.ack")
                Button { player.ack(found: false) } label: { Color.clear.frame(width: 22, height: 22).contentShape(Rectangle()) }
                    .accessibilityIdentifier("debug.session.missing")
            }
            .task(id: model.picture != nil) {
                if model.picture != nil { player.start(model: model) }
            }
        }
    }
}

@MainActor
final class PictureDemoPlayer: ObservableObject {
    static let shared = PictureDemoPlayer()
    nonisolated static let log = Logger(subsystem: "app.agathon.ios", category: "pictureDemo")

    static var scriptPath: String? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-pictureDemo"), i + 1 < args.count else { return nil }
        return args[i + 1]
    }

    /// The picture tutor's own look after a pause, held off while the kid writes the problem.
    static var autoPaused = false

    @Published private(set) var status = "idle"
    private var started = false
    private var acked: Bool?
    private var awaitSeq = 0

    func start(model: BoardScreenModel) {
        guard !started, let path = Self.scriptPath else { return }
        started = true
        Task { @MainActor in
            let result = await PictureDemoRun(path: path, model: model, player: self).go()
            self.status = "done \(result.ok ? 1 : 0)/1 ink \(result.ink)"
        }
    }

    func set(_ s: String) { status = s }

    func ack(found: Bool) { acked = found }

    func await(_ id: String, timeout: Double = 40) async -> Bool? {
        acked = nil
        awaitSeq += 1
        status = "await \(awaitSeq) \(id)"
        let end = Date().addingTimeInterval(timeout)
        while acked == nil && Date() < end { try? await Task.sleep(for: .milliseconds(150)) }
        return acked
    }
}

/// The recording's clock: the simulator's screen recording stamps frames by when they arrive, and its
/// clock drifts while the app is busy, so the edit finds each step in the picture itself. A 6-point
/// square in the window's top-left corner (the finished clip's rounded corner hides it) shows the
/// step being played (red = step × 6) and changes every display refresh (green), so frames keep coming.
@MainActor
final class PictureDemoSync: NSObject {
    var step = 0
    /// held still while the UI test presses a button (it waits for the app to be idle)
    var paused = false
    private let square = UIView(frame: CGRect(x: 0, y: 0, width: 6, height: 6))
    private var link: CADisplayLink?
    private var odd = false

    init(window: UIWindow?) {
        super.init()
        square.isUserInteractionEnabled = false
        window?.addSubview(square)
        link = CADisplayLink(target: self, selector: #selector(tick))
        link?.add(to: .main, forMode: .common)
    }

    private var shown = -1

    @objc private func tick() {
        // while the UI test presses a button, only a new step changes the square (it waits for an idle app)
        if paused && step == shown { return }
        if !paused { odd.toggle() }
        shown = step
        square.backgroundColor = UIColor(red: CGFloat(min(255, step * 6)) / 255, green: odd ? 0.47 : 0, blue: 0.35, alpha: 1)
        square.superview?.bringSubviewToFront(square)
    }

    func stop() {
        link?.invalidate()
        link = nil
        square.removeFromSuperview()
    }
}

struct PictureDemoResult: Codable {
    struct Run: Codable {
        var mode: String
        var source: String
        var outcome: String
        var endMs: Double?
        var costUsd: Double?
        var note: String?
    }
    var id = ""
    var title = ""
    var startedAt: Double = 0
    var endedAt: Double = 0
    var marks: [String: Double] = [:]
    var notes: [String] = []
    var runs: [Run] = []
    /// the tutor's last picture: where its ink is, in view points (the screen recording's frame), and when
    var pictureView: [Double]?
    /// …and on the page (layout units, 1600 × 900): the kid's answer is written clear of it
    var pictureLayout: [Double]?
    /// how far the kid's answer was moved to keep clear of the picture (layout units)
    var answerShift: [Double]?
    var ticks = 0
    var ink = 0
    var ok = true
}

@MainActor
private final class PictureDemoRun {
    let path: String
    let model: BoardScreenModel
    let player: PictureDemoPlayer
    var result = PictureDemoResult()
    var rng = SplitMix(seed: 41)

    var tutor: BoardTutor? { model.tutor }
    var picture: PictureTutor? { model.picture }
    var controller: BoardController? { tutor?.liveBoard.controller }
    var canvas: BoardCanvasView? { tutor?.liveBoard.canvas }

    init(path: String, model: BoardScreenModel, player: PictureDemoPlayer) {
        self.path = path
        self.model = model
        self.player = player
    }

    var steps: [[String: Any]] = []
    var stepIndex = 0
    var sync: PictureDemoSync?
    var shift: Vec2?

    func go() async -> PictureDemoResult {
        player.set("starting: waiting for the board")
        for _ in 0..<100 where (canvas?.bounds.width ?? 0) == 0 { try? await Task.sleep(for: .milliseconds(100)) }
        guard let data = FileManager.default.contents(atPath: path),
              let script = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let steps = script["steps"] as? [[String: Any]] else {
            result.ok = false
            result.notes.append("no script at \(path)")
            save()
            return result
        }
        result.id = script["id"] as? String ?? "demo"
        result.title = script["title"] as? String ?? ""
        try? await Task.sleep(for: .seconds(1.5))
        result.startedAt = Date().timeIntervalSince1970
        let watch = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                self?.watch()
                try? await Task.sleep(for: .milliseconds(200))
            }
        }
        self.steps = steps
        let sync = PictureDemoSync(window: canvas?.window)
        self.sync = sync
        defer { sync.stop() }
        for (i, step) in steps.enumerated() {
            stepIndex = i
            sync.step = i
            player.set("running \(i + 1)/\(steps.count)")
            await perform(step)
        }
        result.endedAt = Date().timeIntervalSince1970
        watch.cancel()
        PictureDemoPlayer.autoPaused = false
        let since = result.startedAt - 2
        result.runs = PictureTutorLog.shared.runs.reversed().filter { $0.at.timeIntervalSince1970 >= since }.map {
            .init(mode: $0.mode.rawValue, source: $0.source, outcome: $0.outcome.rawValue, endMs: $0.endMs, costUsd: $0.costUsd, note: $0.note)
        }
        result.ink = controller?.store.records.values.filter { if case .stroke(let s) = $0 { s.author == .kid } else { false } }.count ?? 0
        save()
        return result
    }

    func perform(_ step: [String: Any]) async {
        if let strokes = step["write"] as? [[[Double]]] {
            var ink = strokes.map { $0.compactMap { $0.count >= 2 ? Vec2($0[0], $0[1]) : nil } }
            if step["answer"] as? Bool == true {
                if shift == nil { shift = clearOfPicture() }
                if let d = shift { ink = ink.map { $0.map { Vec2($0.x + d.x, $0.y + d.y) } } }
            }
            await write(ink, pauses: step["pauses"] as? [Double] ?? [], durs: step["durs"] as? [Double] ?? [])
        } else if let s = step["pause"] as? Double {
            try? await Task.sleep(for: .seconds(s))
        } else if let id = step["tap"] as? String {
            await tap(id)
        } else if let auto = step["auto"] as? Bool {
            PictureDemoPlayer.autoPaused = !auto
        } else if let what = step["waitFor"] as? String {
            await waitFor(what, timeout: step["timeout"] as? Double ?? 60)
        } else if let name = step["mark"] as? String {
            result.marks[name] = Date().timeIntervalSince1970
        }
    }

    // MARK: - the pen

    func write(_ strokes: [[Vec2]], pauses: [Double], durs: [Double]) async {
        guard let canvas, let controller, let tutor else { return }
        let rect = controller.currentScreen?.rect ?? .screen
        controller.tool = .pen
        // a pen, not a marker (the owner: kids' ink in the films reads too thick): 0.65 of the regular width
        let before = controller.penWidth
        controller.penWidth = InkStyle.PenSize.regular.width * 0.65
        defer { controller.penWidth = before }
        for (k, pts) in strokes.enumerated() where pts.count >= 2 {
            let pause = k < pauses.count ? pauses[k] : 120
            if pause > 0 { try? await Task.sleep(for: .milliseconds(Int(pause))) }
            let view = pts.map { canvas.camera.toView(ProblemPageLayout.place($0, on: rect)) }
            let pen = KidPen.profile(count: view.count, rng: &rng)
            let seconds = max(0.05, (k < durs.count ? durs[k] : 200) / 1_000)
            tutor.liveBoard.notePen(true)
            await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
                canvas.simulateStroke(view, duration: seconds, pressures: pen.pressures, times: pen.times) { done.resume() }
            }
            tutor.liveBoard.notePen(false)
        }
    }

    // MARK: - buttons and waits

    func tap(_ id: String) async {
        sync?.paused = true
        let answered = await player.await(id)
        sync?.paused = false
        if answered == true { return }
        result.notes.append("\(id): \(answered == nil ? "the UI test never answered" : "not on the board"); pressed by the player")
        switch id {
        case "picture.drawNow": picture?.drawNow()
        case "picture.accept": picture?.accept()
        case "picture.reject": picture?.reject()
        default: break
        }
    }

    func waitFor(_ what: String, timeout: Double) async {
        let end = Date().addingTimeInterval(timeout)
        let ticksBefore = ticks()
        while Date() < end {
            let shown = picture?.shown
            switch what {
            case "ghost": if shown?.state == .ghost { return }
            case "shown": if shown?.state == .shown || shown?.state == .ghost { return }
            case "idle": if picture?.phase == .idle && shown?.state != .revealing { return }
            case "tick": if ticks() > ticksBefore { result.ticks += 1; return }
            default: return
            }
            try? await Task.sleep(for: .milliseconds(150))
        }
        result.notes.append("waited \(Int(timeout)) s for \(what): never came")
    }

    /// The tutor's checkmarks on the page (`PictureTutorBoard.tick`'s strokes).
    func ticks() -> Int {
        guard let controller else { return 0 }
        return controller.store.drawables(on: controller.currentScreenID).filter { $0.author == .tutor }.count
    }

    /// Where the tutor's picture's ink is, on the page and on screen (for the kid's answer and the edit's zoom).
    var measured: String?

    func watch() {
        guard let s = picture?.shown, let canvas, let controller, measured != s.id || result.pictureView == nil else { return }
        guard let ink = Self.inkBounds(s.overlay) else { return }
        measured = s.id
        // the overlay covers R (page units): its ink's share of it
        let r = s.region
        let page = Box(x: r.x + ink.minX * r.w, y: r.y + ink.minY * r.h, w: ink.width * r.w, h: ink.height * r.h)
        let a = canvas.camera.toView(Vec2(page.x, page.y))
        let b = canvas.camera.toView(Vec2(page.maxX, page.maxY))
        let window = canvas.convert(CGRect(x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y), to: nil)
        result.pictureView = [window.minX, window.minY, window.width, window.height, Date().timeIntervalSince1970]
        let layout = ProblemPageLayout.unplace(page, from: controller.currentScreen?.rect ?? .screen)
        result.pictureLayout = [layout.x, layout.y, layout.w, layout.h]
    }

    /// The share of `image` (0…1 each way) its visible pixels take.
    static func inkBounds(_ image: CGImage) -> CGRect? {
        let w = image.width, h = image.height
        guard w > 0, h > 0 else { return nil }
        var data = [UInt8](repeating: 0, count: w * h * 4)
        guard let ctx = CGContext(data: &data, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        var x0 = w, y0 = h, x1 = -1, y1 = -1
        for y in stride(from: 0, to: h, by: 2) {
            for x in stride(from: 0, to: w, by: 2) where data[(y * w + x) * 4 + 3] > 40 {
                x0 = min(x0, x); x1 = max(x1, x); y0 = min(y0, y); y1 = max(y1, y)
            }
        }
        guard x1 >= x0, y1 >= y0 else { return nil }
        // a bitmap context's memory starts with the picture's top row
        return CGRect(x: Double(x0) / Double(w), y: Double(y0) / Double(h), width: Double(x1 - x0 + 2) / Double(w),
                      height: Double(y1 - y0 + 2) / Double(h))
    }

    /// Where the kid's answer goes: as written when it is clear of the picture, else the nearest place
    /// that is (lower in the left column, then right of the picture, then the page's right half).
    /// the kid's ink stays above the page's last fifth (there the board offers "Out of room? Start a new page")
    static let floor = 900 * 0.8 - 12

    func clearOfPicture() -> Vec2? {
        guard let p = result.pictureLayout else { return nil }
        let pic = Box(x: p[0] - 30, y: p[1] - 30, w: p[2] + 60, h: p[3] + 60)
        var pts: [Vec2] = []
        for step in steps[stepIndex...] where step["answer"] as? Bool == true {
            for s in step["write"] as? [[[Double]]] ?? [] { for q in s where q.count >= 2 { pts.append(Vec2(q[0], q[1])) } }
        }
        guard let ans = Box.around(pts) else { return nil }
        // the problem: everything written before the answer
        var above: [Vec2] = []
        for step in steps[..<stepIndex] {
            for s in step["write"] as? [[[Double]]] ?? [] { for q in s where q.count >= 2 { above.append(Vec2(q[0], q[1])) } }
        }
        let top = (Box.around(above)?.maxY ?? 100) + 50
        func clear(_ b: Box) -> Bool {
            b.x >= 20 && b.maxX <= 1580 && b.y >= top && b.maxY <= Self.floor && (b.maxX < pic.x || b.x > pic.maxX || b.maxY < pic.y || b.y > pic.maxY)
        }
        func moved(_ dx: Double, _ dy: Double) -> Box { Box(x: ans.x + dx, y: ans.y + dy, w: ans.w, h: ans.h) }
        var candidates: [Vec2] = [Vec2(0, 0)]
        // the left column, from just under the problem down
        for y in stride(from: top, through: Self.floor - ans.h, by: 20) { candidates.append(Vec2(0, y - ans.y)) }
        // right of the picture, then the right half, from the top of the free space down
        for x in [pic.maxX + 20, 860.0] {
            for y in stride(from: top, through: Self.floor - ans.h, by: 20) { candidates.append(Vec2(x - ans.x, y - ans.y)) }
        }
        for c in candidates where clear(moved(c.x, c.y)) {
            result.answerShift = [c.x, c.y]
            return c == Vec2(0, 0) ? nil : c
        }
        result.notes.append("no room for the answer clear of the picture")
        return nil
    }

    func save() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = docs.appendingPathComponent("picture-demos").appendingPathComponent(KidSessionPlayer.runLabel)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        try? enc.encode(result).write(to: dir.appendingPathComponent("\(result.id).json"))
        PictureDemoPlayer.log.notice("PICTUREDEMO \(self.result.id, privacy: .public) notes: \(self.result.notes.joined(separator: " | "), privacy: .public)")
    }
}
#endif
