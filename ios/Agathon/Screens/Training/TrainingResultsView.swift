import AgathonDesign
import Combine
import AgathonKit
import AgathonLive
import SwiftUI
import UIKit

/// A run's results: the totals and accuracy by kind of writing, hand (or handwriting style) and grade,
/// read latency and Check → marks at p50/p90, the calls it made (and the ink they would have cost),
/// why lines failed, and every failure — each with the page as it looked, what was read against what
/// was written, and why; run it again, or save it as a regression test.
struct TrainingResultsView: View {
    @State var run: TrainingRun
    var runner: BenchRunner?
    let close: () -> Void
    @Environment(AgathonBackend.self) private var backend
    @State private var detail: TrainingCaseResult?
    @State private var showAll = false

    init(run: TrainingRun, runner: BenchRunner? = nil, close: @escaping () -> Void) {
        _run = State(initialValue: run)
        self.runner = runner
        self.close = close
    }

    var body: some View {
        let s = run.summary
        ZStack {
            DS.Color.ground.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.l) {
                    header
                    totals(s)
                    if !s.byCategory.isEmpty { table(run.kind == .bench ? "By kind of writing" : "By problem", s.byCategory) }
                    if !s.byHand.isEmpty { table(run.kind == .bench ? "By hand" : "By handwriting style", s.byHand) }
                    if s.byGrade.count > 1 { table("By grade", s.byGrade) }
                    if !s.reasons.isEmpty { reasons(s) }
                    failures
                }
                .frame(maxWidth: 980, alignment: .leading)
                .padding(.horizontal, DS.Space.xxl)
                .padding(.vertical, DS.Space.l)
                .frame(maxWidth: .infinity)
            }
        }
        .onReceive(runner?.$run.eraseToAnyPublisher() ?? Empty().eraseToAnyPublisher()) { run = $0 }
        .sheet(item: $detail) { r in
            CaseDetailView(result: r, run: run, rerun: runner.map { runner in { await runner.rerun(r) } }, saved: { updated in
                if let i = run.cases.firstIndex(where: { $0.id == updated.id }) { run.cases[i] = updated }
                Task { @MainActor in
                    let saved = await TrainingSync.save(run, backend: backend, cases: [updated.id])
                    run.synced = saved.synced
                    run.syncNote = saved.syncNote
                }
            })
            .environment(backend)
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: DS.Space.m) {
            RoundButton(.close, label: "Close the results", action: close)
                .accessibilityIdentifier("results.close")
            VStack(alignment: .leading, spacing: 2) {
                Text(run.kind == .bench ? "Bench results" : "My Pencil results").dsFont(.display, size: 40).foregroundStyle(DS.Color.ink)
                Text("\(run.startedAt.formatted(date: .abbreviated, time: .shortened)) · \(run.target) · \(run.status.rawValue)")
                    .dsFont(.callout).foregroundStyle(DS.Color.inkSecondary)
                if let note = run.syncNote {
                    Text(note).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
                }
            }
            Spacer()
        }
    }

    private func pct(_ r: Double?) -> String { r.map { "\(Int(($0 * 100).rounded()))%" } ?? "–" }
    private func ms(_ v: Double?) -> String { v.map { "\(Int($0.rounded())) ms" } ?? "–" }

    private func totals(_ s: TrainingSummary) -> some View {
        let columns = [GridItem(.adaptive(minimum: 200), spacing: DS.Space.s)]
        return LazyVGrid(columns: columns, alignment: .leading, spacing: DS.Space.s) {
            StatTile(value: "\(s.passed)/\(s.cases)", label: "pages right (\(pct(s.caseRate)))")
            StatTile(value: "\(s.linesPassed)/\(s.lines)", label: "lines right (\(pct(s.lineRate)))")
            StatTile(value: pct(s.readRate), label: "reads as written (\(s.readsRight)/\(s.readsChecked))")
            StatTile(value: ms(s.readP50), label: "pen up → read, p50 (p90 \(ms(s.readP90)))")
            StatTile(value: ms(s.checkP50), label: "Check → marks, p50 (p90 \(ms(s.checkP90)))")
            StatTile(value: "\(s.totalCalls)", label: "calls: \(s.calls.sorted { $0.key < $1.key }.map { "\($0.key) \($0.value)" }.joined(separator: ", ")) (\(s.ink) ink without the training pass)")
            StatTile(value: "\(s.wrongRings)", label: "rings on right work")
            StatTile(value: "\(s.missedRings)", label: "slips not ringed")
        }
        .accessibilityIdentifier("results.totals")
    }

    private func table(_ title: String, _ buckets: [TrainingSummary.Bucket]) -> some View {
        AreaCard(title) {
            VStack(spacing: DS.Space.xs) {
                ForEach(buckets) { b in
                    HStack(spacing: DS.Space.s) {
                        Text(b.name).dsFont(.button, size: 16).foregroundStyle(DS.Color.ink).frame(width: 220, alignment: .leading).lineLimit(1)
                        RateBar(rate: b.lineRate ?? 0).frame(height: 14)
                        Text("\(b.linesPassed)/\(b.lines) lines").dsFont(.caption).foregroundStyle(DS.Color.inkSecondary).frame(width: 90, alignment: .trailing)
                        Text(pct(b.lineRate)).dsFont(.button, size: 16).foregroundStyle(DS.Color.ink).frame(width: 56, alignment: .trailing)
                        Text("\(b.passed)/\(b.cases) pages").dsFont(.caption).foregroundStyle(DS.Color.inkSecondary).frame(width: 84, alignment: .trailing)
                    }
                }
            }
        }
    }

    private func reasons(_ s: TrainingSummary) -> some View {
        AreaCard("Why lines failed") {
            FlowStack(spacing: DS.Space.xs, lineSpacing: DS.Space.xs) {
                ForEach(s.reasons, id: \.code) { r in
                    TrainingPill(text: "\(r.code.title) · \(r.count)", fill: DS.Color.surfaceSunken)
                }
            }
        }
    }

    private var failures: some View {
        let failed = run.cases.filter { $0.pass == false }
        let shown = showAll ? run.cases : failed
        return AreaCard(showAll ? "Every page (\(run.cases.count))" : "Failures (\(failed.count))") {
            VStack(alignment: .leading, spacing: DS.Space.xs) {
                Button(showAll ? "Show failures only" : "Show every page") { showAll.toggle() }
                    .dsFont(.button, size: 15).foregroundStyle(DS.Color.cobalt).buttonStyle(.plain)
                if shown.isEmpty {
                    Text(run.cases.isEmpty ? "Nothing run yet." : "No failures.").dsFont(.body).foregroundStyle(DS.Color.inkSecondary)
                }
                ForEach(shown) { r in
                    Button { detail = r } label: { CaseRow(result: r) }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("results.case.\(r.caseKey)")
                }
            }
        }
    }
}

