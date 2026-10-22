#if os(iOS)
import AgathonDesign
import SwiftUI

/// Who is practising, for the free tutor's cap line (the owner, 2026-10-22): no account (an anonymous
/// session: 5 a day, "Make a free account for 20 a day"), a free account (20, "Unlimited lifts it"),
/// or Unlimited (no cap).
public enum SATAccount: String, Sendable {
    case none, free, unlimited

    public var hasAccount: Bool { self != .none }
}

// MARK: - choices

/// One choice: its letter in a circle (the mark's ring and dot: chosen is the filled dot), the text,
/// and Bluebook's eliminator at the end of the row. Checked: the right one turns green; a tried one is
/// "look again" yellow, never red.
struct SATChoiceRow: View {
    enum Look: Equatable {
        case plain, chosen, right, tried, struck
        /// the right answer, shown once the question is missed
        case answer
    }

    let choice: SATChoice
    let look: Look
    let locked: Bool
    let choose: () -> Void
    let strike: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            Button(action: choose) {
                HStack(alignment: .center, spacing: 14) {
                    letter
                    SATText(choice.text, size: 18, color: look == .struck ? DS.Color.inkSecondary : DS.Color.ink)
                        .strikethrough(look == .struck, color: DS.Color.inkSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.leading, 12)
                .padding(.vertical, 10)
                .frame(minHeight: DS.Size.minTarget)
                .contentShape(Rectangle())
            }
            .buttonStyle(SATPress())
            .disabled(locked)
            .accessibilityLabel("\(choice.key). \(SATRichText.plain(choice.text))")
            .accessibilityValue(value)
            .accessibilityAddTraits(look == .chosen ? .isSelected : [])
            .accessibilityIdentifier("sat.choice.\(choice.key)")
            if !locked {
                Button(action: strike) {
                    StrikeGlyph(letter: choice.key, struck: look == .struck)
                        .frame(width: DS.Size.minTarget, height: DS.Size.minTarget)
                        .contentShape(Rectangle())
                }
                .buttonStyle(SATPress())
                .accessibilityLabel(look == .struck ? "\(SATCopy.restore) \(choice.key)" : "\(SATCopy.strike) \(choice.key)")
                .accessibilityIdentifier("sat.strike.\(choice.key)")
            }
        }
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(fill))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(ring, lineWidth: ringWidth))
    }

    private var value: String {
        switch look {
        case .plain: ""
        case .chosen: "Chosen"
        case .right: "Right"
        case .tried: "Not this one"
        case .struck: "Crossed out"
        case .answer: "The answer"
        }
    }

    private var fill: Color {
        switch look {
        case .right, .answer: DS.Color.paper
        default: DS.Color.surfaceSunken
        }
    }

    private var ring: Color {
        switch look {
        case .chosen: DS.Color.ink
        case .right, .answer: DS.Color.success
        case .tried: DS.Color.tryAgain
        default: .clear
        }
    }

    private var ringWidth: CGFloat { look == .plain || look == .struck ? 0 : 2.5 }

    private var letter: some View {
        let (bg, fg): (Color, Color) = switch look {
        case .chosen: (DS.Color.ink, DS.Color.onInk)
        case .right, .answer: (DS.Color.success, DS.Color.onInk)
        case .tried: (DS.Color.tryAgain, DS.Color.ink)
        case .struck: (DS.Color.surface, DS.Color.inkSecondary)
        case .plain: (DS.Color.surface, DS.Color.ink)
        }
        return ZStack {
            Circle().fill(bg)
            if look == .right || look == .answer {
                DSIcon(.check, size: 15).foregroundStyle(fg)
            } else {
                Text(choice.key).dsFont(.button, size: 16).foregroundStyle(fg)
            }
        }
        .frame(width: 36, height: 36)
    }
}

/// The eliminator's mark: the letter in a small ring with a line through it; struck, "Undo".
struct StrikeGlyph: View {
    let letter: String
    let struck: Bool

    var body: some View {
        if struck {
            Text("Undo").dsFont(.caption, size: 13).fontWeight(.semibold).foregroundStyle(DS.Color.ink)
        } else {
            ZStack {
                Circle().strokeBorder(DS.Color.inkSecondary, lineWidth: 1.5)
                Text(letter).dsFont(.caption, size: 12).fontWeight(.semibold).foregroundStyle(DS.Color.inkSecondary)
                Rectangle().fill(DS.Color.inkSecondary).frame(width: 30, height: 1.5).rotationEffect(.degrees(-35))
            }
            .frame(width: 24, height: 24)
        }
    }
}

// MARK: - grid-in

/// The grid-in: the answer as typed (a real minus sign), and a keypad on the panel (the system
/// keyboard would cover the board), whose keys never let it become something no grid-in could be.
struct SATGridInField: View {
    let typed: String
    let hint: SATGridIn.Problem?
    let verdict: SATPractice.Verdict
    let press: (SATGridIn.Key) -> Void

