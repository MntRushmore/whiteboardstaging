import AgathonDesign
import AgathonKit
import AgathonLive
import SwiftUI

/// The Training Center (admins only: Account → Training Center; Labs in a Debug build): where the owner
/// brute-tests the tutor with real maths. MY PENCIL first (the owner's own handwriting), the AUTO
/// BENCH (synthetic hands at scale), and the runs so far with their results.
struct TrainingCenterView: View {
    let close: () -> Void
    @Environment(AgathonBackend.self) private var backend
    @State private var open: Open?
    @State private var local: [TrainingRun] = []
    @State private var remote: [TrainingRepository.RunRow] = []
    @State private var remoteNote: String?
    @State private var showSetup = false
    /// `is_admin()`: nil while asking
    @State private var admin: Bool?

    enum Open: Identifiable {
        case pencil
        case bench(TrainingConfig)
        case results(TrainingRun)

        var id: String {
            switch self {
            case .pencil: return "pencil"
            case .bench(let c): return "bench-\(c.hashValue)"
            case .results(let r): return "results-\(r.id)"
            }
        }
    }

    var body: some View {
        ZStack {
            DS.Color.ground.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.xl) {
                    header
                    if admin == false {
                        EmptyState(.icon(.lock, .sunny), title: "For admins only",
                                   message: "The Training Center calls the real tutor on the house: it opens for admins (sign in as one).")
                            .accessibilityIdentifier("training.notAdmin")
                    } else if admin == true {
                        pencilCard
                        benchCard
                        runsCard
                    } else {
                        ProgressView().controlSize(.large).frame(maxWidth: .infinity, minHeight: 200)
                    }
                }
                .frame(maxWidth: 900, alignment: .leading)
                .padding(.horizontal, DS.Space.xxl)
                .padding(.vertical, DS.Space.l)
                .frame(maxWidth: .infinity)
            }
        }
        .task {
            #if DEBUG
            await signInIfAsked()
            #endif
            admin = await TrainingSync.isAdmin(backend)
            await reload()
            #if DEBUG
            // `-trainingOpen pencil|bench`: straight in (the UI tests)
            let args = ProcessInfo.processInfo.arguments
            if admin == true, let i = args.firstIndex(of: "-trainingOpen"), i + 1 < args.count {
                if args[i + 1] == "pencil" { open = .pencil } else if args[i + 1] == "bench" { showSetup = true }
            }
            #endif
        }
        .fullScreenCover(item: $open, onDismiss: { Task { await reload() } }) { which in
            Group {
                switch which {
                case .pencil:
                    MyPencilView { open = nil }
                case .bench(let config):
                    BenchRunView(config: config) { open = nil }
                case .results(let run):
                    TrainingResultsView(run: run, close: { open = nil })
                }
            }
            .environment(backend)
        }
        .sheet(isPresented: $showSetup) {
            BenchSetupView { config in
                showSetup = false
                open = .bench(config)
            } cancel: {
                showSetup = false
            }
            .environment(backend)
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: DS.Space.m) {
            RoundButton(.close, label: "Close the Training Center", action: close)
                .accessibilityIdentifier("training.close")
            VStack(alignment: .leading, spacing: 2) {
                Text("Training Center").dsFont(.display, size: 44).foregroundStyle(DS.Color.ink)
                Text("Brute-test the tutor with real maths: your Pencil, or a bench of synthetic hands.")
                    .dsFont(.body).foregroundStyle(DS.Color.inkSecondary)
            }
            Spacer()
            TrainingPill(text: TrainingSync.isProduction(backend) ? "Production · \(TrainingSync.target(backend))" : "Local · \(TrainingSync.target(backend))",
                         tint: DS.Color.onInk, fill: TrainingSync.isProduction(backend) ? DS.Color.tomato : DS.Color.cobalt)
                .accessibilityIdentifier("training.target")
        }
    }

    private var pencilCard: some View {
        Card(.cobalt) {
            VStack(alignment: .leading, spacing: DS.Space.s) {
                Text("My Pencil").dsFont(.title).foregroundStyle(DS.Color.onInk)
                Text("Write problems and work with the Apple Pencil, in any handwriting. Tag the handwriting, then 👍 or 👎 each line the tutor answers, and say what it should have done. Every page is saved as a training case.")
                    .dsFont(.body).foregroundStyle(DS.Color.onInk)
                    .fixedSize(horizontal: false, vertical: true)
                PillButton("Start writing", icon: .pen, kind: .sunny) { open = .pencil }
                    .fixedSize()
                    .accessibilityIdentifier("training.pencil")
            }
        }
    }

    private var benchCard: some View {
        Card(.paper) {
            VStack(alignment: .leading, spacing: DS.Space.s) {
                Text("Auto bench").dsFont(.title).foregroundStyle(DS.Color.ink)
                Text("\(TrainingCatalogue.all.count) cases of how kids really write (running totals, = on the next line, true steps, fractions, stacked sums, long division, their own tick…) plus the brain's practice problems, right and deliberately wrong, written in synthetic hands on real problem pages, judged by the real tutor.")
                    .dsFont(.body).foregroundStyle(DS.Color.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                PillButton("Set up a bench", icon: .play, kind: .primary) { showSetup = true }
                    .fixedSize()
                    .accessibilityIdentifier("training.bench")
            }
        }
    }

    private var runsCard: some View {
        Card(.paper) {
            VStack(alignment: .leading, spacing: DS.Space.s) {
                Text("Runs").dsFont(.title).foregroundStyle(DS.Color.ink)
                if local.isEmpty && remote.isEmpty {
                    Text("No runs yet.").dsFont(.body).foregroundStyle(DS.Color.inkSecondary)
                }
                ForEach(local) { run in
                    Button { open = .results(run) } label: { RunRow(run: run) }
                        .buttonStyle(.plain)
                }
                let others = remote.filter { row in !local.contains { $0.id.uuidString.lowercased() == row.id } }
                if !others.isEmpty {
                    Text("From other devices").dsFont(.label).foregroundStyle(DS.Color.inkSecondary).padding(.top, DS.Space.s)
                    ForEach(others, id: \.id) { row in
                        Button { Task { await openRemote(row) } } label: { RemoteRunRow(row: row) }
                            .buttonStyle(.plain)
                    }
                }
                if let remoteNote {
                    Text(remoteNote).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
                }
            }
        }
    }

    #if DEBUG
    /// Debug (the UI tests, the simulator): AGATHON_TEST_EMAIL / AGATHON_TEST_PASSWORD sign that user in
    /// when signed out (as the Live Lab does).
    private func signInIfAsked() async {
        let env = ProcessInfo.processInfo.environment
        guard let email = env["AGATHON_TEST_EMAIL"], let password = env["AGATHON_TEST_PASSWORD"] else { return }
        if backend.auth.phase == .signedIn {
            if backend.auth.email?.lowercased() == email.lowercased() { return }
            try? await backend.auth.signOut(scope: .local)
        }
        try? await backend.auth.signIn(email: email, password: password)
    }
    #endif

    private func reload() async {
        // a session left before its first page (or a bench stopped before its first case) is no run
        local = TrainingStore.shared.all().filter { !$0.cases.isEmpty }
        do {
            remote = try await TrainingRepository(client: backend.supabase).runs()
            remoteNote = nil
        } catch {
            remote = []
            remoteNote = TrainingRepository.isMissingTable(error)
                ? "The training tables are not on this server yet: runs are kept on this iPad."
                : "Couldn't read the server's runs."
        }
    }

    private func openRemote(_ row: TrainingRepository.RunRow) async {
        guard let rows = try? await TrainingRepository(client: backend.supabase).cases(run: row.id) else { return }
        var run = TrainingRun(id: UUID(uuidString: row.id) ?? UUID(), kind: TrainingKind(rawValue: row.kind) ?? .bench,
                              status: TrainingRun.Status(rawValue: row.status) ?? .done, target: row.target, appBuild: row.app_build)
        run.cases = rows.compactMap(TrainingSync.result)
        run.synced = true
        open = .results(run)
    }
}

