import AgathonDesign
import AgathonKit
import SwiftUI

// MARK: - Overview

/// The web overview's numbers: services, errors, people, money, the funnel, the AI routes.
struct AdminOverviewView: View {
    let data: any AdminData
    @StateObject private var load = AdminLoad<AdminOverview>()
    private let grid = [GridItem(.adaptive(minimum: 170), spacing: 12)]

    var body: some View {
        ScrollView {
            if let o = load.value {
                VStack(alignment: .leading, spacing: 16) {
                    AdminCard("People") {
                        LazyVGrid(columns: grid, spacing: 12) {
                            AdminStat(label: "Accounts", value: "\(o.users.total)")
                            AdminStat(label: "Active today", value: "\(o.users.active24h)")
                            AdminStat(label: "Active this week", value: "\(o.users.active7d)")
                            AdminStat(label: "Sign-ups today", value: "\(o.users.signups24h)")
                            AdminStat(label: "Sign-ups this week", value: "\(o.users.signups7d)")
                            if let l = o.learning { AdminStat(label: "Problems today (solved alone)", value: "\(l.attempts24h) (\(l.solvedAlone24h))") }
                        }
                    }
                    if let m = o.money {
                        AdminCard("Money") {
                            LazyVGrid(columns: grid, spacing: 12) {
                                AdminStat(label: "MRR", value: AdminText.usd(m.mrrUsd), tone: DS.Color.success)
                                AdminStat(label: "Paying (cancelling)", value: "\(m.paying) (\(m.payingCancelling))")
                                AdminStat(label: "In trial (cancelling)", value: "\(m.trialing) (\(m.trialsCancelling))")
                                AdminStat(label: "If trials convert", value: AdminText.usd(m.pipelineUsd))
                                AdminStat(label: "Charges failing", value: "\(m.failing)", tone: m.failing > 0 ? DS.Color.tomato : DS.Color.ink)
                                AdminStat(label: "Trials converted", value: "\(m.trialsConverted) of \(m.trialsOver)")
                            }
                        }
                    }
                    if let f = o.funnel {
                        AdminCard("Funnel") {
                            LazyVGrid(columns: grid, spacing: 12) {
                                AdminStat(label: "Accounts", value: "\(f.accounts)")
                                AdminStat(label: "Finished the welcome", value: "\(f.onboarded)")
                                AdminStat(label: "Started a trial", value: "\(f.trials)")
                                AdminStat(label: "Paying", value: "\(f.paying)")
                            }
                        }
                    }
                    AdminCard("Services") {
                        ForEach(o.services, id: \.service) { s in
                            HStack {
                                AdminChip(text: s.ok == nil ? "unchecked" : (s.ok! ? "up" : "down"), tone: AdminChip.tone(s.ok == false ? "down" : (s.ok == true ? "up" : "")))
                                Text(s.service).font(.ds(.callout)).foregroundStyle(DS.Color.ink)
                                Spacer()
                                if let u = s.uptime24h { Text(String(format: "%.1f%% today", u * 100)).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary) }
                                if let ms = s.latencyMs { Text("\(Int(ms)) ms").dsFont(.caption).foregroundStyle(DS.Color.inkSecondary) }
                            }
                        }
                        if let or = o.openrouter {
                            AdminPair("OpenRouter credit", AdminText.usd(or.creditsLeftUsd))
                        }
                    }
                    AdminCard("Errors, last 24 h — \(o.errors.total24h) for \(o.errors.users24h) people") {
                        ForEach(o.errors.groups.prefix(15), id: \.self) { g in
                            HStack(alignment: .top) {
                                AdminChip(text: "\(g.count)×", tone: AdminChip.tone(g.level))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("\(g.kind)\(g.code.map { " · \($0)" } ?? "")").font(.system(size: 13, weight: .semibold, design: .monospaced))
                                    Text(g.message).dsFont(.callout).lineLimit(2)
                                    Text("\(g.users) people · last \(AdminText.ago(g.lastAt))").dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
                                }
                            }
                        }
                    }
                    if let ai = o.ai, !ai.routes.isEmpty {
                        AdminCard("AI routes, last 24 h") {
                            ForEach(ai.routes, id: \.self) { r in
                                HStack {
                                    Text(r.route).font(.system(size: 13, design: .monospaced))
                                    Spacer()
                                    Text("\(r.calls24h) calls").dsFont(.caption)
                                    if r.failures24h > 0 { AdminChip(text: "\(r.failures24h) failed", tone: DS.Color.tomato) }
                                }
                            }
                        }
                    }
                    Text("Updated \(AdminText.ago(o.generatedAt))").dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
                }
                .padding(20)
            } else {
                AdminLoadState(loading: load.loading, error: load.error) { Task { await reload() } }
            }
        }
        .background(DS.Color.ground)
        .navigationTitle("Overview")
        .refreshable { await reload() }
        .task { if load.value == nil { await reload() } }
    }

    private func reload() async { await load.run { try await data.overview() } }
}

