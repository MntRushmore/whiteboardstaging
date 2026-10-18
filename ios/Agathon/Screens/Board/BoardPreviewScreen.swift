import AgathonBoard
import AgathonDesign
import AgathonKit
import SwiftUI

/// A board, full screen: the stand-in until the TOOLS lane's editor and the SYNC lane's saving
/// land (see `BoardOpening`). Reads the row's tldraw snapshot (`BoardsRepository.snapshot`),
/// converts it (`TldrawImporter`) off the main thread and shows it in `BoardCanvas` with a small
/// Blocks chrome: back, the title, the screens, pen, eraser, undo and redo, the kid's pens.
///
/// **Never writes the board.** Production has no column for the Agathon document yet, and its
/// `data` belongs to the web. What the kid writes here stays on the iPad until the board closes;
/// the banner says so, and leaving with new ink asks first.
struct BoardPreviewScreen: View {
    let board: BoardSummary

    @Environment(AgathonBackend.self) private var backend
    @Environment(\.dismiss) private var dismiss
    @State private var model = BoardPreviewModel()

    var body: some View {
        ZStack {
            DS.Color.ground.ignoresSafeArea()
            switch model.phase {
            case .loading:
                BoardLoadingView()
            case .failed(let failure):
                failed(failure)
            case .ready(let controller):
                BoardPreviewCanvas(board: board, controller: controller, report: model.report, close: close)
            }
            if !model.phase.isReady {
                VStack {
                    HStack(spacing: DS.Space.s) {
                        RoundButton(.back, label: "Back to my boards", action: close)
                            .accessibilityIdentifier("board.back")
                        BoardTitle(title: board.title, subtitle: nil)
                        Spacer()
                    }
                    Spacer()
                }
                .padding(.horizontal, DS.Space.l)
                .padding(.top, DS.Space.s)
            }
        }
        .task { await model.open(board, backend: backend) }
    }

    private func failed(_ failure: BoardPreviewModel.Failure) -> some View {
        EmptyState(.icon(failure.icon, .sunny), title: failure.title, message: failure.message,
                   actionTitle: failure.retry ? "Try again" : "Back to my boards", actionIcon: failure.retry ? .retry : .back) {
            if failure.retry {
                Task { await model.open(board, backend: backend) }
            } else {
                dismiss()
            }
        }
        .accessibilityIdentifier("board.error")
    }

    private func close() {
        dismiss()
    }
}

/// The board's name and which screen this is, in the top bar.
struct BoardTitle: View {
    let title: String
    let subtitle: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .dsFont(.headline)
                .foregroundStyle(DS.Color.ink)
                .lineLimit(1)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("board.title")
            if let subtitle {
                Text(subtitle)
                    .dsFont(.caption)
                    .foregroundStyle(DS.Color.inkSecondary)
                    .lineLimit(1)
                    .accessibilityIdentifier("board.screen")
            }
        }
    }
}

/// While a board opens: the mark assembles, then a word if it takes a while.
struct BoardLoadingView: View {
    @State private var slow = false

    var body: some View {
        VStack(spacing: DS.Space.xl) {
            AgathonMark(.color, assembles: true)
                .frame(width: 120, height: 120)
            Text("Opening your board…")
                .dsFont(.callout)
                .foregroundStyle(DS.Color.inkSecondary)
                .opacity(slow ? 1 : 0)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Opening your board")
        .accessibilityIdentifier("board.loading")
        .task {
            try? await Task.sleep(for: .seconds(1.2))
            withAnimation(DS.Motion.fade) { slow = true }
        }
    }
}

// MARK: - The model

@MainActor
@Observable
final class BoardPreviewModel {
    enum Phase {
        case loading
        case failed(Failure)
        case ready(BoardController)

        var isReady: Bool {
            if case .ready = self { return true }
            return false
        }
    }

    struct Failure: Equatable {
        let icon: DS.Icon
        let title: String
        let message: String
        let retry: Bool
    }

    private(set) var phase: Phase = .loading
    /// What the converter brought over and what it left out.
    private(set) var report: TldrawImporter.Report?

