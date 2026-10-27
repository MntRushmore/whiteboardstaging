import AgathonDesign
import AgathonKit
import SwiftUI

/// What the console reads and writes: the admin routes (`AdminService`), or a Debug build's fixtures.
protocol AdminData: Sendable {
    func overview() async throws -> AdminOverview
    func users() async throws -> AdminUserList
    func user(_ id: String) async throws -> AdminUserDetail
    func boards(userId: String?, before: String?) async throws -> AdminBoardList
    func board(_ id: String) async throws -> AdminBoardDoc
    func boardAsk(_ id: String) async throws -> AdminAskChat
    func bugs() async throws -> AdminBugList
    func bugScreenshot(_ id: String) async throws -> Data
    func updateBug(_ id: String, status: String?, note: String?) async throws
    func replyToBug(_ id: String, body: String) async throws
    func issues(days: Int) async throws -> AdminIssueList
    func runs(boardId: String?, limit: Int) async throws -> AdminRunList
}

extension AdminService: AdminData {}

/// The iPad admin console (the owner, 2026-10-27: "give me a ipad admin console where I can see
/// EVERYTHING!!"): the web console's sections, natively. Admins only — Account shows the way in only
/// to an admin, and every route answers a 404 to anyone else.
struct AdminConsole: View {
    enum Section: String, CaseIterable, Identifiable {
        case overview, users, boards, bugs, issues, runs
        var id: String { rawValue }
        var title: String {
            switch self {
            case .overview: return "Overview"
            case .users: return "Users"
            case .boards: return "Boards"
            case .bugs: return "Bug reports"
            case .issues: return "Issues"
            case .runs: return "Picture tutor runs"
            }
        }
        var symbol: String {
            switch self {
            case .overview: return "gauge.with.dots.needle.33percent"
            case .users: return "person.2"
            case .boards: return "rectangle.on.rectangle"
            case .bugs: return "ladybug"
            case .issues: return "exclamationmark.triangle"
            case .runs: return "pencil.and.scribble"
            }
        }
    }

    let data: any AdminData
    let close: () -> Void
    @State private var section: Section? = .overview

    var body: some View {
        NavigationSplitView {
            List(Section.allCases, selection: $section) { s in
                Label(s.title, systemImage: s.symbol)
                    .font(.ds(.callout))
                    .tag(s)
                    .accessibilityIdentifier("admin.section.\(s.rawValue)")
            }
            .navigationTitle("Admin")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done", action: close).accessibilityIdentifier("admin.close")
                }
            }
        } detail: {
            NavigationStack {
                switch section ?? .overview {
                case .overview: AdminOverviewView(data: data)
                case .users: AdminUsersView(data: data)
                case .boards: AdminBoardsView(data: data, userId: nil)
                case .bugs: AdminBugsView(data: data)
                case .issues: AdminIssuesView(data: data)
                case .runs: AdminRunsView(data: data, boardId: nil)
                }
            }
        }
        .tint(DS.Color.tutorInk)
    }
}

// MARK: - pieces

/// A load that can be pulled again: loading, the value, or what went wrong.
@MainActor
final class AdminLoad<T>: ObservableObject {
    @Published var value: T?
    @Published var error: String?
    @Published var loading = false

    func run(_ fetch: @escaping () async throws -> T) async {
        loading = true
        defer { loading = false }
        do {
            value = try await fetch()
            error = nil
        } catch {
            self.error = AdminText.problem(error)
        }
    }
}

enum AdminText {
    static func problem(_ error: Error) -> String {
        if case APIError.http(let f) = error {
            if f.status == 404 { return "Not found, or this account isn't an admin." }
            return "The server answered \(f.status)."
        }
        return "Couldn't load: \(error.localizedDescription)"
    }

    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoPlain = ISO8601DateFormatter()

    static func date(_ s: String?) -> Date? {
        guard let s else { return nil }
        return iso.date(from: s) ?? isoPlain.date(from: s)
    }

