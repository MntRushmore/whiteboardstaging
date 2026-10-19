#if DEBUG
import Foundation

/// Sixteen slips a kid makes (the last line of each is the slip the engine rings), with the
/// server's hint for each as `/api/live/check` worded it on 2026-10-18 (gemini-3.5-flash, Hint mode,
/// Help me; local dev server, so no Vercel round trip in `serverMs`). The Live Lab's "Hint words"
/// runs Apple Intelligence over the same slips on the owner's iPad and shows both side by side,
/// with the time each took and whether the iPad's words pass `HintWording.accept`.
public enum HintCorpus {
    public struct Case: Sendable, Identifiable {
        public var id: Int
        /// the kid's lines; the last is the slip
        public var lines: [String]
        /// the step the engine says should have come
        public var expected: String?
        /// the server's words, and the ms to them (request → first annotation)
        public var server: String
        public var serverMs: Double

        public var facts: HintFacts {
            HintFacts(previous: lines.count > 1 ? lines[lines.count - 2] : nil, line: lines[lines.count - 1], expected: expected)
        }
    }

    public static let cases: [Case] = [
        Case(id: 1, lines: ["2x + 3 = 11", "2x = 8", "x = 5"], expected: "x = 4",
             server: "Check your division on the right side of line 3", serverMs: 1866),
        Case(id: 2, lines: ["3x - 5 = 10", "3x = 5"], expected: "3x = 15",
             server: "Look at how you moved the constant to the right side in line 2", serverMs: 1185),
        Case(id: 3, lines: ["5x + 2 = 17", "5x = 19"], expected: "5x = 15",
             server: "Look at how you moved the 2 to the right side on line 2.", serverMs: 1305),
        Case(id: 4, lines: ["4(x + 2) = 20", "4x + 2 = 20"], expected: "4x + 8 = 20",
             server: "Look at the left side of line 2 where you distributed the 4", serverMs: 1395),
        Case(id: 5, lines: ["\\frac{x}{3} = 4", "x = 7"], expected: "x = 12",
             server: "Check the operation you used on the right side of line 2", serverMs: 2060),
        Case(id: 6, lines: ["2x + 6 = 14", "2x = 20"], expected: "2x = 8",
             server: "Look at the right side of line 2 after subtracting 6 from both sides.", serverMs: 1235),
        Case(id: 7, lines: ["7x = 42", "x = 7"], expected: "x = 6",
             server: "Check your division on the right side of line 2", serverMs: 1212),
        Case(id: 8, lines: ["x - 9 = 3", "x = -6"], expected: "x = 12",
             server: "Look at the sign of the constant on the right side of line 2", serverMs: 1482),
        Case(id: 9, lines: ["3(x - 1) = 12", "3x - 1 = 12"], expected: "3x - 3 = 12",
             server: "Look at how you distributed the 3 on the left side of line 2", serverMs: 1546),
        Case(id: 10, lines: ["6 + 2x = 18", "2x = 24"], expected: "2x = 12",
             server: "Look at the right side of line 2 after subtracting 6 from both sides", serverMs: 1212),
        Case(id: 11, lines: ["2(x + 3) = 16", "x + 3 = 6"], expected: "2x + 6 = 16",
             server: "Check the right side of line 2 after dividing both sides by 2", serverMs: 1210),
        Case(id: 12, lines: ["10 - 2x = 4", "-2x = 14"], expected: "-2x = -6",
             server: "Look at the right side of line 2 after subtracting 10 from both sides.", serverMs: 1249),
        Case(id: 13, lines: ["x^{2} = 49", "x = 8"], expected: "x = \\pm 7",
             server: "Check your arithmetic on the right side of line 2.", serverMs: 1546),
        Case(id: 14, lines: ["\\frac{x}{2} + 1 = 5", "\\frac{x}{2} = 6"], expected: "x + 2 = 10",
             server: "Look at how you subtracted 1 from both sides on the right side of line 2", serverMs: 1132),
        Case(id: 15, lines: ["9x - 4 = 23", "9x = 19"], expected: "9x = 27",
             server: "Look at how you moved the constant to the right side on line 2", serverMs: 1422),
        Case(id: 16, lines: ["2x + 3 = 11", "2x = 14"], expected: "2x = 8",
             server: "Look at the right side of line 2 after subtracting 3 from both sides.", serverMs: 1301),
    ]
}
#endif

#if DEBUG
import QuartzCore

extension HintCorpus {
    /// One slip's result: the iPad's words (raw, and as the rules let them through) and their time.
    public struct Row: Sendable, Identifiable {
        public var id: Int { item.id }
        public var item: Case
        public var raw: String?
        public var accepted: String?
        public var ms: Double
    }

    /// Every slip through `writer`, one at a time (the first after a prewarm, as the loop does).
    @MainActor
    public static func run(_ writer: HintWriter, onRow: (Row) -> Void = { _ in }) async -> [Row] {
        writer.prewarm()
        var rows: [Row] = []
        for item in cases {
            let t0 = CACurrentMediaTime()
            let raw = await writer.write(item.facts)
            let row = Row(item: item, raw: raw, accepted: HintWording.accept(raw, facts: item.facts), ms: (CACurrentMediaTime() - t0) * 1_000)
            rows.append(row)
            onRow(row)
        }
        return rows
    }

    /// "n/16 passed the rules · iPad p50 … ms · server p50 … ms".
    public static func summary(_ rows: [Row]) -> String {
        func p50(_ xs: [Double]) -> String { LiveMetrics.median(xs).map { String(format: "%.0f ms", $0) } ?? "–" }
        let passed = rows.filter { $0.accepted != nil }.count
        return "\(passed)/\(rows.count) passed the rules · iPad p50 \(p50(rows.map(\.ms))) · server p50 \(p50(rows.map(\.item.serverMs)))"
    }
}
#endif
