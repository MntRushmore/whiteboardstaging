import SwiftUI

/// The app's first screen. Phase 0 placeholder: the kit lane puts sign-in and the boards home here
/// (docs/IPAD-NATIVE.md).
struct RootView: View {
    var body: some View {
        #if DEBUG
        // The board lane's Board Lab (ios/Agathon/Debug), launched with `-boardLab`.
        if ProcessInfo.processInfo.arguments.contains("-boardLab") {
            BoardLabView()
        } else {
            SplashView()
        }
        #else
        SplashView()
        #endif
    }
}

#Preview {
    RootView()
}
