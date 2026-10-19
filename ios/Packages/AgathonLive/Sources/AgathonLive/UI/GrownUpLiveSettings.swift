import AgathonBrain
import AgathonDesign
import SwiftUI

/// The grown-ups' button for the board's top bar: opens the help dial and Auto (`GrownUpLiveSettings`).
/// A kid can open it — it is labelled for grown-ups, as the web's More is; the parental gate in front
/// of anything that costs money is the billing screens'.
public struct GrownUpLiveButton: View {
    @ObservedObject var loop: LiveLoop
    @State private var open = false

    public init(loop: LiveLoop) {
        self.loop = loop
    }

    public var body: some View {
        RoundButton(.lock, fill: .paper, label: LiveCopy.GrownUps.button) { open = true }
            .accessibilityIdentifier("live.grownUps")
            .popover(isPresented: $open, arrowEdge: .top) {
                GrownUpLiveSettings(loop: loop) { open = false }
                    .presentationCompactAdaptation(.popover)
            }
    }
}

/// For grown-ups: how much help (Off, Hint, Next step, Solve it), when the work is checked (when
/// they're done, the default; or as they go), Auto, the tutor's hand, celebrations, Live itself,
/// "I read" beside each line, answers after `=` (homework checking; off by default), and clearing the
/// tutor's marks.
public struct GrownUpLiveSettings: View {
    @ObservedObject var loop: LiveLoop
    let close: () -> Void

    public init(loop: LiveLoop, close: @escaping () -> Void) {
        self.loop = loop
        self.close = close
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.l) {
            SheetHeader(LiveCopy.GrownUps.title, onClose: close)
            VStack(alignment: .leading, spacing: DS.Space.xs) {
                Text(LiveCopy.GrownUps.help).dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
                SegmentedPicker(selection: $loop.settings.mode, options: [
                    (LiveMode.off, LiveCopy.GrownUps.off),
                    (LiveMode.feedback, LiveCopy.Help.hint),
                    (LiveMode.suggest, LiveCopy.Help.step),
                    (LiveMode.answer, LiveCopy.Help.solve),
                ], onPaper: true)
                .accessibilityIdentifier("live.dial")
            }
            VStack(alignment: .leading, spacing: DS.Space.xs) {
                Text(LiveCopy.GrownUps.checking).dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
                SegmentedPicker(selection: $loop.settings.checking, options: [
                    (CheckTiming.whenDone, LiveCopy.GrownUps.whenDone),
                    (CheckTiming.asIGo, LiveCopy.GrownUps.asTheyGo),
                ], onPaper: true)
                .accessibilityIdentifier("live.checking")
                Text(loop.settings.checking == .whenDone ? LiveCopy.GrownUps.whenDoneDetail : LiveCopy.GrownUps.asTheyGoDetail)
                    .dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            VStack(spacing: DS.Space.xs) {
                LiveSwitch(LiveCopy.GrownUps.auto, detail: loop.settings.auto ? LiveCopy.GrownUps.autoOn : LiveCopy.GrownUps.autoOff, isOn: $loop.settings.auto)
                    .accessibilityIdentifier("live.auto")
                LiveSwitch(LiveCopy.GrownUps.handwriting, isOn: $loop.settings.handwriting)
                LiveSwitch(LiveCopy.GrownUps.celebrations, isOn: $loop.settings.celebrations)
                LiveSwitch(LiveCopy.GrownUps.live, isOn: $loop.settings.enabled)
                LiveSwitch(LiveCopy.GrownUps.showReadings, detail: LiveCopy.GrownUps.showReadingsDetail, isOn: $loop.settings.showReadings)
                    .accessibilityIdentifier("live.showReadings")
                LiveSwitch(LiveCopy.GrownUps.answerOnEquals, detail: LiveCopy.GrownUps.answerOnEqualsDetail, isOn: $loop.settings.answerOnEquals)
                    .accessibilityIdentifier("live.answerOnEquals")
            }
            PillButton(LiveCopy.GrownUps.clearMarks, icon: .delete, kind: .secondaryOnPaper) { loop.clearMarks() }
        }
        .padding(DS.Space.xl)
        .frame(width: 480)
        .background(DS.Color.surface)
    }
}

/// A switch row: the words, and a flat capsule (ink when on, chalk when off). 56 pt tall.
struct LiveSwitch: View {
    let title: String
    let detail: String?
    @Binding var isOn: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(_ title: String, detail: String? = nil, isOn: Binding<Bool>) {
        self.title = title
        self.detail = detail
        _isOn = isOn
    }

    var body: some View {
        Button {
            withDSAnimation(DS.Motion.snap, reduceMotion: reduceMotion) { isOn.toggle() }
        } label: {
            HStack(spacing: DS.Space.s) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).dsFont(.button, size: 17).foregroundStyle(DS.Color.ink)
                    if let detail {
                        Text(detail).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: DS.Space.s)
                ZStack(alignment: isOn ? .trailing : .leading) {
                    Capsule().fill(isOn ? DS.Color.ink : DS.Color.line).frame(width: 56, height: 32)
                    Circle().fill(DS.Color.paper).frame(width: 26, height: 26).padding(3)
                }
            }
            .padding(.horizontal, DS.Space.m)
            .frame(minHeight: DS.Size.minTarget)
            .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(DS.Color.surfaceSunken))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(isOn ? "On" : "Off")
        .accessibilityAddTraits(.isButton)
    }
}
