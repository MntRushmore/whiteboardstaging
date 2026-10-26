import AgathonBoard
import AgathonDesign
import AgathonKit
import SwiftUI
import UIKit

/// What the picture tutor puts over the board, in the canvas's own coordinates (the editor's
/// `overlay` slot, which follows the camera):
///
///  - **The pen** is the only sign it is working (no pills, no words): while it reads, a small cobalt
///    pencil hovers along the kid's lines and taps now and then; while it draws, it writes loose,
///    light scribbles in the clearest space of the page, which fade behind it; when the picture
///    arrives it draws it on, then lifts away. Nothing to add, or a failure: it just lifts away.
///  - **The picture**, exactly over the region it was taken from: Feedback at full strength, Suggest
///    and Solve as a 30 % ghost (Accept / Reject take the mode's place in the top bar,
///    `PictureTutorTopItem`, so they never cover the work).
///  - Reduce Motion: no pen, no scribbles, the picture shows at once.
struct PictureTutorOverlay: View {
    @ObservedObject var tutor: PictureTutor
    @ObservedObject var viewport: BoardViewport
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack(alignment: .top) {
            if let shown = tutor.shown {
                PictureTutorImage(shown: shown, camera: viewport.camera, reduceMotion: reduceMotion)
                    .allowsHitTesting(false)
            }
            if !reduceMotion && penActive {
                PictureTutorPen(tutor: tutor, camera: viewport.camera)
                    .allowsHitTesting(false)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        #if DEBUG
        .overlay(alignment: .bottomLeading) { PictureTutorProbe(tutor: tutor) }
        #endif
    }

    /// The pen is on the board: a run, a reveal, or its lifting away.
    private var penActive: Bool {
        tutor.work != nil || tutor.shown?.state == .revealing || tutor.penExit != nil
    }
}

// MARK: - The picture

/// The tutor's picture over R. While it is revealed it is uncovered along the tutor's strokes (a mask
/// that grows like handwriting); a picture without strokes fades in.
struct PictureTutorImage: View {
    let shown: PictureTutor.Shown
    let camera: Camera
    let reduceMotion: Bool
    /// the landing bounce when the drawing is done (the owner: "it has to look cool ... a hit of dopamine")
    @State private var pop: CGFloat = 1

    var body: some View {
        let frame = PictureTutorGeometry.viewRect(shown.region, camera: camera)
        Group {
            if shown.state == .revealing && !reduceMotion {
                TimelineView(.animation) { context in
                    let t = context.date.timeIntervalSince(shown.revealStarted)
                    let p = max(0, min(1, t / max(0.01, shown.revealDuration)))
                    if shown.strokes.isEmpty {
                        picture.opacity(shown.opacity * p)
                    } else {
                        picture.opacity(shown.opacity)
                            .mask { RevealMask(strokes: shown.strokes, pixelSize: shown.pixelSize, progress: PictureTutorPen.ease(p)) }
                    }
                }
            } else {
                picture.opacity(shown.opacity)
            }
        }
        .frame(width: frame.width, height: frame.height)
        .scaleEffect(pop, anchor: contentAnchor)
        .position(x: frame.midX, y: frame.midY)
        .onAppear { if shown.state != .revealing { landed() } }
        .onChange(of: shown.state) { old, new in
            if old == .revealing && new != .revealing && new != .accepting { landed() }
        }
        .accessibilityElement()
        .accessibilityLabel(shown.mode.isGhost ? "The tutor's \(shown.mode.title.lowercased()), not kept yet" : "The tutor's feedback")
        .accessibilityValue(Self.stateWord(shown.state))
        .accessibilityIdentifier("picture.overlay")
    }

    /// The tutor's picture (already its blue: PictureTutorCapture.tutorBlue).
    private var picture: some View {
        Image(decorative: shown.overlay, scale: 1)
            .resizable()
            .interpolation(.high)
    }

    /// Where the drawing is in the picture (its strokes' middle): the bounce is about it, so the ink
    /// lands where it is instead of the whole picture moving.
    private var contentAnchor: UnitPoint {
        let p = shown.strokes.flatMap(\.points)
        guard p.count >= 2, shown.pixelSize.width > 0, shown.pixelSize.height > 0 else { return .center }
        let xs = stride(from: 0, to: p.count - 1, by: 2).map { p[$0] }, ys = stride(from: 1, to: p.count, by: 2).map { p[$0] }
        guard let x0 = xs.min(), let x1 = xs.max(), let y0 = ys.min(), let y1 = ys.max() else { return .center }
        return UnitPoint(x: (x0 + x1) / 2 / shown.pixelSize.width, y: (y0 + y1) / 2 / shown.pixelSize.height)
    }

