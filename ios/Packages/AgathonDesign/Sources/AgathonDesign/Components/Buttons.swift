import SwiftUI

// Buttons are solid pills. Press = shrink to 96 % and darken; under Reduce Motion only the colour
// changes. No borders, no shadows: shapes are made by colour alone.

/// The press effect every Blocks control shares.
struct PressEffect: ViewModifier {
    let isPressed: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .scaleEffect(isPressed && !reduceMotion ? DS.Motion.pressScale : 1)
            .animation(reduceMotion ? nil : (isPressed ? DS.Motion.press : DS.Motion.snap), value: isPressed)
    }
}

extension View {
    func pressEffect(_ isPressed: Bool) -> some View { modifier(PressEffect(isPressed: isPressed)) }
}

/// A pill button style.
public struct PillButtonStyle: ButtonStyle {
    public enum Kind: String, CaseIterable, Sendable {
        /// Ink: the main action on a screen (New board, Try again).
        case primary
        /// Sunny: go (Continue, Start). At most one per screen; on the board, Help me is the only one.
        case sunny
        /// Paper, for use on the ground.
        case secondary
        /// Chalk, for use on paper and cards.
        case secondaryOnPaper
        /// No fill until pressed: a light action (Not now, See all).
        case quiet
    }

    public enum Size: Sendable {
        /// 56 pt.
        case regular
        /// 64 pt: a screen's main button.
        case large

        var height: CGFloat { self == .large ? DS.Size.mainButton : DS.Size.button }
        var badge: CGFloat { height - 12 }
    }

    let kind: Kind
    let size: Size
    let hasBadge: Bool

    public init(_ kind: Kind = .primary, size: Size = .regular, hasBadge: Bool = false) {
        self.kind = kind
        self.size = size
        self.hasBadge = hasBadge
    }

    public func makeBody(configuration: Configuration) -> some View {
        PillBody(configuration: configuration, kind: kind, size: size, hasBadge: hasBadge)
    }

    static func fill(_ kind: Kind) -> DS.Fill {
        switch kind {
        case .primary: .ink
        case .sunny: .sunny
        case .secondary: .paper
        case .secondaryOnPaper: .chalk
        case .quiet: DS.Fill(background: DS.Palette.paper, foreground: DS.Palette.ink,
                             pressed: DS.Palette.chalk.mixed(with: DS.Palette.ink, amount: 0.04))
        }
    }

    /// The badge circle at the front of a pill: a contrasting colour from the brand.
    static func badge(_ kind: Kind) -> DS.Fill {
        switch kind {
        case .primary: .sunny
        case .sunny: DS.Fill(background: DS.Palette.ink, foreground: DS.Palette.sunny)
        case .secondary: .chalk
        case .secondaryOnPaper: .paper
        case .quiet: .chalk
        }
    }

    private struct PillBody: View {
        let configuration: Configuration
        let kind: Kind
        let size: Size
        let hasBadge: Bool
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            let fill = PillButtonStyle.fill(kind)
            let pressed = configuration.isPressed
            let background: SwiftUI.Color = !isEnabled ? DS.Color.line
                : pressed ? fill.pressed.color
                : kind == .quiet ? .clear : fill.background.color
            configuration.label
                .dsFont(.button, size: size == .large ? 21 : 19)
                .lineLimit(1)
                // too long for its room (the largest text sizes): a little smaller before it is cut
                .minimumScaleFactor(0.7)
                .foregroundStyle(isEnabled ? fill.foreground.color : DS.Color.inkSecondary)
                .padding(.leading, hasBadge ? 6 : 26)
                .padding(.trailing, 26)
                .frame(minHeight: size.height)
                .background(Capsule().fill(background))
                .contentShape(Capsule())
                .pressEffect(pressed)
        }
    }
}

extension ButtonStyle where Self == PillButtonStyle {
    /// `.buttonStyle(.pill(.sunny, size: .large))`.
    public static func pill(_ kind: PillButtonStyle.Kind = .primary, size: PillButtonStyle.Size = .regular) -> PillButtonStyle {
        PillButtonStyle(kind, size: size)
    }
}

/// A pill button with an optional icon in a badge circle at the front (the brand page's "New
/// board" and "Continue").
public struct PillButton: View {
    let title: String
    let icon: DS.Icon?
    let kind: PillButtonStyle.Kind
    let size: PillButtonStyle.Size
    let action: () -> Void
    @Environment(\.isEnabled) private var isEnabled

