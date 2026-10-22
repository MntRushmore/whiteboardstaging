#if DEBUG
import AgathonBoard
import AgathonBrain
import AgathonDesign
import AgathonLive
import os
import SwiftUI
import UIKit

/// Debug only: a whole messy homework session (`KidSessions`) played on the real board as a kid does it
/// — the synthetic hand moved by `KidMess`, a kid's pace and pen, pauses to think, scribbles, the
/// buttons — and what the kid sees checked as it goes (docs/KID-SESSIONS.md).
///
/// `-kidSession s04-slip-help [-kidRun <label>] -liveTraining 30`: the board opened next plays the
/// session (once per launch). Its state is `debug.session`'s label: `running 3/12 …`, `await 5 live.check`
/// (the UI test taps that button, then `debug.session.ack`, or `debug.session.missing` when it is not
/// there), `done 9/10 ink 23`. The result (JSON) and the screenshots go to
/// Documents/kid-sessions/<run>/ in the app's container.
struct KidSessionControls: View {
    @ObservedObject var model: BoardScreenModel
    @ObservedObject private var player = KidSessionPlayer.shared

    var body: some View {
        if KidSessionPlayer.requested != nil {
            HStack(spacing: 2) {
                Color.clear.frame(width: 2, height: 2)
                    .accessibilityElement()
                    .accessibilityLabel(player.status)
                    .accessibilityIdentifier("debug.session")
                Button { player.ack(found: true) } label: { Color.clear.frame(width: 22, height: 22).contentShape(Rectangle()) }
                    .accessibilityIdentifier("debug.session.ack")
                Button { player.ack(found: false) } label: { Color.clear.frame(width: 22, height: 22).contentShape(Rectangle()) }
                    .accessibilityIdentifier("debug.session.missing")
            }
            .task(id: model.tutor != nil) {
                if model.tutor != nil { player.start(model: model) }
            }
        }
    }
}

@MainActor
final class KidSessionPlayer: ObservableObject {
    static let shared = KidSessionPlayer()
    nonisolated static let log = Logger(subsystem: "app.agathon.Agathon", category: "kidSession")

    static var requested: KidSession? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-kidSession"), i + 1 < args.count else { return nil }
        return KidSessions.named(args[i + 1])
    }

    static var runLabel: String {
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-kidRun"), i + 1 < args.count { return args[i + 1] }
        return "run"
    }

    @Published private(set) var status = "idle"
    private var started = false
    private var acked: Bool?
    private var awaitSeq = 0

    func start(model: BoardScreenModel) {
        guard !started, let session = Self.requested, let tutor = model.tutor else { return }
        started = true
        status = "starting"
        Task { @MainActor in
            let run = KidSessionRun(session: session, tutor: tutor, boardId: model.request?.board.id ?? "?", player: self)
            let result = await run.go()
            self.status = "done \(result.passed)/\(result.judged) ink \(result.ink)"
        }
    }

    func set(_ s: String) {
        status = s
    }

    /// The UI test tapped the button (`found`), or found it missing.
    func ack(found: Bool) {
        acked = found
    }

    /// Asks the UI test to tap `id`; true when it did, false when the button was not there, nil when no
    /// one answered in time.
    func await(_ id: String, timeout: Double = 40) async -> Bool? {
        acked = nil
        awaitSeq += 1
        status = "await \(awaitSeq) \(id)"
        let end = Date().addingTimeInterval(timeout)
        while acked == nil && Date() < end { try? await Task.sleep(for: .milliseconds(150)) }
        return acked
    }
}

/// What one session came to (the report's row): its checks, its lines, what the kid read.
struct KidSessionResult: Codable {
    struct Check: Codable {
        var name: String
        var pass: Bool?
        var detail: String
    }
    struct Line: Codable {
        var problem: Int
        var written: String
        var expect: String?
        var read: String?
        var mark: String
        var pass: Bool?
        var why: String?
    }
    var id: String
    var title: String
    var grade: Int
    var hand: String
    var boardId: String
    var started: Date
    var seconds: Double = 0
    var calls: [String: Int] = [:]
    var checks: [Check] = []
    var lines: [Line] = []
    var texts: [String] = []
    var shots: [String] = []
    var notes: [String] = []
    /// every read the recognizer gave, in order (a line read again shows each read)
    var reads: [String] = []
    var ink = 0
    var checking = ""