/// A rate as a flat bar (green done, chalk to go).
struct RateBar: View {
    let rate: Double

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(DS.Color.surfaceSunken)
                Capsule().fill(rate >= 0.9 ? DS.Color.success : rate >= 0.7 ? DS.Color.sunny : DS.Color.tomato)
                    .frame(width: max(4, geo.size.width * min(1, max(0, rate))))
            }
        }
    }
}

private struct CaseRow: View {
    let result: TrainingCaseResult

    var body: some View {
        HStack(alignment: .top, spacing: DS.Space.s) {
            Text(result.pass == true ? "✓" : result.pass == false ? "✗" : "·")
                .dsFont(.headline)
                .foregroundStyle(result.pass == false ? DS.Color.tomato : DS.Color.success)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(result.problem.isEmpty ? (result.lines.first?.written ?? result.caseKey) : MathText.plain(result.problem.joined(separator: " ; ")))
                    .dsFont(.button, size: 16).foregroundStyle(DS.Color.ink).lineLimit(1)
                Text("\(result.category.title) · \(result.hand)\(result.grade.map { " · \($0.rawValue)" } ?? "")\(result.regression ? " · regression test" : "")")
                    .dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
                if let why = result.firstWhy, result.pass == false {
                    Text(why.text).dsFont(.caption).foregroundStyle(DS.Color.ink).lineLimit(2)
                }
            }
            Spacer()
        }
        .padding(DS.Space.s)
        .background(RoundedRectangle(cornerRadius: DS.Radius.tile, style: .continuous).fill(DS.Color.surfaceSunken))
        .contentShape(Rectangle())
    }
}

extension TrainingWhy.Code: Identifiable {
    public var id: String { rawValue }
}

/// One case: the page as it looked, each line written vs read vs expected vs what the tutor did and
/// why; Run it again (a bench still open) and Save as regression test.
struct CaseDetailView: View {
    @State var result: TrainingCaseResult
    let run: TrainingRun
    let rerun: (() async -> TrainingCaseResult?)?
    let saved: (TrainingCaseResult) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var exported: URL?
    @State private var note: String?

