#if DEBUG
import SwiftUI

/// A small "Labs" button over every screen of a Debug build, so the developer screens open on a
/// real iPad without editing the scheme's launch arguments. Release builds never have it.
extension View {
    func labsButton() -> some View {
        modifier(LabsButton())
    }
}

private struct LabsButton: ViewModifier {
    @State private var open: Lab?

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottomTrailing) {
                Menu {
                    ForEach(Lab.allCases) { lab in
                        Button(lab.title, systemImage: lab.symbol) { open = lab }
                    }
                } label: {
                    Label("Labs", systemImage: "flask")
                        .font(.footnote.weight(.semibold))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(.thinMaterial, in: Capsule())
                }
                .padding(16)
            }
            .fullScreenCover(item: $open) { lab in
                LabScreen(lab: lab) { open = nil }
            }
    }
}

private enum Lab: String, CaseIterable, Identifiable {
    case board, brain, design, debugScreens

    var id: String { rawValue }

    var title: String {
        switch self {
        case .board: return "Board Lab (draw with the Pencil)"
        case .brain: return "Brain Lab (maths engine timings)"
        case .design: return "Design Gallery (the Blocks look)"
        case .debugScreens: return "Old debug screens (kit lane)"
        }
    }

    var symbol: String {
        switch self {
        case .board: return "pencil.tip"
        case .brain: return "function"
        case .design: return "paintpalette"
        case .debugScreens: return "ladybug"
        }
    }
}

private struct LabScreen: View {
    let lab: Lab
    let close: () -> Void

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            switch lab {
            case .board: BoardLabView()
            case .brain: BrainLabView()
            case .design: DesignGallery()
            case .debugScreens: DebugScreens()
            }
            Button(action: close) {
                Label("Close", systemImage: "xmark")
                    .font(.footnote.weight(.semibold))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.thinMaterial, in: Capsule())
            }
            .padding(16)
        }
    }
}
#endif