    /// The drawing is in: a success in the hand and a quick springy bounce.
    private func landed() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        guard !reduceMotion else { return }
        withAnimation(.spring(response: 0.16, dampingFraction: 0.55)) { pop = 1.05 }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
            withAnimation(.spring(response: 0.38, dampingFraction: 0.5)) { pop = 1 }
        }
    }

    static func stateWord(_ s: PictureTutor.Shown.State) -> String {
        switch s {
        case .revealing: return "revealing"
        case .ghost: return "ghost"
        case .shown: return "shown"
        case .accepting: return "accepting"
        }
    }
}

/// The strokes drawn so far, wide enough to uncover their ink, in the picture's frame.
private struct RevealMask: View {
    let strokes: [BoardDrawStroke]
    let pixelSize: CGSize
    let progress: Double

    var body: some View {
        Canvas { ctx, size in
            let sx = size.width / max(1, pixelSize.width), sy = size.height / max(1, pixelSize.height)
            let lines = PictureReveal.partial(strokes, progress: progress).lines
            for line in lines {
                var path = Path()
                path.addLines(line.points.map { CGPoint(x: $0.x * sx, y: $0.y * sy) })
                if line.points.count == 1, let p = line.points.first {
                    path.addEllipse(in: CGRect(x: p.x * sx - 1, y: p.y * sy - 1, width: 2, height: 2))
                }
                ctx.stroke(path, with: .color(.black), style: StrokeStyle(lineWidth: line.width * sx, lineCap: .round, lineJoin: .round))
            }
        }
    }
}

// MARK: - Accept / Reject

struct PictureTutorDecision: View {
    let accept: () -> Void
    let reject: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            Button(action: reject) {
                HStack(spacing: 8) {
                    DSIcon(.close, size: 15)
                    Text("Reject")
                }
                .padding(.horizontal, 18)
                .frame(minHeight: 44)
                .foregroundStyle(DS.Color.ink)
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("picture.reject")
            Button(action: accept) {
                HStack(spacing: 8) {
                    DSIcon(.check, size: 15)
                    Text("Accept")
                }
                .padding(.horizontal, 20)
                .frame(minHeight: 44)
                .foregroundStyle(DS.Color.onInk)
                .background(Capsule().fill(DS.Color.ink))
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("picture.accept")
        }
        .dsFont(.button, size: 17)
        .padding(5)
        .background(Capsule().fill(DS.Color.surface))
        .overlay(Capsule().strokeBorder(DS.Color.line, lineWidth: 1.5))
        .fixedSize()
    }
}

// MARK: - The pen

/// The tutor's cobalt pencil. Positions are worked out from the time, so the whole act is a function
/// of the clock (smooth at any frame rate, the same on every redraw); where it was last drawn is kept
/// so a change of act (reading → drawing → the reveal → away) is a short glide, never a jump.
struct PictureTutorPen: View {
    @ObservedObject var tutor: PictureTutor
    let camera: Camera
    @State private var track = PenTrack()

