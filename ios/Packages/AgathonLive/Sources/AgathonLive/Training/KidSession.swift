import AgathonBoard
import Foundation

/// A whole homework session as a kid does it on the real board (the owner, 2026-10-22: "make it like a
/// real human doing math, it will be a little messy and not all in 1 line"): problems the tutor gives
/// and their own, lines that tilt, drift and wander right, carries over a column, a digit crossed out
/// and borrowed from, a line scribbled out and written again, an answer off to the side, two problems
/// side by side, a long think in the middle, the buttons a kid taps — and what a kid should see at each
/// point. Debug's session player (`-kidSession <id>`) plays one on the board; `KidSessionUITests` runs
/// them against production with the training flag.
///
/// Nothing here is a real child's writing: the glyphs are the synthetic hands (`StudentHand`), moved
/// by `KidMess`.
public struct KidSession: Sendable, Identifiable {
    public var id: String
    public var title: String
    public var grade: Int
    public var hand: TrainingHand
    public var pace: KidPace
    public var mess: KidMess
    public var steps: [KidStep]
    /// the paid calls this session may make (the training budget for its launch)
    public var budget: Int

    public init(_ id: String, _ title: String, grade: Int, hand: TrainingHand, pace: KidPace = .typical, mess: KidMess, budget: Int = 20,
                _ steps: [KidStep]) {
        self.id = id
        self.title = title
        self.grade = grade
        self.hand = hand
        self.pace = pace
        self.mess = mess
        self.budget = budget
        self.steps = steps
    }
}

/// Where a kid puts a line, on the page's own layout (1600 × 900).
public enum KidSpot: String, Sendable, Equatable {
    /// their own problem, at the top of the page
    case top
    /// under the work so far, in the column they are in
    case below
    /// the page's answer spot (a problem page); under the work on a free page
    case answer
    /// off to the right of the line before, on its level
    case side
    /// a second column beside the first problem (two problems side by side)
    case column2
    /// low on the page, near its bottom edge
    case nearBottom
}

/// What the kid does to the digits of a stacked sum besides the rows (a column counted from the right,
/// 0 = ones; the top row's digits).
public enum KidColumnMark: Sendable, Equatable {
    /// a small digit written over the column (a carry, or the new digit of a borrow)
    case above(Int, String)
    /// the top row's digit crossed out (a borrow)
    case cross(Int)
    /// a small digit written just before the top row's digit (the 1 that makes 2 into 12)
    case before(Int, String)
}

/// A button on the board a kid taps (its accessibility id): the UI test taps the real one.
public enum KidButton: String, Sendable {
    case check = "live.check"
    case helpMe = "live.helpMe"
    case gotIt = "live.hint.gotIt"
    case newPage = "live.newPage"
    case keepHere = "live.keepHere"
    case nowYouTry = "live.nowYouTry"
    case next = "live.next"
}

/// What a kid should see at a point of the session.
public enum KidExpect: Sendable, Equatable {
    /// "New page for this one" is offered
    case newPageOffer
    /// no "New page for this one"
    case noNewPageOffer
    /// "Now you try one" is offered
    case nowYouTryOffer
    /// a hint card is up
    case hint
    /// the page on show has `n` kid lines of the second problem moved onto it (after "New page for this
    /// one"): the moved problem heads it and nothing of the first problem came along
    case movedHere(Int)
    /// the page on show is a problem page with the tutor's problem
    case onProblemPage
}

public enum KidStep: Sendable {
    /// the tutor gives a problem on its own page (a practice set's path: `write_problems`)
    case tutorProblem([String])
    /// a line of work, at a spot (its expectation is judged when the problem ends)
    case line(TrainingLineSpec, KidSpot)
    /// a stacked sum (the line's LaTeX an array), with carries or a borrow on its top row, written as a
    /// kid writes them: the rows and the bar, the marks, then the answer row
    case stacked(TrainingLineSpec, [KidColumnMark], KidSpot)
    /// thinking: the pen up for so many seconds
    case pause(Double)
    /// the last line scribbled out (a zigzag over it), then left
    case scratchOut
    /// one stroke through the last line
    case strike
    /// the last line rubbed out with the eraser
    case erase
    /// a button tapped (the UI test taps the real one)
    case tap(KidButton)
    /// the problem the tutor just wrote (Now you try) worked under it: its steps, the last in the
    /// answer spot; `slip` writes the last one off by one
    case solveOffered(slip: Bool)
    /// what the kid should see now
    case expect(KidExpect)
    /// the kid has finished the problem and waits (a check may come now: when done)
    case done(wait: Double)
    /// a screenshot for the report
    case shot(String)
}

