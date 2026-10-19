#if DEBUG
import AgathonKit
import SwiftUI

/// The boards home, plain: the signed-in profile's boards (thumbnail, name, when it was edited),
/// new / rename / delete, the ink, the profile switcher, sign out. Tapping a board opens it.
struct DebugBoardsView: View {
    @Environment(AgathonBackend.self) private var backend

    @State private var boards: [BoardSummary] = []
    @State private var loaded = false
    @State private var listError: String?
    @State private var actionError: String?
    @State private var ink: InkSummary?
    @State private var inkError: String?
    @State private var family: FamilyState?
    @State private var busy = false
    @State private var showSwitcher = false
    @State private var renaming: BoardSummary?
    @State private var renameText = ""
    @State private var deleting: BoardSummary?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    DebugInkReadout(ink: ink, error: inkError)
                    LabeledContent("Signed in as") {
                        Text(signedInAs)
                            .accessibilityIdentifier("boards.signedInAs")
                    }
                } footer: {
                    DebugEnvironmentLine()
                }

                Section {
                    if let listError {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Couldn't load your boards").font(.headline)
                            Text(listError).foregroundStyle(.secondary)
                            Button("Try again") { Task { await load() } }
                        }
                        .accessibilityIdentifier("boards.error")
                    } else if loaded && boards.isEmpty {
                        ContentUnavailableView {
                            Label("No boards yet", systemImage: "rectangle.on.rectangle")
                        } description: {
                            Text("Make one to start.")
                        } actions: {
                            Button("New board") { create() }
                        }
                        .accessibilityIdentifier("boards.empty")
                    } else if !loaded {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                    }
                    ForEach(boards) { board in
                        // the plain board (Debug/PlainBoardScreen.swift: AgathonSync + the canvas)
                        NavigationLink {
                            PlainBoardScreen(board: board)
                        } label: {
                            BoardRow(board: board)
                        }
                            .swipeActions(edge: .trailing) {
                                Button("Delete", role: .destructive) { deleting = board }
                                Button("Rename") {
                                    renameText = board.title
                                    renaming = board
                                }
                                .tint(.blue)
                            }
                            .contextMenu {
                                Button("Rename") {
                                    renameText = board.title
                                    renaming = board
                                }
                                Button("Delete", role: .destructive) { deleting = board }
                            }
                    }
                } header: {
                    Text(loaded && listError == nil ? "\(boards.count) board\(boards.count == 1 ? "" : "s")" : "Boards")
                        .accessibilityIdentifier("boards.count")
                }

                if let actionError {
                    Section {
                        Text(actionError)
                            .foregroundStyle(.red)
                            .accessibilityIdentifier("boards.actionError")
                    }
                }
            }
            .navigationTitle("Boards")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        showSwitcher = true
                    } label: {
                        Label(profileLabel, systemImage: "person.2")
                            .labelStyle(.titleAndIcon)
                    }
                    .accessibilityIdentifier("boards.switchProfile")
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button {
                        Task { await load() }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .accessibilityIdentifier("boards.refresh")
                    Button {
                        create()
                    } label: {
                        Label("New board", systemImage: "plus")
                    }
                    .disabled(busy)
                    .accessibilityIdentifier("boards.new")
                    Button("Sign out", role: .destructive) { signOut() }
                        .accessibilityIdentifier("boards.signOut")
                }
            }
            .refreshable { await load() }
            .task { await load() }
            .sheet(isPresented: $showSwitcher) {
                DebugProfileSwitcher(initial: family)
            }
            .alert("Rename board", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
                TextField("Name", text: $renameText)
                    .accessibilityIdentifier("boards.renameField")
                Button("Cancel", role: .cancel) { renaming = nil }
                Button("Save") { rename() }
                    .accessibilityIdentifier("boards.renameSave")
            }
            .confirmationDialog("Delete \u{201C}\(deleting?.title ?? "")\u{201D}?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                                titleVisibility: .visible) {
                Button("Delete board", role: .destructive) { delete() }
            } message: {
                Text("The board and its pictures are gone for good.")
            }
        }
    }

    private var signedInAs: String {
        if let me = family?.meMember {
            return "\(FamilyAvatar.emoji(for: me.avatar)) \(me.displayName)\(family?.role == .kid ? " (kid profile)" : "")"
        }
        return backend.auth.email ?? "…"
    }

    private var profileLabel: String {
        guard let family, family.role != .solo else { return "Profiles" }
        return family.meMember.map { "\(FamilyAvatar.emoji(for: $0.avatar)) \($0.displayName)" } ?? "Profiles"
    }

    // MARK: actions

    private func load() async {
        let boardsRepository = backend.boards
        let profiles = backend.profiles
        let familyService = backend.family
        async let boardsResult = outcome { try await boardsRepository.list() }
        async let inkResult = outcome { try await profiles.inkSummary() }
        async let familyResult = outcome { try await familyService.load() }

        switch await boardsResult {
        case let .success(list):
            boards = list
            listError = nil
        case let .failure(error):
            listError = describe(error)
            await backend.errors.reportUserError(kind: "live.boards", code: "load_failed", message: "Couldn't load your boards",
                                                 path: "/boards", error: error)
        }
        loaded = true
        switch await inkResult {
        case let .success(summary):
            ink = summary
            inkError = nil
        case let .failure(error):
            inkError = describe(error)
        }
        if case let .success(state) = await familyResult { family = state }
    }

    private func create() {
        guard !busy else { return }
        busy = true
        actionError = nil
        Task {
            defer { busy = false }
            do {
                let board = try await backend.boards.create()
                boards.insert(board, at: 0)
            } catch {
                actionError = "Couldn't make a board. \(describe(error))"
                await backend.errors.reportUserError(kind: "live.boards", code: "create_failed", message: "Couldn't make a board",
                                                     path: "/boards", error: error)
            }
        }
    }

    private func rename() {
        guard let board = renaming else { return }
        let title = renameText
        renaming = nil
        Task {
            do {
                let saved = try await backend.boards.rename(id: board.id, to: title)
                if let index = boards.firstIndex(where: { $0.id == board.id }) { boards[index] = saved }
                actionError = nil
            } catch {
                actionError = "Couldn't rename the board. \(describe(error))"
            }
        }
    }

    private func delete() {
        guard let board = deleting else { return }
        deleting = nil
        Task {
            do {
                let result = try await backend.boards.delete(id: board.id)
                boards.removeAll { $0.id == board.id }
                actionError = result.assetErrors.isEmpty ? nil : "Board deleted, but some pictures could not be removed."
            } catch {
                actionError = "Couldn't delete the board. \(describe(error))"
            }
        }
    }

    private func signOut() {
        Task {
            do {
                try await backend.auth.signOut()
            } catch {
                actionError = "Couldn't sign out. \(describe(error))"
            }
        }
    }

    private func describe(_ error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }
}

