import AgathonBoard
import AgathonKit
import SwiftUI

/// How Home opens a board: the one place that decides which screen a board opens in.
///
/// Home presents `makeView(board)` full screen and reads the boards again when it closes (the name
/// or the thumbnail may have changed). The screen closes itself with `@Environment(\.dismiss)`.
///
/// `current` is the real board (`BoardScreen`): the Blocks editor, saved by AgathonSync, the tutor
/// on it (AgathonLive) and Ask beside it (AgathonAsk). `readOnlyPreview` (the screens lane's
/// stand-in, `BoardPreviewScreen`: read, convert, show, never write) stays for previews and tests.
struct BoardOpening {
    let makeView: @MainActor (OpenBoard) -> AnyView

    init(makeView: @escaping @MainActor (OpenBoard) -> AnyView) {
        self.makeView = makeView
    }

    /// The board, saved, with the tutor and Ask.
    static let editor = BoardOpening { request in AnyView(BoardScreen(request: request)) }

    /// The stand-in: read, convert, show; edits stay on the iPad and are never saved.
    static let readOnlyPreview = BoardOpening { request in AnyView(BoardPreviewScreen(request: request)) }

    /// What the app uses.
    static let current: BoardOpening = .editor
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
    /// Who is at the board (a kid profile never sees money; the grade picks Ask's first chips). Nil:
    /// the screen reads it.
    var audience: BoardAudience?
    /// The document to start from when the row has none yet: the onboarding's first board, when its
    /// own save didn't reach the server.
    var seed: BoardDocument?

    var id: String { board.id }
}

/// Who is at the board.
struct BoardAudience: Equatable {
    /// A kid profile in a family: out of ink sends them to a grown-up, never to a price.
    var isKid: Bool
    /// 0 = K … 8; nil for high school or not known.
    var grade: Int?
}

/// Problems to work on this board: Today's practice or a topic's set (LaTeX lines from the brain's
/// practice generator, `PracticePlanner`). The tutor writes them on the board in its hand (Ask's
/// `write_problems`, the web's desk in the brain), each heading the column the kid works under it.
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
