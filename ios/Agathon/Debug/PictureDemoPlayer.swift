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
    /// the tutor's last picture: where it went, in view points (the screen recording's frame), and when
    var pictureView: [Double]?
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
        for (i, step) in steps.enumerated() {
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
            await write(strokes.map { $0.compactMap { $0.count >= 2 ? Vec2($0[0], $0[1]) : nil } },
                        pauses: step["pauses"] as? [Double] ?? [], durs: step["durs"] as? [Double] ?? [])
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
        let answered = await player.await(id)
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

    /// Where the tutor's picture is on screen (view points), for the edit's zoom.
    func watch() {
        guard let s = picture?.shown, let canvas else { return }
        let a = canvas.camera.toView(Vec2(s.region.x, s.region.y))
        let b = canvas.camera.toView(Vec2(s.region.maxX, s.region.maxY))
        let window = canvas.convert(CGRect(x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y), to: nil)
        result.pictureView = [window.minX, window.minY, window.width, window.height, Date().timeIntervalSince1970]
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
