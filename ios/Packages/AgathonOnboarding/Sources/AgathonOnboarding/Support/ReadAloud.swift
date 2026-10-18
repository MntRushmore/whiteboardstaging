import AVFoundation
import UIKit

/// The speaker button on every screen a kid reads: the title and the answers, read on the iPad with
/// `AVSpeechSynthesizer` (en-US; no network, nothing sent). Once the grade is Kindergarten to 1st,
/// the try's instruction is read by itself.
@MainActor
public final class ReadAloud {
    public static let shared = ReadAloud()
    private let synth = AVSpeechSynthesizer()

    public func say(_ lines: [String]) {
        synth.stopSpeaking(at: .immediate)
        let text = lines.filter { !$0.isEmpty }.joined(separator: " ")
        guard !text.isEmpty else { return }
        // VoiceOver reads the screen already; the button speaks through it instead.
        if UIAccessibility.isVoiceOverRunning {
            UIAccessibility.post(notification: .announcement, argument: text)
            return
        }
        let u = AVSpeechUtterance(string: text)
        u.voice = AVSpeechSynthesisVoice(language: "en-US")
        u.rate = AVSpeechUtteranceDefaultSpeechRate * 0.92
        u.pitchMultiplier = 1.05
        synth.speak(u)
    }

    public func stop() { synth.stopSpeaking(at: .immediate) }
}

/// Words for VoiceOver from the tutor's LaTeX: "48 plus 27 equals, blank."
enum LatexWords {
    static func say(_ latex: String, blank: Bool = false) -> String {
        var s = latex
        let swaps: [(String, String)] = [
            ("\\times", " times "), ("\\div", " divided by "), ("\\cdot", " times "), ("\\%", " percent"),
            ("\\pi", " pi "), ("^{\\circ}", " degrees"), ("\\sqrt", " the square root of "), ("\\left", ""), ("\\right", ""),
            ("+", " plus "), ("-", " minus "), ("=", " equals "), (">", " is greater than "), ("<", " is less than "),
        ]
        // fractions first: \frac{a}{b} → a over b
        while let r = s.range(of: #"\\frac\{([^{}]*)\}\{([^{}]*)\}"#, options: .regularExpression) {
            let inner = String(s[r]).dropFirst(6)
            let parts = inner.split(separator: "}", maxSplits: 1).map { $0.replacingOccurrences(of: "{", with: "") }
            s.replaceSubrange(r, with: parts.count == 2 ? " \(parts[0]) over \(parts[1]) " : " ")
        }
        for (a, b) in swaps { s = s.replacingOccurrences(of: a, with: b) }
        s = s.replacingOccurrences(of: "\\text", with: "").replacingOccurrences(of: "{", with: "").replacingOccurrences(of: "}", with: "")
        s = s.replacingOccurrences(of: "\\", with: "")
        s = s.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        if blank { s += s.hasSuffix("equals") ? ", blank." : " equals, blank." }
        return s
    }
}
