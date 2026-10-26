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
}