// MARK: - Users

struct AdminUsersView: View {
    let data: any AdminData
    @StateObject private var load = AdminLoad<AdminUserList>()
    @State private var search = ""

    private var shown: [AdminUserRow] {
        let all = load.value?.users ?? []
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return all }
        return all.filter { ($0.email ?? "").lowercased().contains(q) || ($0.name ?? "").lowercased().contains(q) || $0.id.hasPrefix(q) }
    }

    var body: some View {
        List {
            if load.value == nil { AdminLoadState(loading: load.loading, error: load.error) { Task { await reload() } } }
            ForEach(shown) { u in
                NavigationLink(value: u.id) {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(u.email ?? u.name ?? u.id).font(.ds(.callout)).foregroundStyle(DS.Color.ink)
                            Text("\(u.name ?? "—") · \(u.boards) boards · \(u.attempts7d) problems this week · active \(AdminText.ago(u.lastActiveAt))")
                                .dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
                        }
                        Spacer()
                        if u.isAdmin { AdminChip(text: "admin", tone: DS.Color.tutorInk) }
                        AdminChip(text: u.plan, tone: AdminChip.tone(u.plan))
                        if u.errors7d > 0 { AdminChip(text: "\(u.errors7d) errors", tone: DS.Color.tomato) }
                    }
                }
            }
        }
        .searchable(text: $search, prompt: "Email, name or id")
        .navigationTitle(load.value.map { "Users (\($0.total))" } ?? "Users")
        .navigationDestination(for: String.self) { id in AdminUserDetailView(data: data, id: id) }
        .refreshable { await reload() }
        .task { if load.value == nil { await reload() } }
    }

    private func reload() async { await load.run { try await data.users() } }
}

struct AdminUserDetailView: View {
    let data: any AdminData
    let id: String
    @StateObject private var load = AdminLoad<AdminUserDetail>()

