import AgathonBoard
import AgathonBrain
import AgathonKit
import AgathonLive
import Combine
import Foundation
import os

/// What Ask needs of the board, so the panel's session can be tested with a fake one.
@MainActor
public protocol AskBoardContext: AnyObject {
    /// the screen the board is on, as the server names screens
    var screenRef: AskScreenRef { get }
    /// what is on the current screen, as maths (the desk's picture)
    func picture() async -> AskScreen
    /// the current screen as a JPEG data URL, when it holds something the maths cannot say
    func image() async -> String?
    /// carries out a reply's actions in the tutor's hand; `onTutorScreen` hears each screen the
    /// actions start, as they start it (the exchange moves into its chat)
    func run(_ actions: [AgathonKit.JSONValue], onTutorScreen: @escaping @MainActor (AskScreenRef) -> Void) async -> AskRunReport
    /// set by the session: the board moved to another screen
    var onScreenChange: ((AskScreenRef) -> Void)? { get set }
}

/// What Ask asks of the tutor's loop (AgathonLive's `LiveLoop`, through `LiveLoopAskHelper`): the
/// kid's lines as read, the loop's own pen, and the board's Help me. Optional: without one, Ask
/// writes its actions and helps with its own problems from the engine alone.
@MainActor
public protocol AskBoardHelper: AnyObject {
    /// the student's lines on the current screen as read, in reading order
    func studentLines() -> [String]
    /// the student's lines read inside `rect` (a problem's cell), top to bottom
    func studentLines(in rect: AgathonBrain.Rect) -> [String]
    /// the loop's own hand is writing: Ask waits its turn
    var tutorWriting: Bool { get }
    /// Help me (`step`) / Solve it (`solve`) on the student's own work, as the board's button does
    /// it: `writing`, `nothing`, `busy`, `reading`, `unread`, `done` or `off` (`HelpBoardResult`)
    func helpBoard(depth: String) -> String
    /// the problems on the screen changed: the loop re-reads the columns under them
    func problemsChanged()
    /// Ask cleared the tutor's writing on this screen: the loop forgets its hints and marks there
    func tutorCleared()
}

/// Ask on an AgathonBoard board: the screen as the brain's desk sees it, its picture for the
/// tutor's eyes, and the desk's plan for a reply's actions carried out with the tutor's pen
/// (`LiveBoard.write`: AgathonBoard's `TutorWriter`, origin `.tutor`, never in the kid's undo).
@MainActor
public final class AskBoardDriver: AskBoardContext {
    static let log = Logger(subsystem: "app.agathon.Agathon", category: "ask")

    public let board: LiveBoard
    public let brain: Brain
    public weak var helper: AskBoardHelper?
    /// the tutor writes by hand (off: problems and lines are typeset), as the Live settings say
    public var handwriting: () -> Bool = { true }
    /// Reduce Motion: the desk's pauses between a worked solution's steps are skipped
    public var reduceMotion: () -> Bool = { false }
    public var onScreenChange: ((AskScreenRef) -> Void)?
    /// Problem pages (docs/PROBLEM-PAGES.md): on, every `write_problems` is a page a problem
    /// (`ProblemPageWriter`); off, the desk's grid (the Labs, the tests).
    public var problemPages = false
    /// the problems each screen the tutor started for its work came from (`ChatScreen.from`)
    public private(set) var carried: [RecordID: AskScreenFrom] = [:]
    private var screenWatch: AnyCancellable?
    private var running = false
    /// the pens writing a block now (held: a pen let go stops)
    private var pens: [TutorPen] = []

    /// `screenChanges`: the board's current screen as it changes (the canvas board's controller);
    /// without it the session is told by `screenChanged()`.
    public init(board: LiveBoard, brain: Brain = .shared, helper: AskBoardHelper? = nil, screenChanges: AnyPublisher<RecordID, Never>? = nil) {
        self.board = board
        self.brain = brain
        self.helper = helper
        screenWatch = screenChanges?.removeDuplicates().dropFirst().sink { [weak self] _ in
            DispatchQueue.main.async { self?.screenChanged() }
        }
    }

    /// The board on the canvas: its controller says when the screen changes.
    public convenience init(canvasBoard: CanvasLiveBoard, brain: Brain = .shared, helper: AskBoardHelper? = nil) {
        self.init(board: canvasBoard, brain: brain, helper: helper, screenChanges: canvasBoard.controller.$currentScreenID.eraseToAnyPublisher())
    }

