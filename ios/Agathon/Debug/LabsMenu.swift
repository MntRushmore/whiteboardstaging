#if DEBUG
import AgathonOnboarding
import SwiftUI

/// A small "Labs" button over every screen of a Debug build, so the developer screens open on a
/// real iPad without editing the scheme's launch arguments. Release builds never have it.
extension View {
    /// `hidden`: no button for now (the first run), without changing the view's identity.
    func labsButton(hidden: Bool = false) -> some View {
        modifier(LabsButton(hidden: hidden))
    }
}

private struct LabsButton: ViewModifier {
    var hidden = false
    /// `-liveLab` opens the Live Lab straight away (screenshots and recordings on the simulator); `-lab <name>` any lab.
    @State private var open: Lab? = ProcessInfo.processInfo.arguments.contains("-liveLab") ? .live : Lab.fromLaunch

    /// `-noLabs`: no button at all (the QA shots and UI tests: it sat over Ask's Send at the corner)
    private static let noLabs = ProcessInfo.processInfo.arguments.contains("-noLabs")

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottomTrailing) {
                if !hidden, !Self.noLabs { Menu {
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
                // a developer's button: it never grows with the text size over the screen's own controls
                .dynamicTypeSize(.large)
                .padding(16) }
            }
            .fullScreenCover(item: $open) { lab in
                LabScreen(lab: lab) { open = nil }
            }
    }
}

private enum Lab: String, CaseIterable, Identifiable {
    case board, editor, brain, design, live, ask, billing, debugScreens, onboarding

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
        case .editor: return "Board editor (Blocks)"
        case .brain: return "Brain Lab (maths engine timings)"
        case .design: return "Design Gallery (the Blocks look)"
        case .live: return "Live Lab (the tutor on the board)"
        case .ask: return "Ask Lab (the chat beside the board)"
        case .debugScreens: return "Old debug screens (kit lane)"
        case .billing: return "Billing Lab (StoreKit test purchases)"
        case .onboarding: return "Onboarding (the first run)"
        }
    }

    var symbol: String {
        switch self {
        case .board: return "pencil.tip"
        case .editor: return "rectangle.and.pencil.and.ellipsis"
        case .brain: return "function"
        case .design: return "paintpalette"
        case .live: return "checkmark.bubble"
        case .ask: return "bubble.left.and.text.bubble.right"
        case .debugScreens: return "ladybug"
        case .billing: return "creditcard"
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
            case .editor: BoardLabView(startInEditor: true)
            case .brain: BrainLabView()
            case .design: DesignGallery()
            case .live: LiveLabView()
            case .ask: AskLabView()
            case .debugScreens: DebugScreens()
            case .billing: BillingLabView()
            case .onboarding: OnboardingLab(gate: AppParentalGate(), close: close)
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
