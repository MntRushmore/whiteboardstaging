import Foundation
import Testing
@testable import AgathonSATCore

/// The stem's Markdown and LaTeX, the page's problem for the tutor, and the plot's expressions.
struct TextAndFigureTests {
    @Test func inlineAndDisplayMaths() {
        let blocks = SATRichText.parse("$$3x + 2y = 16$$\n$$x - y = 2$$\nThe solution is $(x, y)$. What is **the value** of $x$?")
        #expect(blocks.count == 3)
        #expect(blocks[0] == .math("3x + 2y = 16"))
        #expect(blocks[1] == .math("x - y = 2"))
        #expect(blocks[2] == .paragraph([.text("The solution is "), .math("(x, y)"), .text(". What is "), .bold([.text("the value")]),
                                         .text(" of "), .math("x"), .text("?")]))
    }

    @Test func dollarsAreMoney() {
        #expect(SATRichText.parse(#"It costs \$30 plus \$12 a month."#) == [.paragraph([.text("It costs $30 plus $12 a month.")])])
        // an unpaired $ and a pair that is clearly prices
        #expect(SATRichText.inline("Pay $5 and $3 today") == [.text("Pay $5 and $3 today")])
        #expect(SATRichText.inline("only $12") == [.text("only $12")])
    }

    @Test func paragraphsAndLists() {
        let blocks = SATRichText.parse("First line.\n\n- one $x$\n- two")
        #expect(blocks == [.paragraph([.text("First line.")]), .bullets([[.text("one "), .math("x")], [.text("two")]])])
    }

    @Test func plainWordsForVoiceOver() {
        #expect(SATMathWords.plain(#"\frac{3}{4}"#) == "3/4")
        #expect(SATMathWords.plain(#"x^2 - 5x \le 14"#) == "x² − 5x ≤ 14")
        #expect(SATMathWords.spoken("x^2 = 9").contains("squared"))
        #expect(SATRichText.plain("If $x = 3$, what is $2x$?") == "If x equals 3, what is 2x?")
    }

    @Test func thePagesProblemIsTheStemsRelations() {
        #expect(SATStemMath.problemLines("If $4(x - 3) + 7 = 2x + 9$, what is the value of $x$?") == ["4(x - 3) + 7 = 2x + 9"])
        #expect(SATStemMath.problemLines("$$3x + 2y = 16$$\n$$x - y = 2$$\nThe solution is $(x, y)$.") == ["3x + 2y = 16", "x - y = 2"])
        // a given value is context, not the problem; a word problem has none
        #expect(SATStemMath.problemLines("If $x = 3$, what is $2x + 1$?") == [])
        #expect(SATStemMath.problemLines("A recipe uses 3 cups of flour for every 4 cups of milk.") == [])
        #expect(SATStemMath.problemLines("What is $\\text{the mean} = ?$") == [])
        #expect(SATStemMath.problemLines("Solve $x^2 - 5x - 14 = 0$ and $x \\le 9$.") == ["x^2 - 5x - 14 = 0", "x \\le 9"])
    }

    /// The expression's value at x, nil when it doesn't parse.
    func at(_ source: String, _ x: Double) -> Double? {
        SATExpression(source).map { $0(x) }
    }

    @Test func plotExpressions() {
        #expect(at("-2*x+4", 0) == 4)
        #expect(at("-2*x+4", 2) == 0)
        #expect(at("x**2 - 2*x - 3", 1) == -4)
        #expect(at("2x + 1", 3) == 7)
        #expect(at("3(x+1)", 1) == 6)
        #expect(at("Math.sqrt(x)", 9) == 3)
        #expect(at("2^3^2", 0) == 512)
        #expect(at("-x^2", 3) == -9)
        #expect(at("abs(x - 2)", -1) == 3)
        #expect(abs((at("Math.PI * x", 1) ?? 0) - Double.pi) < 1e-12)
        #expect(at("0.5*x^2 + 1e-3", 2) == 2.001)
        #expect(at("max(x, 2)", 1) == 2)
        #expect(at("2*", 0) == nil)
        #expect(at("y + 1", 0) == nil)
        #expect(at("(x + 1", 0) == nil)
        #expect(at("sqrt(x)", -1)?.isNaN == true)
    }

    @Test func everyFixturePlotFunctionParses() {
        for q in SATFixtures.questions {
            guard case .plot(let p)? = q.figure else { continue }
            for case .function(let expr, _, _, _) in p.items { #expect(SATExpression(expr) != nil, "\(q.id): \(expr)") }
        }
    }

    /// The fixtures' answers, worked again: every mcq's key and every grid-in's value is what the
    /// question asks for (the fixtures are written by hand; a slip there would teach a wrong answer).
    @Test func theFixturesAnswersAreRight() {
        func key(_ id: String) -> String? { SATFixtures.question(id)?.answer.key }
        func value(_ id: String) -> Double? { SATFixtures.question(id)?.answer.accepted?.first.flatMap(SATGridIn.value) }
        // 4(x − 3) + 7 = 2x + 9
        let x1 = (9.0 + 12 - 7) / (4 - 2)
        #expect(x1 == 7 && key("algebra-linear-one-var-9001") == "C")
        // the table: (0, −3), (2, 1), (5, 7) on 2x − 3
        let fx: [Double] = [0.0, 2, 5].map { 2 * $0 - 3 }
        #expect(fx == [-3, 1, 7])
        #expect(key("algebra-linear-functions-9002") == "A")
        // 3x + 2y = 16, x − y = 2
        let y3 = (16.0 - 6) / 5, x3 = y3 + 2
        #expect(3 * x3 + 2 * y3 == 16 && value("algebra-linear-systems-9003") == x3)
        // the line through (0, 4) and (2, 0) is 2x + y = 4
        let onLine: Bool = [(0.0, 4.0), (2.0, 0.0)].allSatisfy { p in 2 * p.0 + p.1 == 4 }
        #expect(onLine)
        #expect(key("algebra-linear-two-var-9004") == "A")
        // sin A = BC / AB = 6 / 10
        let hypotenuse: Double = (64.0 + 36.0).squareRoot()
        #expect(6.0 / hypotenuse == 0.6)
        #expect(key("geometry_trig-right-triangles-trig-9005") == "A")
        #expect(value("psda-ratios-rates-9006") == 0.75)
        // the vertex of x² − 2x − 3
        let vertex: Double = 1.0 - 2.0 - 3.0
        #expect(vertex == -4)
        #expect(key("advanced_math-nonlinear-functions-9007") == "A")
        let books: [Double] = [4, 7, 3, 6, 5]
        #expect(value("psda-one-var-data-9008") == books.reduce(0, +) / 5)
        #expect(130.0 - 55 == 75 && key("geometry_trig-lines-angles-triangles-9009") == "C")
        let radius: Double = (9.0 + 16.0).squareRoot()
        #expect(value("geometry_trig-circles-9010") == radius)
        #expect(value("algebra-linear-inequalities-9011") == ((150.0 - 30) / 12).rounded(.down))
        #expect(key("advanced_math-equivalent-expressions-9012") == "B")
        let root: Double = 49.0 - 35.0 - 14.0
        #expect(root == 0)
        #expect(value("advanced_math-nonlinear-equations-9013") == 7)
        let price: Double = 80.0 * 1.15 * 0.85
        #expect(abs(price - 78.2) < 1e-9)
        #expect(key("psda-percentages-9014") == "A")
        #expect(35.0 / 100 == 7.0 / 20 && key("psda-probability-9015") == "B")
        #expect(value("geometry_trig-area-volume-9016") == 72.0 / 9)
    }
}
