import Foundation

/// How kids actually write, page by page: the problem the tutor writes at the top (or the kid's own,
/// written first), the lines under it, and what a teacher wants the tutor to do with each — for a
/// right solution and for a deliberately wrong one.
///
/// The cases come from the owner's iPad (a running total `+3 = 767`, `= 431` on the line under
/// `767 − 336`), from production's learning record (the young kids' scoreboard,
/// src/__eval__/young/corpus.ts, whose marks a teacher set) and from how classes set work out: chains,
/// side calculations that are true but not the answer, stacked sums, long division, a kid's own tick,
/// a line rubbed out and written again, odd spacing. Every line is LaTeX the tutor's hand can write
/// (`StudentHand`); the bench writes it in a synthetic hand on a problem page.
///
/// Marks: `tick`, `quiet` (no mark), `ring` (with the right value when there is one: `value`), and
/// `calm` — a tick or no mark, never a ring (a true line a teacher might tick or let be). A line
/// carried on from a ringed slip gets no mark of its own (docs/PROBLEM-PAGES.md), so it is `quiet`.
public enum TrainingCatalogue {
    // MARK: - building blocks

    static func work(_ latex: String, _ expect: TrainingExpect, value: String? = nil, dx: Double = 0, means: String? = nil,
                     then: TrainingLineSpec.Then? = nil) -> TrainingLineSpec {
        TrainingLineSpec(latex, expect, value: value, place: .work, dx: dx, means: means, then: then)
    }

    static func answer(_ latex: String, _ expect: TrainingExpect, value: String? = nil, means: String? = nil) -> TrainingLineSpec {
        TrainingLineSpec(latex, expect, value: value, place: .answer, means: means)
    }

    /// the kid's own problem, written where the tutor's would be: it heads the page, no mark
    static func own(_ latex: String) -> TrainingLineSpec {
        TrainingLineSpec(latex, .quiet, place: .problem)
    }

    static func beside(_ latex: String, _ expect: TrainingExpect, means: String? = nil) -> TrainingLineSpec {
        TrainingLineSpec(latex, expect, place: .beside, means: means)
    }

    static func c(_ id: String, _ category: TrainingCategory, _ grade: TrainingGrade, _ topic: String, _ problem: String?,
                  _ lines: [TrainingLineSpec], solved: Bool?, note: String? = nil) -> TrainingCase {
        TrainingCase(id: id, category: category, grade: grade, topic: topic, problem: problem.map { [$0] }, lines: lines, solved: solved, note: note)
    }

    static func c(_ id: String, _ category: TrainingCategory, _ grade: TrainingGrade, _ topic: String, problem: [String],
                  _ lines: [TrainingLineSpec], solved: Bool?, note: String? = nil) -> TrainingCase {
        TrainingCase(id: id, category: category, grade: grade, topic: topic, problem: problem, lines: lines, solved: solved, note: note)
    }

    static func stack(_ rows: String) -> String { "\\begin{array}{r} \(rows) \\end{array}" }

    // MARK: - the catalogue

    public static let all: [TrainingCase] = runningTotals + equalsNextLine + chains + multiStep + trueSteps + facts + fractions
        + mixedNumbers + decimals + negatives + exponents + orderOfOps + wordSetups + longDivision + columnSums + rewrites + ownTicks
        + spacing + ownProblems

    public static func cases(in category: TrainingCategory) -> [TrainingCase] {
        all.filter { $0.category == category }
    }

