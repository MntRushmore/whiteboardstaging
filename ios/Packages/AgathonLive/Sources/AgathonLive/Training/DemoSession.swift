import Foundation

/// The school demo's screen recordings (2026-11-13): real maths across the grades, K to 8, and five
/// word problems from real life, worked on the real board by a synthetic hand that is kid-like but
/// tidy (the QA sessions' mess turned right down). Played by Debug's session player like the QA
/// sessions (`-kidSession dK-add -demoRecording`); `scripts/ios-demo-videos.sh` records and cuts them.
///
/// Nothing here is a real child's writing: the glyphs are the synthetic hands (`StudentHand`).
public enum DemoSessions {
    typealias L = TrainingLineSpec

    /// a tidy hand: a touch of lean and wobble, no more
    static let neat = TrainingHand(name: "demo-neat", seed: 5, slant: 0.05, sx: 1, sy: 1, rotateDeg: -0.4, jitter: 0.01, sizeDrift: 0.04,
                                   wander: 0.02, scale: 1.6)
    /// a younger kid's bigger, rounder letters, still tidy
    static let young = TrainingHand(name: "demo-young", seed: 31, slant: 0.03, sx: 1.04, sy: 1, rotateDeg: 0.3, jitter: 0.015,
                                    sizeDrift: 0.05, wander: 0.025, scale: 1.9)
    /// lines a little uneven down the page, nothing wandering
    static let mess = KidMess(tilt: 0.6, slope: 0.004, jitter: 4, gap: 28)

    static func stack(_ rows: String) -> String { "\\begin{array}{r} \(rows) \\end{array}" }

    public static let all: [KidSession] = gradeTour + wordProblems

    // MARK: - A. the grade tour, K–8

    public static let gradeTour: [KidSession] = [
        KidSession("dK-add", "Kindergarten · Adding 3 + 4", grade: 0, hand: young, pace: .typical, mess: mess, [
            .tutorProblem(["3 + 4"]),
            .pause(1),
            .line(L("3 + 4 = 7", .calm), .below),
            .line(L("7", .tick, place: .answer), .answer),
            .done(wait: 12),
        ]),
        KidSession("d1-subtract", "Grade 1 · Taking away: 15 − 8", grade: 1, hand: young, pace: .typical, mess: mess, [
            .tutorProblem(["15 - 8"]),
            .pause(1),
            .line(L("15 - 5 = 10", .calm), .below),
            .line(L("10 - 3 = 7", .calm), .below),
            .line(L("7", .tick, place: .answer), .answer),
            .done(wait: 12),
        ]),
        KidSession("d2-carry", "Grade 2 · Adding with a carry", grade: 2, hand: young, pace: .typical, mess: mess, [
            .tutorProblem(["47 + 38"]),
            .pause(1),
            .stacked(L(stack("47 \\\\ +38 \\\\ \\hline 85"), .calm), [.above(1, "1")], .below),
            .pause(1),
            .line(L("85", .tick, place: .answer), .answer),
            .done(wait: 12),
        ]),
        KidSession("d3-multiply", "Grade 3 · Multiplying: 23 × 4", grade: 3, hand: neat, pace: .typical, mess: mess, [
            .tutorProblem(["23 \\times 4"]),
            .pause(1),
            .line(L("20 \\times 4 = 80", .calm), .below),
            .line(L("3 \\times 4 = 12", .calm), .below),
            .line(L("80 + 12 = 92", .calm), .below),
            .line(L("92", .tick, place: .answer), .answer),
            .done(wait: 12),
        ]),
        KidSession("d4-divide", "Grade 4 · Dividing: 156 ÷ 12", grade: 4, hand: neat, pace: .brisk, mess: mess, [
            .tutorProblem(["156 \\div 12"]),
            .pause(1),
            .line(L("12 \\times 10 = 120", .calm), .below),
            .line(L("156 - 120 = 36", .calm), .below),
            .line(L("12 \\times 3 = 36", .calm), .below),
            .line(L("10 + 3 = 13", .calm), .below),
            .line(L("13", .tick, place: .answer), .answer),
            .done(wait: 12),
        ]),
        KidSession("d5-fractions", "Grade 5 · Adding fractions: ½ + ⅓", grade: 5, hand: neat, pace: .brisk, mess: mess, [
            .tutorProblem(["\\frac{1}{2} + \\frac{1}{3}"]),
            .pause(1),
            .line(L("\\frac{3}{6} + \\frac{2}{6} = \\frac{5}{6}", .calm), .below),
            .line(L("\\frac{5}{6}", .tick, place: .answer), .answer),
            .done(wait: 12),
        ]),
        KidSession("d6-equation", "Grade 6 · Solving x − 7 = 15", grade: 6, hand: neat, pace: .brisk, mess: mess, [
            .tutorProblem(["x - 7 = 15"]),
            .pause(1),
            .line(L("x = 15 + 7", .calm), .below),
            .line(L("x = 22", .tick, place: .answer), .answer),
            .done(wait: 12),
        ]),
        // the tutor's best moment: a slip, a gentle ring and its hint, the kid fixes it, a tick
        KidSession("d7-slip-fix", "Grade 7 · 3x + 5 = 20: a slip, a hint, fixed", grade: 7, hand: neat, pace: .brisk, mess: mess, budget: 30, [
            .tutorProblem(["3x + 5 = 20"]),
            .pause(1),
            .line(L("3x = 25", .ring, value: "15"), .below),
            .tap(.check),
            .done(wait: 10),
            .expect(.hint),
            .pause(3.5),
            .tap(.gotIt),
            .strike,
            .line(L("3x = 15", .calm), .below),
            .line(L("x = 5", .tick, place: .answer), .answer),
            .done(wait: 12),
        ]),
        // the tutor's other best moment: Help me, Show me, and the tutor writes the next step in cobalt
        KidSession("d8-help-me", "Grade 8 · −2x + 7 = −5: Help me writes the next step", grade: 8, hand: neat, pace: .brisk, mess: mess,
                   budget: 30, [
            .tutorProblem(["-2x + 7 = -5"]),
            .pause(3),
            .tap(.helpMe),
            .pause(4),
            .expect(.hint),
            .pause(2.5),
            .tap(.showMe),
            .pause(12),
            .tap(.gotIt),
            .pause(1),
            .line(L("x = 6", .tick, place: .answer), .answer),
            .done(wait: 12),
        ]),
    ]

