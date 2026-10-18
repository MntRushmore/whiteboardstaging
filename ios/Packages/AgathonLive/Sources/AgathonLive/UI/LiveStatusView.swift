import AgathonDesign
import SwiftUI

/// What the tutor is doing, for the board's `topTrailing` slot: a small pill while it reads, checks
/// or solves; a calm line and one big button when something went wrong (the web's kid status: never
/// the grown-up words, never a small red Retry). Nothing at all the rest of the time.
public struct LiveStatusView: View {
    @ObservedObject var loop: LiveLoop
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(loop: LiveLoop) {
        self.loop = loop
    }

    public var body: some View {
        Group {
            switch loop.activity {
            case .idle:
                EmptyView()
            case .reading:
                StatusPill(LiveCopy.Status.reading)
            case .checking:
                StatusPill(LiveCopy.Status.checking)
            case .solving:
                StatusPill(LiveCopy.Status.solving)
            case .offline(let waiting):
                StatusPill(waiting > 0 ? LiveCopy.Status.offlineWaiting(waiting) : LiveCopy.Status.offline, dot: DS.Color.inkSecondary, pulses: false)
            case .paused:
                StatusPill(LiveCopy.Status.paused, dot: DS.Color.inkSecondary, pulses: false)
            case .outOfInk:
                StatusPill(LiveCopy.OutOfInk.pill, dot: DS.Color.tutorInkEmpty, pulses: false)
            case .signedOut:
                KidTrouble(words: LiveCopy.Status.signIn, button: nil, enabled: false) {}
            case .trouble(let retry):
                KidTrouble(words: LiveCopy.Status.trouble, button: retry ? LiveCopy.Status.retry : LiveCopy.Status.ok, enabled: true) {
                    if retry { loop.retry() } else { loop.dismissTrouble() }
                }
            case .slowDown(let until, let fairUse):
                if fairUse {
                    KidTrouble(words: LiveCopy.Status.later, button: LiveCopy.Status.ok, enabled: true) { loop.dismissTrouble() }
                } else {
                    SlowDown(loop: loop, until: until)
                }
            }
        }
        .accessibilityIdentifier("live.status")
        .dsAnimation(DS.Motion.fade, value: loop.activity)
    }
}

/// One calm sentence and one big button (the kid's face of an error).
struct KidTrouble: View {
    let words: String
    let button: String?
    let enabled: Bool
    let action: () -> Void

    var body: some View {
        HStack(spacing: DS.Space.s) {
            Circle().fill(DS.Color.sunny).frame(width: 40, height: 40)
                .overlay(DSIcon(.lookAgain, size: 18).foregroundStyle(DS.Color.ink))
            Text(words).dsFont(.button, size: 17).foregroundStyle(DS.Color.ink)
                .fixedSize(horizontal: false, vertical: true)
            if let button {
                PillButton(button, icon: .retry, kind: .secondaryOnPaper, action: action)
                    .disabled(!enabled)
                    .accessibilityIdentifier("live.retry")
            }
        }
        .padding(.leading, 10)
        .padding(.trailing, button == nil ? 22 : 6)
        .padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: 34, style: .continuous).fill(DS.Color.surface))
        .accessibilityElement(children: .contain)
    }
}

/// A short rate limit: the button counts down.
struct SlowDown: View {
    @ObservedObject var loop: LiveLoop
    let until: Double

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            let left = max(0, Int(((until - loop.scheduler.now) / 1000).rounded(.up)))
            KidTrouble(words: LiveCopy.Status.pause,
                       button: left > 0 ? LiveCopy.Status.tryAgainIn(left) : LiveCopy.Status.retry,
                       enabled: left == 0) { loop.retry() }
        }
    }
}
