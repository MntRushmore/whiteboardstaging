import SwiftUI
import UIKit

/// The iPad app on a Mac (Apple silicon): its window can be dragged to any size. Below about a small
/// laptop window the board, its dock and Ask's panel would crowd, so the window keeps at least that.
/// Does nothing on an iPad.
struct MacWindowMinimum: ViewModifier {
    static let minimum = CGSize(width: 900, height: 640)

    func body(content: Content) -> some View {
        content.background(SceneFinder())
    }

    private struct SceneFinder: UIViewRepresentable {
        func makeUIView(context: Context) -> UIView { Probe() }
        func updateUIView(_ uiView: UIView, context: Context) {}
    }

    private final class Probe: UIView {
        override func didMoveToWindow() {
            super.didMoveToWindow()
            guard ProcessInfo.processInfo.isiOSAppOnMac, let scene = window?.windowScene else { return }
            var minimum = MacWindowMinimum.minimum
            #if DEBUG
            // `-macWindowMinimum 1400x900` (Debug): a bigger floor makes the window grow to it (the window
            // can't be sized from outside without the Mac's own mouse), for checking big Mac windows
            let args = ProcessInfo.processInfo.arguments
            if let i = args.firstIndex(of: "-macWindowMinimum"), i + 1 < args.count {
                let wh = args[i + 1].split(separator: "x").compactMap { Double($0) }
                if wh.count == 2 { minimum = CGSize(width: wh[0], height: wh[1]) }
            }
            #endif
            scene.sizeRestrictions?.minimumSize = minimum
        }
    }
}

extension View {
    func macWindowMinimum() -> some View { modifier(MacWindowMinimum()) }
}
