import SwiftUI

// MARK: - Card

/// A card: a solid colour with 28 pt corners. No border, no shadow: a card on the ground is
/// paper; a card that matters is cobalt (the tutor's, like Today's practice) or sunny (the path).
public struct Card<Content: View>: View {
    public enum Kind: String, CaseIterable, Sendable {
        case paper, chalk, cobalt, sunny, ink

        var fill: DS.Fill {
            switch self {
            case .paper: .paper
            case .chalk: .chalk
            case .cobalt: .cobalt
            case .sunny: .sunny
            case .ink: .ink
            }
        }

        /// The deco ring and dot: the same colour, one step deeper.
        var deco: RGB {
            switch self {
            case .paper: DS.Palette.chalk
            case .chalk: DS.Palette.rule
            case .cobalt: DS.Palette.cobaltDeep
            case .sunny: DS.Palette.sunny.mixed(with: DS.Palette.tomato, amount: 0.14)
            case .ink: DS.Palette.ink.mixed(with: DS.Palette.white, amount: 0.07)
            }
        }
    }

    let kind: Kind
    let radius: CGFloat
    let padding: CGFloat
    let deco: Bool
    let fillsHeight: Bool
    let content: Content

    /// Several views inside stack top to bottom, 12 pt apart. `deco` puts the mark's ring and dot,
    /// big and one shade deeper, in the bottom-right corner. `fillsHeight` stretches the card to the
    /// height it's offered: cards in an `HStack` with `.fixedSize(horizontal: false, vertical: true)`
    /// then come out the same height.
    public init(_ kind: Kind = .paper, radius: CGFloat = DS.Radius.card, padding: CGFloat = DS.Space.xl,
                deco: Bool = false, fillsHeight: Bool = false, @ViewBuilder content: () -> Content) {
        self.kind = kind
        self.radius = radius
        self.padding = padding
        self.deco = deco
        self.fillsHeight = fillsHeight
        self.content = content()
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.s) { content }
            .foregroundStyle(kind.fill.foreground.color)
            .padding(padding)
            .frame(maxWidth: .infinity, maxHeight: fillsHeight ? .infinity : nil, alignment: .topLeading)
            .background(alignment: .bottomTrailing) {
                if deco { CardDeco(color: kind.deco.color).offset(x: 70, y: 90).accessibilityHidden(true) }
            }
            .background(kind.fill.background.color)
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
    }
}

/// The ring and dot from the mark, as card decoration (260 pt; the brand page's Today card).
public struct CardDeco: View {
    let color: SwiftUI.Color
    let size: CGFloat
    public init(color: SwiftUI.Color, size: CGFloat = 260) {
        self.color = color
        self.size = size
    }
    public var body: some View {
        ZStack {
            Circle().strokeBorder(color, lineWidth: size * 56 / 260)
                .frame(width: size * (95 * 2 + 56) / 260, height: size * (95 * 2 + 56) / 260)
            Circle().fill(color).frame(width: size * 52 / 260, height: size * 52 / 260)
        }
        .frame(width: size, height: size)
    }
}

// MARK: - Chips and tags

/// A chip the kid can tap ("3 more like these"). 52 pt tall, with a 56 pt target.
public struct Chip: View {
    let title: String
    let icon: DS.Icon?
    let onPaper: Bool
    let action: () -> Void

    /// `onPaper`: chalk on a paper surface (the Ask panel); otherwise paper on the ground.
    public init(_ title: String, icon: DS.Icon? = nil, onPaper: Bool = true, action: @escaping () -> Void) {
        self.title = title
        self.icon = icon
        self.onPaper = onPaper
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let icon { DSIcon(icon, size: 18) }
                Text(title).dsFont(.button, size: 16).lineLimit(1)
            }
        }
        .buttonStyle(ChipStyle(fill: onPaper ? .chalk : .paper))
    }

    private struct ChipStyle: ButtonStyle {
        let fill: DS.Fill
        func makeBody(configuration: Configuration) -> some View {
            configuration.label
                .foregroundStyle(fill.foreground.color)
                .padding(.horizontal, 18)
                .frame(minHeight: 52)
                .background(Capsule().fill(configuration.isPressed ? fill.pressed.color : fill.background.color))
                .padding(.vertical, 2)
                .contentShape(Capsule())
                .pressEffect(configuration.isPressed)
        }
    }
}

/// A small label that isn't a control ("Next up", "Screen 1").
public struct Tag: View {
    public enum Style: Sendable {
        /// Sunny capitals on ink: "NEXT UP".
        case ink
        /// Ink on chalk: "Screen 1".
        case chalk
        /// Ink on paper.
        case paper
        /// Ink on sunny.
        case sunny
    }

    let title: String
    let style: Style

    public init(_ title: String, style: Style = .chalk) {
        self.title = title
        self.style = style
    }

    public var body: some View {
        Group {
            if style == .ink {
                Text(title).dsFont(.label, size: 13).foregroundStyle(DS.Color.sunny)
            } else {
                Text(title).dsFont(.caption, size: 13).fontWeight(.medium).foregroundStyle(DS.Color.ink)
            }
        }
        .lineLimit(1)
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(Capsule().fill(background))
    }

