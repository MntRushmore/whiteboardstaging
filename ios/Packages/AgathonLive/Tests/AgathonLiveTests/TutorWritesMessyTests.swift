import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation
import Testing
@testable import AgathonLive

/// The messy-handwriting guard's slice (docs/TUTOR-WRITES.md): the tutor-writes scenarios in messy
/// synthetic hands (shaky, huge, tiny, jaggy, the scoreboard's messy, and clean), each read right and
/// deliberately misread (one digit swapped, read with no doubt). A kid who answers each readback
/// truthfully (Yes when it is what they wrote, Fix it with what they wrote when not) asks up to four
/// times. Whatever the tutor writes must be right for the TRUE problem. Prints `MESSY` lines: how
/// often the first answer to an ask was a step, a readback, or words.
@MainActor
@Suite(.serialized)
struct TutorWritesMessyTests {
    static let hands: [TrainingHand] = [
        .clean, .messy,
        TrainingHand(name: "shaky", seed: 41, slant: 0.05, sx: 1, sy: 1, rotateDeg: 0, jitter: 0.09, sizeDrift: 0.1, wander: 0.15, scale: 1.6),
        TrainingHand(name: "huge", seed: 43, slant: 0.04, sx: 1.05, sy: 1, rotateDeg: 0.5, jitter: 0.04, sizeDrift: 0.15, wander: 0.08, scale: 2.8),
        TrainingHand(name: "tiny", seed: 47, slant: 0.03, sx: 0.95, sy: 1, rotateDeg: -0.5, jitter: 0.02, sizeDrift: 0, wander: 0, scale: 0.9),
        TrainingHand(name: "jaggy", seed: 53, slant: 0.3, sx: 0.92, sy: 1.08, rotateDeg: -6, jitter: 0.07, sizeDrift: 0.25, wander: 0.1, scale: 1.5),
    ]

    /// A scenario: the tutor's problem (if any), the kid's lines as written, and as misread.
    struct Case {
        var name: String
        var problem: [String]?
        var written: [String]
        var misread: [String]
        /// a stacked sum's rows (its `written` / `misread` are the rows)
        var stack = false
    }

    static let cases: [Case] = [
        Case(name: "equation-free", problem: nil, written: ["2x + 3 = 11"], misread: ["2x + 3 = 17"]),
        Case(name: "equation-page", problem: ["5x + 2 = 17"], written: ["5x = 15"], misread: ["5x = 13"]),
        Case(name: "fractions-free", problem: nil, written: ["\\frac{1}{2} + \\frac{1}{3} ="], misread: ["\\frac{1}{2} + \\frac{1}{5} ="]),
        Case(name: "column-free", problem: nil, written: ["286", "+680"], misread: ["236", "+680"], stack: true),
        Case(name: "column-page", problem: ["286 + 680"], written: ["286", "+680"], misread: ["286", "+630"], stack: true),
        Case(name: "long-free", problem: nil, written: ["46", "\\times 23"], misread: ["46", "\\times 28"], stack: true),
    ]

    enum First: String { case step, readback, held, words }

    struct Tally {
        var first: [First: Int] = [:]
        var wrote = 0
        var wrong: [String] = []
        var runs = 0
    }

    static func array(_ rows: [String]) -> String { "\\begin{array}{r} \(rows.joined(separator: " \\\\ ")) \\\\ \\hline \\end{array}" }

    @Test func theTutorNeverWritesAStepWrongForTheTrueProblem() async throws {
        try await TestBrain.shared.load()
        var byRead: [String: Tally] = ["true": Tally(), "misread": Tally()]
        for c in Self.cases {
            for hand in Self.hands {
                for misread in [false, true] {
                    let (first, wrote, wrong) = try await run(c, hand: hand, misread: misread)
                    print("MESSYCASE \(c.name) \(hand.name) \(misread ? "misread" : "true") first=\(first.rawValue) wrote=\(wrote) wrong=\(wrong.count)")
                    var t = byRead[misread ? "misread" : "true"]!
                    t.runs += 1
                    t.first[first, default: 0] += 1
                    t.wrote += wrote
                    t.wrong += wrong.map { "\(c.name)/\(hand.name)/\(misread ? "misread" : "true"): \($0)" }
                    byRead[misread ? "misread" : "true"] = t
                }
            }
        }
        for (k, t) in byRead.sorted(by: { $0.key < $1.key }) {
            print("MESSY \(k): runs \(t.runs) | first answer: step \(t.first[.step] ?? 0), readback \(t.first[.readback] ?? 0), last step held \(t.first[.held] ?? 0), words only \(t.first[.words] ?? 0) | steps written \(t.wrote) | wrong for the true problem \(t.wrong.count)")
        }
        let wrong = byRead.values.flatMap(\.wrong)
        #expect(wrong.isEmpty, "\(wrong)")
    }