    public init(_ title: String, icon: DS.Icon? = nil, kind: PillButtonStyle.Kind = .primary,
                size: PillButtonStyle.Size = .regular, action: @escaping () -> Void) {
        self.title = title
        self.icon = icon
        self.kind = kind
        self.size = size
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                if let icon {
                    let badge = PillButtonStyle.badge(kind)
                    Circle()
                        .fill(isEnabled ? badge.background.color : DS.Color.ground)
                        .frame(width: size.badge, height: size.badge)
                        .overlay(DSIcon(icon, size: size.badge * 0.45)
                            .foregroundStyle(isEnabled ? badge.foreground.color : DS.Color.inkSecondary))
                }
                Text(title)
            }
        }
        .buttonStyle(PillButtonStyle(kind, size: size, hasBadge: icon != nil))
    }
}

/// Help me: the one yellow thing on the board, and the biggest (72 pt tall). The mark in ink and
/// "Help me" in Bricolage.
public struct HelpMeButton: View {
    let title: String
    let action: () -> Void

    public init(_ title: String = "Help me", action: @escaping () -> Void) {
        self.title = title
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                AgathonMark(.mono(DS.Color.ink)).frame(width: 46, height: 46)
                Text(title)
                    .font(DS.Font.fixed(.headline, size: 28))
                    .tracking(-0.03 * 28)
                    .lineLimit(1)
                    .fixedSize()
            }
        }
        .buttonStyle(HelpMeStyle())
        .accessibilityLabel(title)
    }

    private struct HelpMeStyle: ButtonStyle {
        func makeBody(configuration: Configuration) -> some View {
            configuration.label
                .foregroundStyle(DS.Color.ink)
                .padding(.leading, 18)
                .padding(.trailing, 32)
                .frame(minWidth: 210, minHeight: DS.Size.helpMe)
                .background(Capsule().fill(configuration.isPressed ? DS.Fill.sunny.pressed.color : DS.Color.helpMe))
                .contentShape(Capsule())
                .pressEffect(configuration.isPressed)
        }
    }
}

/// A round icon button (back, more, close, the mic). 56 pt by default; a smaller `diameter` keeps
/// a 56 pt tap target.
public struct RoundButton: View {
    let icon: DS.Icon
    let fill: DS.Fill
    let diameter: CGFloat
    let label: String
    let action: () -> Void

    public init(_ icon: DS.Icon, fill: DS.Fill = .paper, diameter: CGFloat = DS.Size.round, label: String? = nil,
                action: @escaping () -> Void) {
        self.icon = icon
        self.fill = fill
        self.diameter = diameter
        self.label = label ?? icon.label
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            DSIcon(icon, size: diameter * 0.42)
        }
        .buttonStyle(RoundStyle(fill: fill, diameter: diameter))
        .accessibilityLabel(label)
    }

    private struct RoundStyle: ButtonStyle {
        let fill: DS.Fill
        let diameter: CGFloat
        @Environment(\.isEnabled) private var isEnabled

        func makeBody(configuration: Configuration) -> some View {
            configuration.label
                .foregroundStyle(isEnabled ? fill.foreground.color : DS.Color.inkSecondary)
                .frame(width: diameter, height: diameter)
                .background(Circle().fill(configuration.isPressed ? fill.pressed.color : fill.background.color))
                .frame(width: max(diameter, DS.Size.minTarget), height: max(diameter, DS.Size.minTarget))
                .contentShape(Circle())
                .pressEffect(configuration.isPressed)
        }
    }
}

#Preview("Buttons") {
    VStack(alignment: .leading, spacing: 20) {
        HStack(spacing: 16) {
            PillButton("New board", icon: .plus) {}
            PillButton("Continue", icon: .play, kind: .sunny, size: .large) {}
            PillButton("See all", kind: .secondary) {}
            PillButton("Not now", kind: .quiet) {}
        }
        HStack(spacing: 16) {
            HelpMeButton {}
            RoundButton(.back) {}
            RoundButton(.mic, fill: .sunny, diameter: 64) {}
            PillButton("Disabled", icon: .plus) {}.disabled(true)
        }
    }
    .padding(40)
    .background(DS.Color.ground)
}