    /// how long the pen takes to lift away and fade
    static let exitSeconds = 0.55
    /// a change of act glides this long
    static let glideSeconds = 0.45

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60)) { context in
            Canvas { ctx, size in
                draw(&ctx, now: context.date)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(accessibilityWords)
        .accessibilityIdentifier("picture.pen")
    }

    private var accessibilityWords: String {
        switch tutor.phase {
        case .working(.reading): return "The tutor is reading your work"
        case .working(.drawing): return "The tutor is drawing"
        default: return tutor.shown?.state == .revealing ? "The tutor is drawing" : ""
        }
    }

    // MARK: drawing

    private func draw(_ ctx: inout GraphicsContext, now: Date) {
        let act = currentAct(now)
        if act.key != track.act {
            // a new act: glide from wherever the pen was
            track.glideFrom = track.last
            track.glideStart = now
            track.act = act.key
            if act.key == "readAlong" { track.scribbleStart = now }
        }
        switch act {
        case .none:
            track.last = nil
            return
        case .reading(let ink, let seed):
            let t = now.timeIntervalSince(track.glideStart ?? now)
            let pose = PenMotion.hover(over: ink, t: t, seed: seed)
            place(&ctx, pose, now: now)
        case .readAlong(let lines):
            let t = now.timeIntervalSince(track.scribbleStart ?? now)
            let beat = ReadAlong.beat(at: t, lines: lines)
            ReadAlong.drawUnderlines(&ctx, lines: lines, beat: beat)
            // a soft tick in the hand at each tap: the reading's rhythm
            if beat.stage == .tap, track.lastTap != beat.tapKey {
                track.lastTap = beat.tapKey
                track.haptics.impactOccurred(intensity: 0.45)
            }
            place(&ctx, beat.pose, now: now)
        case .reveal(let tip):
            place(&ctx, PenPose(tip: tip, lift: 0, tilt: 0), now: now)
        case .exit(let started):
            guard let from = track.last ?? track.exitFrom else { return }
            if track.exitFrom == nil { track.exitFrom = from }
            let k = min(1, now.timeIntervalSince(started) / Self.exitSeconds)
            let e = 1 - pow(1 - k, 3)
            let pose = PenPose(tip: CGPoint(x: from.tip.x + 26 * e, y: from.tip.y - 34 * e), lift: from.lift + e, tilt: from.tilt + 6 * e)
            PenDrawing.draw(&ctx, pose, opacity: 1 - k)
            if k >= 1 { track.last = nil } else { track.lastExit = pose }
            return
        }
    }

    /// Draws the pen at `pose`, gliding from the last place for the first moments of an act.
    private func place(_ ctx: inout GraphicsContext, _ target: PenPose, now: Date) {
        var pose = target
        if let from = track.glideFrom, let start = track.glideStart {
            let k = min(1, now.timeIntervalSince(start) / Self.glideSeconds)
            if k < 1 {
                let e = PictureTutorPen.ease(k)
                // a little arc up as it travels: the pen is lifted between places
                let arc = sin(k * .pi) * 18
                pose = PenPose(tip: CGPoint(x: from.tip.x + (target.tip.x - from.tip.x) * e,
                                            y: from.tip.y + (target.tip.y - from.tip.y) * e - arc),
                               lift: max(target.lift, sin(k * .pi)), tilt: from.tilt + (target.tilt - from.tilt) * e)
            } else {
                track.glideFrom = nil
            }
        }
        track.last = pose
        track.exitFrom = nil
        PenDrawing.draw(&ctx, pose, opacity: 1)
    }

    static func ease(_ k: Double) -> Double { k < 0.5 ? 2 * k * k : 1 - pow(-2 * k + 2, 2) / 2 }

    private enum Act {
        case none
        case reading(ink: CGRect, seed: UInt64)
        case readAlong(lines: [CGRect])
        case reveal(tip: CGPoint)
        case exit(started: Date)

        var key: String {
            switch self {
            case .none: return "none"
            case .reading: return "reading"
            case .readAlong: return "readAlong"
            case .reveal: return "reveal"
            case .exit: return "exit"
            }
        }
    }

    private func currentAct(_ now: Date) -> Act {
        if let shown = tutor.shown, shown.state == .revealing {
            let t = now.timeIntervalSince(shown.revealStarted)
            let p = PictureTutorPen.ease(max(0, min(1, t / max(0.01, shown.revealDuration))))
            if let tip = PictureReveal.partial(shown.strokes, progress: p).tip {
                return .reveal(tip: PictureTutorGeometry.viewPoint(tip, imageSize: shown.pixelSize, region: shown.region, camera: camera))
            }
            // no strokes: the pen sweeps once across the picture as it fades in
            let frame = PictureTutorGeometry.viewRect(shown.region, camera: camera)
            return .reveal(tip: CGPoint(x: frame.minX + frame.width * (0.3 + 0.4 * p), y: frame.midY))
        }
        if let work = tutor.work {
            let seed = UInt64(truncatingIfNeeded: work.id.hashValue)
            let info = work.capture
            switch tutor.phase {
            case .working(.drawing):
                // the pen reads along the kid's lines (the owner, 2026-10-26: "I like the hovering but
                // dont like the scribble"); with no lines known, it keeps hovering
                let lines = info.lines.map { PictureTutorGeometry.viewRect($0, camera: camera) }.filter { $0.width > 4 }
                return lines.isEmpty ? .reading(ink: inkArea(info), seed: seed) : .readAlong(lines: lines)
            default:
                return .reading(ink: inkArea(info), seed: seed)
            }
        }
        if let exit = tutor.penExit, now.timeIntervalSince(exit.at) < Self.exitSeconds {
            return .exit(started: exit.at)
        }
        return .none
    }

    /// The clearest space of the capture on screen, kept to a size a hand writes in.
    private func scribbleArea(_ info: PictureCaptureInfo) -> CGRect {
        let regionView = PictureTutorGeometry.viewRect(info.region, camera: camera)
        guard let blank = info.blank else { return regionView.insetBy(dx: regionView.width * 0.3, dy: regionView.height * 0.35) }
        let page = PictureTutorGeometry.pageRect(blank, imageSize: info.pixelSize, region: info.region)
        let r = PictureTutorGeometry.viewRect(page, camera: camera).insetBy(dx: 14, dy: 14)
        // a blank too small to inset is CGRect.null (its origin infinite): write in the middle instead
        if r.isNull || r.isEmpty { return regionView.insetBy(dx: regionView.width * 0.3, dy: regionView.height * 0.35) }
        // a wide space is written in its upper-left part, like a note beside the work
        let w = min(r.width, 420), h = min(r.height, 170)
        return CGRect(x: r.minX + min(24, (r.width - w) / 2), y: r.minY + min(30, (r.height - h) / 2), width: max(60, w), height: max(40, h))
    }

    private func inkArea(_ info: PictureCaptureInfo) -> CGRect {
        let regionView = PictureTutorGeometry.viewRect(info.region, camera: camera)
        guard let ink = info.ink else { return regionView.insetBy(dx: regionView.width * 0.35, dy: regionView.height * 0.35) }
        let page = PictureTutorGeometry.pageRect(ink, imageSize: info.pixelSize, region: info.region)
        return PictureTutorGeometry.viewRect(page, camera: camera)
    }
}

