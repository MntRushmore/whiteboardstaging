import AgathonBrain
import AgathonDesign
import SwiftUI

/// Everything the tutor shows over the board, for the board's `overlay` slot (laid out over the
/// canvas, in the canvas's own coordinates): the hint card beside its line, cheers beside the
/// marks, a line's readback for a moment, "Now you try one", the out-of-ink card, a quiet note.
/// Follows the camera while anything is showing.
public struct LiveOverlay: View {
    @ObservedObject var loop: LiveLoop
    let geometry: LiveCanvasGeometry
    let onGrownUp: () -> Void
    let onSpeak: ((String) -> Void)?
    @State private var outOfInkSeen = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// - Parameters:
    ///   - geometry: where page points are on screen (the app's `CanvasLiveBoard`)
    ///   - onGrownUp: the out-of-ink card's "For grown-ups" (the billing screens, behind their gate)
    ///   - onSpeak: the hint card's speaker (read aloud is Ask's lane; nil hides the button)
    public init(loop: LiveLoop, geometry: LiveCanvasGeometry, onGrownUp: @escaping () -> Void = {}, onSpeak: ((String) -> Void)? = nil) {
        self.loop = loop
        self.geometry = geometry
        self.onGrownUp = onGrownUp
        self.onSpeak = onSpeak
    }

    private var following: Bool { !loop.hints.isEmpty || !loop.cheers.isEmpty || !loop.readbacks.isEmpty }

    public var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !following)) { _ in
            ZStack(alignment: .topLeading) {
                Color.clear
                ForEach(loop.readbacks) { r in readback(r) }
                ForEach(loop.cheers) { c in cheer(c) }
                ForEach(loop.hints) { h in hintCard(h) }
            }
        }
        .overlay(alignment: .center) {
            CelebrationBurst(trigger: loop.bigBurst, size: 360)
        }
        .overlay(alignment: .bottom) {
            VStack(spacing: DS.Space.s) {
                if let note = loop.note {
                    Banner(.tutor, note, surface: .ink)
                        .frame(maxWidth: 520)
                        .onTapGesture { loop.dismissNote() }
                        .transition(.opacity)
                }
                if loop.activity == .outOfInk && !outOfInkSeen {
                    OutOfInkCard(onGrownUp: onGrownUp) { outOfInkSeen = true }
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                } else if let offer = loop.offer {
                    NowYouTryCard(offer: offer, take: { loop.takeOffer() }, notNow: { loop.dismissOffer() })
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .padding(.bottom, 120)
            .padding(.horizontal, DS.Space.xl)
            .dsAnimation(DS.Motion.snap, value: loop.offer)
            .dsAnimation(DS.Motion.snap, value: loop.note)
        }
        .onChange(of: loop.activity) { _, now in if now != .outOfInk { outOfInkSeen = false } }
        .allowsHitTesting(true)
    }

    // MARK: pieces

    private func point(_ x: Double, _ y: Double) -> CGPoint {
        geometry.viewPoint(AgathonBrain.Point(x: x, y: y))
    }

    private func readback(_ r: Readback) -> some View {
        let at = point(r.anchor.x, r.anchor.maxY)
        return Text(MathText.plain(r.latex))
            .dsFont(.callout, size: 17)
            .foregroundStyle(DS.Color.inkSecondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Capsule().fill(DS.Color.surfaceSunken))
            .fixedSize()
            .alignmentGuide(.leading) { _ in -at.x }
            .alignmentGuide(.top) { _ in -(at.y + 6) }
            .transition(.opacity)
            .allowsHitTesting(false)
            .accessibilityLabel("The tutor read: \(MathText.plain(r.latex))")
    }

    private func cheer(_ c: Cheer) -> some View {
        let at = point(c.at.x, c.at.y)
        return CheerBubble(cheer: c)
            .alignmentGuide(.leading) { _ in -(at.x + 12) }
            .alignmentGuide(.top) { d in -(at.y - d.height / 2) }
            .allowsHitTesting(false)
    }

    @ViewBuilder
    private func hintCard(_ h: HintCard) -> some View {
        let size = geometry.viewSize
        // clear of the ring a ringed line wears (the widest thing round a line)
        let ring = LiveMarks.ringRect(h.anchor)
        let below = point(h.anchor.x, ring.maxY)
        let above = point(h.anchor.x, ring.y)
        let width = min(380, max(260, size.width - 32))
        let x = min(max(16, below.x - 12), size.width - width - 16)
        let roomBelow = size.height - below.y > 260
        HintCardView(card: h, pointsUp: roomBelow, onGotIt: { loop.dismissHint(h.id) }, onMore: { loop.moreHelp(h) }, onSpeak: onSpeak)
            .frame(width: width)
            .alignmentGuide(.leading) { _ in -x }
            .alignmentGuide(.top) { d in roomBelow ? -(below.y + 14) : -(above.y - 14 - d.height) }
            .transition(reduceMotion ? .opacity : .scale(scale: 0.9, anchor: roomBelow ? .topLeading : .bottomLeading).combined(with: .opacity))
    }
}

