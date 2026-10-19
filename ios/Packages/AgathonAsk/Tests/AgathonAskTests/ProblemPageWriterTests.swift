@testable import AgathonAsk
import AgathonBoard
import AgathonBrain
import AgathonKit
import AgathonLive
import Foundation
import Testing

/// A memory board that shows the page it is asked to (as the board's controller does).
extension MemoryBoard {
    func goToScreen(_ id: RecordID) {
        currentScreenID = id
        onScreenChange?(id)
    }
}

/// One problem per page (docs/PROBLEM-PAGES.md): Ask's `write_problems` and practice sets, through
/// the real desk's check and the real hand.
@MainActor
@Suite(.serialized)
struct ProblemPageWriterTests {
    func driver(_ board: MemoryBoard) -> AskBoardDriver {
        let d = AskBoardDriver(board: board, brain: TestBrain.shared)
        d.problemPages = true
        return d
    }

    func action(_ json: String) -> AgathonKit.JSONValue {
        AgathonKit.JSONValue.parse(Data(json.utf8)) ?? .null
    }

    func tutorStrokes(_ board: MemoryBoard, on screen: RecordID) -> [StrokeRecord] {
        board.store.drawables(on: screen).compactMap { if case .stroke(let s) = $0, s.author == .tutor { return s } else { return nil } }
    }

