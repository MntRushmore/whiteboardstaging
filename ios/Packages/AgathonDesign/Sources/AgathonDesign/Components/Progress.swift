import SwiftUI

// MARK: - Progress ring

/// A ring that fills clockwise from the top: the mark's ring. When it's full, the dot drops into
/// the middle, and the ring and dot together are the mark.
public struct ProgressRing: View {
    let progress: Double
    let diameter: CGFloat
    let tint: SwiftUI.Color
    let track: SwiftUI.Color
    let label: String?

    public init(progress: Double, diameter: CGFloat = 64, tint: SwiftUI.Color = DS.Color.cobalt,
                track: SwiftUI.Color = DS.Color.surfaceSunken, label: String? = nil) {
        self.progress = min(max(progress, 0), 1)
        self.diameter = diameter
        self.tint = tint
        self.track = track
        self.label = label
    }

    public var body: some View {
        let width = diameter * 0.2
        ZStack {
            Circle().stroke(track, lineWidth: width)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(tint, style: StrokeStyle(lineWidth: width, lineCap: .round))
                .rotationEffect(.degrees(-90))
            if progress >= 1 {
                Circle().fill(DS.Color.sunny).frame(width: diameter * 0.28, height: diameter * 0.28)
                    .transition(.scale.combined(with: .opacity))
            } else if let label {
                Text(label).font(DS.Font.fixed(.numeral, size: diameter * 0.24)).foregroundStyle(DS.Color.ink)
            }
        }
        .padding(width / 2)
        .frame(width: diameter, height: diameter)
        .dsAnimation(DS.Motion.snap, value: progress)
        .accessibilityElement()
        .accessibilityLabel(label ?? "Progress")
        .accessibilityValue("\(Int((progress * 100).rounded())) percent")
    }
}

// MARK: - The skill path

/// A step on the skill path. The path is the logo: done is a dot, now is the ring.
public struct SkillPathNode: View {
    public enum State: String, CaseIterable, Sendable {
        case done, now, later

        var label: String {
            switch self {
            case .done: "Done"
            case .now: "Up next"
            case .later: "Not yet"
            }
        }
    }

    let state: State
    /// The size of a done node; now is 1.25 × bigger, later 0.85 ×.
    let size: CGFloat

    public init(_ state: State, size: CGFloat = 40) {
        self.state = state
        self.size = size
    }

    public var body: some View {
        // The brand page's trail: done r20 (ink, sunny tick), now r25 white with a tomato ring r18
        // (stroke 9) and an ink dot r6, later r17 white.
        let u = size / 40
        ZStack {
            switch state {
            case .done:
                Circle().fill(DS.Color.ink).frame(width: 40 * u, height: 40 * u)
                CheckShape()
                    .stroke(DS.Color.sunny, style: StrokeStyle(lineWidth: 4 * u, lineCap: .round, lineJoin: .round))
                    .frame(width: 24 * u, height: 24 * u)
            case .now:
                Circle().fill(DS.Color.paper).frame(width: 50 * u, height: 50 * u)
                Circle().stroke(DS.Color.tomato, lineWidth: 9 * u).frame(width: 36 * u, height: 36 * u)
                Circle().fill(DS.Color.ink).frame(width: 12 * u, height: 12 * u)
            case .later:
                Circle().fill(DS.Color.paper).frame(width: 34 * u, height: 34 * u)
            }
        }
        .frame(width: 50 * u, height: 50 * u)
        .accessibilityElement()
        .accessibilityLabel(state.label)
    }
}

/// The skill path as a trail: an ink line with the nodes on it (on a sunny card).
public struct SkillTrail: View {
    let states: [SkillPathNode.State]
    let size: CGFloat

    public init(_ states: [SkillPathNode.State], size: CGFloat = 40) {
        self.states = states
        self.size = size
    }

    public var body: some View {
        let u = size / 40
        ZStack {
            Capsule().fill(DS.Color.ink).frame(height: 6 * u).padding(.horizontal, 20 * u)
            HStack(spacing: 0) {
                ForEach(Array(states.enumerated()), id: \.offset) { i, s in
                    SkillPathNode(s, size: size)
                    if i < states.count - 1 { Spacer(minLength: 4 * u) }
                }
            }
        }
        .frame(height: 50 * u)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Skill path: \(states.filter { $0 == .done }.count) of \(states.count) done")
    }
}

// MARK: - Stars and streaks

/// A row of stars: earned in sunny, still to earn faint.
public struct StarRow: View {
    let earned: Int
    let total: Int
    let size: CGFloat
    let onCobalt: Bool

