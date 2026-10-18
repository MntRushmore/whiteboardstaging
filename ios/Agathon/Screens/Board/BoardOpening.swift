import AgathonKit
import SwiftUI

/// How Home opens a board: the one place that decides which screen a board opens in.
///
/// Home presents `makeView(board)` full screen and reads the boards again when it closes (the name
/// or the thumbnail may have changed). The screen closes itself with `@Environment(\.dismiss)`.
///
/// Today it is `.readOnlyPreview` (this lane's stand-in, `BoardPreviewScreen`): the row's tldraw
/// snapshot is read, converted with `TldrawImporter` and shown in `BoardCanvas`. Nothing is ever
/// written back. When the TOOLS lane's `BoardEditorView` and the SYNC lane's `AgathonSync` land,
/// the lead swaps `current` for them, here and nowhere else:
///
///     static let current = BoardOpening { board in AnyView(BoardEditorView(board: board)) }
struct BoardOpening {
    let makeView: @MainActor (BoardSummary) -> AnyView

    init(makeView: @escaping @MainActor (BoardSummary) -> AnyView) {
        self.makeView = makeView
    }

    /// Phase 4's stand-in: read, convert, show; edits stay on the iPad and are never saved.
    static let readOnlyPreview = BoardOpening { board in AnyView(BoardPreviewScreen(board: board)) }

    /// What the app uses.
    static let current: BoardOpening = .readOnlyPreview
}

private struct BoardOpeningKey: EnvironmentKey {
    static let defaultValue: BoardOpening = .current
}

extension EnvironmentValues {
    /// How boards open (`BoardOpening.current` unless a preview or a test sets another).
    var boardOpening: BoardOpening {
        get { self[BoardOpeningKey.self] }
        set { self[BoardOpeningKey.self] = newValue }
    }
}
