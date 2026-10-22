import AgathonBoard
import AgathonBrain
import Foundation
import Testing
@testable import AgathonLive

/// The kid sessions' pieces (docs/KID-SESSIONS.md): the mess on a line (seeded, the line still a line),
/// the scribbles and the small digits of a stacked sum, the pen's pace and pressure, and the twelve
/// sessions (every line writable, every grade and kind of work the owner asked for).
@MainActor
@Suite(.serialized)
struct KidSessionTests {
    let line: [[Vec2]] = [[Vec2(0, 0), Vec2(0, 60)], [Vec2(30, 0), Vec2(70, 0), Vec2(70, 60)], [Vec2(100, 30), Vec2(160, 30)]]

    @Test func theMessIsSeededAndKeepsTheLineALine() {
        var a = SplitMix(seed: 7), b = SplitMix(seed: 7)
        let one = KidMess.lots.apply(line, line: 3, rng: &a)
        let two = KidMess.lots.apply(line, line: 3, rng: &b)
        #expect(one == two)
        let pts = one.flatMap { $0 }
        #expect(pts.map(\.x).min()! == 0 && pts.map(\.y).min()! == 0)
        // bigger by the growth (3 lines × 4%), give or take the jitter; still wider than tall
        let w = pts.map(\.x).max()!, h = pts.map(\.y).max()!
        #expect(w > 150 && w < 200 && w > h)
        #expect(KidMess.tidy.apply(line, line: 5, rng: &a).flatMap { $0 }.count == line.flatMap { $0 }.count)
    }

    @Test func linesStepRightDownThePage() {
        var rng = SplitMix(seed: 3)
        let m = KidMess(wander: 40, jitter: 0, gap: 20)
        let xs = (0..<4).map { m.offset(line: $0, rng: &rng).dx }
        #expect(xs == [0, 40, 80, 120])
        #expect(m.offset(line: 0, rng: &rng).gap == 20)
    }

    @Test func aScribbleCoversTheLineAndAStrikeGoesThroughIt() {
        var rng = SplitMix(seed: 1)
        let box = Box(x: 100, y: 200, w: 300, h: 60)
        let zig = KidMarks.scribble(over: box, rng: &rng)
        #expect(zig.count >= 7)
        let zb = Box.around(zig)!
        #expect(zb.x < box.x && zb.maxX > box.maxX && zb.h > box.h * 0.6)
        let s = KidMarks.strike(through: box)
        #expect(s[0].x < box.x && s[1].x > box.maxX && abs(s[0].y - box.y - 30) < 6)
    }

    @Test func aStackedSumsTopDigitsAndItsAnswerRow() {
        // "47" over "+38", a bar, "85": digits 0–40 and 60–100 on the top row
        let ink: [[Vec2]] = [
            [Vec2(0, 0), Vec2(30, 40)], [Vec2(10, 0), Vec2(10, 40)],        // 4 (two strokes, overlapping)
            [Vec2(60, 0), Vec2(100, 0), Vec2(70, 40)],                       // 7
            [Vec2(-30, 70), Vec2(-10, 70)], [Vec2(0, 50), Vec2(40, 90)], [Vec2(60, 50), Vec2(100, 90)], // +38
            [Vec2(-34, 104), Vec2(104, 104)],                                // the bar
            [Vec2(0, 120), Vec2(40, 160)], [Vec2(60, 120), Vec2(100, 160)],  // 85
        ]
        let digits = KidMarks.topRowDigits(ink)
        #expect(digits.count == 2)
        // right to left: the ones first
        #expect(digits[0].x >= 59 && digits[1].x <= 1)
        let split = KidMarks.splitAtAnswer(ink)
        #expect(split.answer.count == 2 && split.rows.count == 7)
    }

