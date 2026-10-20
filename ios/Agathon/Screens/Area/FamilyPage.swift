import AgathonDesign
import AgathonKit
import SwiftUI

/// Family (src/components/family): the grown-up's PIN, the kids with their week, and adding,
/// changing, removing and switching to a kid.
struct FamilyPage: View {
    @Environment(AgathonBackend.self) private var backend
    @State private var family: FamilyState?
    @State private var loading = true
    @State private var error: String?
    @State private var editing: KidEdit?
    @State private var removing: FamilyMember?
    @State private var settingPin = false
    @State private var note: String?
    @State private var switchProblem: String?

    struct KidEdit: Identifiable {
        let member: FamilyMember?
        var id: String { member?.userId ?? "new" }
    }

    private var kids: [FamilyMember] { family?.members.filter { !$0.isParent } ?? [] }

    var body: some View {
        AreaPage("Family", subtitle: "Each kid gets their own boards, practice and path.") {
            AreaStatus(loading: loading && family == nil, error: family == nil ? error : nil) { Task { await load() } }
            if let family, !FamilyState.who(family, email: backend.auth.email).isGrownUp {
                // a kid's profile (the area decided before the family said so, or a stale screen):
                // the grown-ups' controls never show; the server would refuse them anyway (403 `kid`)
                AreaCard("Grown-ups only") {
                    Text("You're on a kid's profile. The PIN and the kids' profiles are the grown-up's. Switch to the grown-up's profile with their PIN to change them.")
                        .dsFont(.callout).foregroundStyle(DS.Color.ink)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("family.kidProfile")
                }
            } else if let family {
                if let note {
                    Banner(.success, note)
                }
                if let switchProblem {
                    Banner(.lookAgain, switchProblem)
                }
                AreaCard("Your PIN") {
                    Text(family.hasPin ? "Kids need it to switch to you. Keep it to yourself."
                                       : "Set a 4-digit PIN first. Kids need it to switch to you, so they can't reach the grown-up places.")
                        .dsFont(.callout).foregroundStyle(DS.Color.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    PillButton(family.hasPin ? "Change PIN" : "Set PIN", icon: .lock, kind: .secondaryOnPaper) { settingPin = true }
                        .fixedSize()
                        .accessibilityIdentifier("family.pin")
                }
                AreaCard("Kids") {
                    if kids.isEmpty {
                        Text("No kids yet. Add one and they get their own boards and practice.")
                            .dsFont(.callout).foregroundStyle(DS.Color.inkSecondary)
                    }
                    ForEach(kids) { kid in
                        kidRow(kid, in: family)
                    }
                    if kids.count < FamilyService.maxKids {
                        PillButton("Add a kid", icon: .plus, kind: .primary) { editing = KidEdit(member: nil) }
                            .fixedSize()
                            .disabled(!family.hasPin)
                            .accessibilityIdentifier("family.add")
                        if !family.hasPin {
                            Text("Set your PIN first, then add kids.").dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
                        }
                    }
                }
            }
        }
        .task { await load() }
        .sheet(item: $editing) { edit in
            KidEditorSheet(member: edit.member) { await load() }.environment(backend)
        }
        .sheet(item: $removing) { kid in
            RemoveKidSheet(kid: kid) { await load() }.environment(backend)
        }
        .sheet(isPresented: $settingPin) {
            SetPinSheet(changing: family?.hasPin ?? false) {
                note = "PIN saved."
                await load()
            }
            .environment(backend)
        }
    }

    private func kidRow(_ kid: FamilyMember, in family: FamilyState) -> some View {
        HStack(spacing: DS.Space.m) {
            Avatar(kid.displayName, color: AvatarColor.color(for: kid, in: family), diameter: 56)
            VStack(alignment: .leading, spacing: 4) {
                Text(kid.displayName).dsFont(.button, size: 19).foregroundStyle(DS.Color.ink)
                Text(details(kid)).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
            }
            Spacer(minLength: DS.Space.s)
            Menu {
                Button("Switch to \(kid.displayName)", systemImage: DS.Icon.family.systemName) { switchTo(kid) }
                Button("Change name, grade or color", systemImage: DS.Icon.pen.systemName) { editing = KidEdit(member: kid) }
                Button("Remove \(kid.displayName)", systemImage: DS.Icon.trash.systemName, role: .destructive) { removing = kid }
            } label: {
                DSIcon(.more, size: 20)
                    .foregroundStyle(DS.Color.ink)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(DS.Color.surfaceSunken))
                    .frame(width: DS.Size.minTarget, height: DS.Size.minTarget)
            }
            .accessibilityLabel("More for \(kid.displayName)")
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("family.kid.\(kid.displayName)")
    }

    private func details(_ kid: FamilyMember) -> String {
        var parts = [kid.grade.map(GradePath.gradeName) ?? "High school / not sure"]
        if let stats = kid.stats {
            parts.append("\(stats.problemsThisWeek) problem\(stats.problemsThisWeek == 1 ? "" : "s") this week")
            if stats.streak > 0 { parts.append("\(stats.streak)-day streak") }
        }
        return parts.joined(separator: " · ")
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            family = try await backend.family.load()
            error = nil
        } catch {
            self.error = FamilyWords.message(error, .load)
        }
    }

