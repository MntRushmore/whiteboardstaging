import AgathonDesign
import AgathonKit
import AgathonLive
import SwiftUI

/// Setting up an AUTO BENCH run: which grades and kinds of writing, how many cases, which synthetic
/// hands, how fast the "kid" writes, when the tutor checks, right and wrong solutions, and the call
/// budget the run may not pass. Before it starts, the server is asked whether it takes training calls
/// (no ink); a server that does not would charge the admin's ink, and says so.
struct BenchSetupView: View {
    let start: (TrainingConfig) -> Void
    let cancel: () -> Void
    @Environment(AgathonBackend.self) private var backend
    @State private var config = BenchSetupView.saved
    @State private var status: StatusCheck = .checking
    @State private var spendInk = false

    enum StatusCheck: Equatable {
        case checking
        case on
        case missing
        case failed(String)
    }

    static let savedKey = "agathon.training.benchConfig"

    static var saved: TrainingConfig {
        guard let data = UserDefaults.standard.data(forKey: savedKey), let c = try? JSONDecoder().decode(TrainingConfig.self, from: data) else { return .small }
        return c
    }

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader("Auto bench", onClose: cancel)
                .padding(.horizontal, DS.Space.xl)
                .padding(.top, DS.Space.l)
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.l) {
                    section("Grades") {
                        FlowChips(all: TrainingGrade.allCases, title: \.rawValue, selected: $config.grades)
                    }
                    section("Kinds of writing (\(cases) cases in the catalogue)") {
                        FlowChips(all: TrainingCategory.allCases, title: \.title, selected: $config.categories)
                    }
                    section("Hands") {
                        FlowChips(all: TrainingHand.all.map(\.name), title: \.self, selected: $config.hands)
                    }
                    HStack(alignment: .top, spacing: DS.Space.xl) {
                        section("Cases") { Stepper("\(config.count)", value: $config.count, in: 1...40).fixedSize() }
                        section("Call budget") { Stepper("\(config.budget) calls", value: $config.budget, in: 10...600, step: 10).fixedSize() }
                        section("Seed") { Stepper("\(config.seed)", value: $config.seed, in: 1...999).fixedSize() }
                    }
                    section("The kid's pace") {
                        SegmentedPicker(selection: $config.pace, options: KidPace.all.map { ($0.name, $0.name.capitalized) }, onPaper: true)
                    }
                    section("The tutor checks") {
                        SegmentedPicker(selection: $config.checking, options: [(CheckTiming.whenDone.rawValue, "When they're done"),
                                                                                (CheckTiming.asIGo.rawValue, "As they go")], onPaper: true)
                    }
                    Toggle("Right and deliberately wrong solutions", isOn: $config.includeWrong).dsFont(.body)
                    Toggle("The brain's practice problems too", isOn: $config.includeGenerated).dsFont(.body)
                    Text("About \(estimate) calls for \(config.count) cases (a line is read 1–2 times; a slip may ask for a hint). The run stops at \(config.budget).")
                        .dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
                    serverStatus
                }
                .padding(DS.Space.xl)
            }
            HStack {
                Spacer()
                PillButton("Cancel", kind: .secondaryOnPaper, action: cancel).fixedSize()
                PillButton("Start the bench", icon: .play, kind: .primary) {
                    if let data = try? JSONEncoder().encode(config) { UserDefaults.standard.set(data, forKey: Self.savedKey) }
                    start(config)
                }
                .fixedSize()
                .disabled(!canStart)
                .accessibilityIdentifier("bench.start")
            }
            .padding(DS.Space.l)
        }
        .background(DS.Color.paper)
        .task { await checkServer() }
    }

    private var cases: Int {
        TrainingCatalogue.all.filter { Set(config.grades).contains($0.grade) && Set(config.categories).contains($0.category) }.count
    }

    private var estimate: Int { Int((Double(config.count) * 2.6 * 1.5).rounded()) }

    private var canStart: Bool {
        guard !config.grades.isEmpty, !config.categories.isEmpty, !config.hands.isEmpty else { return false }
        switch status {
        case .on: return true
        case .missing, .failed: return spendInk
        case .checking: return false
        }
    }

    @ViewBuilder private var serverStatus: some View {
        VStack(alignment: .leading, spacing: DS.Space.xs) {
            HStack(spacing: DS.Space.s) {
                TrainingPill(text: TrainingSync.isProduction(backend) ? "Production" : "Local stack", tint: DS.Color.onInk,
                             fill: TrainingSync.isProduction(backend) ? DS.Color.tomato : DS.Color.cobalt)
                Text(TrainingSync.target(backend)).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
            }
            switch status {
            case .checking:
                Text("Asking the server about training calls…").dsFont(.callout).foregroundStyle(DS.Color.inkSecondary)
            case .on:
                Text("Training calls are on: no ink is spent, they are rate limited and logged as training.")
                    .dsFont(.callout).foregroundStyle(DS.Color.success)
                    .accessibilityIdentifier("bench.status.on")
            case .missing, .failed:
                Text(status == .missing
                     ? "This server has no training pass yet: these calls would spend your own ink (and count toward fair use)."
                     : "Couldn't ask the server about training calls: they may spend your ink.")
                    .dsFont(.callout).foregroundStyle(DS.Color.ink)
                Toggle("Run anyway and spend my ink", isOn: $spendInk).dsFont(.callout)
            }
        }
        .padding(DS.Space.m)
        .background(RoundedRectangle(cornerRadius: DS.Radius.tile, style: .continuous).fill(DS.Color.surfaceSunken))
    }

    private func section<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: DS.Space.xs) {
            Text(title).dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
            content()
        }
    }

    private func checkServer() async {
        switch await TrainingStatus.fetch(backend.api) {
        case .success(let s?): status = s.training ? .on : .missing
        case .success(nil): status = .missing
        case .failure(let e): status = .failed(String(describing: e))
        }
    }
}

/// Chips to pick several of (flat: ink when picked, chalk when not).
struct FlowChips<T: Hashable>: View {
    let all: [T]
    let title: KeyPath<T, String>
    @Binding var selected: [T]

    var body: some View {
        FlowStack(spacing: DS.Space.xs, lineSpacing: DS.Space.xs) {
            ForEach(all, id: \.self) { item in
                let on = selected.contains(item)
                Button {
                    if on { selected.removeAll { $0 == item } } else { selected.append(item) }
                } label: {
                    Text(item[keyPath: title])
                        .dsFont(.button, size: 15)
                        .foregroundStyle(on ? DS.Color.onInk : DS.Color.ink)
                        .padding(.horizontal, 14)
                        .frame(minHeight: 40)
                        .background(Capsule().fill(on ? DS.Color.ink : DS.Color.surfaceSunken))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
    }
}
