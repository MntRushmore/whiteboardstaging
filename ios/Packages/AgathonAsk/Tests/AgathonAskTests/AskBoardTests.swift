@testable import AgathonAsk
import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation
import Testing

/// A reply's actions on the board, end to end: the real brain (brain.js in JavaScriptCore) plans
/// them with the web's own desk, and the driver writes the plan in the tutor's hand on a board in
/// memory. Each action Ask may send: the records it leaves, where, and what they carry.
@MainActor
@Suite(.serialized)
struct AskBoardTests {
    func driver(_ board: MemoryBoard) -> AskBoardDriver {
        AskBoardDriver(board: board, brain: TestBrain.shared)
    }

    func action(_ json: String) -> AgathonKit.JSONValue {
        AgathonKit.JSONValue.parse(Data(json.utf8)) ?? .null
    }

    func inside(_ s: StrokeRecord, _ r: AgathonBrain.Rect) -> Bool {
        guard let b = AskBoardDriver.strokeBounds(s) else { return false }
        return b.x >= r.x - 3 && b.y >= r.y - 3 && b.x + b.w <= r.x + r.w + 3 && b.y + b.h <= r.y + r.h + 3
    }

    @Test func writeProblemsNumberedInTheirCellsInTheTutorsHand() async {
        let board = MemoryBoard()
        let d = driver(board)
        var screens: [AskScreenRef] = []
        let report = await d.run([action(#"{"type":"write_problems","problems":[["2x + 3 = 11"],["3x - 5 = 10"],["x^{2} - 5x + 6 = 0"]]}"#)]) { screens.append($0) }
        #expect(report.problemsWritten == 3)
        #expect(report.outcomes == [AskActionOutcome(type: "write_problems", ok: true)])
        #expect(screens.isEmpty)
        let strokes = board.tutorStrokes
        #expect(!strokes.isEmpty)
        // every stroke the tutor's, live, the chat's, its problem and cell on it, inside its cell
        for s in strokes {
            #expect(s.author == .tutor && s.color == .tutor)
            #expect(s.meta["live"] == true && s.meta["source"] == "ai" && s.meta["lineId"] == "chat")
            guard let p = s.meta["chatProblem"], let c = p["cell"] else { Issue.record("no problem meta"); continue }
            let cell = AgathonBrain.Rect(x: c["x"]?.numberValue ?? 0, y: c["y"]?.numberValue ?? 0, w: c["w"]?.numberValue ?? 0, h: c["h"]?.numberValue ?? 0)
            #expect(inside(s, cell))
        }
        let numbers = Set(strokes.compactMap { $0.meta["chatProblem"]?["n"]?.numberValue })
        #expect(numbers == [1, 2, 3])
        // not in the kid's undo
        #expect(!board.store.canUndo)
        // the picture of the screen now lists them, numbered
        let picture = await d.picture()
        #expect(picture.problems == ["2x + 3 = 11", "3x - 5 = 10", "x^{2} - 5x + 6 = 0"])
        #expect(picture.numbers == [1, 2, 3])
        #expect(!picture.empty)
    }

    @Test func problemsOnAScreenWithWorkGoOnANewScreenThatTheSessionHearsOf() async {
        let board = MemoryBoard()
        board.kidLine(y: 120)
        let first = board.currentScreenID
        let d = driver(board)
        var screens: [AskScreenRef] = []
        let report = await d.run([action(#"{"type":"write_problems","problems":[["2x = 8"],["5x = 20"]]}"#)]) { screens.append($0) }
        #expect(report.screensAdded == 1)
        #expect(board.store.screenIDs.count == 2)
        #expect(board.currentScreenID != first)
        #expect(screens == [AskBoardDriver.screenRef(board.currentScreenID, in: board.store)])
        #expect(screens.first?.index == 2)
        #expect(board.store.drawables(on: first).allSatisfy { $0.author == .kid })
        #expect(board.tutorStrokes.count > 4)
    }

    @Test func linesAGraphAndAVisualModelInOneReplyEachClearOfTheLast() async {
        let board = MemoryBoard()
        let d = driver(board)
        let report = await d.run([
            action(#"{"type":"write_lines","lines":["a^{2} + b^{2} = c^{2}"]}"#),
            action(#"{"type":"graph","relations":["y = x^{2} - 4"]}"#),
            action(#"{"type":"draw_model","model":{"kind":"fraction_bars","bars":[{"parts":4,"shaded":3},{"parts":8,"shaded":5}]}}"#),
        ]) { _ in }
        #expect(report.outcomes.map(\.ok) == [true, true, true])
        let strokes = board.tutorStrokes
        let blocks = Dictionary(grouping: strokes) { $0.meta["chatBlock"]?.stringValue ?? "?" }
        #expect(Set(blocks.keys) == ["lines", "graph", "model"])
        #expect(blocks["model"]?.allSatisfy { $0.meta["chatModel"] == "fraction_bars" } == true)
        // the model's shaded parts: closed outlines with a light tint, filled once drawn
        #expect(blocks["model"]?.contains { $0.closed && $0.fill == .semi } == true)
        // each line of maths says what it is; the screen's picture leaves the drawings out
        #expect(blocks["lines"]?.allSatisfy { $0.meta["handLine"] == "a^{2} + b^{2} = c^{2}" } == true)
        let picture = await d.picture()
        #expect(picture.tutor == ["a^{2} + b^{2} = c^{2}"])
        let screen = board.screenRect
        for s in strokes { #expect(inside(s, screen)) }
    }

    @Test func teachWritesAWorkedSolutionBesideTheKidsWork() async {
        let board = MemoryBoard()
        board.kidLine(y: 90)
        let d = driver(board)
        let report = await d.run([action(#"{"type":"teach","steps":[{"say":"Take 3 from both sides.","math":["2x + 3 = 11","2x = 8"]},{"say":"Divide both sides by 2.","math":["x = 4"]}],"answer":"x = 4"}"#)]) { _ in }
        #expect(report.outcomes == [AskActionOutcome(type: "teach", ok: true)])
        #expect(board.store.screenIDs.count == 1)
        let teach = board.tutorStrokes.filter { $0.meta["chatBlock"] == "teach" }
        #expect(teach.count > 20)
        let lines = Set(teach.compactMap { $0.meta["handLine"]?.stringValue })
        #expect(lines.isSuperset(of: ["2x = 8", "x = 4"]))
    }

    @Test func newScreenAndClearTutor() async {
        let board = MemoryBoard()
        let d = driver(board)
        _ = await d.run([action(#"{"type":"write_lines","lines":["x = 4"]}"#)]) { _ in }
        #expect(!board.tutorStrokes.isEmpty)
        board.kidLine(y: 600)
        let cleared = await d.run([action(#"{"type":"clear_tutor"}"#)]) { _ in }
        #expect(cleared.outcomes == [AskActionOutcome(type: "clear_tutor", ok: true)])
        #expect(board.tutorStrokes.isEmpty)
        #expect(board.store.drawables(on: board.currentScreenID).count == 5)
        var heard: [AskScreenRef] = []
        let added = await d.run([action(#"{"type":"new_screen"}"#)]) { heard.append($0) }
        #expect(added.screensAdded == 1 && added.outcomes == [AskActionOutcome(type: "new_screen", ok: true)])
        #expect(board.store.screenIDs.count == 2 && heard.count == 1)
    }

    @Test func helpWithAProblemTheChatWroteAndWithNothingThere() async {
        let board = MemoryBoard()
        let d = driver(board)
        _ = await d.run([action(#"{"type":"write_problems","problems":[["2x + 3 = 11"]]}"#)]) { _ in }
        let before = board.tutorStrokes.count
        let report = await d.run([action(#"{"type":"help_problem","problem":1,"depth":"solve"}"#)]) { _ in }
        #expect(report.outcomes == [AskActionOutcome(type: "help_problem", ok: true)])
        let help = board.tutorStrokes.filter { $0.meta["chatHelp"] != nil }
        #expect(help.count > 0 && board.tutorStrokes.count > before)
        let helped = Set(help.compactMap { $0.meta["handLine"]?.stringValue })
        #expect(helped.contains("x = 4"))
        let missing = await d.run([action(#"{"type":"help_problem","problem":7,"depth":"step"}"#)]) { _ in }
        #expect(missing.outcomes.first?.ok == false)
        #expect(missing.outcomes.first?.note == "There's no problem 7 on this screen.")
        let own = await d.run([action(#"{"type":"help_board","depth":"step"}"#)]) { _ in }
        #expect(own.outcomes.first?.why == "nothing")
    }

    @Test func aDrawingThatDoesNotAddUpIsRefusedWithItsNote() async {
        let board = MemoryBoard()
        let report = await driver(board).run([action(#"{"type":"draw_model","model":{"kind":"fraction_bars","bars":[{"parts":4,"shaded":6}]}}"#)]) { _ in }
        #expect(report.outcomes.first?.ok == false)
        #expect(report.outcomes.first?.note == "That picture didn't add up, so I didn't draw it.")
        #expect(board.tutorStrokes.isEmpty)
    }

    @Test func theKidMovingToAnotherScreenStopsTheRestAndSaysSo() async {
        let board = MemoryBoard()
        let other = ScreenRecord(order: OrderKey.after(board.store.screens.last?.order))
        board.store.put(.screen(other), origin: .kid)
        let d = driver(board)
        // the plan for two drawings; the kid moves before the second is written
        let start = board.currentScreenID
        let plan = try? await AskBrain.plan(TestBrain.shared, AskPlanArgs(
            actions: [AskBoardDriver.brainJSON(action(#"{"type":"write_lines","lines":["x = 1"]}"#))!, AskBoardDriver.brainJSON(action(#"{"type":"write_lines","lines":["y = 2"]}"#))!],
            shapes: [], screen: board.screenRect, pageId: start.rawValue, screenIndex: 1, studentLines: [], handwriting: true, screensLeft: 3, carried: [:]))
        guard var p = plan else { Issue.record("no plan"); return }
        // after the first write, the kid is elsewhere
        let firstWrite = p.ops.firstIndex { if case .write = $0 { return true }; return false } ?? 0
        p.ops.insert(.problemsChanged(page: start.rawValue), at: firstWrite + 1)
        let helper = MovingHelper(board: board, to: other.id)
        d.helper = helper
        let report = await d.execute(p, from: start) { _ in }
        #expect(report.outcomes.last?.note == AskBoardDriver.movedNote)
        let written = Set(board.store.drawables(on: start).compactMap { $0.meta["handLine"]?.stringValue })
        #expect(written == ["x = 1"])
    }

    @Test func aFigureAndATwoColumnProofDrawnByTheBrainsDrawer() async {
        let board = MemoryBoard()
        let d = driver(board)
        let figure = await d.run([action(#"{"type":"draw_figure","figure":{"points":{"A":{"x":0,"y":0},"B":{"x":4,"y":0},"C":{"x":0,"y":3}},"segments":[{"from":"A","to":"B","label":"4"},{"from":"A","to":"C","label":"3"},{"from":"B","to":"C","label":"x"}],"angles":[{"at":"A","from":"B","to":"C","right":true}]}}"#)]) { _ in }
        #expect(figure.outcomes == [AskActionOutcome(type: "draw_figure", ok: true)])
        #expect(board.tutorStrokes.contains { $0.meta["chatBlock"] == "figure" })
        let proofBoard = MemoryBoard()
        let proof = await driver(proofBoard).run([action(#"{"type":"write_proof","figure":{"points":{"A":{"x":0,"y":0},"B":{"x":5,"y":4},"C":{"x":10,"y":0},"D":{"x":5,"y":-8},"E":{"x":5,"y":0}},"segments":[{"from":"A","to":"B","ticks":1},{"from":"C","to":"B","ticks":1},{"from":"A","to":"D","ticks":2},{"from":"C","to":"D","ticks":2},{"from":"A","to":"C"},{"from":"B","to":"D"}]},"given":["\\overline{AB} \\cong \\overline{CB}","\\overline{AD} \\cong \\overline{CD}"],"prove":"\\overline{AE} \\cong \\overline{CE}","worked":true}"#)]) { _ in }
        #expect(proof.outcomes.first?.ok == true, "\(proof.outcomes)")
        #expect(proofBoard.tutorStrokes.count > 40)
    }

    @Test func aPenThatWritesLaterIsHeldUntilItsBlockIsOnThePage() async {
        let board = SlowPenBoard()
        let d = AskBoardDriver(board: board, brain: TestBrain.shared)
        var done = false
        Task { @MainActor in
            _ = await d.run([action(#"{"type":"write_lines","lines":["x = 4"]}"#)]) { _ in }
            done = true
        }
        #expect(await eventually(10) { done })
        #expect(board.inner.tutorStrokes.count > 0)
    }

    @Test func screenIdsAsTheServerNamesThem() {
        #expect(AskBoardDriver.serverScreenId("screen:abc_DEF-1") == "page:abc_DEF-1")
        #expect(AskBoardDriver.serverScreenId("screen:bad key!") == nil)
        let board = MemoryBoard()
        let ref = AskBoardDriver.screenRef(board.currentScreenID, in: board.store)
        #expect(ref.index == 1 && ref.id == "page:\(board.currentScreenID.key)")
    }

    @Test func tutorLinesKeepTheModelsInkStyle() throws {
        let json = #"{"lines":[{"latex":"","x":10,"y":20,"strokes":[{"points":[{"x":0,"y":0,"z":0.5},{"x":10,"y":0,"z":0.5},{"x":10,"y":10,"z":0.5}],"order":0,"kind":"rule","weight":0.6}],"baseline":10,"startMs":0,"durationMs":100,"style":{"color":"blue","fill":"solid","closed":true},"part":"bar:0"}],"bounds":{"x":10,"y":20,"w":10,"h":10},"size":28,"totalMs":100}"#
        let plan = try JSONDecoder().decode(HandPlan.self, from: Data(json.utf8))
        let lines = AskBoardDriver.tutorLines(plan)
        #expect(lines[0].color == .tutor && lines[0].closed && lines[0].fill == .semi)
        #expect(lines[0].strokes[0].points.first?.p == Vec2(10, 20))
        #expect(lines[0].strokes[0].weight == 0.6)
    }
}

/// Moves the board to another screen when the loop is told the problems changed (a kid tapping
/// another screen mid-run, at a known moment).
@MainActor
final class MovingHelper: AskBoardHelper {
    let board: MemoryBoard
    let to: RecordID
    init(board: MemoryBoard, to: RecordID) {
        self.board = board
        self.to = to
    }
    func studentLines() -> [String] { [] }
    func studentLines(in rect: AgathonBrain.Rect) -> [String] { [] }
    var tutorWriting: Bool { false }
    func helpBoard(depth: String) -> String { "nothing" }
    func problemsChanged() { board.currentScreenID = to }
    func tutorCleared() {}
}