/// Where the pen was (a class: the canvas writes it as it draws, without redrawing for it).
private final class PenTrack {
    var act = "none"
    var last: PenPose?
    var lastExit: PenPose?
    var exitFrom: PenPose?
    var glideFrom: PenPose?
    var glideStart: Date?
    var scribbleStart: Date?
    /// the read-along tap the hand last felt
    var lastTap = -1
    let haptics = UIImpactFeedbackGenerator(style: .soft)
}

/// The pen reading along the kid's lines while the tutor thinks: for each line, top to bottom, it
/// glides to the line's start, sweeps under it leaving a soft cobalt underline that fills as it
/// goes, and taps at its end (a ring spreads from the tap); the underlines fade one after another;
/// then round again. Everything is a function of the clock, like the hover.
enum ReadAlong {
    static let glide = 0.38
    static let tap = 0.34
    static let pause = 0.4
    /// how long an underline stays after its line is read
    static let fade = 1.6

    enum Stage { case glide, sweep, tap }

    struct Beat {
        var line: Int
        var stage: Stage
        /// progress through the stage, 0…1
        var k: Double
        /// seconds since each line of this round finished its sweep (nil: not yet)
        var finishedAgo: [Double?]
        var pose: PenPose
        /// which tap this is (a new number each tap of each round)
        var tapKey: Int
    }

    static func sweep(_ r: CGRect) -> Double { min(1.3, max(0.55, Double(r.width) / 560)) }

    static func underlineY(_ r: CGRect) -> CGFloat { r.maxY + max(5, r.height * 0.12) }

