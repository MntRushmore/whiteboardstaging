import Foundation

/// Help me's ink hint ladder on an SAT page (docs/SAT-V2.md): each tap climbs one rung.
///
///  1. **Nudge:** the bank's `nudge`, a small note near the work. Free; no tutor pass needed. A
///     question with no nudge starts at rung 2.
///  2. **One step:** ONE next step in the tutor's ink under the student's last line, then "Your turn:
///     the next line." With the day's pass the live tutor writes it (the existing Help me); capped,
///     offline or with nothing of the student's read, the bank's next step (`nextBankStep`).
///  3. **Walk me through it:** the bank's steps one by one in the tutor's ink, a tap between them.
///     Free; works capped.
public struct SATHintLadder: Hashable, Sendable {
    public enum Rung: Int, Hashable, Sendable, Comparable {
        case nudge = 1
        case step = 2
        case walkthrough = 3

        public static func < (a: Rung, b: Rung) -> Bool { a.rawValue < b.rawValue }
    }

    /// the highest rung shown so far
    public var reached: Rung?
    /// the bank's steps the tutor has written on the page (rung 2's fallback, the walkthrough)
    public var written: Set<Int> = []
    /// the walkthrough: the steps drawn so far (nil: not walking)
    public var walked: Int?

    public init() {}

    /// The rung the next Help me shows.
    public func next(hasNudge: Bool) -> Rung {
        switch reached {
        case nil: return hasNudge ? .nudge : .step
        case .nudge: return .step
        case .step, .walkthrough: return .walkthrough
        }
    }

    /// Climbs to `rung` (never down).
    public mutating func reach(_ rung: Rung) {
        if reached.map({ rung > $0 }) ?? true { reached = rung }
    }

    /// The walkthrough's next step, nil once every step is drawn.
    public func nextWalkStep(count: Int) -> Int? {
        let n = walked ?? 0
        return n < count ? n : nil
    }

    // MARK: - the walk-through picks up from the work

    /// The steps the walk-through leaves out because they are on the page already: every step up to
    /// the last one the student's lines match, and the ones the tutor wrote at rung 2.
    public static func stepsOnThePage(_ steps: [SATSolution.Step], studentLines: [String], written: Set<Int>) -> Set<Int> {
        let lines = Set(studentLines.map(key).filter { !$0.isEmpty })
        var done = Set<Int>()
        for (i, step) in steps.enumerated() where matches(step, lines) { done.formUnion(0...i) }
        return done.union(written.filter { steps.indices.contains($0) })
    }

    // MARK: - the bank's next step (rung 2 without the live tutor)

    /// The bank step to write next: the first after the last one the student's lines already match,
    /// and not written already. nil when there is none left.
    public static func nextBankStep(_ steps: [SATSolution.Step], studentLines: [String], written: Set<Int>) -> Int? {
        let lines = Set(studentLines.map(key).filter { !$0.isEmpty })
        var start = 0
        for (i, step) in steps.enumerated() where matches(step, lines) { start = i + 1 }
        return (start..<steps.count).first { !written.contains($0) && steps[$0].math?.isEmpty == false }
            ?? (start..<steps.count).first { !written.contains($0) }
    }

    /// A step is matched when any part of its maths (`a \Rightarrow b`: either side) is one of the
    /// student's lines, written the same way.
    static func matches(_ step: SATSolution.Step, _ lines: Set<String>) -> Bool {
        guard let math = step.math, !math.isEmpty else { return false }
        return parts(math).contains { lines.contains(key($0)) }
    }

    static func parts(_ math: String) -> [String] {
        math.components(separatedBy: #"\Rightarrow"#).flatMap { $0.components(separatedBy: #"\implies"#) }
            .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    /// A line of maths as compared: no spaces, no sizing, one way to write times and minus.
    static func key(_ latex: String) -> String {
        var s = latex
        for (a, b) in [(#"\left"#, ""), (#"\right"#, ""), (#"\cdot"#, "*"), (#"\times"#, "*"), ("−", "-"), (#"\,"#, ""), (#"\ "#, ""), ("{", ""), ("}", ""), ("$", "")] {
            s = s.replacingOccurrences(of: a, with: b)
        }
        return s.filter { !$0.isWhitespace }.lowercased()
    }
}
