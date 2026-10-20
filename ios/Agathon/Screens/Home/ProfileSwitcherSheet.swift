import AgathonDesign
import AgathonKit
import SwiftUI

/// "Who's practicing?": the family's pictures. A kid becomes themselves with a tap; the grown-up
/// needs their PIN (POST /api/family/switch, then the new session). Sign out lives here too, as on
/// the web's profile menu.
struct ProfileSwitcherSheet: View {
    enum Start {
        /// The pictures first.
        case pick
        /// Straight to the grown-up's PIN (a kid tapped "Grown-ups").
        case grownUp
    }

    let initial: FamilyState?
    var start: Start = .pick
    /// Opens this profile's own places (Progress, account, bug reports).
    var openMine: (() -> Void)?

    @Environment(AgathonBackend.self) private var backend
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var family: FamilyState?
    @State private var loadError: String?
    @State private var busy = false
    @State private var pinFor: FamilyMember?
    @State private var pin = ""
    @State private var pinProblem: String?
    @State private var signOutProblem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.l) {
            if let member = pinFor {
                pinPage(member)
            } else {
                picker
            }
        }
        .blocksSheet(width: 600)
        .interactiveDismissDisabled(busy)
        .task {
            family = family ?? initial
            await reload()
        }
    }

    // MARK: the pictures

    @ViewBuilder private var picker: some View {
        SheetHeader("Who's practicing?", onClose: { dismiss() })
        if let family {
            if family.role == .solo {
                Text("Just you so far. Kids get their own boards and practice once a grown-up adds them in Family.")
                    .dsFont(.callout)
                    .foregroundStyle(DS.Color.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("Tap your picture.")
                    .dsFont(.callout)
                    .foregroundStyle(DS.Color.inkSecondary)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: DS.Space.s)], spacing: DS.Space.s) {
                ForEach(family.members) { member in
                    memberButton(member, in: family)
                }
            }
        } else if let loadError {
            Banner(.lookAgain, "Couldn't load your family.", message: loadError)
        } else {
            ProgressView()
                .tint(DS.Color.ink)
                .frame(maxWidth: .infinity, minHeight: 160)
        }
        if let signOutProblem {
            Banner(.lookAgain, signOutProblem)
        }
        if let openMine {
            Button {
                dismiss()
                openMine()
            } label: {
                HStack(spacing: DS.Space.xs) {
                    DSIcon(.chart, size: 18)
                    Text("My progress")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.pill(.secondaryOnPaper))
            .disabled(busy)
            .accessibilityIdentifier("switcher.mine")
        }
        Button(action: signOut) {
            HStack(spacing: DS.Space.xs) {
                DSIcon(.signOut, size: 18)
                Text("Sign out")
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.pill(.quiet))
        .disabled(busy)
        .accessibilityIdentifier("boards.signOut")
    }

    private func memberButton(_ member: FamilyMember, in family: FamilyState) -> some View {
        let isMe = member.userId == family.me
        return Button {
            choose(member)
        } label: {
            VStack(spacing: DS.Space.s) {
                Avatar(member.displayName, color: AvatarColor.color(for: member, in: family), diameter: 84)
                Text(member.displayName)
                    .dsFont(.button, size: 18)
                    .foregroundStyle(DS.Color.ink)
                    .lineLimit(1)
                if isMe {
                    Tag("You", style: .paper)
                } else if member.needsPin {
                    HStack(spacing: 4) {
                        DSIcon(.lock, size: 13)
                        Text("Grown-up").dsFont(.caption, size: 13)
                    }
                    .foregroundStyle(DS.Color.inkSecondary)
                    .padding(.vertical, 7)
                } else {
                    Text(member.grade.map(Self.gradeName) ?? "Kid")
                        .dsFont(.caption, size: 13)
                        .foregroundStyle(DS.Color.inkSecondary)
                        .padding(.vertical, 7)
                }
            }
            .padding(.vertical, DS.Space.m)
            .padding(.horizontal, DS.Space.s)
            .frame(maxWidth: .infinity)
            .background(RoundedRectangle(cornerRadius: DS.Radius.tile, style: .continuous)
                .fill(isMe ? DS.Color.sunny : DS.Color.surfaceSunken))
            .contentShape(RoundedRectangle(cornerRadius: DS.Radius.tile, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .allowsHitTesting(!isMe)
        .accessibilityLabel(isMe ? "\(member.displayName), you" : member.needsPin ? "\(member.displayName), grown-up, needs the PIN" : member.displayName)
        .accessibilityIdentifier("switcher.member.\(member.displayName)")
    }

    static func gradeName(_ grade: Int) -> String {
        switch grade {
        case 0: return "Kindergarten"
        case 1: return "1st grade"
        case 2: return "2nd grade"
        case 3: return "3rd grade"
        default: return "\(grade)th grade"
        }
    }

    // MARK: the grown-up's PIN

    @ViewBuilder private func pinPage(_ member: FamilyMember) -> some View {
        SheetHeader("Grown-ups only", onClose: { dismiss() })
        Text("Enter your 4-digit PIN.")
            .dsFont(.callout)
            .foregroundStyle(DS.Color.inkSecondary)
        VStack(spacing: DS.Space.l) {
            PinDots(count: pin.count, lookAgain: pinProblem != nil && pin.isEmpty)
                .accessibilityIdentifier("switcher.pinDots")
            if let pinProblem {
                Text(pinProblem)
                    .dsFont(.callout)
                    .foregroundStyle(DS.Color.ink)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("switcher.error")
            }
            PinPad(entry: $pin) { entered in switchTo(member, pin: entered) }
                .disabled(busy)
                .accessibilityIdentifier("switcher.pin")
                .onChange(of: pin) { if !pin.isEmpty { pinProblem = nil } }
            if busy {
                ProgressView().tint(DS.Color.ink)
            }
        }
        .frame(maxWidth: .infinity)
        if start == .pick {
            Button {
                withDSAnimation(reduceMotion: reduceMotion) {
                    pinFor = nil
                    pin = ""
                    pinProblem = nil
                }
            } label: {
                HStack(spacing: DS.Space.xs) {
                    DSIcon(.back, size: 16)
                    Text("Back")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.pill(.quiet))
        }
    }

    // MARK: actions

    private func reload() async {
        do {
            let loaded = try await backend.family.load()
            family = loaded
            loadError = nil
            if start == .grownUp, pinFor == nil, let parent = loaded.members.first(where: \.isParent), parent.userId != loaded.me {
                pinFor = parent
            }
        } catch {
            if family == nil { loadError = userMessage(for: error) }
        }
    }

    private func choose(_ member: FamilyMember) {
        if member.needsPin {
            withDSAnimation(reduceMotion: reduceMotion) {
                pin = ""
                pinProblem = nil
                pinFor = member
            }
        } else {
            switchTo(member, pin: nil)
        }
    }

    private func switchTo(_ member: FamilyMember, pin: String?) {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                try await backend.family.switchProfile(to: member.userId, pin: pin)
                // The session changed: RootView makes Home again as the new profile. A kid who
                // came for the grown-ups' places gets them straight away.
                if start == .grownUp { HomeFlow.openGrownUpsNext = true }
                dismiss()
            } catch {
                let message = FamilyWords.message(error, .switchProfile)
                if pinFor != nil {
                    pinProblem = message
                    self.pin = ""
                } else {
                    loadError = nil
                    signOutProblem = message
                }
            }
        }
    }

    private func signOut() {
        busy = true
        Task {
            defer { busy = false }
            do {
                try await backend.auth.signOut()
            } catch {
                signOutProblem = "Couldn't sign you out. Try again in a moment."
            }
        }
    }
}
