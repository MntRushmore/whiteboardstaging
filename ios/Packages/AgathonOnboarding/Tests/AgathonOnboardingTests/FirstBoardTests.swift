import AgathonBoard
import Foundation
import Testing
@testable import AgathonOnboarding

/// The first board carries the try as the board's tutor keeps its own work, so the Live loop on the
/// real board neither reads the answer again nor ticks it a second time.
@MainActor
@Suite("The first board (FirstBoardMaker)")
struct FirstBoardTests {
    @Test func theTickedTryIsAReadLineWithItsMark() async throws {
        var answers = OnboardingAnswers(role: .parent, name: "Sam", choice: .grade(0))
        var t = TryRecord(problemId: "k2-0")
        t.verdict = TryVerdict.solved.rawValue
        t.latex = "7"
        // a "7" in the answer zone: two strokes, page coordinates [x, y, pressure]
        t.answerStrokes = [[[700, 300, 0.5], [760, 300, 0.5]], [[760, 300, 0.5], [720, 400, 0.5]]]
        answers.tries = [t]
        let made = await FirstBoardMaker.make(answers: answers, seed: 7, boardId: "first-board-test")
        let store = BoardStore(document: made.document)
        let lines = store.records.values.compactMap { r -> LineRecord? in if case .line(let l) = r { return l } else { return nil } }
        let marks = store.records.values.compactMap { r -> MarkRecord? in if case .mark(let m) = r { return m } else { return nil } }
        let line = try #require(lines.first)
        #expect(lines.count == 1)
        #expect(line.latex == "7")
        #expect(line.strokes.count == 2)
        let mark = try #require(marks.first)
        #expect(mark.kind == .tick)
        #expect(mark.target == line.id)
        // the box of the 7 is x 700…760, y 300…400: the loop's key in quarters
        #expect(mark.meta["mark"]?.stringValue == "check:175,75,15,25")
        // the tick's strokes are stamped as the loop's own
        let ticks = mark.strokes.compactMap { store.stroke($0) }
        #expect(!ticks.isEmpty)
        #expect(ticks.allSatisfy { $0.author == .tutor && $0.meta["lineId"]?.stringValue == String(line.id.key) && $0.meta["live"]?.boolValue == true })
        // the try's problem is marked as a problem (it heads its column on the board)
        #expect(store.records.values.contains { r in
            if case .stroke(let s) = r { return s.meta["problem"]?.boolValue == true }
            return false
        })
    }

    @Test func anUntickedTryCarriesNoMark() async {
        var answers = OnboardingAnswers(role: .parent, name: "Sam", choice: .grade(0))
        var t = TryRecord(problemId: "k2-0")
        t.strokes = [[[700, 300, 0.5], [760, 300, 0.5]]]
        answers.tries = [t]
        let made = await FirstBoardMaker.make(answers: answers, seed: 7, boardId: "first-board-test")
        #expect(!made.document.records.values.contains { r in if case .mark = r { return true } else { return false } })
    }
}