    static func beat(at time: Double, lines: [CGRect]) -> Beat {
        let lengths = lines.map { glide + sweep($0) + tap }
        let round = lengths.reduce(0, +) + pause
        let roundIndex = Int(time / round)
        var t = time.truncatingRemainder(dividingBy: round)
        var finished: [Double?] = Array(repeating: nil, count: lines.count)
        for (i, r) in lines.enumerated() {
            let y = underlineY(r)
            if t < glide {
                // lifted, arcing in from the last line's end (or from above the first line)
                let from = i > 0 ? CGPoint(x: lines[i - 1].maxX + 6, y: underlineY(lines[i - 1])) : CGPoint(x: r.minX - 30, y: r.minY - 40)
                let k = t / glide, e = PictureTutorPen.ease(k)
                let tip = CGPoint(x: from.x + (r.minX - from.x) * e, y: from.y + (y - from.y) * e - sin(k * .pi) * 22)
                return Beat(line: i, stage: .glide, k: k, finishedAgo: finished, pose: PenPose(tip: tip, lift: 0.35 + 0.5 * sin(k * .pi), tilt: 0),
                            tapKey: -1)
            }
            t -= glide
            let d = sweep(r)
            if t < d {
                let k = t / d, e = PictureTutorPen.ease(k)
                let tip = CGPoint(x: r.minX + (r.maxX + 6 - r.minX) * e, y: y + 1.2 * sin(t * 18))
                return Beat(line: i, stage: .sweep, k: k, finishedAgo: finished, pose: PenPose(tip: tip, lift: 0.08, tilt: 3 * sin(t * 5)),
                            tapKey: -1)
            }
            t -= d
            if t < tap {
                let k = t / tap
                // down onto the paper and up again
                let tip = CGPoint(x: r.maxX + 6, y: y)
                finished[i] = t
                return Beat(line: i, stage: .tap, k: k, finishedAgo: finished, pose: PenPose(tip: tip, lift: 0.18 * abs(cos(k * .pi)), tilt: 0),
                            tapKey: roundIndex * 64 + i)
            }
            t -= tap
            // this line is read: how long ago its sweep ended, for the fade
            finished[i] = 0
            for j in 0..<i { finished[j] = (finished[j] ?? 0) }
        }
        // the pause at the end of a round: the pen rests at the last tap
        let last = lines[lines.count - 1]
        return Beat(line: lines.count - 1, stage: .tap, k: 1, finishedAgo: finished,
                    pose: PenPose(tip: CGPoint(x: last.maxX + 6, y: underlineY(last)), lift: 0.25, tilt: 0), tapKey: -1)
    }

    static func drawUnderlines(_ ctx: inout GraphicsContext, lines: [CGRect], beat: Beat) {
        let ink = DS.Color.tutorInk
        let style = StrokeStyle(lineWidth: 3, lineCap: .round)
        for (i, r) in lines.enumerated() {
            let y = underlineY(r)
            var path = Path()
            if i < beat.line {
                // read already this round: fading out, oldest first
                let ago = Double(beat.line - i) * 0.55
                let alpha = max(0, 0.55 * (1 - ago / fade))
                guard alpha > 0 else { continue }
                path.move(to: CGPoint(x: r.minX, y: y))
                path.addLine(to: CGPoint(x: r.maxX, y: y))
                ctx.stroke(path, with: .color(ink.opacity(alpha)), style: style)
            } else if i == beat.line {
                switch beat.stage {
                case .glide:
                    continue
                case .sweep:
                    let x = r.minX + (r.maxX - r.minX) * PictureTutorPen.ease(beat.k)
                    path.move(to: CGPoint(x: r.minX, y: y))
                    path.addLine(to: CGPoint(x: x, y: y))
                    ctx.stroke(path, with: .color(ink.opacity(0.6)), style: style)
                case .tap:
                    path.move(to: CGPoint(x: r.minX, y: y))
                    path.addLine(to: CGPoint(x: r.maxX, y: y))
                    ctx.stroke(path, with: .color(ink.opacity(0.6)), style: style)
                    // the ring from the tap
                    let k = beat.k
                    let radius = 4 + 18 * k
                    let ring = Path(ellipseIn: CGRect(x: r.maxX + 6 - radius, y: y - radius, width: radius * 2, height: radius * 2))
                    ctx.stroke(ring, with: .color(ink.opacity(0.55 * (1 - k))), style: StrokeStyle(lineWidth: 2))
                }
            }
        }
    }
}

/// The pen's tip on screen, how high it is lifted (0 on the paper … 1 well up) and an extra tilt (degrees).
struct PenPose: Equatable {
    var tip: CGPoint
    var lift: Double
    var tilt: Double
}

/// A little noise that never repeats exactly: sums of sines at unrelated rates.
enum Wobble {
    static func at(_ t: Double, _ seed: Double) -> Double {
        (sin(t * 1.31 + seed) + 0.6 * sin(t * 2.71 + seed * 1.7) + 0.35 * sin(t * 5.13 + seed * 0.3)) / 1.95
    }
}

