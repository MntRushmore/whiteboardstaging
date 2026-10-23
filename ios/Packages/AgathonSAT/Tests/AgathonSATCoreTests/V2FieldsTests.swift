import Foundation
import Testing
@testable import AgathonSATCore

/// The v2 bank fields (docs/SAT-V2.md, "Bank additions") are all optional: a v1 question decodes as
/// before, a v2 one carries them, and a malformed one is left out without losing the question.
struct V2FieldsTests {
    private func decode(_ json: String) throws -> [SATQuestion] {
        try JSONDecoder().decode(SATNextReply.self, from: Data(json.utf8)).questions
    }

    @Test func aV1QuestionHasNoneOfThem() throws {
        let q = try #require(try decode(#"""
        {"questions":[{"id":"algebra-linear-functions-0042","domain":"algebra","skill":"linear functions","difficulty":3,
          "format":"mcq","stem":"x","figure":null,
          "choices":[{"key":"A","text":"$13$"},{"key":"B","text":"$15$"},{"key":"C","text":"$17$"},{"key":"D","text":"$3$"}],
          "answer":{"key":"A"},"solution":{"steps":[{"text":"a","math":null},{"text":"b","math":null}],"desmos_tip":null}}]}
        """#).first)
        #expect(q.nudge == nil)
        #expect(q.commonWrong == nil)
        #expect(q.review == false)
        #expect(q.choices?.allSatisfy { $0.why == nil } == true)
        #expect(q.solution.desmosSteps == nil)
        #expect(!q.solution.hasDesmosWay)
    }

    @Test func aV2QuestionCarriesThemAll() throws {
        let qs = try decode(#"""
        {"questions":[{"id":"algebra-linear-two-var-0007","domain":"algebra","skill":"linear equations in two variables","difficulty":2,
          "format":"mcq","stem":"x","review":true,"nudge":"What's the slope between the two labeled points?",
          "choices":[{"key":"A","text":"a"},{"key":"B","text":"b","why":"Swapped rise and run: (2-0)/(0-4)."},{"key":"C","text":"c"},{"key":"D","text":"d","why":""}],
          "answer":{"key":"A"},
          "solution":{"steps":[{"text":"a","math":"m=-2"},{"text":"b","math":null}],"desmos_tip":null,
                      "desmos_steps":[{"text":"Type y = 4(x-3)+7","math":"y=4(x-3)+7"},{"text":"Tap the crossing","math":null}]}},
         {"id":"psda-ratios-rates-0003","domain":"psda","skill":"ratios, rates, proportions, units","difficulty":1,"format":"spr","stem":"x",
          "common_wrong":[{"answer":"-1/2","why":"Took the reciprocal."},{"answer":4}],
          "answer":{"accepted":["3/4","0.75"]},"solution":{"steps":[{"text":"a"},{"text":"b"}],"desmos_steps":[]}}]}
        """#)
        #expect(qs.count == 2)
        let mcq = qs[0]
        #expect(mcq.review)
        #expect(mcq.nudge == "What's the slope between the two labeled points?")
        #expect(mcq.why("B") == "Swapped rise and run: (2-0)/(0-4).")
        #expect(mcq.why("A") == nil)
        // an empty why is no note
        #expect(mcq.why("D") == nil)
        #expect(mcq.solution.desmosSteps?.count == 2)
        #expect(mcq.solution.desmosSteps?.first?.math == "y=4(x-3)+7")
        #expect(mcq.solution.hasDesmosWay)
        let spr = qs[1]
        // a malformed entry (an answer that is no string, no why) is left out, the rest kept
        #expect(spr.commonWrong == [SATCommonWrong(answer: "-1/2", why: "Took the reciprocal.")])
        #expect(spr.commonWrongNote(for: "-2/4")?.why == "Took the reciprocal.")
        #expect(spr.commonWrongNote(for: "3/4") == nil)
        // an empty Desmos way is none
        #expect(spr.solution.desmosSteps == nil)
        #expect(spr.review == false)
    }

    @Test func aMalformedFieldNeverCostsTheQuestion() throws {
        let q = try #require(try decode(#"""
        {"questions":[{"id":"psda-percentages-0001","domain":"psda","skill":"percentages","difficulty":1,"format":"spr","stem":"x",
          "nudge":42,"review":"yes","common_wrong":"none","answer":{"accepted":["5"]},
          "solution":{"steps":[{"text":"a"},{"text":"b"}],"desmos_steps":{"text":"no"}}}]}
        """#).first)
        #expect(q.nudge == nil)
        #expect(q.review == false)
        #expect(q.commonWrong == nil)
        #expect(q.solution.desmosSteps == nil)
    }

    @Test func theyRoundTrip() throws {
        let q = try #require(SATFixtures.question("algebra-linear-two-var-9004"))
        var reviewed = q
        reviewed.review = true
        let back = try JSONDecoder().decode(SATQuestion.self, from: JSONEncoder().encode(reviewed))
        #expect(back == reviewed)
        #expect(back.nudge != nil)
        #expect(back.why("B") != nil)
    }

    @Test func progressReadsTheDeck() throws {
        let p = try JSONDecoder().decode(SATProgress.self, from: Data(#"{"answered":3,"correct":1,"reviews_due":2,"reviews_waiting":5}"#.utf8))
        #expect(p.reviewsDue == 2)
        #expect(p.reviewsWaiting == 5)
        let old = try JSONDecoder().decode(SATProgress.self, from: Data(#"{"answered":3,"correct":1}"#.utf8))
        #expect(old.reviewsDue == nil)
        #expect(old.reviewsWaiting == nil)
    }

    /// The hand-filled fixtures: every why on a wrong choice only, no nudge that gives the answer away.
    @Test func theFixturesNotesAreSound() throws {
        for q in SATFixtures.questions {
            if let key = q.answer.key { #expect(q.why(key) == nil, "\(q.id): the right choice has a why") }
            for c in q.choices ?? [] { #expect((c.why ?? "").count <= 140, "\(q.id) \(c.key)'s why is too long") }
            if let nudge = q.nudge {
                #expect(nudge.count <= 120, "\(q.id): the nudge is too long")
                if let key = q.answer.key, let right = q.choices?.first(where: { $0.key == key }) {
                    #expect(!nudge.contains(right.text), "\(q.id): the nudge gives the answer away")
                }
            }
            for w in q.commonWrong ?? [] { #expect(!SATGridIn.isCorrect(w.answer, accepted: q.answer.accepted ?? []), "\(q.id): \(w.answer) is right") }
        }
        #expect(SATFixtures.questions.filter { $0.nudge != nil }.count >= 8)
        #expect(SATFixtures.questions.contains { $0.solution.hasDesmosWay })
    }
}

/// The wrong-answer note and the deck's "Back in 1 day" in the session (docs/SAT-V2.md).
@MainActor
struct WrongNoteTests {
    private func practice() async throws -> (SATPractice, SATStubService) {
        let stub = SATStubService()
        let p = SATPractice(service: stub, sessionId: "s1")
        p.addSet(try await stub.next(SATNextRequest()))
        return (p, stub)
    }

    @Test func aWrongChoiceGetsItsWhyThenTryAgain() async throws {
        let (p, _) = try await practice()
        // question 1: A is "subtracted 5 instead of adding it"
        p.choose("A")
        #expect(p.check() == .lookAgain)
        #expect(p.item.wrongNote == SATPractice.WrongNote(answer: "A", why: "Subtracted 5 from 9 instead of adding it: 2x = 4.", isChoice: true))
        p.tryAgain()
        #expect(p.item.wrongNote == nil)
        #expect(p.item.chosen == nil)
        #expect(p.item.tries == ["A"])
        p.choose("C")
        #expect(p.check() == .right)
        #expect(p.item.wrongNote == nil)
    }

    @Test func aWrongChoiceWithNoWhyIsV1sLookAgain() async throws {
        let (p, _) = try await practice()
        // question 1's B has no why (the bank dropped it rather than guess)
        p.choose("B")
        #expect(p.check() == .lookAgain)
        #expect(p.item.wrongNote == nil)
        #expect(p.item.verdict == .lookAgain)
    }

    @Test func aCommonWrongGridIn() async throws {
        let (p, _) = try await practice()
        p.show(5)
        #expect(p.current?.id == "psda-ratios-rates-9006")
        for k: SATGridIn.Key in [.digit(4), .slash, .digit(3)] { p.press(k) }
        #expect(p.check() == .lookAgain)
        #expect(p.item.wrongNote?.why == "That's milk for each cup of flour, the ratio upside down.")
        #expect(p.item.wrongNote?.isChoice == false)
        // typing again closes it
        p.press(.delete)
        #expect(p.item.wrongNote == nil)
    }

    @Test func aMissComesBackInADay() async throws {
        let (p, _) = try await practice()
        p.choose("A")
        p.check()
        p.choose("C")
        p.check()
        p.show(1)
        p.choose("A")
        p.check()
        let rows = p.summary().rows
        #expect(rows[0].backInDays == 1, "right on the second try: a wrong answer was sent")
        #expect(rows[1].backInDays == nil)
        #expect(rows[2].backInDays == nil, "not answered")
    }
}
