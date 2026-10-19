import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation
import Testing
@testable import AgathonLive

/// Problems the tutor wrote outside the loop head the columns under them (`LiveLoop+Problems`):
/// Ask's `write_problems` (practice, "more like these": `meta.chatProblem`) and the onboarding's first
/// board (`problem: true` with each line's LaTeX). The kid's work under one is judged against it.
@MainActor
@Suite(.serialized)
struct ChatProblemTests {
    /// A problem in the tutor's strokes, its ink in `box` (a few strokes across it), with `meta`.
    @discardableResult
    func tutorProblem(_ h: Harness, box: Box, meta: Meta) -> [RecordID] {
        let screen = h.board.currentScreenID
        var ids: [RecordID] = []
        for k in 0..<3 {
            let y = box.y + Double(k) * box.h / 2
            let s = StrokeRecord(screen: screen, order: h.board.store.nextOrder(on: screen), author: .tutor, color: .tutor, width: 4,
                                 pressure: .real, x: box.x, y: y,
                                 points: [InkPoint(x: 0, y: 0), InkPoint(x: box.w / 2, y: 4), InkPoint(x: box.w, y: 0)], meta: meta)
            h.board.store.put(.stroke(s), origin: .tutor)
            ids.append(s.id)
        }
        return ids
    }

    static func chatMeta(_ lines: [String], n: Int = 1, cell: Box) -> Meta {
        ["chatProblem": .object(["n": .number(Double(n)), "lines": .array(lines.map { .string($0) }),
                                 "cell": .object(["x": .number(cell.x), "y": .number(cell.y), "w": .number(cell.w), "h": .number(cell.h)])]),
         "lineId": .string("chat"), "live": .bool(true), "source": .string("ai")]
    }

    @Test func chatProblemsBecomeProblemRecordsAndGoWithTheirInk() async throws {
        let h = Harness()
        await h.start()
        let ink = tutorProblem(h, box: Box(x: 200, y: 100, w: 300, h: 60),
                               meta: Self.chatMeta(["2x + 3 = 11"], cell: Box(x: 180, y: 80, w: 600, h: 400)))
        h.loop.problemsChanged()
        let made = try #require(h.board.problems.first)
        #expect(h.board.problems.count == 1)
        #expect(made.origin == "chat")
        #expect(made.latex == "2x + 3 = 11")
        let rect = try #require(made.meta[LiveMeta.rect].flatMap(BrainRect.init(meta:)))
        #expect(rect.x == 200 && rect.y == 100 && rect.w == 300)
        // again: nothing changes (idempotent)
        h.loop.problemsChanged()
        #expect(h.board.problems.map(\.id) == [made.id])
        // the problem rubbed out: its record goes too
        h.board.store.remove(ink, origin: .tutor)
        h.loop.problemsChanged()
        #expect(h.board.problems.isEmpty)
    }

    @Test func theKidsWorkUnderAChatProblemIsJudgedAgainstIt() async throws {
        let h = Harness()
        await h.start()
        tutorProblem(h, box: Box(x: 200, y: 100, w: 320, h: 60),
                     meta: Self.chatMeta(["2x + 3 = 11"], cell: Box(x: 180, y: 80, w: 700, h: 600)))
        h.loop.problemsChanged()
        await h.write("2x = 8", at: Vec2(200, 220))
        await h.pass(3_500)
        #expect(h.board.mark(on: "2x = 8") == .tick, "2x = 8 is the right next step of the tutor's 2x + 3 = 11")
        await h.write("x = 5", at: Vec2(200, 330))
        await h.pass(3_500)
        #expect(h.board.mark(on: "x = 5") == .ring)
    }

