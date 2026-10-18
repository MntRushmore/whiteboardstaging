import AgathonBoard
import AgathonDesign
import SwiftUI
import UniformTypeIdentifiers

/// A screen's picture for the pages strip: the page white, its records drawn small.
public enum ScreenThumbnail {
    /// Renders `records` (a screen's drawables, bottom to top) on `screen` at `width` pixels wide.
    public static func render(_ records: [BoardRecord], screen: Box, width: Int, images: BoardImageCache = .shared) -> CGImage? {
        let scale = CGFloat(width) / CGFloat(max(1, screen.w))
        guard let ctx = TileRasterizer.makeContext(rect: screen, scale: scale) else { return nil }
        ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        ctx.fill(screen.cgRect)
        let index = SceneIndex.build(records, images: images)
        TileRasterizer.draw(index.items(in: screen), in: ctx)
        return ctx.makeImage()
    }
}

/// The thumbnails the strip shows, drawn off the main thread and kept while a screen is unchanged.
@MainActor
final class ThumbnailStore: ObservableObject {
    @Published private(set) var images: [RecordID: CGImage] = [:]
    private var made: [RecordID: UInt64] = [:]
    private var inFlight = Set<RecordID>()

    func ensure(_ item: ScreenStrip.Item, controller: BoardController) {
        guard made[item.id] != item.revision || images[item.id] == nil, !inFlight.contains(item.id),
              let screen = controller.store[item.id]?.screen else { return }
        inFlight.insert(item.id)
        let records = controller.store.drawables(on: item.id)
        let cache = controller.images
        let rev = item.revision
        Task {
            let img = await Task.detached(priority: .utility) { ScreenThumbnail.render(records, screen: screen.rect, width: 440, images: cache) }.value
            inFlight.remove(item.id)
            made[item.id] = rev
            if let img { images[item.id] = img }
        }
    }
}

/// Pages: every page of the board as a thumbnail. Tap one to go to it, drag one to move it, add a
/// page at the end, and delete this page (after asking: everything on it goes, and Undo brings it
/// back).
struct PagesSheet: View {
    @ObservedObject var controller: BoardController
    @Environment(\.dismiss) private var dismiss
    @StateObject private var thumbs = ThumbnailStore()
    @State private var confirmDelete = false
    @State private var dragging: RecordID?

    var body: some View {
        let strip = controller.strip
        VStack(alignment: .leading, spacing: DS.Space.l) {
            SheetHeader(DockCopy.pages, tag: DockCopy.pageOf(strip.current, strip.count), onClose: { dismiss() })
            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: DS.Space.l) {
                        ForEach(strip.items) { item in
                            cell(item)
                                .id(item.id)
                        }
                        if strip.canAdd { addCell }
                    }
                    .padding(.vertical, 6)
                    .padding(.horizontal, 4)
                }
                .onAppear { proxy.scrollTo(controller.currentScreenID, anchor: .center) }
            }
            HStack(spacing: DS.Space.s) {
                PillButton(DockCopy.deleteConfirm, icon: .delete, kind: .secondaryOnPaper) { confirmDelete = true }
                    .disabled(!strip.canDelete)
                Spacer()
                PillButton(DockCopy.newPage, icon: .plus, kind: .primary) {
                    controller.addScreen()
                }
                .disabled(!strip.canAdd)
            }
        }
        .padding(DS.Space.xl)
        .background(DS.Color.paper)
        .confirmationDialog(DockCopy.deleteTitle, isPresented: $confirmDelete, titleVisibility: .visible) {
            Button(DockCopy.deleteConfirm, role: .destructive) { controller.deleteScreen(controller.currentScreenID) }
            Button(DockCopy.keep, role: .cancel) {}
        } message: {
            Text(DockCopy.deleteMessage)
        }
    }

    private func cell(_ item: ScreenStrip.Item) -> some View {
        VStack(spacing: DS.Space.xs) {
            ZStack {
                RoundedRectangle(cornerRadius: DS.Radius.thumb, style: .continuous).fill(DS.Color.paper)
                if let img = thumbs.images[item.id] {
                    Image(decorative: img, scale: 1)
                        .resizable()
                        .scaledToFit()
                        .clipShape(RoundedRectangle(cornerRadius: DS.Radius.thumb, style: .continuous))
                }
                RoundedRectangle(cornerRadius: DS.Radius.thumb, style: .continuous)
                    .strokeBorder(item.isCurrent ? DS.Color.ink : DS.Color.line, lineWidth: item.isCurrent ? DS.Stroke.selected : 2)
            }
            .frame(width: 220, height: 220 * 9 / 16)
            Text("\(item.number)")
                .font(DS.Font.fixed(.numeral, size: 17))
                .foregroundStyle(item.isCurrent ? DS.Color.ink : DS.Color.inkSecondary)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            controller.goToScreen(item.id)
            dismiss()
        }
        .onAppear { thumbs.ensure(item, controller: controller) }
        .onChange(of: item.revision) { _, _ in thumbs.ensure(item, controller: controller) }
        .draggable(item.id.rawValue) {
            RoundedRectangle(cornerRadius: DS.Radius.thumb).fill(DS.Color.surfaceSunken).frame(width: 110, height: 62)
        }
        .dropDestination(for: String.self) { ids, _ in
            guard let id = ids.first, let to = controller.strip.items.firstIndex(where: { $0.id == item.id }) else { return false }
            controller.moveScreen(RecordID(id), to: to)
            return true
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(DockCopy.pageOf(item.number, controller.strip.count))
        .accessibilityAddTraits(item.isCurrent ? [.isSelected, .isButton] : .isButton)
    }

    private var addCell: some View {
        Button {
            controller.addScreen()
        } label: {
            VStack(spacing: DS.Space.xs) {
                RoundedRectangle(cornerRadius: DS.Radius.thumb, style: .continuous)
                    .fill(DS.Color.surfaceSunken)
                    .frame(width: 220, height: 220 * 9 / 16)
                    .overlay(IconCircle(.plus, fill: .ink, diameter: 56))
                Text(DockCopy.newPage)
                    .font(DS.Font.fixed(.button, size: 15))
                    .foregroundStyle(DS.Color.inkSecondary)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(DockCopy.newPage)
    }
}
