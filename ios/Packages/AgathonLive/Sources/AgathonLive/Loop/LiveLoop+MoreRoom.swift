import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation

/// "More room" (docs/PROBLEM-PAGES.md): one problem spread over more pages when a kid's big
/// handwriting runs out of space. The pages are screens linked by the problem's first page
/// (`ProblemPage.continues`, `ProblemPageGroup`); everything here keeps the loop's one rule — it works
/// on the page on show — and adds what crosses a page break:
///
///  - **More room:** offered in the page's corner once the kid's work reaches the last row of the
///    last page of a problem; the step (AgathonBoard's `MoreRoom`) adds a page right after it with the
///    problem again, small, at its top, and moves the answer spot there. One kid undo step.
///  - **The column flows on:** the work at the bottom of one page is the work above the top of the
///    next. `analyze` starts this page's first column where the page before's column ended (its last
///    right step, the problem it works, a running total: `PageCarry`), so `+3 = 767` at the top of
///    page 2 goes on from `400 + 364 = 764` at the bottom of page 1.
///  - **Every page of the problem is one problem's work:** its first page's `problem` record heads
///    the columns of every page; a check on any page checks every page (each where it is, in order,
///    its marks written on it); Next shows once the problem is solved on any of its pages; the
///    learning record files every line under the one problem (its first page's key: one attempt).
///
/// A page other than the one on show is judged by a loop of its own on it (`PassBoard`, `passive`):
/// the same reading of its records, the same analysis, the same marks — written straight onto that
/// page — so nothing of the judging is written twice.
extension LiveLoop {
    // MARK: - the problem's pages

    /// The problem the page on show is a page of, when it spreads over more than one.
    var pageGroup: ProblemPageGroup? { board.store.problemGroup(of: board.currentScreenID) }

    /// The page the learning record files this page's problems under: its problem's first page.
    var learnPageId: String { (pageGroup?.first ?? board.currentScreenID).rawValue }

    /// On a continued page: the problem's own records on its first page, heading this page's columns
    /// as they head the first page's (their place here: the problem's copy at the top).
    func groupHeads(keeping old: [ProblemHead]) -> [ProblemHead] {
        guard let group = pageGroup, group.first != board.currentScreenID else { return [] }
        let screen = board.currentScreenID
        let boxes = board.store.drawables(on: screen).compactMap { r -> BrainRect? in
            guard r.meta[MoreRoom.reminderMeta] != nil else { return nil }
            switch r {
            case .stroke(let s): return StrokeBounds.of(s)
            case .math(let m): return BrainRect(x: m.x, y: m.y, w: m.w, h: m.h)
            case .image(let i): return BrainRect(x: i.x, y: i.y, w: i.w, h: i.h)
            default: return nil
            }
        }
        let L = ProblemPageLayout.self
        let rect = BrainRect.around(boxes) ?? L.place(Box(x: L.problemOrigin.x, y: L.problemOrigin.y, w: L.problemMaxX - L.problemOrigin.x, h: 60),
                                                      on: board.screenRect.box).rect
        var out: [ProblemHead] = []
        for case .problem(let p) in board.store.semantic(on: group.first) where p.origin != "student" {
            guard let latex = p.latex, !latex.isEmpty else { continue }
            let lines = latex.components(separatedBy: "\n").filter { !$0.isEmpty }
            let o = old.first { $0.id == p.id }
            out.append(ProblemHead(id: p.id, lines: lines, rect: rect, analyses: o?.lines == lines ? o?.analyses ?? [] : []))
        }
        return out
    }

    /// A problem record's lines with this page's (`ids`) in this page's place: its lines on the
    /// problem's other pages stay, in the pages' order.
    func problemLines(_ old: [RecordID], here ids: [RecordID]) -> [RecordID] {
        guard let group = pageGroup else { return ids }
        let screen = board.currentScreenID
        var byPage: [RecordID: [RecordID]] = [:]
        for l in old {
            guard let s = board.store[l]?.screenID, s != screen, group.pages.contains(s) else { continue }
            byPage[s, default: []].append(l)
        }
        byPage[screen] = ids
        return group.pages.flatMap { byPage[$0] ?? [] }
    }

    // MARK: - More room

