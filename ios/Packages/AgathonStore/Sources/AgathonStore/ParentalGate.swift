import Foundation

/// The grown-ups-only gate in front of everything about money (the plan, restore, manage, refunds):
/// a three-digit number written in words, typed on a number pad ("Type this number: six hundred
/// twenty-eight" -> 628). Reading a number written in words and turning it into digits is easy for a
/// grown-up and out of reach for the young children Apple's parental-gate rule protects (App Review
/// Guidelines 1.3 and 5.1.4); a sum or a times table would not be, in a maths app. Nothing about
/// money, not even a price, shows until it is passed. Pure: the screen is ios/Agathon/Billing.
public struct ParentalGateChallenge: Sendable, Equatable {
    /// The number to type, 100 to 999 (never a round hundred: those are too easy to guess).
    public let answer: Int

    public init(answer: Int) {
        precondition((100 ... 999).contains(answer), "a three-digit number")
        self.answer = answer
    }

    /// How many digits the pad takes.
    public var digits: Int { 3 }

    /// "six hundred twenty-eight".
    public var words: String { NumberWords.english(answer) }

    /// What VoiceOver reads (the words, never the digits).
    public var spokenPrompt: String { "Type this number: \(words)" }

    /// True when `typed` is the answer, in digits.
    public func accepts(_ typed: String) -> Bool {
        typed.count == digits && Int(typed) == answer
    }

    /// A new challenge. Different from `previous`, so a wrong try never sees the same number again.
    public static func random(excluding previous: Int? = nil) -> ParentalGateChallenge {
        var rng = SystemRandomNumberGenerator()
        return random(excluding: previous, using: &rng)
    }

    public static func random<G: RandomNumberGenerator>(excluding previous: Int? = nil, using rng: inout G) -> ParentalGateChallenge {
        while true {
            let n = Int.random(in: 101 ... 999, using: &rng)
            if n % 100 != 0, n != previous { return ParentalGateChallenge(answer: n) }
        }
    }
}

/// Numbers in US English words, 0 to 999 ("four hundred seven", "forty-seven").
public enum NumberWords {
    static let ones = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
                       "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
    static let tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]

    public static func english(_ n: Int) -> String {
        precondition((0 ... 999).contains(n), "0 to 999")
        if n < 20 { return ones[n] }
        if n < 100 { return n % 10 == 0 ? tens[n / 10] : "\(tens[n / 10])-\(ones[n % 10])" }
        let rest = n % 100
        let hundreds = "\(ones[n / 100]) hundred"
        return rest == 0 ? hundreds : "\(hundreds) \(english(rest))"
    }
}
