import AgathonKit
import SwiftUI

/// The app's first screen: the splash while the stored session is read, then sign-in or the
/// boards home. Phase 0: the kit lane's plain debug screens (Debug/) stand in until the screens
/// lane builds the real ones (docs/IPAD-NATIVE.md).
struct RootView: View {
    @Environment(AgathonBackend.self) private var backend

    var body: some View {
        switch backend.auth.phase {
        case .restoring:
            SplashView()
        case .signedOut:
            DebugSignInView()
        case .signedIn:
            // A new profile (sign-in, a family switch) starts the home over: nothing read as the
            // last one carries over.
            DebugBoardsView()
                .id(backend.auth.userId)
        }
    }
}

#Preview {
    RootView()
        .environment(AgathonBackend.preview())
}