    public init(earned: Int, total: Int = 5, size: CGFloat = 36, onCobalt: Bool = false) {
        self.earned = earned
        self.total = total
        self.size = size
        self.onCobalt = onCobalt
    }

    public var body: some View {
        HStack(spacing: size * 0.11) {
            ForEach(0..<total, id: \.self) { i in
                RoundedStar(i < earned ? DS.Color.star : (onCobalt ? DS.Color.onCobaltFaint : DS.Color.starEmpty))
                    .frame(width: size, height: size)
            }
        }
        .accessibilityElement()
        .accessibilityLabel("\(earned) of \(total) stars")
    }
}

/// The streak: a flame, the number of days, and "day streak".
public struct StreakBadge: View {
    let days: Int
    let onCobalt: Bool

    public init(days: Int, onCobalt: Bool = false) {
        self.days = days
        self.onCobalt = onCobalt
    }

    public var body: some View {
        HStack(spacing: 10) {
            FlameShape()
                .stroke(onCobalt ? DS.Color.sunny : DS.Color.streak,
                        style: StrokeStyle(lineWidth: 2.4 * 40 / 24, lineCap: .round, lineJoin: .round))
                .frame(width: 40, height: 40)
            Text("\(days)").dsFont(.bigNumber)
            Text("day\nstreak").dsFont(.caption, size: 15).fontWeight(.medium)
                .fixedSize()
        }
        .foregroundStyle(onCobalt ? DS.Color.onInk : DS.Color.ink)
        .accessibilityElement()
        .accessibilityLabel("\(days) day streak")
    }
}

/// This week, one dot per day: done in sunny, today in white, the rest faint.
public struct WeekDots: View {
    public enum Day: Sendable { case done, today, later }

    let days: [(letter: String, state: Day)]
    let onCobalt: Bool

    public init(_ days: [(letter: String, state: Day)], onCobalt: Bool = true) {
        self.days = days
        self.onCobalt = onCobalt
    }

    public var body: some View {
        HStack(spacing: 5) {
            ForEach(Array(days.enumerated()), id: \.offset) { _, d in
                Text(d.letter)
                    .font(DS.Font.fixed(.caption, size: 11).weight(.semibold))
                    .frame(width: 24, height: 24)
                    .foregroundStyle(color(d.state).text)
                    .background(Circle().fill(color(d.state).fill))
            }
        }
        .accessibilityElement()
        .accessibilityLabel("\(days.filter { $0.state == .done }.count) days practised this week")
    }

    private func color(_ s: Day) -> (fill: SwiftUI.Color, text: SwiftUI.Color) {
        switch s {
        case .done: (DS.Color.sunny, DS.Color.ink)
        case .today: (onCobalt ? DS.Color.paper : DS.Color.ink, onCobalt ? DS.Color.cobalt : DS.Color.onInk)
        case .later: (onCobalt ? DS.Color.onCobaltFaint : DS.Color.surfaceSunken, onCobalt ? DS.Color.onInk : DS.Color.inkSecondary)
        }
    }
}

// MARK: - The ink meter

/// How much of the tutor's ink is left: the mark's bar, laid down, filling in tutor cobalt. Kids
/// see words, never numbers or prices: "Lots of ink", "Ink is low", "Help is paused".
public struct InkMeter: View {
    public enum Style: Sendable {
        /// A bar with words, for a card or the grown-ups' area.
        case bar
        /// Just the mark's bar standing up, for a top bar (56 pt tall target).
        case compact
    }

    let level: Double
    let style: Style

    public init(level: Double, style: Style = .bar) {
        self.level = min(max(level, 0), 1)
        self.style = style
    }

    public var words: String {
        switch level {
        case ..<0.001: "Help is paused"
        case ..<0.2: "Ink is low"
        case ..<0.6: "Some ink left"
        default: "Lots of ink"
        }
    }

    public var body: some View {
        switch style {
        case .bar: bar
        case .compact: compact
        }
    }

    private var bar: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                if level <= 0.001 {
                    DSIcon(.pause, size: 16).foregroundStyle(DS.Color.ink)
                }
                Text(words).dsFont(.button, size: 17).foregroundStyle(DS.Color.ink)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(DS.Color.surfaceSunken)
                    Capsule().fill(DS.Color.tutorInk)
                        .frame(width: level <= 0.001 ? 0 : max(geo.size.height, geo.size.width * level))
                }
            }
            .frame(height: 14)
        }
        .dsAnimation(DS.Motion.snap, value: level)
        .accessibilityElement()
        .accessibilityLabel("Tutor's ink")
        .accessibilityValue(words)
    }

    private var compact: some View {
        ZStack(alignment: .bottom) {
            RoundedRectangle(cornerRadius: 4, style: .continuous).fill(DS.Color.tutorInkEmpty)
            RoundedRectangle(cornerRadius: 4, style: .continuous).fill(DS.Color.tutorInk)
                .frame(height: 40 * level)
        }
        .frame(width: 14, height: 40)
        .frame(width: DS.Size.minTarget, height: DS.Size.minTarget)
        .background(Circle().fill(DS.Color.surface))
        .dsAnimation(DS.Motion.snap, value: level)
        .accessibilityElement()
        .accessibilityLabel("Tutor's ink")
        .accessibilityValue(words)
    }
}

