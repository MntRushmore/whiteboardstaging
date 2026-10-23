import AgathonDesign
import SwiftUI

/// The admin's mode on the board's top bar: Off, Feedback, Suggest, Solve (Reed's names). Changing it
/// cancels a run in flight; Off stops the picture tutor on this board.
struct PictureTutorModeControl: View {
    @ObservedObject var tutor: PictureTutor
    var showsWords = true

    var body: some View {
        Menu {
            Picker("Picture tutor", selection: $tutor.mode) {
                ForEach(PictureTutorMode.allCases) { mode in
                    Text(mode.title).tag(mode)
                }
            }
        } label: {
            HStack(spacing: 8) {
                PenGlyph()
                    .frame(width: 18, height: 18)
                    .opacity(tutor.mode == .off ? 0.4 : 1)
                if showsWords {
                    Text(tutor.mode.title)
                        .dsFont(.button, size: 15)
                        .foregroundStyle(DS.Color.ink)
                        .lineLimit(1)
                        .fixedSize()
                }
                DSIcon(.forward, size: 11)
                    .rotationEffect(.degrees(90))
                    .foregroundStyle(DS.Color.inkSecondary)
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 40)
            .background(Capsule().fill(DS.Color.surface))
            .frame(minHeight: DS.Size.minTarget)
            .contentShape(Capsule())
        }
        .accessibilityLabel("Picture tutor mode")
        .accessibilityValue(tutor.mode.title)
        .accessibilityIdentifier("picture.mode")
    }
}

/// The picture tutor's place in the top bar: the mode, or — while a Suggest or Solve ghost waits —
/// Accept and Reject (at the top of the board, never over the work).
struct PictureTutorTopItem: View {
    @ObservedObject var tutor: PictureTutor
    var showsWords = true

    var body: some View {
        Group {
            if let shown = tutor.shown, shown.mode.isGhost, shown.state == .ghost {
                PictureTutorDecision(accept: tutor.accept, reject: tutor.reject)
                    .transition(.opacity.combined(with: .scale(scale: 0.92)))
            } else {
                PictureTutorModeControl(tutor: tutor, showsWords: showsWords)
                    .transition(.opacity)
            }
        }
        .dsAnimation(DS.Motion.snap, value: tutor.shown?.state)
    }
}

/// "Draw now": the board's big button while the picture tutor runs (Help me's place). It always
/// draws; when the run fails, it shakes once.
struct PictureTutorDrawNow: View {
    @ObservedObject var tutor: PictureTutor
    @State private var shake = 0.0

    var body: some View {
        HelpMeButton("Draw now") { tutor.drawNow() }
            .disabled(tutor.mode == .off)
            .opacity(tutor.mode == .off ? 0.5 : 1)
            .modifier(Shake(amount: shake))
            .onChange(of: tutor.drawNowShake) { _, _ in
                shake = 0
                withAnimation(.linear(duration: 0.42)) { shake = 1 }
            }
            .accessibilityIdentifier("picture.drawNow")
    }
}

/// One gentle shake, side to side, as `amount` goes 0 → 1.
private struct Shake: GeometryEffect {
    var amount: Double
    var animatableData: Double {
        get { amount }
        set { amount = newValue }
    }

    func effectValue(size: CGSize) -> ProjectionTransform {
        let x = 7 * sin(amount * .pi * 4) * (1 - amount)
        return ProjectionTransform(CGAffineTransform(translationX: x, y: 0))
    }
}

/// The tutor's pencil, small, for the mode control (the same pencil the board shows working).
struct PenGlyph: View {
    var body: some View {
        Canvas { ctx, size in
            var c = ctx
            let s = size.width / 46
            c.scaleBy(x: s, y: s)
            PenDrawing.draw(&c, PenPose(tip: CGPoint(x: 6, y: 40), lift: 0, tilt: 13), opacity: 1, shadow: false)
        }
        .accessibilityHidden(true)
    }
}
