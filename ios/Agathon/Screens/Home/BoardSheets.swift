import AgathonDesign
import AgathonKit
import SwiftUI

/// Rename a board: one field, Cancel and Save (the web's "Rename board" dialog).
struct RenameBoardSheet: View {
    let board: BoardSummary
    /// Saves the name; returns what to say when it didn't work.
    let save: (String) async -> String?

    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var busy = false
    @State private var error: String?

    init(board: BoardSummary, save: @escaping (String) async -> String?) {
        self.board = board
        self.save = save
        // An unnamed board starts empty rather than with "Untitled Whiteboard" to delete.
        _title = State(initialValue: board.title == BoardSummary.defaultTitle ? "" : board.title)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.l) {
            SheetHeader("Rename board", onClose: { dismiss() })
            Text("Give it a name you'll know later.")
                .dsFont(.callout)
                .foregroundStyle(DS.Color.inkSecondary)
            PillField("Untitled board", text: $title, icon: .pen)
                .submitLabel(.done)
                .onSubmit(submit)
                .accessibilityIdentifier("boards.renameField")
            if let error {
                Banner(.lookAgain, error)
            }
            HStack(spacing: DS.Space.s) {
                Button { dismiss() } label: { Text("Cancel").frame(maxWidth: .infinity) }
                    .buttonStyle(.pill(.secondaryOnPaper, size: .large))
                Button(action: submit) {
                    HStack(spacing: DS.Space.xs) {
                        if busy { ProgressView().tint(DS.Color.onInk) }
                        Text(busy ? "Saving…" : "Save")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.pill(.primary, size: .large))
                .disabled(busy || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityIdentifier("boards.renameSave")
            }
        }
        .blocksSheet()
        .interactiveDismissDisabled(busy)
    }

    private func submit() {
        guard !busy, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        busy = true
        Task {
            let problem = await save(title)
            busy = false
            if let problem { error = problem } else { dismiss() }
        }
    }
}

/// Delete a board, asked properly: the board's picture and name, what deleting means, and two
/// clear buttons with "Keep it" first. A sheet, not an alert a kid could tap through.
struct DeleteBoardSheet: View {
    let board: BoardSummary
    let thumbnail: UIImage?
    /// Deletes the board; returns what to say when it didn't work.
    let delete: () async -> String?

    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.l) {
            SheetHeader("Delete this board?", onClose: { dismiss() })
            HStack(alignment: .center, spacing: DS.Space.m) {
                BoardThumbnail(image: thumbnail)
                    .frame(width: 160)
                VStack(alignment: .leading, spacing: 4) {
                    Text(board.title)
                        .dsFont(.button, size: 18)
                        .foregroundStyle(DS.Color.ink)
                        .lineLimit(2)
                    Text(HomeFormat.edited(board.updatedAt))
                        .dsFont(.caption)
                        .foregroundStyle(DS.Color.inkSecondary)
                }
            }
            Text("Everything on it will be gone for good. This can't be undone.")
                .dsFont(.body)
                .foregroundStyle(DS.Color.ink)
                .fixedSize(horizontal: false, vertical: true)
            if let error {
                Banner(.lookAgain, "Couldn't delete it.", message: error)
            }
            HStack(spacing: DS.Space.s) {
                Button { dismiss() } label: { Text("Keep it").frame(maxWidth: .infinity) }
                    .buttonStyle(.pill(.secondaryOnPaper, size: .large))
                    .accessibilityIdentifier("boards.keep")
                Button(action: submit) {
                    HStack(spacing: DS.Space.xs) {
                        if busy { ProgressView().tint(DS.Color.onInk) } else { DSIcon(.trash, size: 20) }
                        Text(busy ? "Deleting…" : (error == nil ? "Delete" : "Try again"))
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.pill(.primary, size: .large))
                .disabled(busy)
                .accessibilityIdentifier("boards.confirmDelete")
            }
        }
        .blocksSheet()
        .interactiveDismissDisabled(busy)
    }

    private func submit() {
        guard !busy else { return }
        busy = true
        Task {
            let problem = await delete()
            busy = false
            if let problem { error = problem } else { dismiss() }
        }
    }
}
