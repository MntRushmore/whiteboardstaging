import Foundation

/// A screen that is one problem's page (docs/PROBLEM-PAGES.md): the problem at the top in the
/// tutor's hand, "Work it out here" over faint guide lines, the answer spot at the bottom — or the
/// "All done" page that ends a set. Kept in the screen's `meta.page` (a meta key: no schema bump).
///
/// ```json
/// "page": { "kind": "problem", "set": "daily:2026-10-19", "index": 2, "count": 5,
///           "problem": "problem:k3Vb…", "origin": "practice", "workTop": 186 }
/// ```
///
/// A problem that needs more room spreads over more pages ("More room", docs/PROBLEM-PAGES.md): each
/// page after its first says which page it `continues` (the problem's first page), and every page but
/// the last says there is `more` (its answer spot moved on to the last page).
public struct ProblemPage: Equatable, Sendable {
    public enum Kind: String, Sendable {
        /// one problem's page
        case problem
        /// the "All done" page after a set's last problem
        case done
    }

    /// The meta key on the screen.
    public static let metaKey = "page"

    public var kind: Kind
    /// the set the page belongs to (the practice key, `ask:<uuid>`); nil on a kid's own page
    public var setId: String?
    /// its place in the set, from 1, and the set's size (nil on a kid's own page)
    public var index: Int?
    public var count: Int?
    /// the page's `problem` record, once written
    public var problem: RecordID?
    /// practice, chat, nowYouTry, student
    public var origin: String?
    /// where the work area starts (page units), under the problem as written; nil: the default
    public var workTop: Double?
    /// the problem has an answer spot (false: a problem whose answer is a drawing); it is on the
    /// problem's last page (`hasAnswerSpot`)
    public var answer: Bool
    /// "More room": the problem's first page, on each page that continues it (nil on a first page)
    public var continues: RecordID?
    /// "More room": the problem goes on on the next page (this page's answer spot moved there)
    public var more: Bool
    /// a small heading in the problem's place, when the problem itself is shown elsewhere (SAT mode:
    /// "Q3 · Linear functions", the question in the panel beside the board; docs/SAT-MODE.md)
    public var heading: String?
    /// where the work area ends (page units), when not the 1600 × 900 page's (SAT v2: a page made
    /// taller for a long question, its answer cards under the work, docs/SAT-V2.md)
    public var workBottom: Double?
    /// the work area's paper: guide lines (a kid's problem page) or dots (SAT v2, a grown-up pad)
    public var paper: Paper
    /// where the dotted paper is not (the printed question's boxes, page units)
    public var keepOut: [Box]

    public enum Paper: String, Sendable {
        case rules, dots
    }

    public init(kind: Kind = .problem, setId: String? = nil, index: Int? = nil, count: Int? = nil, problem: RecordID? = nil,
                origin: String? = nil, workTop: Double? = nil, answer: Bool = true, continues: RecordID? = nil, more: Bool = false,
                heading: String? = nil, workBottom: Double? = nil, paper: Paper = .rules, keepOut: [Box] = []) {
        self.workBottom = workBottom
        self.paper = paper
        self.keepOut = keepOut
        self.kind = kind
        self.setId = setId
        self.index = index
        self.count = count
        self.problem = problem
        self.origin = origin
        self.workTop = workTop
        self.answer = answer
        self.continues = continues
        self.more = more
        self.heading = heading
    }

    /// The page in a screen's meta, if it is one (an unknown kind is no page: an older build's
    /// reader of a newer page draws a plain screen).
    public init?(meta: Meta) {
        guard let v = meta[Self.metaKey], let kind = v["kind"]?.stringValue.flatMap(Kind.init(rawValue:)) else { return nil }
        self.kind = kind
        setId = v["set"]?.stringValue
        index = v["index"]?.numberValue.map { Int($0) }
        count = v["count"]?.numberValue.map { Int($0) }
        problem = v["problem"]?.stringValue.map { RecordID($0) }
        origin = v["origin"]?.stringValue
        workTop = v["workTop"]?.numberValue
        answer = v["answer"]?.boolValue ?? true
        continues = v["continues"]?.stringValue.map { RecordID($0) }
        more = v["more"]?.boolValue ?? false
        heading = v["heading"]?.stringValue
        workBottom = v["workBottom"]?.numberValue
        paper = v["paper"]?.stringValue.flatMap(Paper.init(rawValue:)) ?? .rules
        if case .array(let boxes)? = v["keepOut"] {
            keepOut = boxes.compactMap { b in
                guard case .array(let n) = b, n.count == 4, let x = n[0].numberValue, let y = n[1].numberValue,
                      let w = n[2].numberValue, let h = n[3].numberValue else { return nil }
                return Box(x: x, y: y, w: w, h: h)
            }
        } else {
            keepOut = []
        }
    }

