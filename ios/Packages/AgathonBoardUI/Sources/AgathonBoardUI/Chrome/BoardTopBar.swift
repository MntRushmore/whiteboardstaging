import AgathonBoard
import AgathonDesign
import SwiftUI

/// The board's top bar (Blocks): back, the board's name and "Page 2 of 3" ("Problem 2 of 5" on a
/// problem page in a set, "Problem 2 · page 2 of 2" on one that needed more room,
/// docs/PROBLEM-PAGES.md; a tap opens the pages),
/// the Live lane's slot (`topTrailing`: the tutor's status pill, the ink meter), and More.
struct BoardTopBar<Trailing: View>: View {
    @ObservedObject var controller: BoardController
    let title: String
    let onBack: (() -> Void)?
    @Binding var showPages: Bool
    let trailing: Trailing

    var body: some View {
        HStack(spacing: DS.Space.m) {
            if let onBack {
                RoundButton(.back, fill: .paper, label: DockCopy.back, action: onBack)
                    .accessibilityIdentifier("board.back")
            }
            Button {
                showPages = true
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(DS.Font.fixed(.headline, size: 24))
                        .tracking(-0.03 * 24)
                        .foregroundStyle(DS.Color.ink)
                        .lineLimit(1)
                        // a narrow window (Split View) shrinks the name a little before cutting it
                        .minimumScaleFactor(0.75)
                    Text(whereAmI)
                        .font(DS.Font.fixed(.caption, size: 14))
                        .foregroundStyle(DS.Color.inkSecondary)
                        .monospacedDigit()
                }
                .frame(minHeight: DS.Size.minTarget)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            // (VoiceOver says "Problem 2, page 2 of 2", not the dot)
            .accessibilityLabel("\(title). \(whereAmI.replacingOccurrences(of: " · ", with: ", "))")
            .accessibilityHint(DockCopy.pages)
            .accessibilityIdentifier("board.title")
            .layoutPriority(1)
            Spacer(minLength: DS.Space.s)
            trailing
            Menu {
                Button {
                    showPages = true
                } label: {
                    Label(DockCopy.pages, systemImage: BoardIcon.pages.systemName)
                }
                Toggle(isOn: $controller.drawWithFinger) {
                    Label("Draw with my finger", systemImage: "hand.draw")
                }
            } label: {
                IconCircle(.more, fill: .paper, diameter: DS.Size.round)
                    .frame(width: DS.Size.minTarget, height: DS.Size.minTarget)
                    .contentShape(Circle())
            }
            .accessibilityLabel(DS.Icon.more.label)
            .accessibilityHint(DockCopy.boardMoreHint)
            .accessibilityIdentifier("board.more")
        }
        .frame(height: DS.Size.round)
    }

    private var whereAmI: String {
        let id = controller.currentScreenID
        // a problem that needed more room: which of its pages this is
        let part = controller.store.problemGroup(of: id).flatMap { g in g.part(of: id).map { ($0, g.count) } }
        return DockCopy.whereAmI(controller.currentScreen?.problemPage, part: part, screen: controller.screenIndex, of: controller.screenCount)
    }
}

/// Copy and Delete, over a selection (in screen space, above it; below it when it is near the top).
/// Steps aside while the selection moves.
struct SelectionBar: View {
    @ObservedObject var controller: BoardController
    @ObservedObject var viewport: BoardViewport

    var body: some View {
        GeometryReader { geo in
            if let b = controller.selectionBounds, !controller.selection.isEmpty, !controller.isTransforming, controller.tool == .select {
                let r = viewport.toView(b).insetBy(dx: -10, dy: -10)
                let barH: CGFloat = 84
                let above = r.minY - barH - 12 > 90
                let y = above ? r.minY - barH / 2 - 12 : min(geo.size.height - barH, r.maxY + barH / 2 + 12)
                HStack(spacing: 0) {
                    DockButton(title: DockCopy.copy, action: { controller.duplicateSelection() }) { BoardIconView(icon: .copy) }
                    DockButton(title: DockCopy.delete, action: { controller.deleteSelection() }) { BoardIconView(icon: .trash) }
                }
                .padding(.horizontal, DockLayout.Size.padding)
                .frame(height: barH)
                .background(Capsule().fill(DS.Color.ink))
                .position(x: min(max(r.midX, 120), geo.size.width - 120), y: y)
                .transition(.opacity)
            }
        }
    }
}
