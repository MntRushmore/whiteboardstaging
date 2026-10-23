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
