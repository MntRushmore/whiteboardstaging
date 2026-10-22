import AgathonDesign
import SwiftUI

// The pieces a problem page shows over the board (docs/PROBLEM-PAGES.md; Blocks, flat colour):
// the "I read" chip, "Fix what I read" with its maths keypad, Check and Next in the page's action
// corner, "New page for this one", and the All done card. Each takes plain values and callbacks, so
// the overlay wires them to the loop and the Labs and snapshots show them alone.

// MARK: - "I read"

/// A line's reading, quiet: chalk, the label in caps, the reading in Lexend. Asking: pale sunny with
/// "Is this right?". Unread: "I couldn't read this. Tap to fix." Fixed: a pen mark. A tap opens
/// "Fix what I read".
public struct ReadbackChip: View {
    let reading: LineReading
    let onTap: (() -> Void)?

    public init(reading: LineReading, onTap: (() -> Void)? = nil) {
        self.reading = reading
        self.onTap = onTap
    }

    /// pale sunny: sunny mixed with paper, flat (no transparency on the page)
    static let askingFill = Color(red: 0xFF / 255, green: 0xF4 / 255, blue: 0xC9 / 255)

    private var plain: String { MathText.plain(reading.latex) }

    public var body: some View {
        let chip = HStack(spacing: 8) {
            switch reading.state {
            case .unread:
                Text(LiveCopy.Reading.unread).dsFont(.caption, size: 14).foregroundStyle(DS.Color.ink)
            case .read, .asking, .fixed:
                Text(LiveCopy.Reading.iRead.uppercased()).dsFont(.label, size: 11).foregroundStyle(DS.Color.inkSecondary)
                Text(plain).dsFont(.callout, size: 16).foregroundStyle(DS.Color.ink).lineLimit(1)
            }
            if reading.state == .fixed {
                DSIcon(.pen, size: 12).foregroundStyle(DS.Color.inkSecondary)
            }
            if reading.state == .asking || reading.state == .unread {
                Text(reading.state == .asking ? LiveCopy.Reading.isThisRight : LiveCopy.Reading.tapToFix).dsFont(.caption, size: 13).fontWeight(.semibold)
                    .foregroundStyle(DS.Color.ink).underline()
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 34)
        .background(Capsule().fill(reading.state == .asking || reading.state == .unread ? Self.askingFill : DS.Color.surfaceSunken))
        .fixedSize()

        Group {
            if let onTap {
                Button(action: onTap) { chip.contentShape(Capsule().inset(by: -6)) }
                    .buttonStyle(.plain)
                    .accessibilityLabel(reading.state == .unread ? LiveCopy.Reading.unread
                                        : reading.state == .asking ? LiveCopy.Reading.asking(plain) : LiveCopy.Reading.spoken(plain))
                    .accessibilityHint(LiveCopy.Reading.tapToFix)
            } else {
                chip.accessibilityElement(children: .combine)
            }
        }
        .accessibilityIdentifier("live.reading")
    }
}

// MARK: - Fix what I read

/// "Fix what I read": the reading, big, and "Yes, that's right"; what it may have been; or type it on
/// the maths keypad. Nothing changes without a tap.
public struct FixReadingSheet: View {
    let fix: ReadingFix
    let onUse: (String) -> Void
    let onConfirm: () -> Void
    let onCancel: () -> Void
    @State private var typed: String