// MARK: - Celebration

/// A flat burst for a finished set: the mark's parts (rings, bars, dots) and stars fly out from
/// the middle and fade. Change `trigger` to fire it. Under Reduce Motion the pieces appear in place
/// and fade, without flying.
public struct CelebrationBurst: View {
    let trigger: Int
    let size: CGFloat
    /// Show the burst at full spread and hold it (for a still picture of it).
    let frozen: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var out = false
    @State private var faded = true

    public init(trigger: Int = 0, size: CGFloat = 280, frozen: Bool = false) {
        self.trigger = trigger
        self.size = size
        self.frozen = frozen
    }

    enum Kind { case star, ring, bar, dot }
    struct Piece {
        let kind: Kind
        let angle: Double
        let distance: CGFloat
        let spin: Double
        let color: SwiftUI.Color
        let scale: CGFloat
    }

    static let pieces: [Piece] = {
        let colors = [DS.Color.sunny, DS.Color.cobalt, DS.Color.tomato, DS.Color.success]
        let kinds: [Kind] = [.star, .ring, .bar, .dot, .star, .bar, .ring, .dot, .star, .dot, .bar, .ring, .star, .dot]
        return kinds.enumerated().map { i, k in
            Piece(kind: k, angle: Double(i) / Double(kinds.count) * 360 + (i.isMultiple(of: 2) ? 8 : -6),
                  distance: i.isMultiple(of: 3) ? 0.44 : (i.isMultiple(of: 2) ? 0.36 : 0.30),
                  spin: Double((i * 47) % 120) - 60,
                  color: k == .star ? DS.Color.sunny : colors[(i + 1) % colors.count],
                  scale: i.isMultiple(of: 4) ? 1.25 : 1)
        }
    }()

    public var body: some View {
        ZStack {
            ForEach(Array(Self.pieces.enumerated()), id: \.offset) { _, p in
                piece(p)
                    .scaleEffect((out || frozen ? 1 : 0.2) * p.scale)
                    .rotationEffect(.degrees(out || frozen ? p.spin : 0))
                    .offset(x: out || frozen ? cos(p.angle * .pi / 180) * p.distance * size : 0,
                            y: out || frozen ? sin(p.angle * .pi / 180) * p.distance * size : 0)
                    .opacity(frozen ? 1 : (faded ? 0 : 1))
            }
        }
        .frame(width: size, height: size)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onChange(of: trigger) { fire() }
    }

    @ViewBuilder private func piece(_ p: Piece) -> some View {
        let u = size / 280
        switch p.kind {
        case .star: RoundedStar(p.color).frame(width: 26 * u, height: 26 * u)
        case .ring: Circle().stroke(p.color, lineWidth: 5 * u).frame(width: 18 * u, height: 18 * u)
        case .bar: RoundedRectangle(cornerRadius: 2 * u).fill(p.color).frame(width: 7 * u, height: 22 * u)
        case .dot: Circle().fill(p.color).frame(width: 12 * u, height: 12 * u)
        }
    }

    private func fire() {
        var t = Transaction()
        t.disablesAnimations = true
        withTransaction(t) { out = reduceMotion; faded = false }
        if !reduceMotion {
            withAnimation(.spring(duration: 0.5, bounce: 0.25)) { out = true }
        }
        withAnimation(.easeIn(duration: 0.35).delay(reduceMotion ? 0.9 : 0.55)) { faded = true }
    }
}

#Preview("Progress") {
    VStack(spacing: 28) {
        HStack(spacing: 24) {
            ProgressRing(progress: 0.4, label: "2/5")
            ProgressRing(progress: 1)
            StarRow(earned: 2)
            StreakBadge(days: 4)
        }
        SkillTrail([.done, .done, .done, .done, .now, .later, .later]).frame(width: 450)
            .padding(24).background(DS.Color.sunny)
        InkMeter(level: 0.7).frame(width: 300)
        InkMeter(level: 0.12).frame(width: 300)
        InkMeter(level: 0).frame(width: 300)
        CelebrationBurst(frozen: true)
    }
    .padding(40)
    .background(DS.Color.ground)
}