    var body: some View {
        ScrollView {
            if let d = load.value {
                VStack(alignment: .leading, spacing: 16) {
                    AdminCard("Account") {
                        AdminPair("Email", d.user.email)
                        AdminPair("Name", d.user.name)
                        AdminPair("Course", d.user.course)
                        AdminPair("Plan", d.user.plan)
                        AdminPair("Trial ends", d.user.trialEndsAt.map(AdminText.stamp))
                        AdminPair("Joined", AdminText.stamp(d.user.createdAt))
                        AdminPair("Last active", AdminText.ago(d.user.lastActiveAt))
                        AdminPair("AI calls this week", "\(d.user.aiCalls7d)")
                        AdminPair("User id", d.user.id)
                        if let s = d.subscription {
                            AdminPair("Subscription", "\(s.status)\(s.cancelAtPeriodEnd ? " (cancelling)" : "")")
                            AdminPair("Renews / ends", s.currentPeriodEnd.map(AdminText.stamp))
                        }
                    }
                    if let l = d.learning {
                        AdminCard("Learning") {
                            HStack(spacing: 12) {
                                AdminStat(label: "Problems", value: "\(l.attempts)")
                                AdminStat(label: "Solved alone", value: "\(l.solvedAlone)", tone: DS.Color.success)
                                AdminStat(label: "With help", value: "\(l.withHelp)")
                                AdminStat(label: "Minutes", value: "\(l.activeMinutes)")
                            }
                            ForEach(l.skills.prefix(10), id: \.self) { s in
                                AdminPair(s.skill, "\(s.solvedAlone) of \(s.attempts) alone")
                            }
                        }
                    }
                    AdminCard("Boards") {
                        ForEach(d.boards) { b in
                            NavigationLink { AdminBoardDetailView(data: data, id: b.id) } label: { AdminBoardRowView(board: b) }
                        }
                        if d.boards.isEmpty { Text("No boards.").dsFont(.caption).foregroundStyle(DS.Color.inkSecondary) }
                    }
                    if !d.bugs.isEmpty {
                        AdminCard("Bug reports") {
                            ForEach(d.bugs) { b in
                                NavigationLink { AdminBugDetailView(data: data, bug: b) } label: { AdminBugRowView(bug: b) }
                            }
                        }
                    }
                    AdminCard("Recent events") {
                        ForEach(d.events.prefix(40)) { AdminEventRow(event: $0) }
                    }
                }
                .padding(20)
            } else {
                AdminLoadState(loading: load.loading, error: load.error) { Task { await reload() } }
            }
        }
        .background(DS.Color.ground)
        .navigationTitle(load.value?.user.email ?? "User")
        .refreshable { await reload() }
        .task { if load.value == nil { await reload() } }
    }

    private func reload() async { await load.run { try await data.user(id) } }
}

// MARK: - Issues

struct AdminIssuesView: View {
    let data: any AdminData
    @StateObject private var load = AdminLoad<AdminIssueList>()
    @State private var days = 7

    var body: some View {
        List {
            Picker("Window", selection: $days) {
                Text("Today").tag(1)
                Text("7 days").tag(7)
                Text("30 days").tag(30)
            }
            .pickerStyle(.segmented)
            if load.value == nil { AdminLoadState(loading: load.loading, error: load.error) { Task { await reload() } } }
            ForEach(load.value?.issues ?? []) { i in
                NavigationLink { AdminIssueDetailView(issue: i) } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            AdminChip(text: "\(i.count)×", tone: AdminChip.tone(i.level))
                            AdminChip(text: i.status, tone: AdminChip.tone(i.status))
                            if i.regressed { AdminChip(text: "regressed", tone: DS.Color.tomato) }
                            if i.noise { AdminChip(text: "noise") }
                            Text(i.kind).font(.system(size: 13, weight: .semibold, design: .monospaced))
                            Spacer()
                            Text(AdminText.ago(i.lastAt)).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
                        }
                        Text(i.message).dsFont(.callout).lineLimit(2)
                        Text("\(i.users) people · \(i.boards) boards · \(i.source)").dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
                    }
                }
            }
        }
        .navigationTitle("Issues")
        .refreshable { await reload() }
        .task(id: days) { await reload() }
    }

    private func reload() async { let d = days; await load.run { try await data.issues(days: d) } }
}