    func open(_ board: BoardSummary, backend: AgathonBackend) async {
        phase = .loading
        let data: Data
        do {
            data = try await backend.boards.snapshot(id: board.id)
        } catch {
            if error is CancellationError { return }
            phase = .failed(Self.failure(forLoad: error))
            await backend.errors.reportUserError(kind: "live.boards", code: "open_failed", message: "Couldn't open a board on the iPad",
                                                 path: "/board", boardId: board.id, error: error)
            return
        }
        do {
            let converted = try await Task.detached(priority: .userInitiated) { try Self.convert(data) }.value
            report = converted.report
            let controller = BoardController()
            controller.load(converted.document, screen: converted.currentScreen)
            phase = .ready(controller)
        } catch {
            phase = .failed(Failure(
                icon: .lookAgain, title: "This board can't open here yet.",
                message: "Something on it is new to the iPad app. Try again, or open it on agathon.app for now.", retry: true))
            await backend.errors.reportUserError(kind: "live.boards", code: "convert_failed",
                                                 message: "Couldn't convert a board: \(error)", path: "/board", boardId: board.id)
        }
    }

    struct Converted: Sendable {
        var document: BoardDocument
        var currentScreen: RecordID?
        var report: TldrawImporter.Report?
    }

    /// The stored document as an Agathon board. A board nobody has drawn on (`{}`, `null`, a
    /// snapshot without pages) opens blank.
    nonisolated static func convert(_ data: Data) throws -> Converted {
        let root = try AgathonBoard.JSONValue.parse(data)
        if case .null = root { return Converted(document: .blank()) }
        if let object = root.objectValue, object.isEmpty { return Converted(document: .blank()) }
        do {
            let result = try TldrawImporter.importSnapshot(root)
            return Converted(document: result.document, currentScreen: result.currentScreen, report: result.report)
        } catch TldrawImporter.ImportError.noPages {
            return Converted(document: .blank())
        }
    }

    nonisolated static func failure(forLoad error: Error) -> Failure {
        if error as? BoardsRepository.BoardError == .notFound {
            return Failure(icon: .lookAgain, title: "This board isn't here anymore.",
                           message: "It may have been deleted on another device.", retry: false)
        }
        return Failure(icon: .offline, title: "This board didn't open.",
                       message: "Check the Wi-Fi, then try again.", retry: true)
    }
}

// MARK: - The board on screen

/// The kid's pens the board can store today: Blocks' pens (DS.KidPen) that the engine's kid palette
/// also has. Orange and pink join when the TOOLS lane widens the engine's palette.
enum BoardPreviewCanvasPens {
    static let all: [(pen: DS.KidPen, ink: InkColor)] = [(.black, .black), (.red, .red), (.green, .green)]
}

private struct BoardPreviewCanvas: View {
    let board: BoardSummary
    @ObservedObject var controller: BoardController
    let report: TldrawImporter.Report?
    let close: () -> Void

    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var confirmLeave = false

    var body: some View {
        GeometryReader { geo in
            let margin = ScreenMargin.horizontal(sizeClass)
            let top = geo.safeAreaInsets.top + DS.Space.s + DS.Size.round + DS.Space.m
            let bottom = geo.safeAreaInsets.bottom + DS.Space.s + DS.Size.dock + DS.Space.m
            ZStack {
                BoardCanvas(controller: controller,
                            insets: CameraConstraints(top: top, left: margin, bottom: bottom, right: margin)) { canvas in
                    canvas.backgroundColor = DS.ColorTokens.ground.uiColor
                }
                .ignoresSafeArea()
                .accessibilityLabel("Board, screen \(controller.screenIndex) of \(controller.screenCount)")
                .accessibilityIdentifier("board.canvas")

                VStack(spacing: 0) {
                    topBar
                    Spacer(minLength: 0)
                    dockRow
                }
                .padding(.horizontal, margin)
                .padding(.top, DS.Space.s)
                .padding(.bottom, DS.Space.s)
            }
        }
        .sheet(isPresented: $confirmLeave) {
            LeaveBoardSheet(keep: { confirmLeave = false }, leave: {
                confirmLeave = false
                close()
            })
        }
    }

    // MARK: top bar