/// How a kid's lines go astray down a page. All of it seeded: the same session, the same page.
public struct KidMess: Sendable, Equatable {
    /// each line tilted by up to ± this (degrees), plus `lean`
    public var tilt: Double
    public var lean: Double
    /// the baseline sloping along a line (y per x: 0.04 is 4 units down per 100 across)
    public var slope: Double
    /// each line this much bigger than the one before (0.06: 6% a line; negative: smaller)
    public var growth: Double
    /// each line this many units further right than the one before (a staircase)
    public var wander: Double
    /// up to ± this on each line's left edge and its gap under the line before
    public var jitter: Double
    /// the gap under the line before (layout units, before jitter)
    public var gap: Double

    public init(tilt: Double = 0, lean: Double = 0, slope: Double = 0, growth: Double = 0, wander: Double = 0, jitter: Double = 0, gap: Double = 24) {
        self.tilt = tilt
        self.lean = lean
        self.slope = slope
        self.growth = growth
        self.wander = wander
        self.jitter = jitter
        self.gap = gap
    }

    public static let tidy = KidMess()
    public static let little = KidMess(tilt: 1.5, slope: 0.015, jitter: 10, gap: 26)
    public static let lots = KidMess(tilt: 3.5, lean: 1, slope: 0.035, growth: 0.04, wander: 18, jitter: 22, gap: 30)

    /// A line's ink (its box at 0, 0) as the kid's `k`th line on the page: tilted, sloped and sized,
    /// its box back at 0, 0.
    public func apply(_ ink: [[Vec2]], line k: Int, rng: inout SplitMix) -> [[Vec2]] {
        let pts = ink.flatMap { $0 }
        guard let h = pts.map(\.y).max(), pts.count > 1 else { return ink }
        let size = max(0.55, 1 + growth * Double(k)) * (1 + Self.unit(&rng) * 0.05)
        let angle = (lean + Self.unit(&rng) * tilt) * .pi / 180
        let c = cos(angle), s = sin(angle)
        let pivot = Vec2(0, h / 2)
        let moved = ink.map { stroke in
            stroke.map { p -> Vec2 in
                let sloped = Vec2(p.x, p.y + slope * p.x)
                let d = Vec2((sloped.x - pivot.x) * size, (sloped.y - pivot.y) * size)
                return Vec2(pivot.x + d.x * c - d.y * s, pivot.y + d.x * s + d.y * c)
            }
        }
        return Self.atOrigin(moved)
    }

    /// The `k`th line's nudges: right (the staircase plus jitter) and down (the gap plus jitter).
    public func offset(line k: Int, rng: inout SplitMix) -> (dx: Double, gap: Double) {
        (wander * Double(k) + Self.unit(&rng) * jitter, max(8, gap + Self.unit(&rng) * jitter * 0.6))
    }

    /// −1…1
    static func unit(_ rng: inout SplitMix) -> Double {
        Double(rng.next() % 2_000_001) / 1_000_000 - 1
    }

    static func atOrigin(_ ink: [[Vec2]]) -> [[Vec2]] {
        let pts = ink.flatMap { $0 }
        guard let x0 = pts.map(\.x).min(), let y0 = pts.map(\.y).min() else { return ink }
        return ink.map { $0.map { Vec2($0.x - x0, $0.y - y0) } }
    }
}

/// The marks a kid adds by hand: scribbles, strikes, the small digits of a stacked sum.
public enum KidMarks {
    /// A scribble over `box`: a fast zigzag, left to right, most of its height.
    public static func scribble(over box: Box, rng: inout SplitMix) -> [Vec2] {
        let turns = max(6, Int(box.w / 22))
        var out: [Vec2] = []
        for i in 0...turns {
            let x = box.x - 6 + (box.w + 12) * Double(i) / Double(turns)
            let up = i % 2 == 0
            let y = up ? box.y + box.h * 0.12 : box.maxY - box.h * 0.12
            out.append(Vec2(x + KidMess.unit(&rng) * 4, y + KidMess.unit(&rng) * 5))
        }
        return out
    }

