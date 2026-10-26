import AgathonAsk
import AgathonBoard
import AgathonBrain
import AgathonKit
import AgathonLive
import Combine
import CoreGraphics
import Foundation
import UIKit

/// The picture tutor on a real board: the kid's changes (strokes, erases, undo, moves) restart its
/// quiet, the pen holds it, a page change drops its picture, an accepted picture goes on the board as
/// a locked image (saved and synced like any picture). The tutor's own pictures never count as the
/// kid's work.
@MainActor
final class PictureTutorBoard {
    let controller: BoardController
    let tutor: PictureTutor
    private var subscription: StoreSubscription?
    private var watches: Set<AnyCancellable> = []

    /// The board's pen signal (the kid's pen or finger down and up) goes to `tutor.notePen`: the caller
    /// wires it (on the app's board, `CanvasLiveBoard.onPen`, free while the Live loop is not started).
    init(controller: BoardController, tutor: PictureTutor) {
        self.controller = controller
        self.tutor = tutor
        subscription = controller.store.observe { [weak self] change in
            guard let self, Self.isKidEdit(change, screen: self.controller.currentScreenID) else { return }
            self.tutor.noteEdit()
        }
        controller.$currentScreenID.dropFirst().removeDuplicates()
            .sink { [weak tutor] _ in tutor?.screenChanged() }
            .store(in: &watches)
    }

    func stop() {
        subscription?.cancel()
        subscription = nil
        watches.removeAll()
        tutor.stop()
    }

    /// A change the kid made to the page on show (their strokes, erasing, undo or redo, moving
    /// things), not the picture tutor's own pictures going on or off.
    static func isKidEdit(_ change: ChangeSet, screen: RecordID) -> Bool {
        guard change.origin == .kid || change.origin == .history else { return false }
        for id in change.ids {
            guard let r = change.after(id) ?? change.before(id) else { continue }
            if PictureTutorCapture.isPictureTutor(r) { continue }
            if r.screenID == screen || r.screenID == nil { return true }
        }
        return false
    }

    // MARK: - deps

    /// The tutor's dependencies on this board, with `client` (the server, or the stub).
    /// `canvas`: the board's canvas, whose insets (the top bar, the dock) are not part of what's visible.
    static func deps(controller: BoardController, canvas: @escaping () -> BoardCanvasView?, client: BoardDrawClient) -> PictureTutor.Deps {
        PictureTutor.Deps(
            capture: { [weak controller] in
                guard let controller else { return nil }
                return await PictureTutorCapture.capture(controller: controller, insets: canvas()?.constraintsInsets)
            },
            draw: { client.draw($0) },
            report: { runId, outcome in
                do {
                    try await client.report(runId: runId, outcome: outcome)
                } catch {
                    PictureTutorLog.os.notice("picture tutor: outcome \(outcome.rawValue) not reported: \(String(describing: error), privacy: .public)")
                }
            },
            accept: { [weak controller] shown in
                guard let controller else { return false }
                return await place(shown, on: controller)
            },
            tick: { [weak controller] screen, region in
                guard let controller else { return }
                tick(on: controller, screen: screen, region: region)
            },
            write: { [weak controller] screen, region, latex in
                guard let controller, let canvas = canvas() else { return }
                Task { await writeAnswer(latex, on: controller, canvas: canvas, screen: screen, region: region) }
            },
            schedule: { TaskTimer.schedule($0, $1) },
            reduceMotion: { UIAccessibility.isReduceMotionEnabled })
    }

    /// The accepted picture on its page, exactly over R: a locked image the kid's tools leave alone,
    /// uploaded to the board's pictures first (the overlay stays on screen meanwhile; no placeholder
    /// box over the work, as a photo being added has). One kid step: Undo takes it off again.
    static func place(_ shown: PictureTutor.Shown, on controller: BoardController) async -> Bool {
        guard controller.store[shown.screen]?.screen != nil, let assets = controller.assetStore else { return false }
        let url: URL
        do {
            url = try await assets.upload(shown.png, mimeType: "image/png", boardId: controller.boardId,
                                          width: shown.overlay.width, height: shown.overlay.height, source: "picture-tutor")
        } catch {
            PictureTutorLog.os.error("picture tutor: upload failed: \(String(describing: error), privacy: .public)")
            return false
        }
        controller.images.put(shown.overlay, for: url.absoluteString)
        guard controller.store[shown.screen]?.screen != nil else { return false }
        let r = shown.region
        let record = ImageRecord(screen: shown.screen, order: controller.store.nextOrder(on: shown.screen), author: .tutor,
                                 x: r.x, y: r.y, w: r.w, h: r.h,
                                 asset: AssetRef(src: url.absoluteString, mime: "image/png", w: Double(shown.overlay.width), h: Double(shown.overlay.height)),
                                 meta: PictureTutorCapture.meta(runId: shown.runId, mode: shown.mode))
        controller.store.put(.image(record), origin: .kid)
        return true
    }