enum PenMotion {
    /// Reading: the pen hovers along the kid's lines, top to bottom, unhurried, now and then tapping
    /// down beside them; it keeps a little above the ink so the work stays in view.
    static func hover(over ink: CGRect, t: Double, seed: UInt64) -> PenPose {
        let s = Double(seed % 1000) / 100
        let rowPeriod = 2.6
        let rows = max(1.0, (ink.height / 46).rounded())
        let row = floor(t / rowPeriod).truncatingRemainder(dividingBy: rows)
        let k = (t.truncatingRemainder(dividingBy: rowPeriod)) / rowPeriod
        // across a line, easing at both ends, a touch irregular
        let across = 0.5 - 0.5 * cos(k * .pi) + 0.04 * Wobble.at(t * 1.4, s)
        let x = ink.minX + ink.width * min(1, max(0, across)) + 10
        let y = ink.minY + (rows <= 1 ? ink.height * 0.2 : ink.height * (row + 0.2) / rows) - 10 + 4 * Wobble.at(t, s + 2)
        // a tap: twice a line, briefly down
        let tapPhase = (k * 2 + 0.15 * Wobble.at(t, s)).truncatingRemainder(dividingBy: 1)
        let tap = tapPhase > 0.8 ? sin((tapPhase - 0.8) / 0.2 * .pi) : 0
        let lift = 0.75 - 0.65 * tap
        return PenPose(tip: CGPoint(x: x, y: y + 6 * tap), lift: lift, tilt: 3 * Wobble.at(t * 0.8, s + 5))
    }
}

// MARK: - Scribbles

/// Loose handwriting the pen writes while it draws: words of looped letters of uneven height and
/// width on two or three lines, the pen lifting between words and going back to the top when a
/// block is done. Made once per run and area (seeded, so it never jumps on a redraw).
final class Scribble {
    static let shared = Scribble()
    private var cache: [String: Writing] = [:]

    struct Point {
        var p: CGPoint
        /// time along the writing (s)
        var t: Double
        var down: Bool
    }

    struct Segment {
        var a: CGPoint
        var b: CGPoint
        var alpha: Double
    }

    struct Writing {
        var points: [Point]
        var duration: Double
        /// how long the trail behind the pen stays
        static let trailSeconds = 2.4

        func pose(at time: Double) -> PenPose {
            guard points.count > 1 else { return PenPose(tip: points.first?.p ?? .zero, lift: 1, tilt: 0) }
            let t = time.truncatingRemainder(dividingBy: duration)
            let i = index(at: t)
            let a = points[i], b = points[min(points.count - 1, i + 1)]
            let k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0
            let tip = CGPoint(x: a.p.x + (b.p.x - a.p.x) * k, y: a.p.y + (b.p.y - a.p.y) * k)
            let lifted = !(a.down && b.down)
            return PenPose(tip: tip, lift: lifted ? 0.55 : 0.05, tilt: 4 * Wobble.at(time * 0.9, 1.3))
        }

        /// The ink behind the pen, fading with age (nothing from before the block began again).
        func trail(at time: Double) -> [Segment] {
            let t = time.truncatingRemainder(dividingBy: duration)
            let start = max(0, t - Self.trailSeconds)
            var out: [Segment] = []
            var i = index(at: start)
            while i + 1 < points.count, points[i].t <= t {
                let a = points[i], b = points[i + 1]
                if a.down && b.down {
                    let end = b.t > t ? CGPoint(x: a.p.x + (b.p.x - a.p.x) * (t - a.t) / max(1e-6, b.t - a.t),
                                                y: a.p.y + (b.p.y - a.p.y) * (t - a.t) / max(1e-6, b.t - a.t)) : b.p
                    let age = t - a.t
                    let alpha = max(0, 1 - age / Self.trailSeconds)
                    out.append(Segment(a: a.p, b: end, alpha: alpha * alpha))
                }
                i += 1
            }
            return out
        }

        private func index(at t: Double) -> Int {
            var lo = 0, hi = points.count - 1
            while lo < hi {
                let mid = (lo + hi + 1) / 2
                if points[mid].t <= t { lo = mid } else { hi = mid - 1 }
            }
            return lo
        }
    }

