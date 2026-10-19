import SwiftUI

// The mark: a ring, a dot and a bar, from the current logo (1024 → 100). On the brand page, in a
// 100 × 100 box: ring centre (50, 50), radius 23, stroke 10; dot radius 6.5; bar x 68, y 22,
// 10 × 56, corner 2.5. Painted three colours: cobalt ring, sunny dot, tomato bar.

/// The geometry of the mark in its 100-unit box, shared by the views, the app icon script and tests.
public enum MarkGeometry {
    public static let box: CGFloat = 100
    public static let ringCenter = CGPoint(x: 50, y: 50)
    public static let ringRadius: CGFloat = 23
    public static let ringStroke: CGFloat = 10
    public static let dotRadius: CGFloat = 6.5
    public static let bar = CGRect(x: 68, y: 22, width: 10, height: 56)
    public static let barCorner: CGFloat = 2.5
    /// What the mark actually covers inside its box (the ring's outer edge to the bar's right edge).
    public static let inkBounds = CGRect(x: 22, y: 22, width: 56, height: 56)
}

private extension CGRect {
    /// Maps a point in the mark's 100-unit box into this rect.
    func mark(_ p: CGPoint) -> CGPoint {
        CGPoint(x: minX + p.x / MarkGeometry.box * width, y: minY + p.y / MarkGeometry.box * height)
    }
    var markUnit: CGFloat { min(width, height) / MarkGeometry.box }
}

/// The mark's ring as a filled band (so a one-colour mark is all fills).
public struct MarkRing: Shape {
    public init() {}
    public func path(in rect: CGRect) -> Path {
        let u = rect.markUnit, c = rect.mark(MarkGeometry.ringCenter)
        let outer = (MarkGeometry.ringRadius + MarkGeometry.ringStroke / 2) * u
        let inner = (MarkGeometry.ringRadius - MarkGeometry.ringStroke / 2) * u
        var p = Path()
        p.addEllipse(in: CGRect(x: c.x - outer, y: c.y - outer, width: outer * 2, height: outer * 2))
        p.addEllipse(in: CGRect(x: c.x - inner, y: c.y - inner, width: inner * 2, height: inner * 2))
        return p
    }
}

public struct MarkDot: Shape {
    public init() {}
    public func path(in rect: CGRect) -> Path {
        let u = rect.markUnit, c = rect.mark(MarkGeometry.ringCenter), r = MarkGeometry.dotRadius * u
        return Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2))
    }
}

public struct MarkBar: Shape {
    public init() {}
    public func path(in rect: CGRect) -> Path {
        let u = rect.markUnit, b = MarkGeometry.bar, o = rect.mark(b.origin)
        return Path(roundedRect: CGRect(x: o.x, y: o.y, width: b.width * u, height: b.height * u),
                    cornerRadius: MarkGeometry.barCorner * u)
    }
}

/// The Agathon mark. `.color` is cobalt, sunny and tomato; `.mono` is one colour (Help me uses ink).
/// With `assembles`, the parts come together on appear: ring, then bar, then the dot drops in.
/// Reduce Motion shows it whole.
public struct AgathonMark: View {
    public enum Style: Equatable {
        case color
        case mono(SwiftUI.Color)
    }

    let style: Style
    let assembles: Bool
    /// Change it to play the assembly again (the gallery's replay button).
    let replay: Int

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var ringIn = true
    @State private var barIn = true
    @State private var dotIn = true

    public init(_ style: Style = .color, assembles: Bool = false, replay: Int = 0) {
        self.style = style
        self.assembles = assembles
        self.replay = replay
    }

    private var ringColor: SwiftUI.Color { if case .mono(let c) = style { c } else { DS.Color.cobalt } }
    private var dotColor: SwiftUI.Color { if case .mono(let c) = style { c } else { DS.Color.sunny } }
    private var barColor: SwiftUI.Color { if case .mono(let c) = style { c } else { DS.Color.tomato } }

