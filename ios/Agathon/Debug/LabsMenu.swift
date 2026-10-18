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
    /// `-liveLab` opens the Live Lab straight away (screenshots and recordings on the simulator).
    @State private var open: Lab? = ProcessInfo.processInfo.arguments.contains("-liveLab") ? .live : nil

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
    case board, editor, brain, design, live, billing, debugScreens

    var id: String { rawValue }

    var title: String {
        switch self {
        case .board: return "Board Lab (draw with the Pencil)"
        case .editor: return "Board editor (Blocks)"
        case .brain: return "Brain Lab (maths engine timings)"
        case .design: return "Design Gallery (the Blocks look)"
        case .live: return "Live Lab (the tutor on the board)"
        case .debugScreens: return "Old debug screens (kit lane)"
        case .billing: return "Billing Lab (StoreKit test purchases)"
        }
    }

    var symbol: String {
        switch self {
        case .board: return "pencil.tip"
        case .editor: return "rectangle.and.pencil.and.ellipsis"
        case .brain: return "function"
        case .design: return "paintpalette"
        case .live: return "checkmark.bubble"
        case .debugScreens: return "ladybug"
        case .billing: return "creditcard"
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
            case .editor: BoardLabView(startInEditor: true)
            case .brain: BrainLabView()
            case .design: DesignGallery()
            case .live: LiveLabView()
            case .debugScreens: DebugScreens()
            case .billing: BillingLabView()
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
