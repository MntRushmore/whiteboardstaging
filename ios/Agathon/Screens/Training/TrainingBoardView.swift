import AgathonBoard
import AgathonBoardUI
import AgathonDesign
import AgathonLive
import SwiftUI

/// The training board on screen: the kid's own board (the Blocks editor: the dock, pages, the problem
/// page's template) with the tutor's overlay (marks, "I read", Check, hints) and Help me — exactly
/// what a kid sees — and the Training Center's own controls in the top bar's right side.
struct TrainingBoardView<Trailing: View>: View {
    @ObservedObject var board: TrainingBoard
    let title: String
    let onBack: () -> Void
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        BoardEditorView(
            controller: board.controller, title: title, onBack: onBack,
            onCanvas: { board.attach($0) },
            topTrailing: {
                HStack(spacing: DS.Space.xs) {
                    trailing()
                    if let loop = board.loop {
                        LiveStatusView(loop: loop).fixedSize()
                        GrownUpLiveButton(loop: loop)
                    }
                }
            },
            helpButton: {
                if let loop = board.loop { LiveHelpBar(loop: loop) }
            },
            overlay: { _ in
                if let loop = board.loop, let geometry = board.liveBoard {
                    LiveOverlay(loop: loop, geometry: geometry, showsOutOfInk: false)
                }
            }
        )
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }
}

/// A small flat pill for the Training Center's bars (Blocks: flat colour, no gradient).
struct TrainingPill: View {
    let text: String
    var tint: Color = DS.Color.ink
    var fill: Color = DS.Color.surface

    var body: some View {
        Text(text)
            .dsFont(.button, size: 15)
            .foregroundStyle(tint)
            .lineLimit(1)
            .padding(.horizontal, 14)
            .frame(minHeight: 40)
            .background(Capsule().fill(fill))
            .fixedSize()
    }
}

/// A line of maths, readable (the overlays' plain form: `\frac{3}{4}` → `3/4`), in the UI face.
struct LatexLabel: View {
    let latex: String
    var size: CGFloat = 19

    init(_ latex: String, size: CGFloat = 19) {
        self.latex = latex
        self.size = size
    }

    var body: some View {
        Text(latex.isEmpty ? "—" : MathText.plain(latex))
            .dsFont(.button, size: size)
            .foregroundStyle(DS.Color.ink)
            .lineLimit(2)
            .minimumScaleFactor(0.7)
            .accessibilityLabel(latex)
    }
}