    public init(fix: ReadingFix, onUse: @escaping (String) -> Void, onConfirm: @escaping () -> Void, onCancel: @escaping () -> Void) {
        self.fix = fix
        self.onUse = onUse
        self.onConfirm = onConfirm
        self.onCancel = onCancel
        _typed = State(initialValue: fix.unread ? "" : PlainMath.plain(fix.latex))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.m) {
            SheetHeader(LiveCopy.Reading.sheetTitle, onClose: onCancel)
            VStack(alignment: .leading, spacing: 6) {
                Text(LiveCopy.Reading.iRead.uppercased()).dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
                HStack(alignment: .center, spacing: DS.Space.m) {
                    Text(fix.unread || fix.latex.isEmpty ? "?" : MathText.plain(fix.latex)).dsFont(.title, size: 34).foregroundStyle(DS.Color.ink)
                        .accessibilityIdentifier("live.fix.reading")
                    Spacer(minLength: 0)
                    if !fix.unread && !fix.latex.isEmpty {
                        PillButton(LiveCopy.Reading.yesRight, icon: .check, kind: .secondaryOnPaper, action: onConfirm)
                            .accessibilityIdentifier("live.fix.confirm")
                    }
                }
            }
            if !fix.alternatives.isEmpty {
                VStack(alignment: .leading, spacing: DS.Space.xs) {
                    Text(LiveCopy.Reading.didYouMean.uppercased()).dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
                    FlowStack(spacing: DS.Space.xs) {
                        ForEach(Array(fix.alternatives.prefix(3).enumerated()), id: \.offset) { i, alt in
                            Button { onUse(alt) } label: {
                                Text(MathText.plain(alt)).dsFont(.heading, size: 22)
                                    .foregroundStyle(i == 0 ? DS.Color.onInk : DS.Color.ink)
                                    .padding(.horizontal, 22)
                                    .frame(minHeight: DS.Size.minTarget)
                                    .background(Capsule().fill(i == 0 ? DS.Color.ink : DS.Color.surfaceSunken))
                                    .contentShape(Capsule())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("I meant \(MathText.plain(alt))")
                            .accessibilityIdentifier("live.fix.alt\(i)")
                        }
                    }
                }
            }
            VStack(alignment: .leading, spacing: DS.Space.xs) {
                Text(LiveCopy.Reading.typeIt.uppercased()).dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
                HStack(spacing: 0) {
                    Text(typed.isEmpty ? " " : typed).dsFont(.heading, size: 28).foregroundStyle(DS.Color.ink).lineLimit(1)
                        .minimumScaleFactor(0.5)
                    Rectangle().fill(DS.Color.focus).frame(width: 3, height: 30).padding(.leading, 2)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 24)
                .frame(height: DS.Size.field + 4)
                .background(Capsule().fill(DS.Color.surfaceSunken))
                .overlay(Capsule().strokeBorder(DS.Color.focus, lineWidth: DS.Stroke.focus))
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Typed: \(typed)")
                .accessibilityIdentifier("live.fix.typed")
                MathKeypad(text: $typed)
            }
            HStack(spacing: DS.Space.xs) {
                Spacer()
                PillButton(LiveCopy.Reading.cancel, kind: .secondaryOnPaper, action: onCancel)
                PillButton(LiveCopy.Reading.use, kind: .primary) { onUse(PlainMath.latex(typed)) }
                    .disabled(typed.trimmingCharacters(in: .whitespaces).isEmpty)
                    .accessibilityIdentifier("live.fix.use")
            }
        }
        .padding(DS.Space.xl)
        .frame(width: 560)
        .background(DS.Color.surface)
        // a container: its controls keep their own ids (a container's id on its own overrides them)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("live.fix")
    }
}

/// The maths keypad: 56 pt keys, no system keyboard. Edits plain maths at its end (`PlainMath`
/// turns it into LaTeX).
public struct MathKeypad: View {
    @Binding var text: String

    public init(text: Binding<String>) {
        _text = text
    }

    /// what a key types (its face, and the text it adds)
    struct Key: Hashable {
        let face: String
        let types: String
        var op = false
        var label: String?
    }

    static let rows: [[Key]] = [
        [Key(face: "7", types: "7"), Key(face: "8", types: "8"), Key(face: "9", types: "9"), Key(face: "÷", types: "÷", op: true, label: "divided by"),
         Key(face: "⌫", types: "", op: true, label: LiveCopy.Reading.delete)],
        [Key(face: "4", types: "4"), Key(face: "5", types: "5"), Key(face: "6", types: "6"), Key(face: "×", types: "×", op: true, label: "times"),
         Key(face: "(", types: "(", op: true, label: "open bracket")],
        [Key(face: "1", types: "1"), Key(face: "2", types: "2"), Key(face: "3", types: "3"), Key(face: "−", types: "−", op: true, label: "minus"),
         Key(face: ")", types: ")", op: true, label: "close bracket")],
        [Key(face: "0", types: "0"), Key(face: ".", types: ".", label: "point"), Key(face: "=", types: " = ", op: true, label: "equals"),
         Key(face: "+", types: "+", op: true, label: "plus"), Key(face: "x", types: "x", op: true)],
        [Key(face: "y", types: "y", op: true), Key(face: "a/b", types: "/", op: true, label: "fraction"), Key(face: "xⁿ", types: "^", op: true, label: "power"),
         Key(face: "√", types: "√", op: true, label: "square root"), Key(face: "n", types: "n", op: true)],
    ]