    // A running total: the next line starts with its operator and goes on from the last line's result
    // (the owner's iPad, 2026-10-19: `+3 = 767` under `400 + 364 = 764` was ringed).
    static let runningTotals: [TrainingCase] = [
        c("rt-767-ok", .runningTotal, .g34, "add", "400 + 364 + 3",
          [work("400 + 364 = 764", .calm), work("+3 = 767", .tick), answer("767", .tick)], solved: true,
          note: "the owner's iPad: +3 = 767 was ringed"),
        c("rt-767-slip", .runningTotal, .g34, "add", "400 + 364 + 3",
          [work("400 + 364 = 764", .calm), work("+3 = 766", .ring, value: "767"), answer("766", .quiet)], solved: false),
        c("rt-25-17-8-ok", .runningTotal, .g34, "add", "25 + 17 + 8",
          [work("25 + 17 = 42", .calm), work("+8 = 50", .tick), answer("50", .tick)], solved: true),
        c("rt-52-17-ok", .runningTotal, .k2, "sub", "52 - 17",
          [work("52 - 10 = 42", .calm), work("-7 = 35", .tick), answer("35", .tick)], solved: true, note: "take away the ten, then the ones"),
        c("rt-52-17-slip", .runningTotal, .k2, "sub", "52 - 17",
          [work("52 - 10 = 42", .calm), work("-7 = 36", .ring, value: "35"), answer("36", .quiet)], solved: false),
        c("rt-18x7-ok", .runningTotal, .g34, "mul", "18 \\times 7",
          [work("10 \\times 7 = 70", .calm), work("+56 = 126", .tick), answer("126", .tick)], solved: true),
        c("rt-shop-ok", .runningTotal, .g34, "add", "120 + 45 + 35",
          [work("120 + 45 = 165", .calm), work("+35 = 200", .tick)], solved: true),
    ]

    // `=` first on the next line: the line above is the sum, this one its value (the owner's iPad:
    // `= 431` under `767 − 336`).
    static let equalsNextLine: [TrainingCase] = [
        c("eq-767-336-ok", .equalsNextLine, .g34, "sub", "767 - 336",
          [work("767 - 336", .calm), work("= 431", .tick)], solved: true, note: "the owner's iPad"),
        c("eq-767-336-slip", .equalsNextLine, .g34, "sub", "767 - 336",
          [work("767 - 336", .calm), work("= 421", .ring, value: "431")], solved: false),
        c("eq-48-27-ok", .equalsNextLine, .k2, "add", "48 + 27",
          [work("48 + 27", .calm), work("= 75", .tick)], solved: true),
        c("eq-48-27-slip", .equalsNextLine, .k2, "add", "48 + 27",
          [work("48 + 27", .calm), work("= 65", .ring, value: "75")], solved: false, note: "the ten not carried"),
        c("eq-6x7p5-ok", .equalsNextLine, .g34, "order", "6 \\times 7 + 5",
          [work("6 \\times 7 + 5", .calm), work("= 42 + 5", .tick), work("= 47", .tick)], solved: true),
        c("eq-6x7p5-slip", .equalsNextLine, .g34, "order", "6 \\times 7 + 5",
          [work("= 42 + 5", .tick), work("= 57", .ring, value: "47")], solved: false),
        c("eq-frac-ok", .equalsNextLine, .g56, "frac", "\\frac{1}{2} + \\frac{1}{3}",
          [work("= \\frac{3}{6} + \\frac{2}{6}", .tick), work("= \\frac{5}{6}", .tick)], solved: true),
        c("eq-answer-spot-ok", .equalsNextLine, .g34, "sub", "905 - 487",
          [work("905 - 487", .calm), answer("= 418", .tick)], solved: true),
    ]

    // Several `=` on one line.
    static let chains: [TrainingCase] = [
        c("ch-18x7-ok", .chain, .g34, "mul", "18 \\times 7",
          [work("18 \\times 7 = 70 + 56 = 126", .tick)], solved: true),
        c("ch-18x7-slip", .chain, .g34, "mul", "18 \\times 7",
          [work("18 \\times 7 = 70 + 56 = 136", .ring, value: "126")], solved: false),
        c("ch-running-ok", .chain, .k2, "add", "25 + 17",
          [work("20 + 10 = 30 + 12 = 42", .calm)], solved: nil, note: "= used as 'then': wrong as written, right as meant"),
        c("ch-frac-ok", .chain, .g56, "frac", "\\frac{3}{4} \\times \\frac{2}{3}",
          [work("\\frac{3 \\times 2}{4 \\times 3} = \\frac{6}{12} = \\frac{1}{2}", .tick)], solved: true),
        c("ch-keep-change-flip-ok", .chain, .g56, "frac", "\\frac{1}{2} \\div \\frac{1}{4}",
          [work("\\frac{1}{2} \\times \\frac{4}{1} = \\frac{4}{2} = 2", .tick)], solved: true),
        c("ch-alg-ok", .chain, .g78, "algebra", "3(x + 4) - 2x",
          [work("3x + 12 - 2x = x + 12", .tick)], solved: true),
        c("ch-alg-slip", .chain, .g78, "algebra", "3(x + 4) - 2x",
          [work("3x + 4 - 2x = x + 4", .ring)], solved: false, note: "the 3 not given to the 4"),
    ]

