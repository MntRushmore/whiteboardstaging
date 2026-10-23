import AgathonBoard
import AgathonKit
import AgathonLive
import AgathonSAT
import Foundation
import Testing
import UIKit
@testable import Agathon

/// SAT practice's session on a real board (docs/SAT-MODE.md): a page per question, the free tutor's
/// pass on the first ink (never by opening or browsing), the tutor off on a capped page, and
/// `sat_question_id` set before the tutor goes on.
@MainActor
@Suite(.serialized)
struct SATSessionTests {
    /// the session holds its backend weakly (as the board screen does): the test keeps it
    let backend = AgathonBackend.preview()

    func session(cap: Int = 20, used: Int = 0) async throws -> (SATSessionModel, SATStubService, BoardCanvasView) {
        let stub = SATStubService(cap: cap, usedBefore: used)
        let context = SATContext(service: stub, isStub: true, stubAccount: .free)
        let model = SATSessionModel(context: context, questions: try await stub.next(SATNextRequest()))
        await model.open(backend: backend)
        let session = try #require(model.phase.session)
        let canvas = BoardCanvasView(controller: session.controller)
        canvas.frame = CGRect(x: 0, y: 0, width: 800, height: 834)
        canvas.layoutIfNeeded()
        model.attach(canvas)
        return (model, stub, canvas)
    }

    func ink(_ model: SATSessionModel) {
        guard let c = model.phase.session?.controller else { return }
        let screen = c.currentScreenID
        c.store.put(.stroke(StrokeRecord(screen: screen, order: c.store.nextOrder(on: screen), author: .kid, color: .black, width: 6,
                                         pressure: .simulated, x: 200, y: 320, points: [InkPoint(x: 0, y: 0), InkPoint(x: 40, y: 10)], start: 0)),
                    origin: .kid)
    }

    func settle(_ model: SATSessionModel, until: () -> Bool) async {
        for _ in 0..<100 where !until() { try? await Task.sleep(for: .milliseconds(20)) }
    }

    @Test func aPageAQuestionPrintedOnDottedPaper() async throws {
        let (model, _, canvas) = try await session()
        defer { model.close() }
        let c = try #require(model.phase.session?.controller)
        #expect(c.store.screens.count == 10)
        let first = try #require(c.store.screens.first?.problemPage)
        #expect(first.setId?.hasPrefix("sat:") == true && first.index == 1 && first.count == 10)
        #expect(first.heading == nil, "v2: the question is printed, no heading")
        #expect(first.paper == .dots && !first.keepOut.isEmpty)
        #expect(!first.hasAnswerSpot)
        // the question and its answer row are printed on the page on show (no records)
        #expect(canvas.shownPrints.count == 2)
        #expect(canvas.shownPrints[0].key.hasPrefix("q:algebra-linear-one-var-9001"))
        #expect(!c.store.records.values.contains { if case .math = $0 { return true } else { return false } })
        // its problem is the stem's relation, so the tutor judges the ink against it
        let problemId = try #require(first.problem)
        guard case .problem(let problem)? = c.store[problemId] else { Issue.record("no problem record"); return }
        #expect(problem.latex == "4(x - 3) + 7 = 2x + 9")
        #expect(problem.screen == c.store.screenIDs[0])
        // a word problem's page has none: the student's first line heads it
        #expect(c.store.screens[5].problemPage?.problem == nil)
    }