    /// "More room": the problem goes on on a new page right after this one (its last), and the board
    /// shows it. One kid undo step (the board's `MoreRoom`).
    public func moreRoom() {
        guard !passive, started, pages.moreRoom else { return }
        guard board.moreRoom() != nil else { return }
        // the loop takes the new page in now (not when the board's notice arrives)
        switchScreen()
    }

    /// The page is getting full: the kid's work (a line read or being read, outside the answer spot)
    /// reaches the last row, on the problem's last page, not yet solved, with a page left to add.
    func wantsMoreRoom(_ page: ProblemPage?, solved: Bool) -> Bool {
        guard !passive, let page, page.kind == .problem, !page.more, !solved else { return false }
        if let group = pageGroup, group.count >= ProblemPageLayout.maxPages { return false }
        guard board.store.screens.count < ScreenRecord.maxScreens else { return false }
        let rect = board.screenRect.box
        return lines.values.contains { st in
            let local = ProblemPageLayout.unplace(st.bounds.box, from: rect)
            return local.maxY >= page.fullBand && !(page.hasAnswerSpot && ProblemPageLayout.isInAnswer(local))
        }
    }

    // MARK: - the column flows on

    /// The column the problem's work goes on in at the top of this page: the first, by its top line
    /// (the highest, then the leftmost of those level with it).
    func flowInColumn() -> Int? {
        var tops: [Int: BrainRect] = [:]
        for st in lines.values where tops[st.column].map({ st.bounds.y < $0.y }) ?? true { tops[st.column] = st.bounds }
        guard let highest = tops.values.map(\.y).min() else { return nil }
        return tops.filter { $0.value.y <= highest + max(24, $0.value.h * 0.6) }.min { $0.value.x < $1.value.x }?.key
    }

    /// The column the problem's work ends in at the bottom of this page: the one whose line is lowest.
    func flowOutColumn() -> Int? {
        lines.values.filter { !$0.latex.isEmpty }.max { $0.bounds.maxY < $1.bounds.maxY }?.column
    }

    /// Where `analyze` starts a column: on a continued page, its first column goes on from the work at
    /// the bottom of the page before.
    func carryIn(column: Int) -> PageCarry? {
        guard let carry = pages.carry, column == flowInColumn() else { return nil }
        return carry
    }

    /// How a column stood after its last line (`analyze` notes it).
    func noteColumnEnd(_ column: Int, _ end: PageCarry) {
        pages.columnEnds[column] = end
    }

    /// How the problem's work stands at the bottom of this page, for the top of its next page: the
    /// column that ends lowest, as `analyze` left it, and the learning record's names for it. A page
    /// with nothing on it passes on what it was given.
    func flowEnd() async -> PageCarry? {
        guard let column = flowOutColumn() else { return pages.carry }
        await analyze(column: column, quiet: true)
        guard var end = pages.columnEnds[column] else { return pages.carry }
        let col = columnLines(column).filter { !$0.latex.isEmpty }
        if let last = col.last {
            end.learnKey = learnKeyFor(last)
            end.problemRecord = board.store[RecordID("line:\(last.id)")].flatMap { r -> RecordID? in
                if case .line(let l) = r { return l.problem }
                return nil
            }
        }
        // the step the next page's first line follows from, for the record: the last right one
        end.previousLatex = col.last { s in
            guard let a = s.analysis, !["label", "incomplete", "unknown", "operation"].contains(a.kind) else { return false }
            return a.verdict != "mismatch" && a.carried != true
        }?.latex ?? pages.carry?.previousLatex
        return end
    }

    /// On a continued page: how the work stood at the bottom of the page before — each page before
    /// this one judged where it is, in order, each going on from the one before it. (A loop on another
    /// page is given its carry.)
    func takeCarry() async {
        guard !passive else { return }
        pages.carry = nil
        guard let group = pageGroup, let i = group.pages.firstIndex(of: board.currentScreenID), i > 0 else { return }
        // a read of the page left still on its way lands in the cache first (it is not read twice)
        await readsSettle()
        var carry: PageCarry?
        for page in group.pages[..<i] {
            carry = await passLoop(on: page, carry: carry).passRun(check: false).end
        }
        pages.carry = carry
    }

    /// Waits (a few seconds at most) for the reads in flight.
    func readsSettle() async {
        let end = ContinuousClock.now + .seconds(6)
        while readsInFlight > 0 && ContinuousClock.now < end {
            try? await Task.sleep(for: .milliseconds(25))
        }
    }

