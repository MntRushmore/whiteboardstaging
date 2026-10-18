#if DEBUG
import AgathonDesign
import AgathonKit
import SwiftUI

/// The onboarding in Labs (Debug builds): the real flow against whatever backend the app points at
/// (the local stack in development), with the stand-in trial.
///
/// Launch arguments (also how the UI tests and the QA videos drive it):
///  - `-lab onboarding` opens it at launch (ios/Agathon/Debug/LabsMenu.swift);
///  - `-onboardingFresh` starts over as a new iPad would (forgets a kept flow, signs this iPad out);
///  - `-onboardingTrial started|pending|cancelled` what the stand-in trial answers;
///  - `-onboardingMute` no sound.
public struct OnboardingLab: View {
    let close: () -> Void
    @Environment(AgathonBackend.self) private var backend
    @State private var ready = false
    @MainActor private static var didReset = false

    public init(close: @escaping () -> Void) {
        self.close = close
    }

    public var body: some View {
        Group {
            if ready {
                OnboardingFlow(trial: StubTrialOffering(outcome: Self.trialOutcome)) { _ in close() }
            } else {
                DS.Color.ground.ignoresSafeArea()
            }
        }
        .task {
            if ProcessInfo.processInfo.arguments.contains("-onboardingFresh"), !Self.didReset {
                Self.didReset = true
                OnboardingState.reset()
                // the stored session is still being read at launch: wait for it, then sign it out
                for _ in 0..<100 where backend.auth.phase == .restoring { try? await Task.sleep(for: .milliseconds(50)) }
                if backend.auth.phase == .signedIn { try? await backend.auth.signOut(scope: .local) }
            }
            ready = true
        }
            .overlay(alignment: .top) {
                Button(action: close) {
                    Label("Close lab", systemImage: "xmark")
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(DS.Color.surface))
                }
                .foregroundStyle(DS.Color.inkSecondary)
                .padding(.top, 2)
                .accessibilityIdentifier("onboarding.lab.close")
            }
    }

    static var trialOutcome: TrialOutcome {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-onboardingTrial"), i + 1 < args.count else { return .started }
        switch args[i + 1] {
        case "pending": return .pending
        case "cancelled": return .cancelled
        default: return .started
        }
    }
}
#endif
