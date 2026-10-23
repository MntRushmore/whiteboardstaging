#if os(iOS)
import AgathonBoard
import AgathonDesign
import SwiftUI

// The chrome over SAT v2's printed page (docs/sat2/DESIGN-NOTES.md, "Chrome"), in view points,
// floating over the paper: the top bar, Help me with its rung pips, Check (or the walk-through's
// pill) at the bottom LEFT, and the pen dock at the bottom right (the owner, 2026-10-23: nothing
// under a right-handed student's palm but the pens).

/// The chrome's measures, in one place (pt).
public enum SATChromeSize {
    public static let close: CGFloat = 48
    public static let pill: CGFloat = 48
    public static let edge: CGFloat = 20
    public static let gap: CGFloat = 10
    public static let helpMe: CGFloat = 72
    public static let check: CGFloat = 64
    public static let dock: CGFloat = 72
    /// the bottom of the window kept for the row (the layout's dock lane)
    public static let lane: CGFloat = 110
}

// MARK: - the top bar

/// Close, "Q4 of 10 · skill" (a Review chip on a review), the capped line, Mark, ‹ 4/10 ›.
public struct SATTopBar: View {
    public struct Model: Equatable {
        public var title: String
        public var skill: String
        public var review: Bool
        public var marked: Bool
        public var position: String
        public var hasPrevious: Bool
        public var hasNext: Bool
        /// "Tutor checks used up today: 20 of 20. Help me still works."
        public var capped: String?

        public init(title: String, skill: String, review: Bool, marked: Bool, position: String, hasPrevious: Bool, hasNext: Bool, capped: String?) {
            self.title = title
            self.skill = skill
            self.review = review
            self.marked = marked
            self.position = position
            self.hasPrevious = hasPrevious
            self.hasNext = hasNext
            self.capped = capped
        }
    }

    let model: Model
    let close: () -> Void
    let mark: () -> Void
    let previous: () -> Void
    let next: () -> Void
    let capTapped: () -> Void

    public init(model: Model, close: @escaping () -> Void, mark: @escaping () -> Void, previous: @escaping () -> Void, next: @escaping () -> Void,
                capTapped: @escaping () -> Void) {
        self.model = model
        self.close = close
        self.mark = mark
        self.previous = previous
        self.next = next
        self.capTapped = capTapped
    }

