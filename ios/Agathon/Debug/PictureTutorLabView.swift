#if DEBUG
import AgathonBoard
import AgathonBoardUI
import AgathonDesign
import AgathonKit
import SwiftUI

/// Picture Tutor Lab: the picture tutor on a board of its own, on the stub server (no network, no
/// account, no paid call): the whole flow — the kid's lines written through the canvas, the pause,
/// the pen reading and scribbling, the reveal, the ghost, Accept / Reject — as an admin would see it.
/// Labs › Picture tutor, or `-lab picture`.
///
/// Launch arguments (all optional):
///   -pictureTutorLab.mode feedback|suggest|answer   the mode it starts in (default suggest)
///   -pictureTutorLab.lines "2x + 3 = 11|2x = 8"      the kid's lines (the clean hand from kid-hands.json)
///   -pictureTutor.stubOutcome done|none|error       what the stub answers
///   -pictureTutor.stubDelay 6                       seconds to the picture (drawing at half)
///   -pictureTutorLab.zoom 1.6                       zoom in first (the region R is then part of the page)
struct PictureTutorLabView: View {
    let close: () -> Void
    @StateObject private var lab = PictureTutorLab()

    var body: some View {
        BoardEditorView(
            controller: lab.controller, title: "Picture tutor lab", onBack: close,
            onCanvas: { lab.attach($0) },
            topTrailing: { PictureTutorTopItem(tutor: lab.tutor) },
            helpButton: { PictureTutorDrawNow(tutor: lab.tutor) },
            overlay: { viewport in PictureTutorOverlay(tutor: lab.tutor, viewport: viewport) })
            .onDisappear { lab.stop() }
    }
}

@MainActor
final class PictureTutorLab: ObservableObject {
    let controller = BoardController()
    let tutor: PictureTutor
    private var board: PictureTutorBoard?
    private var started = false

    init() {
        controller.assetStore = MemoryBoardAssetStore()
        controller.boardId = "picture-lab"
        let mode = UserDefaults.standard.string(forKey: "pictureTutorLab.mode").flatMap(PictureTutorMode.init(rawValue:)) ?? .suggest
        let box = CanvasBox()
        tutor = PictureTutor(mode: mode, boardId: nil, deps: PictureTutorBoard.deps(controller: controller, canvas: { box.canvas },
                                                                                    client: PictureTutorStub.client()))
        canvasBox = box
        board = PictureTutorBoard(controller: controller, tutor: tutor)
    }

    func stop() {
        board?.stop()
        board = nil
    }

    private var canvasBox: CanvasBox?

    final class CanvasBox {
        weak var canvas: BoardCanvasView?
    }

    func attach(_ canvas: BoardCanvasView) {
        canvasBox?.canvas = canvas
        guard !started else { return }
        started = true
        Task { @MainActor [weak self, weak canvas] in
            for _ in 0..<50 where (canvas?.bounds.width ?? 0) == 0 { try? await Task.sleep(for: .milliseconds(100)) }
            try? await Task.sleep(for: .milliseconds(600))
            guard let self, let canvas else { return }
            if let zoom = Double(UserDefaults.standard.string(forKey: "pictureTutorLab.zoom") ?? ""), zoom > 1 {
                canvas.setZoom(zoom, around: CGPoint(x: canvas.bounds.width * 0.35, y: canvas.bounds.height * 0.4))
                try? await Task.sleep(for: .milliseconds(300))
            }
            let script = UserDefaults.standard.string(forKey: "pictureTutorLab.lines") ?? "2x + 3 = 11|2x = 8"
            for line in script.split(separator: "|").map({ $0.trimmingCharacters(in: .whitespaces) }) {
                await self.write(line, on: canvas)
            }
        }
    }

    /// A line in a kid's hand through the canvas's own touch path, under the last one, at the left.
    private func write(_ latex: String, on canvas: BoardCanvasView) async {
        guard let strokes = BoardAutowriter.hand[latex] else {
            PictureTutorLog.os.error("picture lab: no ink for \(latex, privacy: .public)")
            return
        }
        let screen = controller.currentScreenID
        let rect = controller.currentScreen?.rect ?? .screen
        let bottom = controller.store.drawables(on: screen).compactMap { r -> Double? in
            guard case .stroke(let s) = r, s.author == .kid else { return nil }
            return s.points.map { s.pagePoint($0).y }.max()
        }.max()
        let scale = 1.6
        let x = rect.x + 140, y = bottom.map { $0 + 60 } ?? rect.y + 150
        controller.tool = .pen
        for flat in strokes {
            let pts = stride(from: 0, to: flat.count - 1, by: 2).map { i in Vec2(x + flat[i] * scale, y + flat[i + 1] * scale) }
            let view = Self.densify(pts).map { canvas.camera.toView($0) }
            let length = zip(pts, pts.dropFirst()).reduce(0) { $0 + $1.0.dist($1.1) }
            await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
                canvas.simulateStroke(view, duration: max(0.08, length / 650)) { done.resume() }
            }
            try? await Task.sleep(for: .milliseconds(60))
        }
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

/// The admin page on its own (`-lab pictureSettings`): its screenshot without an admin account.
struct PictureTutorSettingsLab: View {
    var body: some View {
        ZStack {
            DS.Color.ground.ignoresSafeArea()
            PictureTutorPage()
        }
    }
}
#endif
