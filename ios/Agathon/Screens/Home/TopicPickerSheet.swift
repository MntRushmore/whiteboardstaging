import AgathonDesign
import SwiftUI

/// "Pick a topic": the grade's skills first, then every other grade's, as chips. A topic starts a
/// new board with a few problems on it (the web's TopicPicker, src/components/topics).
struct TopicPickerSheet: View {
    let grade: Int?
    let summary: LearningSummary?
    let pick: (String) -> Void

    @Environment(\.dismiss) private var dismiss

    private var groups: [(title: String, skills: [String])] {
        var seen = Set<String>()
        var out: [(String, [String])] = []
        if let grade, let own = GradePath.paths[grade] {
            out.append(("For \(GradePath.gradeName(grade))", own))
            seen.formUnion(own)
        }
        for g in 0 ... 8 where g != grade {
            let skills = (GradePath.paths[g] ?? []).filter { !seen.contains($0) }
            guard !skills.isEmpty else { continue }
            seen.formUnion(skills)
            out.append((GradePath.gradeName(g), skills))
        }
        return out
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.l) {
            SheetHeader("Pick a topic", onClose: { dismiss() })
            Text("Each topic starts a new board with a few problems to try.")
                .dsFont(.callout)
                .foregroundStyle(DS.Color.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.l) {
                    ForEach(groups, id: \.title) { group in
                        VStack(alignment: .leading, spacing: DS.Space.s) {
                            Text(group.title)
                                .dsFont(.label)
                                .foregroundStyle(DS.Color.inkSecondary)
                                .accessibilityAddTraits(.isHeader)
                            FlowStack(spacing: DS.Space.xs, lineSpacing: DS.Space.xs, alignment: .center) {
                                ForEach(group.skills, id: \.self) { skill in
                                    Chip(GradePath.name(skill, summary: summary), icon: icon(skill)) {
                                        dismiss()
                                        pick(skill)
                                    }
                                    .accessibilityIdentifier("topic.\(skill)")
                                }
                            }
                        }
                    }
                }
                .padding(.bottom, DS.Space.l)
            }
            .frame(maxHeight: 520)
        }
        .blocksSheet(width: 640)
    }

    /// A star on a skill already mastered.
    private func icon(_ skill: String) -> DS.Icon? {
        summary?.skills.first { $0.skill == skill }?.level == "mastered" ? .star : nil
    }
}