    public var body: some View {
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height)
            let u = side / MarkGeometry.box
            ZStack {
                MarkRing()
                    .fill(ringColor, style: FillStyle(eoFill: true))
                    .scaleEffect(ringIn ? 1 : 0.01)
                MarkBar()
                    .fill(barColor)
                    .scaleEffect(x: 1, y: barIn ? 1 : 0.2, anchor: UnitPoint(x: 0.73, y: 0.78))
                    .offset(y: barIn ? 0 : 30 * u)
                    .opacity(barIn ? 1 : 0)
                MarkDot()
                    .fill(dotColor)
                    .offset(y: dotIn ? 0 : -40 * u)
                    .opacity(dotIn ? 1 : 0)
            }
            .frame(width: side, height: side)
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityElement()
        .accessibilityLabel("Agathon")
        .onAppear { if assembles { play() } }
        .onChange(of: replay) { play() }
    }

    private func play() {
        guard !reduceMotion else { ringIn = true; barIn = true; dotIn = true; return }
        var t = Transaction()
        t.disablesAnimations = true
        withTransaction(t) { ringIn = false; barIn = false; dotIn = false }
        // Ring snaps in, the bar slides up, then the dot drops in (brand page: .55 s, .68 s, .78 s).
        withAnimation(DS.Motion.pop.delay(0.05 + DS.Motion.assembleRingDelay)) { ringIn = true }
        withAnimation(DS.Motion.pop.delay(0.05 + DS.Motion.assembleBarDelay)) { barIn = true }
        withAnimation(DS.Motion.pop.delay(0.05 + DS.Motion.assembleDotDelay)) { dotIn = true }
    }
}

/// "agathon" in Bricolage Grotesque ExtraBold, −0.05 em. Doesn't follow Dynamic Type (it's a logo).
public struct Wordmark: View {
    let size: CGFloat
    let color: SwiftUI.Color

    public init(size: CGFloat = 30, color: SwiftUI.Color = DS.Color.ink) {
        self.size = size
        self.color = color
    }

    public var body: some View {
        Text(verbatim: "agathon")
            .font(DS.Font.fixed(.display, size: size))
            .tracking(-0.05 * size)
            .foregroundStyle(color)
            .fixedSize()
            .accessibilityLabel("Agathon")
    }
}

/// The lockup: the mark and the wordmark, in the brand page's lockup proportions (a 76 pt mark box
/// to 58 pt type, 10 pt apart). With `assembles`, the mark comes together and then the name slides
/// in; under Reduce Motion it's all simply there.
public struct AgathonLogo: View {
    let size: CGFloat
    let wordmarkColor: SwiftUI.Color
    let assembles: Bool
    let replay: Int

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var named = true

    /// `size` is the wordmark's point size.
    public init(size: CGFloat = 30, wordmarkColor: SwiftUI.Color = DS.Color.ink, assembles: Bool = false,
                replay: Int = 0) {
        self.size = size
        self.wordmarkColor = wordmarkColor
        self.assembles = assembles
        self.replay = replay
    }

    public var body: some View {
        HStack(spacing: size * 10 / 58) {
            AgathonMark(.color, assembles: assembles, replay: replay)
                .frame(width: size * 76 / 58, height: size * 76 / 58)
            Wordmark(size: size, color: wordmarkColor)
                .opacity(named ? 1 : 0)
                .offset(x: named ? 0 : -size * 0.2)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Agathon")
        .onAppear { if assembles { name() } }
        .onChange(of: replay) { name() }
    }

    private func name() {
        guard !reduceMotion else { named = true; return }
        var t = Transaction()
        t.disablesAnimations = true
        withTransaction(t) { named = false }
        // After the dot lands.
        withAnimation(DS.Motion.snap.delay(0.05 + DS.Motion.assembleDotDelay + 0.18)) { named = true }
    }
}

/// The app icon's art: the mark on ink, as on the brand page (mark at 92 % in a 120 box, offset 14).
/// The shipped AppIcon.png is drawn from the same numbers by Scripts/render-brand-assets.swift.
public struct AppIconArt: View {
    let cornerRadius: Bool

    public init(cornerRadius: Bool = true) { self.cornerRadius = cornerRadius }

    public var body: some View {
        GeometryReader { geo in
            let s = min(geo.size.width, geo.size.height)
            ZStack {
                Rectangle().fill(DS.Color.ink)
                AgathonMark(.color)
                    .frame(width: s * 92 / 120, height: s * 92 / 120)
            }
            .frame(width: s, height: s)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius ? s * 27 / 120 : 0, style: .continuous))
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityLabel("Agathon app icon")
    }
}

#Preview("Mark") {
    VStack(spacing: 32) {
        HStack(spacing: 32) {
            AgathonMark().frame(width: 120, height: 120)
            AgathonMark(.mono(DS.Color.ink)).frame(width: 120, height: 120)
            AppIconArt().frame(width: 120, height: 120)
        }
        AgathonLogo(size: 58, assembles: true)
        AgathonLogo(size: 30)
    }
    .padding(40)
    .background(DS.Color.paper)
}