/// The tutor's hint: a cobalt bubble pointing at its line, its words, and Got it / More help.
public struct HintCardView: View {
    let card: HintCard
    let pointsUp: Bool
    let onGotIt: () -> Void
    let onMore: () -> Void
    let onSpeak: ((String) -> Void)?

    public init(card: HintCard, pointsUp: Bool = true, onGotIt: @escaping () -> Void, onMore: @escaping () -> Void, onSpeak: ((String) -> Void)? = nil) {
        self.card = card
        self.pointsUp = pointsUp
        self.onGotIt = onGotIt
        self.onMore = onMore
        self.onSpeak = onSpeak
    }

    private var spoken: String { [card.message, card.question].compactMap { $0 }.joined(separator: " ") }

    public var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.s) {
            HStack(alignment: .center, spacing: DS.Space.xs) {
                Text(card.title).dsFont(.label).foregroundStyle(DS.Color.onInk)
                Spacer(minLength: 0)
                if let onSpeak {
                    Button { onSpeak(spoken) } label: {
                        DSIcon(.speaker, size: 20).foregroundStyle(DS.Color.onInk)
                            .frame(width: 44, height: 44)
                            .background(Circle().fill(DS.Color.cobaltDeep))
                            .frame(width: DS.Size.minTarget, height: DS.Size.minTarget)
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(LiveCopy.Hint.readAloud)
                }
            }
            Text(MathText.plain(card.message)).dsFont(.body, size: 19).foregroundStyle(DS.Color.onInk)
                .fixedSize(horizontal: false, vertical: true)
            if let q = card.question, !q.isEmpty {
                Text(MathText.plain(q)).dsFont(.callout).foregroundStyle(DS.Color.onInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: DS.Space.xs) {
                CardButton(LiveCopy.Hint.gotIt, fill: DS.Color.paper, text: DS.Color.ink, action: onGotIt)
                    .accessibilityIdentifier("live.hint.gotIt")
                CardButton(LiveCopy.Hint.moreHelp, fill: DS.Color.cobaltDeep, text: DS.Color.onInk, action: onMore)
                    .accessibilityIdentifier("live.hint.more")
            }
        }
        .padding(DS.Space.l)
        .background(
            UnevenRoundedRectangle(topLeadingRadius: pointsUp ? DS.Radius.bubbleTail : DS.Radius.card,
                                   bottomLeadingRadius: pointsUp ? DS.Radius.card : DS.Radius.bubbleTail,
                                   bottomTrailingRadius: DS.Radius.card, topTrailingRadius: DS.Radius.card, style: .continuous)
                .fill(DS.Color.tutorInk)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Hint from your tutor")
        .accessibilityIdentifier("live.hint")
    }
}

/// A pill on a coloured card (no border, no shadow; pressed is a shade darker).
struct CardButton: View {
    let title: String
    let fill: Color
    let text: Color
    let action: () -> Void

    init(_ title: String, fill: Color, text: Color, action: @escaping () -> Void) {
        self.title = title
        self.fill = fill
        self.text = text
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Text(title).dsFont(.button, size: 18).lineLimit(1)
        }
        .buttonStyle(Style(fill: fill, text: text))
    }

    struct Style: ButtonStyle {
        let fill: Color
        let text: Color
        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        func makeBody(configuration: Configuration) -> some View {
            configuration.label
                .foregroundStyle(text)
                .padding(.horizontal, 22)
                .frame(minHeight: DS.Size.button)
                .background(Capsule().fill(fill).brightness(configuration.isPressed ? -0.06 : 0))
                .contentShape(Capsule())
                .scaleEffect(configuration.isPressed && !reduceMotion ? DS.Motion.pressScale : 1)
        }
    }
}

