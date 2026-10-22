import AgathonBoard
import AgathonBrain
import Foundation
import Testing
@testable import AgathonLive

/// A word problem on its page (`WordProblem`): its sentences as plain words, never raw LaTeX, in the
/// tutor's hand above the work area.
@MainActor
@Suite(.serialized)
struct WordProblemTests {
    @Test func theCataloguesWordProblemsAreWords() {
        #expect(WordProblem.sentences(["\\text{Sam has 3 bags of 4 apples.}", "\\text{How many apples?}"])
            == ["Sam has 3 bags of 4 apples.", "How many apples?"])
        #expect(WordProblem.sentences(["\\text{A pen costs }2\\text{ dollars.}", "\\text{How much do 7 pens cost?}"])
            == ["A pen costs 2 dollars.", "How much do 7 pens cost?"])
        #expect(WordProblem.sentences(["25\\% \\text{ of } 80"]) == ["25% of 80"])
        #expect(WordProblem.sentences(["\\text{Each box holds }\\frac{3}{4}\\text{ kg. What do } 8 \\times 2 \\text{ boxes weigh?}"])
            == ["Each box holds 3/4 kg. What do 8 × 2 boxes weigh?"])
        #expect(WordProblem.sentences(["Sam has 3 bags of 4 apples. How many apples?"]) == ["Sam has 3 bags of 4 apples. How many apples?"])
    }

    @Test func mathsIsNotAWordProblem() {
        #expect(WordProblem.sentences(["2x + 3 = 11"]) == nil)
        #expect(WordProblem.sentences(["\\frac{1}{2} + \\frac{1}{3}"]) == nil)
        #expect(WordProblem.sentences(["x = \\square", "\\text{or}"]) == nil, "a short maths word is maths, and the box would show as LaTeX")
    }

    @Test func nothingShowsAsLaTeX() {
        // a command it has no words for keeps the problem out (the desk's refusal stands)
        #expect(WordProblem.sentences(["\\text{Find } \\sqrt{49}"]) == nil)
        #expect(WordProblem.sentences(["\\text{Work out } \\binom{5}{2}"]) == nil)
        #expect(WordProblem.sentences(["\\text{What is } 3^{4} \\text{?}"]) == nil)
        #expect(WordProblem.sentences(["\\text{A square has sides of 3 cm. Its area is } 3^{2}\\text{ cm?}"])
            == ["A square has sides of 3 cm. Its area is 3² cm?"])
    }

    @Test func theWordsFitAboveTheWork() async throws {
        let L = ProblemPageLayout.self
        let short = try #require(await WordProblem.plan(["Sam has 3 bags of 4 apples.", "How many apples?"], brain: TestBrain.shared, seedKey: "t"))
        #expect(short.size == WordProblem.handSize, "a short problem in the big hand")
        #expect(short.lines.count == 2)
        #expect(abs(short.bounds.x - L.problemOrigin.x) < 12 && abs(short.bounds.y - L.problemOrigin.y) < 1)
        #expect(short.bounds.x + short.bounds.w <= L.ruleRight + 1)
        #expect(short.bounds.y + short.bounds.h <= L.problemMaxBottom)
        // the lines go down the page, one under another
        #expect(short.lines[1].y > short.lines[0].y + 30)
        // a long one wraps, and shrinks only if it must
        let long = ["Maya is 3 years older than Leo. Together their ages add up to 21. Last year Leo gave Maya half of his 18 marbles and then he found 5 more in the garden.",
                    "How old is Leo, and how many marbles does he have now?"]
        let plan = try #require(await WordProblem.plan(long, brain: TestBrain.shared, seedKey: "t"))
        #expect(plan.bounds.x + plan.bounds.w <= L.ruleRight + 1, "wrapped to the page: \(plan.bounds)")
        #expect(plan.bounds.y + plan.bounds.h <= L.problemMaxBottom)
        #expect(plan.size >= WordProblem.minHandSize)
    }

    /// The words head no column: the loop makes no problem of them (the kid's first line is theirs).
    @Test func theWordsAreNotAProblemTheEngineSolves() async throws {
        let board = TestBoard()
        let plan = try #require(await WordProblem.plan(["Sam has 3 bags of 4 apples.", "How many apples?"], brain: TestBrain.shared, seedKey: "t"))
        InstantPen(store: board.store, screen: board.currentScreenID)
            .write(HeadlessBench.tutorLines(plan), meta: [WordProblem.meta: true, "lineId": "chat", "live": true, "source": "ai"])
        #expect(!board.store.drawables(on: board.currentScreenID).isEmpty)
        #expect(LiveLoop.strokeProblems(on: board.currentScreenID, in: board.store).isEmpty)
    }
}
