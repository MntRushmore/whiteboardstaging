#if os(iOS)
import AgathonDesign
import SwiftUI

/// The solution, two ways (docs/SAT-V2.md "Two ways"; docs/sat2/DESIGN-NOTES.md frame 7): a sheet
/// over the lower half, the question and its figure still in view above it. "A is right." (or "The
/// answer is A."), Back to my work and Next question; then the paper way (the bank's steps) and the
/// Desmos way (`desmos_steps`, as calculator rows) side by side, or as tabs when upright. No Desmos
/// way: the paper way takes the whole width. No Desmos logo or colours.
public struct SATSolutionSheet: View {
    public enum Way: String, CaseIterable, Identifiable {
        case paper, desmos
        public var id: String { rawValue }
    }

    let question: SATQuestion
    let right: Bool
    let sideBySide: Bool
    let nextTitle: String
    let back: () -> Void
    let next: () -> Void
    @State private var way: Way = .paper

    public init(question: SATQuestion, right: Bool, sideBySide: Bool, nextTitle: String = SATCopy.nextQuestion,
                back: @escaping () -> Void, next: @escaping () -> Void) {
        self.question = question
        self.right = right
        self.sideBySide = sideBySide
        self.nextTitle = nextTitle
        self.back = back
        self.next = next
    }

    private var desmos: [SATSolution.Step]? { question.solution.desmosSteps }

    public var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            header
            if let desmos, !desmos.isEmpty {
                if sideBySide {
                    HStack(alignment: .top, spacing: 20) {
                        card { paperWay }
                        card { desmosWay(desmos) }
                    }
                } else {
                    Picker("", selection: $way) {
                        Text("The paper way").tag(Way.paper)
                        Text("The Desmos way").tag(Way.desmos)
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("sat.solution.ways")
                    card { way == .paper ? AnyView(paperWay) : AnyView(desmosWay(desmos)) }
                }
            } else {
                card { paperWay }
            }
        }
        .padding(.horizontal, 30)
        .padding(.top, 26)
        .padding(.bottom, 20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(UnevenRoundedRectangle(topLeadingRadius: 32, topTrailingRadius: 32, style: .continuous).fill(DS.Color.ground).ignoresSafeArea())
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("sat.solution")
    }

    private var header: some View {
        HStack(spacing: 16) {
            ZStack {
                if right {
                    Circle().fill(DS.Color.success)
                    DSIcon(.check, size: 20).foregroundStyle(DS.Color.onInk)
                } else {
                    Circle().strokeBorder(DS.Color.ink, lineWidth: 3)
                }
            }
            .frame(width: 44, height: 44)
            Text(right ? SATCopy.isRight(SATGridIn.display(question.answer.shown)) : SATCopy.answerIsShort(SATGridIn.display(question.answer.shown)))
                .font(DS.Font.fixed(.headline, size: 24))
                .tracking(-0.03 * 24)
                .foregroundStyle(DS.Color.ink)
                .accessibilityIdentifier(right ? "sat.verdict.right" : "sat.verdict.missed")
            if let key = question.answer.key, let text = question.choices?.first(where: { $0.key == key })?.text {
                SATText(text, size: 22, fullSizeLone: true).fixedSize()
            }
            Spacer(minLength: 12)
            PillButton(SATCopy.backToWork, kind: .secondary, action: back)
                .fixedSize()
                .accessibilityIdentifier("sat.solution.back")
            PillButton(nextTitle, icon: .forward, kind: .sunny, size: .large, action: next)
                .fixedSize()
                .accessibilityIdentifier("sat.solution.next")
        }
    }

    private func card<C: View>(@ViewBuilder _ content: () -> C) -> some View {
        ScrollView { content().padding(26).frame(maxWidth: .infinity, alignment: .leading) }
            .background(RoundedRectangle(cornerRadius: 28, style: .continuous).fill(DS.Color.paper))
    }

    private var paperWay: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text(SATCopy.paperWay).dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
            ForEach(Array(question.solution.steps.enumerated()), id: \.offset) { i, step in
                HStack(alignment: .top, spacing: 16) {
                    badge(i + 1)
                    VStack(alignment: .leading, spacing: 8) {
                        SATText(step.text, size: 17)
                        if let m = step.math, !m.isEmpty { SATMath("\\displaystyle " + m, size: 21).accessibilityIdentifier("sat.solution.math") }
                    }
                }
            }
            if let tip = question.solution.desmosTip, !tip.isEmpty, !(desmos?.isEmpty == false) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(SATCopy.desmos).dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
                    SATText(tip, size: 16)
                }
                .accessibilityIdentifier("sat.solution.desmos")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("sat.solution.paper")
    }

    private func desmosWay(_ steps: [SATSolution.Step]) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 6) {
                Text(SATCopy.desmosWay).dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
                Text("· \(SATCopy.desmosWayLine)").dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
            }
            ForEach(Array(steps.enumerated()), id: \.offset) { i, step in
                HStack(alignment: .top, spacing: 16) {
                    badge(i + 1)
                    VStack(alignment: .leading, spacing: 10) {
                        SATText(step.text, size: 17)
                        if let m = step.math, !m.isEmpty {
                            // a calculator row: its number in the gutter, the expression beside it
                            HStack(spacing: 0) {
                                Text("\(i + 1)").dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
                                    .frame(width: 44).frame(maxHeight: .infinity).background(SATChromeColor.guide)
                                SATMath(m, size: 21).padding(.horizontal, 18)
                                Spacer(minLength: 0)
                            }
                            .frame(minHeight: 48)
                            .background(DS.Color.surfaceSunken)
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        }
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("sat.solution.desmosWay")
    }

    private func badge(_ n: Int) -> some View {
        Text("\(n)").dsFont(.button, size: 15).foregroundStyle(DS.Color.ink)
            .frame(width: 34, height: 34)
            .background(Circle().fill(DS.Color.surfaceSunken))
    }
}
#endif
