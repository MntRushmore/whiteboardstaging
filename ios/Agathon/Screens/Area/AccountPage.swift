import AgathonDesign
import AgathonKit
import AgathonStore
import StoreKit
import SwiftUI

/// The grown-up's account (src/app/(platform)/account): name, grade (when there are no kids), the
/// plan in words, what Ask remembers, and deleting the account (type DELETE; a plan that would
/// charge again is cancelled first, in Settings for an Apple subscription).
struct AccountPage: View {
    let family: FamilyState?

    @Environment(AgathonBackend.self) private var backend
    @State private var profile: Profile?
    @State private var ink: InkSummary?
    @State private var name = ""
    @State private var savedName = ""
    @State private var nameNote: String?
    @State private var savingName = false
    @State private var grade: Int?
    @State private var gradeNote: String?
    @State private var deleting = false
    @State private var showsPlan = false
    /// the plan couldn't be read: say so (and offer the read again), never spin
    @State private var inkFailed = false

    private var account: AccountService { AccountService(api: backend.api, client: backend.supabase) }
    private var hasKids: Bool { family?.members.contains { !$0.isParent } ?? false }

    var body: some View {
        AreaPage("Account") {
            AreaCard("Profile") {
                LabeledLine(label: "Email", value: backend.auth.email ?? "")
                Text("Display name").dsFont(.button, size: 16).foregroundStyle(DS.Color.ink).padding(.top, DS.Space.xs)
                HStack(spacing: DS.Space.s) {
                    PillField("Your name", text: $name, icon: .person)
                        .submitLabel(.done)
                        .onSubmit(saveName)
                        .accessibilityIdentifier("account.name")
                    PillButton(savingName ? "Saving…" : "Save", kind: .primary, action: saveName)
                        .fixedSize()
                        .disabled(savingName || name.trimmingCharacters(in: .whitespaces) == savedName)
                }
                if let nameNote {
                    Text(nameNote).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
                }
            }
            if !hasKids {
                AreaCard("Grade") {
                    Text("Your tutor picks problems for this grade. Change it any time.")
                        .dsFont(.callout).foregroundStyle(DS.Color.inkSecondary)
                    GradePicker(selection: Binding(get: { grade }, set: { saveGrade($0) }), allowsNone: false)
                    if let gradeNote {
                        Text(gradeNote).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
                    }
                }
                .accessibilityIdentifier("account.grade")
            }
            AreaCard("Plan") {
                PlanWords(ink: ink, failed: inkFailed) { Task { await load() } }
                PillButton(ink?.hasUnlimited == true ? "Manage the plan" : "See the plan", icon: .lock, kind: .secondaryOnPaper) { showsPlan = true }
                    .fixedSize()
                    .padding(.top, DS.Space.xs)
                    .accessibilityHint("For grown-ups")
                    .accessibilityIdentifier("account.plan")
            }
            AskMemoryCard(kidId: nil, owner: "you")
            AreaCard("Danger zone") {
                Text("Deleting your account deletes every board on it\(hasKids ? ", and your kids' profiles" : ""). It can't be undone.")
                    .dsFont(.callout)
                    .foregroundStyle(DS.Color.ink)
                    .fixedSize(horizontal: false, vertical: true)
                PillButton("Delete my account", icon: .trash, kind: .secondaryOnPaper) { deleting = true }
                    .fixedSize()
                    .accessibilityIdentifier("account.delete")
            }
        }
        .task { await load() }
        .sheet(isPresented: $deleting) {
            DeleteAccountSheet(email: backend.auth.email ?? "", hasKids: hasKids).environment(backend)
        }
        .fullScreenCover(isPresented: $showsPlan, onDismiss: { Task { await load() } }) {
            GrownUpPlanFlow { showsPlan = false }
                .environment(backend)
        }
    }

    private func load() async {
        async let profileRow = try? backend.profiles.profile()
        async let inkRow = try? backend.profiles.inkSummary()
        profile = await profileRow ?? nil
        ink = await inkRow ?? nil
        inkFailed = ink == nil
        name = profile?.displayName ?? ""
        savedName = name
        grade = profile?.grade
    }

    private func saveName() {
        guard !savingName else { return }
        savingName = true
        Task {
            defer { savingName = false }
            do {
                try await account.updateDisplayName(name)
                savedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
                nameNote = "Saved."
            } catch {
                nameNote = userMessage(for: error)
            }
        }
    }

    private func saveGrade(_ next: Int?) {
        guard let next else { return }
        let before = grade
        grade = next
        Task {
            do {
                try await account.saveGrade(next)
                gradeNote = "Saved. Your path is now \(GradePath.gradeName(next))."
            } catch {
                grade = before
                gradeNote = "That didn't save. Try again in a moment."
            }
        }
    }
}

/// The kid's own account page: their picture, name and grade (their grown-up changes those), what
/// Ask remembers. No billing, no delete.
struct KidAccountPage: View {
    let family: FamilyState?