    // Equations in steps, the answer in the answer spot.
    static let multiStep: [TrainingCase] = [
        c("ms-2x3-ok", .multiStep, .g56, "algebra", "2x + 3 = 11",
          [work("2x = 8", .tick), answer("x = 4", .tick)], solved: true),
        c("ms-2x3-slip", .multiStep, .g56, "algebra", "2x + 3 = 11",
          [work("2x = 8", .tick), answer("x = 5", .ring, value: "4")], solved: false),
        c("ms-3x5-ok", .multiStep, .g56, "algebra", "3x - 5 = 10",
          [work("3x = 15", .tick), answer("x = 5", .tick)], solved: true),
        c("ms-3x5-slip", .multiStep, .g56, "algebra", "3x - 5 = 10",
          [work("3x = 5", .ring, value: "15"), work("x = \\frac{5}{3}", .quiet)], solved: false, note: "the 5 taken away instead of added"),
        c("ms-dist-ok", .multiStep, .g78, "algebra", "3(x + 2) = 21",
          [work("3x + 6 = 21", .tick), work("3x = 15", .tick), answer("x = 5", .tick)], solved: true),
        c("ms-dist-slip", .multiStep, .g78, "algebra", "3(x + 2) = 21",
          [work("3x + 2 = 21", .ring), work("3x = 19", .quiet), work("x = \\frac{19}{3}", .quiet)], solved: false),
        c("ms-both-ok", .multiStep, .g78, "algebra", "5x + 2 = 3x + 10",
          [work("2x + 2 = 10", .tick), work("2x = 8", .tick), answer("x = 4", .tick)], solved: true),
        c("ms-both-slip", .multiStep, .g78, "algebra", "5x + 2 = 3x + 10",
          [work("8x + 2 = 10", .ring), work("8x = 8", .quiet), answer("x = 1", .quiet)], solved: false, note: "3x added instead of taken away"),
        c("ms-frac-ok", .multiStep, .g78, "algebra", "\\frac{x}{3} + 2 = 6",
          [work("\\frac{x}{3} = 4", .tick), answer("x = 12", .tick)], solved: true),
        c("ms-neg-ok", .multiStep, .g78, "algebra", "-2x + 5 = 1",
          [work("-2x = -4", .tick), answer("x = 2", .tick)], solved: true),
        c("ms-neg-slip", .multiStep, .g78, "algebra", "-2x + 5 = 1",
          [work("-2x = -4", .tick), answer("x = -2", .ring, value: "2")], solved: false, note: "the sign lost dividing by -2"),
        c("ms-bare-answer-ok", .multiStep, .g56, "algebra", "4x - 5 = 7",
          [work("4x = 12", .tick), answer("3", .tick, means: "3")], solved: true, note: "a bare number in the answer spot answers x"),
    ]

