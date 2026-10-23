#if os(iOS)
import AgathonDesign
import SwiftUI

// The tutor's notes over SAT v2's page (docs/sat2/DESIGN-NOTES.md, "The tutor's ladder:
// placements"). Each is sized in page units and drawn at the camera's scale (`k`: points a unit),
// so it travels and zooms with the page and its words stay crisp (they are set at the scaled size,
// never magnified). Cobalt is the tutor's.

/// Rung 1: the bank's nudge, a cobalt note beside the student's last line, and what the next tap does.
public struct SATNudgeNote: View {
    let text: String
    let footer: String
    let k: CGFloat

    public init(text: String, footer: String = SATCopy.nudgeFooter, k: CGFloat) {
        self.text = text
        self.footer = footer
        self.k = k
    }

    public static let width: CGFloat = 420

    public var body: some View {
        VStack(alignment: .leading, spacing: 8 * k) {
            Text(SATCopy.nudgeLabel)
                .font(.custom(DSFonts.uiPostScriptName(weight: 600), fixedSize: 14 * k))
                .tracking(1.4 * k)
                .foregroundStyle(SATNoteColor.label)
            SATText(text, size: 21 * k, color: DS.Color.onInk)
                .accessibilityIdentifier("sat.nudge.text")
            Text(footer)
                .font(.custom(DSFonts.uiPostScriptName(weight: 400), fixedSize: 15 * k))
                .foregroundStyle(DS.Color.onInk)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 16 * k)
        .padding(.horizontal, 22 * k)
        .padding(.bottom, 18 * k)
        .frame(width: Self.width * k, alignment: .leading)
        .background(UnevenRoundedRectangle(topLeadingRadius: 6 * k, bottomLeadingRadius: 24 * k, bottomTrailingRadius: 24 * k, topTrailingRadius: 24 * k,
                                           style: .continuous).fill(DS.Color.cobalt))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("sat.nudge")
    }
}

/// After a wrong check: "YOU PICKED B", the mistake that gives it (when the bank knows it), Try
/// again and Walk me through it. Above the chosen card, its tail corner toward it.
public struct SATWrongNote: View {
    let label: String
    let why: String?
    let k: CGFloat
    let tryAgain: () -> Void
    let walk: () -> Void

    public init(label: String, why: String?, k: CGFloat, tryAgain: @escaping () -> Void, walk: @escaping () -> Void) {
        self.label = label
        self.why = why
        self.k = k
        self.tryAgain = tryAgain
        self.walk = walk
    }

    public static let width: CGFloat = 600

    public var body: some View {
        VStack(alignment: .leading, spacing: 12 * k) {
            Text(label)
                .font(.custom(DSFonts.uiPostScriptName(weight: 600), fixedSize: 14 * k))
                .tracking(1.4 * k)
                .foregroundStyle(SATNoteColor.label)
            if let why {
                SATText(SATNoteWords.thatsWhat(why), size: 21 * k, color: DS.Color.onInk)
                    .accessibilityIdentifier("sat.wrong.why")
            }
            HStack(spacing: 12 * k) {
                button(SATCopy.tryAgain, fill: DS.Color.paper, fg: DS.Color.ink, id: "sat.wrong.tryAgain", action: tryAgain)
                button(SATCopy.walkMeThrough, fill: DS.Color.cobaltDeep, fg: DS.Color.onInk, id: "sat.wrong.walk", action: walk)
            }
        }
        .padding(.top, 18 * k)
        .padding(.horizontal, 22 * k)
        .padding(.bottom, 18 * k)
        .frame(width: Self.width * k, alignment: .leading)
        .background(UnevenRoundedRectangle(topLeadingRadius: 24 * k, bottomLeadingRadius: 6 * k, bottomTrailingRadius: 24 * k, topTrailingRadius: 24 * k,
                                           style: .continuous).fill(DS.Color.cobalt))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("sat.wrong")
    }

    private func button(_ title: String, fill: Color, fg: Color, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.custom(DSFonts.uiPostScriptName(weight: 600), fixedSize: max(15, 20 * k)))
                .foregroundStyle(fg)
                .padding(.horizontal, 22 * k)
                .frame(minHeight: max(44, 56 * k))
                .background(Capsule().fill(fill))
                .contentShape(Capsule())
        }
        .buttonStyle(SATPress())
        .accessibilityIdentifier(id)
    }
}

/// The notes' quiet label on cobalt ("NUDGE", "YOU PICKED B"): a flat pale cobalt that still reads.
enum SATNoteColor {
    static let label = DS.Palette.cobalt.mixed(with: DS.Palette.white, amount: 0.72).color
}