    // MARK: - B. word problems from real life

    public static let wordProblems: [KidSession] = [
        KidSession("w1-pizza", "Sharing a pizza · ¾ split 3 ways", grade: 5, hand: neat, pace: .brisk, mess: mess, [
            .tutorProblem(["\\text{3 friends share }\\frac{3}{4}\\text{ of a pizza equally.}", "\\text{How much pizza does each friend get?}"]),
            .pause(2.5),
            .line(L("\\frac{3}{4} \\div 3 = \\frac{1}{4}", .calm), .below),
            .line(L("\\frac{1}{4}", .tick, place: .answer), .answer),
            .done(wait: 12),
        ]),
        KidSession("w2-change", "Change at the store · $20 − $13.45", grade: 4, hand: neat, pace: .brisk, mess: mess, [
            .tutorProblem(["\\text{Lunch costs \\$13.45. You pay with a \\$20 bill.}", "\\text{How much change do you get?}"]),
            .pause(2.5),
            .line(L("20.00 - 13.45 = 6.55", .calm), .below),
            .line(L("6.55", .tick, place: .answer), .answer),
            .done(wait: 12),
        ]),
        KidSession("w3-recipe", "Doubling a recipe · ¾ cup × 2", grade: 5, hand: neat, pace: .brisk, mess: mess, [
            .tutorProblem(["\\text{A cookie recipe uses }\\frac{3}{4}\\text{ cup of sugar.}", "\\text{How much sugar for a double batch?}"]),
            .pause(2.5),
            .line(L("\\frac{3}{4} \\times 2 = \\frac{6}{4}", .calm), .below),
            .line(L("\\frac{6}{4} = 1\\frac{1}{2}", .calm), .below),
            .line(L("1\\frac{1}{2}", .tick, place: .answer), .answer),
            .done(wait: 12),
        ]),
        KidSession("w4-speed", "Speed · 150 miles in 3 hours", grade: 6, hand: neat, pace: .brisk, mess: mess, [
            .tutorProblem(["\\text{A car drives 150 miles in 3 hours.}", "\\text{How many miles does it go each hour?}"]),
            .pause(2.5),
            .line(L("150 \\div 3 = 50", .calm), .below),
            .line(L("50", .tick, place: .answer), .answer),
            .done(wait: 12),
        ]),
        KidSession("w5-sale", "A sale · 25% off $48", grade: 7, hand: neat, pace: .brisk, mess: mess, [
            .tutorProblem(["\\text{A jacket costs \\$48. It is 25\\% off.}", "\\text{What is the sale price?}"]),
            .pause(2.5),
            .line(L("\\frac{1}{4} \\times 48 = 12", .calm), .below),
            .line(L("48 - 12 = 36", .calm), .below),
            .line(L("36", .tick, place: .answer), .answer),
            .done(wait: 12),
        ]),
    ]

    public static func named(_ id: String) -> KidSession? { all.first { $0.id == id } }
}