    /// One scenario in one hand: the first answer to Help me, the steps written in all, and those wrong.
    func run(_ c: Case, hand: TrainingHand, misread: Bool) async throws -> (First, Int, [String]) {
        let h = Harness(mode: .suggest)
        await h.start()
        if let problem = c.problem {
            ChatProblemTests().tutorProblem(h, box: Box(x: 300, y: 30, w: 220, h: 50),
                                            meta: ChatProblemTests.chatMeta(problem, cell: Box(x: 180, y: 10, w: 1000, h: 800)))
            h.loop.problemsChanged()
        }
        // the kid's work in the hand
        var ids: [RecordID] = []
        if c.stack {
            let latex = "\\begin{array}{r} \(c.written.joined(separator: " \\\\ ")) \\end{array}"
            guard let ink = try await StudentHand.ink(latex, hand: hand, brain: TestBrain.shared) else { return (.words, 0, []) }
            let placed = ink.map { s in s.map { Vec2(320 + $0.x, 130 + $0.y) } }
            let pts = placed.flatMap { $0 }
            let x0 = (pts.map(\.x).min() ?? 0) - 14, x1 = (pts.map(\.x).max() ?? 0) + 10, y = (pts.map(\.y).max() ?? 0) + 12
            ids = h.board.kidWrites(placed + [stride(from: x0, through: x1, by: 4).map { Vec2($0, y + ($0 - x0) * 0.01) }])
            await h.register(ids, reads: Self.array(misread ? c.misread : c.written))
        } else {
            var y = 140.0
            for (k, line) in c.written.enumerated() {
                guard let ink = try await StudentHand.ink(line, hand: hand, brain: TestBrain.shared) else { return (.words, 0, []) }
                let placed = ink.map { s in s.map { Vec2(260 + $0.x, y + $0.y) } }
                let made = h.board.kidWrites(placed)
                await h.register(made, reads: misread ? c.misread[k] : line)
                ids += made
                y = (placed.flatMap { $0 }.map(\.y).max() ?? y) + 60
            }
        }
        await h.pass(3_500)
        // the kid asks, and answers each readback truthfully
        var first: First?
        for _ in 0..<4 {
            let stepInk = { h.board.tutorStrokes.filter { $0.meta["tutorStep"] != nil }.count }
            let before = stepInk()
            h.loop.showNextStep()
            await h.pass(600)
            h.board.finishWrites()
            let card = h.loop.hints.first
            let wroteNow = stepInk() > before
            if first == nil {
                first = wroteNow ? .step : card?.action == .readback ? .readback : card?.title == LiveCopy.Writes.lastStepTitle ? .held : .words
            }
            guard let card, card.action == .readback, let line = h.loop.lines[card.lineId] else {
                if card?.action == .next { continue }
                break
            }
            let truth = truthLatex(c, line: line)
            if let truth, Self.flat(truth) != Self.flat(line.latex) {
                h.loop.cardFirstButton(card)
                h.loop.useReading(card.lineId, latex: truth)
            } else {
                h.loop.moreHelp(card)
            }
            await h.pass(600)
            h.board.finishWrites()
        }
        let (n, wrong) = try await judge(h, c)
        return (first ?? .words, n, wrong)
    }

    static func flat(_ s: String) -> String { s.replacingOccurrences(of: " ", with: "") }

    /// What the kid really wrote on this line (by where its read came from).
    func truthLatex(_ c: Case, line: LiveLine) -> String? {
        if c.stack { return Self.array(c.written) }
        if let i = c.misread.firstIndex(where: { Self.flat($0) == Self.flat(line.latex) }) { return c.written[i] }
        if let i = c.written.firstIndex(where: { Self.flat($0) == Self.flat(line.latex) }) { return c.written[i] }
        return nil
    }

    /// Every step the tutor wrote, held to the TRUE problem.
    func judge(_ h: Harness, _ c: Case) async throws -> (Int, [String]) {
        var wrong: [String] = []
        var steps: [String: String] = [:]
        var parts: [String: String] = [:]
        for s in h.board.tutorStrokes {
            if let part = s.meta["stackPart"]?.stringValue, let digit = s.meta["tutorStep"]?.stringValue { parts[part] = digit }
            else if let id = s.meta["tutorStepId"]?.stringValue, let latex = s.meta["tutorStep"]?.stringValue { steps[id] = latex }
        }
        if c.stack {
            let nums = c.written.map { Int($0.filter(\.isNumber)) ?? 0 }
            let isProduct = c.written[1].contains("times")
            let result = isProduct ? nums[0] * nums[1] : nums[0] + nums[1]
            let digits = String(result).reversed().map { Int(String($0))! }
            for (part, digit) in parts where part != "rule" {
                let kind = part.first!
                let rest = String(part.dropFirst())
                if kind == "a" || kind == "s" || kind == "f", let p = Int(rest), p < digits.count, String(digits[p]) != digit { wrong.append("\(part)=\(digit), want \(digits[p])") }
                if kind == "r" {
                    // a long multiplication row: r{k}.{place} (and r{k}, its leftmost digit)
                    let bits = rest.split(separator: ".").compactMap { Int($0) }
                    let k = bits.first ?? 0
                    let bottom = String(nums[1]).reversed().map { Int(String($0))! }
                    let nonzero = bottom.enumerated().filter { $0.element != 0 }
                    guard k < nonzero.count else { wrong.append("row \(k) is too many"); continue }
                    let row = String(nums[0] * nonzero[k].element * Int(pow(10, Double(nonzero[k].offset)))).reversed().map { String($0) }
                    let place = bits.count > 1 ? bits[1] : row.count - 1
                    if place >= row.count || row[place] != digit { wrong.append("\(part)=\(digit)") }
                }
            }
            return (parts.count, wrong)
        }
        let start = c.problem?.first ?? c.written[0]
        for step in steps.values {
            let s = step.trimmingCharacters(in: .whitespaces)
            let isRelation = s.contains("=") && !s.hasPrefix("=")
            let from = isRelation ? start : start.replacingOccurrences(of: #"=\s*$"#, with: "", options: .regularExpression)
            let check = try await TestBrain.shared.checkStep(from: from, step: isRelation ? s : (s.hasPrefix("=") ? s : "= \(s)"))
            if !check.ok && check.why != "already written" && check.why != "no change" { wrong.append("\(s) (\(check.why))") }
        }
        return (steps.count, wrong)
    }
}
