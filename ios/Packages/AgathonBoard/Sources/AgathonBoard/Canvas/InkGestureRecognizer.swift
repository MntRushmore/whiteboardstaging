#if canImport(UIKit)
import UIKit
import UIKit.UIGestureRecognizerSubclass

/// Tracks the one touch that is drawing (a Pencil, or a finger when fingers draw) and hands its
/// samples over as they come: coalesced touches (a Pencil reports at 240 Hz) and predicted ones.
/// It recognizes on touch-down, so the first point is drawn at once, and recognizes alongside the
/// pan and pinch, which the canvas keeps apart itself (palm rejection, a second finger).
final class InkGestureRecognizer: UIGestureRecognizer {
    var onBegan: ((UITouch, UIEvent) -> Void)?
    var onMoved: ((UITouch, UIEvent) -> Void)?
    var onEnded: ((UITouch, UIEvent) -> Void)?
    /// the stroke was cancelled (the system took the touch, or a second finger came: a pinch)
    var onCancelled: (() -> Void)?

    private(set) weak var tracked: UITouch?

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        if let tracked {
            // a second finger while a finger draws: the kid is pinching or panning, not drawing
            if tracked.type == .direct && touches.contains(where: { $0.type == .direct }) {
                onCancelled?()
                self.tracked = nil
                state = .cancelled
                return
            }
            for t in touches where t !== tracked { ignore(t, for: event) }
            return
        }
        // two fingers landing together are a gesture, not a stroke
        if touches.count > 1 && touches.allSatisfy({ $0.type == .direct }) {
            state = .failed
            return
        }
        let touch = touches.first(where: { $0.type == .pencil }) ?? touches.first!
        for t in touches where t !== touch { ignore(t, for: event) }
        tracked = touch
        onBegan?(touch, event)
        state = .began
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        guard let tracked, touches.contains(tracked) else { return }
        onMoved?(tracked, event)
        state = .changed
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        guard let tracked, touches.contains(tracked) else { return }
        onEnded?(tracked, event)
        self.tracked = nil
        state = .ended
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        guard let tracked, touches.contains(tracked) else { return }
        onCancelled?()
        self.tracked = nil
        state = .cancelled
    }

    override func reset() {
        tracked = nil
        super.reset()
    }

    var isTrackingPencil: Bool { tracked?.type == .pencil }
    var isTracking: Bool { tracked != nil }
}
#endif
