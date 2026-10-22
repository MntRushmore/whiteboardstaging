import CoreGraphics
import Foundation
import Testing
@testable import AgathonBoard

/// "More room" (docs/PROBLEM-PAGES.md): one problem over more pages — the page's new meta keys
/// (`continues`, `more`), the problem's pages as a group, the step that adds a page (the problem again
/// small at its top, the answer spot moved on, one kid undo step), and the template's words for it.
@MainActor
struct MoreRoomTests {
    /// A practice set's problem 2 of 3 on `screen:p2` (the tutor's problem across its top), between
    /// problem 1 and problem 3, and the kid's work under it.
    func board() -> BoardController {
        func page(_ id: RecordID, _ order: OrderKey, _ index: Int) -> BoardRecord {
            var s = ScreenRecord(id: id, order: order)
            s.problemPage = ProblemPage(setId: "daily:t", index: index, count: 3, problem: "problem:p2", origin: "practice")
            return .screen(s)
        }
        var problem = line("stroke:problem", 88, 488, y: 90, order: "a0", screen: "screen:p2", author: .tutor)
        problem.color = .tutor
        problem.meta = ["chatProblem": ["n": 1, "lines": ["2x + 3 = 11"]], "live": true, "handBlock": "hb_1"]
        let work = line("stroke:work", 100, 400, y: 650, order: "a1", screen: "screen:p2")
        let tick = MarkRecord(id: "mark:t", screen: "screen:p2", kind: .tick, target: "line:w", strokes: [])
        var tickInk = line("stroke:tick", 90, 110, y: 120, order: "a2", screen: "screen:p2", author: .tutor)
        tickInk.meta = ["mark": "check:1,2,3,4", "live": true]
        let doc = BoardDocument([page("screen:p1", "a0", 1), page("screen:p2", "a1", 2), page("screen:p3", "a2", 3),
                                 .stroke(problem), .stroke(work), .stroke(tickInk), .mark(tick)])
        let c = BoardController(document: doc, defaults: UserDefaults(suiteName: "test.moreroom.\(UUID())")!)
        c.goToScreen("screen:p2")
        return c
    }

    @Test func theNewKeysRoundTripAndMoveTheAnswerSpot() throws {
        let page = ProblemPage(setId: "s", index: 2, count: 3, origin: "practice", continues: "screen:p2", more: true)
        var screen = ScreenRecord(id: "screen:x", order: "a1")
        screen.problemPage = page
        let again = try BoardDocument.decode(BoardDocument([.screen(screen)]).encoded())
        let read = try #require(again.screens.first?.problemPage)
        #expect(read.continues == "screen:p2" && read.more && read.isContinuation)
        #expect(!read.hasAnswerSpot, "a page with more after it has no answer spot")
        // the keys are left out at their defaults (an older page reads as it did)
        let plain = ProblemPage(origin: "practice")
        #expect(plain.json["continues"] == nil && plain.json["more"] == nil)
        #expect(plain.hasAnswerSpot && !plain.isContinuation)
        // a drawing problem's last page has none either
        #expect(!ProblemPage(origin: "practice", answer: false).hasAnswerSpot)
    }

    @Test func morePageGoesRightAfterTheProblemWithItsProblemSmallAtTheTop() throws {
        let c = board()
        #expect(c.store.problemGroup(of: "screen:p2") == nil, "one page: no group")
        let id = try #require(c.addMoreRoom())
        // right after problem 2, before problem 3, and shown
        #expect(c.store.screenIDs == ["screen:p1", "screen:p2", id, "screen:p3"])
        #expect(c.currentScreenID == id)
        // the new page is problem 2's: its place in the set, its record, its answer spot
        let page = try #require(c.currentScreen?.problemPage)
        #expect(page.continues == "screen:p2" && page.index == 2 && page.count == 3 && page.setId == "daily:t")
        #expect(page.problem == "problem:p2" && page.origin == "practice" && page.hasAnswerSpot)
        // the page before lost its answer spot
        let before = try #require(c.store["screen:p2"]?.screen?.problemPage)
        #expect(before.more && !before.hasAnswerSpot && before.answer)
        // the group
        let group = try #require(c.store.problemGroup(of: id))
        #expect(group.first == "screen:p2" && group.pages == ["screen:p2", id] && group.part(of: id) == 2 && group.last == id)
        #expect(c.store.problemGroup(of: "screen:p2") == group)
        #expect(c.store.problemGroup(of: "screen:p3") == nil)
        // the problem again, small: the tutor's problem only (no mark, no kid ink), the tutor's, locked
        let copies = c.store.drawables(on: id)
        #expect(copies.count == 1)
        guard case .stroke(let copy)? = copies.first else { Issue.record("no copy"); return }
        #expect(copy.author == .tutor && copy.color == .tutor)
        #expect(copy.meta[MoreRoom.reminderMeta]?.stringValue == "screen:p2" && copy.meta["locked"]?.boolValue == true)
        #expect(copy.meta["chatProblem"] == nil && copy.meta["live"] == nil, "no problem record, no live writing on the copy")
        let box = try #require(MoreRoom.bounds(of: .stroke(copy)))
        #expect(abs(box.x - 88) < 0.5 && abs(box.y - 88) < 0.5, "\(box)")
        #expect(abs(box.w - 180) < 1, "a little under half size: \(box)")
        #expect(abs(copy.width - 6 * 0.45) < 0.01)
        // its work area starts under the copy: a row more than the first page
        #expect(page.resolvedWorkTop == ProblemPageLayout.continuedMinWorkTop)
        #expect(ProblemPageLayout.rules(workTop: page.resolvedWorkTop).count == ProblemPageLayout.rules(workTop: ProblemPageLayout.defaultWorkTop).count + 1)
        // a one-line problem in the tutor's hand (about 85 tall) gets the same; a three-line word problem (220) a row more than its 5
        #expect(ProblemPageLayout.continuedWorkTop(reminderBottom: 88 + 85 * 0.45) == 150)
        let word = ProblemPageLayout.continuedWorkTop(reminderBottom: 88 + 60)
        #expect(ProblemPageLayout.rules(workTop: word).count == ProblemPageLayout.rules(workTop: ProblemPageLayout.workTop(problemBottom: 280)).count + 1)
        // ONE kid undo step takes it all back, and shows the page it came from
        c.undo()
        #expect(c.store.screenIDs == ["screen:p1", "screen:p2", "screen:p3"])
        #expect(c.store["screen:p2"]?.screen?.problemPage?.more == false)
        #expect(c.currentScreenID == "screen:p2")
        #expect(c.store.drawables(on: id).isEmpty)
    }

