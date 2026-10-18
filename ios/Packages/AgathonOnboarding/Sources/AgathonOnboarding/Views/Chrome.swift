import AgathonDesign
import SwiftUI

// The onboarding's shared pieces: the speaker (the shapes) and its speech bubble, the trail, the
// bar, the staggered entrance, the tick badge. Blocks: flat colour, no borders, no shadows.

// MARK: - Motion

enum OnboardingMotion {
    /// The speaker's jump from centre stage to the top-left: a longer travel than a press, so a
    /// longer spring with the house's one small overshoot.
    static let dock = Animation.spring(duration: 0.46, bounce: 0.28)
    /// A screen's way out: a quick fade, never a slide across the screen.
    static let out = Animation.easeOut(duration: 0.12)
    /// Answers rise 12 pt and fade in, 40 ms apart.
    static let rise: CGFloat = 12
    static let stagger = 0.04
    /// Typing: about 26 ms a letter, the whole question in at most 0.85 s (Aristotle's 0.3–0.5 s
    /// for a short question).
    static func perCharacter(_ count: Int) -> Duration {
        .milliseconds(Int(min(26, 850 / Double(max(count, 1)))))
    }
}

/// Whether a screen's answers are in. Screens read it to stagger their parts in.
struct RevealedKey: EnvironmentKey { static let defaultValue = true }

extension EnvironmentValues {
    var revealed: Bool {
        get { self[RevealedKey.self] }
        set { self[RevealedKey.self] = newValue }
    }
}

/// Rises 12 pt and fades in once the screen is revealed, `order` × 40 ms after the first part.
struct Reveal: ViewModifier {
    let order: Int
    @Environment(\.revealed) private var revealed
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .opacity(revealed ? 1 : 0)
            .offset(y: revealed || reduceMotion ? 0 : OnboardingMotion.rise)
            // in: the house snap, 40 ms apart; out: one quick 120 ms fade for everything, no stagger
            .animation(reduceMotion ? .easeInOut(duration: 0.18)
                       : (revealed ? DS.Motion.snap.delay(Double(order) * OnboardingMotion.stagger) : OnboardingMotion.out),
                       value: revealed)
    }
}

extension View {
    func reveal(_ order: Int = 0) -> some View { modifier(Reveal(order: order)) }
}

// MARK: - The speaker

/// Where the speaker stands.
enum SpeakerMode: Equatable {
    /// centre stage, the bubble above (hello, the beat)
    case centre
    /// the top-left, the bubble to the right (every question)
    case dock
    case hidden
}

/// The speech bubble: paper on chalk, 22 pt corners, a small tail pointing at the speaker. The
/// question is typed into it a letter at a time; it grows as it types.
struct SpeechBubble: View {
    /// first line in Display ("Hi."), then the rest in Title
    let lead: String?
    let text: String
    /// letters shown so far, across `lead` then `text`
    let shown: Int
    let tail: Edge

    var body: some View {
        let leadCount = lead?.count ?? 0
        VStack(alignment: .leading, spacing: 2) {
            if let lead {
                Text(String(lead.prefix(shown))).dsFont(.display, size: 60)
            }
            if shown > leadCount || lead == nil {
                Text(String(text.prefix(max(0, shown - leadCount))))
                    .dsFont(.title)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .foregroundStyle(DS.Color.ink)
        .padding(.horizontal, 24)
        .padding(.vertical, 16)
        .background(BubbleShape(tail: tail).fill(DS.Color.surface))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([lead, text].compactMap { $0 }.joined(separator: " "))
        .accessibilityAddTraits(.isHeader)
    }
}

/// A rounded rectangle with a tail on one edge, pointing at the speaker: a soft triangle 24 pt wide
/// and 13 pt deep, one flat colour with the bubble (no border, no shadow).
struct BubbleShape: Shape {
    let tail: Edge
    static let tailWidth: CGFloat = 24
    static let tailDepth: CGFloat = 13

    func path(in r: CGRect) -> Path {
        var p = Path(roundedRect: r, cornerRadius: DS.Radius.bubble, style: .continuous)
        let w = Self.tailWidth / 2
        let d = Self.tailDepth
        var tri = Path()
        switch tail {
        case .leading:
            // level with the speaker's middle: a docked bubble is one or two lines, its first line there
            let y = min(r.midY, r.minY + 34)
            tri.move(to: CGPoint(x: r.minX + 2, y: y - w))
            tri.addLine(to: CGPoint(x: r.minX - d + 3, y: y - 1.5))
            tri.addQuadCurve(to: CGPoint(x: r.minX - d + 3, y: y + 1.5), control: CGPoint(x: r.minX - d, y: y))
            tri.addLine(to: CGPoint(x: r.minX + 2, y: y + w))
        case .bottom:
            let x = r.midX
            tri.move(to: CGPoint(x: x - w, y: r.maxY - 2))
            tri.addLine(to: CGPoint(x: x - 1.5, y: r.maxY + d - 3))
            tri.addQuadCurve(to: CGPoint(x: x + 1.5, y: r.maxY + d - 3), control: CGPoint(x: x, y: r.maxY + d))
            tri.addLine(to: CGPoint(x: x + w, y: r.maxY - 2))
        default:
            break
        }
        tri.closeSubpath()
        p.addPath(tri)
        return p
    }
}

// MARK: - The trail

/// The progress trail: the skill path's own look, thin. A done step is an ink dot, the current one
/// a tomato ring, the rest small chalk-deep dots, on a 4 pt line that fills ink as it goes.
struct ProgressTrail: View {
    let count: Int
    let at: Int
    let label: String

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let step = count > 1 ? (w - 24) / CGFloat(count - 1) : 0
            ZStack(alignment: .leading) {
                Capsule().fill(DS.Color.line).frame(height: 4).padding(.horizontal, 12)
                Capsule().fill(DS.Color.ink)
                    .frame(width: max(0, step * CGFloat(at)), height: 4)
                    .padding(.leading, 12)
                ForEach(0..<count, id: \.self) { i in
                    node(i)
                        .position(x: 12 + step * CGFloat(i), y: geo.size.height / 2)
                }
            }
        }
        .frame(height: 28)
        .dsAnimation(DS.Motion.snap, value: at)
        .accessibilityElement()
        .accessibilityLabel(label)
    }

