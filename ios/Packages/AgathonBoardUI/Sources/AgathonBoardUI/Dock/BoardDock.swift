import AgathonBoard
import AgathonDesign
import SwiftUI

/// A tool on the ink dock: a 52 pt circle (sunny while it is the tool in hand) with one short word
/// under it. The whole column (60 × 72 pt) is the target.
struct DockButton<Glyph: View>: View {
    let title: String
    var isOn = false
    /// its panel is open above the dock (a lighter circle, not the sunny of the tool in hand)
    var isOpen = false
    var accessibilityHint: String?
    let action: () -> Void
    @ViewBuilder let glyph: () -> Glyph

    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                glyph()
                    .frame(width: DockLayout.Size.circle, height: DockLayout.Size.circle)
                    .modifier(Circleish(isOn: isOn, isOpen: isOpen))
                Text(title)
                    .font(DS.Font.fixed(.button, size: 12))
                    .foregroundStyle(!isEnabled ? DS.Color.onInkDisabled : isOn ? DS.Color.sunny : DS.Color.onInkSecondary)
                    .lineLimit(1)
                    .fixedSize()
            }
            .frame(minWidth: DockLayout.Size.tool, minHeight: 72)
            .contentShape(Rectangle())
        }
        .buttonStyle(DockPress())
        .accessibilityLabel(title)
        .accessibilityHint(accessibilityHint ?? "")
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }

    private struct Circleish: ViewModifier {
        let isOn: Bool
        let isOpen: Bool
        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.dockPressed) private var pressed

        func body(content: Content) -> some View {
            let fill: DS.Fill = isOn ? .sunny
                : isOpen ? DS.Fill(background: DS.ColorTokens.onInkFaint.light, foreground: DS.Palette.white,
                                   pressed: DS.Palette.ink.mixed(with: DS.Palette.white, amount: 0.24))
                : DS.Fill(background: DS.Palette.ink, foreground: DS.Palette.white,
                          pressed: DS.Palette.ink.mixed(with: DS.Palette.white, amount: 0.14))
            content
                .foregroundStyle(isEnabled ? fill.foreground.color : DS.Color.onInkDisabled)
                .background(Circle().fill(pressed ? fill.pressed.color : fill.background.color))
        }
    }
}

private struct DockPressedKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    var dockPressed: Bool {
        get { self[DockPressedKey.self] }
        set { self[DockPressedKey.self] = newValue }
    }
}

/// Press: shrink to 96 % and darken (the circle), as every Blocks control does.
struct DockPress: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .environment(\.dockPressed, configuration.isPressed)
            .scaleEffect(configuration.isPressed && !reduceMotion ? DS.Motion.pressScale : 1)
            .animation(reduceMotion ? nil : (configuration.isPressed ? DS.Motion.press : DS.Motion.snap), value: configuration.isPressed)
    }
}

/// What opens above the dock: the shapes, the picture sources, the folded tools, the pens.
public enum DockPanel: String, Equatable, Sendable {
    case shapes, picture, more, colors
}

extension InkColor {
    /// The Blocks pen for a kid colour.
    var pen: DS.KidPen? { DS.KidPen.all.first { $0.id == rawValue } }
}

extension DS.KidPen {
    var ink: InkColor { InkColor(rawValue: id) ?? .black }
}

/// The kid dock (Blocks): one ink capsule of tools, each a picture and a word — Select, Pen, Eraser,
/// Shapes, Picture | Undo, Redo | the five pens | the pages ‹ n/N › and New page. On a narrow board
/// (`DockLayout`) Shapes, Picture and Redo fold behind More, then the pens behind one Color button,
/// then New page behind More.
struct BoardDock: View {
    @ObservedObject var controller: BoardController
    let layout: DockLayout
    @Binding var panel: DockPanel?
    let canTakePhoto: Bool
    var onPicture: (PictureSource) -> Void