    @Test func aThirdPageContinuesTheFirstAndPagesPutAfterThisOneKeepTheProblemTogether() throws {
        let c = board()
        let p2b = try #require(c.addMoreRoom())
        let p2c = try #require(c.addMoreRoom())
        #expect(c.store.screenIDs == ["screen:p1", "screen:p2", p2b, p2c, "screen:p3"])
        #expect(c.store["screen:p2"]?.screen?.problemPage?.more == true)
        #expect(c.store[p2b]?.screen?.problemPage?.more == true && c.store[p2b]?.screen?.problemPage?.continues == "screen:p2")
        #expect(c.store[p2c]?.screen?.problemPage?.continues == "screen:p2", "every page continues the first")
        #expect(c.store.problemGroup(of: p2b)?.pages == ["screen:p2", p2b, p2c])
        // its copy is of the first page's problem (not of the page before)
        #expect(c.store.drawables(on: p2c).allSatisfy { $0.meta[MoreRoom.reminderMeta]?.stringValue == "screen:p2" })
        // a page put "after this one" from the problem's first page goes after its last
        c.goToScreen("screen:p2")
        let after = try #require(c.insertScreen(meta: [:], go: false))
        #expect(c.store.screenIDs == ["screen:p1", "screen:p2", p2b, p2c, after, "screen:p3"])
        // at most four pages a problem
        _ = try #require(c.addMoreRoom())
        #expect(c.store.problemGroup(of: "screen:p2")?.count == 4)
        #expect(c.addMoreRoom() == nil)
        // no problem page, no more room
        c.goToScreen(after)
        #expect(c.addMoreRoom() == nil)
    }

    @Test func newPageForThisOneFromAContinuedProblemGoesAfterItsLastPage() throws {
        let c = board()
        let p2b = try #require(c.addMoreRoom())
        c.goToScreen("screen:p2")
        let moved = try #require(c.moveToNewScreen(["stroke:work"], meta: ["page": ProblemPage(origin: "student").json]))
        #expect(c.store.screenIDs == ["screen:p1", "screen:p2", p2b, moved, "screen:p3"])
        #expect(c.store.problemGroup(of: moved) == nil, "the kid's own problem is no page of problem 2")
    }

    @Test func aPageWhoseFirstPageIsGoneStandsOnItsOwn() throws {
        let c = board()
        let p2b = try #require(c.addMoreRoom())
        #expect(c.deleteScreen("screen:p2"))
        #expect(c.store.problemGroup(of: p2b) == nil)
        #expect(c.store.lastPageOfProblem(p2b) == p2b)
    }

    @Test func theTemplateSaysContinuedAtTheTopAndWhereTheAnswerWent() throws {
        let continued = ProblemPage(setId: "s", index: 2, count: 3, origin: "practice", workTop: 150, continues: "screen:p2")
        let t = try #require(PageTemplate(page: continued, screen: .screen))
        #expect(PageTemplate.continuedWords(2) == "Problem 2, continued")
        #expect(PageTemplate.continuedWords(nil) == "Continued")
        let header = t.notes.boundingBoxOfPath
        #expect(!t.notes.isEmpty && header.maxY <= ProblemPageLayout.continuedBaseline + 8 && header.minY > 40, "\(header)")
        #expect(t.label.isEmpty, "no Work it out here on a continued page")
        #expect(!t.answer.isEmpty, "the answer spot is on the problem's last page")
        #expect(abs(t.rules.boundingBoxOfPath.minY - 224) < 0.5, "rows from under the problem's copy")
        // the page before: no answer spot, a word where it was
        let before = try #require(PageTemplate(page: ProblemPage(setId: "s", index: 2, count: 3, origin: "practice", more: true), screen: .screen))
        #expect(before.answer.isEmpty && before.answerLabel.isEmpty)
        let note = before.notes.boundingBoxOfPath
        #expect(ProblemPageLayout.answer.cgRect.contains(CGPoint(x: note.midX, y: note.midY)), "\(note)")
        #expect(!before.label.isEmpty)
        // a drawing problem's page before says nothing about an answer
        #expect(try #require(PageTemplate(page: ProblemPage(origin: "practice", answer: false, more: true), screen: .screen)).notes.isEmpty)
        // it draws (the thumbnail's path)
        let ctx = try #require(TileRasterizer.makeContext(rect: .screen, scale: 0.25))
        t.draw(in: ctx, colors: .blocks)
    }
}