    init(result: TrainingCaseResult, run: TrainingRun, rerun: (() async -> TrainingCaseResult?)?, saved: @escaping (TrainingCaseResult) -> Void) {
        _result = State(initialValue: result)
        self.run = run
        self.rerun = rerun
        self.saved = saved
    }

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(result.pass == false ? "A failure" : "A page", onClose: { dismiss() })
                .padding(.horizontal, DS.Space.xl)
                .padding(.top, DS.Space.l)
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.m) {
                    Text(result.problem.isEmpty ? "Their own problem" : MathText.plain(result.problem.joined(separator: "  ·  ")))
                        .dsFont(.headline).foregroundStyle(DS.Color.ink)
                    Text("\(result.category.title) · \(result.hand) · \(result.caseKey) · \(Int(result.ms / 1000)) s · \(result.calls.values.reduce(0, +)) calls")
                        .dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
                    if let why = result.why { Text(why.text).dsFont(.callout).foregroundStyle(DS.Color.ink) }
                    if let data = result.snapshot, let image = UIImage(data: data) {
                        Image(uiImage: image).resizable().scaledToFit()
                            .clipShape(RoundedRectangle(cornerRadius: DS.Radius.tile))
                            .accessibilityIdentifier("detail.snapshot")
                    }
                    ForEach(result.lines) { line in LineDetail(line: line) }
                    if let note { Text(note).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary) }
                }
                .padding(DS.Space.xl)
            }
            HStack(spacing: DS.Space.s) {
                if let exported {
                    ShareLink(item: exported) { TrainingPill(text: "Share the fixture") }
                }
                Spacer()
                if let rerun {
                    PillButton(busy ? "Running…" : "Run it again", icon: .retry, kind: .secondaryOnPaper) {
                        busy = true
                        Task { @MainActor in
                            if let fresh = await rerun() {
                                note = fresh.pass == true ? "Ran again: it passed this time." : "Ran again: \(fresh.firstWhy?.text ?? "it failed again.")"
                                dismiss()
                            }
                            busy = false
                        }
                    }
                    .fixedSize()
                    .disabled(busy)
                    .accessibilityIdentifier("detail.rerun")
                }
                PillButton(result.regression ? "Saved as a test" : "Save as regression test", icon: .check, kind: .primary) { saveRegression() }
                    .fixedSize()
                    .accessibilityIdentifier("detail.regression")
            }
            .padding(DS.Space.l)
        }
        .background(DS.Color.paper)
    }

    /// The case as a fixture: on the server (its row, flagged), as a file to share, and — in a Debug
    /// build on the simulator — straight into the test suite's folder.
    private func saveRegression() {
        result.regression = true
        let fixture = TrainingFixture(result, settings: .init(checking: run.config?.checking ?? CheckTiming.whenDone.rawValue))
        guard let data = try? fixture.encoded() else { return }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(fixture.fileName)
        try? data.write(to: url, options: .atomic)
        exported = url
        var words = ["Flagged on the server (npm run training:fixtures pulls it into the tests)."]
        if let folder = Self.repoFixtures, (try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)) != nil,
           (try? data.write(to: folder.appendingPathComponent(fixture.fileName), options: .atomic)) != nil {
            words.append("Written to the test suite: \(fixture.fileName).")
        }
        note = words.joined(separator: " ")
        saved(result)
    }

    /// Debug on the simulator: the AgathonLive test suite's fixtures folder on this Mac.
    static var repoFixtures: URL? {
        #if DEBUG && targetEnvironment(simulator)
        return URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Packages/AgathonLive/Tests/AgathonLiveTests/Fixtures/training", isDirectory: true)
        #else
        return nil
        #endif
    }
}

private struct LineDetail: View {
    let line: TrainingLineResult

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: DS.Space.s) {
                Text(line.pass == true ? "✓" : line.pass == false ? "✗" : "·").dsFont(.headline)
                    .foregroundStyle(line.pass == false ? DS.Color.tomato : DS.Color.success)
                Text("Line \(line.index + 1) · \(line.place.rawValue)").dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
                Spacer()
                MarkBadge(mark: line.mark)
            }
            grid("Written", line.written)
            grid("Read", line.read.map { "\($0)  (\(line.provider ?? "?")\(line.confidence.map { String(format: " %.2f", $0) } ?? ""), \(line.reading ?? "-"))" } ?? "never read")
            grid("Expected", line.expect.map { $0.words + (line.value.map { " (right value \($0))" } ?? "") } ?? "not judged")
            grid("The engine", "\(line.verdict ?? "-") \(line.kind ?? "")\(line.result.map { " = \($0)" } ?? "")\(line.released ? "" : " · held")")
            if let ms = line.readMs { grid("Pen up → read", "\(Int(ms)) ms") }
            if let review = line.review {
                grid("Review", "\(review.thumbsUp ? "👍" : "👎")\(review.should.map { " · \($0.title)" } ?? "")\(review.latex.map { " \($0)" } ?? "")\(review.note.map { " · \($0)" } ?? "")")
            }
            if let why = line.why { Text(why.text).dsFont(.callout).foregroundStyle(DS.Color.ink) }
        }
        .padding(DS.Space.s)
        .background(RoundedRectangle(cornerRadius: DS.Radius.tile, style: .continuous).fill(DS.Color.surfaceSunken))
    }

    private func grid(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: DS.Space.s) {
            Text(label).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary).frame(width: 110, alignment: .leading)
            Text(value).font(.system(size: 15, design: .monospaced)).foregroundStyle(DS.Color.ink).textSelection(.enabled)
        }
    }
}