/// A cheer beside a mark: sunny praise for a tick (with the streak from three), a kind word for a ring.
struct CheerBubble: View {
    let cheer: Cheer
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    var body: some View {
        Group {
            switch cheer.tone {
            case .win, .solved:
                HStack(spacing: 8) {
                    Text(cheer.text).dsFont(.button, size: 20)
                    if cheer.streak >= LiveCopy.Cheers.streakFrom {
                        HStack(spacing: 4) {
                            DSIcon(.flame, size: 16)
                            Text(LiveCopy.Cheers.streak(cheer.streak)).dsFont(.caption, size: 14).fontWeight(.semibold)
                        }
                        .foregroundStyle(DS.Color.ink)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(DS.Color.paper))
                    }
                }
                .foregroundStyle(DS.Color.ink)
                .padding(.horizontal, 20)
                .frame(minHeight: 48)
                .background(Capsule().fill(DS.Color.sunny))
            case .miss:
                // "Look again": a nudge in the sunny of Help me, on chalk so it shows on the white page
                HStack(spacing: 8) {
                    Circle().fill(DS.Color.tryAgain).frame(width: 28, height: 28)
                        .overlay(DSIcon(.lookAgain, size: 14).foregroundStyle(DS.Color.ink))
                    Text(cheer.text).dsFont(.button, size: 17).foregroundStyle(DS.Color.ink)
                }
                .padding(.leading, 8)
                .padding(.trailing, 18)
                .frame(minHeight: 44)
                .background(Capsule().fill(DS.Color.surfaceSunken))
            }
        }
        .fixedSize()
        .scaleEffect(shown || reduceMotion ? 1 : 0.6, anchor: .leading)
        .opacity(shown || reduceMotion ? 1 : 0)
        .onAppear { withDSAnimation(DS.Motion.pop, reduceMotion: reduceMotion) { shown = true } }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
    }
}

/// "Now you try one": a cobalt card (it is the tutor's) with the new problem in its hand.
public struct NowYouTryCard: View {
    let offer: NowYouTryOffer
    let take: () -> Void
    let notNow: () -> Void

    public init(offer: NowYouTryOffer, take: @escaping () -> Void, notNow: @escaping () -> Void) {
        self.offer = offer
        self.take = take
        self.notNow = notNow
    }

    public var body: some View {
        Card(.cobalt, radius: DS.Radius.cardLarge, padding: DS.Space.l) {
            Text(LiveCopy.NowYouTry.title).dsFont(.label).foregroundStyle(DS.Color.onInk)
            Text(offer.problem.map(MathText.plain).joined(separator: "\n"))
                .dsFont(.tutorHand, size: 34)
                .foregroundStyle(DS.Color.onInk)
            HStack(spacing: DS.Space.xs) {
                PillButton(LiveCopy.NowYouTry.go, icon: .pen, kind: .secondary, size: .large, action: take)
                    .accessibilityLabel(LiveCopy.NowYouTry.goLabel)
                    .accessibilityIdentifier("live.nowYouTry")
                CardButton(LiveCopy.NowYouTry.notNow, fill: DS.Color.cobaltDeep, text: DS.Color.onInk, action: notNow)
            }
        }
        .frame(maxWidth: 460)
        .accessibilityElement(children: .contain)
    }
}

/// Out of ink: the shapes resting, "Help is paused for now. Ask a grown-up." Never a price.
public struct OutOfInkCard: View {
    let onGrownUp: () -> Void
    let onOK: () -> Void

    public init(onGrownUp: @escaping () -> Void, onOK: @escaping () -> Void) {
        self.onGrownUp = onGrownUp
        self.onOK = onOK
    }

    public var body: some View {
        Card(.paper, radius: DS.Radius.cardLarge, padding: DS.Space.l) {
            HStack(alignment: .center, spacing: DS.Space.l) {
                TheShapes(.outOfInk).frame(width: 140)
                VStack(alignment: .leading, spacing: DS.Space.xs) {
                    Text(LiveCopy.OutOfInk.title).dsFont(.headline).foregroundStyle(DS.Color.ink)
                    Text(LiveCopy.OutOfInk.message).dsFont(.body).foregroundStyle(DS.Color.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: DS.Space.xs) {
                        PillButton(LiveCopy.OutOfInk.grownUp, icon: .lock, kind: .secondaryOnPaper, action: onGrownUp)
                        PillButton(LiveCopy.Status.ok, kind: .quiet, action: onOK)
                    }
                    .padding(.top, DS.Space.xxs)
                }
            }
        }
        .frame(maxWidth: 560)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("live.outOfInk")
    }
}
