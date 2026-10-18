import AgathonDesign
import AgathonKit
import SwiftUI

/// The bug reports this person sent and the team's replies (the web's /reports), plus sending a
/// new one. Replies are marked read when the page opens.
struct BugReportsPage: View {
    @Environment(AgathonBackend.self) private var backend
    @State private var reports: [BugReport]?
    @State private var loading = true
    @State private var error: String?
    @State private var filing = false

    private var service: ReportsService { ReportsService(api: backend.api, client: backend.supabase) }

    var body: some View {
        AreaPage("Bug reports", subtitle: "Something not working? Tell us. We read every one.") {
            PillButton("Report a problem", icon: .bug, kind: .primary) { filing = true }
                .fixedSize()
                .accessibilityIdentifier("bugs.new")
            AreaStatus(loading: loading && reports == nil, error: reports == nil ? error : nil) { Task { await load() } }
            if let reports {
                if reports.isEmpty {
                    Text("No reports yet.").dsFont(.callout).foregroundStyle(DS.Color.inkSecondary)
                }
                ForEach(reports) { report in
                    BugReportCard(report: report) { await load() }
                }
            }
        }
        .task {
            await load()
            try? await service.markBugRepliesSeen()
        }
        .sheet(isPresented: $filing) {
            NewBugReportSheet { await load() }.environment(backend)
        }
        .accessibilityIdentifier("bugs.page")
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            reports = try await service.myBugReports()
            error = nil
        } catch {
            self.error = userMessage(for: error)
        }
    }
}

private struct BugReportCard: View {
    let report: BugReport
    let replied: () async -> Void

    @Environment(AgathonBackend.self) private var backend
    @State private var reply = ""
    @State private var sending = false
    @State private var note: String?

    var body: some View {
        AreaCard {
            HStack(alignment: .firstTextBaseline) {
                Text(report.createdAt.map { HomeFormat.edited($0).replacingOccurrences(of: "Edited", with: "Sent") } ?? "Sent")
                    .dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
                Spacer()
                Tag(report.statusWords, style: report.status == "fixed" ? .sunny : .chalk)
            }
            Text(report.message ?? "(no words, just the report)")
                .dsFont(.body).foregroundStyle(DS.Color.ink)
                .fixedSize(horizontal: false, vertical: true)
            ForEach(report.thread) { message in
                VStack(alignment: message.fromAgathon ? .leading : .trailing, spacing: 2) {
                    Text(message.fromAgathon ? "Agathon" : "You").dsFont(.caption, size: 12).foregroundStyle(DS.Color.inkSecondary)
                    Text(message.body)
                        .dsFont(.callout)
                        .foregroundStyle(message.fromAgathon ? DS.Color.onInk : DS.Color.ink)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .background(RoundedRectangle(cornerRadius: DS.Radius.bubble, style: .continuous)
                            .fill(message.fromAgathon ? DS.Color.ink : DS.Color.surfaceSunken))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: message.fromAgathon ? .leading : .trailing)
                .accessibilityElement(children: .combine)
            }
            if !report.thread.isEmpty {
                HStack(spacing: DS.Space.s) {
                    PillField("Write back", text: $reply)
                    PillButton(sending ? "Sending…" : "Send", icon: .send, kind: .primary, action: send)
                        .fixedSize()
                        .disabled(sending || reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                if let note { Text(note).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary) }
            }
        }
    }

    private func send() {
        sending = true
        Task {
            defer { sending = false }
            do {
                try await ReportsService(api: backend.api, client: backend.supabase).reply(to: report.id, body: reply)
                reply = ""
                note = "Sent. We'll read it soon."
                await replied()
            } catch {
                note = "That didn't send. Try again in a moment."
            }
        }
    }
}

/// "Report a problem": a few words, sent with what the app knows (version, device, screen).
struct NewBugReportSheet: View {
    var boardId: String?
    let sent: () async -> Void

    @Environment(AgathonBackend.self) private var backend
    @Environment(\.dismiss) private var dismiss
    @State private var message = ""
    @State private var busy = false
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.l) {
            SheetHeader("Report a problem", onClose: { dismiss() })
            Text("What happened? (optional)").dsFont(.button, size: 16).foregroundStyle(DS.Color.ink)
            TextField("", text: $message, prompt: Text("The pen stopped drawing when…").foregroundStyle(DS.Color.inkSecondary), axis: .vertical)
                .lineLimit(4 ... 8)
                .font(.ds(.callout))
                .foregroundStyle(DS.Color.ink)
                .padding(DS.Space.m)
                .background(RoundedRectangle(cornerRadius: DS.Radius.tile, style: .continuous).fill(DS.Color.surfaceSunken))
                .accessibilityIdentifier("bugs.message")
            if let problem { Banner(.lookAgain, problem) }
            HStack(spacing: DS.Space.s) {
                Button { dismiss() } label: { Text("Cancel").frame(maxWidth: .infinity) }
                    .buttonStyle(.pill(.secondaryOnPaper, size: .large))
                Button(action: send) { Text(busy ? "Sending…" : "Send report").frame(maxWidth: .infinity) }
                    .buttonStyle(.pill(.primary, size: .large))
                    .disabled(busy)
                    .accessibilityIdentifier("bugs.send")
            }
        }
        .blocksSheet()
        .interactiveDismissDisabled(busy)
    }

    private func send() {
        busy = true
        let device = UIDevice.current
        let diagnostics = [
            "platform": "ios",
            "release": backend.release.string,
            "device": device.model,
            "system": "\(device.systemName) \(device.systemVersion)",
            "locale": Locale.current.identifier,
        ]
        Task {
            defer { busy = false }
            do {
                try await ReportsService(api: backend.api, client: backend.supabase)
                    .fileBugReport(message: message, boardId: boardId, diagnostics: diagnostics)
                await sent()
                dismiss()
            } catch {
                problem = "That didn't send. Try again in a moment."
            }
        }
    }
}
