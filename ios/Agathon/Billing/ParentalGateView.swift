import AgathonDesign
import AgathonOnboarding
import AgathonStore
import SwiftUI

/// Grown-ups only: the app's parental gate (`AppParentalGate`: a three-digit number written in
/// words, typed on the PIN pad). Nothing about money shows until it is passed. A wrong answer gets a
/// new number and "Look again" (never red). The onboarding's gate step asks the same.
struct ParentalGateView: View {
    let onPass: () -> Void
    let onClose: () -> Void

    @State private var gate = AppParentalGate()
    @State private var words = ""
    @State private var spoken = ""
    @State private var entry = ""
    @State private var lookAgain = false

    var body: some View {
        GeometryReader { geo in
            ScrollView {
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
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityAddTraits(.isHeader)
                        Text(AppParentalGate.question).dsFont(.body).foregroundStyle(DS.Color.inkSecondary)
                        Text(words)
                            .dsFont(.headline, size: 30)
                            .foregroundStyle(DS.Color.ink)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityLabel(spoken)
                            .accessibilityIdentifier("gate.words")
                        PinDots(count: entry.count, length: gate.length, lookAgain: lookAgain)
                            .padding(.top, DS.Space.s)
                        Text(lookAgain ? AppParentalGate.missNote : " ")
                            .dsFont(.callout).foregroundStyle(DS.Color.inkSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                        PinPad(entry: $entry, length: gate.length, keyFill: .paper) { typed in check(typed) }
                    }
                    .frame(maxWidth: 520)
                    Spacer(minLength: DS.Space.l)
                }
                .padding(DS.Space.xxl)
                // centred when it fits; scrolls at the largest text sizes
                .frame(maxWidth: .infinity, minHeight: geo.size.height)
            }
        }
        .background(DS.Color.ground.ignoresSafeArea())
        .onAppear(perform: refresh)
    }

    private func refresh() {
        words = gate.prompt ?? ""
        spoken = gate.spokenPrompt ?? words
    }

    private func check(_ typed: String) {
        switch gate.check(typed, now: Date()) {
        case .open:
            onPass()
        case .miss, .paused:
            lookAgain = true
            entry = ""
            refresh()
        }
    }
}