    /// The kid moved to another page of the same problem: their last ink there still counts for the long
    /// pause and the safety net (work held on the page they left is this problem's).
    func arrived(from: RecordID, lastInk: Double) {
        guard !passive, lastInk.isFinite, let group = pageGroup, group.pages.contains(from) else { return }
        pages.lastInkAt = lastInk
        pauseAgainAfterCheck()
        armSafetyNet()
    }

    // MARK: - the problem's other pages

    /// The problem's other pages, as their records say: work still held there (check when done), and a
    /// line there that solved the problem (checked). Read in the problem's page order, like a column:
    /// a ring on a page after the one that solved it means the answer the kid ended on is wrong
    /// (`solved`: a page before this one solved it and nothing since is ringed, here or after; or a page
    /// after this one did and nothing after that is ringed). `ringedLater`: a page after this one has a
    /// ring, so a solving line here is not the end of it. Cached by the store's change count.
    func elsewhere() -> (held: Bool, solved: Bool, ringedLater: Bool) {
        guard !passive, let group = pageGroup else { return (false, false, false) }
        let here = board.currentScreenID
        let store = board.store
        if let e = pages.elsewhere, e.seq == store.seq, e.screen == here {
            return (e.held, e.solvedAfter || (e.solvedBefore && !e.ringedLater && !ringedHere()), e.ringedLater)
        }
        var held = false
        var solvedBefore = false
        var solvedAfter = false
        var ringedLater = false
        var past = false
        for page in group.pages {
            if page == here {
                past = true
                continue
            }
            // (top to bottom: a ring counts only if it comes after what solved)
            let onPage = store.semantic(on: page).compactMap { r -> (LineRecord, Double)? in
                guard case .line(let l) = r, !l.latex.isEmpty else { return nil }
                // (its ink still on that page)
                let ink = l.strokes.compactMap { id -> Double? in
                    guard case .stroke(let s)? = store[id], s.screen == page else { return nil }
                    return s.points.lazy.map { s.pagePoint($0).y }.min()
                }
                guard let top = ink.min() else { return nil }
                return (l, top)
            }.sorted { $0.1 < $1.1 }.map(\.0)
            for l in onPage {
                let checked = l.meta[PageMeta.checked]?.stringValue == l.latex
                if !checked { held = true }
                let judged = checked || !checksWhenDone
                if l.verdict == .solved && judged {
                    if past { solvedAfter = true } else { solvedBefore = true }
                } else if l.verdict == .warn && judged {
                    if past { solvedAfter = false; ringedLater = true } else { solvedBefore = false }
                }
            }
        }
        if !checksWhenDone { held = false }
        pages.elsewhere = (store.seq, here, held, solvedBefore, solvedAfter, ringedLater)
        return (held, solvedAfter || (solvedBefore && !ringedLater && !ringedHere()), ringedLater)
    }

    /// A line on the page on show is ringed.
    func ringedHere() -> Bool {
        lines.values.contains { rt[$0.id]?.markKey?.hasPrefix("circle:") == true }
    }

    func heldOnOtherPages() -> Bool { elsewhere().held }

    func solvedOnOtherPages() -> Bool { elsewhere().solved }

    /// A check on a page of the problem covers its other pages: each is checked where it is, in the
    /// problem's order (each going on from the page before), its marks written on it; the learning
    /// record hears their lines; a slip found on another page is pointed at (its ring is there).
    func checkOtherPages(_ reason: CheckReason) {
        guard checksWhenDone else { return }
        judgeOtherPages(check: true, laterOnly: false)
    }

    /// A reading fixed on this page: the pages after it go on from it, so what is checked there is
    /// judged again (and marked as it is judged now). Nothing new is checked.
    func refreshLaterPages() {
        judgeOtherPages(check: false, laterOnly: true)
    }