    /// The onboarding's first board: the try's answer beside its problem, already read and ticked
    /// (a `line`, a `mark`, the tick's strokes stamped with the loop's key). Opening the board keeps
    /// that tick: no second read, no second tick, and the tick never rubbed out.
    @Test func aCarriedTickStaysOneTick() async throws {
        let h = Harness()
        let screen = h.board.currentScreenID
        tutorProblem(h, box: Box(x: 200, y: 100, w: 320, h: 60), meta: ["problem": .bool(true), HandPace.lineMeta: .string("6 \\times 7 =")])
        // the kid's answer beside it, on its row
        let ink = KidHands.strokes("x = 4", at: Vec2(560, 95))
        let kid = h.board.kidWrites(ink)
        await h.register(kid, reads: "42")
        let pts = ink.flatMap { $0 }
        let box = Box(x: pts.map(\.x).min()!, y: pts.map(\.y).min()!, w: pts.map(\.x).max()! - pts.map(\.x).min()!,
                      h: pts.map(\.y).max()! - pts.map(\.y).min()!)
        let lineId = RecordID.make(.line)
        let key = LiveMarks.key(.check, box.rect)
        var tickIds: [RecordID] = []
        for s in TutorMarks.strokes(.tick, line: box, seed: 11) where s.points.count >= 2 {
            let o = s.points[0].p
            let r = StrokeRecord(screen: screen, order: h.board.store.nextOrder(on: screen), author: .tutor, color: .tutor, width: 4, pressure: .real,
                                 x: o.x, y: o.y, points: s.points.map { InkPoint(x: $0.p.x - o.x, y: $0.p.y - o.y) },
                                 meta: ["live": .bool(true), "source": .string("ai"), "lineId": .string(String(lineId.key)), "mark": .string(key)])
            h.board.store.put(.stroke(r), origin: .system)
            tickIds.append(r.id)
        }
        h.board.store.put(.line(LineRecord(id: lineId, screen: screen, strokes: kid, latex: "42", verdict: .ok,
                                           meta: ["confidence": .number(1), "provider": .string("mathpix")])), origin: .system)
        h.board.store.put(.mark(MarkRecord(screen: screen, kind: .tick, target: lineId, strokes: tickIds,
                                           meta: ["mark": .string(key), "lineId": .string(String(lineId.key))])), origin: .system)
        // the board opens with the loop on it (as the app's BoardTutor starts it)
        h.loop.start()
        h.loop.problemsChanged()
        await h.idle()
        await h.pass(4_000)
        #expect(h.services.recognizeRequests.isEmpty, "the carried answer was read again")
        let line = try #require(h.loop.lines.values.first { $0.latex == "42" }, "the carried line isn't one of the loop's")
        #expect(LiveMarks.key(.check, line.bounds) == key, "the loop's box \(line.bounds) vs the carried \(box)")
        let a = line.analysis
        #expect(a?.verdict == "ok" || a?.solved == true,
                "analysis kind \(a?.kind ?? "nil") verdict \(a?.verdict ?? "nil") bare \(String(describing: a?.bareAnswer)) solved \(String(describing: a?.solved)) head \(String(describing: h.loop.head(for: line.column)?.lines)) heads \(h.loop.heads.count) problems \(h.board.problems.map { $0.latex ?? "" })")
        #expect(h.board.mark(on: "42") == .tick, "the carried tick is gone: \(h.board.marks.map(\.kind))")
        #expect(tickIds.allSatisfy { h.board.store[$0] != nil }, "the carried tick's strokes were rubbed out")
        let marks = h.board.tutorStrokes.filter { !($0.meta["mark"]?.stringValue ?? "").isEmpty }
        #expect(Set(marks.map(\.id)) == Set(tickIds), "a second tick was written: \(marks.count) mark strokes")
    }

    /// A young student's answer to a practice sum is the number alone (the web's
    /// liveLoop.problems.test "no silent lines under a problem"): right, it is ticked and the problem
    /// solved; wrong, even one digit, it is ringed — never silent.
    @Test func aBareAnswerUnderASumIsJudged() async throws {
        let h = Harness()
        await h.start()
        tutorProblem(h, box: Box(x: 200, y: 100, w: 320, h: 60),
                     meta: Self.chatMeta(["18 + 15 - 19"], n: 1, cell: Box(x: 180, y: 80, w: 600, h: 300)))
        tutorProblem(h, box: Box(x: 900, y: 100, w: 200, h: 60),
                     meta: Self.chatMeta(["2 + 2"], n: 2, cell: Box(x: 880, y: 80, w: 600, h: 300)))
        h.loop.problemsChanged()
        await h.write("x = 4", at: Vec2(200, 220), reads: "14")
        await h.write("x = 3", at: Vec2(900, 220), reads: "5")
        await h.pass(4_000)
        let fourteen = try #require(h.loop.lines.values.first { $0.latex == "14" })
        #expect(fourteen.analysis?.verdict == "ok" && fourteen.analysis?.solved == true && fourteen.analysis?.bareAnswer == true,
                "\(String(describing: fourteen.analysis))")
        #expect(h.board.mark(on: "14") == .tick)
        #expect(h.board.mark(on: "5") == .ring)
    }

    /// The owner's iPad, 2026-10-19 (Today's practice): `403 + 364 − 336` worked as a running total.
    /// `+3 = 767` read alone is `3 = 767` and was ringed; it goes on from the line above (764 + 3).
    @Test func aRunningTotalGoesOnFromTheLineAbove() async throws {
        let h = Harness()
        await h.start()
        tutorProblem(h, box: Box(x: 200, y: 100, w: 420, h: 60),
                     meta: Self.chatMeta(["403 + 364 - 336"], n: 1, cell: Box(x: 180, y: 80, w: 700, h: 520)))
        h.loop.problemsChanged()
        await h.write("x = 4", at: Vec2(200, 220), reads: "400+364=764")
        await h.write("x = 3", at: Vec2(200, 320), reads: "+3=767")
        // (each line its own ink: the fake recognizer knows a read by its strokes' shape)
        await h.write("2x = 8", at: Vec2(200, 420), reads: "-336=431")
        await h.pass(5_000)
        #expect(h.board.mark(on: "400+364=764") == .tick)
        #expect(h.board.mark(on: "+3=767") == .tick, "\(String(describing: h.loop.lines.values.first { $0.latex == "+3=767" }?.analysis))")
        #expect(h.board.mark(on: "-336=431") == .tick)
        let last = try #require(h.loop.lines.values.first { $0.latex == "-336=431" })
        #expect(last.analysis?.solved == true, "\(String(describing: last.analysis))")
    }

    @Test func aWrongRunningTotalIsRingedAndTheNextGoesOnFromIt() async throws {
        let h = Harness()
        await h.start()
        tutorProblem(h, box: Box(x: 200, y: 100, w: 420, h: 60),
                     meta: Self.chatMeta(["403 + 364 - 336"], n: 1, cell: Box(x: 180, y: 80, w: 700, h: 520)))
        h.loop.problemsChanged()
        await h.write("x = 4", at: Vec2(200, 220), reads: "400+364=764")
        await h.write("x = 3", at: Vec2(200, 320), reads: "+3=768")
        await h.write("2x = 8", at: Vec2(200, 420), reads: "-336=432")
        await h.pass(5_000)
        #expect(h.board.mark(on: "+3=768") == .ring)
        // built on the ringed total: carried on from that slip, no ring of its own
        #expect(h.board.mark(on: "-336=432") != .ring)
    }

    @Test func timesAndDivideGoOnToo() async throws {
        let h = Harness()
        await h.start()
        tutorProblem(h, box: Box(x: 200, y: 100, w: 420, h: 60),
                     meta: Self.chatMeta(["6 \\times 4 \\div 3"], n: 1, cell: Box(x: 180, y: 80, w: 700, h: 520)))
        h.loop.problemsChanged()
        await h.write("x = 4", at: Vec2(200, 220), reads: "6\\times 4=24")
        await h.write("x = 3", at: Vec2(200, 320), reads: "\\div 3=8")
        await h.pass(5_000)
        #expect(h.board.mark(on: "\\div 3=8") == .tick, "\(String(describing: h.loop.lines.values.first { $0.latex == "\\div 3=8" }?.analysis))")
    }

    @Test func aRunningTotalWithNothingAboveIsLeftAlone() async throws {
        let h = Harness()
        await h.start()
        tutorProblem(h, box: Box(x: 200, y: 100, w: 420, h: 60),
                     meta: Self.chatMeta(["403 + 364 - 336"], n: 1, cell: Box(x: 180, y: 80, w: 700, h: 520)))
        h.loop.problemsChanged()
        await h.write("x = 3", at: Vec2(200, 220), reads: "+3=767")
        await h.pass(5_000)
        #expect(h.board.mark(on: "+3=767") == nil)
    }

    /// The owner's iPad, 2026-10-19, the same board: `767-336` then `=431` on the next line (the
    /// answer) was ringed, and `764+3=767` left unmarked. Under the tutor's problem: every step ticked,
    /// `=431` the answer.
    @Test func anAnswerStartedWithEqualsGoesOnFromTheLineAbove() async throws {
        let h = Harness()
        await h.start()
        tutorProblem(h, box: Box(x: 200, y: 100, w: 420, h: 60),
                     meta: Self.chatMeta(["403 + 364 - 336"], n: 1, cell: Box(x: 180, y: 80, w: 760, h: 620)))
        h.loop.problemsChanged()
        await h.write("x = 4", at: Vec2(200, 220), reads: "400+364=764")
        await h.write("x = 3", at: Vec2(200, 320), reads: "764+3=767")
        await h.write("2x = 8", at: Vec2(200, 420), reads: "767-336")
        await h.write("x = 5", at: Vec2(200, 520), reads: "=431")
        await h.pass(6_000)
        #expect(h.board.mark(on: "400+364=764") == .tick)
        #expect(h.board.mark(on: "764+3=767") == .tick, "\(String(describing: h.loop.lines.values.first { $0.latex == "764+3=767" }?.analysis))")
        #expect(h.board.mark(on: "767-336") != .ring)
        #expect(h.board.mark(on: "=431") == .tick, "\(String(describing: h.loop.lines.values.first { $0.latex == "=431" }?.analysis))")
    }

    /// The same working with no problem of the tutor's over it (a column the loop could not put
    /// under one): judged against the kid's own first line, a true line is still never ringed.
    @Test func aTrueLineIsNeverRingedWhateverTheColumnIsJudgedAgainst() async throws {
        let h = Harness()
        await h.start()
        await h.write("x = 4", at: Vec2(200, 220), reads: "400+364=764")
        await h.write("x = 3", at: Vec2(200, 320), reads: "764+3=767")
        await h.write("2x = 8", at: Vec2(200, 420), reads: "767-336")
        await h.write("x = 5", at: Vec2(200, 520), reads: "=431")
        await h.pass(6_000)
        for line in ["400+364=764", "764+3=767", "767-336", "=431"] {
            #expect(h.board.mark(on: line) != .ring, "\(line): \(String(describing: h.loop.lines.values.first { $0.latex == line }?.analysis))")
        }
    }

    @Test func whatIsTrueByItsOwnNumbers() {
        #expect(ArithmeticTruth.holds("767-336=431") == true)
        #expect(ArithmeticTruth.holds("=431", above: "767-336") == true)
        #expect(ArithmeticTruth.holds("=431", above: "767-336=") == true)
        #expect(ArithmeticTruth.holds("=432", above: "767-336") == false)
        #expect(ArithmeticTruth.holds("20+10=30+12=42") == true) // `=` as "then", link by link
        #expect(ArithmeticTruth.holds("20+10=31+12=43") == false)
        #expect(ArithmeticTruth.holds("6\\times 4=24") == true)
        #expect(ArithmeticTruth.holds("24\\div 3=8") == true)
        #expect(ArithmeticTruth.holds("3=767") == false)
        #expect(ArithmeticTruth.holds("2x=8") == nil)
        #expect(ArithmeticTruth.holds("\\frac{3}{4}=0.75") == nil)
        #expect(ArithmeticTruth.holds("431") == nil)
    }

    @Test func theRunningTotalsShape() {
        #expect(ContinuationLine.parse("+3=767") == .init(op: "+", operand: "3", result: "767"))
        #expect(ContinuationLine.parse("\u{2212}336 = 431") == .init(op: "-", operand: "336", result: "431"))
        #expect(ContinuationLine.parse("\\div 3=8") == .init(op: "\\div", operand: "3", result: "8"))
        #expect(ContinuationLine.parse("\\times 2 = 16")?.op == "\\times")
        #expect(ContinuationLine.parse("-3 \\quad -3") == nil)
        #expect(ContinuationLine.parse("2x+3=11") == nil)
        #expect(ContinuationLine.result(of: "400+364=764") == "764")
        #expect(ContinuationLine.result(of: "2x=8") == nil)
        #expect(ContinuationLine.rewritten(.init(op: "+", operand: "3", result: "767"), after: "764") == "764 + 3 = 767")
    }

    @Test func theFirstBoardsProblemsHeadTheirColumnsToo() async throws {
        let h = Harness()
        await h.start()
        tutorProblem(h, box: Box(x: 200, y: 100, w: 320, h: 60), meta: ["problem": .bool(true), HandPace.lineMeta: .string("2x + 3 = 11")])
        h.loop.problemsChanged()
        let made = try #require(h.board.problems.first)
        #expect(made.origin == "practice")
        #expect(made.latex == "2x + 3 = 11")
        await h.write("2x = 8", at: Vec2(200, 220))
        await h.pass(3_500)
        #expect(h.board.mark(on: "2x = 8") == .tick)
    }
}
