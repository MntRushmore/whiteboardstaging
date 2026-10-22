import AgathonKit
import Foundation
import Testing
@testable import AgathonSATCore

/// The session's answer flow (docs/SAT-MODE.md, "Check" and "End of set") and the free tutor's gate.
@MainActor
struct PracticeTests {
    /// A clock the test moves.
    final class Clock: @unchecked Sendable {
        var t = Date(timeIntervalSince1970: 1_800_000_000)
        func advance(_ s: Double) { t = t.addingTimeInterval(s) }
    }

    func practice(_ stub: SATStubService = SATStubService(), clock: Clock = Clock()) async throws -> SATPractice {
        let p = SATPractice(service: stub, sessionId: "s1", now: { clock.t })
        p.addSet(try await stub.next(SATNextRequest()))
        return p
    }

    @Test func aRightAnswerIsGreenFirstTimeAndAnAttemptIsSent() async throws {
        let stub = SATStubService()
        let clock = Clock()
        let p = try await practice(stub, clock: clock)
        #expect(p.current?.id == "algebra-linear-one-var-9001")
        #expect(p.item.number == 1 && p.item.count == 10)
        #expect(p.check() == .notReady(nil))
        p.choose("C")
        clock.advance(42)
        #expect(p.check() == .right)
        #expect(p.item.verdict == .right(firstTry: true))
        // checked for good: no more changes, no second attempt
        p.choose("A")
        #expect(p.item.chosen == "C")
        #expect(p.check() == .locked)
        await p.settle()
        #expect(stub.attempts == [SATAttempt(questionId: "algebra-linear-one-var-9001", chosen: "C", correct: true, seconds: 42, usedTutor: false)])
    }

    @Test func wrongGetsOneMoreTryThenTheSolution() async throws {
        let stub = SATStubService()
        let p = try await practice(stub)
        p.choose("A")
        #expect(p.check() == .lookAgain)
        #expect(p.item.verdict == .lookAgain)
        #expect(p.answerAlreadyTried)
        // the same wrong answer again is no second try
        #expect(p.check() == .lookAgain)
        #expect(p.item.tries == ["A"])
        p.choose("B")
        #expect(p.check() == .missed)
        #expect(p.item.verdict == .missed)
        p.setSolutionOpen(true)
        #expect(p.item.solutionOpen)
        await p.settle()
        #expect(stub.attempts.map(\.chosen) == ["A", "B"])
        #expect(stub.attempts.map(\.correct) == [false, false])
    }

    @Test func rightOnTheSecondTryIsRightButNotFirstTime() async throws {
        let p = try await practice()
        p.choose("A")
        p.check()
        p.choose("C")
        #expect(p.check() == .right)
        #expect(p.item.verdict == .right(firstTry: false))
    }

    @Test func theEliminatorStrikesAndBringsBack() async throws {
        let p = try await practice()
        p.choose("B")
        p.toggleEliminated("B")
        #expect(p.item.chosen == nil)
        #expect(p.item.eliminated == ["B"])
        p.toggleEliminated("D")
        // choosing a struck choice brings it back
        p.choose("D")
        #expect(p.item.chosen == "D")
        #expect(p.item.eliminated == ["B"])
        p.toggleEliminated("B")
        #expect(p.item.eliminated.isEmpty)
    }

    @Test func aGridInChecksByTheRules() async throws {
        let stub = SATStubService()
        let p = try await practice(stub)
        p.show(2)
        #expect(p.current?.format == .spr)
        // the keypad never makes it something no grid-in could be
        p.press(.slash)
        #expect(p.item.typed == "")
        p.press(.digit(4))
        p.press(.slash)
        #expect(p.check() == .notReady(.unfinished))
        #expect(p.item.hint == .unfinished)
        p.press(.delete)
        p.press(.delete)
        p.press(.digit(3))
        #expect(p.check() == .lookAgain)
        p.press(.delete)
        p.type("8/2")
        #expect(p.item.typed == "8/2")
        // 8/2 is 4: the same value as the accepted form
        #expect(p.check() == .right)
        // choices mean nothing on a grid-in
        p.choose("A")
        #expect(p.item.chosen == nil)
        await p.settle()
        #expect(stub.attempts.map(\.chosen) == ["3", "8/2"])
    }

    @Test func timeIsCountedPerQuestion() async throws {
        let clock = Clock()
        let p = try await practice(clock: clock)
        clock.advance(10)
        p.show(1)
        clock.advance(25)
        p.show(0)
        clock.advance(5)
        #expect(p.seconds(at: 0) == 15)
        #expect(p.seconds(at: 1) == 25)
        p.stopClock()
        clock.advance(100)
        #expect(p.seconds(at: 0) == 15)
    }

    @Test func movingStaysInTheSet() async throws {
        let p = try await practice()
        #expect(!p.hasPrevious)
        p.next()
        #expect(p.index == 1)
        p.show(9)
        #expect(p.isLastInSet)
        p.next()
        #expect(p.index == 9)
        #expect(!p.hasNext)
    }

