import SwiftUI

// Practice rewards, borrowed from the Sticker Book direction and redrawn in Blocks: the mark's
// shapes and palette, a white die-cut edge, and a flat lift under it (depth as a colour change,
// never a blur). For practice wins only; the board and Ask never hand out stickers.

/// A die-cut sticker.
public struct Sticker: View {
    public enum Kind: String, CaseIterable, Sendable, Identifiable {
        /// A practice problem done on your own.
        case star
        /// A practice problem done with a hint: the tutor's ring, with the dot in it.
        case ring
        /// A new streak.
        case flame
        /// A perfect set (5 for 5).
        case perfect
        /// A skill mastered on the path: the whole mark. Rare.
        case mark

        public var id: String { rawValue }

        public var label: String {
            switch self {
            case .star: "Star sticker"
            case .ring: "Ring sticker"
            case .flame: "Streak sticker"
            case .perfect: "Perfect set sticker"
            case .mark: "Skill mastered sticker"
            }
        }

        /// Each kind sits a little crooked, the same way every time.
        var tilt: Double {
            switch self {
            case .star: -4
            case .ring: 5
            case .flame: -3
            case .perfect: 3
            case .mark: -6
            }
        }
    }

    let kind: Kind
    let size: CGFloat
    let face: Bool
    let tilt: Double?
    let landing: Int

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var landed = true

    /// `face` gives the star eyes and a smile (big moments only). Change `landing` to slap the
    /// sticker down again.
    public init(_ kind: Kind, size: CGFloat = 70, face: Bool = false, tilt: Double? = nil, landing: Int = 0) {
        self.kind = kind
        self.size = size
        self.face = face
        self.tilt = tilt
        self.landing = landing
    }

    public var body: some View {
        let edge = size * 0.085
        let lift = landed ? size * 0.05 : size * 0.16
        ZStack {
            StickerSilhouette(kind: kind)
                .stroke(DS.Color.stickerLift, style: StrokeStyle(lineWidth: edge * 2, lineJoin: .round))
                .background(StickerSilhouette(kind: kind).fill(DS.Color.stickerLift))
                .offset(y: lift)
            StickerSilhouette(kind: kind)
                .stroke(DS.Color.stickerEdge, style: StrokeStyle(lineWidth: edge * 2, lineJoin: .round))
                .background(StickerSilhouette(kind: kind).fill(DS.Color.stickerEdge))
            art
        }
        .frame(width: size, height: size)
        .rotationEffect(.degrees((tilt ?? kind.tilt) + (landed ? 0 : 22)))
        .scaleEffect(landed ? 1 : 1.35)
        .offset(x: landed ? 0 : -size * 0.45, y: landed ? 0 : -size * 0.6)
        .opacity(landed ? 1 : 0)
        .accessibilityElement()
        .accessibilityLabel(kind.label)
        .onChange(of: landing) { slap() }
    }

    @ViewBuilder private var art: some View {
        let s = size
        switch kind {
        case .star:
            ZStack {
                RoundedStar(DS.Color.star).frame(width: s * 0.86, height: s * 0.86)
                if face {
                    HStack(spacing: s * 0.1) {
                        Circle().frame(width: s * 0.075)
                        Circle().frame(width: s * 0.075)
                    }
                    .offset(y: s * 0.04)
                    SmileArc().stroke(DS.Color.ink, style: StrokeStyle(lineWidth: s * 0.034, lineCap: .round))
                        .frame(width: s * 0.12, height: s * 0.05)
                        .offset(y: s * 0.13)
                }
            }
            .foregroundStyle(DS.Color.ink)
        case .ring:
            ZStack {
                Circle().stroke(DS.Color.cobalt, lineWidth: s * 0.17).frame(width: s * 0.6, height: s * 0.6)
                Circle().fill(DS.Color.sunny).frame(width: s * 0.2, height: s * 0.2)
            }
        case .flame:
            ZStack {
                FlameShape().fill(DS.Color.tomato).frame(width: s * 0.86, height: s * 0.86)
                FlameShape().fill(DS.Color.sunny).frame(width: s * 0.42, height: s * 0.42).offset(y: s * 0.17)
            }
        case .perfect:
            ZStack {
                Circle().fill(DS.Color.success).frame(width: s * 0.74, height: s * 0.74)
                CheckShape().stroke(DS.Color.onInk, style: StrokeStyle(lineWidth: s * 0.08, lineCap: .round, lineJoin: .round))
                    .frame(width: s * 0.46, height: s * 0.46)
            }
        case .mark:
            AgathonMark(.color).frame(width: s * 1.3, height: s * 1.3)
        }
    }

