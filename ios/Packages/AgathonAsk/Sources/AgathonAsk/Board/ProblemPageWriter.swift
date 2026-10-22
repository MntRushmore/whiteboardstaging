import AgathonBoard
import AgathonBrain
import AgathonKit
import AgathonLive
import Foundation
import os

/// One problem per page (docs/PROBLEM-PAGES.md, "Writing problems on pages"): every problem the tutor
/// gives — Today's practice, a topic, Ask's `write_problems` ("3 more like these") — on its own page,
/// with the problem at the top in the tutor's hand, then the All done page for a set of two or more.
///
/// The desk (the web's `ChatDesk` in the brain, unchanged) still checks each problem — the engine reads
/// it, it is solvable, the hand can draw it — on a copy of an empty page; the writer takes the problem
/// as the desk checked it (its `chatProblem.lines`, in the board's own form) and writes it at the
/// page's problem origin in a bigger hand than a grid cell has room for, without a grid number. The
/// strokes still carry `chatProblem` (Ask's `help_problem`, the learning record's chat cells and the
/// loop's problem records keep working), its `cell` the whole page.
///
/// A word problem (the desk refuses sentences: it writes maths only) gets its page too, its words at
/// the top in the tutor's hand (`WordProblem`), heading no column: the kid's first line under them
/// is the problem their work is judged against.
///
/// The first page is written by hand, as the kid watches; the others are put on their pages at once
/// (`InstantPen`), so the board does not flip through the set.
@MainActor
public final class ProblemPageWriter {
    static let log = Logger(subsystem: "app.agathon.Agathon", category: "ask")

    /// A set to write: its problems, the set's id (`daily:2026-10-19`, `ask:<uuid>`) and where its
    /// problems come from (`practice`, `chat`).
    public struct Request: Sendable {
        public var problems: [[String]]
        public var setId: String
        public var origin: String
        /// an All done page after a set of two or more
        public var allDone: Bool

        public init(problems: [[String]], setId: String, origin: String, allDone: Bool = true) {
            self.problems = problems
            self.setId = setId
            self.origin = origin
            self.allDone = allDone
        }
    }

    /// What was written.
    public struct Report: Equatable, Sendable {
        /// the problem pages, in order
        public var pages: [RecordID] = []
        public var allDone: RecordID?
        /// problems the desk refused (they could not be checked, or drawn)
        public var dropped = 0
        /// the desk's words for what was left out
        public var notes: [String] = []
        public var written: Int { pages.count }
    }

    let driver: AskBoardDriver
    var board: LiveBoard { driver.board }

    public init(driver: AskBoardDriver) {
        self.driver = driver
    }

    /// The problem's hand on a page, and the smallest it shrinks to for a long problem.
    public static let handSize = 72.0
    public static let minHandSize = 32.0
    /// the whole page is the problem's cell: everything written on it is its work
    public static let pageCell = AgathonBrain.Rect(x: 40, y: 40, w: 1520, h: 840)

