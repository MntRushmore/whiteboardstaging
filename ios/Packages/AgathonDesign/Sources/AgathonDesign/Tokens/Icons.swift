import SwiftUI

extension DS {
    /// The icon set: line icons (SF Symbols at semibold, about the brand page's 2.6 pt line), always
    /// sitting in a solid circle, the ring of the mark. Screens name icons by what they mean, so the
    /// set can be redrawn in one place.
    public enum Icon: String, CaseIterable, Sendable, Identifiable {
        case pen, eraser, shapes, picture, undo, redo, back, forward, more, chat, mic, send, speaker
        case close, lock, plus, star, flame, play, home, path, chart, check, hand, palette
        case offline, retry, lookAgain, pause, person, book, delete, sparkle
        case search, trash, signOut, notSaved, family, settings, bug, report

        public var id: String { rawValue }

        public var systemName: String {
            switch self {
            case .pen: "pencil"
            case .eraser: "eraser"
            case .shapes: "square.on.circle"
            case .picture: "photo"
            case .undo: "arrow.uturn.backward"
            case .redo: "arrow.uturn.forward"
            case .back: "chevron.left"
            case .forward: "chevron.right"
            case .more: "ellipsis"
            case .chat: "bubble.left"
            case .mic: "mic"
            case .send: "arrow.up"
            case .speaker: "speaker.wave.2"
            case .close: "xmark"
            case .lock: "lock"
            case .plus: "plus"
            case .star: "star"
            case .flame: "flame"
            case .play: "play.fill"
            case .home: "house"
            case .path: "point.topleft.down.to.point.bottomright.curvepath"
            case .chart: "chart.bar"
            case .check: "checkmark"
            case .hand: "hand.raised"
            case .palette: "paintpalette"
            case .offline: "wifi.slash"
            case .retry: "arrow.clockwise"
            case .lookAgain: "eye"
            case .pause: "pause.fill"
            case .person: "person"
            case .book: "book"
            case .delete: "delete.left"
            case .sparkle: "sparkle"
            case .search: "magnifyingglass"
            case .trash: "trash"
            case .signOut: "rectangle.portrait.and.arrow.right"
            case .notSaved: "icloud.slash"
            case .family: "person.2"
            case .settings: "gearshape"
            case .bug: "ladybug"
            case .report: "doc.text"
            }
        }

        /// What VoiceOver says for an icon-only control.
        public var label: String {
            switch self {
            case .pen: "Pen"
            case .eraser: "Eraser"
            case .shapes: "Shapes"
            case .picture: "Picture"
            case .undo: "Undo"
            case .redo: "Redo"
            case .back: "Back"
            case .forward: "Next"
            case .more: "More"
            case .chat: "Ask"
            case .mic: "Talk"
            case .send: "Send"
            case .speaker: "Read it out"
            case .close: "Close"
            case .lock: "Grown-ups"
            case .plus: "New"
            case .star: "Star"
            case .flame: "Streak"
            case .play: "Start"
            case .home: "Home"
            case .path: "Path"
            case .chart: "Progress"
            case .check: "Done"
            case .hand: "Help"
            case .palette: "Colors"
            case .offline: "Offline"
            case .retry: "Try again"
            case .lookAgain: "Look again"
            case .pause: "Paused"
            case .person: "Profile"
            case .book: "Sticker book"
            case .delete: "Delete"
            case .sparkle: "Sparkle"
            case .search: "Search"
            case .trash: "Delete"
            case .signOut: "Sign out"
            case .notSaved: "Not saved"
            case .family: "Family"
            case .settings: "Account"
            case .bug: "Report a problem"
            case .report: "Weekly report"
            }
        }
    }
}

/// A Blocks icon at a size (the glyph's point size; it sits inside whatever circle holds it).
public struct DSIcon: View {
    let icon: DS.Icon
    let size: CGFloat

    public init(_ icon: DS.Icon, size: CGFloat = DS.Size.icon) {
        self.icon = icon
        self.size = size
    }

    public var body: some View {
        Image(systemName: icon.systemName)
            .font(.system(size: size * 0.92, weight: .semibold))
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// An icon in a solid circle: the ring of the mark. Not a control by itself; tools and round
/// buttons use it.
public struct IconCircle: View {
    let icon: DS.Icon
    let fill: DS.Fill
    let diameter: CGFloat

    public init(_ icon: DS.Icon, fill: DS.Fill = .paper, diameter: CGFloat = DS.Size.tool) {
        self.icon = icon
        self.fill = fill
        self.diameter = diameter
    }

    public var body: some View {
        Circle()
            .fill(fill.background.color)
            .frame(width: diameter, height: diameter)
            .overlay(DSIcon(icon, size: diameter * 0.43).foregroundStyle(fill.foreground.color))
    }
}

#Preview("Icons") {
    LazyVGrid(columns: Array(repeating: GridItem(.fixed(72)), count: 8), spacing: 16) {
        ForEach(DS.Icon.allCases) { icon in
            VStack(spacing: 6) {
                IconCircle(icon)
                Text(icon.label).dsFont(.caption).lineLimit(1)
            }
        }
    }
    .padding()
    .background(DS.Color.ground)
}