    /// Tells the session the board is on another screen.
    public func screenChanged() {
        onScreenChange?(screenRef)
    }

    // MARK: - the screen

    public var screenRef: AskScreenRef {
        Self.screenRef(board.currentScreenID, in: board.store)
    }

    /// A screen as the server names it: its key under `page:` (the web's tldraw page id, which a
    /// converted board keeps), and its number on the board.
    public static func screenRef(_ id: RecordID, in store: BoardStore) -> AskScreenRef {
        let index = store.screenIDs.firstIndex(of: id).map { $0 + 1 }
        return AskScreenRef(id: serverScreenId(id), index: index)
    }

    /// `screen:abc` → `page:abc`; nil for a key the route's `AskScreenIdSchema` would refuse.
    public static func serverScreenId(_ id: RecordID) -> String? {
        let key = String(id.key)
        guard !key.isEmpty, key.count <= 64, key.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else { return nil }
        return "page:\(key)"
    }

    /// Everything on a screen, as the desk's shapes (`ChatHost.shapes`): page bounds and meta.
    public static func shapes(on screen: RecordID, in store: BoardStore) -> [AskChatShape] {
        store.drawables(on: screen).compactMap { r -> AskChatShape? in
            switch r {
            case .stroke(let s):
                return AskChatShape(id: s.id.rawValue, type: "draw", meta: s.meta, bounds: strokeBounds(s))
            case .math(let m):
                return AskChatShape(id: m.id.rawValue, type: "math", meta: m.meta, bounds: AgathonBrain.Rect(x: m.x, y: m.y, w: m.w, h: m.h), latex: m.latex)
            case .graph(let g):
                return AskChatShape(id: g.id.rawValue, type: "graph", meta: g.meta, bounds: AgathonBrain.Rect(x: g.x, y: g.y, w: g.w, h: g.h))
            case .image(let i):
                return AskChatShape(id: i.id.rawValue, type: "image", meta: i.meta, bounds: AgathonBrain.Rect(x: i.x, y: i.y, w: i.w, h: i.h))
            case .shape(let s):
                let b = s.kind == .line || s.kind == .arrow ? pointsBox(s.points.map { Vec2($0.x + s.x, $0.y + s.y) }) : AgathonBrain.Rect(x: s.x, y: s.y, w: s.w, h: s.h)
                return AskChatShape(id: s.id.rawValue, type: "geo", meta: s.meta, bounds: b)
            default:
                return nil
            }
        }
    }

    /// A stroke's page bounds with its ink's width, as the web's shape bounds are (a drawing kept
    /// 18 px clear of the kid's line is kept clear of its ink, not of its centre line).
    static func strokeBounds(_ s: StrokeRecord) -> AgathonBrain.Rect? {
        guard let b = pointsBox(s.points.map { s.pagePoint($0) }) else { return nil }
        let r = s.width / 2
        return AgathonBrain.Rect(x: b.x - r, y: b.y - r, w: b.w + 2 * r, h: b.h + 2 * r)
    }

    static func pointsBox(_ pts: [Vec2]) -> AgathonBrain.Rect? {
        guard let first = pts.first else { return nil }
        var x0 = first.x, y0 = first.y, x1 = first.x, y1 = first.y
        for p in pts {
            x0 = min(x0, p.x)
            y0 = min(y0, p.y)
            x1 = max(x1, p.x)
            y1 = max(y1, p.y)
        }
        return AgathonBrain.Rect(x: x0, y: y0, w: x1 - x0, h: y1 - y0)
    }

    var carriedForBrain: [String: AskScreenFrom] {
        Dictionary(uniqueKeysWithValues: carried.map { ($0.key.rawValue, $0.value) })
    }

    public func picture() async -> AskScreen {
        let screen = board.currentScreenID
        let shapes = Self.shapes(on: screen, in: board.store)
        let ref = screenRef
        do {
            return try await AskBrain.picture(brain, shapes: shapes, pageId: screen.rawValue, screenIndex: ref.index,
                                              studentLines: helper?.studentLines() ?? [], carried: carriedForBrain)
        } catch {
            Self.log.error("ask: the screen's picture failed: \(String(describing: error), privacy: .public)")
            return AskScreen(empty: shapes.isEmpty)
        }
    }