    private var background: SwiftUI.Color {
        switch style {
        case .ink: DS.Color.ink
        case .chalk: DS.Color.surfaceSunken
        case .paper: DS.Color.surface
        case .sunny: DS.Color.sunny
        }
    }
}

/// What the tutor is doing, at the top of the board: a cobalt dot and a word ("Checking…").
public struct StatusPill: View {
    let title: String
    let dot: SwiftUI.Color
    let pulses: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var on = false

    public init(_ title: String, dot: SwiftUI.Color = DS.Color.tutorInk, pulses: Bool = true) {
        self.title = title
        self.dot = dot
        self.pulses = pulses
    }

    public var body: some View {
        HStack(spacing: 9) {
            Circle().fill(dot).frame(width: 12, height: 12)
                .scaleEffect(pulses && on && !reduceMotion ? 0.7 : 1)
            Text(title).dsFont(.callout, size: 15).fontWeight(.medium).lineLimit(1).fixedSize()
        }
        .foregroundStyle(DS.Color.ink)
        .padding(.leading, 12)
        .padding(.trailing, 16)
        .frame(minHeight: 40)
        .background(Capsule().fill(DS.Color.surface))
        .onAppear {
            guard pulses, !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true)) { on = true }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - People

/// A kid's avatar: their initial on a solid circle.
public struct Avatar: View {
    let initial: String
    let color: RGB
    let diameter: CGFloat

    public init(_ name: String, color: RGB = DS.Palette.tomato, diameter: CGFloat = DS.Size.avatar) {
        initial = String(name.prefix(1)).uppercased()
        self.color = color
        self.diameter = diameter
    }

    public var body: some View {
        Circle().fill(color.color)
            .frame(width: diameter, height: diameter)
            .overlay(
                Text(initial)
                    .font(DS.Font.fixed(.headline, size: diameter * 0.48))
                    .foregroundStyle(color.contrast(with: DS.Palette.white) >= 3 ? DS.Color.onInk : DS.Color.ink)
            )
            .accessibilityHidden(true)
    }
}

/// The kid's name chip at the top of Home: avatar and name on a paper pill.
public struct ProfileChip: View {
    let name: String
    let color: RGB
    let action: () -> Void

    public init(_ name: String, color: RGB = DS.Palette.tomato, action: @escaping () -> Void) {
        self.name = name
        self.color = color
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Avatar(name, color: color)
                Text(name).dsFont(.button, size: 17).lineLimit(1)
            }
        }
        .buttonStyle(ProfileStyle())
        .accessibilityLabel("\(name). Switch profile")
    }

    private struct ProfileStyle: ButtonStyle {
        func makeBody(configuration: Configuration) -> some View {
            configuration.label
                .foregroundStyle(DS.Color.ink)
                .padding(.leading, 8)
                .padding(.trailing, 22)
                .frame(minHeight: DS.Size.minTarget)
                .background(Capsule().fill(configuration.isPressed ? DS.Fill.paper.pressed.color : DS.Color.surface))
                .contentShape(Capsule())
                .pressEffect(configuration.isPressed)
        }
    }
}

// MARK: - Chat

/// A message in Ask. The tutor's bubbles are cobalt, as its ink is on the board; the kid's are chalk.
public struct ChatBubble: View {
    public enum From: Sendable { case tutor, kid }

    let text: String
    let from: From
    let icon: DS.Icon?

    public init(_ text: String, from: From, icon: DS.Icon? = nil) {
        self.text = text
        self.from = from
        self.icon = icon
    }

    public var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            if let icon { DSIcon(icon, size: 16).foregroundStyle(DS.Color.inkSecondary) }
            Text(text).dsFont(.callout)
        }
        .foregroundStyle(from == .tutor ? DS.Color.onInk : DS.Color.ink)
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(
            UnevenRoundedRectangle(
                topLeadingRadius: DS.Radius.bubble,
                bottomLeadingRadius: from == .tutor ? DS.Radius.bubbleTail : DS.Radius.bubble,
                bottomTrailingRadius: from == .kid ? DS.Radius.bubbleTail : DS.Radius.bubble,
                topTrailingRadius: DS.Radius.bubble, style: .continuous
            )
            .fill(from == .tutor ? DS.Color.tutorInk : DS.Color.surfaceSunken)
        )
        .frame(maxWidth: .infinity, alignment: from == .tutor ? .leading : .trailing)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(from == .tutor ? "Tutor: \(text)" : "You: \(text)")
    }
}

#Preview("Surfaces") {
    VStack(spacing: 20) {
        HStack(spacing: 20) {
            Card(.cobalt, radius: DS.Radius.cardLarge, deco: true) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Today's practice").dsFont(.label)
                    Text("5 problems").dsFont(.display, size: 56)
                }
            }
            Card(.sunny, radius: DS.Radius.cardLarge) {
                HStack { Tag("Next up", style: .ink); Text("Adding fractions").dsFont(.headline, size: 30) }
            }
        }
        HStack {
            Chip("3 more like these") {}
            Chip("Show me with pizza") {}
            StatusPill("Checking…")
            ProfileChip("Maya") {}
        }
        ChatBubble("Hi Maya! Ask me anything, and I can write on your board too.", from: .tutor)
        ChatBubble("why can't I just add the tops?", from: .kid, icon: .mic)
    }
    .padding(40)
    .background(DS.Color.ground)
}