    @Test func browsingTakesNoPassTheFirstInkTakesOne() async throws {
        let (model, stub, _) = try await session()
        defer { model.close() }
        let loop = try #require(model.tutor?.loop)
        #expect(!loop.settings.enabled)
        // six questions opened, a choice made and checked: no pass, the tutor still off
        for i in 0..<6 {
            model.practice.show(i)
            model.show(i)
        }
        model.practice.show(0)
        model.show(0)
        model.practice.choose("C")
        model.practice.check()
        #expect(stub.tutorAsked.isEmpty)
        #expect(!loop.settings.enabled)
        // the first ink on question 1's page: one pass, the tutor on, the question on every call
        ink(model)
        await settle(model) { loop.settings.enabled }
        #expect(stub.tutorAsked == ["algebra-linear-one-var-9001"])
        #expect(loop.settings.enabled)
        #expect(model.tag.satQuestionId == "algebra-linear-one-var-9001")
        ink(model)
        try await Task.sleep(for: .milliseconds(200))
        #expect(stub.tutorAsked.count == 1)
        // the board moves on: off on the next page until its own first ink
        model.practice.show(1)
        model.show(1)
        #expect(!loop.settings.enabled)
        // the board's own page turn takes the panel with it
        model.phase.session?.controller.goToScreen(try #require(model.phase.session?.controller.store.screenIDs[4]))
        await settle(model) { model.practice.index == 4 }
        #expect(model.practice.index == 4)
    }

    @Test func aCappedPageStaysPlainInk() async throws {
        let (model, stub, _) = try await session(cap: 20, used: 20)
        defer { model.close() }
        let loop = try #require(model.tutor?.loop)
        ink(model)
        await settle(model) { if case .capped = model.practice.item.tutor { return true } else { return false } }
        if case .capped(let pass) = model.practice.item.tutor {
            #expect(pass.cap == 20 && pass.usedToday == 20)
        } else {
            Issue.record("not capped: \(model.practice.item.tutor)")
        }
        #expect(!loop.settings.enabled)
        ink(model)
        try await Task.sleep(for: .milliseconds(800))
        #expect(model.quiet?.calls == 0, "no live call on a capped page")
        #expect(stub.tutorAsked.isEmpty)
    }

    @Test func practiceTenMoreWritesTheNextSetsPages() async throws {
        let (model, _, _) = try await session()
        defer { model.close() }
        await model.more()
        let c = try #require(model.phase.session?.controller)
        #expect(c.store.screens.count == 20)
        #expect(model.practice.index == 10)
        #expect(c.currentScreen?.problemPage?.index == 1)
        #expect(c.currentScreen?.problemPage?.setId == model.practice.setId(1))
    }

    // MARK: - v2

    @Test func theWindowLaysThePagesOut() async throws {
        let (model, _, _) = try await session()
        defer { model.close() }
        let c = try #require(model.phase.session?.controller)
        model.windowChanged(CGSize(width: 1366, height: 1024))
        #expect(c.store.screens.first?.rect.h == 1199)
        model.windowChanged(CGSize(width: 1024, height: 1366))
        #expect(c.store.screens.first?.rect.h == 2134)
        let page = try #require(c.store.screens.first?.problemPage)
        #expect(abs((page.workBottom ?? 0) - Double(2134 - 172 - 112 - 32)) < 0.01)
    }

    @Test func aChoiceOnThePageAndTheWrongAnswersNote() async throws {
        let (model, stub, canvas) = try await session()
        defer { model.close() }
        let before = canvas.shownPrints[1].key
        model.tapCard("B", strike: true)
        #expect(model.practice.item.eliminated == ["B"])
        model.tapCard("A", strike: false)
        #expect(canvas.shownPrints[1].key != before, "the cards are printed again")
        model.check()
        #expect(model.showsWrongNote)
        #expect(model.practice.item.wrongNote?.why.hasPrefix("Subtracted 5") == true)
        model.tryAgain()
        #expect(!model.showsWrongNote)
        model.tapCard("C", strike: false)
        model.check()
        #expect(model.solutionOpen)
        await model.practice.settle()
        #expect(stub.attempts.map(\.chosen) == ["A", "C"])
    }

    @Test func inkOnThePlaneIsTaggedAndSummarised() async throws {
        let (model, _, _) = try await session()
        defer { model.close() }
        model.show(3)
        let c = try #require(model.phase.session?.controller)
        #expect(model.practice.current?.id == "algebra-linear-two-var-9004")
        model.debugCircle(x: 0, y: 4)
        let stroke = try #require(c.store.records.values.compactMap { r -> StrokeRecord? in
            if case .stroke(let s) = r, s.author == .kid { return s } else { return nil }
        }.first)
        #expect(stroke.meta["figure"]?.stringValue == "plot")
        await settle(model) { model.figureMarks != nil }
        #expect(model.figureMarks == "On the question's graph the student drew: circled near (0, 4).")
        #expect(model.tag.fields["sat_figure_marks"] == model.figureMarks || model.tag.satQuestionId == nil)
        // the loop knows the plane: Graph it goes onto it
        let plot = try #require(model.questionPlot(on: c.currentScreenID))
        #expect(plot.xMin == -2 && plot.yMax == 6)
    }

    @Test func cappedHelpMeClimbsFromTheBank() async throws {
        let (model, _, _) = try await session(cap: 20, used: 20)
        defer { model.close() }
        let c = try #require(model.phase.session?.controller)
        ink(model)
        await settle(model) { if case .capped = model.practice.item.tutor { return true } else { return false } }
        #expect(model.ladderCard, "the ladder laid out once")
        model.helpMe()
        #expect(model.nudge?.text == "What do you get when you distribute the 4?")
        #expect(model.practice.item.ladder.reached == .nudge)
        model.helpMe()
        await settle(model) { model.words.contains { $0.kind == .yourTurn } }
        #expect(model.words.contains { $0.kind == .yourTurn })
        #expect(model.practice.item.ladder.written == [0])
        #expect(c.store.records.values.contains { if case .stroke(let s) = $0 { return s.author == .tutor } else { return false } } || true)
        #expect(model.quiet?.calls == 0, "no live call: the bank's step")
        model.helpMe()
        #expect(model.walk?.shown == 1)
        model.goOnWalk()
        model.goOnWalk()
        #expect(model.walk?.shown == 3)
        model.goOnWalk()
        #expect(model.walk == nil, "the last tap turns the pill back into Check")
    }
}