    /// One stroke through `box`, end to end, a little uphill.
    public static func strike(through box: Box) -> [Vec2] {
        let y = box.y + box.h * 0.5
        return [Vec2(box.x - 10, y + 4), Vec2(box.maxX + 10, y - 4)]
    }

    /// The digits of a stacked sum's top row, right to left: the strokes of its first band grouped
    /// by overlapping x (a digit's strokes overlap; digits sit apart).
    public static func topRowDigits(_ ink: [[Vec2]]) -> [Box] {
        let boxes = ink.compactMap { Box.around($0) }
        guard let top = boxes.map(\.y).min() else { return [] }
        // the first band: strokes that start within the top row's height
        let rowH = boxes.filter { $0.y <= top + 4 }.map(\.h).max() ?? 40
        let row = boxes.filter { $0.y < top + rowH * 0.6 && $0.w < rowH * 4 }.sorted { $0.x < $1.x }
        var digits: [Box] = []
        for b in row {
            if let last = digits.last, b.x <= last.maxX - min(b.w, last.w) * 0.25 {
                digits[digits.count - 1] = last.union(b)
            } else {
                digits.append(b)
            }
        }
        return digits.reversed()
    }

    /// The strokes of a stacked sum before its last bar (the rows and their bars, the answer row
    /// left), and the answer row's: a kid writes carries before the answer.
    public static func splitAtAnswer(_ ink: [[Vec2]]) -> (rows: [[Vec2]], answer: [[Vec2]]) {
        // the last bar: the widest flat stroke
        let flat = ink.enumerated().compactMap { i, s -> (Int, Box)? in
            guard let b = Box.around(s), b.w > 3 * max(b.h, 1), b.w > 40 else { return nil }
            return (i, b)
        }
        guard let bar = flat.max(by: { $0.1.y < $1.1.y }) else { return (ink, []) }
        var rows: [[Vec2]] = [], answer: [[Vec2]] = []
        for (i, s) in ink.enumerated() {
            if i != bar.0, let b = Box.around(s), b.y > bar.1.y { answer.append(s) } else { rows.append(s) }
        }
        return (rows, answer)
    }
}

/// The twelve sessions (grades 2–8): column work, multiplication, long division, fractions, decimals,
/// one- and two-step equations, a word problem — each with its own mess.
public enum KidSessions {
    typealias L = TrainingLineSpec

    static func stack(_ rows: String) -> String { "\\begin{array}{r} \(rows) \\end{array}" }