    // True lines that are not the answer yet: never ringed.
    static let trueSteps: [TrainingCase] = [
        c("ts-18x7-split-ok", .trueSteps, .g34, "mul", "18 \\times 7",
          [work("10 \\times 7 = 70", .calm), work("8 \\times 7 = 56", .calm), work("70 + 56 = 126", .tick)], solved: true,
          note: "prod: 18 × 7 had 3 rings, none right"),
        c("ts-47-38-partials-ok", .trueSteps, .k2, "add", "47 + 38",
          [work("70", .quiet), work("15", .quiet), answer("85", .tick)], solved: true, note: "partial sums alone are no wrong answers"),
        c("ts-144-9-check-ok", .trueSteps, .g34, "div", "144 \\div 9",
          [work("9 \\times 16 = 144", .calm), answer("16", .tick)], solved: true),
        c("ts-6x7-doubles-ok", .trueSteps, .g34, "mul", "6 \\times 7",
          [work("6 \\times 6 = 36", .calm), work("36 + 6 = 42", .tick)], solved: true),
        c("ts-9x8-tens-ok", .trueSteps, .g34, "mul", "9 \\times 8",
          [work("10 \\times 8 = 80", .calm), work("80 - 8 = 72", .tick)], solved: true),
        c("ts-order-slip", .trueSteps, .g56, "order", "3 + 4 \\times 2",
          [work("3 + 4 = 7", .calm), work("7 \\times 2 = 14", .calm), answer("14", .ring, value: "11")], solved: false,
          note: "true lines in the wrong order: the answer is what is ringed"),
        c("ts-quadratic-ok", .trueSteps, .hs, "quadratic", "x^{2} - 5x + 6 = 0",
          [work("(x - 2)(x - 3) = 0", .tick), work("x = 2", .tick), work("x = 3", .tick)], solved: nil,
          note: "one root alone is a partial answer, not a slip"),
        c("ts-identity-ok", .trueSteps, .g78, "algebra", "2(x + 1) + 3 = 11",
          [work("2(x + 1) = 2x + 2", .calm), work("2x + 2 + 3 = 11", .tick), work("2x = 6", .tick), answer("x = 3", .tick)], solved: true,
          note: "an identity on the side"),
    ]

    // Facts and sums, bare answers.
    static let facts: [TrainingCase] = [
        c("f-4p3-ok", .facts, .k2, "add", "4 + 3", [answer("7", .tick)], solved: true),
        c("f-4p3-slip", .facts, .k2, "add", "4 + 3", [answer("8", .ring, value: "7")], solved: false),
        c("f-9m4-ok", .facts, .k2, "sub", "9 - 4", [work("9 - 4 = 5", .tick)], solved: true),
        c("f-9m4-slip", .facts, .k2, "sub", "9 - 4", [work("9 - 4 = 6", .ring, value: "5")], solved: false),
        c("f-6x7-ok", .facts, .g34, "mul", "6 \\times 7", [answer("42", .tick)], solved: true),
        c("f-6x7-slip", .facts, .g34, "mul", "6 \\times 7", [answer("48", .ring, value: "42")], solved: false),
        c("f-42d7-ok", .facts, .g34, "div", "42 \\div 7", [work("42 \\div 7 = 6", .tick)], solved: true),
        c("f-42d7-slip", .facts, .g34, "div", "42 \\div 7", [work("42 \\div 7 = 7", .ring, value: "6")], solved: false),
        c("f-52m17-ok", .facts, .k2, "sub", "52 - 17", [answer("35", .tick)], solved: true),
        c("f-52m17-slip", .facts, .k2, "sub", "52 - 17", [answer("45", .ring, value: "35")], solved: false, note: "the smaller digit from the bigger"),
        c("f-47p38-ok", .facts, .k2, "add", "47 + 38", [work("47 + 38 = 85", .tick)], solved: true),
        c("f-turned-ok", .facts, .k2, "add", "4 + 3", [work("3 + 4 = 7", .tick)], solved: true, note: "the sum turned round"),
    ]

