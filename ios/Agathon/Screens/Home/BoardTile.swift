import AgathonDesign
import AgathonKit
import SwiftUI

/// A board on Home: its thumbnail, its name and when it was edited, on a paper tile (the Blocks
/// Home's `.a-tile`). Tap to open; the round "more" button (or a long press) renames or deletes.
struct BoardTile: View {
    /// Debug builds tell the UI tests whether the tile shows the board's thumbnail.
    static func debugValue(_ thumbnail: UIImage?) -> String {
        #if DEBUG
        thumbnail == nil ? "" : "thumbnail"
        #else
        ""
        #endif
    }

    let board: BoardSummary
    let thumbnail: UIImage?
    @Environment(\.dynamicTypeSize) private var typeSize
    let open: () -> Void
    let rename: () -> Void
    let delete: () -> Void

    var body: some View {
        Button(action: open) {
            VStack(alignment: .leading, spacing: 0) {
                BoardThumbnail(image: thumbnail)
                VStack(alignment: .leading, spacing: 4) {
                    Text(board.title)
                        .dsFont(.button, size: 17)
                        .foregroundStyle(DS.Color.ink)
                        .lineLimit(typeSize.isAccessibilitySize ? 3 : 1)
                    Text(HomeFormat.edited(board.updatedAt))
                        .dsFont(.caption)
                        .foregroundStyle(DS.Color.inkSecondary)
                        .lineLimit(typeSize.isAccessibilitySize ? 2 : 1)
                }
                .padding(.leading, 6)
                // Room for the round "more" button on the right.
                .padding(.trailing, 52)
                .padding(.top, DS.Space.s)
                .padding(.bottom, 6)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: DS.Radius.tile, style: .continuous).fill(DS.Color.surface))
            .contentShape(RoundedRectangle(cornerRadius: DS.Radius.tile, style: .continuous))
        }
        .buttonStyle(TileStyle())
        .accessibilityLabel("\(board.title). \(HomeFormat.edited(board.updatedAt))")
        .accessibilityValue(Self.debugValue(thumbnail))
        .accessibilityHint("Opens the board")
        .accessibilityAction(named: "Rename", rename)
        .accessibilityAction(named: "Delete", delete)
        .accessibilityIdentifier("boards.row")
        .overlay(alignment: .bottomTrailing) {
            Menu {
                menuItems
            } label: {
                DSIcon(.more, size: 20)
                    .foregroundStyle(DS.Color.ink)
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(DS.Color.surfaceSunken))
                    .frame(width: DS.Size.minTarget, height: DS.Size.minTarget)
                    .contentShape(Circle())
            }
            .padding(.trailing, 2)
            .padding(.bottom, 2)
            .accessibilityLabel("More for \(board.title)")
            .accessibilityIdentifier("boards.more")
        }
        .contextMenu { menuItems }
    }

    @ViewBuilder private var menuItems: some View {
        Button(action: rename) {
            Label("Rename", systemImage: DS.Icon.pen.systemName)
        }
        Button(role: .destructive, action: delete) {
            Label("Delete", systemImage: DS.Icon.trash.systemName)
        }
    }

    private struct TileStyle: ButtonStyle {
        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        func makeBody(configuration: Configuration) -> some View {
            configuration.label
                .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
                .opacity(configuration.isPressed ? 0.92 : 1)
                .animation(reduceMotion ? nil : DS.Motion.snap, value: configuration.isPressed)
        }
    }
}

/// A board's picture, 16:9 with the one functional hairline round it. A board without a picture
/// yet shows a quiet pen.
struct BoardThumbnail: View {
    let image: UIImage?

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: DS.Radius.thumb, style: .continuous)
        Color.clear
            .aspectRatio(16 / 9, contentMode: .fit)
            .overlay {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .interpolation(.high)
                        .scaledToFill()
                } else {
                    DSIcon(.pen, size: 30)
                        .foregroundStyle(DS.Color.divider)
                }
            }
            .background(DS.Color.paper)
            .clipShape(shape)
            .overlay(shape.strokeBorder(DS.Color.line, lineWidth: 2))
            .accessibilityHidden(true)
    }
}

/// A tile while the boards load: the same shape, no words.
struct BoardTilePlaceholder: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            RoundedRectangle(cornerRadius: DS.Radius.thumb, style: .continuous)
                .fill(DS.Color.surfaceSunken)
                .aspectRatio(16 / 9, contentMode: .fit)
            Capsule().fill(DS.Color.surfaceSunken).frame(width: 140, height: 14).padding(.leading, 6).padding(.top, 4)
            Capsule().fill(DS.Color.surfaceSunken).frame(width: 90, height: 10).padding(.leading, 6).padding(.bottom, 10)
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: DS.Radius.tile, style: .continuous).fill(DS.Color.surface))
        .accessibilityHidden(true)
    }
}