    var judged: Int { checks.filter { $0.pass != nil }.count }
    var passed: Int { checks.filter { $0.pass == true }.count }
}

@MainActor
private final class KidSessionRun {
    let session: KidSession
    let tutor: BoardTutor
    let player: KidSessionPlayer
    var result: KidSessionResult
    var rng: SplitMix
    let dir: URL

    /// a written line: what it says, its strokes, its problem, where it went (layout units)
    struct Written {
        var spec: TrainingLineSpec
        var ids: [RecordID]
        var problem: Int
        var box: Box
        var screen: RecordID
        var gone = false
        var crossed = false
        var frozen: TrainingLineResult?
        var latest: TrainingLineResult?
    }

    var written: [Written] = []
    var problem = 0
    var lineOnPage = 0
    /// the column the kid writes in (layout units): its left edge, its bottom, its first line's top
    var column = (x: 140.0, bottom: -1.0, top: -1.0)
    var lastInkEnd = Date.distantPast
    var triggerAt = Date.distantPast
    var bigThinkAt = Date.distantPast
    var seenMarks: [RecordID: String] = [:]
    var shotSeq = 0
    var watching: Task<Void, Never>?
    var texts = Set<String>()
    var earlyMarks: [String] = []

    var loop: LiveLoop { tutor.loop }
    var controller: BoardController { tutor.liveBoard.controller }
    var canvas: BoardCanvasView? { tutor.liveBoard.canvas }

