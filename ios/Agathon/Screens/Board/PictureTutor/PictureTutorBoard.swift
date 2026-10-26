import AgathonBoard
import AgathonKit
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
            schedule: { TaskTimer.schedule($0, $1) },
            reduceMotion: { UIAccessibility.isReduceMotionEnabled })
    }

    /// The accepted picture on its page, exactly over R: a locked image the kid's tools leave alone,
    /// uploaded to the board's pictures first (the overlay stays on screen meanwhile; no placeholder
    /// box over the work, as a photo being added has). One kid step: Undo takes it off again.
    static func place(_ shown: PictureTutor.Shown, on controller: BoardController) async -> Bool {
        guard controller.store[shown.screen]?.screen != nil else { return false }
        // the traced strokes, when there are any: the tutor's own blue ink, sharp at any zoom, that the
        // kid's eraser and lasso work on (the owner, 2026-10-25: "traced over so it would be editable,
        // also make it blue"); the picture only when the trace came back empty
        let ink = inkStrokes(shown)
        if !ink.isEmpty {
            controller.store.transact(.kid) { tx in
                var order = controller.store.nextOrder(on: shown.screen)
                for var stroke in ink {
                    stroke.order = order
                    tx.put(.stroke(stroke))
                    order = OrderKey.after(order)
                }
            }
            return true
        }
        guard let assets = controller.assetStore else { return false }
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

    /// The picture's traced strokes as the tutor's ink on the page: overlay pixels mapped into R, the
    /// thickness with them, in the tutor's colour. A dot (one point) is drawn as a tiny dash.
    static func inkStrokes(_ shown: PictureTutor.Shown) -> [StrokeRecord] {
        let size = shown.pixelSize
        guard size.width > 0, size.height > 0 else { return [] }
        let scale = shown.region.w / Double(size.width)
        // still the picture tutor's (its id, its mode), but not locked: the kid can erase and move it
        var meta = PictureTutorCapture.meta(runId: shown.runId, mode: shown.mode)
        meta["locked"] = nil
        meta["protected"] = nil
        // the board's "solid" look: the centre line at exactly this width (the freehand pen would thin
        // and round a traced letter by its made-up speed)
        meta["dash"] = "solid"
        var out: [StrokeRecord] = []
        for s in shown.strokes {
            let p = s.points
            guard p.count >= 2 else { continue }
            var pts: [Vec2] = stride(from: 0, to: p.count - 1, by: 2).map {
                PictureTutorGeometry.pagePoint(CGPoint(x: p[$0], y: p[$0 + 1]), imageSize: size, region: shown.region)
            }
            guard let first = pts.first, pts.allSatisfy({ $0.x.isFinite && $0.y.isFinite }) else { continue }
            if pts.count == 1 { pts.append(Vec2(first.x + 0.1, first.y)) }
            pts = densified(pts, step: 1.5)
            let points = pts.map { InkPoint(x: Float($0.x - first.x), y: Float($0.y - first.y), pressure: 0.5, t: 0) }
            out.append(StrokeRecord(screen: shown.screen, order: OrderKey.first, author: .tutor, color: .tutor,
                                    width: max(1.5, s.width * scale), pressure: .simulated, x: first.x, y: first.y,
                                    points: points, meta: meta))
        }
        return out
    }

    /// Points every `step` page units along a polyline, its corners kept: the board's line smoothing
    /// trails each point by ~2 spacings, so a traced "4" from a few far-apart points lost its corners.
    static func densified(_ pts: [Vec2], step: Double) -> [Vec2] {
        guard pts.count > 1, step > 0 else { return pts }
        var out = [pts[0]]
        for i in 1..<pts.count {
            let a = pts[i - 1], b = pts[i]
            let d = hypot(b.x - a.x, b.y - a.y)
            let n = Int((d / step).rounded(.up))
            if n > 1 { for k in 1..<n { let t = Double(k) / Double(n); out.append(Vec2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) } }
            out.append(b)
        }
        return out
    }
}