/// The words of a `why`: "That's what you get if you …" when the bank wrote the mistake itself.
enum SATNoteWords {
    static func thatsWhat(_ why: String) -> String {
        let lower = why.lowercased()
        if lower.hasPrefix("that's") || lower.hasPrefix("that is") { return why }
        let first = why.prefix(1).lowercased() + why.dropFirst()
        return "That's what you get if you " + first
    }
}

/// The first time the free tutor is used up: the ladder laid out once, over Help me (bottom left).
public struct SATLadderCard: View {
    let dismiss: () -> Void

    public init(dismiss: @escaping () -> Void) {
        self.dismiss = dismiss
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(SATCopy.ladderTitle).font(.custom(DSFonts.uiPostScriptName(weight: 600), fixedSize: 13)).tracking(1.4)
                .foregroundStyle(DS.Color.onInkSecondary)
            row(1, SATCopy.ladderNudge, SATCopy.free, SATCopy.ladderNudgeLine)
            row(2, SATCopy.ladderStep, SATCopy.fromSolutionToday, SATCopy.ladderStepLine)
            row(3, SATCopy.ladderWalk, SATCopy.free, SATCopy.ladderWalkLine)
            Text(SATCopy.ladderFooter).font(.custom(DSFonts.uiPostScriptName(weight: 400), fixedSize: 15)).foregroundStyle(DS.Color.onInk)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(24)
        .frame(width: 380, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 28, style: .continuous).fill(DS.Color.ink))
        .onTapGesture(perform: dismiss)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("sat.ladderCard")
    }

    private func row(_ n: Int, _ title: String, _ tag: String, _ line: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 14) {
            Text("\(n)").font(.custom(DSFonts.uiPostScriptName(weight: 600), fixedSize: 15)).foregroundStyle(DS.Color.onInk)
            VStack(alignment: .leading, spacing: 2) {
                (Text(title).font(.custom(DSFonts.uiPostScriptName(weight: 600), fixedSize: 18)).foregroundColor(DS.Color.onInk)
                    + Text(" · \(tag)").font(.custom(DSFonts.uiPostScriptName(weight: 400), fixedSize: 14)).foregroundColor(DS.Color.onInkSecondary))
                Text(line).font(.custom(DSFonts.uiPostScriptName(weight: 400), fixedSize: 15)).foregroundStyle(DS.Color.onInk)
            }
        }
    }
}

/// A line of the tutor's words on the page, typeset in cobalt: "Your turn: the next line.", and the
/// walk-through's captions (a numbered badge; a caption still to come is faint).
public struct SATPageWords: View {
    public enum Kind: Equatable {
        case yourTurn
        case caption(number: Int, waiting: Bool)
        /// a size on the figure (the walk-through's rise and run)
        case figureLabel
        /// the walk-through's first words when it starts after work already on the page
        case pickup
    }

    let kind: Kind
    let text: String
    let k: CGFloat

    public init(_ kind: Kind, text: String, k: CGFloat) {
        self.kind = kind
        self.text = text
        self.k = k
    }

    public var body: some View {
        switch kind {
        case .yourTurn:
            Text(text)
                .font(.custom(DSFonts.uiPostScriptName(weight: 600), fixedSize: 20 * k))
                .foregroundStyle(DS.Color.tutorInk)
                .fixedSize()
                .accessibilityIdentifier("sat.yourTurn")
        case .pickup:
            Text(text)
                .font(.custom(DSFonts.uiPostScriptName(weight: 600), fixedSize: 19 * k))
                .foregroundStyle(DS.Color.tutorInk)
                .fixedSize()
                .accessibilityIdentifier("sat.walk.pickup")
        case .figureLabel:
            Text(text)
                .font(.custom(DSFonts.uiPostScriptName(weight: 600), fixedSize: 26 * k))
                .foregroundStyle(DS.Color.tutorInk)
                .fixedSize()
                .accessibilityIdentifier("sat.walk.figureLabel")
        case .caption(let n, let waiting):
            HStack(spacing: 12 * k) {
                Text("\(n)")
                    .font(.custom(DSFonts.uiPostScriptName(weight: 600), fixedSize: 15 * k))
                    .foregroundStyle(waiting ? DS.Color.tutorInk : DS.Color.onInk)
                    .frame(width: 30 * k, height: 30 * k)
                    .background(Circle().fill(waiting ? DS.Color.tutorInkEmpty : DS.Color.tutorInk))
                SATText(text, size: 19 * k, color: waiting ? SATChromeColor.faint : DS.Color.tutorInk, weight: .medium)
                    .fixedSize()
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(waiting ? "sat.walk.waiting" : "sat.walk.caption.\(n)")
        }
    }
}
#endif
