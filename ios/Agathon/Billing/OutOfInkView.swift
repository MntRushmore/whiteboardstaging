import AgathonDesign
import SwiftUI

/// Help is paused (the ink ran out and there is no plan). A kid is sent to a grown-up and sees no
/// price and no buttons about money; a grown-up is offered the plan, behind the parental gate.
/// Drawing on the board is always free, so both can keep going.
struct OutOfInkView: View {
    enum Audience { case kid, grownUp }

    let audience: Audience
    var onSeePlan: () -> Void = {}
    let onClose: () -> Void

    var body: some View {
        GeometryReader { geo in
        ScrollView {
            VStack(spacing: DS.Space.m) {
                TheShapes(.outOfInk, showsGround: true).frame(width: 220)
                Text("Help is paused").dsFont(.title).foregroundStyle(DS.Color.ink)
                Text(audience == .kid
                    ? "Ask a grown-up to switch it back on. You can still draw and write on your board."
                    : "Start Agathon Unlimited to switch help back on for the whole family. Drawing is always free.")
                    .dsFont(.body)
                    .foregroundStyle(DS.Color.inkSecondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 460)
                switch audience {
                case .kid:
                    PillButton("OK", kind: .primary, size: .large, action: onClose)
                        .padding(.top, DS.Space.l)
                        .accessibilityIdentifier("outOfInk.ok")
                case .grownUp:
                    PillButton("See the plan", icon: .play, kind: .sunny, size: .large, action: onSeePlan)
                        .padding(.top, DS.Space.l)
                        .accessibilityIdentifier("outOfInk.seePlan")
                    PillButton("Not now", kind: .quiet, action: onClose)
                }
            }
            .padding(DS.Space.xxl)
            // centred when it fits; scrolls at the largest text sizes
            .frame(maxWidth: .infinity, minHeight: geo.size.height)
        }
        .scrollBounceBehavior(.basedOnSize)
        }
        .background(DS.Color.ground.ignoresSafeArea())
    }
}
