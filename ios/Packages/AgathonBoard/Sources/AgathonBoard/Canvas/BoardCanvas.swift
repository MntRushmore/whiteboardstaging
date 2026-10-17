#if canImport(UIKit)
import SwiftUI

/// The board canvas for SwiftUI.
public struct BoardCanvas: UIViewRepresentable {
    public let controller: BoardController
    public var insets: CameraConstraints
    public var onCanvas: ((BoardCanvasView) -> Void)?

    public init(controller: BoardController, insets: CameraConstraints = CameraConstraints(), onCanvas: ((BoardCanvasView) -> Void)? = nil) {
        self.controller = controller
        self.insets = insets
        self.onCanvas = onCanvas
    }

    public func makeUIView(context: Context) -> BoardCanvasView {
        let view = BoardCanvasView(controller: controller)
        view.constraintsInsets = insets
        onCanvas?(view)
        return view
    }

    public func updateUIView(_ view: BoardCanvasView, context: Context) {
        if view.constraintsInsets != insets { view.constraintsInsets = insets }
    }
}
#endif
