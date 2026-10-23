import AgathonBoard
import AgathonDesign
import AgathonKit
import AgathonOnboarding
import AgathonStore
import StoreKit
import SwiftUI

/// The app's first screen: the splash while the stored session is read, then
///  - the first run (`OnboardingFlow`, docs/ONBOARDING.md) on an iPad that never finished it, signed
///    out (or signed in with a flow kept from before, e.g. a grown-up who closed the app at the PIN);
///    it stays on screen through its own sign-up and family switch until it hands over;
///  - sign-in for anyone else signed out;
///  - Home, which opens the kid's first board straight away when the first run hands it over.
///
/// The first run's seams are the app's own: Apple's trial through AgathonStore
/// (`StoreTrialOffering`), the app's one parental gate (`AppParentalGate`), and the try's checker as
/// built (the pre-account route with App Attest). Debug builds keep the Labs button and the old
/// debug screens (Labs → "Old debug screens", or `-debugScreens`).
struct RootView: View {
    @Environment(AgathonBackend.self) private var backend
    @Environment(PlanStore.self) private var planStore
    @Environment(\.purchase) private var purchase

    /// The first run is on screen (decided once the session is read; then only its finish changes it).
    @State private var onboarding: Bool?
    /// The kid's first board, handed from the first run to Home.
    @State private var firstBoard: FirstBoardRequest?
    @State private var gate = AppParentalGate()
    /// "I'm studying for the SAT" couldn't get its session (no App Attest here, offline): why
    @State private var satTrouble: String?
    /// a stub run (Debug `-satStub`) that chose SAT on the first run: as if anonymous
    @State private var satOnly = false

    var body: some View {
        #if DEBUG
        // The board lane's Board Lab (ios/Agathon/Debug), launched straight with `-boardLab`;
        // otherwise the Labs button (Debug/LabsMenu.swift) opens it from any screen.
        if ProcessInfo.processInfo.arguments.contains("-boardLab") {
            BoardLabView()
        } else if ProcessInfo.processInfo.arguments.contains("-debugScreens") {
            DebugScreens().labsButton()
        } else {
            // no Labs over the first run's buttons (Labs › Onboarding has it); one view either way,
            // so finishing the first run never makes Home (and the board it opens) twice
            app.labsButton(hidden: onboarding == true)
        }
        #else
        app
        #endif
    }

    @ViewBuilder private var app: some View {
        Group {
            if backend.auth.phase == .restoring || onboarding == nil {
                SplashView()
            } else if onboarding == true {
                OnboardingFlow(trial: trialOffering, gate: gate) { outcome in finish(outcome) }
            } else if (backend.auth.phase == .signedIn && backend.auth.isAnonymous) || (satOnly && Self.satStubHome) {
                // no account: SAT practice is the whole app (docs/SAT-MODE.md)
                SATHomeScreen()
                    .id(backend.auth.userId)
            } else if backend.auth.phase == .signedIn || Self.satStubHome {
                // A new profile (sign-in, a family switch) starts Home over: nothing read as the last
                // one carries over.
                HomeView(firstBoard: firstBoard, tookFirstBoard: { firstBoard = nil })
                    .id(backend.auth.userId)
            } else {
                SignInView()
                    .overlay(alignment: .top) {
                        if let satTrouble {
                            Banner(.lookAgain, satTrouble, surface: .ink).padding(.top, DS.Space.xl)
                                .onTapGesture { self.satTrouble = nil }
                        }
                    }
            }
        }
        .task(id: backend.auth.phase == .restoring) { await decide() }
        // an under-13 from SAT practice: the grown-up's first run, from its start
        .onReceive(NotificationCenter.default.publisher(for: SATAccountRoute.startFirstRun)) { _ in
            Task {
                if backend.auth.isAnonymous { try? await backend.auth.signOut(scope: .local) }
                onboarding = true
            }
        }
    }