    @Test func thePenSlowsAtItsEndsAndPressesIn() {
        var rng = SplitMix(seed: 9)
        let p = KidPen.profile(count: 41, rng: &rng)
        #expect(p.times.first == 0 && p.times.last == 1)
        #expect(zip(p.times, p.times.dropFirst()).allSatisfy { $0 <= $1 })
        // the first and last tenth take longer than a tenth of the middle's pace
        let start = p.times[4] - p.times[0], middle = p.times[22] - p.times[18]
        #expect(start < middle)
        #expect(p.pressures[0] < p.pressures[20] && p.pressures.allSatisfy { $0 > 0 && $0 <= 1 })
        for _ in 0..<50 { let t = KidPen.tempo(&rng); #expect(t >= 0.75 && t <= 1.35) }
    }

    @Test func theTwelveSessionsCoverWhatTheOwnerAskedFor() {
        let all = KidSessions.all
        #expect(all.count == 12)
        #expect(Set(all.map(\.id)).count == 12)
        #expect(Set(all.map(\.grade)).isSuperset(of: [2, 3, 4, 5, 6, 7, 8]))
        func has(_ test: (KidStep) -> Bool) -> Bool { all.contains { $0.steps.contains(where: test) } }
        #expect(has { if case .stacked(_, let m, _) = $0 { m.contains(.above(1, "1")) } else { false } })     // a carry
        #expect(has { if case .stacked(_, let m, _) = $0 { m.contains(.cross(1)) } else { false } })          // a borrow
        #expect(has { if case .scratchOut = $0 { true } else { false } })
        #expect(has { if case .erase = $0 { true } else { false } })
        #expect(has { if case .pause(let s) = $0 { s >= 20 } else { false } })
        #expect(has { if case .line(_, .side) = $0 { true } else { false } })
        #expect(has { if case .line(_, .column2) = $0 { true } else { false } })
        #expect(has { if case .line(_, .nearBottom) = $0 { true } else { false } })
        #expect(has { if case .tap(.newPage) = $0 { true } else { false } })
        #expect(has { if case .tap(.keepHere) = $0 { true } else { false } })
        #expect(has { if case .tap(.nowYouTry) = $0 { true } else { false } })
        // a slip in some, and every slip says what it should have been
        let slips = all.flatMap(KidSessions.lines).filter { $0.expect == .ring }
        #expect(slips.count >= 2 && slips.allSatisfy { $0.value != nil })
        #expect(all.map(\.budget).reduce(0, +) <= 250)
    }

    /// Found by s01 (2026-10-22): "I read" beside a stacked sum showed "beginarrayr 47 \\ +38 \\ hline 85 endarray".
    @Test func aStackedSumReadsAsOneLine() {
        #expect(MathText.plain("\\begin{array}{r}\n47 \\\\\n+38 \\\\\n\\hline 85\n\\end{array}") == "47 + 38 = 85")
        #expect(MathText.plain("\\begin{array}{r} 52 \\\\ -17 \\\\ \\hline 35 \\end{array}") == "52 - 17 = 35")
        #expect(MathText.plain("\\begin{array}{r} 46 \\\\ \\times 23 \\\\ \\hline 138 \\\\ 920 \\\\ \\hline 1058 \\end{array}")
                == "46 × 23 = 138 + 920 = 1058")
        #expect(MathText.plain("\\begin{array}{r} 16 \\\\ 9 )\\overline{144} \\end{array}") == "144 ÷ 9 = 16")
        #expect(MathText.plain("\\frac{3}{4} + 1") == "3/4 + 1")
    }

    @Test func everySessionLineIsOneTheHandCanWrite() async throws {
        try await TestBrain.shared.load()
        for s in KidSessions.all {
            for l in KidSessions.lines(s) {
                let ink = try await StudentHand.ink(l.latex, hand: s.hand, brain: TestBrain.shared)
                #expect(ink?.isEmpty == false, "\(s.id): the hand can't write \(l.latex)")
            }
            for d in ["1", "4"] {
                #expect(try await StudentHand.ink(d, hand: s.hand, brain: TestBrain.shared)?.isEmpty == false)
            }
        }
    }
}

/// Hints point with the ink, never "line 4" (the kid sessions, 2026-10-22): every place a hint's words
/// come from — the server's check, the iPad's own model, the loop's own templates — reaches the card
/// through `LiveCopy.Hint.pointing` (in `openHint`), and the on-device words through `HintWording.accept`.
@MainActor
struct HintPointingTests {
    @Test(arguments: [
        ("Look again at the right side of line 3", "Look again at the right side of this line"),
        ("Check the addition on the right side of line 4.", "Check the addition on the right side of this line."),
        ("Check the sign of your result on the right side of line 3", "Check the sign of your result on the right side of this line"),
        ("Line 2: what is 9 + 7?", "This line: what is 9 + 7?"),
        ("Look at line 2: what is 9 + 7?", "Look at this line: what is 9 + 7?"),
        ("Compare lines 2 and 3.", "Compare these lines."),
        ("Lines 1-2 are fine. Check line #3.", "These lines are fine. Check this line."),
        ("Step 2 drops the minus sign.", "This step drops the minus sign."),
        ("Look again at the second line", "Look again at this line"),
        ("The last line needs another look.", "This line needs another look."),
    ])
    func aHintNeverCountsLines(input: String, want: String) {
        #expect(LiveCopy.Hint.pointing(input) == want)
    }

    @Test func mathsAndPlainWordsStay() {
        for s in ["What is 8 divided by 2?", "Write the next step 2x = 8", "Check the line with 34 × 6", "Your steps so far look right.",
                  "Underline the 3", LiveCopy.Hint.lookAgain, LiveCopy.Hint.unread] {
            #expect(LiveCopy.Hint.pointing(s) == s)
        }
    }

    @Test func theLoopsOwnWordsNeverCount() {
        let own = [LiveCopy.Hint.lookAgain, LiveCopy.Hint.unread, "Your steps so far look right.", "What could you do next?"]
            + LiveCopy.Cheers.wins + LiveCopy.Cheers.misses + [HintWording.instructions]
        for s in own { #expect(s.range(of: #"\b(?:line|step)s?\s*#?\d"#, options: [.regularExpression, .caseInsensitive]) == nil, "\(s)") }
        #expect(HintWording.instructions.contains("never name a line or a step by its number"))
    }

    @Test func theIPadsOwnModelsWordsArePointedNotRefused() {
        let facts = HintFacts(previous: "4 \\times 6 = 24", line: "180 + 24 = 214", expected: "180 + 24 = 204")
        // "line 4" was a number not in the kid's work: refused before; now pointed, and kept
        #expect(HintWording.accept("Check the addition on the right side of line 4", facts: facts) == "Check the addition on the right side of this line.")
    }
}
