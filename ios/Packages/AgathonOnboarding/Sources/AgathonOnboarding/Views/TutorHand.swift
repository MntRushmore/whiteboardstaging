import AgathonBoard
import AgathonBrain
import AgathonDesign
import SwiftUI

/// The tutor's handwriting off the board: the same hand engine the board writes with (the brain's
/// `writeText` for words and `layoutHandwriting` for maths), in tutor ink, revealed stroke by
/// stroke at a handwriting pace. "Hi, Sam.", the skills' examples, the plan's first board.
public struct HandInk: Sendable, Equatable {
    public struct Stroke: Sendable, Equatable {
        /// points in the ink's own box, top-left origin
        public var points: [CGPoint]
        public var pressure: [Double]
        public var weight: Double
        /// the ink's length, for pacing
        public var length: Double
    }

    public var strokes: [Stroke]
    public var size: CGSize
    /// the hand size it was written at (cap height, px)
    public var handSize: Double

    var totalLength: Double { strokes.reduce(0) { $0 + $1.length } }

    /// Builds from point lists, moving everything so the ink's box starts at (0, 0).
    init(raw: [(points: [CGPoint], pressure: [Double], weight: Double)], handSize: Double) {
        let all = raw.flatMap(\.points)
        let minX = all.map(\.x).min() ?? 0
        let minY = all.map(\.y).min() ?? 0
        let maxX = all.map(\.x).max() ?? 1
        let maxY = all.map(\.y).max() ?? 1
        let pad = handSize * 0.08
        strokes = raw.map { r in
            let pts = r.points.map { CGPoint(x: $0.x - minX + pad, y: $0.y - minY + pad) }
            var len = 0.0
            for i in pts.indices.dropFirst() { len += hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) }
            return Stroke(points: pts, pressure: r.pressure, weight: r.weight, length: max(len, 2))
        }
        size = CGSize(width: maxX - minX + pad * 2, height: maxY - minY + pad * 2)
        self.handSize = handSize
    }
}

/// Makes the tutor's ink with the brain, and keeps what it made.
public actor HandInkMaker {
    public static let shared = HandInkMaker()
    let brain: Brain
    private var cache: [String: HandInk] = [:]

    public init(brain: Brain = .shared) { self.brain = brain }

    struct WriteTextArgs: Encodable { let text: String; let maxWidth: Double; let size: Double; let seed: Int }
    struct Composed: Decodable {
        struct Segment: Decodable { let points: [P] }
        struct P: Decodable { let x: Double; let y: Double; let z: Double? }
        let segments: [Segment]
    }

    /// Words in the tutor's hand ("Hi, Sam."), `size` the cap height in points.
    public func words(_ text: String, size: Double, seed: Int = 7) async -> HandInk? {
        let key = "w|\(text)|\(size)|\(seed)"
        if let hit = cache[key] { return hit }
        guard (try? await brain.load()) != nil,
              let composed: Composed = try? await brain.call("writeText", WriteTextArgs(text: text, maxWidth: 4000, size: size, seed: seed))
        else { return nil }
        let raw = composed.segments.compactMap { s -> (points: [CGPoint], pressure: [Double], weight: Double)? in
            guard s.points.count >= 2 else { return nil }
            return (s.points.map { CGPoint(x: $0.x, y: $0.y) }, s.points.map { $0.z ?? 0.5 }, 1)
        }
        guard !raw.isEmpty else { return nil }
        let ink = HandInk(raw: raw, handSize: size)
        cache[key] = ink
        return ink
    }

    /// Maths in the tutor's hand (a skill's example, a problem), one LaTeX line per entry.
    public func latex(_ lines: [String], size: Double, seed: Int? = nil) async -> HandInk? {
        let key = "l|\(lines.joined(separator: "\n"))|\(size)|\(seed ?? -1)"
        if let hit = cache[key] { return hit }
        guard (try? await brain.load()) != nil,
              let result = try? await brain.layoutHandwriting(HandwritingRequest(steps: lines, size: size, seed: seed)),
              result.unsupported.isEmpty, let plan = result.plan
        else { return nil }
        var raw: [(points: [CGPoint], pressure: [Double], weight: Double)] = []
        for line in plan.lines {
            for s in line.strokes where s.points.count >= 2 {
                raw.append((s.points.map { CGPoint(x: $0.x + line.x, y: $0.y + line.y) }, s.points.map(\.z), s.weight ?? 1))
            }
        }
        guard !raw.isEmpty else { return nil }
        let ink = HandInk(raw: raw, handSize: size)
        cache[key] = ink
        return ink
    }
}

