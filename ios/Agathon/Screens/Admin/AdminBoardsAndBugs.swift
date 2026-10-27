import AgathonBoard
import AgathonDesign
import AgathonKit
import SwiftUI

// MARK: - Boards

struct AdminBoardsView: View {
    let data: any AdminData
    let userId: String?
    @State private var boards: [AdminBoardRow] = []
    @State private var nextBefore: String?
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        List {
            if boards.isEmpty { AdminLoadState(loading: loading, error: error) { Task { await reload() } } }
            ForEach(boards) { b in
                NavigationLink { AdminBoardDetailView(data: data, id: b.id) } label: { AdminBoardRowView(board: b) }
            }
            if let before = nextBefore {
                Button("More boards") { Task { await more(before) } }.disabled(loading)
            }
        }
        .navigationTitle("Boards")
        .refreshable { await reload() }
        .task { if boards.isEmpty { await reload() } }
    }

    private func reload() async {
        loading = true
        defer { loading = false }
        do {
            let page = try await data.boards(userId: userId, before: nil)
            boards = page.boards
            nextBefore = page.nextBefore
            error = nil
        } catch {
            self.error = AdminText.problem(error)
        }
    }

    private func more(_ before: String) async {
        loading = true
        defer { loading = false }
        if let page = try? await data.boards(userId: userId, before: before) {
            boards += page.boards
            nextBefore = page.nextBefore
        }
    }
}

/// A board in a list: its preview, title, owner and when.
struct AdminBoardRowView: View {
    let board: AdminBoardRow

    var body: some View {
        HStack(spacing: 12) {
            Group {
                if let d = board.previewData, let img = UIImage(data: d) {
                    Image(uiImage: img).resizable().scaledToFit()
                } else {
                    Rectangle().fill(DS.Color.surfaceSunken)
                }
            }
            .frame(width: 96, height: 54)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(DS.Color.line, lineWidth: 1))
            VStack(alignment: .leading, spacing: 2) {
                Text(board.title ?? "Untitled board").font(.ds(.callout)).foregroundStyle(DS.Color.ink)
                Text("\(board.ownerEmail ?? board.ownerName ?? "—") · saved \(AdminText.ago(board.updatedAt)) · \(board.sizeKb) KB")
                    .dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
            }
            Spacer()
            if board.errors7d > 0 { AdminChip(text: "\(board.errors7d) errors", tone: DS.Color.tomato) }
        }
    }
}

/// One board, read-only: every page drawn from its saved document, its events, problems, Ask chat
/// and picture tutor runs. Opening it is written to admin_audit by the server, as on the web.
struct AdminBoardDetailView: View {
    let data: any AdminData
    let id: String
    @StateObject private var load = AdminLoad<AdminBoardDoc>()
    @State private var pages: [UIImage] = []
    @State private var drawing = false
    @State private var zoomed: UIImage?

    var body: some View {
        ScrollView {
            if let d = load.value {
                VStack(alignment: .leading, spacing: 16) {
                    AdminCard("Board") {
                        AdminPair("Title", d.board.title ?? "Untitled")
                        AdminPair("Owner", d.board.ownerEmail ?? d.board.ownerName)
                        AdminPair("Saved", AdminText.stamp(d.board.updatedAt))
                        AdminPair("Version", "\(d.board.version) · \(d.board.sizeKb) KB · \(d.snapshotSource ?? "data")")
                        AdminPair("Board id", d.board.id)
                    }
                    AdminCard("Pages (\(pages.count))") {
                        if drawing { ProgressView() }
                        if !drawing && pages.isEmpty { Text("Nothing to draw.").dsFont(.caption).foregroundStyle(DS.Color.inkSecondary) }
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 12)], spacing: 12) {
                            ForEach(Array(pages.enumerated()), id: \.offset) { i, img in
                                Button { zoomed = img } label: {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Image(uiImage: img).resizable().scaledToFit()
                                            .background(Color.white)
                                            .clipShape(RoundedRectangle(cornerRadius: 8))
                                            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(DS.Color.line, lineWidth: 1))
                                        Text("Page \(i + 1)").dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
                                    }
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    NavigationLink { AdminRunsView(data: data, boardId: id) } label: {
                        Label("Picture tutor runs on this board", systemImage: "pencil.and.scribble")
                    }
                    NavigationLink { AdminAskView(data: data, boardId: id) } label: {
                        Label("Ask chat", systemImage: "bubble.left.and.text.bubble.right")
                    }
                    if !d.attempts.isEmpty {
                        AdminCard("Problems") {
                            ForEach(d.attempts.prefix(30)) { a in
                                HStack {
                                    Text(a.problemLatex).font(.system(size: 13, design: .monospaced)).lineLimit(1)
                                    Spacer()
                                    AdminChip(text: a.outcome.replacingOccurrences(of: "_", with: " "), tone: AdminChip.tone(a.outcome == "first_try" ? "ok" : ""))
                                }
                            }
                        }
                    }
                    if !d.events.isEmpty {
                        AdminCard("Events") { ForEach(d.events.prefix(40)) { AdminEventRow(event: $0) } }
                    }
                }
                .padding(20)
            } else {
                AdminLoadState(loading: load.loading, error: load.error) { Task { await reload() } }
            }
        }
        .background(DS.Color.ground)
        .navigationTitle(load.value?.board.title ?? "Board")
        .refreshable { await reload() }
        .task { if load.value == nil { await reload() } }
        .sheet(item: Binding(get: { zoomed.map(ZoomedPage.init) }, set: { if $0 == nil { zoomed = nil } })) { page in
            AdminZoomedPage(image: page.image) { zoomed = nil }
        }
    }

    private func reload() async {
        await load.run { try await data.board(id) }
        guard let snapshot = load.value?.snapshot else { return }
        drawing = true
        pages = await AdminBoardPages.render(snapshot)
        drawing = false
    }
}

