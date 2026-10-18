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
///     static let current = BoardOpening { request in AnyView(BoardEditorView(board: request.board)) }
///
/// A request can carry a practice set (Today's practice, a topic): the problems the tutor should put
/// on the board. The stand-in lists them over the board; the real editor writes them on it.
struct BoardOpening {
    let makeView: @MainActor (OpenBoard) -> AnyView

    init(makeView: @escaping @MainActor (OpenBoard) -> AnyView) {
        self.makeView = makeView
    }

    /// Phase 4's stand-in: read, convert, show; edits stay on the iPad and are never saved.
    static let readOnlyPreview = BoardOpening { request in AnyView(BoardPreviewScreen(request: request)) }

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

/// A board to open, and what it is for.
struct OpenBoard: Identifiable {
    let board: BoardSummary
    var practice: PracticeSet?

    var id: String { board.id }
}

/// Problems to work on this board: Today's practice or a topic's set (LaTeX lines from the brain's
/// practice generator, `PracticePlanner`).
struct PracticeSet: Equatable {
    enum Kind: Equatable {
        /// Today's practice for a local day (YYYY-MM-DD).
        case daily(day: String)
        /// A topic's problems.
        case topic(skill: String)
    }

    let kind: Kind
    let title: String
    let problems: [PracticePlanner.Problem]
}
