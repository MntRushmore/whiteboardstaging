import AgathonDesign
import AgathonKit
import SwiftUI

/// Sign in, create an account, or get a reset link: the web's /login (src/components/login/
/// LoginForm.tsx), in Blocks. Sign-up sends the Terms version (`AuthService.signUp`), which the
/// database requires, after the person ticks the consent box.
struct SignInView: View {
    enum Mode: String, CaseIterable, Hashable {
        case signIn, signUp, forgot
    }

    /// What was emailed: shown in place of the form until the person goes back.
    enum Sent: Equatable {
        case confirmSignUp(String)
        case reset(String)
    }

    @Environment(AgathonBackend.self) private var backend
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var mode: Mode
    @State private var email = ""
    @State private var password = ""
    @State private var agreed = false
    @State private var busy = false
    @State private var error: String?
    @State private var sent: Sent?
    @State private var page: WebPage?

    init(mode: Mode = .signIn) {
        _mode = State(initialValue: mode)
    }

    var body: some View {
        ZStack {
            DS.Color.ground.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    AgathonLogo(size: 30, assembles: true)
                        .padding(.top, DS.Space.l)
                    Spacer(minLength: DS.Space.xxl)
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .center, spacing: DS.Space.xxxl) {
                            heading.frame(width: 420, alignment: .leading)
                            panel.frame(width: 520)
                        }
                        .frame(maxWidth: .infinity)
                        VStack(alignment: .leading, spacing: DS.Space.xl) {
                            heading
                            panel
                        }
                        .frame(maxWidth: 560)
                        .frame(maxWidth: .infinity)
                    }
                    Spacer(minLength: DS.Space.xxl)
                }
                .padding(.horizontal, ScreenMargin.horizontal(sizeClass))
                .frame(minHeight: 700)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .sheet(item: $page) { page in
            SafariSheet(url: page.url).ignoresSafeArea()
        }
        .onChange(of: mode) {
            error = nil
        }
    }

    // MARK: the words on the left

    private var heading: some View {
        VStack(alignment: .leading, spacing: DS.Space.m) {
            Text(title)
                .dsFont(.display, size: 56)
                .foregroundStyle(DS.Color.ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("signin.title")
            Text(lede)
                .dsFont(.body)
                .foregroundStyle(DS.Color.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var title: String {
        if sent != nil { return "Check your email." }
        switch mode {
        case .signIn: return "Welcome back."
        case .signUp: return "Make your account."
        case .forgot: return "Reset your password."
        }
    }

    private var lede: String {
        switch sent {
        case .confirmSignUp: return "Open the link we sent, then come back here to sign in."
        case .reset: return "If this email has an account, a link to choose a new password is on its way."
        case nil: break
        }
        switch mode {
        case .signIn: return "Sign in to open your boards."
        case .signUp: return "All it takes is an email and a password."
        case .forgot: return "Enter the email you signed up with. We'll send a link to choose a new password."
        }
    }

    // MARK: the form on the right

    @ViewBuilder private var panel: some View {
        if let sent {
            sentCard(sent)
        } else {
            VStack(alignment: .leading, spacing: DS.Space.l) {
                if mode != .forgot {
                    SegmentedPicker(selection: $mode, options: [(Mode.signIn, "Sign in"), (Mode.signUp, "Create account")])
                        .accessibilityIdentifier("signin.mode")
                }
                form
            }
        }
    }

    private var form: some View {
        Card(.paper, radius: DS.Radius.cardLarge) {
            VStack(alignment: .leading, spacing: DS.Space.m) {
                fieldLabel("Email")
                PillField("you@example.com", text: $email, icon: .person)
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(mode == .forgot ? .send : .next)
                    .onSubmit { if mode == .forgot { submit() } }
                    .accessibilityIdentifier("signin.email")
                if mode != .forgot {
                    fieldLabel("Password")
                    PillField(mode == .signUp ? "8 or more characters" : "Your password", text: $password,
                              icon: .lock, secure: true)
                        .textContentType(mode == .signUp ? .newPassword : .password)
                        .submitLabel(.go)
                        .onSubmit(submit)
                        .accessibilityIdentifier("signin.password")
                }
                if mode == .signUp {
                    ConsentBox(agreed: $agreed) { page = WebPage(url: $0) }
                        .padding(.top, DS.Space.xxs)
                }
                if let error {
                    Banner(.lookAgain, error)
                        .accessibilityIdentifier("signin.error")
                        .transition(.opacity)
                }
                submitButton
                    .padding(.top, DS.Space.xs)
                switch mode {
                case .signIn:
                    textButton("Forgot your password?", id: "signin.forgot") { switchMode(.forgot) }
                case .forgot:
                    textButton("Back to sign in", icon: .back, id: "signin.back") { switchMode(.signIn) }
                case .signUp:
                    EmptyView()
                }
            }
        }
        .dsAnimation(DS.Motion.snap, value: error)
        .dsAnimation(DS.Motion.snap, value: mode)
    }

    private func fieldLabel(_ text: String) -> some View {
        Text(text)
            .dsFont(.button, size: 16)
            .foregroundStyle(DS.Color.ink)
            .accessibilityHidden(true)
    }

    private var submitButton: some View {
        Button(action: submit) {
            HStack(spacing: DS.Space.s) {
                if busy {
                    ProgressView().tint(DS.Color.ink)
                }
                Text(busy ? busyLabel : idleLabel)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.pill(.sunny, size: .large))
        .disabled(busy)
        .accessibilityIdentifier("signin.submit")
    }

    private var idleLabel: String {
        switch mode {
        case .signIn: return "Sign in"
        case .signUp: return "Create account"
        case .forgot: return "Send reset link"
        }
    }

    private var busyLabel: String {
        switch mode {
        case .signIn: return "Signing in…"
        case .signUp: return "Making your account…"
        case .forgot: return "Sending…"
        }
    }

    private func textButton(_ title: String, icon: DS.Icon? = nil, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let icon { DSIcon(icon, size: 16) }
                Text(title).dsFont(.button, size: 16)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.pill(.quiet))
        .disabled(busy)
        .accessibilityIdentifier(id)
    }

    private func sentCard(_ sent: Sent) -> some View {
        let address: String = switch sent {
        case .confirmSignUp(let a), .reset(let a): a
        }
        return Card(.paper, radius: DS.Radius.cardLarge) {
            VStack(alignment: .leading, spacing: DS.Space.m) {
                IconCircle(.send, fill: .sunny, diameter: 72)
                Text("We sent it to")
                    .dsFont(.callout)
                    .foregroundStyle(DS.Color.inkSecondary)
                Text(address)
                    .dsFont(.heading)
                    .foregroundStyle(DS.Color.ink)
                    .textSelection(.enabled)
                    .accessibilityIdentifier("signin.notice")
                Text("Nothing after a few minutes? Check your spam folder, or go back and try again.")
                    .dsFont(.callout)
                    .foregroundStyle(DS.Color.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button {
                    withDSAnimation(reduceMotion: reduceMotion) {
                        self.sent = nil
                        mode = .signIn
                    }
                } label: {
                    Text("Back to sign in").frame(maxWidth: .infinity)
                }
                .buttonStyle(.pill(.secondaryOnPaper, size: .large))
                .padding(.top, DS.Space.xs)
                .accessibilityIdentifier("signin.back")
            }
        }
    }

    // MARK: actions

    private func switchMode(_ next: Mode) {
        guard !busy else { return }
        withDSAnimation(reduceMotion: reduceMotion) { mode = next }
        error = nil
    }

    private func validate() -> String? {
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines)
        if address.isEmpty { return "Enter your email address." }
        if address.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) == nil {
            return "Enter a full email address, like you@example.com."
        }
        switch mode {
        case .signIn:
            if password.isEmpty { return "Enter your password." }
        case .signUp:
            if password.count < 8 { return "Use 8 or more characters for the password." }
            if !agreed { return "Tick the box to agree before you make your account." }
        case .forgot:
            break
        }
        return nil
    }

    private func submit() {
        guard !busy else { return }
        error = validate()
        guard error == nil else { return }
        busy = true
        let mode = mode
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            defer { busy = false }
            do {
                switch mode {
                case .signIn:
                    try await backend.auth.signIn(email: address, password: password)
                case .signUp:
                    if try await backend.auth.signUp(email: address, password: password) == .confirmEmail {
                        password = ""
                        sent = .confirmSignUp(address)
                    }
                case .forgot:
                    try await backend.auth.sendPasswordReset(email: address)
                    sent = .reset(address)
                }
            } catch {
                self.error = AuthService.message(for: error)
                // Our failures go to the admin page; never a wrong password or the address.
                if AuthService.isUsersOwnMistake(error) { return }
                let code = switch mode {
                case .signIn: "signin_failed"
                case .signUp: "signup_failed"
                case .forgot: "forgot_failed"
                }
                await backend.errors.reportUserError(kind: "live.auth", code: code, message: self.error ?? "",
                                                     level: .warn, path: "/login")
            }
        }
    }
}

/// Sign-up's consent: the Terms, the Privacy Policy and the age line, in one tick box. The links
/// open in an in-app Safari sheet, so the form keeps what was typed.
struct ConsentBox: View {
    @Binding var agreed: Bool
    let openPage: (URL) -> Void

    static let ageLine = "I'm 13 or older, or I'm a parent or guardian setting this up for my child."

    var body: some View {
        HStack(alignment: .top, spacing: DS.Space.s) {
            Button {
                agreed.toggle()
            } label: {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(agreed ? DS.Color.ink : DS.Color.surfaceSunken)
                    .frame(width: 32, height: 32)
                    .overlay {
                        if agreed {
                            CheckShape()
                                .stroke(DS.Color.sunny, style: StrokeStyle(lineWidth: 3.5, lineCap: .round, lineJoin: .round))
                                .frame(width: 18, height: 18)
                        }
                    }
                    .frame(width: DS.Size.minTarget, height: DS.Size.minTarget)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.leading, -12)
            .padding(.top, -12)
            .accessibilityLabel("I agree to the Terms and the Privacy Policy. \(Self.ageLine)")
            .accessibilityValue(agreed ? "Ticked" : "Not ticked")
            .accessibilityAddTraits(agreed ? [.isSelected] : [])
            .accessibilityIdentifier("signin.consent")

            VStack(alignment: .leading, spacing: 6) {
                Text(LocalizedStringKey("I agree to the [Terms](\(AppLinks.terms.absoluteString)) and the [Privacy Policy](\(AppLinks.privacy.absoluteString))."))
                    .tint(DS.Color.tutorInk)
                    .environment(\.openURL, OpenURLAction { url in
                        openPage(url)
                        return .handled
                    })
                Text(Self.ageLine)
                    .onTapGesture { agreed.toggle() }
                    .accessibilityHidden(true)
            }
            .dsFont(.callout)
            .foregroundStyle(DS.Color.ink)
            .fixedSize(horizontal: false, vertical: true)
        }
    }
}

#Preview("Sign in") {
    SignInView()
        .environment(AgathonBackend.preview())
}

#Preview("Create account") {
    SignInView(mode: .signUp)
        .environment(AgathonBackend.preview())
}