    var body: some View {
        AreaPage("Me") {
            if let me = family?.meMember {
                AreaCard {
                    HStack(spacing: DS.Space.m) {
                        Avatar(me.displayName, color: AvatarColor.color(for: me, in: family), diameter: 72)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(me.displayName).dsFont(.headline).foregroundStyle(DS.Color.ink)
                            Text(me.grade.map(GradePath.gradeName) ?? "No grade yet")
                                .dsFont(.callout).foregroundStyle(DS.Color.inkSecondary)
                        }
                    }
                    Text("Your grown-up looks after your plan and your profile. Ask them to change your name or grade.")
                        .dsFont(.callout)
                        .foregroundStyle(DS.Color.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            AskMemoryCard(kidId: nil, owner: "you")
        }
    }
}

/// A label and its value on one line.
struct LabeledLine: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).dsFont(.button, size: 16).foregroundStyle(DS.Color.ink)
            Spacer(minLength: DS.Space.s)
            Text(value).dsFont(.callout).foregroundStyle(DS.Color.inkSecondary).lineLimit(1).textSelection(.enabled)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Kindergarten to 8th as chips; the chosen one is ink. `allowsNone` adds "High school / not sure".
struct GradePicker: View {
    @Binding var selection: Int?
    var allowsNone: Bool

    var body: some View {
        FlowStack(spacing: DS.Space.xs, lineSpacing: DS.Space.xs) {
            ForEach(0 ... 8, id: \.self) { grade in
                chip(grade == 0 ? "K" : "\(grade)", label: GradePath.gradeName(grade), on: selection == grade) { selection = grade }
            }
            if allowsNone {
                chip("High school / not sure", label: "High school or not sure", on: selection == nil) { selection = nil }
            }
        }
    }

    private func chip(_ title: String, label: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .dsFont(.button, size: 17)
                .foregroundStyle(on ? DS.Color.onInk : DS.Color.ink)
                .padding(.horizontal, 18)
                .frame(minWidth: DS.Size.minTarget, minHeight: DS.Size.minTarget)
                .background(Capsule().fill(on ? DS.Color.ink : DS.Color.surfaceSunken))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// The plan, in words, for the grown-up (never shown to kids).
struct PlanWords: View {
    let ink: InkSummary?
    var failed = false
    var retry: (() -> Void)?

    var body: some View {
        if ink == nil, failed {
            Text("Couldn't check the plan just now.").dsFont(.body).foregroundStyle(DS.Color.ink)
            if let retry {
                Button("Try again", action: retry)
                    .buttonStyle(.pill(.quiet))
                    .accessibilityIdentifier("account.plan.retry")
            }
        } else if let ink {
            if ink.hasUnlimited {
                Text(planLine(ink.unlimited)).dsFont(.body).foregroundStyle(DS.Color.ink)
                Text("Help on the board and in Ask is covered.").dsFont(.callout).foregroundStyle(DS.Color.inkSecondary)
            } else {
                Text("No plan right now.").dsFont(.body).foregroundStyle(DS.Color.ink)
                Text("Ink left: \(Int(ink.balance.rounded()))").dsFont(.callout).foregroundStyle(DS.Color.inkSecondary)
            }
        } else {
            ProgressView().tint(DS.Color.ink)
        }
    }

    private func planLine(_ plan: UnlimitedPlan?) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMMM d"
        formatter.locale = Locale(identifier: "en_US")
        if plan?.status == "trialing", let end = plan?.trialEnd {
            return "Agathon Unlimited, free until \(formatter.string(from: end))."
        }
        if plan?.cancelAtPeriodEnd == true, let end = plan?.currentPeriodEnd {
            return "Agathon Unlimited, ends \(formatter.string(from: end))."
        }
        return "Agathon Unlimited."
    }
}

/// What Ask remembers about the learner, and clearing it (asked first in a sheet).
struct AskMemoryCard: View {
    let kidId: String?
    let owner: String

