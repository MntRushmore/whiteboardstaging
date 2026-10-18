#if DEBUG
import AgathonOnboarding
import SwiftUI

/// A small "Labs" button over every screen of a Debug build, so the developer screens open on a
/// real iPad without editing the scheme's launch arguments. Release builds never have it.
extension View {
    func labsButton() -> some View {
        modifier(LabsButton())
    }
}

private struct LabsButton: ViewModifier {
    @State private var open: Lab? = Lab.fromLaunch

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
    case board, brain, design, onboarding

    var id: String { rawValue }

    /// `-lab <name>` opens that lab at launch (the onboarding's UI tests and QA videos use it).
    static var fromLaunch: Lab? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-lab"), i + 1 < args.count else { return nil }
        return Lab(rawValue: args[i + 1])
    }

    var title: String {
        switch self {
        case .board: return "Board Lab (draw with the Pencil)"
        case .brain: return "Brain Lab (maths engine timings)"
        case .design: return "Design Gallery (the Blocks look)"
        case .onboarding: return "Onboarding (the first run)"
        }
    }

    var symbol: String {
        switch self {
        case .board: return "pencil.tip"
        case .brain: return "function"
        case .design: return "paintpalette"
        case .onboarding: return "hand.wave"
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
            case .onboarding: OnboardingLab(close: close)
            }
            if lab != .onboarding { Button(action: close) {
                Label("Close", systemImage: "xmark")
                    .font(.footnote.weight(.semibold))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.thinMaterial, in: Capsule())
            }
            .padding(16) }
        }
    }
}
#endif