    @Test func theEndOfASetAndTheMissedOnes() async throws {
        let stub = SATStubService()
        let p = try await practice(stub)
        let qs = p.questions
        // 1 right, 2 right on the second try, 3 missed, the rest not answered
        p.choose("C"); p.check()
        p.show(1); p.choose("B"); p.check(); p.choose("A"); p.check()
        p.show(2); p.type("9"); p.check(); p.press(.clear); p.type("1"); p.check()
        p.show(3); p.toggleMarked()
        let s = p.summary()
        #expect(s.count == 10)
        #expect(s.rightFirstTry == 1)
        #expect(s.rightSecondTry == 1)
        #expect(s.rows[0].verdict == .right(firstTry: true))
        #expect(s.rows[2].verdict == .missed)
        #expect(s.rows[3].marked)
        #expect(s.toReview == Array(1...9))
        p.reviewMissed()
        #expect(p.reviewing == Array(1...9))
        #expect(p.index == 1)
        p.next()
        #expect(p.index == 2)
        p.previous()
        p.previous()
        #expect(p.index == 1)
        // Practice 10 more: the next set on the same session, numbered from 1 again
        let more = p.addSet(try await stub.next(SATNextRequest()))
        #expect(more == 10..<20)
        #expect(p.index == 10)
        #expect(p.reviewing == nil)
        #expect(p.item.number == 1 && p.item.set == 1)
        #expect(p.setId(1) == "sat:s1:2")
        #expect(p.pageHeading(10) == "Q1 · \(p.questions[10].skillTitle)")
        #expect(qs.count == 10)
    }

    @Test func aFailedAttemptIsSentWithTheNext() async throws {
        let stub = SATStubService()
        let p = try await practice(stub)
        stub.offline = true
        p.choose("C")
        p.check()
        await p.settle()
        #expect(stub.attempts.isEmpty)
        #expect(p.unsent.count == 1)
        stub.offline = false
        p.show(1)
        p.choose("A")
        p.check()
        await p.settle()
        #expect(stub.attempts.map(\.questionId) == ["algebra-linear-one-var-9001", "algebra-linear-functions-9002"])
        #expect(p.unsent.isEmpty)
    }

    // MARK: - the free tutor

    @Test func fiveFreeTutorQuestionsADayThenTheBoardIsPlainInk() async throws {
        let stub = SATStubService(cap: 5)
        let p = try await practice(stub)
        for i in 0..<5 {
            guard case .on(let pass) = await p.openTutor(at: i) else { Issue.record("question \(i) had no tutor"); return }
            #expect(pass.usedToday == i + 1)
        }
        guard case .capped(let pass) = await p.openTutor(at: 5) else { Issue.record("the sixth was not capped"); return }
        #expect(pass.usedToday == 5 && pass.cap == 5)
        #expect(p.lastPass?.left == 0)
        // a question opened again keeps its pass (idempotent per question and day)
        #expect(await p.openTutor(at: 2).isOn)
        #expect(stub.tutorAsked.count == 5)
    }

    @Test func unlimitedLiftsTheCap() async throws {
        let stub = SATStubService(cap: 5, usedBefore: 5, unlimited: true)
        let p = try await practice(stub)
        guard case .on(let pass) = await p.openTutor(at: 7) else { Issue.record("no tutor with Unlimited"); return }
        #expect(pass.unlimited)
        #expect(pass.left == nil)
    }

    @Test func alreadyCappedTodayAndOffline() async throws {
        let stub = SATStubService(cap: 5, usedBefore: 5)
        let p = try await practice(stub)
        if case .capped = await p.openTutor(at: 0) {} else { Issue.record("not capped") }
        stub.offline = true
        p.resetTutor(at: 1)
        #expect(await p.openTutor(at: 1) == .unavailable)
        // a refusal on a live call: off on that question
        stub.offline = false
        let q = SATStubService(cap: 5)
        let p2 = try await practice(q)
        #expect(await p2.openTutor(at: 0).isOn)
        p2.tutorRefused(at: 0)
        if case .capped = p2.items[0].tutor {} else { Issue.record("still on after a refusal") }
    }

    @Test func usedTutorIsSentOnlyWhenTheTutorWasOn() async throws {
        let stub = SATStubService(cap: 1)
        let p = try await practice(stub)
        _ = await p.openTutor(at: 0)
        p.noteTutorUsed(at: 0)
        p.choose("C")
        p.check()
        // the second question has no pass: helping there is impossible, so it is never "used"
        _ = await p.openTutor(at: 1)
        p.noteTutorUsed(at: 1)
        p.show(1)
        p.choose("A")
        p.check()
        await p.settle()
        #expect(stub.attempts.map(\.usedTutor) == [true, false])
    }

    // MARK: - progress, as the stub counts it (the server's own rules are the bank lane's)

    @Test func progressCountsFirstAnswersAndShowsAnEstimateOnlyAfter15() async throws {
        let stub = SATStubService()
        var progress = try await stub.progress()
        #expect(progress.answered == 0)
        #expect(progress.estimate == nil)
        for q in SATFixtures.questions.prefix(14) {
            try await stub.record(SATAttempt(questionId: q.id, chosen: "A", correct: true, seconds: 10, usedTutor: false))
        }
        progress = try await stub.progress()
        #expect(progress.answered == 14)
        #expect(progress.estimate == nil)
        let q = SATFixtures.questions[14]
        try await stub.record(SATAttempt(questionId: q.id, chosen: "A", correct: false, seconds: 10, usedTutor: false))
        progress = try await stub.progress()
        let band = try #require(progress.estimate)
        #expect(band.low >= 200 && band.high <= 800 && band.low < band.high)
        #expect(progress.count(.algebra).answered > 0)
    }
}