    var body: some View {
        HStack(spacing: 0) {
            tools
            DockSeparator()
            edits
            DockSeparator()
            colors
            // the pages part only when it has something (arrows, New page): no separator left hanging
            if (controller.screenCount > 1 && layout.pageArrows) || !layout.newPageInMore {
                DockSeparator()
                pages
            }
        }
        .padding(.horizontal, DockLayout.Size.padding)
        .frame(height: DockLayout.Size.height)
        .background(Capsule().fill(DS.Color.ink))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(DockCopy.dock)
        .sensoryFeedback(.selection, trigger: controller.tool)
    }

    private func use(_ tool: BoardTool) {
        panel = nil
        controller.tool = tool
    }

    private var shapesOn: Bool { controller.tool == .shapes }

    @ViewBuilder private var tools: some View {
        if !layout.selectInMore {
            DockButton(title: DockCopy.select, isOn: controller.tool == .select, accessibilityHint: DockCopy.selectHint, action: { use(.select) }) {
                BoardIconView(icon: .select)
            }
        }
        DockButton(title: DockCopy.pen, isOn: controller.tool == .pen, action: { use(.pen) }) {
            BoardIconView(icon: .ds(.pen))
        }
        DockButton(title: DockCopy.eraser, isOn: controller.tool == .eraser, action: { use(.eraser) }) {
            BoardIconView(icon: .ds(.eraser))
        }
        if !layout.shapesInMore {
            DockButton(title: DockCopy.shapes, isOn: shapesOn, isOpen: panel == .shapes, action: { toggle(.shapes) }) {
                BoardIconView(icon: shapesOn ? controller.shapeKind.icon : .ds(.shapes))
            }
            DockButton(title: DockCopy.picture, isOpen: panel == .picture, action: { toggle(.picture) }) {
                BoardIconView(icon: .ds(.picture))
            }
        }
    }

    @ViewBuilder private var edits: some View {
        DockButton(title: DockCopy.undo, action: {
            panel = nil
            controller.undo()
        }) {
            BoardIconView(icon: .ds(.undo))
        }
        .disabled(!controller.canUndo)
        if layout.redoInMore {
            // the tool in hand may be in there (a shape, Select): More shows as on then
            DockButton(title: DockCopy.more, isOn: shapesOn || (layout.selectInMore && controller.tool == .select), isOpen: panel == .more || panel == .shapes || panel == .picture,
                       accessibilityHint: DockCopy.moreHint, action: { toggle(.more) }) {
                BoardIconView(icon: .ds(.more))
            }
        } else {
            DockButton(title: DockCopy.redo, action: {
                panel = nil
                controller.redo()
            }) {
                BoardIconView(icon: .ds(.redo))
            }
            .disabled(!controller.canRedo)
        }
    }

    @ViewBuilder private var colors: some View {
        if layout.colorsInButton {
            DockButton(title: DockCopy.color, isOpen: panel == .colors, action: { toggle(.colors) }) {
                Circle().fill(controller.color.pen?.color ?? DS.Color.onInk)
                    .frame(width: 26, height: 26)
                    .overlay(Circle().strokeBorder(DS.Palette.ink.mixed(with: DS.Palette.white, amount: 0.45).color, lineWidth: controller.color == .black ? 2 : 0))
            }
        } else {
            PenSwatches(controller: controller, panel: $panel)
        }
    }

    @ViewBuilder private var pages: some View {
        if controller.screenCount > 1 && layout.pageArrows {
            pageArrow(.back, DockCopy.previousPage, enabled: controller.screenIndex > 1) { controller.previousScreen() }
            Text(DockCopy.pageShort(controller.screenIndex, controller.screenCount))
                .font(DS.Font.fixed(.numeral, size: 17))
                .monospacedDigit()
                .foregroundStyle(DS.Color.onInk)
                .frame(width: DockLayout.Size.pageLabel)
                .accessibilityLabel(DockCopy.pageOf(controller.screenIndex, controller.screenCount))
            pageArrow(.forward, DockCopy.nextPage, enabled: controller.screenIndex < controller.screenCount) { controller.nextScreen() }
        }
        if !layout.newPageInMore {
            NewPageButton {
                panel = nil
                controller.addScreen()
            }
            .disabled(!controller.strip.canAdd)
            .accessibilityHint(controller.strip.canAdd ? "" : DockCopy.full)
        }
    }