    public static let all: [KidSession] = [
        KidSession("s01-carry", "47 + 38 stacked, a carry over the tens", grade: 2, hand: .big, pace: .slow, mess: .little, [
            .tutorProblem(["47 + 38"]),
            .expect(.onProblemPage),
            .stacked(L(stack("47 \\\\ +38 \\\\ \\hline 85"), .calm), [.above(1, "1")], .below),
            .shot("worked"),
            .pause(2.5),
            .line(L("85", .tick, place: .answer), .answer),
            .done(wait: 14),
            .shot("checked"),
        ]),
        KidSession("s02-borrow", "52 − 27 stacked, the 5 crossed out to borrow", grade: 2, hand: .messy, mess: .little, [
            .tutorProblem(["52 - 27"]),
            .stacked(L(stack("52 \\\\ -27 \\\\ \\hline 25"), .calm), [.cross(1), .above(1, "4"), .before(0, "1")], .below),
            .shot("worked"),
            .pause(3),
            .line(L("25", .tick, place: .answer), .answer),
            .done(wait: 14),
            .shot("checked"),
        ]),
        KidSession("s03-wander", "23 × 4 split up, lines wandering right, the answer off to the side", grade: 3, hand: .slanted,
                   mess: KidMess(tilt: 2.5, slope: 0.02, growth: 0.07, wander: 34, jitter: 12, gap: 26), [
            .line(L("23 \\times 4", .quiet, place: .problem), .top),
            .line(L("20 \\times 4 = 80", .calm), .below),
            .pause(1.5),
            .line(L("3 \\times 4 = 12", .calm), .below),
            .line(L("80 + 12 = 92", .calm), .below),
            .line(L("92", .calm), .side),
            .shot("worked"),
            .tap(.check),
            .done(wait: 16),
            .shot("checked"),
        ]),
        KidSession("s04-slip-help", "34 × 6: a slip, a ring, Help me, the fix, then Now you try", grade: 3, hand: .steep, mess: .little, budget: 30, [
            .tutorProblem(["34 \\times 6"]),
            .line(L("30 \\times 6 = 180", .calm), .below),
            .line(L("4 \\times 6 = 24", .calm), .below),
            .line(L("180 + 24 = 214", .ring, value: "204"), .below),
            .tap(.check),
            .done(wait: 14),
            .shot("ringed"),
            .tap(.helpMe),
            .expect(.hint),
            .shot("hint"),
            .tap(.gotIt),
            .strike,
            .line(L("180 + 24 = 204", .calm), .below),
            .line(L("204", .tick, place: .answer), .answer),
            .done(wait: 16),
            .shot("fixed"),
            .expect(.nowYouTryOffer),
            .tap(.nowYouTry),
            .pause(6),
            .expect(.onProblemPage),
            .solveOffered(slip: false),
            .done(wait: 16),
            .shot("now-you-try-done"),
        ]),
        KidSession("s05-long-division", "156 ÷ 12 in chunks, then the bracket", grade: 4, hand: .clean,
                   mess: KidMess(tilt: 2, slope: 0.025, jitter: 14, gap: 28), [
            .tutorProblem(["156 \\div 12"]),
            .line(L("12 \\times 10 = 120", .calm), .below),
            .line(L("156 - 120 = 36", .calm), .below),
            .pause(2),
            .line(L("12 \\times 3 = 36", .calm), .below),
            .line(L("13", .tick, place: .answer), .answer),
            .done(wait: 14),
            .shot("checked"),
        ]),
        KidSession("s06-side-by-side", "two problems side by side on one page, then New page for this one", grade: 4, hand: .messy, mess: .lots, [
            .line(L("36 + 24 = 60", .calm), .below),
            .line(L("45 - 19 = 26", .calm), .column2),
            .shot("side-by-side"),
            .done(wait: 18),
            .expect(.newPageOffer),
            .shot("offer"),
            .tap(.newPage),
            .pause(4),
            .expect(.movedHere(1)),
            .shot("moved"),
        ]),
        KidSession("s07-fractions", "½ + ⅓ with a tilted, sloping hand", grade: 5, hand: .slanted,
                   mess: KidMess(tilt: 3, lean: -2, slope: 0.04, jitter: 12, gap: 30), [
            .tutorProblem(["\\frac{1}{2} + \\frac{1}{3}"]),
            .line(L("\\frac{3}{6} + \\frac{2}{6}", .calm), .below),
            .pause(2),
            .line(L("= \\frac{5}{6}", .calm), .below),
            .line(L("\\frac{5}{6}", .tick, place: .answer), .answer),
            .done(wait: 14),
            .shot("checked"),
        ]),
        KidSession("s08-decimals-scratch", "4.5 × 2.3: a line scribbled out and written again", grade: 5, hand: .small, mess: .little, [
            .tutorProblem(["4.5 \\times 2.3"]),
            .line(L("45 \\times 23 = 1025", .quiet), .below),
            .pause(1.5),
            .scratchOut,
            .line(L("45 \\times 23 = 1035", .calm), .below),
            .line(L("4.5 \\times 2.3 = 10.35", .calm), .below),
            .line(L("10.35", .tick, place: .answer), .answer),
            .done(wait: 14),
            .shot("checked"),
        ]),
        KidSession("s09-long-think", "x − 7 = 15 with a 22-second think in the middle", grade: 6, hand: .messy, pace: .slow, mess: .little, [
            .line(L("x - 7 = 15", .quiet, place: .problem), .top),
            .pause(22),
            .shot("after-think"),
            .line(L("x = 15 + 7", .calm), .below),
            .pause(2),
            .line(L("x = 22", .calm), .below),
            .done(wait: 20),
            .shot("checked"),
        ]),
        KidSession("s10-staircase-keep", "3x + 5 = 20 as a staircase, a second problem under it, Keep it here", grade: 7, hand: .steep,
                   mess: KidMess(tilt: 2, slope: 0.02, growth: -0.05, wander: 60, jitter: 10, gap: 22), [
            .line(L("3x + 5 = 20", .quiet, place: .problem), .top),
            .line(L("3x = 15", .calm), .below),
            .line(L("x = 5", .calm), .below),
            .pause(3),
            .line(L("2x - 4 = 10", .quiet), .below),
            .line(L("2x = 14", .calm), .below),
            .line(L("x = 7", .calm), .below),
            .done(wait: 18),
            .expect(.newPageOffer),
            .shot("offer"),
            .tap(.keepHere),
            .pause(2),
            .expect(.noNewPageOffer),
            .shot("kept"),
        ]),
        KidSession("s11-negatives-erase", "−2x + 7 = −5: a sign slip, a ring, rubbed out and redone (then saved)", grade: 8, hand: .big, mess: .little, [
            .tutorProblem(["-2x + 7 = -5"]),
            .line(L("-2x = -12", .calm), .below),
            .line(L("x = -6", .ring, value: "6", place: .answer), .answer),
            .done(wait: 14),
            .shot("ringed"),
            .pause(2),
            .erase,
            .line(L("x = 6", .tick, place: .answer), .answer),
            .done(wait: 14),
            .shot("fixed"),
        ]),
        // the tutor's desk writes no word problem it cannot check (2026-10-22: "Maya has 3 bags of 12 apples…"
        // and "A pen costs 2 dollars…" both refused, reported): the kid works one from their paper homework
        KidSession("s12-word-edge", "a word problem from paper, big writing down to the page's edge", grade: 4, hand: .big,
                   mess: KidMess(tilt: 2, slope: 0.02, growth: 0.1, jitter: 14, gap: 60), [
            .line(L("3 \\times 12 = 36", .calm), .below),
            .pause(6),
            .line(L("36 - 9 = 27", .calm), .nearBottom),
            .shot("edge"),
            .done(wait: 16),
            .shot("checked"),
        ]),
    ]