    public var body: some View {
        HStack(spacing: SATChromeSize.gap) {
            Button(action: close) {
                DSIcon(.close, size: 20)
                    .foregroundStyle(DS.Color.ink)
                    .frame(width: SATChromeSize.close, height: SATChromeSize.close)
                    .background(Circle().fill(DS.Color.surfaceSunken))
                    .frame(width: DS.Size.minTarget, height: DS.Size.minTarget)
                    .contentShape(Circle())
            }
            .buttonStyle(SATPress())
            .accessibilityLabel("End practice")
            .accessibilityIdentifier("sat.close")
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(model.title)
                    .font(DS.Font.fixed(.headline, size: 21))
                    .tracking(-0.03 * 21)
                    .foregroundStyle(DS.Color.ink)
                    .accessibilityIdentifier("sat.position")
                Text("· \(model.skill)")
                    .font(.custom(DSFonts.uiPostScriptName(weight: 500), fixedSize: 16))
                    .foregroundStyle(DS.Color.inkSecondary)
                    .lineLimit(1)
                    .accessibilityIdentifier("sat.skill")
                if model.review {
                    Text(SATCopy.reviewChip)
                        .font(.custom(DSFonts.uiPostScriptName(weight: 600), fixedSize: 13))
                        .tracking(0.6)
                        .foregroundStyle(DS.Color.ink)
                        .padding(.horizontal, 10)
                        .frame(height: 26)
                        .overlay(Capsule().strokeBorder(DS.Color.ink, lineWidth: 1.5))
                        .accessibilityIdentifier("sat.review")
                }
            }
            .layoutPriority(1)
            Spacer(minLength: SATChromeSize.gap)
            if let capped = model.capped {
                Button(action: capTapped) {
                    HStack(spacing: 10) {
                        Circle().strokeBorder(DS.Color.inkSecondary, lineWidth: 2.5).frame(width: 10, height: 10)
                        Text(capped)
                            .font(.custom(DSFonts.uiPostScriptName(weight: 400), fixedSize: 15))
                            .foregroundStyle(DS.Color.ink)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                    .padding(.horizontal, 16)
                    .frame(height: 40)
                    .background(Capsule().fill(DS.Color.surfaceSunken))
                }
                .buttonStyle(SATPress())
                .accessibilityIdentifier("sat.tutor.capped")
            }
            Button(action: mark) {
                HStack(spacing: 8) {
                    Image(systemName: model.marked ? "bookmark.fill" : "bookmark").font(.system(size: 17, weight: .semibold))
                    Text(model.marked ? "Marked" : "Mark").font(.custom(DSFonts.uiPostScriptName(weight: 600), fixedSize: 16))
                }
                .foregroundStyle(model.marked ? DS.Color.onInk : DS.Color.ink)
                .padding(.horizontal, 18)
                .frame(height: SATChromeSize.pill)
                .background(Capsule().fill(model.marked ? DS.Color.ink : DS.Color.surfaceSunken))
                .contentShape(Capsule())
            }
            .buttonStyle(SATPress())
            .accessibilityLabel(model.marked ? SATCopy.marked : SATCopy.mark)
            .accessibilityAddTraits(model.marked ? .isSelected : [])
            .accessibilityIdentifier("sat.mark")
            HStack(spacing: 0) {
                arrow("chevron.left", enabled: model.hasPrevious, label: SATCopy.previous, id: "sat.previous", action: previous)
                Text(model.position)
                    .font(.custom(DSFonts.uiPostScriptName(weight: 600), fixedSize: 16))
                    .monospacedDigit()
                    .foregroundStyle(DS.Color.ink)
                    .accessibilityIdentifier("sat.positionShort")
                arrow("chevron.right", enabled: model.hasNext, label: SATCopy.next, id: "sat.next", action: next)
            }
            .frame(height: SATChromeSize.pill)
            .background(Capsule().fill(DS.Color.surfaceSunken))
        }
        .padding(.horizontal, SATChromeSize.edge)
        .padding(.top, 14)
    }

    private func arrow(_ symbol: String, enabled: Bool, label: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(enabled ? DS.Color.ink : DS.Color.inkSecondary.opacity(0.4))
                .frame(width: 44, height: SATChromeSize.pill)
                .contentShape(Rectangle())
        }
        .buttonStyle(SATPress())
        .disabled(!enabled)
        .accessibilityLabel(label)
        .accessibilityIdentifier(id)
    }
}

// MARK: - Help me, Check, the walk-through's pill

/// Help me, 72 pt sunny, always the biggest thing on the board. Under its label, once used, the
/// ladder's rungs as three bars (ink: used; an ink outline: still to come).
public struct SATHelpButton: View {
    /// rungs used so far (nil: not yet tapped, no bars)
    let used: Int?
    let action: () -> Void