    /// Writes the set: verified, laid out, a page each (the first, if the board is on a blank page,
    /// is that page), the All done page, then the board shows the first and the tutor writes it.
    /// `onTutorScreen` hears the first page when it is a new one (Ask's exchange goes with it).
    public func write(_ request: Request, onTutorScreen: ((AskScreenRef) -> Void)? = nil) async -> Report {
        var report = Report()
        // 1. each problem as the desk checks it
        var kept: [(lines: [String], meta: Meta)] = []
        for problem in request.problems {
            switch await verify(problem) {
            case .ok(let lines, let meta): kept.append((lines, meta))
            case .refused where WordProblem.sentences(problem) != nil:
                kept.append((WordProblem.sentences(problem) ?? [], [WordProblem.meta: true]))
            case .refused(let note):
                report.dropped += 1
                if let note, !report.notes.contains(note) { report.notes.append(note) }
            }
        }
        guard !kept.isEmpty else { return report }
        // 2. each laid out at the page's problem origin
        var planned: [(plan: HandPlan?, lines: [String], meta: Meta)] = []
        for (i, k) in kept.enumerated() {
            let seedKey = "page:\(request.setId):\(i + 1):\(k.lines.joined(separator: ";"))"
            let plan = Self.isWords(k.meta) ? await WordProblem.plan(k.lines, brain: driver.brain, seedKey: seedKey) : await layout(k.lines, seedKey: seedKey)
            if plan == nil && driver.handwriting() {
                // the hand cannot write it at any size here (the desk could at its own): left out
                report.dropped += 1
                continue
            }
            planned.append((plan, k.lines, k.meta))
        }
        guard !planned.isEmpty else { return report }
        // 3. the pages: the current one when it is blank, then each right after the last
        let count = planned.count
        var after: RecordID? = nil
        var first = true
        for (i, p) in planned.enumerated() {
            let bottom = p.plan.map { $0.bounds.y + $0.bounds.h } ?? (ProblemPageLayout.problemOrigin.y + 48)
            let page = ProblemPage(kind: .problem, setId: request.setId, index: i + 1, count: count, origin: request.origin,
                                   workTop: ProblemPageLayout.workTop(problemBottom: bottom), answer: ProblemPagesRollout.secondPart)
            let id: RecordID?
            if first, isBlank(board.currentScreenID) {
                id = board.currentScreenID
                board.setProblemPage(page, on: board.currentScreenID)
            } else {
                id = board.insertScreen(after: after, meta: [ProblemPage.metaKey: page.json], go: false)
            }
            first = false
            guard let id else {
                report.notes.append("This board already has the most pages it can hold.")
                report.dropped += count - i
                break
            }
            report.pages.append(id)
            after = id
        }
        guard let firstPage = report.pages.first else { return report }
        // if pages ran out, the set is shorter: each page says so
        if report.pages.count < count {
            for (i, id) in report.pages.enumerated() {
                guard case .screen(let s)? = board.store[id], var page = s.problemPage else { continue }
                page.count = report.pages.count
                page.index = i + 1
                board.setProblemPage(page, on: id)
            }
        }
        // 4. the All done page
        if request.allDone, report.pages.count >= 2, let last = report.pages.last {
            report.allDone = board.insertScreen(after: last, meta: [ProblemPage.metaKey: ProblemPage(kind: .done, setId: request.setId).json], go: false)
        }
        // 5. the others written at once; the first by hand, as the kid watches (unless the board closed)
        guard !driver.isStopped else { return report }
        for (i, id) in report.pages.enumerated() where i > 0 {
            writeNow(planned[i], on: id)
        }
        if board.currentScreenID != firstPage {
            board.goToScreen(firstPage)
            onTutorScreen?(AskBoardDriver.screenRef(firstPage, in: board.store))
            driver.screenChanged()
        }
        await writeByHand(planned[0], on: firstPage)
        driver.helper?.problemsChanged()
        Self.log.notice("ask: \(report.pages.count) problem pages written for \(request.setId, privacy: .public), \(report.dropped) left out")
        return report
    }

    /// A page with nothing on it, and no page of a set already.
    func isBlank(_ id: RecordID) -> Bool {
        guard case .screen(let s)? = board.store[id], s.problemPage == nil else { return false }
        return board.store.drawables(on: id).isEmpty
    }

    // MARK: - the desk's check

    enum Verdict {
        case ok(lines: [String], meta: Meta)
        case refused(note: String?)
    }

    /// The desk's check of one problem, on a copy of an empty page: its lines as the board writes them,
    /// and the meta its block would carry — or the desk's words for leaving it out.
    func verify(_ problem: [String]) async -> Verdict {
        let action = AgathonBrain.JSONValue.object(["type": .string("write_problems"), "problems": .array([.array(problem.map { .string($0) })])])
        let args = AskPlanArgs(actions: [action], shapes: [], screen: AgathonBrain.Rect(x: 0, y: 0, w: 1600, h: 900), pageId: "page:check",
                               screenIndex: nil, studentLines: [], handwriting: true, screensLeft: 0, carried: [:])
        guard let plan = try? await AskBrain.plan(driver.brain, args) else { return .refused(note: nil) }
        for op in plan.ops {
            guard case .write(_, _, let meta) = op, let lines = meta["chatProblem"]?["lines"]?.arrayValue?.compactMap(\.stringValue), !lines.isEmpty else { continue }
            return .ok(lines: lines, meta: meta)
        }
        return .refused(note: plan.report.outcomes.first { !$0.ok }?.note)
    }

