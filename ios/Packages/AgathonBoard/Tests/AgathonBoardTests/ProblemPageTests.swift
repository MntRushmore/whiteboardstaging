import CoreGraphics
import Foundation
import Testing
@testable import AgathonBoard

/// Problem pages (docs/PROBLEM-PAGES.md): the screen's `meta.page`, the page's layout in page units,
/// the template's paths, and the board's page operations (a page put after this one; "New page for
/// this one" as one undo step).
@MainActor
struct ProblemPageTests {
    @Test func aPageRoundTripsThroughTheScreensMeta() throws {
        let page = ProblemPage(setId: "daily:2026-10-19", index: 2, count: 5, problem: "problem:abc", origin: "practice", workTop: 316.004)
        var screen = ScreenRecord(id: "screen:p", order: "a1")
        #expect(screen.problemPage == nil)
        screen.problemPage = page
        let read = try #require(screen.problemPage)
        #expect(read.setId == "daily:2026-10-19" && read.index == 2 && read.count == 5 && read.problem == "problem:abc")
        #expect(read.origin == "practice" && read.answer && read.inSet && !read.isLast)
        #expect(read.workTop == 316, "kept to 2 decimals, as the board keeps numbers")
        // through the document's JSON and back
        let doc = BoardDocument([.screen(screen)])
        let again = try BoardDocument.decode(doc.encoded())
        #expect(again.screens.first?.problemPage == read)
        // made plain again
        screen.problemPage = nil
        #expect(screen.meta["page"] == nil && screen.problemPage == nil)
        // an unknown kind (a newer app's) is no page here
        #expect(ProblemPage(meta: ["page": ["kind": "quiz"]]) == nil)
        #expect(ProblemPage(meta: ["page": ["kind": "done", "set": "s"]])?.kind == .done)
    }

    @Test func theLayoutLeavesSixRowsUnderAOneLineProblemAndAlwaysTwo() {
        let L = ProblemPageLayout.self
        #expect(L.defaultWorkTop == 186)
        #expect(L.rules(workTop: L.defaultWorkTop) == [260, 340, 420, 500, 580, 660])
        // a one-line problem (ink to ~110): the default
        #expect(L.workTop(problemBottom: 110) == 186)
        // a three-line word problem (ink to 280): five rows
        let top3 = L.workTop(problemBottom: 280)
        #expect(top3 == 316)
        #expect(L.rules(workTop: top3) == [390, 470, 550, 630, 710])
        // a very tall problem: the work area still keeps two rows over the answer spot
        let tall = L.workTop(problemBottom: 800)
        #expect(L.rules(workTop: tall).count == L.minRows)
        #expect(L.rules(workTop: tall).last! <= L.workBottom)
        #expect(L.workBottom < L.answer.y, "the rows end above the answer spot")
        // the answer spot: a line whose middle is in it
        #expect(L.isInAnswer(Box(x: 300, y: 770, w: 160, h: 60)))
        #expect(!L.isInAnswer(Box(x: 300, y: 600, w: 160, h: 60)))
        #expect(!L.isInAnswer(Box(x: 1100, y: 770, w: 160, h: 60)), "the action corner is no answer spot")
    }

    @Test func theTemplateIsVectorPathsOnTheProblemPageOnly() throws {
        let page = ProblemPage(origin: "practice")
        let t = try #require(PageTemplate(page: page, screen: .screen))
        #expect(!t.rules.isEmpty && !t.label.isEmpty && !t.answer.isEmpty && !t.answerLabel.isEmpty)
        // the rules are where the layout says
        let rules = t.rules.boundingBoxOfPath
        #expect(abs(rules.minY - 260) < 0.5 && abs(rules.maxY - 660) < 0.5)
        #expect(abs(rules.minX - 88) < 0.5 && abs(rules.maxX - 1160) < 0.5)
        // "Answer:" sits inside the answer spot, "Work it out here" above the first rule
        let spot = t.answer.boundingBoxOfPath
        #expect(spot.contains(t.answerLabel.boundingBoxOfPath))
        #expect(t.label.boundingBoxOfPath.maxY < 260)
        // no answer spot: nothing there
        var noAnswer = page
        noAnswer.answer = false
        #expect(try #require(PageTemplate(page: noAnswer, screen: .screen)).answer.isEmpty)
        // the All done page draws nothing on the page
        #expect(PageTemplate(page: ProblemPage(kind: .done), screen: .screen) == nil)
        // a bigger (converted) screen: the template scales with it
        let big = try #require(PageTemplate(page: page, screen: Box(x: -100, y: 0, w: 3200, h: 1800)))
        #expect(abs(big.rules.boundingBoxOfPath.minY - 520) < 1)
        // it draws (the thumbnail's path)
        let ctx = try #require(TileRasterizer.makeContext(rect: .screen, scale: 0.25))
        t.draw(in: ctx, colors: .blocks)
    }

    func controller(_ records: [BoardRecord] = []) -> BoardController {
        let doc = BoardDocument([.screen(ScreenRecord(id: "screen:a", order: "a0")), .screen(ScreenRecord(id: "screen:b", order: "a1"))] + records)
        return BoardController(document: doc, defaults: UserDefaults(suiteName: "test.pages.\(UUID())")!)
    }