    public func image() async -> String? {
        await AskBoardImage.capture(store: board.store, screen: board.currentScreenID)
    }

    // MARK: - a reply's actions

    /// The words for stopping when the student moves to another screen (the desk's own).
    public static let movedNote = "I stopped because you moved to another screen."

    public func run(_ actions: [AgathonKit.JSONValue], onTutorScreen: @escaping @MainActor (AskScreenRef) -> Void) async -> AskRunReport {
        // one reply's writing at a time, as the desk's `exclusive`
        while running { try? await Task.sleep(for: .milliseconds(50)) }
        running = true
        defer { running = false }
        if problemPages, actions.contains(where: Self.isWriteProblems) {
            return await runWithPages(actions, onTutorScreen: onTutorScreen)
        }
        return await runDesk(actions, onTutorScreen: onTutorScreen)
    }

    static func isWriteProblems(_ action: AgathonKit.JSONValue) -> Bool {
        action["type"]?.stringValue == "write_problems"
    }

    /// A reply with problems in it: each `write_problems` a page a problem (`ProblemPageWriter`), the
    /// rest through the desk as before, in order.
    func runWithPages(_ actions: [AgathonKit.JSONValue], onTutorScreen: @escaping @MainActor (AskScreenRef) -> Void) async -> AskRunReport {
        var report = AskRunReport()
        var pending: [AgathonKit.JSONValue] = []
        func merge(_ r: AskRunReport) {
            report.outcomes += r.outcomes
            report.problemsWritten += r.problemsWritten
            report.problemsDropped += r.problemsDropped
            report.screensAdded += r.screensAdded
        }
        for action in actions {
            guard Self.isWriteProblems(action) else {
                pending.append(action)
                continue
            }
            if !pending.isEmpty {
                merge(await runDesk(pending, onTutorScreen: onTutorScreen))
                pending = []
            }
            let problems = (action["problems"]?.arrayValue ?? []).map { ($0.arrayValue ?? []).compactMap(\.stringValue) }.filter { !$0.isEmpty }
            let setId = action["set"]?.stringValue ?? "ask:\(UUID().uuidString.prefix(8).lowercased())"
            let origin = action["origin"]?.stringValue ?? "chat"
            let screensBefore = board.store.screenIDs.count
            let r = await ProblemPageWriter(driver: self).write(.init(problems: problems, setId: setId, origin: origin),
                                                                                onTutorScreen: onTutorScreen)
            merge(AskRunReport(outcomes: [Self.outcome(r, asked: problems.count)], problemsWritten: r.written, problemsDropped: r.dropped,
                               screensAdded: board.store.screenIDs.count - screensBefore))
        }
        if !pending.isEmpty { merge(await runDesk(pending, onTutorScreen: onTutorScreen)) }
        return report
    }

    /// The panel's outcome for a set written on pages, in the desk's own words.
    static func outcome(_ r: ProblemPageWriter.Report, asked: Int) -> AskActionOutcome {
        func plural(_ n: Int, _ one: String, _ many: String) -> String { n == 1 ? one : many }
        if r.written == 0 {
            return AskActionOutcome(type: "write_problems", ok: false,
                                    note: r.notes.first ?? "I couldn't check \(plural(asked, "that problem", "those problems")), so I didn't write \(plural(asked, "it", "them")).")
        }
        var notes: [String] = []
        if r.dropped > 0 { notes.append("\(r.dropped) of \(asked) problems couldn't be checked, so I left \(plural(r.dropped, "it", "them")) out.") }
        notes += r.notes.filter { $0.hasPrefix("This board") }
        return AskActionOutcome(type: "write_problems", ok: true, note: notes.isEmpty ? nil : notes.joined(separator: " "))
    }

