import Foundation

/// The grid-in ("student-produced response") rules, as the test has them and the web checks them
/// (docs/SAT-MODE.md, "SPR rules"; src/lib/sat/answer.ts):
///
///  - a whole number, a decimal (`.75` or `0.75`) or a fraction (`3/4`), with an optional leading minus;
///  - a positive answer fills at most 5 characters, a negative one at most 6 (the minus counts);
///  - no mixed numbers (`1 1/2` is not an answer: `3/2` or `1.5` is);
///  - a decimal must be as precise as the space allows, which is why the bank lists every accepted
///    form (`.6666`, `.6667`, `2/3`) rather than comparing values loosely: `.67` is not 2/3. The same
///    value written another way (`6/8` for `3/4`, `1.50` for `1.5`) is right, as it is on the test.
///
/// The panel's keypad types through `press`, which never lets a key make the answer something no
/// grid-in could be; `problem` says what is still missing when Check is tapped.
public enum SATGridIn {
    /// The keypad's keys.
    public enum Key: Hashable, Sendable {
        case digit(Int)
        case point
        case slash
        case minus
        case delete
        case clear

        /// what the key types
        public var character: Character? {
            switch self {
            case .digit(let d): Character(String(d))
            case .point: "."
            case .slash: "/"
            case .minus: "-"
            case .delete, .clear: nil
            }
        }
    }

    /// Why an answer can't be checked yet, or why a key did nothing.
    public enum Problem: Equatable, Sendable {
        case empty
        /// a minus, a point or a slash with nothing after it
        case unfinished
        case zeroDenominator
        /// the field is full (5 characters, 6 with a minus)
        case full
        /// a point and a slash together
        case fractionOrDecimal
        /// a minus anywhere but first
        case minusFirst
        /// a second decimal point
        case twoPoints
        /// a space between numbers: a mixed number
        case mixedNumber
        /// a character no grid-in has
        case notAllowed

        /// The words for the student (under the field).
        public var words: String {
            switch self {
            case .empty: "Type your answer first."
            case .unfinished: "Finish your answer first."
            case .zeroDenominator: "A fraction can't have 0 on the bottom."
            case .full: "That's as long as an answer can be: 5 characters, 6 with a minus."
            case .fractionOrDecimal: "Use a fraction or a decimal, not both."
            case .minusFirst: "A minus goes first."
            case .twoPoints: "One decimal point is enough."
            case .mixedNumber: "No mixed numbers. Write 1 1/2 as 3/2 or 1.5."
            case .notAllowed: "Only digits, a point, a slash and a minus."
            }
        }
    }

    /// The longest answer: 5 characters, 6 with a leading minus.
    public static func maxLength(_ s: String) -> Int {
        s.hasPrefix("-") ? SATLimits.sprMaxNegative : SATLimits.sprMaxPositive
    }

    /// A key pressed on `current`: the new answer, or `current` with the reason the key did nothing.
    public static func press(_ key: Key, on current: String) -> (text: String, refused: Problem?) {
        switch key {
        case .delete: return (String(current.dropLast()), nil)
        case .clear: return ("", nil)
        case .minus:
            if current.isEmpty { return ("-", nil) }
            return (current, current == "-" ? nil : .minusFirst)
        case .digit, .point, .slash:
            guard let ch = key.character else { return (current, nil) }
            let next = current + String(ch)
            if next.count > maxLength(next) { return (current, .full) }
            if ch == "." && (current.contains(".") || current.contains("/")) { return (current, current.contains("/") ? .fractionOrDecimal : .twoPoints) }
            if ch == "/" {
                if current.contains(".") { return (current, .fractionOrDecimal) }
                // a slash after a whole number only, once
                guard !current.contains("/"), current.last?.isNumber == true else { return (current, .unfinished) }
            }
            return (next, nil)
        }
    }

    /// Typed text (a hardware keyboard, a paste) run through the keypad's rules, key by key; a space
    /// between numbers is a mixed number and refuses the whole lot.
    public static func type(_ typed: String, on current: String) -> (text: String, refused: Problem?) {
        // "1 1/2" pasted whole, or a space typed after a number (a hardware keyboard, key by key)
        if typed.trimmingCharacters(in: .whitespaces).contains(" ") || (typed.first == " " && current.last?.isNumber == true) {
            return (current, .mixedNumber)
        }
        var text = current
        var refused: Problem?
        for ch in typed where ch != " " {
            let key: Key
            switch ch {
            case "0"..."9": key = .digit(Int(String(ch)) ?? 0)
            case ".": key = .point
            case "/": key = .slash
            case "-", "−": key = .minus
            default:
                refused = .notAllowed
                continue
            }
            let r = press(key, on: text)
            text = r.text
            if let p = r.refused { refused = p }
        }
        return (text, refused)
    }

    /// What stops `s` from being checked (nil: it is a grid-in answer).
    public static func problem(_ s: String) -> Problem? {
        let t = s.trimmingCharacters(in: .whitespaces)
        if t.isEmpty { return .empty }
        if t.contains(" ") { return .mixedNumber }
        if t.count > maxLength(t) { return .full }
        guard t.range(of: #"^-?(?:\d+|\d*\.\d+|\d+/\d+)$"#, options: .regularExpression) != nil else {
            if t.dropFirst().contains("-") { return .minusFirst }
            if t.contains(".") && t.contains("/") { return .fractionOrDecimal }
            if t.range(of: #"^[-0-9./]*$"#, options: .regularExpression) == nil { return .notAllowed }
            return .unfinished
        }
        if t.contains("/"), let bottom = t.split(separator: "/").last, Double(bottom) == 0 { return .zeroDenominator }
        return nil
    }

    /// The value of a grid-in answer, or nil when it is not one.
    public static func value(_ s: String) -> Double? {
        let t = s.trimmingCharacters(in: .whitespaces)
        guard problem(t) == nil else { return nil }
        if t.contains("/") {
            let negative = t.hasPrefix("-")
            let parts = t.replacingOccurrences(of: "-", with: "").split(separator: "/")
            guard parts.count == 2, let a = Double(parts[0]), let b = Double(parts[1]), b != 0 else { return nil }
            return (negative ? -1 : 1) * a / b
        }
        return Double(t)
    }

    /// Is the grid-in right? Exactly one of the accepted forms, or the same value as one of them.
    public static func isCorrect(_ s: String, accepted: [String]) -> Bool {
        let t = s.trimmingCharacters(in: .whitespaces)
        guard problem(t) == nil else { return false }
        if accepted.contains(where: { $0.trimmingCharacters(in: .whitespaces) == t }) { return true }
        guard let v = value(t) else { return false }
        // equal, not close: ".66" is not ".6666"
        return accepted.contains { a in value(a).map { abs($0 - v) < 1e-9 } ?? false }
    }

    /// The answer as the panel shows it: a real minus sign.
    public static func display(_ s: String) -> String {
        s.replacingOccurrences(of: "-", with: "−")
    }
}