    private func slap() {
        guard !reduceMotion else {
            landed = false
            withAnimation(DS.Motion.fade) { landed = true }
            return
        }
        var t = Transaction()
        t.disablesAnimations = true
        withTransaction(t) { landed = false }
        withAnimation(DS.Motion.pop) { landed = true }
    }
}

/// The die-cut outline of each sticker, in its frame.
struct StickerSilhouette: Shape {
    let kind: Sticker.Kind

    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height)
        let c = CGPoint(x: rect.midX, y: rect.midY)
        func centred(_ k: CGFloat) -> CGRect {
            CGRect(x: c.x - s * k / 2, y: c.y - s * k / 2, width: s * k, height: s * k)
        }
        switch kind {
        case .star:
            // The art's stroke rounds the points; the die-cut follows the filled star.
            return StarShape().path(in: centred(0.86))
        case .ring:
            return Path(ellipseIn: centred(0.6 + 0.17))
        case .flame:
            return FlameShape().path(in: centred(0.86))
        case .perfect:
            return Path(ellipseIn: centred(0.74))
        case .mark:
            let box = centred(1.3)
            var p = Path()
            p.addPath(MarkRing().path(in: box))
            p.addPath(MarkBar().path(in: box))
            // The ring's hole is part of the sticker.
            let u = box.width / MarkGeometry.box
            let r = (MarkGeometry.ringRadius + MarkGeometry.ringStroke / 2) * u
            let rc = CGPoint(x: box.minX + 50 * u, y: box.minY + 50 * u)
            p.addEllipse(in: CGRect(x: rc.x - r, y: rc.y - r, width: r * 2, height: r * 2))
            return p
        }
    }
}

struct SmileArc: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: rect.minX, y: rect.minY))
        p.addQuadCurve(to: CGPoint(x: rect.maxX, y: rect.minY), control: CGPoint(x: rect.midX, y: rect.maxY * 1.6 - rect.minY * 0.6))
        return p
    }
}

/// The sticker book: this week's practice wins, and the places still to fill. An empty place is a
/// flat circle with its number.
public struct StickerBook: View {
    let slots: [Sticker.Kind?]
    let columns: Int
    let newest: Int?
    let landing: Int

    /// `slots` in order; nil is a place still to earn. `newest` is the index that slaps down when
    /// `landing` changes.
    public init(slots: [Sticker.Kind?], columns: Int = 6, newest: Int? = nil, landing: Int = 0) {
        self.slots = slots
        self.columns = columns
        self.newest = newest
        self.landing = landing
    }

    public var body: some View {
        let earned = slots.compactMap { $0 }.count
        VStack(alignment: .leading, spacing: 20) {
            HStack(alignment: .firstTextBaseline) {
                Text("My sticker book").dsFont(.headline, size: 28).foregroundStyle(DS.Color.ink)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                Tag("\(earned) stickers", style: .chalk)
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: columns), spacing: 16) {
                ForEach(Array(slots.enumerated()), id: \.offset) { i, kind in
                    ZStack {
                        Circle().fill(DS.Color.stickerSlot).frame(width: 64, height: 64)
                        if let kind {
                            Sticker(kind, size: 70, landing: i == newest ? landing : 0)
                        } else {
                            Text("\(i + 1)").font(DS.Font.fixed(.numeral, size: 18)).foregroundStyle(DS.Color.inkSecondary)
                        }
                    }
                    .frame(height: 84)
                    .accessibilityElement()
                    .accessibilityLabel(kind?.label ?? "Place \(i + 1), still to earn")
                }
            }
        }
        .padding(DS.Space.xl)
        .background(RoundedRectangle(cornerRadius: DS.Radius.card, style: .continuous).fill(DS.Color.surface))
    }
}

#Preview("Stickers") {
    VStack(spacing: 32) {
        HStack(spacing: 28) {
            ForEach(Sticker.Kind.allCases) { Sticker($0, size: 96, face: $0 == .star) }
        }
        StickerBook(slots: [.star, .star, .ring, .star, .flame, .perfect, .mark, .star, nil, nil, nil, nil])
            .frame(width: 620)
    }
    .padding(40)
    .background(DS.Color.ground)
}