    /// As the screen's meta stores it (fields at their default left out).
    public var json: JSONValue {
        var o: [String: JSONValue] = ["kind": .string(kind.rawValue)]
        if let setId { o["set"] = .string(setId) }
        if let index { o["index"] = .number(Double(index)) }
        if let count { o["count"] = .number(Double(count)) }
        if let problem { o["problem"] = .string(problem.rawValue) }
        if let origin { o["origin"] = .string(origin) }
        if let workTop { o["workTop"] = .number((workTop * 100).rounded() / 100) }
        if !answer { o["answer"] = .bool(false) }
        if let continues { o["continues"] = .string(continues.rawValue) }
        if more { o["more"] = .bool(true) }
        if let heading { o["heading"] = .string(heading) }
        if let workBottom { o["workBottom"] = .number((workBottom * 100).rounded() / 100) }
        if paper != .rules { o["paper"] = .string(paper.rawValue) }
        if !keepOut.isEmpty {
            o["keepOut"] = .array(keepOut.map { b in .array([b.x, b.y, b.w, b.h].map { .number(($0 * 100).rounded() / 100) }) })
        }
        return .object(o)
    }

    /// One of a set of two or more ("Problem 2 of 5").
    public var inSet: Bool { setId != nil && (count ?? 0) > 1 && index != nil }

    /// The set's last problem.
    public var isLast: Bool { (index ?? 0) >= (count ?? 0) }

    /// The work area's top on this page.
    public var resolvedWorkTop: Double { workTop ?? ProblemPageLayout.defaultWorkTop }

    /// The work area's bottom on this page.
    public var resolvedWorkBottom: Double { workBottom ?? ProblemPageLayout.workBottom }

    /// "More room" is offered once the work reaches this far down (the last row, and a little of
    /// the row above).
    public var fullBand: Double { resolvedWorkBottom - 1.25 * ProblemPageLayout.rulePitch }

    /// The answer spot is on this page: the problem has one, and this is its last page.
    public var hasAnswerSpot: Bool { kind == .problem && answer && !more }

    /// A "More room" page: it continues a problem begun on an earlier page.
    public var isContinuation: Bool { continues != nil }
}

extension ScreenRecord {
    /// The screen as a problem page (or the All done page); nil for a plain screen. Setting nil
    /// makes it plain again.
    public var problemPage: ProblemPage? {
        get { ProblemPage(meta: meta) }
        set { meta[ProblemPage.metaKey] = newValue?.json }
    }
}

/// Where everything on a problem page goes, in page units on the 1600 × 900 screen (the doc's
/// table, docs/PROBLEM-PAGES.md "The page"). A page converted from an old board can have another
/// rect: everything is placed relative to the screen's own rect, scaled by its width.
public enum ProblemPageLayout {
    /// the tutor's problem starts here (its ink's top-left)
    public static let problemOrigin = Vec2(88, 60)
    /// the problem's ink stays left of this
    public static let problemMaxX = 1512.0
    /// the tutor's hand for a problem (the desk's `PROBLEM_GRID.size`)
    public static let problemSize = 48.0
    /// the problem area is at least this deep, and this much below the problem's ink
    public static let problemMinBottom = 170.0
    public static let problemGap = 20.0
    /// between the problem area and the work area
    public static let workGap = 16.0
    /// a one-line problem's work area top
    public static let defaultWorkTop = problemMinBottom + workGap
    /// "Work it out here": its baseline under the work area's top, its size
    public static let workLabelBaseline = 30.0
    public static let workLabelSize = 22.0
    /// the guide lines: the first under the work area's top, then every `rulePitch`, down to `workBottom`
    public static let firstRuleOffset = 74.0
    public static let rulePitch = 80.0
    public static let workBottom = 720.0
    public static let ruleLeft = 88.0
    public static let ruleRight = 1160.0
    public static let ruleWidth = 2.5
    /// the margin lane, right of the guide lines: the tutor's "I read" line up here
    public static let laneX = 1180.0
    public static let laneMaxX = 1512.0
    /// the answer spot
    public static let answer = Box(x: 88, y: 744, w: 872, h: 116)
    public static let answerRadius = 28.0
    public static let answerLabelInset = 32.0
    public static let answerLabelSize = 30.0
    /// the action corner, right of the answer spot: Check and Next sit here (view space)
    public static let actions = Box(x: 1000, y: 744, w: 512, h: 116)
    /// a work area keeps at least this many guide rows
    public static let minRows = 2