    /// The desk's plan for `actions` on this screen, carried out.
    func runDesk(_ actions: [AgathonKit.JSONValue], onTutorScreen: @escaping @MainActor (AskScreenRef) -> Void) async -> AskRunReport {
        let start = board.currentScreenID
        let rect = board.screenRect
        let args = AskPlanArgs(
            actions: actions.compactMap(Self.brainJSON), shapes: Self.shapes(on: start, in: board.store), screen: rect,
            pageId: start.rawValue, screenIndex: screenRef.index, studentLines: helper?.studentLines() ?? [],
            handwriting: handwriting(), screensLeft: max(0, ScreenRecord.maxScreens - board.store.screenIDs.count), carried: carriedForBrain)
        let plan: AskPlan
        do {
            plan = try await AskBrain.plan(brain, args)
        } catch {
            Self.log.error("ask: planning failed: \(String(describing: error), privacy: .public)")
            return AskRunReport(outcomes: [AskActionOutcome(type: "plan", ok: false, note: "I couldn't write that on the board.", why: "plan")])
        }
        if let failed = plan.failed { Self.log.error("ask: the desk stopped: \(failed, privacy: .public)") }
        return await execute(plan, from: start, onTutorScreen: onTutorScreen)
    }

    /// Carries out a plan's operations in order, on the screens they name (`new:n` is the n-th
    /// screen the run started). Stops when the student moves to another screen.
    func execute(_ plan: AskPlan, from start: RecordID, onTutorScreen: @escaping @MainActor (AskScreenRef) -> Void) async -> AskRunReport {
        var report = plan.report
        var pages: [String: RecordID] = [start.rawValue: start]
        var expected = start
        var added = 0
        var helpBoardSeen = 0
        var helpProblemSeen = 0
        for op in plan.ops {
            if case .metric(_, let name) = op {
                Self.log.debug("ask: \(name, privacy: .public)")
                continue
            }
            await waitForTutor()
            if board.currentScreenID != expected {
                report.outcomes.append(AskActionOutcome(type: "stopped", ok: false, note: Self.movedNote))
                break
            }
            switch op {
            case .write(_, let plan, let meta):
                await write(plan, meta: meta)
            case .typeset(_, let latex, let r, let meta):
                typeset(latex, rect: r, meta: meta)
            case .addScreen(let page):
                guard let id = board.addScreen() else {
                    report.outcomes.append(AskActionOutcome(type: "new_screen", ok: false, note: "This board already has the most screens it can hold."))
                    report.screensAdded = added
                    return report
                }
                added += 1
                pages[page] = id
                expected = id
                if let from = plan.carried[page] { carried[id] = from }
                // the exchange goes with the screen first (the tutor started it), then the panel follows
                onTutorScreen(Self.screenRef(id, in: board.store))
                screenChanged()
            case .clearTutor:
                clearTutor()
            case .problemsChanged:
                helper?.problemsChanged()
            case .helpBoard(_, let depth):
                let result = helper?.helpBoard(depth: depth) ?? "off"
                patch(&report, type: "help_board", nth: helpBoardSeen, result: result, notes: plan.helpNotes)
                helpBoardSeen += 1
                if result == "writing" { await waitForTutor() }
            case .helpProblem(_, let n, let depth):
                let wrote = await helpProblem(n, depth: depth)
                if !wrote {
                    patchOutcome(&report, type: "help_problem", nth: helpProblemSeen,
                                 AskActionOutcome(type: "help_problem", ok: false, note: "Problem \(n) is already worked out on the board."))
                }
                helpProblemSeen += 1
            case .pause(_, let ms):
                if !reduceMotion() { try? await Task.sleep(for: .milliseconds(Int(min(ms, 2000)))) }
            case .metric:
                break
            }
        }
        report.screensAdded = added
        return report
    }

    /// Waits for the loop's own writing (a worked solution, an answer) before the next block.
    func waitForTutor() async {
        var waited = 0
        while helper?.tutorWriting == true, waited < 30_000 {
            try? await Task.sleep(for: .milliseconds(150))
            waited += 150
        }
    }

    /// The n-th outcome of `type` becomes `outcome`.
    func patchOutcome(_ report: inout AskRunReport, type: String, nth: Int, _ outcome: AskActionOutcome) {
        var seen = 0
        for i in report.outcomes.indices where report.outcomes[i].type == type {
            if seen == nth {
                report.outcomes[i] = outcome
                return
            }
            seen += 1
        }
    }

    func patch(_ report: inout AskRunReport, type: String, nth: Int, result: String, notes: [String: String]) {
        if result == "writing" { return }
        let why = result == "reading" ? "busy" : result
        patchOutcome(&report, type: type, nth: nth, AskActionOutcome(type: type, ok: false, note: notes[why] ?? notes["nothing"], why: why))
    }