    private let rows: [[SATGridIn.Key]] = [
        [.digit(1), .digit(2), .digit(3), .digit(4), .digit(5), .digit(6), .digit(7)],
        [.digit(8), .digit(9), .digit(0), .point, .slash, .minus, .delete],
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.s) {
            Text(SATCopy.gridInLabel).dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
            HStack(spacing: 10) {
                Text(typed.isEmpty ? " " : SATGridIn.display(typed))
                    .font(DS.Font.fixed(.numeral, size: 30))
                    .monospacedDigit()
                    .foregroundStyle(DS.Color.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if verdict.isLocked {
                    DSIcon(verdict == .missed ? .lookAgain : .check, size: 18)
                        .foregroundStyle(verdict == .missed ? DS.Color.ink : DS.Color.onInk)
                        .frame(width: 34, height: 34)
                        .background(Circle().fill(verdict == .missed ? DS.Color.tryAgain : DS.Color.success))
                }
            }
            .padding(.horizontal, 18)
            .frame(height: 60)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(DS.Color.surfaceSunken))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(fieldRing, lineWidth: 2.5))
            .accessibilityElement()
            .accessibilityLabel(SATCopy.gridInLabel)
            .accessibilityValue(typed.isEmpty ? "Empty" : typed)
            .accessibilityIdentifier("sat.gridin")
            if !verdict.isLocked {
                VStack(spacing: 8) {
                    ForEach(0..<rows.count, id: \.self) { r in
                        HStack(spacing: 8) {
                            ForEach(rows[r], id: \.self) { key in keyButton(key) }
                        }
                    }
                }
                Text(hint?.words ?? SATCopy.gridInRules)
                    .dsFont(.caption)
                    .foregroundStyle(hint == nil ? DS.Color.inkSecondary : DS.Color.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("sat.gridin.hint")
            }
        }
    }

    private var fieldRing: Color {
        switch verdict {
        case .right: DS.Color.success
        case .lookAgain, .missed: DS.Color.tryAgain
        case .open: .clear
        }
    }

    private func keyButton(_ key: SATGridIn.Key) -> some View {
        Button { press(key) } label: {
            Group {
                switch key {
                case .delete: DSIcon(.delete, size: 20)
                case .minus: Text("−")
                default: Text(String(key.character ?? " "))
                }
            }
            .font(DS.Font.fixed(.button, size: 22))
            .foregroundStyle(DS.Color.ink)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(DS.Color.surfaceSunken))
            .contentShape(Rectangle())
        }
        .buttonStyle(SATPress())
        .accessibilityLabel(Self.spoken(key))
        .accessibilityIdentifier("sat.key.\(Self.id(key))")
    }

    static func id(_ key: SATGridIn.Key) -> String {
        switch key {
        case .digit(let d): "\(d)"
        case .point: "point"
        case .slash: "slash"
        case .minus: "minus"
        case .delete: "delete"
        case .clear: "clear"
        }
    }

    static func spoken(_ key: SATGridIn.Key) -> String {
        switch key {
        case .digit(let d): "\(d)"
        case .point: "Decimal point"
        case .slash: "Fraction bar"
        case .minus: "Minus"
        case .delete: "Delete"
        case .clear: "Clear"
        }
    }
}

// MARK: - the solution

/// The worked solution: numbered steps (the step's number in a small ink dot), each with its line of
/// maths, then how to do it on the test's graphing calculator when that helps.
public struct SATSolutionView: View {
    let solution: SATSolution
    let answer: String

    public init(_ solution: SATSolution, answer: String) {
        self.solution = solution
        self.answer = answer
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.m) {
            HStack(alignment: .firstTextBaseline) {
                Text(SATCopy.solution).dsFont(.headline, size: 22).foregroundStyle(DS.Color.ink)
                Spacer()
                Text(SATCopy.answerWas(SATGridIn.display(answer))).dsFont(.button, size: 15).foregroundStyle(DS.Color.inkSecondary)
            }
            ForEach(Array(solution.steps.enumerated()), id: \.offset) { i, step in
                HStack(alignment: .top, spacing: 12) {
                    Text("\(i + 1)")
                        .dsFont(.button, size: 14)
                        .foregroundStyle(DS.Color.onInk)
                        .frame(width: 26, height: 26)
                        .background(Circle().fill(DS.Color.ink))
                    VStack(alignment: .leading, spacing: 8) {
                        SATText(step.text, size: 17)
                        if let math = step.math, !math.isEmpty {
                            SATMath(math, size: 21)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .accessibilityIdentifier("sat.solution.math")
                        }
                    }
                }
            }
            if let tip = solution.desmosTip, !tip.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text(SATCopy.desmos).dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
                    SATText(tip, size: 16)
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(DS.Color.paper))
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("sat.solution.desmos")
            }
        }
        .padding(DS.Space.l)
        .background(RoundedRectangle(cornerRadius: DS.Radius.tile, style: .continuous).fill(DS.Color.surfaceSunken))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("sat.solution")
    }
}

// MARK: - small parts

/// Press: shrink a little (the system's own press), still under Reduce Motion.
struct SATPress: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(DS.Motion.press, value: configuration.isPressed)
    }
}

/// A skill's chip: its domain's short name and the skill, quiet.
struct SATSkillChip: View {
    let question: SATQuestion

    var body: some View {
        Text(question.skillTitle)
            .dsFont(.caption, size: 14)
            .fontWeight(.medium)
            .foregroundStyle(DS.Color.ink)
            .lineLimit(2)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(DS.Color.surfaceSunken))
            .accessibilityLabel("Skill: \(question.skillTitle), \(question.domain.title)")
            .accessibilityIdentifier("sat.skill")
    }
}
#endif
