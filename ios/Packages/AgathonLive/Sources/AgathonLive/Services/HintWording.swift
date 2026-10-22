import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// What a hint is about, once the engine has decided a step is wrong: the words are all that is
/// left to write. The engine has the say on the maths; the writer only phrases where to look.
public struct HintFacts: Sendable, Equatable {
    /// the last right step above (LaTeX), if any
    public var previous: String?
    /// the kid's step with the slip (LaTeX)
    public var line: String
    /// the step the engine says should have come (LaTeX): never to be given away
    public var expected: String?
    /// the engine's own note on the line, if any
    public var note: String

    public init(previous: String?, line: String, expected: String?, note: String = "") {
        self.previous = previous
        self.line = line
        self.expected = expected
        self.note = note
    }

    /// Which side of the step holds the slip, when the engine's step tells: the side that differs
    /// from it while the other side matches.
    public var side: String? {
        guard let expected, let mine = Self.sides(line), let want = Self.sides(expected) else { return nil }
        if mine.left == want.left && mine.right != want.right { return "right" }
        if mine.right == want.right && mine.left != want.left { return "left" }
        return nil
    }

    static func sides(_ latex: String) -> (left: String, right: String)? {
        let parts = latex.components(separatedBy: "=")
        guard parts.count == 2 else { return nil }
        func norm(_ s: String) -> String { s.replacingOccurrences(of: #"\s+"#, with: "", options: .regularExpression) }
        return (norm(parts[0]), norm(parts[1]))
    }
}

/// Writes a hint's words on the iPad. `HintWording.onDevice()` is Apple Intelligence's; tests pass a
/// fake. Words come back raw: the loop holds them to `HintWording.accept` before a kid sees them.
@MainActor
public protocol HintWriter: AnyObject {
    /// the model is there and can answer
    var isReady: Bool { get }
    /// Loads the model ahead of the first hint (cheap to call again).
    func prewarm()
    /// The words for a hint, or nil (no model, too slow, refused).
    func write(_ facts: HintFacts) async -> String?
}

/// Hint words written on this iPad (Apple Intelligence's on-device model, iPadOS 26+ on Apple
/// Intelligence iPads: M1 and later, and the A17 Pro mini). For the owner to try, behind a debug
/// switch (`debugEnabled`, the Live Lab); the server's check stays the hint's source otherwise, and
/// the fallback whenever the iPad cannot write words that pass `accept`.
///
/// Where it fits, and only there: a step the ENGINE has already found wrong (a ring), when the kid
/// taps Help me in Hint. The engine decided what is wrong; the model only words where to look, so
/// the server's check (≈2 s to its first words, 3 ink) is not needed for it. The model never
/// decides whether maths is right, and words that carry a number the kid did not write (the answer,
/// or arithmetic of its own) are thrown away.
public enum HintWording {
    /// The debug switch (UserDefaults, this iPad): off unless the owner turns it on in the Live Lab.
    public static let debugKey = "agathon.debug.onDeviceHints"

    public static var debugEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: debugKey) }
        set { UserDefaults.standard.set(newValue, forKey: debugKey) }
    }

    /// The longest the loop waits for the iPad's words before asking the server instead (ms).
    public static let timeoutMs = 1_500.0

    /// Apple Intelligence's writer, when this iPad has it switched on and ready; nil otherwise
    /// (older iPadOS, an iPad without Apple Intelligence, turned off, the model still downloading).
    @MainActor
    public static func onDevice() -> HintWriter? {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, macOS 26.0, *) {
            let writer = OnDeviceHintWriter()
            return writer.isReady ? writer : nil
        }
        #endif
        return nil
    }

    /// Why Apple Intelligence cannot write here, in words for the Lab (nil: it can).
    @MainActor
    public static var unavailableReason: String? {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, macOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available: return nil
            case .unavailable(let why): return "Apple Intelligence: \(why)"
            }
        }
        return "Apple Intelligence needs iPadOS 26 or later."
        #else
        return "This build has no Foundation Models."
        #endif
    }

    /// What the model is told (the same rules as the server's check prompt, for a small model).
    static let instructions = """
    You write one hint for a child, aged 5 to 13, who made a slip in a maths step. A checker has already found the slip; \
    you only say where to look. Write ONE short sentence of at most 16 words, speaking to the child as "you". \
    Name where to look (which side, which number or sign) and nudge them to check it; never name a line or a step by its number. \
    Never give the correct answer or a corrected number, and never do arithmetic yourself. \
    Never say "wrong" or "incorrect". No exclamation marks, no emojis, no quotes. Reply with the sentence only.
    """

    /// The question put to the model for these facts.
    static func prompt(_ facts: HintFacts) -> String {
        var lines: [String] = []
        if let p = facts.previous { lines.append("The step before: \(MathText.plain(p))") }
        lines.append("The child's step: \(MathText.plain(facts.line))")
        if let side = facts.side { lines.append("The slip is on the \(side) side of the child's step.") }
        if !facts.note.isEmpty { lines.append("The checker's note: \(facts.note)") }
        lines.append("Write the hint.")
        return lines.joined(separator: "\n")
    }

    /// The words, made safe for a kid, or nil to fall back to the server: one sentence of 3–22
    /// words, never "wrong", no number the kid did not write (so never the answer), no LaTeX or
    /// talk of being an AI. Exclamation marks become full stops.
    public static func accept(_ raw: String?, facts: HintFacts) -> String? {
        guard var s = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
        s = s.trimmingCharacters(in: CharacterSet(charactersIn: "\"“”'‘’ "))
        s = s.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        s = s.replacingOccurrences(of: "!", with: ".")
        // pointed with the ink ("line 4" → "this line") before its numbers are held to the kid's
        s = LiveCopy.Hint.pointing(s)
        let words = s.split(separator: " ")
        guard (3...22).contains(words.count) else { return nil }
        let lower = s.lowercased()
        for banned in ["wrong", "incorrect", "latex", " ai ", "as an ai", "language model", "\\", "$"] where lower.contains(banned) { return nil }
        guard s.unicodeScalars.allSatisfy({ $0.isASCII || "’‘“”–—…".unicodeScalars.contains($0) }) else { return nil }
        let mine = numbers(in: [facts.previous ?? "", facts.line].joined(separator: " "))
        guard numbers(in: s).isSubset(of: mine) else { return nil }
        if !s.hasSuffix(".") && !s.hasSuffix("?") { s += "." }
        return s
    }

    /// The numbers written in a text (`12`, `0.5`; a minus sign is not part of one).
    static func numbers(in s: String) -> Set<String> {
        let ns = s as NSString
        guard let re = try? NSRegularExpression(pattern: #"\d+(?:\.\d+)?"#) else { return [] }
        return Set(re.matches(in: s, range: NSRange(location: 0, length: ns.length)).map { ns.substring(with: $0.range) })
    }
}

