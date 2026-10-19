import AgathonOnboarding
import AgathonStore
import Foundation

/// The app's one parental gate, everywhere a grown-up's part starts: the onboarding's `gate` step
/// (through its `ParentalGate` seam) and every path to money (`ParentalGateView`: the plan, out of
/// ink, the account). A three-digit number written in words, typed on the number pad
/// (`ParentalGateChallenge`: easy for a grown-up, out of reach for the young children Apple's
/// parental-gate rule protects; a sum would not be, in a maths app, and a birth year is only an age
/// question a kid can answer with any old year). A wrong answer gets a new number and "Look again",
/// never red. Nothing is stored or sent.
@MainActor
final class AppParentalGate: ParentalGate {
    nonisolated let length = 3
    private(set) var challenge: ParentalGateChallenge

    init(challenge: ParentalGateChallenge = .random()) {
        self.challenge = challenge
    }

    var question: String? { Self.question }
    var prompt: String? { challenge.words }
    var spokenPrompt: String? { challenge.spokenPrompt }
    var missNote: String? { Self.missNote }

    static let question = "Type this number:"
    static let missNote = "Look again. Here's a new number."

    func check(_ answer: String, now: Date) -> GateResult {
        if challenge.accepts(answer) { return .open }
        challenge = .random(excluding: challenge.answer)
        return .miss
    }

    func pausedUntil(now: Date) -> Date? { nil }
}