    func judgeOtherPages(check: Bool, laterOnly: Bool) {
        guard !passive, started, let group = pageGroup, let here = group.pages.firstIndex(of: board.currentScreenID) else { return }
        guard !laterOnly || here + 1 < group.pages.count else { return }
        let gen = generation
        track { [weak self] in
            guard let self else { return }
            var carry: PageCarry?
            var judged: [(part: Int, result: PassResult)] = []
            for (k, page) in group.pages.enumerated() {
                guard gen == self.generation else { return }
                if k == here {
                    carry = await self.flowEnd()
                    continue
                }
                if laterOnly && k < here { continue }
                let result = await self.passLoop(on: page, carry: carry).passRun(check: check)
                carry = result.end
                judged.append((k + 1, result))
            }
            guard gen == self.generation else { return }
            for j in judged { self.learnAway(j.result) }
            if check, self.hints.isEmpty, !self.pages.solved, !self.solvedOnOtherPages(),
               !self.lines.values.contains(where: { !self.isHeld($0) && self.rt[$0.id]?.markKey?.hasPrefix("circle:") == true }),
               let slip = judged.first(where: { $0.result.slip }) {
                self.say(LiveCopy.Pages.lookBack(slip.part))
            }
            self.refreshPage()
        }
    }

    // MARK: - a loop on another page

    /// A loop of its own on `screen` (another page of this problem), quiet: it shares this loop's
    /// services, brain, clock, settings and reads, writes its marks on its page, and tells no one.
    func passLoop(on screen: RecordID, carry: PageCarry?) -> LiveLoop {
        let pass = LiveLoop(board: PassBoard(store: board.store, screen: screen, fitZoom: board.fitZoom), boardId: boardId, services: services,
                            settings: settings, brain: brain, background: background, scheduler: scheduler,
                            connectivity: PassConnectivity(isOnline: connectivity.isOnline))
        pass.passive = true
        pass.readsEarly = false
        pass.learning.connectsAutomatically = false
        pass.learning.isEnabled = false
        pass.pages.extras = pages.extras
        pass.recognizer = recognizer
        pass.cache = cache
        pass.rereads = rereads
        pass.pages.carry = carry
        return pass
    }

    /// The page taken in (its records; its ink never read is read now), checked when `check` (every
    /// finished line released and marked, quietly: no hint, no step written, no Now you try), then
    /// what the board's loop needs of it, and stopped.
    func passRun(check: Bool) async -> PassResult {
        start()
        await waitUntilIdle(timeout: .seconds(15))
        if check && checksWhenDone {
            let now = scheduler.now
            for st in lines.values.sorted(by: { ($0.column, $0.row) < ($1.column, $1.row) })
            where !st.latex.isEmpty && isHeld(st) && !unfinished(st, reason: .button, now: now) {
                release(st)
                // the kid's own ask: marked with Auto off too
                askedLines[st.id] = st.latex
                render(st.id, quiet: true)
            }
            await waitUntilIdle(timeout: .seconds(5))
        }
        var result = PassResult()
        result.end = await flowEnd()
        result.lineIds = Array(lines.keys)
        result.fresh = result.lineIds.filter { learn.fresh[$0] != nil }
        for st in lines.values.sorted(by: { ($0.column, $0.row) < ($1.column, $1.row) }) where !st.latex.isEmpty && !isHeld(st) {
            let mark = rt[st.id]?.markKey.flatMap(LiveMarks.kind(ofKey:))
            let line = learnLineSignal(st, mark)
            result.signals.append((st.id, line.said, line.signal))
            if mark == .circle { result.slip = true }
            if mark == .check && st.analysis?.solved == true { result.solved = true }
        }
        stop()
        return result
    }

    /// The learning record hears another page's lines (`passRun`), as it hears this page's: when what
    /// it is told about a line changes, and once a line of the problem is new this session.
    func learnAway(_ r: PassResult) {
        guard learning.isEnabled else { return }
        for id in r.fresh { learnFresh(id) }
        let fresh = r.lineIds.contains { learn.fresh[$0] != nil } || lines.keys.contains { learn.fresh[$0] != nil }
        guard fresh else { return }
        for s in r.signals where learn.sent[s.id] != s.said {
            LearnState.remember(&learn.sent, s.id, s.said)
            learnEmit(s.signal)
        }
    }

    /// A loop on another page reads that page's ink never read (a read cut short by More room), not
    /// ink read before that gave nothing (it is read again when the kid is on that page): a check on
    /// page 2 never asks the server about page 1's scribble each time.
    func readBeforeElsewhere(_ ink: InkLine) -> Bool {
        guard passive, case .line(let l)? = board.store[RecordID("line:\(ink.id)")] else { return false }
        return l.verdict == .unknown && Set(l.strokes.map(\.rawValue)) == Set(ink.strokeIds)
    }

    // MARK: - the learning record, on a continued page