#if canImport(FoundationModels)
/// Apple Intelligence's on-device model as a `HintWriter`: one session per hint (each hint stands
/// alone), the next one made and prewarmed ahead, greedy and short.
@available(iOS 26.0, macOS 26.0, *)
@MainActor
final class OnDeviceHintWriter: HintWriter {
    private var next: LanguageModelSession?

    var isReady: Bool {
        if case .available = SystemLanguageModel.default.availability { return true }
        return false
    }

    func prewarm() {
        guard isReady, next == nil else { return }
        let session = LanguageModelSession(model: .default, instructions: HintWording.instructions)
        session.prewarm()
        next = session
    }

    func write(_ facts: HintFacts) async -> String? {
        guard isReady else { return nil }
        let session = next ?? LanguageModelSession(model: .default, instructions: HintWording.instructions)
        next = nil
        defer { prewarm() }
        let prompt = HintWording.prompt(facts)
        let options = GenerationOptions(sampling: .greedy, maximumResponseTokens: 48)
        do {
            return try await Self.within(HintWording.timeoutMs) {
                try await session.respond(to: prompt, options: options).content
            }
        } catch {
            return nil
        }
    }

    /// `body`, or nil after `ms`.
    static func within(_ ms: Double, _ body: @escaping @Sendable () async throws -> String) async throws -> String? {
        try await withThrowingTaskGroup(of: String?.self) { group in
            group.addTask { try await body() }
            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(ms * 1_000_000))
                return nil
            }
            defer { group.cancelAll() }
            return try await group.next() ?? nil
        }
    }
}
#endif