    private var topBar: some View {
        HStack(spacing: DS.Space.s) {
            RoundButton(.back, label: "Back to my boards") {
                if controller.canUndo { confirmLeave = true } else { close() }
            }
            .accessibilityIdentifier("board.back")
            BoardTitle(title: board.title, subtitle: subtitle)
            Spacer(minLength: DS.Space.s)
            ViewThatFits(in: .horizontal) {
                Banner(.notSaved, "Not saved yet", message: "Saving comes soon.").fixedSize()
                Banner(.notSaved, "Not saved yet").fixedSize()
                IconCircle(.notSaved, fill: .chalk, diameter: 44).accessibilityLabel("Not saved yet. Saving comes soon.")
            }
            .accessibilityIdentifier("board.notSaved")
        }
    }

    private var subtitle: String {
        var line = "Screen \(controller.screenIndex) of \(controller.screenCount)"
        if let skipped = report?.skipped.values.reduce(0, +), skipped > 0 {
            line += " · Some notes don't show here yet"
        }
        return line
    }

    // MARK: the dock

    private var dockRow: some View {
        ViewThatFits(in: .horizontal) {
            fullDock
            shortDock
        }
        .frame(maxWidth: .infinity)
    }

    private var fullDock: some View {
        Dock {
            tools
            DockSeparator()
            history
            DockSeparator()
            ForEach(BoardPreviewCanvasPens.all, id: \.pen.id) { entry in
                PenSwatch(entry.pen, isOn: controller.tool == .pen && controller.color == entry.ink, context: .dock) {
                    controller.color = entry.ink
                    controller.tool = .pen
                }
            }
            if controller.screenCount > 1 {
                DockSeparator()
                pager
            }
        }
        .fixedSize()
    }

    /// A narrow window (Split View): the pens step aside.
    private var shortDock: some View {
        Dock {
            tools
            DockSeparator()
            history
            if controller.screenCount > 1 {
                DockSeparator()
                pager
            }
        }
        .fixedSize()
    }

    @ViewBuilder private var tools: some View {
        ToolButton(.pen, isOn: controller.tool == .pen, context: .dock) { controller.tool = .pen }
            .accessibilityIdentifier("board.pen")
        ToolButton(.eraser, isOn: controller.tool == .eraser, context: .dock) { controller.tool = .eraser }
            .accessibilityIdentifier("board.eraser")
    }

    @ViewBuilder private var history: some View {
        ToolButton(.undo, context: .dock) { controller.undo() }
            .disabled(!controller.canUndo)
            .accessibilityIdentifier("board.undo")
        ToolButton(.redo, context: .dock) { controller.redo() }
            .disabled(!controller.canRedo)
            .accessibilityIdentifier("board.redo")
    }

    @ViewBuilder private var pager: some View {
        ToolButton(.back, context: .dock) { controller.previousScreen() }
            .disabled(controller.screenIndex <= 1)
            .accessibilityLabel("Previous screen")
        Text("\(controller.screenIndex)/\(controller.screenCount)")
            .font(DS.Font.fixed(.numeral, size: 18))
            .foregroundStyle(DS.Color.onInk)
            .frame(minWidth: 44)
            .accessibilityLabel("Screen \(controller.screenIndex) of \(controller.screenCount)")
        ToolButton(.forward, context: .dock) { controller.nextScreen() }
            .disabled(controller.screenIndex >= controller.screenCount)
            .accessibilityLabel("Next screen")
    }
}

/// Leaving a board with new ink on it: it isn't saved yet, so ask first.
private struct LeaveBoardSheet: View {
    let keep: () -> Void
    let leave: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.l) {
            SheetHeader("Leave this board?", onClose: keep)
            Text("What you wrote here isn't saved yet. Saving comes soon.")
                .dsFont(.body)
                .foregroundStyle(DS.Color.ink)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: DS.Space.s) {
                Button(action: keep) { Text("Keep writing").frame(maxWidth: .infinity) }
                    .buttonStyle(.pill(.primary, size: .large))
                    .accessibilityIdentifier("board.keepWriting")
                Button(action: leave) { Text("Leave").frame(maxWidth: .infinity) }
                    .buttonStyle(.pill(.secondaryOnPaper, size: .large))
                    .accessibilityIdentifier("board.leave")
            }
        }
        .blocksSheet()
    }
}
