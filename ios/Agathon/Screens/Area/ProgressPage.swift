import AgathonDesign
import AgathonKit
import SwiftUI

/// Progress (src/components/progress): the path, this week in four numbers, the last four weeks
/// as bars, every skill with its stars and a Practice button, and the latest problems. Built from
/// the brain's `progressSummary` over the student's attempts.
struct ProgressPage: View {
    let practice: (String) -> Void

    @Environment(AgathonBackend.self) private var backend
    @State private var summary: LearningSummary?
    @State private var grade: Int?
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        AreaPage("Progress", subtitle: subtitle) {
            AreaStatus(loading: loading && summary == nil, error: summary == nil ? error : nil) { Task { await load() } }
            if let summary {
                if summary.totals.problems == 0 && summary.recent.isEmpty {
                    EmptyState(.icon(.chart, .sunny), title: "Nothing here yet",
                               message: "Write some math on a board. Every problem you work on shows up here.")
                        .frame(maxWidth: .infinity)
                        .accessibilityIdentifier("progress.empty")
                    skills(summary)
                } else {
                    thisWeek(summary)
                    chart(summary)
                    skills(summary)
                    recent(summary)
                }
            }
        }
        .task { await load() }
        .accessibilityIdentifier("progress.page")
    }

    private var subtitle: String? {
        guard let grade, let summary else { return nil }
        let path = PathView(grade: grade, summary: summary)
        return "\(GradePath.gradeName(grade)) path: \(path.doneCount) of \(path.stops.count) skills mastered"
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let profile = try? await backend.profiles.profile()
            grade = profile?.grade
            summary = try await LearningLoader.summary(backend: backend, grade: profile?.grade, course: profile?.course)
            error = nil
        } catch {
            self.error = userMessage(for: error)
        }
    }

    // MARK: this week

    private func thisWeek(_ summary: LearningSummary) -> some View {
        let week = summary.days.suffix(7)
        let minutes = Int((week.map(\.activeMs).reduce(0, +) / 60_000).rounded())
        let problems = week.map(\.problems).reduce(0, +)
        let weekStart = week.first?.date ?? ""
        let independent = summary.recent.filter { $0.startedAt >= weekStart && ["first_try", "self_corrected"].contains($0.outcome) }.count
        return AreaCard("This week") {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: DS.Space.s)], spacing: DS.Space.s) {
                StatTile(value: "\(minutes)", label: minutes == 1 ? "minute" : "minutes")
                StatTile(value: "\(problems)", label: "problems worked on")
                StatTile(value: "\(min(independent, problems))", label: "solved on your own")
                StatTile(value: "\(summary.streakDays)", label: "days of math in a row")
            }
        }
    }

    // MARK: the last four weeks

    private func chart(_ summary: LearningSummary) -> some View {
        let days = summary.days.suffix(28)
        let minutes = days.map { $0.activeMs / 60_000 }
        let top = max(minutes.max() ?? 0, 10)
        return AreaCard("Last 4 weeks") {
            Text("Minutes of practice each day")
                .dsFont(.caption)
                .foregroundStyle(DS.Color.inkSecondary)
            HStack(alignment: .bottom, spacing: 4) {
                ForEach(Array(days.enumerated()), id: \.offset) { i, day in
                    let value = minutes[i]
                    let isToday = i == days.count - 1
                    VStack(spacing: 0) {
                        Spacer(minLength: 0)
                        Capsule()
                            .fill(value <= 0 ? DS.Color.surfaceSunken : (isToday ? DS.Color.tomato : DS.Color.ink))
                            .frame(height: value <= 0 ? 6 : max(8, 140 * value / top))
                    }
                    .frame(maxWidth: .infinity)
                    .accessibilityElement()
                    .accessibilityLabel("\(day.date): \(Int(value.rounded())) minutes")
                }
            }
            .frame(height: 150)
            HStack {
                Text("4 weeks ago")
                Spacer()
                Text("Today")
            }
            .dsFont(.caption)
            .foregroundStyle(DS.Color.inkSecondary)
        }
        .accessibilityIdentifier("progress.chart")
    }

    // MARK: skills

    @ViewBuilder private func skills(_ summary: LearningSummary) -> some View {
        let shown = summary.skills.filter { $0.attempts > 0 || (grade.flatMap { GradePath.paths[$0] }?.contains($0.skill) ?? false) }
        if !shown.isEmpty {
            AreaCard("Your skills") {
                VStack(spacing: DS.Space.s) {
                    ForEach(shown) { skill in
                        HStack(spacing: DS.Space.m) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(skill.name).dsFont(.button, size: 18).foregroundStyle(DS.Color.ink)
                                Text(skill.attempts == 0 ? "Not started yet"
                                     : "\(GradePath.levelLabel(skill.level)) · \(skill.attempts) problem\(skill.attempts == 1 ? "" : "s")")
                                    .dsFont(.caption)
                                    .foregroundStyle(DS.Color.inkSecondary)
                            }
                            Spacer(minLength: DS.Space.s)
                            StarRow(earned: GradePath.stars(skill.level), total: 3, size: 24)
                            PillButton("Practice", kind: .secondaryOnPaper) { practice(skill.skill) }
                                .fixedSize()
                                .accessibilityLabel("Practice \(skill.name)")
                        }
                        .padding(.vertical, 4)
                        .accessibilityElement(children: .contain)
                    }
                }
            }
            .accessibilityIdentifier("progress.skills")
        }
    }

    // MARK: recent problems

    @ViewBuilder private func recent(_ summary: LearningSummary) -> some View {
        if !summary.recent.isEmpty {
            AreaCard("Recent problems") {
                VStack(alignment: .leading, spacing: DS.Space.s) {
                    ForEach(summary.recent) { attempt in
                        HStack(spacing: DS.Space.m) {
                            VStack(alignment: .leading, spacing: 4) {
                                MathLabel(attempt.problemLatex.split(separator: ";").first.map(String.init) ?? attempt.problemLatex, size: 19)
                                    .lineLimit(1)
                                Text(GradePath.name(attempt.skill, summary: summary))
                                    .dsFont(.caption)
                                    .foregroundStyle(DS.Color.inkSecondary)
                            }
                            Spacer(minLength: DS.Space.s)
                            Tag(Self.outcomeWords(attempt.outcome), style: attempt.outcome == "first_try" || attempt.outcome == "self_corrected" ? .sunny : .chalk)
                        }
                        .padding(.vertical, 4)
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
    }

    /// How a problem went, in kind words (never "wrong").
    static func outcomeWords(_ outcome: String) -> String {
        switch outcome {
        case "first_try": return "On your own"
        case "self_corrected": return "Fixed it yourself"
        case "with_help": return "With a hint"
        case "tutor_solved": return "Worked through together"
        case "in_progress": return "Still going"
        default: return "Not finished"
        }
    }
}
