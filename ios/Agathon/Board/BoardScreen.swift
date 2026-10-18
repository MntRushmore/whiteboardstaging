import AgathonBoard
import AgathonKit
import AgathonSync
import SwiftUI
import UIKit

/// One board, opened from the boards list: read through AgathonSync (the iPad's document, or the
/// web's board converted on this open), drawn on the AgathonBoard canvas, saved as the kid works.
///
/// Plain controls only (pen, eraser, colours, undo, screens) and the save indicator: the board lane
/// is building the real editor (BoardEditorView), which the lead swaps in here.
struct BoardScreen: View {
    let board: BoardSummary

    @Environment(AgathonBackend.self) private var backend
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model = BoardScreenModel()

    var body: some View {
        Group {
            if let session = model.session {
                BoardSessionView(session: session, model: model)
            } else if let failure = model.failure {
                ContentUnavailableView("Couldn't open this board", systemImage: "exclamationmark.triangle", description: Text(failure))
            } else {
                ProgressView("Opening…")
            }
        }
        .navigationTitle(board.title)
        .navigationBarTitleDisplayMode(.inline)
        // No system back button: on iPadOS a swipe anywhere on the content goes back, and a stroke
        // drawn left to right would close the board. Back is this button only.
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    dismiss()
                } label: {
                    Label("Boards", systemImage: "chevron.left").labelStyle(.titleAndIcon)
                }
                .accessibilityIdentifier("board.back")
            }
        }
        .task { await model.open(board.id, backend: backend) }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { model.leavingScreen() }
        }
        .onDisappear { model.close() }
    }
}

@MainActor
final class BoardScreenModel: ObservableObject {
    @Published private(set) var session: BoardSession?
    @Published private(set) var failure: String?
    private var opened = false

    func open(_ boardId: String, backend: AgathonBackend) async {
        guard !opened else { return }
        opened = true
        guard let session = BoardSession.make(boardId: boardId, backend: backend) else {
            failure = "Sign in again to open this board."
            return
        }
        self.session = session
        await session.open()
    }

    /// The app is going to the background: back up and save now, with the time iPadOS gives for it.
    func leavingScreen() {
        guard let session else { return }
        let app = UIApplication.shared
        var task: UIBackgroundTaskIdentifier = .invalid
        task = app.beginBackgroundTask(withName: "agathon.board.save") {
            app.endBackgroundTask(task)
            task = .invalid
        }
        Task { @MainActor in
            await session.appWillResignActive()
            if task != .invalid { app.endBackgroundTask(task) }
        }
    }

    func close() {
        guard let session else { return }
        Task { @MainActor in await session.close() }
    }
}

/// The open board: canvas, plain tools, save state.
private struct BoardSessionView: View {
    @ObservedObject var session: BoardSession
    @ObservedObject var model: BoardScreenModel

    var body: some View {
        switch session.phase {
        case .loading:
            ProgressView("Opening…")
        case .failed(let why):
            ContentUnavailableView("Couldn't open this board", systemImage: "exclamationmark.triangle", description: Text(why))
                .accessibilityIdentifier("board.failed")
        case .ready:
            BoardEditing(session: session, controller: session.controller)
        }
    }
}

private struct BoardEditing: View {
    @ObservedObject var session: BoardSession
    @ObservedObject var controller: BoardController

    var body: some View {
        ZStack(alignment: .top) {
            BoardCanvas(controller: controller, insets: CameraConstraints(top: 76, left: 16, bottom: 16, right: 16)) { canvas in
                canvas.accessibilityIdentifier = "board.canvas"
                canvas.isAccessibilityElement = true
                canvas.accessibilityLabel = "Board"
                // a save is built between strokes: the canvas's gestures say when a pen or finger is down
                session.isPenDown = { [weak canvas] in
                    canvas?.gestureRecognizers?.contains { $0.state == .began || $0.state == .changed } ?? false
                }
            }
            .ignoresSafeArea(edges: .bottom)
            VStack(spacing: 8) {
                tools
                if let notice = session.notice {
                    Text(notice)
                        .font(.callout)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Color(white: 0.96), in: Capsule())
                        .accessibilityIdentifier("board.notice")
                }
            }
            .padding(10)
        }
    }

    private var tools: some View {
        HStack(spacing: 10) {
            Picker("Tool", selection: $controller.tool) {
                Text("Pen").tag(BoardTool.pen)
                Text("Eraser").tag(BoardTool.eraser)
            }
            .pickerStyle(.segmented)
            .frame(width: 150)
            ForEach(InkColor.kidPalette, id: \.self) { c in
                Button {
                    controller.color = c
                    controller.tool = .pen
                } label: {
                    Circle()
                        .fill(Color(cgColor: RenderGeometry.cgColor(c)))
                        .frame(width: 26, height: 26)
                        .overlay(Circle().stroke(Color.primary, lineWidth: controller.color == c ? 3 : 0).padding(-4))
                }
                .accessibilityLabel(c.rawValue)
            }
            Divider().frame(height: 24)
            Button("Undo") { controller.undo() }.disabled(!controller.canUndo)
            Button("Redo") { controller.redo() }.disabled(!controller.canRedo)
            Divider().frame(height: 24)
            Button("‹") { controller.previousScreen() }.disabled(controller.screenIndex <= 1)
            Text("\(controller.screenIndex) / \(controller.screenCount)").monospacedDigit()
                .accessibilityIdentifier("board.screens")
            Button("›") { controller.nextScreen() }.disabled(controller.screenIndex >= controller.screenCount)
            Button("New screen") { controller.addScreen() }
            Spacer(minLength: 8)
            SaveIndicator(session: session)
        }
        .buttonStyle(.bordered)
        .lineLimit(1)
        .padding(8)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
    }
}

/// Where the board's work is: saved, saving, waiting, kept on this iPad, or why not.
private struct SaveIndicator: View {
    @ObservedObject var session: BoardSession

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 9, height: 9)
            Text(label)
                .font(.callout)
                .accessibilityIdentifier("board.status")
            if session.sync.status == .error || session.sync.status == .offline {
                Button("Retry") { Task { await session.retry() } }
                    .accessibilityIdentifier("board.retry")
            }
        }
        .accessibilityElement(children: .contain)
        .help(detail)
    }

    private var label: String {
        let s = session.sync
        switch s.status {
        case .saved:
            if session.source == .converted && s.lastSavedAt == nil { return "Opened from the web" }
            return s.lastSavedAt == nil ? "Saved" : "Saved · v\(s.version ?? 0)"
        case .dirty: return "Not saved yet…"
        case .saving: return "Saving…"
        case .merging: return "Merging…"
        case .offline: return "Offline"
        case .error: return s.message ?? "Couldn't save"
        case .refused: return s.message ?? SaveCopy.boardFull
        case .localOnly: return "Not saved yet"
        }
    }

    private var detail: String {
        session.sync.message ?? (session.source == .converted ? "Converted from the web's board; the original is kept." : "")
    }

    private var color: Color {
        switch session.sync.status {
        case .saved: return .green
        case .dirty, .saving, .merging: return .orange
        case .offline, .localOnly: return .gray
        case .error, .refused: return .red
        }
    }
}