    // MARK: - the pen

    /// A brain hand plan as the board's tutor lines (page coordinates), with each line's ink: a
    /// visual model's shaded parts are closed shapes, filled once the pen has gone round.
    public static func tutorLines(_ plan: HandPlan) -> [TutorLine] {
        plan.lines.map { line in
            let strokes = line.strokes.sorted { $0.order < $1.order }.map { s in
                TutorStroke(points: s.points.map { FreehandInput(Vec2($0.x + line.x, $0.y + line.y), $0.z) }, weight: s.weight ?? 1)
            }
            let color = line.style?.color.map { InkColor.fromTldraw($0, author: .tutor) } ?? .tutor
            let closed = line.style?.closed == true
            let fill = closed ? FillStyle.fromTldraw(line.style?.fill ?? "none") : .none
            return TutorLine(strokes: strokes, latex: line.latex, color: color, closed: closed, fill: fill)
        }
    }

    /// The chat's meta on every stroke (the web's `makeMeta("ai", "chat")` and the block's own).
    static func chatMeta(_ meta: Meta) -> Meta {
        var m = meta
        m["lineId"] = "chat"
        return m
    }

    func write(_ plan: HandPlan, meta: Meta) async {
        let lines = Self.tutorLines(plan)
        await withCheckedContinuation { (k: CheckedContinuation<Void, Never>) in
            var resumed = false
            // the pen is kept until its block is on the page: a pen let go stops writing (the
            // canvas board's `TutorWriter` drives itself through a weak reference)
            var pen: TutorPen?
            pen = board.write(lines, meta: Self.chatMeta(meta)) {
                pen = nil
                if !resumed {
                    resumed = true
                    k.resume()
                }
            }
            if let pen { pens.append(pen) }
        }
        pens.removeAll { !$0.isWriting }
    }

    func typeset(_ latex: String, rect r: AgathonBrain.Rect, meta: Meta) {
        let screen = board.currentScreenID
        var m = Self.chatMeta(meta)
        m["live"] = true
        m["source"] = "ai"
        m["createdAt"] = .number((Date().timeIntervalSince1970 * 1000).rounded())
        board.store.put(.math(MathRecord(screen: screen, order: board.store.nextOrder(on: screen), author: .tutor, role: .answer, latex: latex,
                                         x: r.x, y: r.y, w: r.w, h: r.h, fontSize: 24, meta: m)), origin: .tutor)
    }

    /// The board's "clear your writing" (the web's `clearMarks`): the tutor's writing on this
    /// screen goes (its problems too), a lecture's notes stay, and the marks with it. Not undoable.
    func clearTutor() {
        let screen = board.currentScreenID
        let ids = board.store.drawables(on: screen).filter { r in
            let m = r.meta
            return m["live"]?.boolValue == true && m["source"]?.stringValue == "ai" && m["lectureBlock"] == nil
        }.map(\.id)
        let marks = board.store.records.values.compactMap { r -> RecordID? in
            if case .mark(let m) = r, m.screen == screen { return m.id }
            return nil
        }
        if !(ids + marks).isEmpty { board.store.remove(ids + marks, origin: .tutor) }
        helper?.tutorCleared()
    }

    // MARK: - help with a problem the chat wrote