    /// The tutor's checkmark for right work, just right of the kid's latest line in R (the strokes
    /// level with the one written last), sized to it, in the tutor's blue. Not twice in one place.
    static func tick(on controller: BoardController, screen: RecordID, region: Box) {
        guard controller.currentScreenID == screen, let box = latestLine(on: controller, screen: screen, region: region) else { return }
        let h = min(60, max(24, box.h * 0.8)), w = h * 1.1
        let origin = Vec2(box.x + box.w + 24, box.y + box.h / 2 - h / 2)
        // a checkmark already beside this line (an earlier run): leave it
        let spot = Box(x: origin.x - w, y: origin.y - h, w: w * 3, h: h * 3)
        let ticked = controller.store.drawables(on: screen).contains {
            guard case .stroke(let s) = $0, s.meta["tick"]?.boolValue == true, let b = bounds(s) else { return false }
            return b.intersects(spot)
        }
        guard !ticked else { return }
        let shape = densified([Vec2(0, h * 0.55), Vec2(w * 0.38, h), Vec2(w, 0)], step: 1.5)
        var meta = PictureTutorCapture.meta(runId: nil, mode: .feedback)
        meta["tick"] = true
        let stroke = StrokeRecord(screen: screen, order: controller.store.nextOrder(on: screen), author: .tutor, color: .tutor,
                                  width: max(4, h / 9), pressure: .simulated, x: origin.x, y: origin.y,
                                  points: shape.map { InkPoint(x: Float($0.x), y: Float($0.y), pressure: 0.5, t: 0) }, meta: meta)
        controller.store.put(.stroke(stroke), origin: .tutor)
    }

    /// The box of the kid's latest line in R: the strokes level with the one written last.
    static func latestLine(on controller: BoardController, screen: RecordID, region: Box) -> Box? {
        let kid: [(stroke: StrokeRecord, box: Box)] = controller.store.drawables(on: screen).compactMap {
            guard case .stroke(let s) = $0, s.author == .kid, let box = bounds(s), box.intersects(region) else { return nil }
            return (s, box)
        }
        guard let last = kid.max(by: { ($0.stroke.start ?? 0, $0.box.y) < ($1.stroke.start ?? 0, $1.box.y) }) else { return nil }
        let line = kid.map(\.box).filter { $0.y < last.box.y + last.box.h && last.box.y < $0.y + $0.h }
        guard var box = line.first else { return nil }
        for b in line.dropFirst() { box = box.union(b) }
        return box
    }

    /// Solve's answer to plain arithmetic in the tutor's own hand, as the Live tutor writes one after a
    /// kid's "=": at the line's height, on its baseline, a gap after it, the pen drawing it in.
    static func writeAnswer(_ latex: String, on controller: BoardController, canvas: BoardCanvasView, screen: RecordID, region: Box) async {
        guard controller.currentScreenID == screen, let box = latestLine(on: controller, screen: screen, region: region) else { return }
        let request = HandwritingRequest(steps: [latex], lineHeight: box.h, inline: true, seedKey: "picture:\(latex)",
                                         baseline: HandwritingRequest.Baseline(x: box.x + box.w + LivePlacement.inlineAnswerGap(box.h), baselineY: box.y + box.h))
        guard let result = try? await Brain.shared.layoutHandwriting(request), result.unsupported.isEmpty, let plan = result.plan,
              controller.currentScreenID == screen else { return }
        var meta = PictureTutorCapture.meta(runId: nil, mode: .answer)
        meta["answer"] = .string(latex)
        // the pen is held until its writing is on the page (a pen let go stops writing)
        var held: TutorPen?
        held = CanvasLiveBoard(controller: controller, canvas: canvas).write(AskBoardDriver.tutorLines(plan), meta: meta) {
            if let pen = held { writing.removeAll { $0 === pen } }
            held = nil
        }
        if let pen = held, pen.isWriting { writing.append(pen) }
    }

    /// The tutor's pens still writing an answer.
    private static var writing: [TutorPen] = []

    /// A stroke's box on the page (unrotated: the kid's ink is never rotated).
    static func bounds(_ s: StrokeRecord) -> Box? {
        guard let first = s.points.first else { return nil }
        var x0 = first.x, x1 = first.x, y0 = first.y, y1 = first.y
        for p in s.points {
            x0 = min(x0, p.x); x1 = max(x1, p.x); y0 = min(y0, p.y); y1 = max(y1, p.y)
        }
        return Box(x: s.x + Double(x0), y: s.y + Double(y0), w: Double(x1 - x0), h: Double(y1 - y0))
    }

    /// Points every `step` page units along a polyline, its corners kept (the board smooths a line
    /// by trailing each point, which rounds a corner made of far-apart points).
    static func densified(_ pts: [Vec2], step: Double) -> [Vec2] {
        guard pts.count > 1, step > 0 else { return pts }
        var out = [pts[0]]
        for i in 1..<pts.count {
            let a = pts[i - 1], b = pts[i]
            let n = Int((hypot(b.x - a.x, b.y - a.y) / step).rounded(.up))
            if n > 1 { for k in 1..<n { let t = Double(k) / Double(n); out.append(Vec2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) } }
            out.append(b)
        }
        return out
    }
}