    @Test func aSetIsAPageAProblemThenAllDone() async throws {
        let board = MemoryBoard()
        let start = board.currentScreenID
        let d = driver(board)
        var screens: [AskScreenRef] = []
        let report = await d.run([action(#"{"type":"write_problems","set":"daily:2026-10-19","origin":"practice","problems":[["2x + 3 = 11"],["3x - 5 = 10"],["5x + 2 = 17"]]}"#)]) { screens.append($0) }
        #expect(report.outcomes == [AskActionOutcome(type: "write_problems", ok: true)])
        #expect(report.problemsWritten == 3 && report.problemsDropped == 0)
        let ids = board.store.screenIDs
        #expect(ids.count == 4, "three problem pages (the blank one it was on, then two) and All done")
        #expect(ids.first == start, "a blank page is the set's first")
        #expect(board.currentScreenID == start, "the board shows the first problem")
        #expect(screens.isEmpty, "no new page was shown, so the exchange stays where it is")
        for (i, id) in ids.prefix(3).enumerated() {
            let page = try #require(board.store[id]?.screen?.problemPage)
            #expect(page.kind == .problem && page.setId == "daily:2026-10-19" && page.index == i + 1 && page.count == 3 && page.origin == "practice")
            let ink = tutorStrokes(board, on: id)
            #expect(!ink.isEmpty, "page \(i + 1) has its problem")
            // the problem, alone, at the page's problem origin: no grid number, its cell the whole page
            let lines = Set(ink.compactMap { $0.meta[HandPace.lineMeta]?.stringValue })
            #expect(!lines.contains("1.") && !lines.contains("\(i + 1)."), "no grid number: \(lines)")
            let cell = try #require(ink.first?.meta["chatProblem"]?["cell"])
            #expect(cell["w"]?.numberValue == ProblemPageWriter.pageCell.w)
            #expect(ink.first?.meta["chatProblem"]?["n"]?.numberValue == 1)
            let box = try #require(AskBoardDriver.pointsBox(ink.flatMap { s in s.points.map { s.pagePoint($0) } }))
            #expect(abs(box.x - ProblemPageLayout.problemOrigin.x) < 12 && abs(box.y - ProblemPageLayout.problemOrigin.y) < 16, "at the problem origin: \(box)")
            #expect(box.h > 34, "in a big hand: \(box.h)")
            // the work area starts under it
            #expect(page.resolvedWorkTop >= box.y + box.h + ProblemPageLayout.workGap)
        }
        let done = try #require(board.store[ids[3]]?.screen?.problemPage)
        #expect(done.kind == .done && done.setId == "daily:2026-10-19")
        #expect(tutorStrokes(board, on: ids[3]).isEmpty)
        // only the first was written by the pen (the others went straight onto their pages)
        #expect(board.writes.count == 1)
    }

    @Test func aPageWithWorkOnItStaysAndTheSetGoesAfterIt() async throws {
        let board = MemoryBoard()
        let start = board.currentScreenID
        // the kid's own work on the page Ask was asked on, and a page after it
        board.store.put(.stroke(StrokeRecord(screen: start, order: board.store.nextOrder(on: start), author: .kid, color: .black, width: 6,
                                             pressure: .simulated, x: 100, y: 100, points: [InkPoint(x: 0, y: 0), InkPoint(x: 80, y: 4)])), origin: .kid)
        let later = try #require(board.insertScreen(after: start, meta: [:], go: false))
        let d = driver(board)
        var screens: [AskScreenRef] = []
        _ = await d.run([action(#"{"type":"write_problems","problems":[["2x = 8"],["5x = 20"]]}"#)]) { screens.append($0) }
        let ids = board.store.screenIDs
        #expect(ids.count == 5)
        #expect(ids.first == start && ids.last == later, "the set goes right after the page asked on, before the next one")
        #expect(board.store[ids[1]]?.screen?.problemPage?.index == 1 && board.store[ids[2]]?.screen?.problemPage?.index == 2)
        #expect(board.store[ids[3]]?.screen?.problemPage?.kind == .done)
        #expect(board.currentScreenID == ids[1], "the board shows the first problem")
        #expect(screens.map(\.id) == [AskBoardDriver.serverScreenId(ids[1])], "the exchange goes with the first page")
        #expect(board.store[ids[1]]?.screen?.problemPage?.setId?.hasPrefix("ask:") == true)
    }

    @Test func aProblemTheDeskRefusesGetsNoPage() async throws {
        let board = MemoryBoard()
        let d = driver(board)
        let report = await d.run([action(#"{"type":"write_problems","problems":[["2 + 2 = 5"],["4x - 5 = 7"]]}"#)]) { _ in }
        #expect(report.problemsWritten == 1 && report.problemsDropped == 1)
        #expect(report.outcomes.first?.ok == true && report.outcomes.first?.note?.contains("1 of 2") == true)
        let ids = board.store.screenIDs
        #expect(ids.count == 1, "one problem: one page, no All done")
        let page = try #require(board.store[ids[0]]?.screen?.problemPage)
        #expect(page.index == 1 && page.count == 1 && !page.inSet)
        // nothing at all it can write
        let none = await d.run([action(#"{"type":"write_problems","problems":[["2 + 2 = 5"]]}"#)]) { _ in }
        #expect(none.outcomes.first?.ok == false && none.problemsWritten == 0)
    }

    @Test func otherActionsGoThroughTheDeskInOrder() async throws {
        let board = MemoryBoard()
        let d = driver(board)
        let report = await d.run([
            action(#"{"type":"write_problems","problems":[["2x = 8"]]}"#),
            action(#"{"type":"write_lines","lines":["x = 4"]}"#),
        ]) { _ in }
        #expect(report.outcomes.map(\.type) == ["write_problems", "write_lines"])
        // the lines went on the page on show (the problem's), clear of the problem
        let ink = tutorStrokes(board, on: board.currentScreenID)
        #expect(ink.contains { $0.meta["chatProblem"] != nil } && ink.contains { $0.meta["chatProblem"] == nil })
    }

    @Test func withoutPagesTheDesksGridStays() async throws {
        let board = MemoryBoard()
        let d = AskBoardDriver(board: board, brain: TestBrain.shared)
        _ = await d.run([action(#"{"type":"write_problems","problems":[["2x = 8"],["5x = 20"]]}"#)]) { _ in }
        #expect(board.store.screenIDs.count == 1)
        #expect(board.store.screens.first?.problemPage == nil)
    }
}