    static let fractions: [TrainingCase] = [
        c("fr-add-ok", .fractions, .g56, "frac", "\\frac{1}{2} + \\frac{1}{3}",
          [work("\\frac{3}{6} + \\frac{2}{6}", .tick), answer("\\frac{5}{6}", .tick)], solved: true),
        c("fr-add-slip", .fractions, .g56, "frac", "\\frac{1}{2} + \\frac{1}{3}",
          [answer("\\frac{2}{5}", .ring, value: "\\frac{5}{6}")], solved: false, note: "tops and bottoms added"),
        c("fr-equiv-ok", .fractions, .g56, "frac", "\\frac{1}{2} + \\frac{1}{3}",
          [work("\\frac{1}{2} = \\frac{3}{6}", .calm), work("\\frac{1}{3} = \\frac{2}{6}", .calm), work("\\frac{3}{6} + \\frac{2}{6} = \\frac{5}{6}", .tick)],
          solved: true),
        c("fr-equiv-slip", .fractions, .g56, "frac", "\\frac{1}{2} + \\frac{1}{3}",
          [work("\\frac{1}{2} = \\frac{2}{6}", .ring, value: "\\frac{3}{6}")], solved: false),
        c("fr-simplify-ok", .fractions, .g56, "frac", "\\frac{5}{6} - \\frac{1}{3}",
          [work("\\frac{5}{6} - \\frac{2}{6} = \\frac{3}{6}", .tick), work("= \\frac{1}{2}", .tick)], solved: true),
        c("fr-times-ok", .fractions, .g56, "frac", "\\frac{3}{4} \\times \\frac{2}{3}",
          [work("\\frac{6}{12}", .tick), answer("\\frac{1}{2}", .tick)], solved: true),
        c("fr-divide-slip", .fractions, .g56, "frac", "\\frac{1}{2} \\div \\frac{1}{4}",
          [answer("\\frac{1}{8}", .ring, value: "2")], solved: false, note: "multiplied instead of divided"),
        c("fr-slash-ok", .fractions, .g56, "frac", "\\frac{1}{2} + \\frac{1}{3}",
          [answer("5/6", .tick, means: "\\frac{5}{6}")], solved: true, note: "a fraction written with a slash"),
        c("fr-own-ok", .fractions, .g56, "frac", nil,
          [work("\\frac{3}{4} + \\frac{1}{8} = \\frac{7}{8}", .tick)], solved: true, note: "the kid's own line"),
        c("fr-like-ok", .fractions, .g34, "frac", "\\frac{3}{4} + \\frac{1}{4}",
          [work("\\frac{4}{4} = 1", .tick)], solved: true),
    ]

    static let mixedNumbers: [TrainingCase] = [
        c("mx-add-ok", .mixedNumbers, .g56, "frac", "2\\frac{1}{3} + 1\\frac{1}{2}",
          [work("2\\frac{2}{6} + 1\\frac{3}{6}", .tick), answer("3\\frac{5}{6}", .tick)], solved: true),
        c("mx-add-slip", .mixedNumbers, .g56, "frac", "2\\frac{1}{3} + 1\\frac{1}{2}",
          [answer("3\\frac{2}{5}", .ring, value: "3\\frac{5}{6}")], solved: false),
        c("mx-improper-ok", .mixedNumbers, .g56, "frac", "2\\frac{1}{3} + 1\\frac{1}{2}",
          [work("\\frac{7}{3} + \\frac{3}{2}", .tick), work("= \\frac{14}{6} + \\frac{9}{6}", .tick), work("= \\frac{23}{6}", .tick),
           answer("3\\frac{5}{6}", .tick)], solved: true),
        c("mx-parts-ok", .mixedNumbers, .g56, "frac", "2\\frac{1}{3} + 1\\frac{1}{2}",
          [work("2 + 1 = 3", .calm), work("\\frac{1}{3} + \\frac{1}{2} = \\frac{5}{6}", .calm), answer("3\\frac{5}{6}", .tick)], solved: true,
          note: "wholes and parts apart"),
        c("mx-to-improper-ok", .mixedNumbers, .g56, "frac", "2\\frac{1}{3}", [answer("\\frac{7}{3}", .tick)], solved: true),
        c("mx-sub-ok", .mixedNumbers, .g56, "frac", "3\\frac{1}{4} - 1\\frac{1}{2}",
          [work("\\frac{13}{4} - \\frac{6}{4}", .tick), answer("\\frac{7}{4}", .tick)], solved: true),
    ]

    static let decimals: [TrainingCase] = [
        c("d-add-ok", .decimals, .g56, "dec", "3.45 + 2.8", [work("3.45 + 2.80 = 6.25", .tick)], solved: true),
        c("d-add-slip", .decimals, .g56, "dec", "3.45 + 2.8", [work("3.45 + 2.8 = 5.25", .ring, value: "6.25")], solved: false),
        c("d-mul-ok", .decimals, .g56, "dec", "1.2 \\times 3", [work("12 \\times 3 = 36", .calm), answer("3.6", .tick)], solved: true),
        c("d-mul-slip", .decimals, .g56, "dec", "1.2 \\times 3", [answer("36", .ring, value: "3.6")], solved: false, note: "the point lost"),
        c("d-tenth-ok", .decimals, .g56, "dec", "5.4 \\times 0.1", [answer("0.54", .tick)], solved: true),
        c("d-tenth-slip", .decimals, .g56, "dec", "5.4 \\times 0.1", [answer("5.04", .ring, value: "0.54")], solved: false),
        c("d-sub-ok", .decimals, .g56, "dec", "5.6 - 2.75", [work("5.60 - 2.75 = 2.85", .tick)], solved: true),
        c("d-sub-slip", .decimals, .g56, "dec", "5.6 - 2.75", [work("5.60 - 2.75 = 2.95", .ring, value: "2.85")], solved: false),
        c("d-points-ok", .decimals, .g56, "dec", "0.3 \\times 0.2", [work("3 \\times 2 = 6", .calm), answer("0.06", .tick)], solved: true),
        c("d-points-slip", .decimals, .g56, "dec", "0.3 \\times 0.2", [answer("0.6", .ring, value: "0.06")], solved: false,
          note: "one point counted, not two"),
    ]