    /// Whether the first run opens, once the stored session has been read.
    private func decide() async {
        guard onboarding == nil, backend.auth.phase != .restoring else { return }
        #if DEBUG
        // `-onboardingFresh`: as a new iPad would (the UI tests' fresh install)
        if ProcessInfo.processInfo.arguments.contains("-onboardingFresh") {
            OnboardingState.reset()
            if backend.auth.phase == .signedIn { try? await backend.auth.signOut(scope: .local) }
        }
        // `-satLive` with AGATHON_TEST_EMAIL / AGATHON_TEST_PASSWORD: that free account signed in, past
        // the first run (the end-to-end run against a local stack whose anonymous sign-ins are off)
        let env = ProcessInfo.processInfo.environment
        if SATDebug.isLive, let email = env["AGATHON_TEST_EMAIL"], let password = env["AGATHON_TEST_PASSWORD"] {
            if backend.auth.phase == .signedIn, backend.auth.email?.lowercased() != email.lowercased() {
                try? await backend.auth.signOut(scope: .local)
            }
            if backend.auth.phase != .signedIn { try? await backend.auth.signIn(email: email, password: password) }
            if backend.auth.phase == .signedIn {
                onboarding = false
                return
            }
        }
        #endif
        switch backend.auth.phase {
        case .signedOut: onboarding = OnboardingState.needsOnboarding
        case .signedIn: onboarding = OnboardingState.hasKeptFlow
        case .restoring: break
        }
    }

    private func finish(_ outcome: OnboardingOutcome) {
        switch outcome {
        case .firstBoard(let handoff):
            firstBoard = FirstBoardRequest(boardId: handoff.boardId, document: handoff.document, kidName: handoff.kidName)
        case .signedIn:
            firstBoard = nil
        case .sat:
            firstBoard = nil
            satOnly = true
            Task { await startSAT() }
        }
        onboarding = false
    }

    /// "I'm studying for the SAT": an anonymous session from the server, then SAT practice.
    private func startSAT() async {
        do {
            try await SATAnonymous.ensureSession(backend)
            satTrouble = nil
        } catch {
            satTrouble = "SAT practice couldn't start on this iPad. Check the Wi-Fi, or sign in."
        }
    }

    /// Debug `-satStub`: Home (and its SAT card) without signing in, for the UI tests.
    static var satStubHome: Bool {
        #if DEBUG
        return SATDebug.isStub
        #else
        return false
        #endif
    }

    /// Apple's trial through AgathonStore; Debug's `-onboardingTrial started|pending|cancelled` (the UI
    /// tests: StoreKit's sheet can't be driven from the command line) answers with the stand-in.
    private var trialOffering: any TrialOffering {
        #if DEBUG
        if let i = ProcessInfo.processInfo.arguments.firstIndex(of: "-onboardingTrial"), i + 1 < ProcessInfo.processInfo.arguments.count {
            let outcome: TrialOutcome = switch ProcessInfo.processInfo.arguments[i + 1] {
            case "pending": .pending
            case "cancelled": .cancelled
            default: .started
            }
            return StubTrialOffering(outcome: outcome)
        }
        #endif
        return StoreTrialOffering(store: planStore, purchase: purchase)
    }
}

/// The kid's first board as the first run hands it over: the row it was saved into (nil when it
/// couldn't be made: Home makes one), and the document, which the board saves if the row has none.
struct FirstBoardRequest: Equatable {
    let boardId: String?
    let document: BoardDocument
    let kidName: String?

    var title: String { kidName.map { "\($0)’s first board" } ?? "My first board" }

    static func == (a: FirstBoardRequest, b: FirstBoardRequest) -> Bool { a.boardId == b.boardId && a.kidName == b.kidName }
}

#if DEBUG
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
#endif

#Preview {
    let backend = AgathonBackend.preview()
    RootView()
        .environment(backend)
        .environment(PlanStore(backend: backend))
}