    init(session: KidSession, tutor: BoardTutor, boardId: String, player: KidSessionPlayer) {
        self.session = session
        self.tutor = tutor
        self.player = player
        result = KidSessionResult(id: session.id, title: session.title, grade: session.grade, hand: session.hand.name, boardId: boardId, started: Date())
        rng = SplitMix(seed: BenchRunner.stableHash(session.id))
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        dir = docs.appendingPathComponent("kid-sessions").appendingPathComponent(KidSessionPlayer.runLabel)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    // MARK: - the session

    func go() async -> KidSessionResult {
        let t0 = Date()
        player.set("starting: waiting for the board")
        for _ in 0..<100 where (canvas?.bounds.width ?? 0) == 0 { try? await Task.sleep(for: .milliseconds(100)) }
        _ = try? await Brain.shared.load()
        try? await Task.sleep(for: .seconds(2))
        result.checking = loop.settings.checking.rawValue
        watching = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                self?.watch()
                try? await Task.sleep(for: .milliseconds(250))
            }
        }
        for (i, step) in session.steps.enumerated() {
            player.set("running \(i + 1)/\(session.steps.count) \(describe(step))")
            await perform(step)
        }
        observe()
        watching?.cancel()
        finish()
        result.seconds = Date().timeIntervalSince(t0)
        result.calls = BoardTutor.trainingServices?.calls ?? [:]
        result.reads = (BoardTutor.trainingServices?.reads ?? []).map { r in
            String(format: "%.1f s %@ → %@ (%@ %.2f)%@", r.at, String(r.lineId.prefix(8)), r.latex ?? "-", r.provider ?? "-", r.confidence ?? 0,
                   r.error.map { " " + $0 } ?? "")
        }
        result.ink = controller.store.records.values.filter { if case .stroke(let s) = $0 { s.author == .kid } else { false } }.count
        save()
        Self.log(result)
        return result
    }

    func perform(_ step: KidStep) async {
        switch step {
        case .tutorProblem(let problem):
            observe()
            self.problem += 1
            let written = await tutor.writePractice([problem], key: "kid:\(session.id):\(self.problem)")
            if written == 0 { note("the tutor did not write \(problem.joined(separator: " ; "))") }
            await goToProblem(problem)
            newPage()
            try? await Task.sleep(for: .seconds(1.5))
        case .line(let spec, let spot):
            if spec.place == .problem && self.problem == 0 { self.problem = 1 }
            if self.problem == 0 { self.problem = 1 }
            await write(spec, spot: spot, marks: [])
        case .stacked(let spec, let marks, let spot):
            if self.problem == 0 { self.problem = 1 }
            await write(spec, spot: spot, marks: marks)
        case .pause(let seconds):
            if seconds >= 15 { bigThinkAt = Date().addingTimeInterval(seconds) }
            try? await Task.sleep(for: .seconds(seconds))
        case .scratchOut, .strike:
            guard let k = written.indices.last(where: { !written[$0].gone && !written[$0].crossed }), let page = pageBox(of: written[k]) else { return }
            try? await Task.sleep(for: .milliseconds(700))
            let path: [Vec2] = step.isScratch ? KidMarks.scribble(over: page, rng: &rng) : KidMarks.strike(through: page)
            let made = await pen([path], fast: step.isScratch)
            freeze(k)
            written[k].crossed = true
            written[k].ids += made
        case .erase:
            guard let k = written.indices.last(where: { !written[$0].gone }) else { return }
            try? await Task.sleep(for: .milliseconds(900))
            observe()
            freeze(k)
            await rubOut(written[k].ids)
            written[k].gone = true
        case .tap(let button):
            await tap(button)
        case .solveOffered(let slip):
            await solveOffered(slip: slip)
        case .expect(let e):
            await expect(e)
        case .done(let wait):
            try? await Task.sleep(for: .seconds(wait))
            await settle()
            observe()
        case .shot(let name):
            shot(name)
        }
    }

    // MARK: - writing

    func write(_ spec: TrainingLineSpec, spot: KidSpot, marks: [KidColumnMark]) async {
        guard var ink = try? await StudentHand.ink(spec.latex, hand: session.hand, brain: .shared), !ink.isEmpty else {
            note("the hand can't write \(spec.latex)")
            return
        }
        ink = session.mess.apply(ink, line: lineOnPage, rng: &rng)
        let (dx, gap) = session.mess.offset(line: lineOnPage, rng: &rng)
        let w = ink.flatMap { $0 }.map(\.x).max() ?? 0
        let h = ink.flatMap { $0 }.map(\.y).max() ?? 0
        let onProblemPage = controller.currentScreen?.problemPage?.kind == .problem
        let workTop = controller.currentScreen?.problemPage?.resolvedWorkTop ?? ProblemPageLayout.defaultWorkTop
        let hasTutorProblem = onProblemPage && controller.currentScreen?.problemPage?.origin != "student"
        var origin: Vec2
        switch spot {
        case .top:
            origin = Vec2(ProblemPageLayout.problemOrigin.x + abs(dx) * 0.3, ProblemPageLayout.problemOrigin.y + 10)
        case .answer where onProblemPage:
            origin = TrainingBench.origin(for: ink, place: .answer, dx: dx * 0.3, workTop: workTop, bottom: 0, beside: nil)
        case .side:
            let last = written.last { !$0.gone && $0.screen == controller.currentScreenID }?.box ?? Box(x: column.x, y: max(column.bottom, workTop), w: 300, h: h)
            origin = Vec2(last.maxX + 90 + abs(dx) * 0.5, last.y + (last.h - h) / 2)
        case .column2:
            let top = column.top >= 0 ? column.top : (hasTutorProblem ? workTop + 10 : ProblemPageLayout.problemOrigin.y + 10)
            column = (x: 860, bottom: -1, top: top)
            origin = Vec2(column.x + dx * 0.3, top)
        case .nearBottom:
            let floor = onProblemPage ? ProblemPageLayout.answer.y - 24 : Box.screen.h - 24
            origin = Vec2(column.x + dx, floor - h)
        case .below, .answer:
            let start = hasTutorProblem ? workTop + 14 : ProblemPageLayout.problemOrigin.y + 10
            let y = column.bottom < 0 ? max(start, column.top) : column.bottom + gap
            origin = Vec2(column.x + dx, y)
        }
        // room over a stacked sum for its carries
        if marks.contains(where: { if case .cross = $0 { false } else { true } }) { origin.y += 40 }
        origin.x = min(max(40, origin.x), Box.screen.w - 40 - w)
        let box = Box(x: origin.x, y: origin.y, w: w, h: h)
        if spot != .answer || !onProblemPage, spot != .side {
            if column.top < 0 { column.top = origin.y }
            column.bottom = max(column.bottom, box.maxY)
        }
        if spot == .top { column.top = box.maxY + gap; column.bottom = box.maxY }
        let placed = ink.map { $0.map { Vec2(origin.x + $0.x, origin.y + $0.y) } }
        var made: [RecordID] = []
        if marks.isEmpty {
            made = await pen(placed, fast: false)
        } else {
            // the rows and their bars, the carries or the borrow, then the answer row
            let parts = KidMarks.splitAtAnswer(placed)
            made = await pen(parts.rows, fast: false)
            try? await Task.sleep(for: .milliseconds(500))
            made += await pen(await columnMarks(marks, rows: parts.rows), fast: false)
            try? await Task.sleep(for: .milliseconds(700))
            made += await pen(parts.answer, fast: false)
        }
        if spec.place == .answer || spot == .answer { triggerAt = Date() }
        written.append(Written(spec: spec, ids: made, problem: problem, box: box, screen: controller.currentScreenID))
        lineOnPage += 1
        try? await Task.sleep(for: .milliseconds(Int(session.pace.lineBreak(&rng))))
    }

    /// The carries and borrows of a stacked sum, as strokes (layout units).
    func columnMarks(_ marks: [KidColumnMark], rows: [[Vec2]]) async -> [[Vec2]] {
        let digits = KidMarks.topRowDigits(rows)
        var out: [[Vec2]] = []
        // a small digit in the kid's own hand, 26 high, its top-left at `p`
        func small(_ s: String, at p: Vec2) async -> [[Vec2]] {
            guard let ink = try? await StudentHand.ink(s, hand: session.hand, brain: .shared), !ink.isEmpty else { return [] }
            let hh = max(1, ink.flatMap { $0 }.map(\.y).max() ?? 1)
            let k = 26 / hh
            return ink.map { $0.map { Vec2(p.x + $0.x * k, p.y + $0.y * k) } }
        }
        for m in marks {
            switch m {
            case .above(let c, let s):
                guard c < digits.count else { continue }
                let d = digits[c]
                out += await small(s, at: Vec2(d.x + d.w * 0.15, d.y - 44))
            case .cross(let c):
                guard c < digits.count else { continue }
                let d = digits[c]
                out.append([Vec2(d.x - 4, d.maxY + 2), Vec2(d.maxX + 4, d.y - 2)])
            case .before(let c, let s):
                guard c < digits.count else { continue }
                let d = digits[c]
                out += await small(s, at: Vec2(d.x - 16, d.y - 18))
            }
        }
        return out
    }

    /// Strokes (layout units on the page on show) through the canvas's touch path, at the kid's pace
    /// and pen. Returns the kid strokes it made.
    func pen(_ strokes: [[Vec2]], fast: Bool) async -> [RecordID] {
        guard let canvas, !strokes.isEmpty else { return [] }
        let rect = controller.currentScreen?.rect ?? .screen
        let page = strokes.map { $0.map { ProblemPageLayout.place($0, on: rect) } }
        controller.tool = .pen
        let before = Set(kidStrokes())
        let steps = session.pace.steps(page, rng: &rng)
        for (k, pts) in page.enumerated() where pts.count >= 2 {
            if steps[k].pauseMs > 0 && !fast { try? await Task.sleep(for: .milliseconds(Int(steps[k].pauseMs))) }
            // the pen was up long enough for the tutor to call the work done (the long pause)
            if lastInkEnd != .distantPast, Date().timeIntervalSince(lastInkEnd) >= PageTiming.checkPauseMs / 1_000 - 0.5 { triggerAt = Date() }
            let view = TrainingBoard.densify(pts).map { canvas.camera.toView($0) }
            let pen = KidPen.profile(count: view.count, rng: &rng)
            let seconds = fast ? max(0.25, steps[k].drawMs / 2_500) : steps[k].drawMs / 1_000 * KidPen.tempo(&rng)
            tutor.liveBoard.notePen(true)
            await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
                canvas.simulateStroke(view, duration: seconds, pressures: pen.pressures, times: pen.times) { done.resume() }
            }
            tutor.liveBoard.notePen(false)
            lastInkEnd = Date()
        }
        return kidStrokes().filter { !before.contains($0) }
    }

    func rubOut(_ ids: [RecordID]) async {
        guard let canvas, let box = ids.compactMap({ controller.store.stroke($0) }).flatMap({ s in s.points.map { s.pagePoint($0) } }).boxAround else { return }
        controller.tool = .eraser
        var path: [Vec2] = []
        let rows = max(2, Int(box.h / 14))
        for r in 0...rows {
            let y = box.y + box.h * Double(r) / Double(rows)
            path.append(Vec2(r % 2 == 0 ? box.x - 8 : box.maxX + 8, y))
            path.append(Vec2(r % 2 == 0 ? box.maxX + 8 : box.x - 8, y))
        }
        tutor.liveBoard.notePen(true)
        await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
            canvas.simulateStroke(TrainingBoard.densify(path).map { canvas.camera.toView($0) }, duration: 0.9) { done.resume() }
        }
        tutor.liveBoard.notePen(false)
        controller.tool = .pen
        lastInkEnd = Date()
        let left = ids.filter { controller.store[$0] != nil }
        if !left.isEmpty { note("the eraser left \(left.count) of \(ids.count) strokes (taken out by hand)"); controller.store.remove(left, origin: .kid) }
    }

    func kidStrokes() -> [RecordID] {
        controller.store.drawables(on: controller.currentScreenID).compactMap { r -> RecordID? in
            guard case .stroke(let s) = r, s.author == .kid else { return nil }
            return s.id
        }
    }

    /// A written line's box on the page on show (page units), from its strokes.
    func pageBox(of w: Written) -> Box? {
        let rect = controller.currentScreen?.rect ?? .screen
        guard let b = w.ids.compactMap({ controller.store.stroke($0) }).flatMap({ s in s.points.map { s.pagePoint($0) } }).boxAround else { return nil }
        return ProblemPageLayout.unplace(b, from: rect)
    }

    // MARK: - pages and buttons

    func newPage() {
        lineOnPage = 0
        lastInkEnd = .distantPast
        column = (x: 140, bottom: -1, top: -1)
    }

    /// After the tutor wrote a problem: its page on show.
    func goToProblem(_ problem: [String]) async {
        for _ in 0..<40 {
            if controller.currentScreen?.problemPage?.kind == .problem, onPageProblem() != nil { return }
            let want = problem.joined(separator: "\n")
            for screen in controller.store.screenIDs {
                let has = controller.store.records.values.contains { r in
                    if case .problem(let p) = r, p.screen == screen, let l = p.latex { return l == want || l.contains(problem[0]) }
                    return false
                }
                if has && controller.currentScreenID != screen {
                    controller.goToScreen(screen)
                    try? await Task.sleep(for: .milliseconds(600))
                    return
                }
            }
            try? await Task.sleep(for: .milliseconds(250))
        }
        note("never found the page of \(problem.joined(separator: " ; "))")
    }

    func onPageProblem() -> ProblemRecord? {
        let screen = controller.currentScreenID
        return controller.store.records.values.compactMap { r -> ProblemRecord? in
            if case .problem(let p) = r, p.screen == screen { return p } else { return nil }
        }.first
    }

    func tap(_ button: KidButton) async {
        switch button {
        case .check, .helpMe: triggerAt = Date()
        case .newPage, .nowYouTry, .next: observe()
        default: break
        }
        let screenBefore = controller.currentScreenID
        let answered = await player.await(button.rawValue)
        let name = "button \(button.rawValue)"
        switch answered {
        case true?:
            check(name, true, "tapped on the board")
        case false?:
            // a check button a free page does not have is no fault: the long pause checks it
            if button == .check && controller.currentScreen?.problemPage == nil {
                check(name, nil, "not on a free page (the pause checks it)")
            } else {
                check(name, false, "not on the board when the kid needed it")
                fallback(button)
            }
        case nil:
            check(name, false, "the UI test never answered (no tap)")
            fallback(button)
        }
        try? await Task.sleep(for: .seconds(1.5))
        if controller.currentScreenID != screenBefore { newPage() }
    }

    /// What the button would have done, so the session goes on.
    func fallback(_ button: KidButton) {
        switch button {
        case .check: loop.checkPage()
        case .helpMe: loop.helpMe()
        case .gotIt: for h in loop.hints { loop.dismissHint(h.id) }
        case .newPage: loop.takeNewPage()
        case .keepHere: loop.keepHere()
        case .nowYouTry: loop.takeOffer()
        case .next: loop.nextPage()
        }
    }

    /// The problem the tutor just wrote (Now you try), worked under it.
    func solveOffered(slip: Bool) async {
        observe()
        guard let latex = onPageProblem()?.latex else {
            check("Now you try's problem", false, "no problem of the tutor's on this page")
            return
        }
        let problem = latex.components(separatedBy: "\n").filter { !$0.isEmpty }
        self.problem += 1
        newPage()
        guard let steps = await TrainingGenerator.workedSteps(problem, brain: .shared), let last = steps.last else {
            check("Now you try's problem", nil, "the engine could not work \(latex)")
            return
        }
        note("Now you try: \(latex)")
        for s in steps.dropLast() { await write(TrainingLineSpec(s, .calm), spot: .below, marks: []) }
        let answer = slip ? (TrainingGenerator.bump(last)?.0 ?? last) : last
        await write(TrainingLineSpec(answer, slip ? .ring : .tick, place: .answer), spot: .answer, marks: [])
    }

    // MARK: - what the kid sees

    func expect(_ e: KidExpect) async {
        let end = Date().addingTimeInterval(20)
        var ok = false
        var detail = ""
        while Date() < end {
            switch e {
            case .newPageOffer: ok = loop.pages.offer != nil; detail = ok ? "offered" : "no offer"
            case .noNewPageOffer: ok = loop.pages.offer == nil; detail = ok ? "none" : "still offered"
            case .nowYouTryOffer: ok = loop.offer != nil; detail = ok ? "offered \(loop.offer!.problem.joined(separator: " ; "))" : "no offer"
            case .hint: ok = !loop.hints.isEmpty; detail = ok ? loop.hints.map(\.title).joined(separator: " / ") : "no hint card"
            case .onProblemPage:
                let p = controller.currentScreen?.problemPage
                ok = p?.kind == .problem && onPageProblem() != nil
                detail = ok ? "problem page: \(onPageProblem()?.latex ?? "")" : "page is \(p.map { "\($0.kind)" } ?? "a free page")"
            case .movedHere(let n):
                let lines = loop.lines.values.filter { !$0.latex.isEmpty }
                let moved = written.filter { $0.problem == problem }
                ok = controller.currentScreen?.problemPage != nil && lines.count >= n && lines.count <= moved.count + 1
                detail = "page \(controller.currentScreen?.problemPage == nil ? "free" : "problem"), lines here: \(lines.map(\.latex).joined(separator: "; "))"
            }
            if ok { break }
            try? await Task.sleep(for: .milliseconds(300))
        }
        check("sees \(e)", ok, detail)
    }

    /// Every 250 ms: the marks that appear (and when), the words the kid is shown.
    func watch() {
        let screen = controller.currentScreenID
        for case .mark(let m) in controller.store.records.values where m.screen == screen {
            let kind = m.kind.rawValue
            guard seenMarks[m.id] != kind else { continue }
            seenMarks[m.id] = kind
            let sinceInk = Date().timeIntervalSince(lastInkEnd)
            let sinceTrigger = Date().timeIntervalSince(triggerAt)
            let afterBigThink = Date() >= bigThinkAt.addingTimeInterval(-14) && bigThinkAt != .distantPast
            // check when done: a mark while the kid is still writing (no answer, Check or Help me just
            // now, not the long pause the tutor waits for)
            if loop.settings.checking == .whenDone, sinceInk < PageTiming.checkPauseMs / 1_000 - 0.5, sinceTrigger > 25, !afterBigThink {
                earlyMarks.append("\(kind) \(String(format: "%.1f", sinceInk)) s after ink")
            }
        }
        for h in loop.hints { texts.insert([h.title, h.message, h.question].compactMap { $0 }.joined(separator: " ")) }
        if let n = loop.note { texts.insert(n) }
        for c in loop.cheers { texts.insert(c.text) }
    }

    func settle() async {
        let end = Date().addingTimeInterval(14)
        while Date() < end {
            if loop.trainingQuiet && !loop.busy { return }
            try? await Task.sleep(for: .milliseconds(200))
        }
    }

    /// What the tutor did with the problem's lines so far (on its page).
    func observe() {
        let idx = written.indices.filter { written[$0].problem == problem && written[$0].screen == controller.currentScreenID && written[$0].frozen == nil }
        guard !idx.isEmpty else { return }
        let spec = TrainingCase(id: "\(session.id):\(problem)", category: .generated, grade: .g56, topic: "session", problem: nil,
                                lines: idx.map { written[$0].spec }, solved: nil)
        let erased = Set(idx.enumerated().filter { written[$0.element].gone }.map(\.offset))
        let obs = TrainingBench.observe(spec: spec, ids: idx.map { written[$0].ids }, erased: erased, loop: loop)
        for (k, i) in idx.enumerated() where k < obs.count {
            var o = obs[k]
            // a crossed-out line: not judged (its ring from before it was crossed out was frozen)
            if written[i].crossed { o.expect = .quiet }
            written[i].latest = o
        }
        overlapCheck()
    }

    func freeze(_ k: Int) {
        if written[k].latest != nil { written[k].frozen = written[k].latest }
    }

    /// The tutor's writing (not its marks, not the problem it gave) never on top of the kid's.
    func overlapCheck() {
        let screen = controller.currentScreenID
        let kid = written.filter { $0.screen == screen && !$0.gone }.compactMap { pageBox(of: $0) }
        let rect = controller.currentScreen?.rect ?? .screen
        var groups: [String: Box] = [:]
        for r in controller.store.drawables(on: screen) where r.author == .tutor {
            if (r.meta["mark"]?.stringValue ?? "").isEmpty == false || r.meta["chatProblem"] != nil || r.meta["problemPage"] != nil { continue }
            guard let b = RenderGeometry.item(for: r)?.bounds else { continue }
            let key = r.meta["liveJob"]?.stringValue ?? r.id.rawValue
            let u = ProblemPageLayout.unplace(b, from: rect)
            groups[key] = groups[key].map { $0.union(u) } ?? u
        }
        for (job, t) in groups {
            for k in kid {
                let ix = max(0, min(t.maxX, k.maxX) - max(t.x, k.x)) * max(0, min(t.maxY, k.maxY) - max(t.y, k.y))
                let smaller = max(1, min(t.w * t.h, k.w * k.h))
                if ix / smaller > 0.2 { overlaps.insert("tutor \(job.prefix(18)) over kid ink at \(Int(k.x)),\(Int(k.y)) (\(Int(ix / smaller * 100))%)") }
            }
        }
    }

    var overlaps = Set<String>()

    // MARK: - the result

    func finish() {
        var lines: [TrainingLineResult] = []
        for w in written {
            guard var r = w.frozen ?? w.latest else {
                result.lines.append(.init(problem: w.problem, written: w.spec.latex, expect: w.spec.expect.rawValue, read: nil, mark: "unseen",
                                          pass: nil, why: "never observed"))
                continue
            }
            if w.gone && w.frozen == nil { r.expect = nil }
            lines.append(r)
            let judged = TrainingJudge.judge(r)
            result.lines.append(.init(problem: w.problem, written: w.spec.latex, expect: judged.expect?.rawValue, read: judged.read,
                                      mark: judged.mark.rawValue, pass: judged.pass, why: judged.why?.text))
        }
        let right = result.lines.filter { $0.expect != nil && $0.expect != "ring" }
        let rangRight = right.filter { $0.mark == "ring" }
        check("no ring on right work", rangRight.isEmpty,
              rangRight.isEmpty ? "\(right.count) right lines, none ringed" : rangRight.map { "\($0.written) read \($0.read ?? "-")" }.joined(separator: "; "))
        let slips = result.lines.filter { $0.expect == "ring" }
        if !slips.isEmpty {
            let missed = slips.filter { $0.mark != "ring" }
            check("ring on the slip", missed.isEmpty, missed.isEmpty ? "\(slips.count) ringed" : missed.map { "\($0.written): \($0.mark), read \($0.read ?? "-")" }.joined(separator: "; "))
        }
        let quiet = result.lines.filter { $0.expect != nil }
        let failed = quiet.filter { $0.pass == false }
        check("every line as a teacher would mark it", failed.isEmpty,
              failed.isEmpty ? "\(quiet.count) lines" : failed.map { "\($0.written) → \($0.mark) (wanted \($0.expect ?? "-"))\($0.why.map { ": \($0)" } ?? "")" }.joined(separator: "; "))
        let reads = result.lines.filter { $0.read != nil }
        let readRight = lines.filter { TrainingJudge.judge($0).readRight == true }.count
        check("reads", nil, "\(readRight)/\(reads.count) read as written")
        result.texts = texts.sorted()
        let harsh = result.texts.filter { $0.range(of: #"\b(wrong|incorrect|bad|fail(ed)?|stupid)\b"#, options: [.regularExpression, .caseInsensitive]) != nil }
        check("kind words", harsh.isEmpty, harsh.isEmpty ? "\(result.texts.count) things said, all kind" : harsh.joined(separator: " / "))
        check("checks when done", earlyMarks.isEmpty, earlyMarks.isEmpty ? "no mark while still writing" : earlyMarks.joined(separator: "; "))
        check("tutor ink clear of the kid's", overlaps.isEmpty, overlaps.isEmpty ? "no overlap" : overlaps.sorted().joined(separator: "; "))
        _ = lines
    }

    func check(_ name: String, _ pass: Bool?, _ detail: String) {
        result.checks.append(.init(name: name, pass: pass, detail: detail))
    }

    func note(_ s: String) {
        result.notes.append(s)
        KidSessionPlayer.log.notice("KIDSESSION \(self.session.id, privacy: .public) note: \(s, privacy: .public)")
    }

    func shot(_ name: String) {
        guard let window = canvas?.window else { return }
        shotSeq += 1
        let file = "\(session.id)-\(String(format: "%02d", shotSeq))-\(name).png"
        let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        try? image.pngData()?.write(to: dir.appendingPathComponent(file))
        result.shots.append(file)
    }

    func save() {
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        enc.dateEncodingStrategy = .iso8601
        try? enc.encode(result).write(to: dir.appendingPathComponent("\(session.id).json"))
    }

    static func log(_ r: KidSessionResult) {
        let checks = r.checks.map { "\($0.name)=\($0.pass.map { $0 ? "ok" : "FAIL" } ?? "-")" }.joined(separator: ", ")
        KidSessionPlayer.log.notice("KIDSESSION \(r.id, privacy: .public) \(r.passed)/\(r.judged) calls \(r.calls.values.reduce(0, +)) :: \(checks, privacy: .public)")
    }

    func describe(_ step: KidStep) -> String {
        switch step {
        case .tutorProblem(let p): return "problem \(p.joined(separator: " ; "))"
        case .line(let l, let s): return "write \(l.latex) (\(s.rawValue))"
        case .stacked(let l, _, _): return "stack \(l.means ?? l.latex)"
        case .pause(let s): return "think \(Int(s)) s"
        case .scratchOut: return "scribble out"
        case .strike: return "cross out"
        case .erase: return "rub out"
        case .tap(let b): return "tap \(b.rawValue)"
        case .solveOffered: return "solve Now you try"
        case .expect(let e): return "expect \(e)"
        case .done(let w): return "done, wait \(Int(w)) s"
        case .shot(let n): return "shot \(n)"
        }
    }
}

private extension KidStep {
    var isScratch: Bool { if case .scratchOut = self { true } else { false } }
}

private extension Array where Element == Vec2 {
    var boxAround: Box? { Box.around(self) }
}
#endif