    static let negatives: [TrainingCase] = [
        c("n-add-ok", .negatives, .g78, "neg", "-7 + 10", [answer("3", .tick)], solved: true),
        c("n-add-slip", .negatives, .g78, "neg", "-7 + 10", [answer("-3", .ring, value: "3")], solved: false),
        c("n-mul-ok", .negatives, .g78, "neg", "-3 \\times (-4)", [answer("12", .tick)], solved: true),
        c("n-mul-slip", .negatives, .g78, "neg", "-3 \\times (-4)", [answer("-12", .ring, value: "12")], solved: false),
        c("n-sub-ok", .negatives, .g78, "neg", "5 - 9", [work("5 - 9 = -4", .tick)], solved: true),
        c("n-sub-slip", .negatives, .g78, "neg", "5 - 9", [work("5 - 9 = 4", .ring, value: "-4")], solved: false),
        c("n-eq-ok", .negatives, .g78, "algebra", "x + 7 = 3", [work("x = 3 - 7", .tick), answer("x = -4", .tick)], solved: true),
        c("n-eq-slip", .negatives, .g78, "algebra", "x + 7 = 3", [work("x = 3 - 7", .tick), answer("x = 4", .ring, value: "-4")], solved: false),
        c("n-div-ok", .negatives, .g78, "neg", "-24 \\div (-6)", [answer("4", .tick)], solved: true),
    ]

    static let exponents: [TrainingCase] = [
        c("e-pow-ok", .exponents, .g56, "order", "2^{3} + 1", [work("2^{3} = 8", .calm), work("8 + 1 = 9", .tick)], solved: true),
        c("e-pow-slip", .exponents, .g56, "order", "2^{3} + 1", [work("2^{3} = 6", .ring, value: "8"), work("6 + 1 = 7", .quiet)], solved: false,
          note: "2 × 3, not 2 cubed"),
        c("e-rule-ok", .exponents, .g78, "exponents", "2^{3} \\times 2^{2}", [work("= 2^{5}", .tick), answer("32", .tick)], solved: true),
        c("e-root-ok", .exponents, .g78, "exponents", "\\sqrt{81} + 4", [work("9 + 4 = 13", .tick)], solved: true),
        c("e-negsq-ok", .exponents, .g78, "exponents", "(-3)^{2}", [answer("9", .tick)], solved: true),
        c("e-negsq-slip", .exponents, .g78, "exponents", "(-3)^{2}", [answer("-9", .ring, value: "9")], solved: false),
        c("e-square-roots-ok", .exponents, .hs, "quadratic", "x^{2} = 49", [work("x = 7", .tick), work("x = -7", .tick)], solved: nil,
          note: "two answers; one alone is partial"),
    ]

    static let orderOfOps: [TrainingCase] = [
        c("o-basic-ok", .orderOfOps, .g56, "order", "3 + 4 \\times 2", [work("4 \\times 2 = 8", .calm), work("3 + 8 = 11", .tick)], solved: true),
        c("o-basic-slip", .orderOfOps, .g56, "order", "3 + 4 \\times 2", [work("3 + 4 \\times 2 = 14", .ring, value: "11")], solved: false),
        c("o-paren-ok", .orderOfOps, .g56, "order", "(3 + 4) \\times 2", [work("7 \\times 2 = 14", .tick), answer("14", .tick)], solved: true),
        c("o-long-ok", .orderOfOps, .g56, "order", "20 - 3 \\times 4 + 2", [work("20 - 12 + 2", .tick), work("= 10", .tick)], solved: true),
        c("o-long-slip", .orderOfOps, .g56, "order", "20 - 3 \\times 4 + 2", [work("20 - 12 + 2", .tick), work("= 6", .ring, value: "10")],
          solved: false, note: "12 + 2 taken away together"),
    ]

