import SwiftUI

/// Where a tool sits: on the ink dock, or on a light surface.
public enum ToolContext: Sendable {
    /// On the ink dock: the tool in use turns sunny.
    case dock
    /// On the ground or paper: the tool in use fills with ink.
    case light
}

/// A kid tool: an icon in a 56 pt circle, with one word under it when there's room.
public struct ToolButton: View {
    let icon: DS.Icon
    let title: String?
    let isOn: Bool
    let context: ToolContext
    let action: () -> Void

    /// `title` is one word ("Pen"). Pass nil on the dock, where the icon stands alone; VoiceOver
    /// still reads the icon's name.
    public init(_ icon: DS.Icon, title: String? = nil, isOn: Bool = false, context: ToolContext = .light,
                action: @escaping () -> Void) {
        self.icon = icon
        self.title = title
        self.isOn = isOn
        self.context = context
        self.action = action
    }

    var fill: DS.Fill {
        switch (context, isOn) {
        case (.dock, true): .sunny
        case (.dock, false): DS.Fill(background: DS.Palette.ink, foreground: DS.Palette.white,
                                     pressed: DS.Palette.ink.mixed(with: DS.Palette.white, amount: 0.12))
        case (.light, true): .ink
        case (.light, false): .paper
        }
    }

    public var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                DSIcon(icon, size: DS.Size.icon)
                    .frame(width: DS.Size.tool, height: DS.Size.tool)
                    .modifier(ToolCircle(fill: fill))
                if let title {
                    Text(title)
                        .font(DS.Font.fixed(.button, size: 13))
                        .foregroundStyle(context == .dock ? DS.Color.onInk : DS.Color.ink)
                        .lineLimit(1)
                        .fixedSize()
                }
            }
            .frame(minWidth: DS.Size.minTarget)
            .contentShape(Rectangle())
        }
        .buttonStyle(ToolStyle())
        .accessibilityLabel(title ?? icon.label)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }

    private struct ToolCircle: ViewModifier {
        let fill: DS.Fill
        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.dsButtonPressed) private var isPressed

        func body(content: Content) -> some View {
            content
                .foregroundStyle(isEnabled ? fill.foreground.color
                                 : (fill.background == DS.Palette.ink ? DS.Color.onInkDisabled : DS.Color.inkSecondary))
                .background(Circle().fill(isPressed ? fill.pressed.color : fill.background.color))
                .pressEffect(isPressed)
        }
    }

    private struct ToolStyle: ButtonStyle {
        func makeBody(configuration: Configuration) -> some View {
            configuration.label.environment(\.dsButtonPressed, configuration.isPressed)
        }
    }
}

/// Passes a button's pressed state down to the part that shows it (the circle, not the word).
private struct DSButtonPressedKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    var dsButtonPressed: Bool {
        get { self[DSButtonPressedKey.self] }
        set { self[DSButtonPressedKey.self] = newValue }
    }
}

/// A pen colour on the dock or a light surface. The swatch you see is 42 pt; its tap target is
/// 56 pt. The chosen pen gets a 3 pt ring.
public struct PenSwatch: View {
    let pen: DS.KidPen
    let isOn: Bool
    let context: ToolContext
    let action: () -> Void

    public init(_ pen: DS.KidPen, isOn: Bool = false, context: ToolContext = .dock, action: @escaping () -> Void) {
        self.pen = pen
        self.isOn = isOn
        self.context = context
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            ZStack {
                if isOn {
                    Circle()
                        .strokeBorder(context == .dock ? DS.Color.onInk : DS.Color.ink, lineWidth: DS.Stroke.selected)
                        .frame(width: DS.Size.swatch, height: DS.Size.swatch)
                }
                Circle()
                    .fill(pen.color)
                    .frame(width: DS.Size.swatchDot, height: DS.Size.swatchDot)
                    .overlay {
                        // Black on the ink dock gets a faint edge so it can be seen.
                        if context == .dock && pen == .black {
                            Circle().strokeBorder(DS.Palette.ink.mixed(with: DS.Palette.white, amount: 0.45).color, lineWidth: 2)
                        }
                    }
            }
            .frame(width: DS.Size.minTarget, height: DS.Size.minTarget)
            .contentShape(Circle())
        }
        .buttonStyle(SwatchStyle())
        .accessibilityLabel("\(pen.name) pen")
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }

    private struct SwatchStyle: ButtonStyle {
        func makeBody(configuration: Configuration) -> some View {
            configuration.label.pressEffect(configuration.isPressed)
        }
    }
}

/// The board's dock: an ink capsule holding tools, swatches and separators.
public struct Dock<Content: View>: View {
    let content: Content

    public init(@ViewBuilder content: () -> Content) { self.content = content() }

    public var body: some View {
        HStack(spacing: 2) { content }
            .padding(.horizontal, 8)
            .frame(height: DS.Size.dock)
            .background(Capsule().fill(DS.Color.ink))
    }
}

/// A thin upright line between groups on the dock.
public struct DockSeparator: View {
    public init() {}
    public var body: some View {
        Capsule().fill(DS.Color.onInkFaint).frame(width: 2, height: 30).padding(.horizontal, 7)
            .accessibilityHidden(true)
    }
}

#Preview("Tools") {
    VStack(spacing: 24) {
        Dock {
            ToolButton(.pen, isOn: true, context: .dock) {}
            ToolButton(.eraser, context: .dock) {}
            ToolButton(.shapes, context: .dock) {}
            DockSeparator()
            ToolButton(.undo, context: .dock) {}
            ToolButton(.redo, context: .dock) {}.disabled(true)
            DockSeparator()
            ForEach(DS.KidPen.all) { pen in PenSwatch(pen, isOn: pen == .black) {} }
        }
        HStack(spacing: 12) {
            ToolButton(.pen, title: "Pen", isOn: true) {}
            ToolButton(.eraser, title: "Eraser") {}
            ToolButton(.picture, title: "Picture") {}
            ForEach(DS.KidPen.all) { pen in PenSwatch(pen, isOn: pen == .red, context: .light) {} }
        }
    }
    .padding(40)
    .background(DS.Color.ground)
}