    /// "5 min ago", "3 h ago", "2 d ago", or "—".
    static func ago(_ s: String?) -> String {
        guard let d = date(s) else { return "—" }
        let sec = max(0, Date().timeIntervalSince(d))
        if sec < 60 { return "just now" }
        if sec < 3600 { return "\(Int(sec / 60)) min ago" }
        if sec < 86_400 { return "\(Int(sec / 3600)) h ago" }
        return "\(Int(sec / 86_400)) d ago"
    }

    static func stamp(_ s: String?) -> String {
        guard let d = date(s) else { return s ?? "—" }
        return d.formatted(date: .abbreviated, time: .shortened)
    }

    static func usd(_ v: Double?) -> String { v.map { String(format: "$%.2f", $0) } ?? "—" }
}

/// A big number with its label.
struct AdminStat: View {
    let label: String
    let value: String
    var tone: Color = DS.Color.ink

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.system(size: 28, weight: .bold, design: .rounded)).foregroundStyle(tone).monospacedDigit()
            Text(label).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(DS.Color.surface))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(DS.Color.line, lineWidth: 1))
    }
}

/// A small coloured word (a status, a level, a flag).
struct AdminChip: View {
    let text: String
    var tone: Color = DS.Color.inkSecondary

    var body: some View {
        Text(text)
            .font(.system(size: 12, weight: .semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .foregroundStyle(tone)
            .background(Capsule().fill(tone.opacity(0.12)))
    }

    static func tone(_ s: String) -> Color {
        switch s {
        case "error", "failing", "new", "open", "misaligned", "down": return DS.Color.tomato
        case "warn", "seen", "trialing", "trial_cancelling", "cancelling", "muted": return DS.Color.streak
        case "fixed", "active", "ok", "done", "accepted", "up": return DS.Color.success
        default: return DS.Color.inkSecondary
        }
    }
}

/// A titled block of the console.
struct AdminCard<Content: View>: View {
    let title: String?
    @ViewBuilder let content: () -> Content

    init(_ title: String? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let title { Text(title).dsFont(.label).foregroundStyle(DS.Color.inkSecondary).textCase(.uppercase) }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(DS.Color.surface))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(DS.Color.line, lineWidth: 1))
    }
}

/// A label and its value on one line.
struct AdminPair: View {
    let label: String
    let value: String

    init(_ label: String, _ value: String?) {
        self.label = label
        self.value = value ?? "—"
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary).frame(width: 140, alignment: .leading)
            Text(value).font(.ds(.callout)).foregroundStyle(DS.Color.ink).textSelection(.enabled)
            Spacer(minLength: 0)
        }
    }
}

/// What a load shows while empty: a spinner or the problem with a retry.
struct AdminLoadState: View {
    let loading: Bool
    let error: String?
    let retry: () -> Void

    var body: some View {
        if let error {
            VStack(spacing: 12) {
                Text(error).dsFont(.callout).foregroundStyle(DS.Color.inkSecondary).multilineTextAlignment(.center)
                Button("Try again", action: retry)
            }
            .padding(40)
        } else if loading {
            ProgressView().padding(40)
        }
    }
}

/// One app_events row in a list.
struct AdminEventRow: View {
    let event: AdminEvent

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                AdminChip(text: event.level, tone: AdminChip.tone(event.level))
                Text(event.kind).font(.system(size: 13, weight: .semibold, design: .monospaced)).foregroundStyle(DS.Color.ink)
                if let code = event.code { Text(code).font(.system(size: 13, design: .monospaced)).foregroundStyle(DS.Color.inkSecondary) }
                Spacer()
                Text(AdminText.ago(event.at)).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
            }
            Text(event.message).dsFont(.callout).foregroundStyle(DS.Color.ink).lineLimit(3)
            HStack(spacing: 10) {
                if let e = event.userEmail { Text(e).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary) }
                if let r = event.route { Text(r).font(.system(size: 11, design: .monospaced)).foregroundStyle(DS.Color.inkSecondary) }
                if let rel = event.release { Text(rel).font(.system(size: 11, design: .monospaced)).foregroundStyle(DS.Color.inkSecondary) }
            }
        }
        .padding(.vertical, 4)
    }
}
