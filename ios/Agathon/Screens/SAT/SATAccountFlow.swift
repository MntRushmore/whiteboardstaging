import AgathonDesign
import AgathonKit
import AgathonOnboarding
import AgathonSAT
import SwiftUI

/// Making an account from SAT practice with no account (the owner, 2026-10-22; docs/SAT-MODE.md): one
/// question a screen, as the first run asks (docs/ONBOARDING.md), in grown-up Blocks.
///
///  1. **How old are you?** 13 or older makes their own account; under 13 goes through a grown-up, as
///     the first run does today.
///  2. **13+:** an email and a password. It UPGRADES the anonymous user (`AuthService.upgradeAnonymous`),
///     never a new one, so their SAT answers, passes and board carry over.
///  3. The address waits for its link ("Check your email"), or the account is ready.
struct SATAccountFlow: View {
    enum Step: Equatable { case age, account, checkEmail(String), done, grownUp }

    let onDone: () -> Void
    let onUnder13: () -> Void

    @Environment(AgathonBackend.self) private var backend
    @State private var step: Step = .age
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                RoundButton(step == .age || step == .grownUp ? .close : .back, label: step == .age ? "Close" : "Back") {
                    switch step {
                    case .account, .grownUp: withAnimation(DS.Motion.snap) { step = .age }
                    default: onDone()
                    }
                }
                .accessibilityIdentifier("sat.account.back")
                Spacer()
            }
            .padding(.horizontal, DS.Space.l)
            .padding(.top, DS.Space.m)
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.l) {
                    switch step {
                    case .age: age
                    case .account: account
                    case .checkEmail(let address): checkEmail(address)
                    case .done: ready
                    case .grownUp: grownUp
                    }
                }
                .frame(maxWidth: 560, alignment: .leading)
                .padding(.horizontal, DS.Space.xl)
                .padding(.top, DS.Space.xxl)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(DS.Color.ground.ignoresSafeArea())
    }

    // MARK: 1 · age

    private var age: some View {
        Group {
            title("How old are you?", lede: "So we set up the right kind of account.")
            ageCard("13 or older", hint: "Make your own free account: 20 free tutor questions a day.", id: "sat.account.13plus") {
                withAnimation(DS.Motion.snap) { step = .account }
            }
            ageCard("Under 13", hint: "A grown-up sets it up with you.", id: "sat.account.under13") {
                withAnimation(DS.Motion.snap) { step = .grownUp }
            }
            Button("I have an account. Sign in") {
                Task {
                    // the anonymous session goes; sign-in takes over
                    try? await backend.auth.signOut(scope: .local)
                    onDone()
                }
            }
            .buttonStyle(.plain)
            .dsFont(.button, size: 17)
            .foregroundStyle(DS.Color.ink)
            .frame(minHeight: DS.Size.minTarget)
            .accessibilityIdentifier("sat.account.signIn")
        }
    }

    private func ageCard(_ big: String, hint: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: DS.Space.m) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(big).dsFont(.headline, size: 28).foregroundStyle(DS.Color.ink)
                    Text(hint).dsFont(.callout).foregroundStyle(DS.Color.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: DS.Space.s)
                DSIcon(.forward, size: 16)
                    .foregroundStyle(DS.Color.onInk)
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(DS.Color.ink))
            }
            .padding(DS.Space.xl)
            .background(RoundedRectangle(cornerRadius: DS.Radius.card, style: .continuous).fill(DS.Color.paper))
            .contentShape(RoundedRectangle(cornerRadius: DS.Radius.card, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }

    // MARK: 2 · the account (13+)

    private var account: some View {
        Group {
            title("Make your account", lede: "Your SAT practice so far comes with you.")
            PillField("Email", text: $email, icon: .person, onPaper: false)
                .textContentType(.username)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("sat.account.email")
            PillField("Password (8 or more characters)", text: $password, icon: .lock, secure: true, onPaper: false)
                .textContentType(.newPassword)
                .accessibilityIdentifier("sat.account.password")
            if let error {
                Text(error).dsFont(.callout).foregroundStyle(DS.Color.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("sat.account.error")
            }
            PillButton(busy ? "Making it…" : "Make my account", kind: .primary, size: .large) { Task { await make() } }
                .disabled(busy || !valid)
                .fixedSize()
                .accessibilityIdentifier("sat.account.make")
            Text("By making an account you agree to Agathon's Terms and Privacy Policy.")
                .dsFont(.caption)
                .foregroundStyle(DS.Color.inkSecondary)
        }
    }

    private var valid: Bool {
        email.contains("@") && email.contains(".") && password.count >= 8
    }

    private func make() async {
        busy = true
        error = nil
        defer { busy = false }
        #if DEBUG
        if SATDebug.isStub {
            step = .checkEmail(email)
            return
        }
        #endif
        do {
            switch try await backend.auth.upgradeAnonymous(email: email, password: password) {
            case .signedIn: step = .done
            case .confirmEmail: step = .checkEmail(email)
            }
        } catch {
            self.error = AuthService.message(for: error)
        }
    }

    // MARK: 3 · after

    private func checkEmail(_ address: String) -> some View {
        Group {
            title("Check your email", lede: "Open the link we sent to \(address) to finish. Keep practicing meanwhile.")
            PillButton("Back to practice", kind: .primary, size: .large, action: onDone)
                .fixedSize()
                .accessibilityIdentifier("sat.account.done")
        }
    }

    private var ready: some View {
        Group {
            title("You're all set", lede: "20 free tutor questions a day, and your practice so far.")
            PillButton("Back to practice", kind: .primary, size: .large, action: onDone)
                .fixedSize()
                .accessibilityIdentifier("sat.account.done")
        }
    }

    // MARK: under 13

    private var grownUp: some View {
        Group {
            title("Ask a grown-up", lede: "A grown-up makes the account with you. It takes about a minute.")
            PillButton("Start with a grown-up", icon: .family, kind: .primary, size: .large) {
                SATAccountRoute.startGrownUpFirstRun()
                onUnder13()
            }
            .fixedSize()
            .accessibilityIdentifier("sat.account.grownUp")
        }
    }

    private func title(_ words: String, lede: String) -> some View {
        VStack(alignment: .leading, spacing: DS.Space.s) {
            Text(words).dsFont(.title, size: 38).foregroundStyle(DS.Color.ink)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("sat.account.title")
            Text(lede).dsFont(.body).foregroundStyle(DS.Color.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.bottom, DS.Space.s)
    }
}

/// An under-13 from SAT practice: the grown-up's first run, from its start (RootView listens).
enum SATAccountRoute {
    static let startFirstRun = Notification.Name("agathon.sat.startGrownUpFirstRun")

    @MainActor static func startGrownUpFirstRun() {
        OnboardingState.reset()
        NotificationCenter.default.post(name: startFirstRun, object: nil)
    }
}