    public init(used: Int?, action: @escaping () -> Void) {
        self.used = used
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                AgathonMark(.mono(DS.Color.ink)).frame(width: 46, height: 46)
                VStack(alignment: .leading, spacing: 4) {
                    Text(SATCopy.helpMe)
                        .font(DS.Font.fixed(.headline, size: 26))
                        .tracking(-0.03 * 26)
                        .lineLimit(1)
                        .fixedSize()
                    if let used {
                        HStack(spacing: 5) {
                            ForEach(0..<3, id: \.self) { i in
                                Capsule()
                                    .fill(i < used ? DS.Color.ink : .clear)
                                    .overlay(Capsule().strokeBorder(DS.Color.ink, lineWidth: 1.5))
                                    .frame(width: 22, height: 5)
                            }
                        }
                        .accessibilityHidden(true)
                    }
                }
            }
            .foregroundStyle(DS.Color.ink)
            .padding(.leading, 16)
            .padding(.trailing, 28)
            .frame(height: SATChromeSize.helpMe)
            .background(Capsule().fill(DS.Color.helpMe))
            .contentShape(Capsule())
        }
        .buttonStyle(SATPress())
        .accessibilityLabel(SATCopy.helpMe)
        .accessibilityValue(used.map { "\($0) of 3" } ?? "")
        .accessibilityIdentifier("sat.helpMe")
    }
}

/// Check (an ink pill; off until there is an answer), or what follows a check: Next, See results.
public struct SATCheckButton: View {
    let title: String
    let enabled: Bool
    let icon: DS.Icon
    let id: String
    let action: () -> Void

    public init(title: String, enabled: Bool, icon: DS.Icon = .check, id: String = "sat.check", action: @escaping () -> Void) {
        self.title = title
        self.enabled = enabled
        self.icon = icon
        self.id = id
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                DSIcon(icon, size: 18)
                    .foregroundStyle(enabled ? DS.Color.onInk : SATChromeColor.faint)
                    .frame(width: 42, height: 42)
                    .background(Circle().fill(enabled ? DS.Color.onInkFaint : DS.Color.line))
                Text(title)
                    .font(DS.Font.fixed(.headline, size: 24))
                    .tracking(-0.03 * 24)
                    .foregroundStyle(enabled ? DS.Color.onInk : SATChromeColor.faint)
                    .lineLimit(1)
                    .fixedSize()
            }
            .padding(.leading, 11)
            .padding(.trailing, 26)
            .frame(height: SATChromeSize.check)
            .background(Capsule().fill(enabled ? DS.Color.ink : SATChromeColor.guide))
            .contentShape(Capsule())
        }
        .buttonStyle(SATPress())
        .disabled(!enabled)
        .accessibilityLabel(title)
        .accessibilityIdentifier(id)
    }
}

/// The walk-through's pill in Check's place: three step bars, "Step 2 of 3 · Tap to go on", →.
public struct SATWalkPill: View {
    let step: Int
    let count: Int
    let action: () -> Void

    public init(step: Int, count: Int, action: @escaping () -> Void) {
        self.step = step
        self.count = count
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                HStack(spacing: 6) {
                    ForEach(0..<max(1, count), id: \.self) { i in
                        Capsule().fill(i < step ? DS.Color.onInk : DS.Color.cobaltDeep).frame(width: 22, height: 6)
                    }
                }
                Text(step < count ? SATCopy.walkStep(step, count) : SATCopy.walkDone(count))
                    .font(.custom(DSFonts.uiPostScriptName(weight: 600), fixedSize: 19))
                    .lineLimit(1)
                    .fixedSize()
                Image(systemName: "arrow.right").font(.system(size: 18, weight: .bold))
            }
            .foregroundStyle(DS.Color.onInk)
            .padding(.horizontal, 26)
            .frame(height: SATChromeSize.check)
            .background(Capsule().fill(DS.Color.cobalt))
            .contentShape(Capsule())
        }
        .buttonStyle(SATPress())
        .accessibilityIdentifier("sat.walk.next")
    }
}

/// The two greys the chrome needs that Blocks names only on the board (the design notes' `faint`
/// and `guide`).
enum SATChromeColor {
    static let faint = Color(red: 0xA3 / 255, green: 0xA6 / 255, blue: 0xB4 / 255)
    static let guide = Color(red: 0xE6 / 255, green: 0xE8 / 255, blue: 0xEE / 255)
}

// MARK: - the pen dock