private struct ZoomedPage: Identifiable {
    let image: UIImage
    var id: ObjectIdentifier { ObjectIdentifier(image) }
}

/// A page full screen, pinch to zoom.
private struct AdminZoomedPage: View {
    let image: UIImage
    let close: () -> Void
    @State private var scale: CGFloat = 1

    var body: some View {
        NavigationStack {
            ScrollView([.horizontal, .vertical]) {
                Image(uiImage: image).resizable().scaledToFit()
                    .frame(width: 1100 * scale)
                    .background(Color.white)
                    .gesture(MagnifyGesture().onChanged { scale = max(0.5, min(4, $0.magnification)) })
            }
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done", action: close) } }
        }
    }
}

/// A board's saved document drawn page by page (the same renderer the board uses), on white.
@MainActor
enum AdminBoardPages {
    static let width = 1200

    static func render(_ snapshot: AgathonKit.JSONValue) async -> [UIImage] {
        guard let bytes = try? JSONEncoder().encode(snapshot),
              let result = try? TldrawImporter.importSnapshot(bytes) else { return [] }
        let controller = BoardController(document: result.document)
        let screens = controller.store.records.values
            .compactMap { r -> ScreenRecord? in if case .screen(let s) = r { return s } else { return nil } }
            .sorted { $0.order < $1.order }
        var out: [UIImage] = []
        for screen in screens {
            let items = controller.store.drawables(on: screen.id).compactMap { RenderGeometry.item(for: $0, images: controller.images) }
            let r = screen.rect
            let h = max(1, Int(Double(width) * r.h / max(1, r.w)))
            if let cg = PictureTutorCapture.render(items, region: r, width: width, height: h) {
                out.append(UIImage(cgImage: cg))
            }
            await Task.yield()
        }
        return out
    }
}

/// A board's Ask chat, oldest first.
struct AdminAskView: View {
    let data: any AdminData
    let boardId: String
    @StateObject private var load = AdminLoad<AdminAskChat>()

    var body: some View {
        List {
            if load.value == nil { AdminLoadState(loading: load.loading, error: load.error) { Task { await reload() } } }
            ForEach(load.value?.turns ?? []) { t in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        AdminChip(text: t.role, tone: t.role == "tutor" ? DS.Color.tutorInk : DS.Color.inkSecondary)
                        Spacer()
                        Text(AdminText.ago(t.at)).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
                    }
                    Text(t.text).dsFont(.callout).textSelection(.enabled)
                    ForEach(t.notes, id: \.self) { Text("• \($0)").dsFont(.caption).foregroundStyle(DS.Color.inkSecondary) }
                }
            }
            if load.value?.turns.isEmpty == true { Text("No chat on this board.").dsFont(.caption) }
        }
        .navigationTitle("Ask chat")
        .refreshable { await reload() }
        .task { if load.value == nil { await reload() } }
    }

    private func reload() async { await load.run { try await data.boardAsk(boardId) } }
}

// MARK: - Bug reports

struct AdminBugsView: View {
    let data: any AdminData
    @StateObject private var load = AdminLoad<AdminBugList>()
    @State private var filter = "open"

    private var shown: [AdminBug] {
        let all = load.value?.bugs ?? []
        switch filter {
        case "open": return all.filter { $0.status == "new" || $0.status == "seen" }
        case "all": return all
        default: return all.filter { $0.status == filter }
        }
    }

    var body: some View {
        List {
            Picker("Show", selection: $filter) {
                Text("Open").tag("open")
                Text("New").tag("new")
                Text("Fixed").tag("fixed")
                Text("All").tag("all")
            }
            .pickerStyle(.segmented)
            if load.value == nil { AdminLoadState(loading: load.loading, error: load.error) { Task { await reload() } } }
            ForEach(shown) { b in
                NavigationLink { AdminBugDetailView(data: data, bug: b) { await reload() } } label: { AdminBugRowView(bug: b) }
            }
        }
        .navigationTitle("Bug reports")
        .refreshable { await reload() }
        .task { if load.value == nil { await reload() } }
    }

