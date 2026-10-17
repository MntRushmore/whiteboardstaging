import AgathonKit
import SwiftUI

@main
struct AgathonApp: App {
    /// Auth, the API and the repositories, made once (AgathonKit).
    @State private var backend = AgathonBackend(release: AppConfig.release)

    var body: some Scene {
        WindowGroup {
            Group {
                if BrainLab.isRequested { BrainLabView() } else { RootView() }
            }
            .environment(backend)
            .task { backend.auth.start() }
            // The site has no dark theme; the native screens around it match it.
            .preferredColorScheme(.light)
        }
    }
}