    // "More room" (docs/PROBLEM-PAGES.md): a page that continues a problem

    /// "Problem 2, continued": its baseline and size, in the problem's place
    public static let continuedBaseline = 76.0
    public static let continuedSize = 20.0
    /// the problem again, small, under it: its top-left, at most this scale and this tall (a one-line
    /// problem at a little under half size; a word problem smaller), so the page has a row more than
    /// the problem's first page
    public static let reminderOrigin = Vec2(88, 88)
    public static let reminderScale = 0.45
    public static let reminderMaxHeight = 60.0
    /// a continued page's work area starts this far under the reminder, and never above `continuedMinWorkTop`
    public static let reminderGap = 20.0
    public static let continuedMinWorkTop = 150.0
    /// "More room" is offered once the kid's work reaches this far down (the last row of the work
    /// area, and a little of the row above)
    public static let fullBand = workBottom - 1.25 * rulePitch
    /// a problem spreads over at most this many pages
    public static let maxPages = 4

    /// A continued page's work area top, under the problem's reminder ending at `reminderBottom`.
    public static func continuedWorkTop(reminderBottom: Double) -> Double {
        let latest = workBottom - firstRuleOffset - Double(minRows - 1) * rulePitch
        return min(max(continuedMinWorkTop, reminderBottom + reminderGap), latest)
    }

    /// The work area's top for a problem whose ink ends at `problemBottom` (page units).
    public static func workTop(problemBottom: Double) -> Double {
        let bottom = max(problemMinBottom, problemBottom + problemGap)
        // the work area keeps its two rows, the answer spot its place
        let latest = workBottom - firstRuleOffset - Double(minRows - 1) * rulePitch
        return min(bottom + workGap, latest)
    }

    /// Dotted paper (SAT v2): a dot every `dotPitch`, from `dotsLeft` to `dotsRight`.
    public static let dotPitch = 36.0
    public static let dotRadius = 1.8
    public static let dotsLeft = 84.0
    public static let dotsRight = 1528.0

    /// The dots' centres under a work area from `workTop` to `bottom`, none in `keepOut`.
    public static func dots(workTop: Double, bottom: Double, keepOut: [Box]) -> [Vec2] {
        var out: [Vec2] = []
        var y = workTop + dotPitch / 3
        while y <= bottom + 0.5 {
            var x = dotsLeft
            while x <= dotsRight + 0.5 {
                if !keepOut.contains(where: { $0.contains(Vec2(x, y)) }) { out.append(Vec2(x, y)) }
                x += dotPitch
            }
            y += dotPitch
        }
        return out
    }

    /// The guide lines' y, top to bottom, under a work area starting at `workTop` (and ending at
    /// `bottom`: the page's own, on a taller page).
    public static func rules(workTop: Double, bottom: Double = workBottom) -> [Double] {
        var out: [Double] = []
        var y = workTop + firstRuleOffset
        while y <= bottom + 0.5 {
            out.append(y)
            y += rulePitch
        }
        return out
    }

    /// The deepest a problem's ink may go and still leave the work area its rows.
    public static var problemMaxBottom: Double {
        workBottom - firstRuleOffset - Double(minRows - 1) * rulePitch - workGap - problemGap
    }

    /// The work area (page units, on a 1600 × 900 screen).
    public static func workArea(workTop: Double) -> Box {
        Box(x: ruleLeft, y: workTop, w: laneMaxX - ruleLeft, h: workBottom - workTop)
    }

    /// `box` (a line's ink, page units on a 1600 × 900 screen) is written in the answer spot: its
    /// middle is inside it.
    public static func isInAnswer(_ box: Box) -> Bool {
        answer.contains(box.center)
    }

    /// A point of the layout (on the 1600 × 900 screen) on `screen` (its own rect).
    public static func place(_ p: Vec2, on screen: Box) -> Vec2 {
        let k = screen.w / Box.screen.w
        return Vec2(screen.x + p.x * k, screen.y + p.y * k)
    }

    /// A box of the layout on `screen`.
    public static func place(_ b: Box, on screen: Box) -> Box {
        let k = screen.w / Box.screen.w
        return Box(x: screen.x + b.x * k, y: screen.y + b.y * k, w: b.w * k, h: b.h * k)
    }

    /// A box on `screen` back in the layout's own units (the inverse of `place`).
    public static func unplace(_ b: Box, from screen: Box) -> Box {
        let k = screen.w > 0 ? Box.screen.w / screen.w : 1
        return Box(x: (b.x - screen.x) * k, y: (b.y - screen.y) * k, w: b.w * k, h: b.h * k)
    }
}
