import AgathonBoard
import AgathonDesign
import SwiftUI

/// The board's own icons, named by meaning, drawn like `DSIcon` (SF Symbols at semibold). The ones
/// the design system already has come from `DS.Icon`; these are the board's extra tools. (They can
/// move into `DS.Icon` when a custom icon set replaces the symbols.)
public enum BoardIcon: Sendable, Equatable {
    case ds(DS.Icon)
    case select, line, arrow, box, circle, photos, camera, files, newPage, copy, trash, pages, highlighter

    var systemName: String {
        switch self {
        case .ds(let i): return i.systemName
        case .select: return "lasso"
        case .line: return "line.diagonal"
        case .arrow: return "arrow.up.right"
        case .box: return "rectangle"
        case .circle: return "circle"
        case .photos: return "photo.on.rectangle"
        case .camera: return "camera"
        case .files: return "doc"
        case .newPage: return "doc.badge.plus"
        case .copy: return "plus.square.on.square"
        case .trash: return "trash"
        case .pages: return "square.grid.2x2"
        case .highlighter: return "highlighter"
        }
    }
}

struct BoardIconView: View {
    let icon: BoardIcon
    var size: CGFloat = DS.Size.icon

    var body: some View {
        Image(systemName: icon.systemName)
            .font(.system(size: size * 0.92, weight: .semibold))
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

extension ShapeKind {
    var icon: BoardIcon {
        switch self {
        case .line: return .line
        case .arrow: return .arrow
        case .rect: return .box
        case .ellipse: return .circle
        }
    }

    var word: String {
        switch self {
        case .line: return DockCopy.line
        case .arrow: return DockCopy.arrow
        case .rect: return DockCopy.box
        case .ellipse: return DockCopy.circle
        }
    }
}
