#if DEBUG
import AgathonBoard
import AgathonBrain
import AgathonLive
import AgathonSAT
import Foundation
import os

/// Debug only: a student's handwriting on an SAT page, for the simulator (no Pencil), the UI tests and
/// the end-to-end run (`-satAutowrite "4x - 12 + 7 = 2x + 9|2x = 14|circle:0,4"`, one line a tap of
/// `sat.debug.write`). The lines are the training machinery's synthetic student hand
/// (`StudentHand`, the brain's own glyphs, the clean hand) put through the canvas's touch path, under
/// the student's last line in the stem's column; `circle:x,y` loops round that point of the
/// question's plane. Never in a Release build.
@MainActor
enum SATAutowriter {
    final class Progress {
        var next = 0
    }

    static let progress = Progress()
    static let log = Logger(subsystem: "app.agathon.Agathon", category: "satAutowrite")

    static func writeNext(_ model: SATSessionModel) async {
        let lines = SATDebugFlags.autowrite
        guard progress.next < lines.count else { return }
        let line = lines[progress.next]
        progress.next += 1
        await write(line, model: model)
    }

    static func write(_ line: String, model: SATSessionModel) async {
        guard let canvas = model.canvas, let controller = model.phase.session?.controller, let tutor = model.tutor else { return }
        let screen = controller.currentScreenID
        var strokes: [[Vec2]] = []
        if line.hasPrefix("circle:") {
            let n = line.dropFirst("circle:".count).split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
            guard n.count == 2, let plot = model.questionPlot(on: screen) else { return }
            let c = plot.page(n[0], n[1])
            strokes = [(0...28).map { k in
                let t = Double(k) / 26 * 2 * .pi
                return Vec2(c.x + 22 * cos(t), c.y + 18 * sin(t))
            }]
        } else {
            guard let ink = try? await StudentHand.ink(line, hand: .clean, brain: .shared), !ink.isEmpty else {
                log.error("no hand for \(line, privacy: .public)")
                return
            }
            // under the last line of the stem's column (the work area's top with none), at 0.85 × the
            // training hand (a grown-up's smaller writing)
            let layout = model.layoutHere
            let last = model.lastLine(on: screen)
            let x = SATPageStyle.standard.stemX
            let y = last.map { $0.y + $0.h + 52 } ?? ((layout?.workTop ?? 300) + 30)
            strokes = ink.map { $0.map { Vec2(x + $0.x * 0.85, y + $0.y * 0.85) } }
        }
        controller.tool = .pen
        tutor.liveBoard.notePen(true)
        for pts in strokes where pts.count >= 2 {
            let view = TrainingBoard.densify(pts).map { canvas.camera.toView($0) }
            let length = zip(pts, pts.dropFirst()).reduce(0) { $0 + $1.0.dist($1.1) }
            await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
                canvas.simulateStroke(view, duration: max(0.08, length / 650)) { done.resume() }
            }
            try? await Task.sleep(for: .milliseconds(60))
        }
        tutor.liveBoard.notePen(false)
        log.notice("wrote \(line, privacy: .public)")
    }
}
#endif
