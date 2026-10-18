import SwiftUI

// MARK: - Sheet header

/// The top of a sheet or panel (Ask, the grown-ups' area): a Bricolage title, an optional tag
/// under it, and round chalk buttons on the right.
public struct SheetHeader: View {
    public struct Action: Identifiable {
        public let icon: DS.Icon
        public let label: String
        public let perform: () -> Void
        public var id: String { icon.rawValue + label }

        public init(_ icon: DS.Icon, label: String? = nil, perform: @escaping () -> Void) {
            self.icon = icon
            self.label = label ?? icon.label
            self.perform = perform
        }
    }

    let title: String
    let tag: String?
    let actions: [Action]
    let onClose: (() -> Void)?

    public init(_ title: String, tag: String? = nil, actions: [Action] = [], onClose: (() -> Void)? = nil) {
        self.title = title
        self.tag = tag
        self.actions = actions
        self.onClose = onClose
    }

    public var body: some View {
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 8) {
                Text(title).dsFont(.headline, size: 26).foregroundStyle(DS.Color.ink)
                    .accessibilityAddTraits(.isHeader)
                if let tag { Tag(tag, style: .chalk) }
            }
            .padding(.top, 6)
            Spacer(minLength: 8)
            ForEach(actions) { a in
                RoundButton(a.icon, fill: .chalk, diameter: 52, label: a.label, action: a.perform)
            }
            if let onClose {
                RoundButton(.close, fill: .chalk, diameter: 52, label: "Close", action: onClose)
            }
        }
    }
}

// MARK: - Banner and toast

/// A short message: a coloured badge and a line or two. `.ink` floats over the board (a toast);
/// `.paper` sits in a screen (a banner).
public struct Banner: View {
    public enum Kind: String, CaseIterable, Sendable {
        /// "You got it." Green badge, white tick.
        case success
        /// "Look again." Sunny badge: a nudge, never red.
        case lookAgain
        /// Something from the tutor. Cobalt badge.
        case tutor
        /// Help is paused (out of ink). Ink badge, sunny pause.
        case paused
        /// No connection.
        case offline
        /// Nothing is sent: the work stays on this iPad for now (a board that can't save yet).
        case notSaved

        var badge: DS.Fill {
            switch self {
            case .success: DS.Fill(background: DS.Palette.green, foreground: DS.Palette.white)
            case .lookAgain: .sunny
            case .tutor: .cobalt
            case .paused: DS.Fill(background: DS.Palette.ink, foreground: DS.Palette.sunny)
            case .offline: DS.Fill(background: DS.Palette.ink, foreground: DS.Palette.white)
            case .notSaved: .chalk
            }
        }

        var icon: DS.Icon {
            switch self {
            case .success: .check
            case .lookAgain: .lookAgain
            case .tutor: .chat
            case .paused: .pause
            case .offline: .offline
            case .notSaved: .notSaved
            }
        }
    }

    public enum Surface: Sendable { case ink, paper }

    let kind: Kind
    let title: String
    let message: String?
    let surface: Surface

    public init(_ kind: Kind, _ title: String, message: String? = nil, surface: Surface = .paper) {
        self.kind = kind
        self.title = title
        self.message = message
        self.surface = surface
    }

    public var body: some View {
        HStack(spacing: 14) {
            Circle()
                .fill(badgeBackground)
                .frame(width: 40, height: 40)
                .overlay(DSIcon(kind.icon, size: 18).foregroundStyle(kind.badge.foreground.color))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).dsFont(.button, size: 17)
                if let message { Text(message).dsFont(.caption, size: 15) }
            }
            .foregroundStyle(surface == .ink ? DS.Color.onInk : DS.Color.ink)
            Spacer(minLength: 0)
        }
        .padding(.leading, 10)
        .padding(.trailing, 22)
        .padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 30, style: .continuous)
            .fill(surface == .ink ? DS.Color.ink : DS.Color.surface))
        .accessibilityElement(children: .combine)
    }

    /// An ink badge would vanish on an ink toast, so it turns faint there.
    private var badgeBackground: SwiftUI.Color {
        surface == .ink && kind.badge.background == DS.Palette.ink ? DS.Color.onInkFaint : kind.badge.background.color
    }
}

/// "Nailed it." The sunny pill the tutor puts next to a right answer. Snaps in.
public struct CheerPill: View {
    let text: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    public init(_ text: String = "Nailed it.") { self.text = text }

    public var body: some View {
        Text(text)
            .dsFont(.button, size: 22)
            .foregroundStyle(DS.Color.ink)
            .padding(.horizontal, 28)
            .frame(minHeight: 52)
            .background(Capsule().fill(DS.Color.sunny))
            .scaleEffect(shown || reduceMotion ? 1 : 0.6)
            .opacity(shown || reduceMotion ? 1 : 0)
            .onAppear { withDSAnimation(DS.Motion.pop, reduceMotion: reduceMotion) { shown = true } }
    }
}

// MARK: - Empty state

/// Nothing here yet: an icon in a big circle (or the shapes, for a big moment), a Bricolage title,
/// a kind line and one action.
public struct EmptyState: View {
    public enum Art {
        case icon(DS.Icon, DS.Fill)
        case shapes(TheShapes.Pose)
    }

    let art: Art
    let title: String
    let message: String
    let actionTitle: String?
    let actionIcon: DS.Icon?
    let action: (() -> Void)?

    public init(_ art: Art, title: String, message: String, actionTitle: String? = nil,
                actionIcon: DS.Icon? = nil, action: (() -> Void)? = nil) {
        self.art = art
        self.title = title
        self.message = message
        self.actionTitle = actionTitle
        self.actionIcon = actionIcon
        self.action = action
    }

    public var body: some View {
        VStack(spacing: 0) {
            switch art {
            case .icon(let icon, let fill):
                IconCircle(icon, fill: fill, diameter: 104)
            case .shapes(let pose):
                TheShapes(pose, showsGround: true).frame(width: 200)
            }
            Text(title)
                .dsFont(.title)
                .foregroundStyle(DS.Color.ink)
                .multilineTextAlignment(.center)
                .padding(.top, 28)
            Text(message)
                .dsFont(.body)
                .foregroundStyle(DS.Color.inkSecondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 440)
                .padding(.top, 12)
            if let actionTitle, let action {
                PillButton(actionTitle, icon: actionIcon, kind: .primary, size: .large, action: action)
                    .padding(.top, 32)
            }
        }
        .padding(DS.Space.xxl)
    }
}

#Preview("Feedback") {
    VStack(spacing: 20) {
        SheetHeader("Ask your tutor", tag: "Screen 1", actions: [.init(.speaker) {}], onClose: {})
            .padding(20).background(DS.Color.paper)
        Banner(.success, "You got it.", message: "5 for 5 today.")
        Banner(.lookAgain, "Look again.", message: "Check the bottom number.", surface: .ink)
        Banner(.paused, "Help is paused for now.", message: "Ask a grown-up to switch it back on.", surface: .ink)
        CheerPill()
        EmptyState(.icon(.picture, .sunny), title: "No boards yet", message: "Start one and write anything.",
                   actionTitle: "New board", actionIcon: .plus) {}
    }
    .padding(40)
    .background(DS.Color.ground)
}