    static let wordSetups: [TrainingCase] = [
        c("w-apples-ok", .wordSetup, .g34, "word", problem: ["\\text{Sam has 3 bags of 4 apples.}", "\\text{How many apples?}"],
          [work("3 \\times 4 = 12", .tick), answer("12", .tick)], solved: nil),
        c("w-apples-slip", .wordSetup, .g34, "word", problem: ["\\text{Sam has 3 bags of 4 apples.}", "\\text{How many apples?}"],
          [work("3 \\times 4 = 7", .ring, value: "12")], solved: false),
        c("w-ages-ok", .wordSetup, .g78, "word", problem: ["\\text{Maya is 3 years older than Leo.}", "\\text{Together they are 21.}", "\\text{How old is Leo?}"],
          [work("x + x + 3 = 21", .calm), work("2x + 3 = 21", .calm), work("2x = 18", .tick), answer("x = 9", .tick)], solved: nil),
        c("w-pens-ok", .wordSetup, .g34, "word", problem: ["\\text{A pen costs 2 dollars.}", "\\text{How much do 7 pens cost?}"],
          [work("7 \\times 2 = 14", .tick)], solved: nil),
        c("w-pens-slip", .wordSetup, .g34, "word", problem: ["\\text{A pen costs 2 dollars.}", "\\text{How much do 7 pens cost?}"],
          [work("7 + 2 = 9", .calm), answer("9", .ring, value: "14")], solved: false, note: "added, not multiplied: true, but not this problem"),
    ]

    static let longDivision: [TrainingCase] = [
        c("ld-bracket-ok", .longDivision, .g34, "div", "144 \\div 9",
          [work(stack("16 \\\\ 9 )\\overline{144}"), .tick)], solved: true, note: "the bracket, its quotient over it"),
        c("ld-bracket-slip", .longDivision, .g34, "div", "144 \\div 9",
          [work(stack("14 \\\\ 9 )\\overline{144}"), .ring, value: "16")], solved: false),
        c("ld-remainder-ok", .longDivision, .g34, "div", "17 \\div 5", [answer("3 R 2", .tick)], solved: true),
        c("ld-remainder-slip", .longDivision, .g34, "div", "17 \\div 5", [answer("3 R 3", .ring, value: "3 R 2")], solved: false),
        c("ld-chunks-ok", .longDivision, .g34, "div", "144 \\div 9",
          [work("9 \\times 10 = 90", .calm), work("144 - 90 = 54", .calm), work("9 \\times 6 = 54", .calm), answer("16", .tick)], solved: true,
          note: "chunking"),
        c("ld-inline-ok", .longDivision, .g34, "div", "144 \\div 9", [work("144 \\div 9 = 16", .tick)], solved: true,
          note: "prod: worked and never credited"),
    ]

    static let columnSums: [TrainingCase] = [
        c("cs-add-ok", .columnSum, .k2, "add", "286 + 680", [work(stack("286 \\\\ +680 \\\\ \\hline 966"), .tick)], solved: true),
        c("cs-add-slip", .columnSum, .k2, "add", "286 + 680", [work(stack("286 \\\\ +680 \\\\ \\hline 866"), .ring, value: "966")], solved: false),
        c("cs-sub-ok", .columnSum, .k2, "sub", "52 - 17", [work(stack("52 \\\\ -17 \\\\ \\hline 35"), .tick)], solved: true),
        c("cs-mul-ok", .columnSum, .g34, "mul", "46 \\times 23",
          [work(stack("46 \\\\ \\times 23 \\\\ \\hline 138 \\\\ 920 \\\\ \\hline 1058"), .tick)], solved: true),
        c("cs-mul-slip", .columnSum, .g34, "mul", "46 \\times 23",
          [work(stack("46 \\\\ \\times 23 \\\\ \\hline 138 \\\\ 920 \\\\ \\hline 1048"), .ring, value: "1058")], solved: false),
        c("cs-own-ok", .columnSum, .k2, "add", nil, [work(stack("286 \\\\ +680 \\\\ \\hline 966"), .tick)], solved: true,
          note: "the kid's own stacked sum"),
    ]

