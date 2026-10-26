import AgathonBoard
import AgathonDesign
import SwiftUI

/// New page as the dock's one solid white tile, a "+" in it and its word under it: an action, not a
/// tool, so it stands apart from the tools' plain icons (the owner, 2026-10-26: "make the new page
/// button better so ppl know to make new screens"). Never sunny: that is the tool in hand. Its
/// column is the same width as before, so the dock folds exactly as it did.
struct NewPageButton: View {
    let action: () -> Void
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                DSIcon(.plus, size: 26)
                    .foregroundStyle(DS.Color.ink)
                    .frame(width: 62, height: DockLayout.Size.circle)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(isEnabled ? DS.Color.onInk : DS.Color.onInkFaint))
                Text(DockCopy.newPage)
                    .font(DS.Font.fixed(.button, size: 12).weight(.bold))
                    .foregroundStyle(isEnabled ? DS.Color.onInk : DS.Color.onInkDisabled)
                    .lineLimit(1)
                    .fixedSize()
            }
            .frame(minWidth: DockLayout.Size.newPage, minHeight: 72)
            .contentShape(Rectangle())
        }
        .buttonStyle(DockPress())
        .accessibilityLabel(DockCopy.newPage)
    }
}

/// Watches the page in view: once the kid's writing reaches its last fifth, `show` turns on — once
/// per board — so the dock can point at New page. Problem pages have More room instead.
@MainActor
final class PageRoomWatch: ObservableObject {
    @Published private(set) var show = false
    /// Where on the page (0 top … 1 bottom) writing counts as "out of room".
    static let fullFraction = 0.8

    private var said = false
    private var subscription: StoreSubscription?
    private weak var controller: BoardController?

    func attach(_ controller: BoardController) {
        guard self.controller !== controller else { return }
        self.controller = controller
        subscription = controller.store.observe { [weak self] change in self?.changed(change) }
    }

    func dismiss() { show = false }

    private func changed(_ change: ChangeSet) {
        guard !said, change.origin == .kid, let c = controller, let screen = c.currentScreen, screen.problemPage == nil else { return }
        guard Self.nearlyFull(c.store.drawables(on: c.currentScreenID), page: screen.rect) else { return }
        said = true
        show = true
    }

    /// True when any of the kid's strokes reaches the page's last fifth.
    static func nearlyFull(_ records: [BoardRecord], page: Box) -> Bool {
        guard page.h > 0 else { return false }
        let line = page.y + page.h * fullFraction
        for r in records {
            guard case .stroke(let s) = r, s.author == .kid, let low = s.points.map(\.y).max() else { continue }
            if s.y + Double(low) >= line { return true }
        }
        return false
    }
}

/// The tip over New page: "Out of room? Start a new page", tap it for one. It goes after a while,
/// or as soon as a page is added.
struct PageRoomTip: View {
    let add: () -> Void
    let dismiss: () -> Void

    var body: some View {
        Button(action: add) {
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    DSIcon(.plus, size: 16)
                    Text(DockCopy.outOfRoom)
                        .font(DS.Font.fixed(.button, size: 15))
                        .lineLimit(1)
                        .fixedSize()
                }
                .foregroundStyle(DS.Color.ink)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(DS.Color.sunny))
                // the nub, pointing down at the button
                Triangle()
                    .fill(DS.Color.sunny)
                    .frame(width: 18, height: 9)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(DockCopy.outOfRoom)
        .accessibilityIdentifier("dock.pageRoomTip")
        .task {
            try? await Task.sleep(for: .seconds(9))
            dismiss()
        }
    }

    private struct Triangle: Shape {
        func path(in r: CGRect) -> Path {
            var p = Path()
            p.move(to: CGPoint(x: r.minX, y: r.minY))
            p.addLine(to: CGPoint(x: r.maxX, y: r.minY))
            p.addLine(to: CGPoint(x: r.midX, y: r.maxY))
            p.closeSubpath()
            return p
        }
    }
}