    public var body: some View {
        Grid(horizontalSpacing: 8, verticalSpacing: 8) {
            ForEach(Self.rows, id: \.self) { row in
                GridRow {
                    ForEach(row, id: \.self) { key in
                        Button { press(key) } label: {
                            Text(key.face).dsFont(.heading, size: 24).foregroundStyle(DS.Color.ink)
                                .frame(width: 72, height: DS.Size.minTarget)
                                .background(RoundedRectangle(cornerRadius: 16, style: .continuous)
                                    .fill(key.op ? DS.Color.line : DS.Color.surfaceSunken))
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(key.label ?? key.face)
                        .accessibilityIdentifier("live.key.\(key.label ?? key.face)")
                    }
                }
            }
        }
        .frame(maxWidth: .infinity)
    }

    func press(_ key: Key) {
        if key.face == "⌫" {
            // a spaced relation goes as one
            if text.hasSuffix(" = ") { text.removeLast(3) } else if !text.isEmpty { text.removeLast() }
            return
        }
        text += key.types
    }
}

// MARK: - The page's action corner

/// Check: the kid says done. Ink, as big as Help me, a tick in its badge.
public struct CheckButton: View {
    let action: () -> Void

    public init(action: @escaping () -> Void) {
        self.action = action
    }

    public var body: some View {
        BigPageButton(title: LiveCopy.Pages.check, icon: .check, badge: DS.Color.onInkFaint, badgeInk: DS.Color.onInk, action: action)
            .accessibilityLabel(LiveCopy.Pages.checkLabel)
            .accessibilityIdentifier("live.check")
    }
}

/// Next problem (or All done on the set's last): ink, a sunny badge — the go button.
public struct NextButton: View {
    let last: Bool
    let action: () -> Void

    public init(last: Bool, action: @escaping () -> Void) {
        self.last = last
        self.action = action
    }

    public var body: some View {
        BigPageButton(title: last ? LiveCopy.Pages.allDone : LiveCopy.Pages.next, icon: last ? .star : .forward,
                      badge: DS.Color.sunny, badgeInk: DS.Color.ink, action: action)
            .accessibilityLabel(last ? LiveCopy.Pages.allDone : LiveCopy.Pages.nextLabel)
            .accessibilityIdentifier("live.next")
    }
}

/// The page corner's big pill: 72 pt, Bricolage, ink.
struct BigPageButton: View {
    let title: String
    let icon: DS.Icon
    let badge: Color
    let badgeInk: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Circle().fill(badge).frame(width: 48, height: 48)
                    .overlay(DSIcon(icon, size: 22).foregroundStyle(badgeInk))
                Text(title).font(DS.Font.fixed(.headline, size: 28)).tracking(-0.03 * 28).lineLimit(1).fixedSize()
            }
            .foregroundStyle(DS.Color.onInk)
            .padding(.leading, 12)
            .padding(.trailing, 30)
            .frame(minHeight: DS.Size.helpMe)
            .background(Capsule().fill(DS.Color.ink))
            .contentShape(Capsule())
        }
        .buttonStyle(PressStyle())
    }

    struct PressStyle: ButtonStyle {
        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        func makeBody(configuration: Configuration) -> some View {
            configuration.label
                .brightness(configuration.isPressed ? -0.06 : 0)
                .scaleEffect(configuration.isPressed && !reduceMotion ? DS.Motion.pressScale : 1)
        }
    }
}

/// "More room": the page is getting full, so this problem goes on on a new page. Chalk on the page
/// (quieter than Check, which is the page's go button), as big as a page button gets (64 pt), a plus in
/// its badge.
public struct MoreRoomButton: View {
    let action: () -> Void

    public init(action: @escaping () -> Void) {
        self.action = action
    }

