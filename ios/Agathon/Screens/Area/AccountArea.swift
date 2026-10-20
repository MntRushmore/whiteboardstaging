import AgathonDesign
import AgathonKit
import SwiftUI

/// The places off Home, full screen: Progress, the account, the family, the weekly report and bug
/// reports. A grown-up sees them all; a kid sees their progress, their own account page and bug
/// reports (kids never see billing, can't edit their name, delete the account, set the PIN or add
/// kids: the web's rules). A sidebar on a full iPad; a row of tabs in a narrow window.
struct AccountArea: View {
    enum Page: String, CaseIterable, Identifiable {
        case progress, account, family, report, bugs
        var id: String { rawValue }

        var title: String {
            switch self {
            case .progress: return "Progress"
            case .account: return "Account"
            case .family: return "Family"
            case .report: return "Weekly report"
            case .bugs: return "Bug reports"
            }
        }

        var icon: DS.Icon {
            switch self {
            case .progress: return .chart
            case .account: return .settings
            case .family: return .family
            case .report: return .report
            case .bugs: return .bug
            }
        }
    }

    /// Starts a topic's practice board from Progress (Home opens it).
    let practice: (String) -> Void

    @Environment(AgathonBackend.self) private var backend
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var page: Page
    @State private var signOutProblem: String?
    /// Who is here: the grown-ups' pages only for a grown-up. Not known yet (Home opened Progress
    /// before the family answered): the kid's pages until the family is read here.
    @State private var who: SignedInAs
    @State private var family: FamilyState?

    init(start: Page, who: SignedInAs, family: FamilyState?, practice: @escaping (String) -> Void) {
        self.practice = practice
        _who = State(initialValue: who)
        _family = State(initialValue: family)
        // a grown-up's page asked for by someone not known to be one: their progress instead
        _page = State(initialValue: who.isGrownUp || Self.kidPages.contains(start) ? start : .progress)
    }

    private var isKid: Bool { !who.isGrownUp }

    static let kidPages: [Page] = [.progress, .account, .bugs]

    private var pages: [Page] {
        isKid ? Self.kidPages : [.progress, .account, .family, .report, .bugs]
    }

    /// Tabs on top instead of the sidebar: a narrow window, or the largest text sizes (the sidebar's
    /// names were cut to "Progr…").
    private var tabsOnTop: Bool { sizeClass == .compact || typeSize.isAccessibilitySize }