    // MARK: - writing

    /// The problem in the tutor's hand at the page's problem origin, as big as fits: nil when the hand
    /// cannot draw it.
    func layout(_ lines: [String], seedKey: String) async -> HandPlan? {
        let L = ProblemPageLayout.self
        var size = Self.handSize
        while size >= Self.minHandSize {
            let request = HandwritingRequest(steps: lines, size: size, seedKey: seedKey,
                                             origin: AgathonBrain.Point(x: L.problemOrigin.x, y: L.problemOrigin.y))
            guard let result = try? await driver.brain.layoutHandwriting(request), result.unsupported.isEmpty, let plan = result.plan else { return nil }
            if plan.bounds.x + plan.bounds.w <= L.problemMaxX && plan.bounds.y + plan.bounds.h <= L.problemMaxBottom { return plan }
            size -= 8
        }
        return nil
    }

    static func isWords(_ meta: Meta) -> Bool { meta[WordProblem.meta]?.boolValue == true }

    /// The meta on the problem's strokes: the desk's, its cell the whole page, the number 1 (the only
    /// problem on its page). A word problem's words carry no `chatProblem`: they head no column.
    static func pageMeta(_ meta: Meta, lines: [String]) -> Meta {
        var m = meta
        if isWords(meta) {
            m["live"] = true
            m["source"] = "ai"
            return m
        }
        let c = pageCell
        m["chatProblem"] = .object(["n": .number(1), "lines": .array(lines.map { .string($0) }),
                                    "cell": .object(["x": .number(c.x), "y": .number(c.y), "w": .number(c.w), "h": .number(c.h)])])
        return m
    }

    /// Puts one page's problem on its page at once (a page not on show). With the hand off, typeset.
    func writeNow(_ p: (plan: HandPlan?, lines: [String], meta: Meta), on page: RecordID) {
        let meta = AskBoardDriver.chatMeta(Self.pageMeta(p.meta, lines: p.lines))
        guard let plan = p.plan, driver.handwriting() else {
            typeset(p.lines, on: page, meta: meta)
            return
        }
        InstantPen(store: board.store, screen: page).write(AskBoardDriver.tutorLines(plan), meta: meta)
    }

    /// Writes the problem on the page on show in the tutor's hand, at its pace.
    func writeByHand(_ p: (plan: HandPlan?, lines: [String], meta: Meta), on page: RecordID) async {
        guard let plan = p.plan, driver.handwriting(), board.currentScreenID == page else {
            writeNow(p, on: page)
            return
        }
        await driver.write(plan, meta: Self.pageMeta(p.meta, lines: p.lines))
    }

    /// A sentence in rows of at most `max` characters, broken between words.
    static func rows(_ sentence: String, max: Int) -> [String] {
        var out: [String] = []
        var row = ""
        for word in sentence.split(separator: " ") {
            if !row.isEmpty && row.count + 1 + word.count > max {
                out.append(row)
                row = ""
            }
            row += row.isEmpty ? String(word) : " \(word)"
        }
        if !row.isEmpty { out.append(row) }
        return out
    }

    /// The hand off: the problem's lines as typeset maths at the problem origin.
    func typeset(_ lines: [String], on page: RecordID, meta: Meta) {
        var m = meta
        m["live"] = true
        m["source"] = "ai"
        m["createdAt"] = .number((Date().timeIntervalSince1970 * 1000).rounded())
        let o = ProblemPageLayout.problemOrigin
        // a word problem's sentences, typeset as words, a short row each so they stay on the page
        let lines = Self.isWords(meta) ? lines.flatMap { Self.rows($0, max: 48) }.map { "\\text{\($0)}" } : lines
        board.store.transact(.tutor) { tx in
            var order = board.store.nextOrder(on: page)
            for (i, latex) in lines.enumerated() {
                let w = Double(max(80, latex.count * 22 + 40))
                tx.put(.math(MathRecord(screen: page, order: order, author: .tutor, role: .answer, latex: latex,
                                        x: o.x, y: o.y + Double(i) * 64, w: w, h: 56, fontSize: 40, meta: m)))
                order = OrderKey.after(order)
            }
        }
    }
}