    @Test func aPageGoesRightAfterThisOne() throws {
        let c = controller()
        let page = ProblemPage(setId: "s", index: 1, count: 2, origin: "chat")
        let id = try #require(c.insertScreen(after: "screen:a", meta: ["page": page.json], origin: .tutor))
        #expect(c.store.screenIDs == ["screen:a", id, "screen:b"])
        #expect(c.currentScreenID == id)
        #expect(c.currentScreen?.problemPage == page)
        // the tutor's page is no kid undo step
        #expect(!c.store.canUndo)
        // after the last: at the end
        let end = try #require(c.insertScreen(after: "screen:b", go: false))
        #expect(c.store.screenIDs.last == end && c.currentScreenID == id)
        // a page's meta set later (the problem written on it)
        var written = page
        written.problem = "problem:x"
        written.workTop = 316
        c.setProblemPage(written, on: id)
        #expect(c.currentScreen?.problemPage?.problem == "problem:x")
    }

    @Test func newPageForThisOneMovesTheInkAsOneUndoStep() throws {
        let a1 = line("stroke:a1", 100, 300, y: 300, order: "a1")
        let a2 = line("stroke:a2", 100, 300, y: 380, order: "a2")
        let keep = line("stroke:k", 100, 300, y: 200, order: "a0")
        let lineRec = LineRecord(id: "line:n", screen: "screen:a", strokes: ["stroke:a1", "stroke:a2"], latex: "5y + 2 = 17")
        let mark = MarkRecord(id: "mark:n", screen: "screen:a", kind: .ring, target: "line:n", strokes: [])
        let c = controller([.stroke(a1), .stroke(a2), .stroke(keep), .line(lineRec), .mark(mark)])
        let page = ProblemPage(origin: "student")
        let id = try #require(c.moveToNewScreen(["stroke:a1", "stroke:a2"], offset: Vec2(-12, -240), meta: ["page": page.json],
                                                alsoRemove: ["line:n", "mark:n"]))
        #expect(c.store.screenIDs == ["screen:a", id, "screen:b"], "right after the page it came from")
        #expect(c.currentScreenID == id)
        let moved = try #require(c.store.stroke("stroke:a1"))
        #expect(moved.screen == id && moved.x == a1.x - 12 && moved.y == a1.y - 240)
        #expect(try #require(c.store.stroke("stroke:a2")).order > moved.order, "z-order kept")
        #expect(c.store.stroke("stroke:k")?.screen == "screen:a", "the rest stays")
        #expect(c.store["line:n"] == nil && c.store["mark:n"] == nil)
        #expect(c.currentScreen?.problemPage?.origin == "student")
        // one undo puts it all back and shows the page it came from
        c.undo()
        #expect(c.store.screenIDs == ["screen:a", "screen:b"])
        #expect(c.store.stroke("stroke:a1")?.screen == "screen:a" && c.store.stroke("stroke:a1")?.y == a1.y)
        #expect(c.store["line:n"] != nil && c.store["mark:n"] != nil)
        #expect(c.currentScreenID == "screen:a", "back on the page before the one that went")
        #expect(!c.store.canUndo)
        // nothing of this screen to move: nothing happens
        #expect(c.moveToNewScreen(["stroke:nope"]) == nil)
    }
}

#if canImport(UIKit)
import UIKit

/// The canvas draws a problem page's template under the ink, and nothing on a plain page.
@MainActor
struct ProblemPageCanvasTests {
    @Test func theCanvasShowsTheTemplateOnAProblemPageOnly() throws {
        var page = ScreenRecord(id: "screen:p", order: "a1")
        page.problemPage = ProblemPage(setId: "s", index: 1, count: 2, origin: "practice")
        let doc = BoardDocument([.screen(ScreenRecord(id: "screen:a", order: "a0")), .screen(page)])
        let c = BoardController(document: doc, defaults: UserDefaults(suiteName: "test.template.\(UUID())")!)
        let v = BoardCanvasView(controller: c)
        v.frame = CGRect(x: 0, y: 0, width: 1376, height: 1032)
        v.layoutIfNeeded()
        c.resetScene()
        #expect(!v.showsTemplate, "a plain page has none")
        c.goToScreen("screen:p")
        #expect(v.showsTemplate)
        #expect(v.showsTemplateLabel, "Work it out here, on an empty page")
        // the kid writes: the label steps aside; the tutor's ink alone does not move it
        c.commitStroke(line("stroke:k", 120, 300, y: 200, order: "a1", screen: "screen:p"))
        #expect(v.showsTemplate && !v.showsTemplateLabel)
        c.undo()
        #expect(v.showsTemplateLabel)
        // the page made plain again (the screen's own record changed)
        c.setProblemPage(nil, on: "screen:p")
        #expect(!v.showsTemplate)
        c.setProblemPage(ProblemPage(kind: .done, setId: "s"), on: "screen:p")
        #expect(!v.showsTemplate, "the All done page draws nothing on the page")
    }
}
#endif
