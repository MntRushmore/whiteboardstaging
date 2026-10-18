import AgathonDesign
import AgathonKit
import SwiftUI

/// The grown-ups' door on Home (a grown-up or a solo account; a kid gets the PIN first). Lists the
/// grown-up places and sign out.
struct GrownUpsSheet: View {
    let family: FamilyState?
    let switchProfile: () -> Void

    @Environment(AgathonBackend.self) private var backend
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.m) {
            SheetHeader("Grown-ups", tag: backend.auth.email, onClose: { dismiss() })
            if family?.role == .parent {
                row(.family, "Who's practicing?", detail: "Switch to a kid's profile") {
                    dismiss()
                    switchProfile()
                }
            }
            if let problem {
                Banner(.lookAgain, problem)
            }
            row(.signOut, "Sign out", detail: nil, id: "boards.signOut", action: signOut)
        }
        .blocksSheet()
    }

    private func row(_ icon: DS.Icon, _ title: String, detail: String?, id: String? = nil,
                     action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: DS.Space.m) {
                IconCircle(icon, fill: .paper, diameter: 48)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).dsFont(.button, size: 18).foregroundStyle(DS.Color.ink)
                    if let detail {
                        Text(detail).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
                    }
                }
                Spacer(minLength: 0)
                DSIcon(.forward, size: 16).foregroundStyle(DS.Color.inkSecondary)
            }
            .padding(.horizontal, DS.Space.s)
            .padding(.vertical, DS.Space.s)
            .frame(minHeight: DS.Size.minTarget + 8)
            .background(RoundedRectangle(cornerRadius: DS.Radius.tile, style: .continuous).fill(DS.Color.surfaceSunken))
            .contentShape(RoundedRectangle(cornerRadius: DS.Radius.tile, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .accessibilityIdentifier(id ?? "grownUps.\(title)")
    }

    private func signOut() {
        busy = true
        Task {
            defer { busy = false }
            do {
                try await backend.auth.signOut()
            } catch {
                problem = "Couldn't sign you out. Try again in a moment."
            }
        }
    }
}