    var body: some View {
        ZStack {
            DS.Color.ground.ignoresSafeArea()
            if tabsOnTop {
                VStack(alignment: .leading, spacing: DS.Space.m) {
                    HStack {
                        RoundButton(.close, label: "Back to Home") { dismiss() }
                            .accessibilityIdentifier("area.close")
                        Spacer()
                        // the sidebar's Sign out, here too
                        Button(action: signOut) {
                            HStack(spacing: DS.Space.s) {
                                DSIcon(.signOut, size: 20)
                                Text("Sign out").dsFont(.button, size: 17).lineLimit(1)
                            }
                            .foregroundStyle(DS.Color.ink)
                            .padding(.horizontal, DS.Space.m)
                            .frame(minHeight: DS.Size.minTarget)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("area.signOut")
                    }
                    if let signOutProblem {
                        Text(signOutProblem).dsFont(.caption).foregroundStyle(DS.Color.ink)
                    }
                    SegmentedPicker(selection: $page, options: pages.map { ($0, $0.title) })
                    detail
                }
                .padding(.horizontal, DS.Space.l)
                .padding(.top, DS.Space.s)
            } else {
                HStack(alignment: .top, spacing: 0) {
                    sidebar
                        .frame(width: 300)
                    detail
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .dsAnimation(DS.Motion.fade, value: page)
        .task {
            guard case .unknown = who else { return }
            if let read = try? await backend.family.load() {
                family = read
                who = FamilyState.who(read, email: backend.auth.email)
            }
        }
        .onChange(of: who) { if !pages.contains(page) { page = .progress } }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: DS.Space.xs) {
            RoundButton(.close, label: "Back to Home") { dismiss() }
                .accessibilityIdentifier("area.close")
                .padding(.bottom, DS.Space.l)
            Text(isKid ? "You" : "Grown-ups")
                .dsFont(.title)
                .foregroundStyle(DS.Color.ink)
                .accessibilityAddTraits(.isHeader)
            if let email = backend.auth.email, !isKid {
                Text(email)
                    .dsFont(.caption)
                    .foregroundStyle(DS.Color.inkSecondary)
                    .lineLimit(1)
                    .padding(.bottom, DS.Space.m)
            } else {
                Spacer().frame(height: DS.Space.m)
            }
            ForEach(pages) { item in
                sidebarRow(item)
            }
            Spacer(minLength: DS.Space.l)
            if let signOutProblem {
                Text(signOutProblem).dsFont(.caption).foregroundStyle(DS.Color.ink)
            }
            Button(action: signOut) {
                HStack(spacing: DS.Space.s) {
                    DSIcon(.signOut, size: 20)
                    Text("Sign out").dsFont(.button, size: 17)
                    Spacer(minLength: 0)
                }
                .foregroundStyle(DS.Color.ink)
                .padding(.horizontal, DS.Space.m)
                .frame(minHeight: DS.Size.minTarget)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("area.signOut")
        }
        .padding(.leading, DS.Space.xxl)
        .padding(.trailing, DS.Space.m)
        .padding(.vertical, DS.Space.m)
    }

    private func sidebarRow(_ item: Page) -> some View {
        let on = item == page
        return Button {
            page = item
        } label: {
            HStack(spacing: DS.Space.s) {
                DSIcon(item.icon, size: 20)
                Text(item.title).dsFont(.button, size: 17).lineLimit(1)
                Spacer(minLength: 0)
            }
            .foregroundStyle(on ? DS.Color.onInk : DS.Color.ink)
            .padding(.horizontal, DS.Space.m)
            .frame(minHeight: DS.Size.minTarget)
            .background(Capsule().fill(on ? DS.Color.ink : Color.clear))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
        .accessibilityIdentifier("area.\(item.rawValue)")
    }

    @ViewBuilder private var detail: some View {
        switch page {
        case .progress:
            ProgressPage(practice: { skill in
                dismiss()
                practice(skill)
            })
        case .account:
            if isKid { KidAccountPage(family: family) } else { AccountPage(family: family) }
        case .family:
            FamilyPage()
        case .report:
            WeeklyReportPage()
        case .bugs:
            BugReportsPage()
        }
    }

    private func signOut() {
        Task {
            do {
                try await backend.auth.signOut()
            } catch {
                signOutProblem = "Couldn't sign you out. Try again in a moment."
            }
        }
    }
}

// MARK: - Pieces the pages share

/// A page's scroll and its title.
struct AreaPage<Content: View>: View {
    let title: String
    let subtitle: String?
    let content: Content
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize

    init(_ title: String, subtitle: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.subtitle = subtitle
        self.content = content()
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.Space.l) {
                VStack(alignment: .leading, spacing: DS.Space.xs) {
                    Text(title)
                        .dsFont(.display, size: 52)
                        .foregroundStyle(DS.Color.ink)
                        .accessibilityAddTraits(.isHeader)
                        .fixedSize(horizontal: false, vertical: true)
                    if let subtitle {
                        Text(subtitle)
                            .dsFont(.body)
                            .foregroundStyle(DS.Color.inkSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.bottom, DS.Space.xs)
                content
            }
            .frame(maxWidth: 820, alignment: .leading)
            // under the tabs (a narrow window, the largest text): no sidebar margins to line up with
            .padding(.horizontal, sizeClass == .compact || typeSize.isAccessibilitySize ? 0 : DS.Space.xxl)
            .padding(.top, sizeClass == .compact || typeSize.isAccessibilitySize ? DS.Space.s : 84)
            .padding(.bottom, DS.Space.xxxl)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// A paper card with a headline.
struct AreaCard<Content: View>: View {
    let title: String?
    let content: Content

    init(_ title: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        Card(.paper) {
            if let title {
                Text(title)
                    .dsFont(.headline)
                    .foregroundStyle(DS.Color.ink)
                    .accessibilityAddTraits(.isHeader)
            }
            content
        }
    }
}

/// A number and what it counts, on chalk (Progress, the weekly report).
struct StatTile: View {
    let value: String
    let label: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value)
                .dsFont(.bigNumber, size: 40)
                .foregroundStyle(DS.Color.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(label)
                .dsFont(.caption)
                .foregroundStyle(DS.Color.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(DS.Space.m)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: DS.Radius.tile, style: .continuous).fill(DS.Color.surfaceSunken))
        .accessibilityElement(children: .combine)
    }
}

/// Loading and error states inside a page.
struct AreaStatus: View {
    let loading: Bool
    let error: String?
    let retry: () -> Void

    var body: some View {
        if loading {
            ProgressView()
                .tint(DS.Color.ink)
                .controlSize(.large)
                .frame(maxWidth: .infinity, minHeight: 240)
        } else if let error {
            EmptyState(.icon(.offline, .sunny), title: "This didn't load", message: error,
                       actionTitle: "Try again", actionIcon: .retry, action: retry)
                .frame(maxWidth: .infinity)
        }
    }
}