private struct RunRow: View {
    let run: TrainingRun

    var body: some View {
        let s = run.summary
        HStack(spacing: DS.Space.m) {
            Text(run.kind == .bench ? "Bench" : "Pencil")
                .dsFont(.label)
                .foregroundStyle(DS.Color.onInk)
                .padding(.horizontal, 10)
                .frame(minHeight: 28)
                .background(Capsule().fill(run.kind == .bench ? DS.Color.ink : DS.Color.cobalt))
            VStack(alignment: .leading, spacing: 2) {
                Text(run.startedAt.formatted(date: .abbreviated, time: .shortened)).dsFont(.button, size: 17).foregroundStyle(DS.Color.ink)
                Text("\(run.target) · \(run.status.rawValue)\(run.synced ? "" : " · on this iPad")")
                    .dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
            }
            Spacer()
            Text(s.lines > 0 ? "\(s.linesPassed)/\(s.lines) lines" : "\(run.cases.count) pages")
                .dsFont(.button, size: 17).foregroundStyle(DS.Color.ink)
            if let rate = s.lineRate { Text("\(Int((rate * 100).rounded()))%").dsFont(.headline).foregroundStyle(DS.Color.ink) }
        }
        .padding(DS.Space.s)
        .background(RoundedRectangle(cornerRadius: DS.Radius.tile, style: .continuous).fill(DS.Color.surfaceSunken))
        .contentShape(Rectangle())
    }
}

private struct RemoteRunRow: View {
    let row: TrainingRepository.RunRow

    var body: some View {
        let lines = row.totals["lines"]?.doubleValue ?? 0
        let passed = row.totals["linesPassed"]?.doubleValue ?? 0
        HStack {
            Text(row.kind == "bench" ? "Bench" : "Pencil").dsFont(.label).foregroundStyle(DS.Color.ink)
            Text(row.created_at?.prefix(16).replacingOccurrences(of: "T", with: " ") ?? "").dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
            Spacer()
            Text(lines > 0 ? "\(Int(passed))/\(Int(lines)) lines" : row.status).dsFont(.button, size: 15).foregroundStyle(DS.Color.ink)
        }
        .padding(DS.Space.s)
        .background(RoundedRectangle(cornerRadius: DS.Radius.tile, style: .continuous).fill(DS.Color.surfaceSunken))
    }
}
