import SwiftUI

@main
struct AgathonApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                .designGalleryOnLaunch() // `-designGallery` (Debug): the design system's gallery, ios/Agathon/Debug
                // The site has no dark theme; the native screens around it match it.
                .preferredColorScheme(.light)
        }
    }
}