    /// A line in this page's first column, of the problem begun on the page before: the record's key for it.
    func carriedLearnKey(_ st: LiveLine) -> String? {
        guard ownHeadAbove(st) == nil, let carry = carryIn(column: st.column) else { return nil }
        return carry.learnKey
    }

    /// …the problem it works (the kid's own, begun on the page before).
    func carriedProblem(_ st: LiveLine) -> [String]? {
        guard ownHeadAbove(st) == nil, let carry = carryIn(column: st.column), !carry.problem.isEmpty else { return nil }
        return carry.problem
    }

    /// …and, for the column's first step here, the step on the page before it follows from.
    func carriedPreviousLatex(_ st: LiveLine) -> String? {
        guard let carry = carryIn(column: st.column), ownHeadAbove(st) == nil else { return nil }
        return carry.previousLatex
    }

    /// The problem record the lines of this page's first column belong to, when it was begun on the
    /// page before (the kid's own problem: its record is on its first page).
    func carriedProblemRecord(_ column: Int) -> RecordID? {
        guard let id = carryIn(column: column)?.problemRecord, case .problem? = board.store[id] else { return nil }
        return id
    }
}

/// What the work at the bottom of one page of a problem hands to the top of its next page ("More
/// room"): `analyze`'s state after the column's last line, and the learning record's names for it.
struct PageCarry: Equatable {
    /// the last right step (what the next line is judged against), and the problem's first relation
    var previous: LineAnalysis?
    var original: LineAnalysis?
    /// the problem the column works, the lines above as judged, the step right above when it is a slip
    var problem: [String]
    var above: [String]
    var slip: LineAnalysis?
    /// what the line above ended in (`400 + 364 = 764` → 764), for a running total going on from it
    var running: String?
    /// a line above solved the problem
    var solvedAbove: Bool
    /// the record's key for the problem, the last right step's LaTeX, the problem record its lines point at
    var learnKey: String?
    var previousLatex: String?
    var problemRecord: RecordID?

    init(previous: LineAnalysis?, original: LineAnalysis?, problem: [String], above: [String], slip: LineAnalysis?, running: String?,
         solvedAbove: Bool) {
        self.previous = previous
        self.original = original
        self.problem = problem
        self.above = above
        self.slip = slip
        self.running = running
        self.solvedAbove = solvedAbove
    }
}

/// What a loop on another page of the problem found there (`passRun`).
struct PassResult {
    /// how the work stands at its bottom (for the page after it)
    var end: PageCarry?
    /// its lines, those read this session, and what the learning record would hear of each checked one
    var lineIds: [String] = []
    var fresh: [String] = []
    var signals: [(id: String, said: String, signal: LearningSignal)] = []
    /// a checked line there is ringed; a checked line there solved the problem
    var slip = false
    var solved = false
}

/// Another page of the problem as a loop sees a board: that page for ever, the tutor's writing put
/// straight on it (`InstantPen`), no pen, no hover, no page of its own to add.
@MainActor
final class PassBoard: LiveBoard {
    let store: BoardStore
    let currentScreenID: RecordID
    let fitZoom: Double?
    var onPen: ((Bool) -> Void)?
    var onScreenChange: ((RecordID) -> Void)?

    init(store: BoardStore, screen: RecordID, fitZoom: Double?) {
        self.store = store
        currentScreenID = screen
        self.fitZoom = fitZoom
    }

    var screenRect: BrainRect { (store[currentScreenID]?.screen?.rect ?? .screen).rect }
    var selection: [RecordID] { [] }
    var isPenDown: Bool { false }
    var reduceMotion: Bool { true }

    func write(_ lines: [TutorLine], meta: Meta, onDone: @escaping @MainActor () -> Void) -> TutorPen {
        let pen = InstantPen(store: store, screen: currentScreenID)
        pen.write(lines, meta: meta) { onDone() }
        return pen
    }

    func addScreen() -> RecordID? { nil }
    func insertScreen(after: RecordID?, meta: Meta, go: Bool) -> RecordID? { nil }
    func moreRoom() -> RecordID? { nil }
}

/// The network as the board's loop last saw it (a loop on another page never hears it change).
@MainActor
final class PassConnectivity: LiveConnectivity {
    let isOnline: Bool
    var onChange: ((Bool) -> Void)?

    init(isOnline: Bool) {
        self.isOnline = isOnline
    }
}