/// The pens, at the bottom right (72 tall, ink): lasso, pencil, highlighter, eraser, Graph it |
/// undo, redo | three pens (ink, red, green). No page arrows: the top bar has them.
public struct SATDock: View {
    @ObservedObject var controller: BoardController
    /// a narrow window (upright): a little tighter, so the row fits beside Help me and Check
    let compact: Bool
    let graph: () -> Void

    public init(controller: BoardController, compact: Bool = false, graph: @escaping () -> Void) {
        self.controller = controller
        self.compact = compact
        self.graph = graph
    }

    private var tool: CGFloat { compact ? 46 : 52 }

    public static let pens: [InkColor] = [.black, .red, .green]

    public var body: some View {
        HStack(spacing: compact ? 2 : 4) {
            tool(.select, "lasso", "Select", id: "sat.tool.select")
            tool(.pen, "pencil", "Pencil", id: "sat.tool.pen")
            tool(.highlighter, "highlighter", "Highlighter", id: "sat.tool.highlighter")
            tool(.eraser, "eraser", "Eraser", id: "sat.tool.eraser")
            button("chart.xyaxis.line", "Graph an equation", id: "sat.tool.graph", action: graph)
            separator
            button("arrow.uturn.backward", "Undo", id: "sat.tool.undo", enabled: controller.canUndo) { controller.undo() }
            button("arrow.uturn.forward", "Redo", id: "sat.tool.redo", enabled: controller.canRedo) { controller.redo() }
            separator
            ForEach(Self.pens, id: \.self) { pen in
                let on = controller.color == pen && controller.tool == .pen
                Button {
                    controller.color = pen
                    controller.tool = .pen
                } label: {
                    ZStack {
                        if on { Circle().strokeBorder(DS.Color.onInk, lineWidth: 3).frame(width: 40, height: 40) }
                        Circle().fill(Color(cgColor: RenderGeometry.cgColor(pen))).frame(width: pen == .black ? 28 : 26, height: pen == .black ? 28 : 26)
                            .overlay(Circle().strokeBorder(pen == .black ? DS.Color.onInk : .clear, lineWidth: 2))
                    }
                    .frame(width: compact ? 44 : 48, height: 48)
                    .contentShape(Rectangle())
                }
                .buttonStyle(SATPress())
                .accessibilityLabel(pen == .black ? "Ink" : pen.rawValue.capitalized)
                .accessibilityAddTraits(on ? .isSelected : [])
                .accessibilityIdentifier("sat.pen.\(pen.rawValue)")
            }
        }
        .padding(.horizontal, compact ? 8 : 12)
        .frame(height: SATChromeSize.dock)
        .background(Capsule().fill(DS.Color.ink))
    }

    private var separator: some View {
        Rectangle().fill(DS.Color.onInkFaint).frame(width: 1.5, height: 32).padding(.horizontal, compact ? 3 : 6)
    }

    private func tool(_ t: BoardTool, _ symbol: String, _ label: String, id: String) -> some View {
        let on = controller.tool == t
        return Button { controller.tool = t } label: {
            Image(systemName: symbol)
                .font(.system(size: 21, weight: .semibold))
                .foregroundStyle(on ? DS.Color.ink : DS.Color.onInk)
                .frame(width: tool, height: tool)
                .background(Circle().fill(on ? DS.Color.sunny : .clear))
                .contentShape(Circle())
        }
        .buttonStyle(SATPress())
        .accessibilityLabel(label)
        .accessibilityAddTraits(on ? .isSelected : [])
        .accessibilityIdentifier(id)
    }

    private func button(_ symbol: String, _ label: String, id: String, enabled: Bool = true, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 21, weight: .semibold))
                .foregroundStyle(enabled ? DS.Color.onInk : DS.Color.onInkDisabled)
                .frame(width: tool, height: tool)
                .contentShape(Circle())
        }
        .buttonStyle(SATPress())
        .disabled(!enabled)
        .accessibilityLabel(label)
        .accessibilityIdentifier(id)
    }
}
#endif
