import SwiftUI

@main
struct AgathonApp: App {
    var body: some Scene {
        WindowGroup {
            Group {
                if BrainLab.isRequested { BrainLabView() } else { RootView() }
            }
            // The site has no dark theme; the native screens around it match it.
            .preferredColorScheme(.light)
        }
    }
}