    public static func named(_ id: String) -> KidSession? { all.first { $0.id == id } }

    /// Every line a session writes (for the hand-can-write-it test).
    public static func lines(_ s: KidSession) -> [TrainingLineSpec] {
        s.steps.compactMap { step in
            switch step {
            case .line(let l, _), .stacked(let l, _, _): return l
            default: return nil
            }
        }
    }
}

/// How a kid's pen moves along one stroke: slow to start, quick in the middle, slow to lift (each
/// stroke its own swing), pressing in and easing off, a little uneven — and some strokes quicker or
/// slower than the pace says.
public enum KidPen {
    /// Per point (`count` of them): its pressure (0…1) and when it is reached (0…1 of the stroke's time).
    public static func profile(count: Int, rng: inout SplitMix) -> (pressures: [Double], times: [Double]) {
        guard count >= 2 else { return (Array(repeating: 0.5, count: max(0, count)), Array(repeating: 1, count: max(0, count))) }
        let base = 0.42 + KidMess.unit(&rng) * 0.18
        let swing = 0.35 + (KidMess.unit(&rng) + 1) * 0.15
        var pressures: [Double] = []
        var times: [Double] = []
        for i in 0..<count {
            let u = Double(i) / Double(count - 1)
            let attack = min(1, u / 0.1), release = min(1, (1 - u) / 0.12)
            let p = base * (0.35 + 0.65 * min(attack, release)) + KidMess.unit(&rng) * 0.04
            pressures.append(min(1, max(0.05, p)))
            times.append(u - swing * sin(2 * .pi * u) / (2 * .pi))
        }
        times[count - 1] = 1
        return (pressures, times)
    }

    /// This stroke's speed against the pace's: 0.75…1.35 of its time.
    public static func tempo(_ rng: inout SplitMix) -> Double {
        1.05 + KidMess.unit(&rng) * 0.3
    }
}
