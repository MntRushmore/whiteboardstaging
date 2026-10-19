import Foundation

/// What a gate said to an answer.
public enum GateResult: Sendable, Equatable {
    case open
    /// "This part is for grown-ups."
    case miss
    /// "Try again in a minute." (after two misses)
    case paused(until: Date)
}

/// The seam for the grown-ups-only check before the account (docs/ONBOARDING.md, `gate`). The app
/// passes its one gate, the billing screens' (a three-digit number written in words, typed on the
/// pad: `AppParentalGate` in ios/Agathon/Billing); `BirthYearGate` is the package's own default for
/// tests and previews. Once the PIN exists it replaces any gate (the switcher's job, not this one's).
public protocol ParentalGate: AnyObject, Sendable {
    /// Digits the gate asks for (a year: 4).
    var length: Int { get }
    /// Checks an answer. Never stores or sends it.
    @MainActor func check(_ answer: String, now: Date) -> GateResult
    /// Paused until then, if paused.
    @MainActor func pausedUntil(now: Date) -> Date?
    /// The question, when the gate asks its own ("Type this number:"); nil: the onboarding's words.
    @MainActor var question: String? { get }
    /// What to type, in big words under the question (the app's gate: a number written in words);
    /// it may change after a miss. nil: nothing more than the question.
    @MainActor var prompt: String? { get }
    /// What VoiceOver reads for the prompt (never the digits).
    @MainActor var spokenPrompt: String? { get }
    /// The line after a miss, when the gate has its own ("Look again. Here's a new number.").
    @MainActor var missNote: String? { get }
}

extension ParentalGate {
    @MainActor public var question: String? { nil }
    @MainActor public var prompt: String? { nil }
    @MainActor public var spokenPrompt: String? { nil }
    @MainActor public var missNote: String? { nil }
}

/// "What year were you born?": open when the year makes them 18 or older, without ever saying the
/// rule. Two misses pause it for a minute. The year is never stored or sent, and the misses live
/// only in memory (a speed bump; the real guards are the PIN, Apple's sheet and Ask to Buy).
@MainActor
public final class BirthYearGate: ParentalGate {
    public nonisolated let length = 4
    public static let adultAge = 18
    public static let missesBeforePause = 2
    public static let pause: TimeInterval = 60

    private var misses = 0
    private var paused: Date?
    private let calendar: Calendar

    public nonisolated init(calendar: Calendar = Calendar(identifier: .gregorian)) {
        self.calendar = calendar
    }

    public func pausedUntil(now: Date) -> Date? {
        guard let paused, paused > now else { return nil }
        return paused
    }

    public func check(_ answer: String, now: Date) -> GateResult {
        if let until = pausedUntil(now: now) { return .paused(until: until) }
        let thisYear = calendar.component(.year, from: now)
        if answer.count == length, answer.allSatisfy(\.isASCII), let year = Int(answer),
           year >= thisYear - 120, thisYear - year >= Self.adultAge {
            misses = 0
            return .open
        }
        misses += 1
        if misses >= Self.missesBeforePause {
            misses = 0
            let until = now.addingTimeInterval(Self.pause)
            paused = until
            return .paused(until: until)
        }
        return .miss
    }
}