    public var body: some View {
        PillButton(LiveCopy.Pages.moreRoom, icon: .plus, kind: .secondaryOnPaper, size: .large, action: action)
            .fixedSize()
            .accessibilityLabel(LiveCopy.Pages.moreRoomLabel)
            .accessibilityIdentifier("live.moreRoom")
    }
}

/// "New page for this one" under a second problem's first line, and a quiet "Keep it here".
public struct NewPageOfferBar: View {
    let take: () -> Void
    let keep: () -> Void

    public init(take: @escaping () -> Void, keep: @escaping () -> Void) {
        self.take = take
        self.keep = keep
    }

    public var body: some View {
        HStack(spacing: DS.Space.xs) {
            PillButton(LiveCopy.Pages.newPage, icon: .plus, kind: .primary, size: .large, action: take)
                .accessibilityLabel(LiveCopy.Pages.newPageLabel)
                .accessibilityIdentifier("live.newPage")
            PillButton(LiveCopy.Pages.keepHere, kind: .secondaryOnPaper, action: keep)
                .accessibilityIdentifier("live.keepHere")
        }
        .fixedSize()
    }
}

// MARK: - All done

/// The set's end: the shapes celebrating, "All done.", a sticker for each problem (a star: on your
/// own; a ring: with a hint), Back to my boards and More like these. A problem not finished is a
/// small "Not yet" that goes to its page.
public struct AllDoneCard: View {
    let problems: [SetProblem]
    let onProblem: (SetProblem) -> Void
    let onBack: (() -> Void)?
    let onMore: (() -> Void)?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(problems: [SetProblem], onProblem: @escaping (SetProblem) -> Void, onBack: (() -> Void)? = nil, onMore: (() -> Void)? = nil) {
        self.problems = problems
        self.onProblem = onProblem
        self.onBack = onBack
        self.onMore = onMore
    }

    private var alone: Int { problems.filter { $0.outcome == .alone }.count }
    private var finished: Int { problems.filter { $0.outcome != .notYet }.count }

    public var body: some View {
        VStack(spacing: DS.Space.l) {
            TheShapes(.celebrate, animated: !reduceMotion).frame(width: 200)
            VStack(spacing: DS.Space.xs) {
                Text(LiveCopy.Pages.allDoneTitle).dsFont(.display).foregroundStyle(DS.Color.ink)
                Text(LiveCopy.Pages.allDoneLine(finished, alone: alone)).dsFont(.body, size: 22).foregroundStyle(DS.Color.inkSecondary)
            }
            HStack(spacing: DS.Space.l) {
                ForEach(problems) { p in
                    Button { onProblem(p) } label: {
                        VStack(spacing: 6) {
                            Group {
                                switch p.outcome {
                                case .alone: Sticker(.star, size: 64)
                                case .withHelp: Sticker(.ring, size: 64)
                                case .together, .notYet:
                                    Circle().fill(DS.Color.onInkFaint).frame(width: 40, height: 40).frame(width: 64, height: 64)
                                }
                            }
                            Text(p.outcome == .notYet ? LiveCopy.Pages.notYet : "\(p.number)")
                                .dsFont(.label, size: 13).foregroundStyle(DS.Color.onInkSecondary)
                        }
                        .frame(minWidth: DS.Size.minTarget, minHeight: DS.Size.minTarget)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(LiveCopy.Pages.stickerLabel(p.number, Self.words(p.outcome)))
                }
            }
            .padding(.horizontal, DS.Space.xl)
            .padding(.vertical, DS.Space.l)
            .background(RoundedRectangle(cornerRadius: DS.Radius.cardLarge, style: .continuous).fill(DS.Color.ink))
            HStack(spacing: DS.Space.s) {
                if let onBack { PillButton(LiveCopy.Pages.backToBoards, kind: .secondaryOnPaper, action: onBack) }
                if let onMore { PillButton(LiveCopy.Pages.moreLikeThese, icon: .plus, kind: .primary, action: onMore) }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("live.allDone")
    }

    static func words(_ o: SetProblem.Outcome) -> String {
        switch o {
        case .alone: return LiveCopy.Pages.onYourOwn
        case .withHelp: return LiveCopy.Pages.withAHint
        case .together: return LiveCopy.Pages.withHelp
        case .notYet: return LiveCopy.Pages.notYet
        }
    }
}