    /// "Help me with 3" (`help_problem`): the engine's working of problem `n` on this screen
    /// (`localSolve`), from where the student's work under it stands, written under it in the
    /// tutor's hand — the next step, or the rest. False when there is nothing left to write.
    func helpProblem(_ n: Int, depth: String) async -> Bool {
        let screen = board.currentScreenID
        var problemLines: [String] = []
        var cell: AgathonBrain.Rect?
        var head: AgathonBrain.Rect?
        var size = 30.0
        for r in board.store.drawables(on: screen) {
            guard let p = r.meta["chatProblem"], p["n"]?.numberValue == Double(n), case .stroke(let s) = r, let b = Self.strokeBounds(s) else { continue }
            if problemLines.isEmpty { problemLines = p["lines"]?.arrayValue?.compactMap(\.stringValue) ?? [] }
            if cell == nil, let c = p["cell"], let x = c["x"]?.numberValue, let y = c["y"]?.numberValue, let w = c["w"]?.numberValue, let h = c["h"]?.numberValue {
                cell = AgathonBrain.Rect(x: x, y: y, w: w, h: h)
            }
            head = head.map { Self.union($0, b) } ?? b
            size = max(size, min(44, b.h))
        }
        guard let cell, let head, !problemLines.isEmpty else { return false }
        let theirs = helper?.studentLines(in: cell) ?? []
        let work = problemLines + theirs
        guard let solved = try? await brain.localSolve(work, options: LocalSolveOptions(targetIndex: work.count - 1, handwriting: true)) else { return false }
        let done = Set((problemLines + theirs).map(Self.flat))
        let steps = solved.steps.filter { !done.contains(Self.flat($0)) }
        guard !steps.isEmpty else { return false }
        let chosen = depth == "solve" ? steps : [steps[0]]
        // under the problem (and what the student wrote under it), in its cell
        let top = board.store.drawables(on: screen).compactMap { r -> Double? in
            guard case .stroke(let s) = r, let b = Self.strokeBounds(s), b.x >= cell.x, b.x + b.w <= cell.x + cell.w, b.y >= cell.y, b.y + b.h <= cell.y + cell.h else { return nil }
            return b.y + b.h
        }.max() ?? (head.y + head.h)
        let request = HandwritingRequest(steps: chosen, size: 28, seedKey: "chat:help:\(n):\(chosen.joined(separator: ";"))",
                                         origin: AgathonBrain.Point(x: head.x + 8, y: top + 18))
        guard let hand = try? await brain.layoutHandwriting(request), hand.unsupported.isEmpty, let placed = hand.plan else { return false }
        await write(placed, meta: ["chatHelp": .number(Double(n))])
        return true
    }

    static func flat(_ latex: String) -> String {
        latex.replacingOccurrences(of: #"\\left|\\right|\s+"#, with: "", options: .regularExpression)
    }

    static func union(_ a: AgathonBrain.Rect, _ b: AgathonBrain.Rect) -> AgathonBrain.Rect {
        let x = min(a.x, b.x), y = min(a.y, b.y)
        return AgathonBrain.Rect(x: x, y: y, w: max(a.x + a.w, b.x + b.w) - x, h: max(a.y + a.h, b.y + b.h) - y)
    }

    /// An action as the brain reads it (the same JSON).
    static func brainJSON(_ v: AgathonKit.JSONValue) -> AgathonBrain.JSONValue? {
        guard let data = try? JSONEncoder().encode(v) else { return nil }
        return try? JSONDecoder().decode(AgathonBrain.JSONValue.self, from: data)
    }
}

/// The tutor's loop as Ask's helper: the kid's lines as read, the loop's pen, Help me / Solve it.
@MainActor
public final class LiveLoopAskHelper: AskBoardHelper {
    public let loop: LiveLoop

    public init(loop: LiveLoop) {
        self.loop = loop
    }

    public func studentLines() -> [String] {
        loop.lines.values.filter { !$0.latex.isEmpty }
            .sorted { ($0.ink.column, $0.ink.row) < ($1.ink.column, $1.ink.row) }
            .map(\.latex)
    }

    public func studentLines(in rect: AgathonBrain.Rect) -> [String] {
        loop.lines.values.filter { l in
            let b = l.ink.bounds
            return !l.latex.isEmpty && b.x >= rect.x && b.y >= rect.y && b.x + b.w <= rect.x + rect.w && b.y + b.h <= rect.y + rect.h
        }
        .sorted { $0.ink.bounds.y < $1.ink.bounds.y }
        .map(\.latex)
    }

    public var tutorWriting: Bool {
        switch loop.activity {
        case .solving: return true
        default: return false
        }
    }

    public func helpBoard(depth: String) -> String {
        guard loop.settings.enabled else { return "off" }
        guard loop.helpTargetLine() != nil else { return "nothing" }
        if depth == "solve" { loop.solveIt() } else { loop.helpMe() }
        return "writing"
    }

    /// The desk wrote or cleared problems: they head the columns under them, so the kid's answers
    /// are judged against them (`LiveLoop.problemsChanged`).
    public func problemsChanged() {
        loop.problemsChanged()
    }

    public func tutorCleared() {
        loop.clearMarks()
        loop.problemsChanged()
    }
}
