import AgathonDesign
import AgathonStore
import SwiftUI

/// Grown-ups only: a three-digit number written in words, typed on the PIN pad
/// (`ParentalGateChallenge`). Nothing about money shows until it is passed. A wrong answer gets a new
/// number and "Look again" (never red).
struct ParentalGateView: View {
    let onPass: () -> Void
    let onClose: () -> Void

    @State private var challenge = ParentalGateChallenge.random()
    @State private var entry = ""
    @State private var lookAgain = false

    var body: some View {
        ZStack {
            DS.Color.ground.ignoresSafeArea()
            VStack(spacing: 0) {
                HStack {
                    Tag("Grown-ups only", style: .ink)
                    Spacer()
                    RoundButton(.close, fill: .paper, diameter: 52, label: "Close", action: onClose)
                        .accessibilityIdentifier("gate.close")
                }
                Spacer(minLength: DS.Space.l)
                VStack(spacing: DS.Space.m) {
                    IconCircle(.lock, fill: .sunny, diameter: 88)
                    Text("Ask a grown-up to help").dsFont(.title).foregroundStyle(DS.Color.ink)
                        .multilineTextAlignment(.center)
                    Text("Type this number:").dsFont(.body).foregroundStyle(DS.Color.inkSecondary)
                    Text(challenge.words)
                        .dsFont(.headline, size: 30)
                        .foregroundStyle(DS.Color.ink)
                        .multilineTextAlignment(.center)
                        .accessibilityLabel(challenge.spokenPrompt)
                        .accessibilityIdentifier("gate.words")
                    PinDots(count: entry.count, length: challenge.digits, lookAgain: lookAgain)
                        .padding(.top, DS.Space.s)
                    Text(lookAgain ? "Look again. Here's a new number." : " ")
                        .dsFont(.callout).foregroundStyle(DS.Color.inkSecondary)
                    PinPad(entry: $entry, length: challenge.digits, keyFill: .paper) { typed in check(typed) }
                }
                .frame(maxWidth: 520)
                Spacer(minLength: DS.Space.l)
            }
            .padding(DS.Space.xxl)
        }
    }

    private func check(_ typed: String) {
        if challenge.accepts(typed) {
            onPass()
        } else {
            lookAgain = true
            challenge = ParentalGateChallenge.random(excluding: challenge.answer)
            entry = ""
        }
    }
}
