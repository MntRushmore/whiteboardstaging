#if DEBUG
import AgathonKit
import SwiftUI

/// Sign in, create an account, or ask for a reset link (the web's /login card, plain).
struct DebugSignInView: View {
    @Environment(AgathonBackend.self) private var backend

    enum Mode: String, CaseIterable, Identifiable {
        case signIn = "Sign in"
        case signUp = "Create account"
        case reset = "Reset password"
        var id: String { rawValue }
    }

    @State private var mode: Mode = .signIn
    @State private var email = ""
    @State private var password = ""
    @State private var agreed = false
    @State private var busy = false
    @State private var error: String?
    @State private var notice: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Mode", selection: $mode) {
                        ForEach(Mode.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("signin.mode")
                }

                Section {
                    TextField("Email", text: $email)
                        .keyboardType(.emailAddress)
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("signin.email")
                    if mode != .reset {
                        SecureField(mode == .signUp ? "Password (8 or more characters)" : "Password", text: $password)
                            .textContentType(mode == .signUp ? .newPassword : .password)
                            .accessibilityIdentifier("signin.password")
                    }
                    if mode == .signUp {
                        Toggle("I agree to the Terms and the Privacy Policy, and I'm 13 or older (or a grown-up setting this up for my child).",
                               isOn: $agreed)
                            .font(.callout)
                            .accessibilityIdentifier("signin.consent")
                    }
                }

                Section {
                    Button(action: submit) {
                        HStack {
                            Text(mode == .reset ? "Send reset link" : mode.rawValue)
                            if busy {
                                Spacer()
                                ProgressView()
                            }
                        }
                    }
                    .disabled(busy)
                    .accessibilityIdentifier("signin.submit")
                }

                if let error {
                    Section {
                        Text(error)
                            .foregroundStyle(.red)
                            .accessibilityIdentifier("signin.error")
                    }
                }
                if let notice {
                    Section {
                        Text(notice)
                            .accessibilityIdentifier("signin.notice")
                    }
                }

                Section {
                    DebugEnvironmentLine()
                } footer: {
                    Text("Debug screen (AgathonKit). Sign-up sends terms version \(TermsVersion.current).")
                }
            }
            .navigationTitle("Agathon")
            .onChange(of: mode) {
                error = nil
                notice = nil
            }
        }
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
            if password.count < 8 { return "Use 8 or more characters." }
            if !agreed { return "Tick the box to agree before you create your account." }
        case .reset:
            break
        }
        return nil
    }

    private func submit() {
        error = validate()
        notice = nil
        guard error == nil else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                switch mode {
                case .signIn:
                    try await backend.auth.signIn(email: email, password: password)
                case .signUp:
                    if try await backend.auth.signUp(email: email, password: password) == .confirmEmail {
                        notice = "Check your email: open the link we sent to finish making your account."
                    }
                case .reset:
                    try await backend.auth.sendPasswordReset(email: email)
                    notice = "If there's an account for that email, a reset link is on its way."
                }
            } catch {
                self.error = AuthService.message(for: error)
                // Our failures go to the admin page; never a wrong password or the address.
                if AuthService.isUsersOwnMistake(error) { return }
                await backend.errors.reportUserError(kind: "live.auth", code: "\(mode == .signIn ? "signin" : mode == .signUp ? "signup" : "forgot")_failed",
                                                     message: self.error ?? "", level: .warn, path: "/login")
            }
        }
    }
}

#Preview {
    DebugSignInView()
        .environment(AgathonBackend.preview())
}
#endif
