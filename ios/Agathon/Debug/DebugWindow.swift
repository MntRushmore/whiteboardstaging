#if DEBUG
import AgathonDesign
import SwiftUI

/// Debug only: `-windowWidth 507` lays the app out in a window that wide at the left of the screen,
/// with a compact size class under 600 pt, the way Split View or a narrow iPadOS window would (the
/// simulator can't be put in Split View from a test). For the integration's design pass screenshots.
extension View {
    func debugWindow() -> some View { modifier(DebugWindow()) }
}

private struct DebugWindow: ViewModifier {
    static let width: CGFloat? = {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-windowWidth"), i + 1 < args.count, let w = Double(args[i + 1]) else { return nil }
        return CGFloat(w)
    }()

    func body(content: Content) -> some View {
        if let width = Self.width {
            HStack(spacing: 0) {
                content
                    .frame(width: width)
                    .environment(\.horizontalSizeClass, width < 600 ? .compact : .regular)
                    .clipped()
                Rectangle().fill(Color.black).frame(width: 8)
                DS.Color.inkSecondary.opacity(0.25)
            }
            .ignoresSafeArea()
        } else {
            content
        }
    }
}
#endif