    @Environment(AgathonBackend.self) private var backend
    @State private var memory: AccountService.AskMemory?
    @State private var problem: String?
    @State private var confirming = false
    @State private var clearing = false

    var body: some View {
        AreaCard("What Ask remembers") {
            if let memory {
                if memory.notes.isEmpty {
                    Text("Nothing yet. As you chat with Ask, it notes what helps you learn.")
                        .dsFont(.callout).foregroundStyle(DS.Color.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    VStack(alignment: .leading, spacing: DS.Space.xs) {
                        ForEach(Array(memory.notes.enumerated()), id: \.offset) { _, note in
                            HStack(alignment: .firstTextBaseline, spacing: DS.Space.xs) {
                                Circle().fill(DS.Color.ink).frame(width: 6, height: 6)
                                Text(note).dsFont(.callout).foregroundStyle(DS.Color.ink)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    PillButton("Clear", kind: .secondaryOnPaper) { confirming = true }
                        .fixedSize()
                        .accessibilityIdentifier("account.clearMemory")
                }
            } else if let problem {
                Text(problem).dsFont(.callout).foregroundStyle(DS.Color.inkSecondary)
            } else {
                ProgressView().tint(DS.Color.ink)
            }
        }
        .task { await load() }
        .sheet(isPresented: $confirming) {
            VStack(alignment: .leading, spacing: DS.Space.l) {
                SheetHeader("Clear what Ask remembers?", onClose: { confirming = false })
                Text("Ask will forget these notes and start fresh. Boards and chats stay.")
                    .dsFont(.body).foregroundStyle(DS.Color.ink)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: DS.Space.s) {
                    Button { confirming = false } label: { Text("Keep them").frame(maxWidth: .infinity) }
                        .buttonStyle(.pill(.secondaryOnPaper, size: .large))
                    Button(action: clear) { Text(clearing ? "Clearing…" : "Clear notes").frame(maxWidth: .infinity) }
                        .buttonStyle(.pill(.primary, size: .large))
                        .disabled(clearing)
                }
            }
            .blocksSheet()
        }
    }

    private func load() async {
        do {
            memory = try await AccountService(api: backend.api, client: backend.supabase).askMemory(kidId: kidId)
        } catch {
            problem = "Couldn't load Ask's notes. Try again in a moment."
        }
    }

    private func clear() {
        clearing = true
        Task {
            defer { clearing = false }
            do {
                memory = try await AccountService(api: backend.api, client: backend.supabase).clearAskMemory(kidId: kidId)
                confirming = false
            } catch {
                problem = "Couldn't clear the notes. Try again in a moment."
                confirming = false
            }
        }
    }
}

/// Deleting the account: what goes, type DELETE, then delete (AgathonStore's `DeletionAdvice`, the
/// server's `delete_own_account`):
///  - a web plan that would charge again: cancel it on agathon.app first (the server refuses);
///  - an Apple plan that would charge again: deleting is allowed (only the person can cancel it), but
///    the sheet says to cancel it in Settings first, with a button to Subscriptions;
///  - otherwise: nothing about money.
struct DeleteAccountSheet: View {
    let email: String
    let hasKids: Bool

    @Environment(AgathonBackend.self) private var backend
    @Environment(\.dismiss) private var dismiss
    @State private var typed = ""
    @State private var busy = false
    @State private var blocked: Bool?
    @State private var advice: DeletionAdvice = .clear
    @State private var problem: String?

    private var account: AccountService { AccountService(api: backend.api, client: backend.supabase) }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.l) {
            if blocked == true {
                SheetHeader("Cancel Agathon Unlimited first", onClose: { dismiss() })
                Text("Deleting your account doesn't cancel your plan, so cancel it first. Once it's set to cancel, you won't be charged again and you can delete your account here.")
                    .dsFont(.body).foregroundStyle(DS.Color.ink).fixedSize(horizontal: false, vertical: true)
                Text(DeletionAdvice.cancelOnWebFirst.message ?? "")
                    .dsFont(.callout).foregroundStyle(DS.Color.inkSecondary).fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("delete.advice")
                HStack(spacing: DS.Space.s) {
                    Link(destination: backend.environment.apiBaseURL.appendingPathComponent("account")) {
                        Text("Open agathon.app").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.pill(.primary, size: .large))
                    Button { dismiss() } label: { Text("Not now").frame(maxWidth: .infinity) }
                        .buttonStyle(.pill(.secondaryOnPaper, size: .large))
                }
            } else {
                SheetHeader("Delete your account?", onClose: { dismiss() })
                Text("This deletes \(email) and every board on it\(hasKids ? ", and your kids' profiles and their boards" : ""). This can't be undone.")
                    .dsFont(.body).foregroundStyle(DS.Color.ink).fixedSize(horizontal: false, vertical: true)
                if advice == .cancelAppleFirst, let words = advice.message {
                    // an Apple plan keeps charging after the account is gone: say so first
                    VStack(alignment: .leading, spacing: DS.Space.s) {
                        Banner(.paused, "Cancel your plan in Settings first", message: words)
                            .accessibilityIdentifier("delete.advice")
                        Button(action: manageSubscriptions) { Text("Open Subscriptions") }
                            .buttonStyle(.pill(.secondaryOnPaper))
                            .accessibilityIdentifier("delete.subscriptions")
                    }
                }
                Text("Type DELETE to confirm.").dsFont(.button, size: 16).foregroundStyle(DS.Color.ink)
                PillField("DELETE", text: $typed)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("delete.field")
                if let problem {
                    Banner(.lookAgain, problem)
                }
                HStack(spacing: DS.Space.s) {
                    Button { dismiss() } label: { Text("Keep my account").frame(maxWidth: .infinity) }
                        .buttonStyle(.pill(.secondaryOnPaper, size: .large))
                    Button(action: delete) {
                        Text(busy ? "Deleting…" : "Delete my account").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.pill(.primary, size: .large))
                    .disabled(busy || typed.trimmingCharacters(in: .whitespaces) != "DELETE" || blocked == nil)
                    .accessibilityIdentifier("delete.confirm")
                }
            }
        }
        .blocksSheet(width: 560)
        .interactiveDismissDisabled(busy)
        .task {
            async let blocks = try? account.planBlocksDeletion()
            async let summary = try? backend.profiles.inkSummary()
            let plan = await summary
            advice = DeletionAdvice(plan: plan?.unlimited)
            let refuses = await blocks
            blocked = (refuses ?? false) || advice == .cancelOnWebFirst
        }
    }

    private func manageSubscriptions() {
        Task { @MainActor in
            guard let scene = UIApplication.shared.connectedScenes.first(where: { $0 is UIWindowScene }) as? UIWindowScene else { return }
            try? await AppStore.showManageSubscriptions(in: scene)
        }
    }

    private func delete() {
        busy = true
        problem = nil
        let auth = backend.auth
        Task {
            defer { busy = false }
            do {
                try await account.deleteAccount { try await auth.signOut(scope: .local) }
            } catch AccountError.planStillActive {
                blocked = true
            } catch AccountError.kidProfile {
                problem = AccountError.kidProfile.errorDescription
            } catch {
                problem = "Your account wasn't deleted. Try again in a moment."
            }
        }
    }
}
