import AgathonDesign
import SwiftUI

/// True while one of the Live controls' popovers is open (the help chooser, the grown-ups'
/// settings). iPadOS hands the tap that closes a popover on to what is under it: the screen holding
/// the board covers the board while this is true (`BoardScreen`), so that tap never writes a dot.
public struct LivePopoverOpenKey: PreferenceKey {
    public static let defaultValue = false
    public static func reduce(value: inout Bool, nextValue: () -> Bool) { value = value || nextValue() }
}

/// The kid's ask, for the board's `helpButton` slot: the big sunny Help me, and beside it how much
/// help it gives (Hint, Next step, Solve it: the help dial in a kid's words). Off is not a kid's
/// choice: it stays in the grown-ups' panel, and with help off there is no Help me.
public struct LiveHelpBar: View {
    @ObservedObject var loop: LiveLoop
    @State private var choosing = false

    public init(loop: LiveLoop) {
        self.loop = loop
    }

    public var body: some View {
        if loop.settings.enabled && loop.settings.mode != .off {
            OnProblemPages(pages: loop.pages) { HStack(spacing: DS.Space.xs) {
                HelpMeButton(LiveCopy.Help.helpMe) { loop.helpMe() }
                    .accessibilityHint(hint)
                    .accessibilityIdentifier("live.helpMe")
                chooser
            } }
        }
    }

    private var hint: String {
        switch loop.settings.mode {
        case .feedback: return "Your tutor gives you a hint about your latest line"
        case .suggest: return "Your tutor writes the next step for you"
        case .answer: return "Your tutor writes the rest of the steps"
        case .off: return ""
        }
    }

    private var current: HelpLevel { HelpLevel(mode: loop.settings.mode) ?? .hint }

    private var chooser: some View {
        Button { choosing = true } label: {
            HStack(spacing: 8) {
                DSIcon(current.icon, size: 22)
                Text(current.word).dsFont(.button, size: 18).lineLimit(1).fixedSize()
                Image(systemName: "chevron.down").font(.system(size: 15, weight: .bold))
            }
            .foregroundStyle(DS.Color.ink)
            .padding(.horizontal, 20)
            .frame(minHeight: DS.Size.helpMe)
            .background(Capsule().fill(DS.Color.surface))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("How much help: \(current.word)")
        .accessibilityIdentifier("live.helpChoice")
        // the chooser sits at the bottom of the board: the menu opens above it (below, it was off screen)
        .popover(isPresented: $choosing, arrowEdge: .bottom) {
            HelpChoiceMenu(selection: current) { level in
                loop.settings.mode = level.mode
                choosing = false
            }
            .presentationCompactAdaptation(.popover)
        }
        .preference(key: LivePopoverOpenKey.self, value: choosing)
    }
}

/// Shows its content except on a set's All done page (docs/PROBLEM-PAGES.md: nothing there to help with).
struct OnProblemPages<Content: View>: View {
    @ObservedObject var pages: LivePages
    @ViewBuilder let content: () -> Content

    var body: some View {
        if pages.page?.kind != .done { content() }
    }
}

/// The three levels Help me can be at, least help first (the web's `HELP_CHOICES`).
public enum HelpLevel: String, CaseIterable, Identifiable, Sendable {
    case hint, step, solve

    public var id: String { rawValue }

    public init?(mode: LiveMode) {
        switch mode {
        case .feedback: self = .hint
        case .suggest: self = .step
        case .answer: self = .solve
        case .off: return nil
        }
    }

    public var mode: LiveMode {
        switch self {
        case .hint: return .feedback
        case .step: return .suggest
        case .solve: return .answer
        }
    }

    public var word: String {
        switch self {
        case .hint: return LiveCopy.Help.hint
        case .step: return LiveCopy.Help.step
        case .solve: return LiveCopy.Help.solve
        }
    }

    public var line: String {
        switch self {
        case .hint: return LiveCopy.Help.hintLine
        case .step: return LiveCopy.Help.stepLine
        case .solve: return LiveCopy.Help.solveLine
        }
    }

    var icon: DS.Icon {
        switch self {
        case .hint: return .lookAgain
        case .step: return .forward
        case .solve: return .sparkle
        }
    }
}

/// "How much help?": three big rows, the one picked in ink.
struct HelpChoiceMenu: View {
    let selection: HelpLevel
    let pick: (HelpLevel) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.xs) {
            Text(LiveCopy.Help.chooseTitle).dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
                .padding(.horizontal, DS.Space.xs)
                .padding(.bottom, DS.Space.xxs)
            ForEach(HelpLevel.allCases) { level in
                let on = level == selection
                Button { pick(level) } label: {
                    HStack(spacing: DS.Space.s) {
                        IconCircle(level.icon, fill: on ? .ink : .chalk, diameter: 44)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(level.word).dsFont(.button, size: 18).foregroundStyle(DS.Color.ink)
                            Text(level.line).dsFont(.caption, size: 14).foregroundStyle(DS.Color.inkSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: DS.Space.xs)
                        if on { DSIcon(.check, size: 20).foregroundStyle(DS.Color.ink) }
                    }
                    .padding(DS.Space.xs)
                    .frame(minHeight: 64)
                    .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(on ? DS.Color.surfaceSunken : DS.Color.surface))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
                .accessibilityIdentifier("live.helpChoice.\(level.rawValue)")
            }
        }
        .padding(DS.Space.s)
        .frame(width: 340)
        .background(DS.Color.surface)
    }
}