    @ViewBuilder private func node(_ i: Int) -> some View {
        if i < at {
            Circle().fill(DS.Color.ink).frame(width: 12, height: 12)
        } else if i == at {
            ZStack {
                Circle().fill(DS.Color.ground).frame(width: 26, height: 26)
                Circle().strokeBorder(DS.Color.tomato, lineWidth: 5).frame(width: 22, height: 22)
                Circle().fill(DS.Color.ink).frame(width: 7, height: 7)
            }
            .transition(.scale.combined(with: .opacity))
        } else {
            Circle().fill(DS.Palette.line.mixed(with: DS.Palette.ink, amount: 0.12).color).frame(width: 10, height: 10)
        }
    }
}

// MARK: - The tick

/// The tutor's tick, drawn in one stroke in tutor ink on a paper disc (so it reads on any card).
struct TickBadge: View {
    var diameter: CGFloat = 40
    var drawn: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Circle().fill(DS.Color.surface)
            .frame(width: diameter, height: diameter)
            .overlay(
                TickShape()
                    .trim(from: 0, to: drawn ? 1 : 0)
                    .stroke(DS.Color.tutorInk, style: StrokeStyle(lineWidth: diameter * 0.11, lineCap: .round, lineJoin: .round))
                    .padding(diameter * 0.26)
                    .animation(reduceMotion ? nil : DS.Motion.draw, value: drawn)
            )
            .scaleEffect(drawn || reduceMotion ? 1 : 0.5)
            .opacity(drawn ? 1 : 0)
            .animation(reduceMotion ? nil : DS.Motion.pop, value: drawn)
            .accessibilityHidden(true)
    }
}

// MARK: - The bar

/// Back on the left, the trail in the middle, Skip (quiet) and the read-aloud speaker on the right.
struct TopBar: View {
    let onBack: (() -> Void)?
    let trail: (count: Int, at: Int)?
    let trailLabel: String
    let onSkip: (() -> Void)?
    let skipTitle: String
    let onRead: (() -> Void)?
    let tint: Color
    let fill: DS.Fill

    var body: some View {
        HStack(spacing: 16) {
            Group {
                if let onBack {
                    RoundButton(.back, fill: fill, diameter: 52, label: "Back", action: onBack)
                        .keyboardShortcut(.escape, modifiers: [])
                } else {
                    Color.clear.frame(width: 56, height: 56)
                }
            }
            Spacer(minLength: 8)
            if let trail {
                ProgressTrail(count: trail.count, at: trail.at, label: trailLabel)
                    .frame(maxWidth: 380)
                    .transition(.opacity)
            }
            Spacer(minLength: 8)
            HStack(spacing: 8) {
                if let onSkip {
                    Button(skipTitle, action: onSkip)
                        .buttonStyle(.pill(.quiet))
                        .foregroundStyle(tint)
                }
                if let onRead {
                    RoundButton(.speaker, fill: fill, diameter: 52, label: "Read it out", action: onRead)
                }
            }
            .frame(minWidth: 56, alignment: .trailing)
        }
        .frame(height: 64)
    }
}

/// A quiet pill whose words may wrap (the accessibility sizes): no fill until pressed.
struct QuietWrapping: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .dsFont(.button)
            .foregroundStyle(DS.Color.ink)
            .padding(.horizontal, 26)
            .padding(.vertical, 10)
            .frame(minHeight: DS.Size.button)
            .background(Capsule().fill(configuration.isPressed ? DS.Fill.chalk.pressed.color : .clear))
            .contentShape(Capsule())
    }
}

// MARK: - Cards

/// A big choice: a flat card that fills ink when chosen, with the tutor's tick in its corner.
struct ChoiceCardStyle: ButtonStyle {
    let chosen: Bool
    let base: DS.Fill
    var radius: CGFloat = DS.Radius.card

    func makeBody(configuration: Configuration) -> some View {
        CardBody(configuration: configuration, chosen: chosen, base: base, radius: radius)
    }

    private struct CardBody: View {
        let configuration: Configuration
        let chosen: Bool
        let base: DS.Fill
        let radius: CGFloat
        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        var body: some View {
            let pressed = configuration.isPressed
            let fill: Color = chosen ? DS.Color.ink : (pressed ? base.pressed.color : base.background.color)
            configuration.label
                .foregroundStyle(chosen ? DS.Color.onInk : base.foreground.color)
                .background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(fill))
                .contentShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
                .scaleEffect(pressed && !reduceMotion ? DS.Motion.pressScale : 1)
                .animation(reduceMotion ? nil : (pressed ? DS.Motion.press : DS.Motion.snap), value: pressed)
                .animation(DS.Motion.fade, value: chosen)
        }
    }
}
