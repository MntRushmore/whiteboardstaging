import SwiftUI

extension DS {
    /// Blocks moves with a snap: fast and sure, 150 to 250 ms, one small overshoot, then still.
    /// Everything here stops, or becomes a plain cut, under Reduce Motion.
    public enum Motion {
        /// The house spring: about 220 ms with one small overshoot.
        public static let snap = Animation.spring(duration: 0.22, bounce: 0.3)
        /// For something arriving (a sticker landing, a mark part snapping in): a touch more bounce.
        public static let pop = Animation.spring(duration: 0.3, bounce: 0.45)
        /// A finger going down on a button.
        public static let press = Animation.easeOut(duration: 0.1)
        /// The tutor's tick drawing itself in one stroke.
        public static let draw = Animation.timingCurve(0.55, 0, 0.3, 1, duration: 0.42)
        /// Cross-fades and colour changes.
        public static let fade = Animation.easeInOut(duration: 0.18)

        /// A pressed control shrinks to 96 %.
        public static let pressScale: CGFloat = 0.96

        /// The mark assembles: the ring snaps in, the bar slides up, then the dot drops in.
        public static let assembleRingDelay = 0.0
        public static let assembleBarDelay = 0.13
        public static let assembleDotDelay = 0.23

        /// The shapes blink every 4.2 s and bob every 2.4 s while idle.
        public static let blinkPeriod = 4.2
        public static let bobPeriod = 2.4

        /// `animation`, or nil (an instant change) under Reduce Motion.
        public static func animation(_ animation: Animation, reduceMotion: Bool) -> Animation? {
            reduceMotion ? nil : animation
        }
    }
}

/// `withAnimation` that honours Reduce Motion.
@MainActor
public func withDSAnimation<Result>(_ animation: Animation = DS.Motion.snap, reduceMotion: Bool,
                                    _ body: () throws -> Result) rethrows -> Result {
    try withAnimation(DS.Motion.animation(animation, reduceMotion: reduceMotion), body)
}

private struct DSAnimationModifier<V: Equatable>: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let animation: Animation
    let value: V

    func body(content: Content) -> some View {
        content.animation(DS.Motion.animation(animation, reduceMotion: reduceMotion), value: value)
    }
}

extension View {
    /// `.animation(_:value:)` that turns into an instant change under Reduce Motion.
    public func dsAnimation<V: Equatable>(_ animation: Animation = DS.Motion.snap, value: V) -> some View {
        modifier(DSAnimationModifier(animation: animation, value: value))
    }
}
