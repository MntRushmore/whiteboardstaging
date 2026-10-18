import AgathonKit
import AgathonStore
import SwiftUI

@main
struct AgathonApp: App {
    /// Auth, the API and the repositories, made once (AgathonKit).
    @State private var backend: AgathonBackend
    /// Agathon Unlimited in the App Store (AgathonStore): its transaction listener starts at launch.
    @State private var planStore: PlanStore

    init() {
        let backend = AgathonBackend(release: AppConfig.release)
        _backend = State(initialValue: backend)
        _planStore = State(initialValue: PlanStore(backend: backend))
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if BrainLab.isRequested { BrainLabView() } else { RootView() }
            }
            .designGalleryOnLaunch() // `-designGallery` (Debug): the design system's gallery, ios/Agathon/Debug
            #if DEBUG
            .billingScreenOnLaunch() // `-billingScreen …` (Debug): ios/Agathon/Debug/BillingLabView.swift
            #endif
            .environment(backend)
            .environment(planStore)
            .task {
                backend.auth.start()
                planStore.start()
            }
            // A new account (sign-in, a family switch): its plan, and any transaction left unrecorded.
            .task(id: backend.auth.userId) {
                planStore.resetForNewAccount()
                guard backend.auth.userId != nil else { return }
                await planStore.refreshPlan()
                await planStore.retryUnfinished()
            }
            // The site has no dark theme; the native screens around it match it.
            .preferredColorScheme(.light)
        }
    }
}