    private func pageArrow(_ icon: DS.Icon, _ label: String, enabled: Bool, _ action: @escaping () -> Void) -> some View {
        Button {
            panel = nil
            action()
        } label: {
            DSIcon(icon, size: 24)
                .foregroundStyle(enabled ? DS.Color.onInk : DS.Color.onInkDisabled)
                .frame(width: DockLayout.Size.arrow, height: 72)
                .contentShape(Rectangle())
        }
        .buttonStyle(DockPress())
        .disabled(!enabled)
        .accessibilityLabel(label)
    }

    private func toggle(_ p: DockPanel) {
        panel = panel == p ? nil : p
    }
}

/// The five pens. Picking one picks up the pen too (unless a shape or the highlighter is in hand:
/// its colour is the pen's).
struct PenSwatches: View {
    @ObservedObject var controller: BoardController
    @Binding var panel: DockPanel?

    var body: some View {
        ForEach(DS.KidPen.all) { pen in
            PenSwatch(pen, isOn: controller.color == pen.ink, context: .dock) {
                panel = nil
                controller.color = pen.ink
                if ![.pen, .shapes, .highlighter].contains(controller.tool) { controller.tool = .pen }
            }
        }
    }
}

/// Where a picture comes from.
public enum PictureSource: String, Sendable {
    case photos, camera, files
}

/// A panel over the dock (the web's `DockPopover`): an ink shelf of tools, centred above the dock.
struct DockPanelView: View {
    @ObservedObject var controller: BoardController
    let kind: DockPanel
    let layout: DockLayout
    @Binding var panel: DockPanel?
    let canTakePhoto: Bool
    var onPicture: (PictureSource) -> Void

    var body: some View {
        HStack(spacing: 0) {
            switch kind {
            case .shapes:
                shapeButtons
            case .picture:
                pictureButtons
            case .colors:
                PenSwatches(controller: controller, panel: $panel)
            case .more:
                if layout.selectInMore {
                    DockButton(title: DockCopy.select, isOn: controller.tool == .select, accessibilityHint: DockCopy.selectHint, action: {
                        controller.tool = .select
                        panel = nil
                    }) { BoardIconView(icon: .select) }
                    DockSeparator()
                }
                shapeButtons
                DockSeparator()
                DockButton(title: DockCopy.picture, action: { panel = .picture }) { BoardIconView(icon: .ds(.picture)) }
                // stays open: a kid may redo more than once
                DockButton(title: DockCopy.redo, action: { controller.redo() }) { BoardIconView(icon: .ds(.redo)) }
                    .disabled(!controller.canRedo)
                if layout.newPageInMore {
                    DockButton(title: DockCopy.newPage, action: {
                        panel = nil
                        controller.addScreen()
                    }) { BoardIconView(icon: .newPage) }
                    .disabled(!controller.strip.canAdd)
                }
            }
        }
        .padding(.horizontal, DockLayout.Size.padding)
        .padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: DS.Radius.card, style: .continuous).fill(DS.Color.ink))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(kind == .colors ? DockCopy.colors : kind == .picture ? DockCopy.picture : kind == .shapes ? DockCopy.shapes : DockCopy.more)
    }

    @ViewBuilder private var shapeButtons: some View {
        ForEach([ShapeKind.line, .arrow, .rect, .ellipse], id: \.self) { kind in
            DockButton(title: kind.word, isOn: controller.tool == .shapes && controller.shapeKind == kind, action: {
                controller.shapeKind = kind
                controller.tool = .shapes
                panel = nil
            }) {
                BoardIconView(icon: kind.icon)
            }
        }
    }

    @ViewBuilder private var pictureButtons: some View {
        DockButton(title: DockCopy.photos, action: {
            panel = nil
            onPicture(.photos)
        }) { BoardIconView(icon: .photos) }
        if canTakePhoto {
            DockButton(title: DockCopy.camera, action: {
                panel = nil
                onPicture(.camera)
            }) { BoardIconView(icon: .camera) }
        }
        DockButton(title: DockCopy.files, action: {
            panel = nil
            onPicture(.files)
        }) { BoardIconView(icon: .files) }
    }
}