/// Draws `ink` in the tutor's colour, written stroke by stroke over `duration` from when `play`
/// turns true (or whole under Reduce Motion, or with `play` nil).
public struct TutorHandView: View {
    let ink: HandInk
    let color: Color
    let duration: Double
    let play: Bool?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var start: Date?

    public init(_ ink: HandInk, color: Color = DS.Color.tutorInk, duration: Double = 0.7, play: Bool? = nil) {
        self.ink = ink
        self.color = color
        self.duration = duration
        self.play = play
    }

    public var body: some View {
        let whole = play == nil || reduceMotion
        TimelineView(.animation(paused: whole || start == nil || done)) { context in
            let progress: Double = {
                if whole { return 1 }
                guard let start else { return 0 }
                return min(1, context.date.timeIntervalSince(start) / max(0.05, duration))
            }()
            Canvas { gc, _ in
                Self.draw(ink, progress: progress, color: color, in: &gc)
            }
        }
        .frame(width: ink.size.width, height: ink.size.height)
        .onAppear { if play == true { start = Date() } }
        .onChange(of: play) { _, now in start = now == true ? Date() : nil }
        .accessibilityHidden(true)
    }

    private var done: Bool {
        guard let start else { return false }
        return Date().timeIntervalSince(start) > duration + 0.1
    }

    /// Paints the first `progress` (0…1) of the ink's length: strokes in order, the last one partly.
    static func draw(_ ink: HandInk, progress: Double, color: Color, in gc: inout GraphicsContext) {
        var budget = ink.totalLength * easeOut(progress)
        let width = max(1.6, ink.handSize * 0.075)
        for s in ink.strokes {
            guard budget > 0 else { break }
            var pts = s.points
            var pressure = s.pressure
            if budget < s.length {
                // the part of this stroke already written
                var walked = 0.0
                var cut = pts.count
                for i in pts.indices.dropFirst() {
                    walked += hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
                    if walked >= budget { cut = i + 1; break }
                }
                pts = Array(pts.prefix(cut))
                pressure = Array(pressure.prefix(cut))
            }
            budget -= s.length
            guard pts.count >= 2 else { continue }
            let input = zip(pts, pressure).map { FreehandInput(Vec2($0.0.x, $0.0.y), $0.1) }
            let outline = Freehand.outline(input, InkStyle.options(width: width * s.weight, pressure: .real, complete: true))
            gc.fill(Path(Freehand.path(outline)), with: .color(color))
        }
    }

    /// A pen slows as it finishes.
    static func easeOut(_ t: Double) -> Double { 1 - pow(1 - min(max(t, 0), 1), 1.6) }
}

/// Ink that loads itself: shows `placeholder` (the words typeset in Kalam, the tutor's font) until
/// the brain has written it.
struct LoadedHand: View {
    enum Source: Equatable { case words(String), latex([String]) }
    let source: Source
    let size: Double
    var duration: Double = 0.7
    var play: Bool? = nil
    var color: Color = DS.Color.tutorInk
    @State private var ink: HandInk?

    var body: some View {
        Group {
            if let ink {
                TutorHandView(ink, color: color, duration: duration, play: play)
            } else {
                Text(fallback)
                    .font(DS.Font.fixed(.tutorHand, size: size * 1.25))
                    .foregroundStyle(color)
                    .opacity(play == false ? 0 : 1)
            }
        }
        .task(id: source) {
            switch source {
            case .words(let t): ink = await HandInkMaker.shared.words(t, size: size)
            case .latex(let l): ink = await HandInkMaker.shared.latex(l, size: size)
            }
        }
    }

    private var fallback: String {
        switch source {
        case .words(let t): t
        case .latex(let l): l.map { LatexWords.say($0) }.joined(separator: "\n")
        }
    }
}