    private func switchTo(_ kid: FamilyMember) {
        Task {
            do {
                try await backend.family.switchProfile(to: kid.userId)
            } catch {
                note = nil
                switchProblem = FamilyWords.message(error, .switchProfile)
            }
        }
    }
}

/// Add a kid, or change one: first name, grade, colour.
struct KidEditorSheet: View {
    let member: FamilyMember?
    let saved: () async -> Void

    @Environment(AgathonBackend.self) private var backend
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var grade: Int?
    @State private var avatar: String
    @State private var busy = false
    @State private var problem: String?

    init(member: FamilyMember?, saved: @escaping () async -> Void) {
        self.member = member
        self.saved = saved
        _name = State(initialValue: member?.displayName ?? "")
        _grade = State(initialValue: member == nil ? 3 : member?.grade)
        _avatar = State(initialValue: member?.avatar ?? AvatarColor.choices[0].id)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.l) {
            SheetHeader(member == nil ? "Add a kid" : "Change \(member?.displayName ?? "")", onClose: { dismiss() })
            Text("First name or nickname").dsFont(.button, size: 16).foregroundStyle(DS.Color.ink)
            PillField("Maya", text: $name, icon: .person)
                .textInputAutocapitalization(.words)
                .accessibilityIdentifier("kid.name")
            Text("Grade").dsFont(.button, size: 16).foregroundStyle(DS.Color.ink)
            GradePicker(selection: $grade, allowsNone: true)
            Text("Color").dsFont(.button, size: 16).foregroundStyle(DS.Color.ink)
            HStack(spacing: DS.Space.s) {
                ForEach(AvatarColor.choices, id: \.id) { choice in
                    Button {
                        avatar = choice.id
                    } label: {
                        Avatar(name.isEmpty ? "?" : name, color: choice.rgb, diameter: 52)
                            .padding(4)
                            .overlay(Circle().strokeBorder(avatar == choice.id ? DS.Color.ink : Color.clear, lineWidth: DS.Stroke.selected))
                            .frame(width: DS.Size.minTarget + 4, height: DS.Size.minTarget + 4)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(choice.name)
                    .accessibilityAddTraits(avatar == choice.id ? .isSelected : [])
                }
            }
            if let problem {
                Banner(.lookAgain, problem)
            }
            HStack(spacing: DS.Space.s) {
                Button { dismiss() } label: { Text("Cancel").frame(maxWidth: .infinity) }
                    .buttonStyle(.pill(.secondaryOnPaper, size: .large))
                Button(action: save) { Text(busy ? "Saving…" : (member == nil ? "Add" : "Save")).frame(maxWidth: .infinity) }
                    .buttonStyle(.pill(.primary, size: .large))
                    .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                    .accessibilityIdentifier("kid.save")
            }
        }
        .blocksSheet(width: 600)
        .interactiveDismissDisabled(busy)
    }

