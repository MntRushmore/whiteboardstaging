import AgathonDesign
import AgathonKit
import SwiftUI

/// The weekly report (src/app/(platform)/report): each kid's week in numbers, what they practiced,
/// what to try next week, and the Monday email switch.
struct WeeklyReportPage: View {
    enum Week: String, Hashable { case this, last }

    @Environment(AgathonBackend.self) private var backend
    @State private var week: Week = .this
    @State private var answer: ReportAnswer?
    @State private var loading = true
    @State private var error: String?
    @State private var emailOn = true

    private var reports: ReportsService { ReportsService(api: backend.api, client: backend.supabase) }

    var body: some View {
        AreaPage("Weekly report", subtitle: rangeText) {
            SegmentedPicker(selection: $week, options: [(Week.this, "This week"), (Week.last, "Last week")])
                .frame(maxWidth: 360)
                .onChange(of: week) { Task { await load() } }
            AreaStatus(loading: loading && answer == nil, error: answer == nil ? error : nil) { Task { await load() } }
            if let answer {
                if answer.report.children.isEmpty {
                    EmptyState(.icon(.family, .sunny), title: "No kids yet",
                               message: "Add a kid on the Family page. Their week shows up here every Monday.")
                        .frame(maxWidth: .infinity)
                }
                ForEach(answer.report.children) { child in
                    ChildWeekCard(child: child)
                }
                if let email = answer.email, email.sending {
                    AreaCard("The Monday email") {
                        Toggle(isOn: Binding(get: { emailOn }, set: { setEmail($0) })) {
                            Text("Send me this report every Monday").dsFont(.callout).foregroundStyle(DS.Color.ink)
                        }
                        .tint(DS.Color.ink)
                        .frame(minHeight: DS.Size.minTarget)
                        .accessibilityIdentifier("report.email")
                    }
                }
            }
        }
        .task { await load() }
        .accessibilityIdentifier("report.page")
    }

    private var rangeText: String? {
        guard let start = answer?.report.weekStart else { return "Monday to Sunday" }
        let end = LocalDay.adding(6, to: start)
        return "Monday to Sunday · \(Self.short(start)) to \(Self.short(end))"
    }

    static func short(_ day: String) -> String {
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return day }
        let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        return "\(months[max(0, min(11, parts[1] - 1))]) \(parts[2])"
    }

    private func load() async {
        loading = true
        defer { loading = false }
        let monday = LocalDay.monday(of: LocalDay.of(Date()))
        let start = week == .this ? nil : LocalDay.adding(-7, to: monday)
        do {
            answer = try await reports.weeklyReport(week: start)
            emailOn = !(answer?.email?.optedOut ?? false)
            error = nil
        } catch {
            answer = nil
            self.error = userMessage(for: error)
        }
    }

    private func setEmail(_ on: Bool) {
        emailOn = on
        Task {
            if let saved = try? await AccountService(api: backend.api, client: backend.supabase).setWeeklyReportOptOut(!on) {
                emailOn = !saved
            }
        }
    }
}

/// One kid's week.
struct ChildWeekCard: View {
    let child: ChildWeek

    var body: some View {
        AreaCard {
            HStack(spacing: DS.Space.m) {
                Avatar(child.displayName, color: AvatarColor.color(avatar: child.avatar), diameter: 56)
                VStack(alignment: .leading, spacing: 2) {
                    Text(child.displayName).dsFont(.headline).foregroundStyle(DS.Color.ink)
                    Text(child.grade.map(GradePath.gradeName) ?? "High school / not sure")
                        .dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
                }
            }
            if child.problems == 0 {
                Text("A quiet week for \(child.displayName).")
                    .dsFont(.body).foregroundStyle(DS.Color.ink)
                Text("A few problems a day keeps the streak going. Today's practice takes about 10 minutes.")
                    .dsFont(.callout).foregroundStyle(DS.Color.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: DS.Space.s)], spacing: DS.Space.s) {
                    StatTile(value: "\(child.problems)", label: "Problems")
                    StatTile(value: "\(child.independent)", label: "On their own")
                    StatTile(value: "\(child.minutes)", label: "Minutes")
                    StatTile(value: "\(child.activeDays)", label: "Days active")
                    StatTile(value: "\(child.streak)", label: "Day streak")
                }
                if let days = child.days, days.count == 7 {
                    weekStrip(days)
                }
                if !child.newlyMastered.isEmpty {
                    section("New this week")
                    FlowStack(spacing: DS.Space.xs, lineSpacing: DS.Space.xs) {
                        ForEach(child.newlyMastered, id: \.self) { Tag($0, style: .sunny) }
                    }
                }
                if !child.practised.isEmpty {
                    section("What they practiced")
                    ForEach(child.practised, id: \.skill) { item in
                        HStack {
                            Text(item.name).dsFont(.callout).foregroundStyle(DS.Color.ink)
                            Spacer()
                            Text("\(item.independent) of \(item.problems) on their own")
                                .dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
            if let focus = child.focus {
                section("Next week, try")
                Text(focus.name).dsFont(.button, size: 18).foregroundStyle(DS.Color.ink)
                Text(focus.tip).dsFont(.callout).foregroundStyle(DS.Color.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityIdentifier("report.child.\(child.displayName)")
    }

    private func section(_ title: String) -> some View {
        Text(title).dsFont(.label).foregroundStyle(DS.Color.inkSecondary).padding(.top, DS.Space.xs)
            .accessibilityAddTraits(.isHeader)
    }

    private func weekStrip(_ days: [Int]) -> some View {
        let top = max(days.max() ?? 0, 3)
        let letters = ["M", "T", "W", "T", "F", "S", "S"]
        return HStack(alignment: .bottom, spacing: DS.Space.s) {
            ForEach(0 ..< 7, id: \.self) { i in
                VStack(spacing: 6) {
                    Capsule()
                        .fill(days[i] > 0 ? DS.Color.ink : DS.Color.surfaceSunken)
                        .frame(width: 18, height: days[i] > 0 ? max(10, 60 * CGFloat(days[i]) / CGFloat(top)) : 6)
                    Text(letters[i]).dsFont(.caption, size: 12).foregroundStyle(DS.Color.inkSecondary)
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement()
                .accessibilityLabel("\(letters[i]): \(days[i]) problems")
            }
        }
        .frame(height: 90, alignment: .bottom)
    }
}