    private func reload() async { await load.run { try await data.bugs() } }
}

struct AdminBugRowView: View {
    let bug: AdminBug

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                AdminChip(text: bug.status, tone: AdminChip.tone(bug.status))
                if bug.waiting { AdminChip(text: "waiting on us", tone: DS.Color.tomato) }
                if bug.hasScreenshot { Image(systemName: "photo").foregroundStyle(DS.Color.inkSecondary) }
                Spacer()
                Text(AdminText.ago(bug.at)).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
            }
            Text(bug.message.isEmpty ? "(no words)" : bug.message).dsFont(.callout).foregroundStyle(DS.Color.ink).lineLimit(2)
            Text(bug.email ?? "—").dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
        }
    }
}

/// One report: the screenshot, words, what the app knew, the thread; status, note and a reply.
struct AdminBugDetailView: View {
    let data: any AdminData
    @State var bug: AdminBug
    var changed: () async -> Void = {}
    @State private var shot: UIImage?
    @State private var note = ""
    @State private var reply = ""
    @State private var busy = false
    @State private var problem: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                AdminCard("Report") {
                    HStack {
                        AdminChip(text: bug.status, tone: AdminChip.tone(bug.status))
                        Text(AdminText.stamp(bug.at)).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
                    }
                    Text(bug.message.isEmpty ? "(no words)" : bug.message).dsFont(.callout).textSelection(.enabled)
                    AdminPair("From", bug.email)
                    AdminPair("Board", bug.boardId)
                    Picker("Status", selection: Binding(get: { bug.status }, set: { s in Task { await set(status: s) } })) {
                        ForEach(AdminBug.statuses, id: \.self) { Text($0).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .disabled(busy)
                }
                if bug.hasScreenshot {
                    AdminCard("Screenshot") {
                        if let shot {
                            Image(uiImage: shot).resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: 8))
                        } else {
                            ProgressView()
                        }
                    }
                }
                if !bug.diagnostics.isEmpty {
                    AdminCard("What the app knew") {
                        ForEach(bug.diagnostics.keys.sorted(), id: \.self) { k in
                            AdminPair(k, Self.text(bug.diagnostics[k]))
                        }
                    }
                }
                AdminCard("Thread") {
                    ForEach(bug.thread) { m in
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(m.author) · \(AdminText.ago(m.at))").dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
                            Text(m.body).dsFont(.callout).textSelection(.enabled)
                        }
                    }
                    TextField("Reply to the reporter (they see it in the app and by email)", text: $reply, axis: .vertical)
                        .lineLimit(2 ... 6)
                        .textFieldStyle(.roundedBorder)
                    Button(busy ? "Sending…" : "Send reply") { Task { await sendReply() } }
                        .disabled(busy || reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                AdminCard("Note (only admins see it)") {
                    if let n = bug.note { Text(n).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary).textSelection(.enabled) }
                    TextField("A note", text: $note, axis: .vertical).lineLimit(2 ... 6).textFieldStyle(.roundedBorder)
                    Button("Save note") { Task { await set(note: note) } }.disabled(busy || note.isEmpty)
                }
                if !bug.logs.isEmpty {
                    AdminCard("Logs") {
                        ForEach(Array(bug.logs.suffix(60).enumerated()), id: \.offset) { _, l in
                            Text("\(l.level) \(l.text)").font(.system(size: 11, design: .monospaced)).foregroundStyle(DS.Color.inkSecondary)
                        }
                    }
                }
                if let problem { Text(problem).dsFont(.caption).foregroundStyle(DS.Color.tomato) }
            }
            .padding(20)
        }
        .background(DS.Color.ground)
        .navigationTitle("Bug report")
        .task {
            if bug.hasScreenshot, shot == nil, let d = try? await data.bugScreenshot(bug.id) { shot = UIImage(data: d) }
        }
    }

    static func text(_ v: AgathonKit.JSONValue?) -> String {
        switch v {
        case .string(let s)?: return s
        case .number(let n)?: return n.rounded() == n ? String(Int(n)) : String(n)
        case .bool(let b)?: return b ? "yes" : "no"
        case nil, .null?: return "—"
        default: return String(describing: v!)
        }
    }

    private func set(status: String? = nil, note: String? = nil) async {
        busy = true
        defer { busy = false }
        do {
            try await data.updateBug(bug.id, status: status, note: note)
            if let status { bug.status = status }
            if let note { bug.note = note; self.note = "" }
            problem = nil
            await changed()
        } catch {
            problem = AdminText.problem(error)
        }
    }

    private func sendReply() async {
        let text = reply.trimmingCharacters(in: .whitespacesAndNewlines)
        busy = true
        defer { busy = false }
        do {
            try await data.replyToBug(bug.id, body: text)
            reply = ""
            problem = nil
            await changed()
        } catch {
            problem = AdminText.problem(error)
        }
    }
}