    func path(seed: UInt64, area: CGRect) -> Writing {
        // a null, infinite, huge or NaN rect (no blank space mapped into view) trapped in `Int(...)` below
        // (crash 2026-10-25, build 1501): nothing to write in, no writing
        guard [area.minX, area.minY, area.maxX, area.maxY].allSatisfy({ $0.isFinite && abs($0) < 1_000_000 }), area.width >= 8, area.height >= 8 else {
            return Writing(points: [], duration: 0.5)
        }
        let key = "\(seed):\(Int(area.minX)):\(Int(area.minY)):\(Int(area.width)):\(Int(area.height))"
        if let w = cache[key] { return w }
        let w = Self.make(seed: seed, area: area)
        if cache.count > 16 { cache.removeAll() }
        cache[key] = w
        return w
    }

    /// A small seeded generator (the same scribble for the same run).
    struct Rand {
        var state: UInt64
        mutating func next() -> Double {
            state = state &* 6364136223846793005 &+ 1442695040888963407
            return Double((state >> 33) & 0xFFFFFF) / Double(0xFFFFFF)
        }
        mutating func range(_ a: Double, _ b: Double) -> Double { a + (b - a) * next() }
    }

    static func make(seed: UInt64, area: CGRect) -> Writing {
        var rnd = Rand(state: seed | 1)
        let lineHeight = min(56, max(26, area.height / 3))
        let xHeight = lineHeight * 0.36
        let lines = max(1, min(3, Int(area.height / lineHeight)))
        let speed = lineHeight * 2.4 // points per second while writing
        var pts: [Point] = []
        var t = 0.0
        func add(_ p: CGPoint, down: Bool) {
            if let last = pts.last {
                let d = hypot(p.x - last.p.x, p.y - last.p.y)
                t += d / (down ? speed * rnd.range(0.8, 1.2) : speed * 2.2)
            }
            pts.append(Point(p: p, t: t, down: down))
        }
        for line in 0..<lines {
            let baseline = area.minY + lineHeight * (Double(line) + 0.8)
            var x = area.minX + rnd.range(0, lineHeight * 0.3)
            let right = area.maxX - lineHeight * 0.2
            // a line of a few words, sometimes stopping short
            let stop = right - rnd.range(0, area.width * 0.35)
            while x < stop - lineHeight {
                let letters = Int(rnd.range(2, 6.99))
                var first = true
                for _ in 0..<letters {
                    let w = xHeight * rnd.range(0.75, 1.25)
                    let h = xHeight * (rnd.next() < 0.22 ? rnd.range(1.7, 2.3) : rnd.range(0.8, 1.15))
                    let slant = xHeight * 0.18
                    let steps = 12
                    for s in 0...steps {
                        // a looped letter (an "l" or an "e"): a prolate cycloid from the baseline up and
                        // back, its loop at the top, leaning a little
                        let u = Double(s) / Double(steps) * 2 * .pi
                        let th = .pi + u
                        let up = (1 + cos(th)) / 2
                        let lx = x + w * u / (2 * .pi) - w * 0.42 * sin(th) + slant * up
                        let ly = baseline - h * up + xHeight * 0.06 * sin(u * 3 + rnd.next())
                        if first {
                            add(CGPoint(x: lx, y: ly), down: false)
                            first = false
                        } else {
                            add(CGPoint(x: lx, y: ly), down: true)
                        }
                    }
                    x += w
                    if x > stop { break }
                }
                // a space between words: the pen lifts and pauses a moment
                x += xHeight * rnd.range(0.8, 1.5)
                if let last = pts.last {
                    pts.append(Point(p: last.p, t: t + rnd.range(0.08, 0.3), down: false))
                    t = pts.last!.t
                }
            }
        }
        // a breath, then back to the top
        if let last = pts.last { pts.append(Point(p: last.p, t: t + 0.35, down: false)); t += 0.35 }
        if let first = pts.first { add(first.p, down: false) }
        return Writing(points: pts, duration: max(t, 0.5))
    }
}

// MARK: - The pencil

/// A small pencil in Blocks colours, flat: cobalt body, paper cone with a cobalt point, a sunny band
/// and a tomato eraser, leaning as a right hand holds it, its shadow on the paper below (further off
/// the higher it is lifted).
enum PenDrawing {
    static let length: CGFloat = 56
    static let width: CGFloat = 13

