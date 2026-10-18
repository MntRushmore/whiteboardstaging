import AgathonKit
import SwiftUI

/// The app's first screen: the splash while the stored session is read, then sign-in or Home
/// (ios/Agathon/Screens). The kit lane's plain debug screens are still reachable in Debug builds:
/// Labs → "Old debug screens", or launch with `-debugScreens`.
struct RootView: View {
    @Environment(AgathonBackend.self) private var backend

    var body: some View {
        #if DEBUG
        // The board lane's Board Lab (ios/Agathon/Debug), launched straight with `-boardLab`;
        // otherwise the Labs button (Debug/LabsMenu.swift) opens it from any screen.
        if ProcessInfo.processInfo.arguments.contains("-boardLab") {
            BoardLabView()
        } else if ProcessInfo.processInfo.arguments.contains("-debugScreens") {
            DebugScreens().labsButton()
        } else {
            home.labsButton()
        }
        #else
        home
        #endif
    }

    @ViewBuilder private var home: some View {
        switch backend.auth.phase {
        case .restoring:
            SplashView()
        case .signedOut:
            SignInView()
        case .signedIn:
            // A new profile (sign-in, a family switch) starts Home over: nothing read as the last
            // one carries over.
            HomeView()
                .id(backend.auth.userId)
        }
    }
}

/// The kit lane's Phase 0 screens (Debug/), as they were: plain sign-in and boards.
struct DebugScreens: View {
    @Environment(AgathonBackend.self) private var backend

    var body: some View {
        switch backend.auth.phase {
        case .restoring:
            SplashView()
        case .signedOut:
            DebugSignInView()
        case .signedIn:
            DebugBoardsView()
                .id(backend.auth.userId)
        }
    }
}

#Preview {
    RootView()
        .environment(AgathonBackend.preview())
}
