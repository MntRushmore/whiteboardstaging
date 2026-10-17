import AgathonKit
import SwiftUI

/// The family's profiles: become a kid with a tap, or the grown-up with their PIN; the grown-up
/// can set the PIN (POST /api/family/pin) before adding a kid.
struct DebugProfileSwitcher: View {
    @Environment(AgathonBackend.self) private var backend
    @Environment(\.dismiss) private var dismiss

    let initial: FamilyState?

    @State private var family: FamilyState?
    @State private var error: String?
    @State private var notice: String?
    @State private var busy = false
    @State private var pinFor: FamilyMember?
    @State private var pin = ""
    @State private var newPin = ""

    var body: some View {
        NavigationStack {
            List {
                if let family {
                    Section {
                        ForEach(family.members) { member in
                            Button {
                                choose(member, in: family)
                            } label: {
                                HStack(spacing: 12) {
                                    Text(FamilyAvatar.emoji(for: member.avatar)).font(.largeTitle)
                                    VStack(alignment: .leading) {
                                        Text(member.displayName).font(.headline)
                                        Text(subtitle(member)).font(.subheadline).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if member.userId == family.me {
                                        Text("You").foregroundStyle(.secondary)
                                    } else if member.needsPin {
                                        Image(systemName: "lock.fill").foregroundStyle(.secondary)
                                    }
                                }
                            }
                            .disabled(busy || member.userId == family.me)
                            .accessibilityIdentifier("switcher.member.\(member.displayName)")
                        }
                    } header: {
                        Text(family.role == .solo ? "Just you so far" : "Who's using Agathon?")
                    } footer: {
                        if family.role == .solo {
                            Text("Kid profiles are added on the Family page (the grown-up's PIN first).")
                        }
                    }

                    if let member = pinFor {
                        Section("\(member.displayName)'s PIN") {
                            SecureField("4-digit PIN", text: $pin)
                                .keyboardType(.numberPad)
                                .textContentType(.oneTimeCode)
                                .accessibilityIdentifier("switcher.pin")
                            Button("Switch to \(member.displayName)") { switchTo(member, pin: pin) }
                                .disabled(busy || !FamilyService.isValidPin(pin))
                                .accessibilityIdentifier("switcher.pinSubmit")
                        }
                    }

                    if family.role != .kid {
                        Section {
                            SecureField(family.hasPin ? "New 4-digit PIN" : "4-digit PIN", text: $newPin)
                                .keyboardType(.numberPad)
                                .accessibilityIdentifier("switcher.newPin")
                            Button(family.hasPin ? "Change PIN" : "Set PIN") { savePin() }
                                .disabled(busy || !FamilyService.isValidPin(newPin))
                                .accessibilityIdentifier("switcher.savePin")
                        } header: {
                            Text("Grown-up's PIN")
                        } footer: {
                            Text(family.hasPin ? "A PIN is set." : "No PIN yet: set one before adding a kid.")
                        }
                    }
                } else if error == nil {
                    ProgressView().frame(maxWidth: .infinity)
                }

                if let error {
                    Section {
                        Text(error)
                            .foregroundStyle(.red)
                            .accessibilityIdentifier("switcher.error")
                    }
                }
                if let notice {
                    Section {
                        Text(notice).accessibilityIdentifier("switcher.notice")
                    }
                }
            }
            .navigationTitle("Profiles")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                        .accessibilityIdentifier("switcher.done")
                }
            }
            .overlay {
                if busy { ProgressView().controlSize(.large) }
            }
            .task {
                family = initial
                await reload()
            }
        }
    }

    private func subtitle(_ member: FamilyMember) -> String {
        if member.isParent { return "Grown-up" }
        let grade = member.grade.map { $0 == 0 ? "Kindergarten" : "Grade \($0)" } ?? "Kid"
        if let stats = member.stats {
            return "\(grade) · \(stats.problemsThisWeek) problems this week · \(stats.streak)-day streak"
        }
        return grade
    }

    private func reload() async {
        do {
            family = try await backend.family.load()
            error = nil
        } catch {
            self.error = "Couldn't load the family. \(describe(error))"
        }
    }

    private func choose(_ member: FamilyMember, in family: FamilyState) {
        error = nil
        if member.needsPin {
            pin = ""
            pinFor = member
        } else {
            switchTo(member, pin: nil)
        }
    }

    private func switchTo(_ member: FamilyMember, pin: String?) {
        busy = true
        Task {
            defer { busy = false }
            do {
                try await backend.family.switchProfile(to: member.userId, pin: pin)
                // The session changed: RootView starts the home over as the new profile.
                dismiss()
            } catch {
                self.error = switchMessage(error)
                self.pin = ""
            }
        }
    }

    private func savePin() {
        busy = true
        Task {
            defer { busy = false }
            do {
                try await backend.family.setPin(newPin)
                newPin = ""
                notice = "PIN saved."
                await reload()
            } catch {
                self.error = "Couldn't save the PIN. \(describe(error))"
            }
        }
    }

    /// The web's switch errors (src/lib/family/switchError.ts), short.
    private func switchMessage(_ error: Error) -> String {
        guard let failure = (error as? APIError)?.failure else { return describe(error) }
        switch (failure.status, failure.reason) {
        case (403, "wrong_pin"):
            if failure.locked { return "That PIN isn't right. Switching to the grown-up is locked until they sign in." }
            return "That PIN isn't right." + (failure.triesLeft.map { " \($0) tr\($0 == 1 ? "y" : "ies") left." } ?? "")
        case (429, "pin_locked"):
            return "Too many wrong PINs today. The grown-up can sign in with their password."
        case (429, _):
            return "Too many tries. Wait a few minutes, then try again."
        case (_, "no_pin"):
            return "The grown-up hasn't set a PIN yet."
        default:
            return "Couldn't switch profiles. \(failure.message)"
        }
    }

    private func describe(_ error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }
}