struct AdminIssueDetailView: View {
    let issue: AdminIssue

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                AdminCard("Issue") {
                    AdminPair("Kind", issue.kind)
                    AdminPair("Code", issue.code)
                    AdminPair("Source", issue.source)
                    AdminPair("Status", issue.status + (issue.regressed ? " (regressed)" : ""))
                    AdminPair("Count", "\(issue.count) · \(issue.users) people · \(issue.boards) boards")
                    AdminPair("First seen", AdminText.stamp(issue.firstAt))
                    AdminPair("Last seen", AdminText.stamp(issue.lastAt))
                    AdminPair("Note", issue.note)
                    Text(issue.message).dsFont(.callout).textSelection(.enabled)
                }
                AdminCard("Per day") {
                    let top = max(1, issue.perDay.max() ?? 1)
                    HStack(alignment: .bottom, spacing: 3) {
                        ForEach(Array(issue.perDay.enumerated()), id: \.offset) { _, n in
                            RoundedRectangle(cornerRadius: 2).fill(n > 0 ? DS.Color.tomato : DS.Color.line)
                                .frame(height: max(3, CGFloat(n) / CGFloat(top) * 60))
                        }
                    }
                    .frame(height: 64, alignment: .bottom)
                }
                AdminCard("Latest") {
                    ForEach(issue.samples) { AdminEventRow(event: $0) }
                }
            }
            .padding(20)
        }
        .background(DS.Color.ground)
        .navigationTitle("Issue")
    }
}

// MARK: - Picture tutor runs

struct AdminRunsView: View {
    let data: any AdminData
    let boardId: String?
    @StateObject private var load = AdminLoad<AdminRunList>()

    var body: some View {
        List {
            if load.value == nil { AdminLoadState(loading: load.loading, error: load.error) { Task { await reload() } } }
            ForEach(load.value?.runs ?? []) { AdminRunRow(run: $0) }
        }
        .navigationTitle(boardId == nil ? "Picture tutor runs" : "This board's runs")
        .refreshable { await reload() }
        .task { if load.value == nil { await reload() } }
    }

    private func reload() async { let b = boardId; await load.run { try await data.runs(boardId: b, limit: 150) } }
}

/// One run: its outcome, mode, model, timings, cost and flags.
struct AdminRunRow: View {
    let run: AdminEvent

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                AdminChip(text: run.code ?? run.kind, tone: AdminChip.tone(run.code ?? ""))
                if run.kind == "board_draw" {
                    Text(run.text("mode") ?? "—").font(.system(size: 13, weight: .semibold))
                    Text((run.text("tutorModel") ?? "").replacingOccurrences(of: "google/", with: ""))
                        .font(.system(size: 12, design: .monospaced)).foregroundStyle(DS.Color.inkSecondary)
                } else {
                    Text("outcome").font(.system(size: 13)).foregroundStyle(DS.Color.inkSecondary)
                }
                Spacer()
                Text(AdminText.ago(run.at)).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
            }
            if run.kind == "board_draw" {
                HStack(spacing: 10) {
                    if let ms = run.number("totalMs") { Text(String(format: "%.1f s", ms / 1000)).dsFont(.caption) }
                    if let c = run.number("costUsd") { Text(String(format: "$%.3f", c)).dsFont(.caption) }
                    if let a = run.number("alignScore") {
                        Text(String(format: "align %.2f", a)).dsFont(.caption).foregroundStyle(a < 0.7 ? DS.Color.tomato : DS.Color.inkSecondary)
                    }
                    if let s = run.text("strokes") { Text("\(s) strokes").dsFont(.caption) }
                    if run.flag("misaligned") { AdminChip(text: "misaligned", tone: DS.Color.tomato) }
                    if run.number("paints") == 2 { AdminChip(text: "repainted", tone: DS.Color.streak) }
                    if run.flag("tutorRechecked") { AdminChip(text: "rechecked", tone: DS.Color.streak) }
                    if run.flag("correct") { AdminChip(text: "correct ✓", tone: DS.Color.success) }
                    if let simple = run.text("simple") { AdminChip(text: "wrote \(simple)", tone: DS.Color.tutorInk) }
                }
                .foregroundStyle(DS.Color.inkSecondary)
            }
            HStack(spacing: 10) {
                if let e = run.userEmail { Text(e).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary) }
                if let b = run.boardId { Text("board \(b.prefix(8))").font(.system(size: 11, design: .monospaced)).foregroundStyle(DS.Color.inkSecondary) }
                if let r = run.release { Text(r).font(.system(size: 11, design: .monospaced)).foregroundStyle(DS.Color.inkSecondary) }
            }
        }
        .padding(.vertical, 2)
    }
}