    static func draw(_ ctx: inout GraphicsContext, _ pose: PenPose, opacity: Double, shadow drawsShadow: Bool = true) {
        guard opacity > 0.01 else { return }
        let angle = Angle.degrees(-58 + pose.tilt)
        let lift = CGFloat(max(0, min(1.5, pose.lift)))
        if drawsShadow {
            // the shadow: the pencil's outline, flat, a little off to the lower right
            var shadow = ctx
            shadow.opacity = opacity * (0.12 - 0.04 * Double(lift))
            shadow.translateBy(x: pose.tip.x + 3 + 9 * lift, y: pose.tip.y + 4 + 11 * lift)
            shadow.rotate(by: angle)
            shadow.fill(silhouette(), with: .color(DS.Color.ink))
        }

        var pen = ctx
        pen.opacity = opacity
        pen.translateBy(x: pose.tip.x, y: pose.tip.y - 2 * lift)
        pen.rotate(by: angle)
        let w = width, half = width / 2
        let cone: CGFloat = 14
        let band: CGFloat = 5
        let eraser: CGFloat = 7
        let bodyEnd = length - band - eraser
        // the point (cobalt: it writes in the tutor's ink) and the wood
        var wood = Path()
        wood.move(to: .zero)
        wood.addLine(to: CGPoint(x: cone, y: -half))
        wood.addLine(to: CGPoint(x: cone, y: half))
        wood.closeSubpath()
        pen.fill(wood, with: .color(DS.Color.paper))
        pen.stroke(wood, with: .color(DS.Color.cobaltDeep), style: StrokeStyle(lineWidth: 1.2, lineJoin: .round))
        var point = Path()
        point.move(to: .zero)
        point.addLine(to: CGPoint(x: 5.5, y: -half * 5.5 / cone))
        point.addLine(to: CGPoint(x: 5.5, y: half * 5.5 / cone))
        point.closeSubpath()
        pen.fill(point, with: .color(DS.Color.tutorInk))
        // the body, with a flat facet line
        pen.fill(Path(CGRect(x: cone, y: -half, width: bodyEnd - cone, height: w)), with: .color(DS.Color.tutorInk))
        pen.fill(Path(CGRect(x: cone, y: -half + w * 0.62, width: bodyEnd - cone, height: w * 0.38)), with: .color(DS.Color.cobaltDeep))
        // the band and the eraser
        pen.fill(Path(CGRect(x: bodyEnd, y: -half, width: band, height: w)), with: .color(DS.Color.sunny))
        pen.fill(Path(roundedRect: CGRect(x: bodyEnd + band - 1, y: -half, width: eraser + 1, height: w), cornerSize: CGSize(width: 3, height: 3)),
                 with: .color(DS.Color.tomato))
    }

    private static func silhouette() -> Path {
        var p = Path()
        p.move(to: .zero)
        p.addLine(to: CGPoint(x: 14, y: -width / 2))
        p.addLine(to: CGPoint(x: length - 2, y: -width / 2))
        p.addQuadCurve(to: CGPoint(x: length - 2, y: width / 2), control: CGPoint(x: length + 2, y: 0))
        p.addLine(to: CGPoint(x: 14, y: width / 2))
        p.closeSubpath()
        return p
    }
}

#if DEBUG
/// What the picture tutor is doing, for the UI tests (the pen is drawn on a canvas XCUITest can't see).
/// `debug.picture` = "phase working-drawing | shown ghost | mode suggest"
private struct PictureTutorProbe: View {
    @ObservedObject var tutor: PictureTutor

    var body: some View {
        Color.clear
            .frame(width: 2, height: 2)
            .accessibilityElement()
            .accessibilityLabel(summary)
            .accessibilityIdentifier("debug.picture")
            .allowsHitTesting(false)
    }

    private var summary: String {
        let phase: String
        switch tutor.phase {
        case .idle: phase = "idle"
        case .waiting: phase = "waiting"
        case .working(.reading): phase = "working-reading"
        case .working(.drawing): phase = "working-drawing"
        }
        let shown = tutor.shown.map { PictureTutorImage.stateWord($0.state) } ?? "none"
        return "phase \(phase) | shown \(shown) | mode \(tutor.mode.rawValue)"
    }
}
#endif
