import SwiftUI

@main
struct AgathonApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                // The site has no dark theme; the native screens around it match it.
                .preferredColorScheme(.light)
        }
    }
}