    static let rewrites: [TrainingCase] = [
        c("rw-below-ok", .rewrite, .g56, "algebra", "2x + 3 = 11",
          [work("2x = 7", .ring, value: "8"), work("2x = 8", .tick), answer("x = 4", .tick)], solved: true,
          note: "a slip, then the right line under it"),
        c("rw-erase-ok", .rewrite, .g56, "algebra", "2x + 3 = 11",
          [work("2x = 8", .tick), work("x = 5", .quiet, then: .erase), answer("x = 4", .tick)], solved: true,
          note: "a wrong answer rubbed out and written again"),
        c("rw-strike-ok", .rewrite, .g34, "mul", "18 \\times 7",
          [work("10 \\times 7 = 17", .quiet, then: .strike), work("10 \\times 7 = 70", .calm), work("8 \\times 7 = 56", .calm),
           answer("126", .tick)], solved: true, note: "a crossed-out line is not judged"),
        c("rw-again-ok", .rewrite, .k2, "add", "47 + 38",
          [work("47 + 38 = 75", .ring, value: "85"), work("47 + 38 = 85", .tick)], solved: true),
    ]

    static let ownTicks: [TrainingCase] = [
        c("ot-beside-ok", .ownTick, .k2, "add", "4 + 3", [work("4 + 3 = 7", .tick), beside("\\checkmark", .quiet)], solved: true,
          note: "the kid ticks their own line"),
        c("ot-inline-ok", .ownTick, .g56, "algebra", "2x + 3 = 11", [work("2x = 8", .tick), answer("x = 4 \\checkmark", .tick, means: "x = 4")],
          solved: true),
        c("ot-wrong-ok", .ownTick, .g34, "mul", "6 \\times 7", [work("6 \\times 7 = 48 \\checkmark", .ring, value: "42", means: "6 \\times 7 = 48")],
          solved: false, note: "their own tick on a slip"),
    ]

    static let spacing: [TrainingCase] = [
        c("sp-gap-ok", .spacing, .g56, "algebra", "2x + 3 = 11",
          [work("2 \\quad x = 8", .tick, means: "2x = 8"), answer("x = 4", .tick)], solved: true, note: "\"2 x=8\": a gap after the 2"),
        c("sp-wide-ok", .spacing, .g56, "algebra", "3x - 5 = 10",
          [work("3x \\quad = \\quad 15", .tick, means: "3x = 15"), work("x \\quad = \\quad 5", .tick, means: "x = 5")], solved: true),
        c("sp-op-gap-ok", .spacing, .k2, "add", "48 + 27",
          [work("48 \\qquad + 27 = 75", .tick, means: "48 + 27 = 75")], solved: true),
        c("sp-indent-ok", .spacing, .g56, "algebra", "2x + 3 = 11",
          [work("2x = 8", .tick, dx: 420), work("x = 4", .tick, dx: 420)], solved: true, note: "work in the middle of the page"),
        c("sp-side-column-ok", .spacing, .g34, "mul", "18 \\times 7",
          [work("10 \\times 7 = 70", .calm), TrainingLineSpec("8 \\times 7 = 56", .calm, place: .beside), answer("126", .tick)], solved: true,
          note: "side work beside the first line"),
    ]

    static let ownProblems: [TrainingCase] = [
        c("op-alg-ok", .ownProblem, .g56, "algebra", nil, [own("3x - 5 = 10"), work("3x = 15", .tick), answer("x = 5", .tick)], solved: true),
        c("op-alg-slip", .ownProblem, .g56, "algebra", nil, [own("5x + 2 = 17"), work("5x = 15", .tick), answer("x = 4", .ring, value: "3")],
          solved: false),
        c("op-fact-ok", .ownProblem, .k2, "add", nil, [work("36 + 2 = 38", .tick)], solved: true, note: "the child's own line"),
        c("op-sum-ok", .ownProblem, .g34, "sub", nil, [own("767 - 336"), work("= 431", .tick)], solved: true),
    ]
}