/// An async call's value or error, so several can run side by side and fail on their own.
private func outcome<T: Sendable>(_ operation: @Sendable () async throws -> T) async -> Result<T, Error> {
    do {
        return .success(try await operation())
    } catch {
        return .failure(error)
    }
}

private struct BoardRow: View {
    let board: BoardSummary

    var body: some View {
        HStack(spacing: 16) {
            DebugThumbnail(board: board)
            VStack(alignment: .leading, spacing: 4) {
                Text(board.title)
                    .font(.headline)
                    .lineLimit(2)
                Text(DebugFormat.edited(board.updatedAt))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if let version = board.version {
                    Text("version \(version)")
                        .font(.caption.monospaced())
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("boards.row")
    }
}

/// The ink readout: the balance and the plan.
struct DebugInkReadout: View {
    let ink: InkSummary?
    let error: String?

    var body: some View {
        LabeledContent("Ink") {
            Group {
                if let ink {
                    Text("\(DebugFormat.ink(ink.balance)) ink\(planText(ink))")
                        // The plan covers help: an empty balance is nothing to warn about.
                        .foregroundStyle(color(ink))
                } else if let error {
                    Text(error).foregroundStyle(.red)
                } else {
                    ProgressView()
                }
            }
            .accessibilityIdentifier("boards.ink")
        }
    }

    private func color(_ ink: InkSummary) -> Color {
        if ink.hasUnlimited { return .primary }
        switch ink.tone {
        case .empty: return .red
        case .low: return .orange
        case .ok: return .primary
        }
    }

    private func planText(_ ink: InkSummary) -> String {
        guard let plan = ink.unlimited, let status = plan.status, status != "none" else { return " · no plan" }
        return ink.hasUnlimited ? " · Agathon Unlimited (\(status))" : " · plan \(status)"
    }
}

#Preview {
    DebugBoardsView()
        .environment(AgathonBackend.preview())
}
#endif