    private func save() {
        busy = true
        problem = nil
        Task {
            defer { busy = false }
            do {
                if let member {
                    try await backend.family.updateKid(id: member.userId, name: name, grade: grade, avatar: avatar)
                } else {
                    try await backend.family.addKid(name: name, grade: grade, avatar: avatar)
                }
                await saved()
                dismiss()
            } catch {
                problem = Self.message(error, adding: member == nil)
            }
        }
    }

    /// The family routes' refusals, in the web's words (src/lib/family/copy.ts): AgathonKit's FamilyWords.
    static func message(_ error: Error, adding: Bool = true) -> String {
        FamilyWords.message(error, adding ? .addKid : .editKid)
    }
}

/// Remove a kid, asked properly.
struct RemoveKidSheet: View {
    let kid: FamilyMember
    let removed: () async -> Void

    @Environment(AgathonBackend.self) private var backend
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.l) {
            SheetHeader("Remove \(kid.displayName)?", onClose: { dismiss() })
            Text("This deletes \(kid.displayName)'s profile for good: their boards, practice and progress. It can't be undone.")
                .dsFont(.body).foregroundStyle(DS.Color.ink).fixedSize(horizontal: false, vertical: true)
            if let problem { Banner(.lookAgain, problem) }
            HStack(spacing: DS.Space.s) {
                Button { dismiss() } label: { Text("Keep \(kid.displayName)").frame(maxWidth: .infinity) }
                    .buttonStyle(.pill(.secondaryOnPaper, size: .large))
                Button(action: remove) { Text(busy ? "Removing…" : "Remove").frame(maxWidth: .infinity) }
                    .buttonStyle(.pill(.primary, size: .large))
                    .disabled(busy)
            }
        }
        .blocksSheet()
        .interactiveDismissDisabled(busy)
    }

    private func remove() {
        busy = true
        Task {
            defer { busy = false }
            do {
                try await backend.family.removeKid(id: kid.userId)
                await removed()
                dismiss()
            } catch {
                problem = FamilyWords.message(error, .removeKid(name: kid.displayName))
            }
        }
    }
}

/// Set or change the grown-up's PIN on the PIN pad: once, then again to be sure.
struct SetPinSheet: View {
    let changing: Bool
    let saved: () async -> Void

    @Environment(AgathonBackend.self) private var backend
    @Environment(\.dismiss) private var dismiss
    @State private var first: String?
    @State private var entry = ""
    @State private var problem: String?
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.l) {
            SheetHeader(changing ? "Change your PIN" : "Set your PIN", onClose: { dismiss() })
            Text(first == nil ? "Pick 4 digits a kid won't guess." : "Type it again.")
                .dsFont(.callout).foregroundStyle(DS.Color.inkSecondary)
            VStack(spacing: DS.Space.l) {
                PinDots(count: entry.count, lookAgain: problem != nil && entry.isEmpty)
                if let problem {
                    Text(problem).dsFont(.callout).foregroundStyle(DS.Color.ink)
                }
                PinPad(entry: $entry) { typed in
                    if let first {
                        if typed == first { save(typed) } else {
                            problem = "Those didn't match. Start again."
                            self.first = nil
                            entry = ""
                        }
                    } else {
                        first = typed
                        problem = nil
                        entry = ""
                    }
                }
                .disabled(busy)
            }
            .frame(maxWidth: .infinity)
        }
        .blocksSheet()
        .interactiveDismissDisabled(busy)
    }

    private func save(_ pin: String) {
        busy = true
        Task {
            defer { busy = false }
            do {
                try await backend.family.setPin(pin)
                await saved()
                dismiss()
            } catch {
                // the server's reason in words: a kid's profile is told to switch to the grown-up
                // (403 `kid`), never just "try again"
                problem = FamilyWords.message(error, .setPin)
                first = nil
                entry = ""
            }
        }
    }
}
