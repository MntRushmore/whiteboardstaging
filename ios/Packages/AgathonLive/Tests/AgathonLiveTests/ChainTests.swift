import AgathonBoard
import AgathonBrain
import Foundation
import Testing
@testable import AgathonLive

/// The two guards before a ring (`LiveLoop+Chain`): a line crossed out is never judged, and a step
/// about to be ringed is read again first, with the line above it.
@MainActor
@Suite(.serialized)
struct ChainTests {
    // MARK: - crossed out

    /// `10 × 7 = 17` as a row of small strokes (glyphs), 40 high, from x 0 to 300
    static func row(_ n: Int = 7) -> [BrainStroke] {
        (0..<n).map { k in
            let x = Double(k) * 44 + 10
            return BrainStroke(id: "g\(k)", x: [x, x + 6, x + 12], y: [100, 120, 140])
        }
    }

    static func flat(_ id: String, from x0: Double, to x1: Double, y: Double, tilt: Double = 6) -> BrainStroke {
        let xs = stride(from: x0, through: x1, by: 4).map { $0 }
        let ys = xs.map { y + tilt * ($0 - x0) / (x1 - x0) - tilt / 2 }
        return BrainStroke(id: id, x: xs, y: ys)
    }

    @Test func aStrokeThroughTheWritingStrikesItOut() {
        #expect(StruckLine.strike(in: Self.row() + [Self.flat("s", from: 0, to: 310, y: 120)]) == "s")
    }

    @Test func aBarAnUnderlineOrAMinusStrikesNothing() {
        // a fraction bar: writing above it and under it, nothing through it
        let top = (0..<3).map { k in BrainStroke(id: "t\(k)", x: [Double(k) * 40 + 10, Double(k) * 40 + 20], y: [40, 80]) }
        let bottom = (0..<3).map { k in BrainStroke(id: "b\(k)", x: [Double(k) * 40 + 10, Double(k) * 40 + 20], y: [110, 150]) }
        #expect(StruckLine.strike(in: top + bottom + [Self.flat("bar", from: 0, to: 130, y: 95)]) == nil)
        // an underline
        #expect(StruckLine.strike(in: Self.row() + [Self.flat("u", from: 0, to: 310, y: 150)]) == nil)
        // a minus: short
        #expect(StruckLine.strike(in: Self.row() + [Self.flat("m", from: 100, to: 130, y: 120)]) == nil)
        // a scribble is no straight stroke
        let zig = BrainStroke(id: "z", x: [0, 60, 0, 60, 0, 300], y: [110, 130, 110, 130, 110, 120])
        #expect(StruckLine.strike(in: Self.row() + [zig]) == nil)
    }

    @Test func aReadThatSaysStruckIsStruck() {
        #expect(StruckLine.readStruck("\\sout{10 \\times 7=17}"))
        #expect(StruckLine.readStruck("\\cancel{x=5}"))
        #expect(!StruckLine.readStruck("\\cancel{x} + 5 = 7"))
        #expect(!StruckLine.readStruck("x = 5"))
    }

    @Test(arguments: [TrainingHand.clean, .slanted, .steep, .messy, .big, .small])
    func aCrossedOutLineIsNotRinged(_ hand: TrainingHand) async throws {
        let r = try await BenchFixesTests.run("rw-strike-ok", hand: hand)
        #expect(r.lines.first?.mark != .ring, "\(hand.name): \(BenchFixesTests.describe(r))")
        #expect(r.pass == true, "\(hand.name): \(BenchFixesTests.describe(r))")
    }

    // MARK: - the second look before a ring

    @Test func readDistanceCountsChangedCharacters() {
        #expect(ReadCheck.distance("x = 5", "x=5") == 0)
        #expect(ReadCheck.distance("x = 5", "x = 4") == 1)
        #expect(ReadCheck.distance("12 + 7 = 19", "17 + 7 = 19") == 1)
        #expect(ReadCheck.distance("", "ab") == 2)
    }

    @Test func aFractionReadWithoutItsTopIsNotBelieved() {
        #expect(ReadCheck.suspicious("\\bar{2}=\\bar{6}", others: []) == "lost-numerator")
        #expect(ReadCheck.suspicious("\\overline{2}=\\frac{}{6}", others: []) == "lost-numerator")
        #expect(ReadCheck.suspicious("0.\\overline{3}=\\frac{1}{3}", others: []) == nil)
        #expect(ReadCheck.suspicious("0.1\\overline{6}", others: []) == nil)
        // the second reader's `\bar{2}=\bar{6}` for Mathpix's `\overline{2}=\frac{}{6}` is not taken
        #expect(ReadCheck.candidate(mathpix: "\\overline{2}=\\frac{}{6}", reread: "\\bar{2}=\\bar{6}", others: []) == nil)
    }

    func slip(_ h: Harness) async {
        await h.write("2x + 3 = 11", at: Vec2(200, 120))
        await h.pass(700)
        await h.write("2x = 8", at: Vec2(200, 220))
        await h.pass(700)
        await h.write("x = 5", at: Vec2(200, 320))
        await h.pass(700)
    }

    @Test func aRingWaitsForASecondLookThatCanTakeItBack() async throws {
        let h = Harness(mode: .feedback)
        // the second reader sees the kid's `4` that Mathpix read as a `5`
        h.services.rereadReplies["x = 5"] = RereadResponse(latex: "x = 4", changed: true, model: "fake", ms: 1)
        await h.start()
        await slip(h)
        #expect(!h.services.rereadRequests.isEmpty, "the step and the line above were read again")
        #expect(h.services.rereadRequests.allSatisfy { $0.above.isEmpty && $0.below.isEmpty }, "without the column")
        #expect(h.board.mark(on: "x = 4") == .tick)
    }

    @Test func aSecondLookThatLeavesTheStepWrongLeavesTheRing() async throws {
        let h = Harness(mode: .feedback)
        h.services.rereadReplies["x = 5"] = RereadResponse(latex: "x = 6", changed: true, model: "fake", ms: 1)
        await h.start()
        await slip(h)
        #expect(h.board.mark(on: "x = 5") == .ring)
        // once per pair of inks: the ring is not held again
        let asked = h.services.rereadRequests.count
        await h.pass(3_000)
        #expect(h.services.rereadRequests.count == asked)
    }
}
