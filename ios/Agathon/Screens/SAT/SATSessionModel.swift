import AgathonAsk
import AgathonBoard
import AgathonBrain
import AgathonKit
import AgathonLive
import AgathonSAT
import AgathonSync
import Combine
import os
import SwiftUI
import UIKit

/// One SAT practice session, start to end (docs/SAT-V2.md, "The question is the page"): one board,
/// a problem page per question with the question PRINTED on it (the number in the margin, the stem,
/// its figure, the answer cards or the grid-in at the bottom: `SATPagePrinter`, drawn by the canvas
/// under the ink, never a record), the free tutor's gate (v1's, unchanged), and Help me's ink ladder:
///
///  - a question's page starts with the tutor **ready but off**: no pass is asked for by opening,
///    browsing, choosing or checking; the **first ink** on the page (`firstInk`, the one trigger)
///    claims the pass (`SATPractice.claimTutorPass(for:)`); allowed, the tutor goes on and reads what
///    was written meanwhile; not, the top bar's capped line and the board stays plain ink;
///  - every live call on an SAT page carries `sat_question_id` and, when the student drew on the
///    question's plane, `sat_figure_marks` (`LiveRequestTag`); a 402 `sat_tutor` turns the tutor off
///    on that page (capped: rung 2 falls back to the bank);
///  - the page's layout follows the window (`viewport`): the page is as tall as the window (taller
///    for a long question, or for ink low on it), its answer row over the dock's lane;
///  - Help me climbs `SATHintLadder`: the nudge, one step (the live Help me with a pass, else the
///    bank's next step in the tutor's hand), then the walk-through (the bank's steps, a tap between).
@MainActor
final class SATSessionModel: ObservableObject {
    nonisolated static let log = Logger(subsystem: "app.agathon.Agathon", category: "sat")

    enum Phase {
        case loading
        case failed(String)
        case ready(BoardSession)

        var session: BoardSession? {
            if case .ready(let s) = self { return s }
            return nil
        }
    }

    /// What covers the session: the plan (behind the gate), a kid's out-of-ink, or making an account.
    enum Cover: String, Identifiable {
        case plan, outOfInk, account
        var id: String { rawValue }
    }

    /// The tutor's words on a page (typeset, cobalt): "Your turn: the next line.", the walk-through's
    /// captions. In page units, so they travel with the page.
    struct PageWords: Identifiable, Equatable {
        let id: String
        let screen: RecordID
        var kind: SATPageWords.Kind
        var text: String
        /// the words' top-left (page units)
        var at: Vec2
    }

    /// Rung 1's note on show: on a page, beside a line.
    struct Nudge: Equatable {
        let screen: RecordID
        let text: String
        /// the note's top-left, or (when it goes under the line) its top-left there
        let at: Vec2
    }

    /// The walk-through under way on a page.
    struct Walk: Equatable {
        let screen: RecordID
        let question: Int
        /// steps drawn so far
        var shown: Int
        let count: Int
        /// where the next step goes (page units)
        var cursor: Vec2
        var column: Int = 0
    }

    @Published private(set) var phase: Phase = .loading
    @Published private(set) var tutor: BoardTutor?
    @Published var showingSummary = false
    @Published var cover: Cover?
    @Published private(set) var fetchingMore = false
    @Published var notice: String?
    /// the live tutor is on for the page on show
    @Published private(set) var tutorOnHere = false
    // v2
    @Published private(set) var viewport = SATViewport.landscape
    @Published private(set) var words: [PageWords] = []
    @Published private(set) var nudge: Nudge?
    @Published private(set) var walk: Walk?
    /// the solution sheet over the lower half
    @Published var solutionOpen = false
    /// the grid-in's field is being typed in (its caret, its ring)
    @Published private(set) var gridInActive = false
    /// the ladder laid out once, the first time the free tutor is used up
    @Published var ladderCard = false
    private var ladderCardSeen = false
    /// what the student drew on the plane of the page on show, for the tutor (`sat_figure_marks`)
    @Published private(set) var figureMarks: String?
    /// bumps when the page's layout or prints change (the hit targets follow)
    @Published private(set) var layoutTick = 0

    let practice: SATPractice
    let context: SATContext
    /// `sat_question_id` (and `sat_figure_marks`) on every live body of this board
    let tag = LiveRequestTag()
    /// the stub run's tutor services (they count calls: a capped page makes none)
    private(set) var quiet: SATQuietLiveServices?
    let style = SATPageStyle.standard

    private weak var backend: AgathonBackend?
    private(set) weak var canvas: BoardCanvasView?
    private(set) var boardId = ""
    /// question index ↔ its page
    private var pageOf: [Int: RecordID] = [:]
    private var questionOn: [RecordID: Int] = [:]
    /// each question's printer at the current window, and its printed question (typeset once)
    private var printers: [Int: SATPagePrinter] = [:]
    private var questionPrints: [Int: PagePrint] = [:]
    private var subscription: StoreSubscription?
    private var watches: Set<AnyCancellable> = []
    /// the loop's calls when each question's page was last shown (used the tutor: calls made since)
    private var callsAtShow: [Int: Int] = [:]
    /// rung 2 through the live tutor: waiting for its step's ink (then "Your turn"), else the bank's
    private var liveStep: (screen: RecordID, question: Int, since: Date, before: Set<RecordID>)?
    private var liveStepTimer: Task<Void, Never>?
    private var liveStepSettle: Task<Void, Never>?
    private var opened = false
    private var closed = false

    init(context: SATContext, questions: [SATQuestion]) {
        self.context = context
        practice = SATPractice(service: context.service)
        practice.today = context.progress?.today
        practice.addSet(questions)
    }

    // MARK: - opening

    func open(backend: AgathonBackend) async {
        guard !opened else { return }
        opened = true
        self.backend = backend
        let session: BoardSession
        if context.isStub {
            boardId = "sat-stub-\(practice.sessionId.prefix(8))"
            session = BoardSession(boardId: boardId, remote: MemoryBoardRemote(), assets: MemoryBoardAssetStore(), backup: nil)
            await session.open()
        } else {
            // the day's SAT board again while it has room (an account-less student may keep at most 10
            // boards, and Home stays tidy); else a new one
            var opened: BoardSession?
            if let kept = SATBoardHome.kept(for: backend.auth.userId), let s = BoardSession.make(boardId: kept, backend: backend) {
                await s.open()
                if s.phase == .ready, s.controller.store.screens.count + practice.questions.count <= ScreenRecord.maxScreens {
                    boardId = kept
                    opened = s
                } else {
                    await s.close()
                }
            }
            if opened == nil {
                do {
                    let board = try await backend.boards.create(title: SATBoardHome.title())
                    boardId = board.id
                } catch {
                    phase = .failed("Couldn't make a board for this set. Check the Wi-Fi, then try again.")
                    return
                }
                guard let made = BoardSession.make(boardId: boardId, backend: backend) else {
                    phase = .failed("Sign in again to practice.")
                    return
                }
                await made.open()
                opened = made
                SATBoardHome.keep(boardId, for: backend.auth.userId)
            }
            guard let opened else { return }
            session = opened
        }
        guard !closed else {
            await session.close()
            return
        }
        guard session.phase == .ready else {
            phase = .failed("This board didn't open. Check the Wi-Fi, then try again.")
            return
        }
        // a grown-up's pencil: 0.65 × the default (the owner, twice: too thick)
        session.controller.penWidth = SATSessionModel.pencilWidth
        session.controller.tool = .pen
        if let range = practice.sets.last { writePages(range, in: session.controller) }
        phase = .ready(session)
        show(practice.index)
    }

    /// The student's pencil on an SAT page (page units): 0.65 × the app's 4.5.
    static let pencilWidth = 2.9

    /// A page per question of `range`, after the board's last (the first set's first question takes
    /// the board's first, blank screen): a problem page on dotted paper, as tall as the question needs
    /// in this window, the question printed on it (not here: the canvas asks `prints(for:)`), and the
    /// question's stated relations as the page's problem (the tutor judges the ink against it).
    func writePages(_ range: Range<Int>, in controller: BoardController) {
        let store = controller.store
        for i in range {
            let q = practice.questions[i]
            let printer = printer(i)
            let blankFirst = pageOf.isEmpty && store.screens.count == 1 && store.screens.first?.problemPage == nil
                && store.drawables(on: store.screenIDs[0]).isEmpty
            let rect = Box(x: 0, y: 0, w: Box.screen.w, h: printer.layout.pageHeight)
            let screenId: RecordID
            if blankFirst, let first = store.screenIDs.first {
                screenId = first
                controller.setScreenRect(rect, on: first)
            } else {
                guard let made = controller.insertScreen(after: store.screenIDs.last, meta: [:], rect: rect, origin: .tutor, go: false) else {
                    notice = "This board is full. Go back to SAT home for a fresh one."
                    break
                }
                screenId = made
            }
            var page = problemPage(i, printer.layout)
            // the question's stated relations head the work on the page (none for a word problem:
            // the student's own first line does, as on a page of their own homework)
            let lines = SATStemMath.problemLines(q.stem)
            if !lines.isEmpty {
                let s = printer.layout.stem
                let head: AgathonBoard.JSONValue = .object(["x": .number(s.x), "y": .number(s.y), "w": .number(s.w), "h": .number(s.h)])
                let record = ProblemRecord(screen: screenId, latex: lines.joined(separator: "\n"), origin: "sat",
                                           meta: ["rect": head, "satQuestion": .string(q.id)])
                store.put(.problem(record), origin: .tutor)
                page.problem = record.id
            }
            controller.setProblemPage(page, on: screenId)
            pageOf[i] = screenId
            questionOn[screenId] = i
        }
    }

    /// Question `i`'s page meta at `layout`: dotted paper round the printed question, no answer spot
    /// (the answer row is printed), the work area down to the row.
    private func problemPage(_ i: Int, _ layout: SATPageLayout) -> ProblemPage {
        let item = practice.items[i]
        return ProblemPage(setId: practice.setId(item.set), index: item.number, count: item.count, problem: nil, origin: "sat",
                           workTop: style.topLane, answer: false, workBottom: layout.workBottom, paper: .dots,
                           keepOut: layout.keepOut.map { Box(x: $0.x, y: $0.y, w: $0.w, h: $0.h) })
    }

    /// Question `i`'s printer at the current window (and the ink already on its page).
    func printer(_ i: Int) -> SATPagePrinter {
        if let p = printers[i] { return p }
        let p = SATPagePrinter(question: practice.questions[i], number: practice.items[i].number, viewport: viewport,
                               lowestInk: pageOf[i].flatMap(lowestInk(on:)), style: style)
        printers[i] = p
        return p
    }

    // MARK: - the window: the page follows it

    /// The window is `size` points: each page is laid out for it again (its height, its answer row,
    /// its dots); the question itself never moves.
    func windowChanged(_ size: CGSize) {
        guard size.width > 0, size.height > 0 else { return }
        let next = SATViewport(points: size.width, size.height, dockPoints: SATChromeSize.lane)
        guard next != viewport else { return }
        viewport = next
        relayout()
    }

    /// Every page laid out again at the window (and its ink): taller pages stay taller, the answer
    /// rows re-anchor at the bottom.
    func relayout() {
        guard let controller = phase.session?.controller else { return }
        printers = [:]
        questionPrints = [:]
        for (i, screen) in pageOf {
            let p = printer(i)
            controller.setScreenRect(Box(x: 0, y: 0, w: Box.screen.w, h: p.layout.pageHeight), on: screen)
            var page = problemPage(i, p.layout)
            page.problem = controller.store[screen]?.screen?.problemPage?.problem
            controller.setProblemPage(page, on: screen)
        }
        canvas?.reloadPrint()
        layoutTick &+= 1
    }

    /// The bottom of the student's ink on a page (page units), the figure's marks left out.
    func lowestInk(on screen: RecordID) -> Double? {
        kidStrokes(on: screen).compactMap { s in s.points.map { s.pagePoint($0).y }.max() }.max()
    }

    func kidStrokes(on screen: RecordID, figure: Bool = false) -> [StrokeRecord] {
        guard let store = phase.session?.controller.store else { return [] }
        return store.drawables(on: screen).compactMap { r in
            guard case .stroke(let s) = r, s.author == .kid, s.meta["highlight"]?.boolValue != true else { return nil }
            return (s.meta[Self.figureMeta] != nil) == figure ? s : nil
        }
    }

    static let figureMeta = "figure"

    // MARK: - what the canvas prints

    /// The page's prints: the question (typeset once), then its answer row as it stands.
    func prints(for screen: ScreenRecord) -> [PagePrint] {
        guard let i = question(on: screen.id) else { return [] }
        // a page that continues a question ("More room") carries no print
        if screen.problemPage?.continues != nil { return [] }
        let p = printer(i)
        let q = questionPrints[i] ?? p.questionPrint()
        questionPrints[i] = q
        return [q, p.answersPrint(practice.items[i], active: gridInActive && i == practice.index)]
    }

    /// The question a page is for (a continued page's: its first page's).
    func question(on screen: RecordID) -> Int? {
        if let i = questionOn[screen] { return i }
        if let first = phase.session?.controller.store[screen]?.screen?.problemPage?.continues { return questionOn[first] }
        return nil
    }

    /// The answer row changed (a card chosen or struck, the grid-in typed, a check).
    func answersChanged() {
        canvas?.reloadPrint()
        layoutTick &+= 1
    }

    /// The layout of the page on show.
    var layoutHere: SATPageLayout? {
        guard let screen = phase.session?.controller.currentScreenID, let i = question(on: screen) else { return nil }
        return printer(i).layout
    }

    // MARK: - the canvas is up: the tutor joins (off)

    func attach(_ canvas: BoardCanvasView) {
        canvas.accessibilityIdentifier = "board.canvas"
        guard tutor == nil, !closed, let backend, let session = phase.session else { return }
        self.canvas = canvas
        let services: LiveServices
        if context.isStub {
            let q = SATQuietLiveServices(reads: SATDebugFlags.stubReads)
            quiet = q
            services = q
        } else {
            services = LiveAPIServices(backend: backend, tag: tag)
        }
        let boardId = self.boardId
        let api = backend.api
        let tutor = BoardTutor(controller: session.controller, canvas: canvas, boardId: boardId, services: services) { board, helper in
            // Ask is not shown in SAT practice (and an account-less student may not call it): its parts
            // are only the board's writer for the tutor, on a transport that calls nothing
            let driver = AskBoardDriver(canvasBoard: board, helper: helper)
            let speech = AskSpeech(voice: AskVoice(source: nil), grade: nil)
            let chat = AskSession(boardId: boardId, transport: SATNoAskTransport(), board: driver, speech: speech.queue, grade: nil)
            return (AskParts(session: chat, speech: speech, mic: AskMic(stt: LiveSpeechToText(api: api))), driver)
        }
        // SAT answers are SAT's own record, not the K–8 learning record
        tutor.loop.learning.connectsAutomatically = false
        tutor.loop.learning.isEnabled = false
        // off until this page's pass is claimed (the first ink); Help me's live rung is one step
        tutor.loop.settings.enabled = false
        tutor.loop.settings.mode = .suggest
        // Graph it and Graph an equation draw onto the question's own plane
        tutor.loop.questionPlot = { [weak self] screen in self?.questionPlot(on: screen) }
        tutor.onInkEmpty = { [weak self] in self?.tutorRefused() }
        session.isPenDown = { [weak canvas, weak liveBoard = tutor.liveBoard] in
            if liveBoard?.isPenDown == true { return true }
            return canvas?.gestureRecognizers?.contains { $0.state == .began || $0.state == .changed } ?? false
        }
        // the question printed under the ink; ink over its figure tagged as on the figure
        canvas.printProvider = { [weak self] screen in self?.prints(for: screen) ?? [] }
        session.controller.strokeTagger = { [weak self] stroke in self?.figureTag(stroke) ?? [:] }
        tutor.start()
        self.tutor = tutor
        let controller = session.controller
        subscription = controller.store.observe { [weak self] change in self?.storeChanged(change) }
        controller.$currentScreenID.dropFirst().removeDuplicates()
            .sink { [weak self] id in DispatchQueue.main.async { self?.screenChanged(id) } }
            .store(in: &watches)
        applyTutor()
    }

    // MARK: - moving between questions

    /// The board shows question `i`'s page.
    func show(_ i: Int) {
        guard let controller = phase.session?.controller, let id = pageOf[i] else { return }
        noteUse()
        practice.show(i)
        closePageNotes()
        if controller.currentScreenID != id { controller.goToScreen(id) }
        applyTutor()
        refreshFigureMarks()
        layoutTick &+= 1
    }

    func next() {
        practice.next()
        show(practice.index)
    }

    func previous() {
        practice.previous()
        show(practice.index)
    }

    /// The board moved (a swipe, the tutor's Next): the session follows to that page's question.
    private func screenChanged(_ id: RecordID) {
        noteUse()
        if let i = question(on: id), i != practice.index {
            practice.endReviewIfOutside(i)
            practice.show(i)
        }
        closePageNotes()
        applyTutor()
        refreshFigureMarks()
        layoutTick &+= 1
    }

    /// The notes of a page go when the page does (the tutor's words stay on their page).
    private func closePageNotes() {
        nudge = nil
        solutionOpen = false
        gridInActive = false
        if let w = walk, w.screen != phase.session?.controller.currentScreenID { walk = nil }
    }

    /// The tutor on the page on show: on with its pass (the question's id on every call), else off.
    private func applyTutor() {
        guard let loop = tutor?.loop, let controller = phase.session?.controller else { return }
        let i = question(on: controller.currentScreenID)
        callsAtShow[practice.index] = Self.calls(loop)
        guard let i, practice.items.indices.contains(i), practice.items[i].tutor.isOn else {
            if loop.settings.enabled { loop.settings.enabled = false }
            tutorOnHere = false
            return
        }
        tutorOnHere = true
        tag.satQuestionId = practice.questions[i].id
        if !loop.settings.enabled {
            loop.settings.enabled = true
            // what was written while the pass was asked for is read now: no stroke is lost
            loop.takeInInk()
        }
    }

    // MARK: - the free tutor's one trigger: the first ink on a question's page

    private func storeChanged(_ change: ChangeSet) {
        guard let controller = phase.session?.controller else { return }
        let screen = controller.currentScreenID
        if change.origin == .kid {
            var inked = false
            var onFigure = false
            for r in change.added.values {
                guard case .stroke(let s) = r, s.author == .kid, s.screen == screen else { continue }
                inked = true
                if s.meta[Self.figureMeta] != nil { onFigure = true }
            }
            if inked {
                firstInk(on: screen)
                // the student writes again: the nudge and "Your turn" have done their job
                nudge = nil
                words.removeAll { $0.screen == screen && $0.kind == .yourTurn }
            }
            if onFigure || change.removed.count > 0 { refreshFigureMarks() }
        } else if change.origin == .tutor, let pending = liveStep, pending.screen == screen {
            // the tutor's hand writes stroke by stroke: "Your turn" once it has put the pen down
            liveStepSettle?.cancel()
            liveStepSettle = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .milliseconds(900))
                guard let self, !Task.isCancelled, let now = self.liveStep, now.screen == pending.screen else { return }
                self.liveStepWritten(now)
            }
        }
    }

    /// The student wrote on a question's page: its pass is claimed once (the tag set first, so the
    /// reads that follow carry the question), and the tutor goes on if it is allowed.
    func firstInk(on screen: RecordID) {
        guard let i = question(on: screen), practice.needsTutorClaim(i) else { return }
        tag.satQuestionId = practice.questions[i].id
        Task { @MainActor [weak self] in
            guard let self else { return }
            let result = await self.practice.claimTutorPass(for: i)
            if case .capped = result { self.firstCapped() }
            self.applyTutor()
        }
    }

    /// The tutor couldn't be reached: the next ink claims again, or now.
    func retryTutor() {
        guard let screen = phase.session?.controller.currentScreenID, let i = question(on: screen) else { return }
        practice.resetTutor(at: i)
        if !kidStrokes(on: screen).isEmpty || !kidStrokes(on: screen, figure: true).isEmpty { firstInk(on: screen) }
    }

    /// A live call was refused all the same (402 `sat_tutor`: no pass, or the pass used up): off here,
    /// capped (Help me's step falls back to the bank).
    private func tutorRefused() {
        guard let loop = tutor?.loop, let screen = phase.session?.controller.currentScreenID, let i = question(on: screen) else { return }
        practice.tutorRefused(at: i)
        loop.settings.enabled = false
        loop.inkRestored()
        tutorOnHere = false
        firstCapped()
        // a live step waited on is written from the bank now
        if let pending = liveStep, pending.question == i {
            liveStep = nil
            liveStepTimer?.cancel()
            Task { await bankStep(i) }
        }
    }

    /// The first time the free tutor is used up in a session: the ladder laid out once.
    private func firstCapped() {
        guard !ladderCardSeen else { return }
        ladderCardSeen = true
        ladderCard = true
    }

    /// After Unlimited or an account: every question the cap stopped claims again on its next ink.
    func capLifted() {
        for i in practice.items.indices {
            if case .capped = practice.items[i].tutor { practice.resetTutor(at: i) }
        }
        applyTutor()
    }

    /// The tutor read or helped while this question was on show (its calls went up).
    private func noteUse() {
        guard let loop = tutor?.loop else { return }
        let i = practice.index
        if Self.calls(loop) > (callsAtShow[i] ?? .max) { practice.noteTutorUsed(at: i) }
    }

    static func calls(_ loop: LiveLoop) -> Int { loop.metrics.calls.values.reduce(0, +) }

    /// The capped line for the top bar, when the tutor is used up on this question.
    var cappedLine: String? {
        if case .capped(let pass) = practice.item.tutor { return SATCopy.cappedLine(cap: pass.cap) }
        return nil
    }

    // MARK: - answering on the page

    /// A tap on the page's answer row (page units): a card chosen or struck, a key pressed, the
    /// grid-in's field focused.
    func tapCard(_ key: String, strike: Bool) {
        if strike { practice.toggleEliminated(key) } else { practice.choose(key) }
        answersChanged()
    }

    func press(_ key: SATGridIn.Key) {
        gridInActive = true
        practice.press(key)
        answersChanged()
    }

    func focusGridIn() {
        gridInActive = true
        answersChanged()
    }

    /// Check: the answer (right: the solution sheet; not right: the wrong-answer note and one more
    /// try; missed: the sheet), and the work on the page checked by the tutor when it is on.
    func check() {
        noteUse()
        if let loop = tutor?.loop { callsAtShow[practice.index] = Self.calls(loop) }
        let result = practice.check()
        gridInActive = false
        switch result {
        case .right, .missed:
            solutionOpen = true
            // the tutor ticks what it can of the work (check when done)
            if tutorOnHere { tutor?.loop.checkPage() }
        case .lookAgain:
            walk = nil
        case .notReady(let why):
            notice = why?.words ?? SATCopy.chooseFirst
        case .locked:
            break
        }
        answersChanged()
    }

    /// The wrong-answer note is on show: a wrong answer checked and still the one chosen.
    var showsWrongNote: Bool {
        practice.item.verdict == .lookAgain && practice.answerAlreadyTried && !solutionOpen
    }

    func tryAgain() {
        practice.tryAgain()
        answersChanged()
    }

    /// After a check for good: the next question, or the set's results.
    func afterCheck() {
        solutionOpen = false
        if practice.isLastInSet || practice.setDone {
            showingSummary = true
        } else {
            next()
        }
    }

    // MARK: - Help me: the ink ladder (docs/SAT-V2.md)

    /// Help me: the next rung.
    func helpMe() {
        ladderCard = false
        let i = practice.index
        guard let q = practice.current, let screen = pageOf[i] else { return }
        if let w = walk, w.question == i {
            goOnWalk()
            return
        }
        let rung = practice.item.ladder.next(hasNudge: q.nudge != nil)
        practice.updateLadder(at: i) { $0.reach(rung) }
        switch rung {
        case .nudge:
            showNudge(i, on: screen)
        case .step:
            nudge = nil
            oneStep(i)
        case .walkthrough:
            nudge = nil
            startWalk(i)
        }
        layoutTick &+= 1
    }

    /// The student's last line on a page (page units): the newest read line, else the lowest row of
    /// their ink (the figure's marks left out); nil with nothing written.
    func lastLine(on screen: RecordID) -> Box? {
        if screen == phase.session?.controller.currentScreenID, tutorOnHere, let read = tutor?.loop.readLines.last {
            return Box(x: read.bounds.x, y: read.bounds.y, w: read.bounds.w, h: read.bounds.h)
        }
        let boxes = kidStrokes(on: screen).compactMap { s -> Box? in
            let pts = s.points.map { s.pagePoint($0) }
            guard let x0 = pts.map(\.x).min(), let x1 = pts.map(\.x).max(), let y0 = pts.map(\.y).min(), let y1 = pts.map(\.y).max() else { return nil }
            return Box(x: x0, y: y0, w: x1 - x0, h: y1 - y0)
        }
        guard let lowest = boxes.max(by: { $0.y + $0.h / 2 < $1.y + $1.h / 2 }) else { return nil }
        // the strokes on that row: their middles within the lowest's band
        let band = (lowest.y - 12)...(lowest.y + lowest.h + 12)
        let row = boxes.filter { band.contains($0.y + $0.h / 2) }
        let x0 = row.map(\.x).min() ?? lowest.x, x1 = row.map { $0.x + $0.w }.max() ?? lowest.x + lowest.w
        let y0 = row.map(\.y).min() ?? lowest.y, y1 = row.map { $0.y + $0.h }.max() ?? lowest.y + lowest.h
        return Box(x: x0, y: y0, w: x1 - x0, h: y1 - y0)
    }

    /// Rung 1: the bank's nudge beside the student's last line (under it when there is no room
    /// beside), or at the top of the work with nothing written.
    private func showNudge(_ i: Int, on screen: RecordID) {
        guard let text = practice.questions[i].nudge else { return }
        let layout = printer(i).layout
        let w = Double(SATNudgeNote.width)
        var at = Vec2(style.stemX, layout.workTop + 8)
        if let line = lastLine(on: screen) {
            // beside the line and whatever the tutor put after it (its tick)
            let beside = Vec2(rowEnd(line, on: screen) + 48, line.y - 4)
            let inFigure = layout.keepOut.dropFirst().contains { $0.x < beside.x + w && beside.y < $0.maxY }
            at = beside.x + w <= style.right && !inFigure ? beside : Vec2(line.x, line.y + line.h + 24)
        }
        nudge = Nudge(screen: screen, text: text, at: at)
    }

    /// Where a line of the page ends: its ink and anything on its row after it (the tutor's tick).
    func rowEnd(_ line: Box, on screen: RecordID) -> Double {
        guard let store = phase.session?.controller.store else { return line.x + line.w }
        let band = line.y...(line.y + line.h)
        let ends = store.drawables(on: screen).compactMap { r -> Double? in
            guard r.meta[Self.figureMeta] == nil, let b = RenderGeometry.item(for: r)?.bounds else { return nil }
            let mid = b.y + b.h / 2
            return band.contains(mid) && b.x >= line.x - 4 && b.x < line.x + line.w + 160 ? b.x + b.w : nil
        }
        return max(line.x + line.w, ends.max() ?? 0)
    }

    /// Rung 2: ONE next step. With the day's pass, the live Help me writes it under the last line
    /// (its ink is watched for, to put "Your turn" beside it); capped, offline or with nothing read,
    /// the bank's next step in the tutor's hand.
    private func oneStep(_ i: Int) {
        guard let screen = pageOf[i] else { return }
        if tutorOnHere, let loop = tutor?.loop, loop.helpOneStep() {
            let before = Set(phase.session?.controller.store.drawables(on: screen).map(\.id) ?? [])
            liveStep = (screen, i, Date(), before)
            liveStepTimer?.cancel()
            liveStepTimer = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(SATSessionModel.liveStepWait))
                guard let self, !Task.isCancelled, let pending = self.liveStep, pending.question == i else { return }
                // the live tutor wrote nothing in time (offline, out of reach): the bank's step
                self.liveStep = nil
                await self.bankStep(i)
            }
            return
        }
        Task { await bankStep(i) }
    }

    /// How long rung 2 waits for the live tutor's step before writing the bank's.
    static let liveStepWait = 12.0

    /// The live tutor's ink arrived on the page: "Your turn" beside it.
    private func liveStepWritten(_ pending: (screen: RecordID, question: Int, since: Date, before: Set<RecordID>)) {
        guard let store = phase.session?.controller.store else { return }
        let fresh = store.drawables(on: pending.screen).filter { r in
            guard !pending.before.contains(r.id), r.author == .tutor, r.meta["mark"] == nil else { return false }
            return r.meta["live"]?.boolValue == true
        }
        // still writing: wait for the pen to lift
        if tutor?.loop.busyWriting == true {
            liveStepSettle = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .milliseconds(500))
                guard let self, !Task.isCancelled, let now = self.liveStep else { return }
                self.liveStepWritten(now)
            }
            return
        }
        let boxes = fresh.compactMap { RenderGeometry.item(for: $0)?.bounds }
        guard let first = boxes.first else { return }
        let box = boxes.dropFirst().reduce(first) { $0.union($1) }
        liveStep = nil
        liveStepTimer?.cancel()
        lastStepSource = "live"
        placeYourTurn(after: box, on: pending.screen)
    }

    /// Rung 2 from the bank: the first step after the last one the student's lines already match,
    /// not written before, in the tutor's hand under their last line.
    func bankStep(_ i: Int) async {
        guard let screen = pageOf[i] else { return }
        let q = practice.questions[i]
        let read = tutor?.loop.readLines.map(\.latex) ?? []
        guard let k = SATHintLadder.nextBankStep(q.solution.steps, studentLines: tutorOnHere ? read : [], written: practice.items[i].ladder.written) else {
            notice = SATCopy.noMoreSteps
            return
        }
        practice.updateLadder(at: i) { $0.written.insert(k) }
        let layout = printer(i).layout
        let line = lastLine(on: screen)
        // under the student's last line, and under anything the tutor already wrote there
        let below = max(line.map { $0.y + $0.h } ?? layout.workTop, columnBottom(on: screen) ?? 0)
        let origin = Vec2(line?.x ?? style.stemX, below + 48)
        let step = q.solution.steps[k]
        lastStepSource = "bank"
        // ONE line: a chain's last link (`… ⇒ 4x − 5 = 2x + 9` is the step)
        if let math = step.math.map(Self.handLines)?.last, !math.isEmpty, let loop = tutor?.loop,
           let box = await loop.writeTutorMath([math], at: origin, lineHeight: Self.handLine, seedKey: "\(q.id):step\(k)", meta: ["satStep": .number(Double(k))]) {
            placeYourTurn(after: Box(x: box.x, y: box.y, w: box.w, h: box.h), on: screen)
        } else {
            // a step of words only: the tutor's words, typeset (it never handwrites words)
            words.append(PageWords(id: "\(q.id):step\(k)", screen: screen, kind: .caption(number: k + 1, waiting: false), text: step.text, at: origin))
        }
        layoutTick &+= 1
    }

    /// The tutor's hand on an SAT page: a work line (the design notes: size 38).
    static let handLine = 38.0

    /// The lowest ink in the stem's column of a page (the student's and the tutor's, the figure's
    /// marks left out): where the tutor's next writing goes under.
    func columnBottom(on screen: RecordID) -> Double? {
        guard let store = phase.session?.controller.store else { return nil }
        let edge = style.figureX - 24
        return store.drawables(on: screen).compactMap { r -> Double? in
            guard case .stroke(let s) = r, s.meta[Self.figureMeta] == nil, s.meta["highlight"]?.boolValue != true, !s.points.isEmpty else { return nil }
            let pts = s.points.map { s.pagePoint($0) }
            guard let minX = pts.map(\.x).min(), minX < edge else { return nil }
            return pts.map(\.y).max()
        }.max()
    }

    /// A bank step's maths as the tutor writes it: one line a part of a chain (`a \Rightarrow b`).
    static func handLines(_ math: String) -> [String] {
        let parts = math.components(separatedBy: #"\Rightarrow"#).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return parts.isEmpty ? [math] : parts
    }

    /// How rung 2 was written last (the probe): "live" (the live Help me) or "bank".
    private(set) var lastStepSource = "-"


    private func placeYourTurn(after box: Box, on screen: RecordID) {
        words.removeAll { $0.screen == screen && $0.kind == .yourTurn }
        words.append(PageWords(id: "yourTurn:\(screen.rawValue)", screen: screen, kind: .yourTurn, text: SATCopy.yourTurn,
                               at: Vec2(box.x + box.w + 40, box.y + box.h / 2 - 14)))
    }

    // MARK: - rung 3: walk me through it

    /// The bank's steps one by one in the tutor's ink, a tap between: from the top of the stem's
    /// column, or under the student's last line when they have written there.
    func startWalk(_ i: Int) {
        guard let screen = pageOf[i] else { return }
        if practice.index != i { show(i) }
        practice.updateLadder(at: i) { $0.reach(.walkthrough) }
        let layout = printer(i).layout
        // from the top of the stem's column, or under what is written there already
        let start = Vec2(style.stemX, columnBottom(on: screen).map { $0 + 40 } ?? layout.workTop + 16)
        walk = Walk(screen: screen, question: i, shown: 0, count: practice.questions[i].solution.steps.count, cursor: start)
        words.removeAll { $0.screen == screen && $0.id.hasPrefix("walk:") }
        goOnWalk()
    }

    /// The next step of the walk-through (the last one turns the pill back into Check).
    func goOnWalk() {
        guard var w = walk else { return }
        let q = practice.questions[w.question]
        guard w.shown < w.count else {
            walk = nil
            return
        }
        let k = w.shown
        let step = q.solution.steps[k]
        let layout = printer(w.question).layout
        // a step that would run into the answer row goes to the figure's side of the L
        if w.cursor.y + 150 > layout.workBottom, w.column == 0 {
            w.column = 1
            w.cursor = Vec2(style.figureX, layout.workTopFigureSide + 16)
        }
        let caption = w.cursor
        words.removeAll { $0.id == "walk:\(w.question):waiting" }
        words.append(PageWords(id: "walk:\(w.question):\(k)", screen: w.screen, kind: .caption(number: k + 1, waiting: false), text: step.text, at: caption))
        w.shown = k + 1
        var next = Vec2(caption.x, caption.y + 58)
        let i = w.question
        walk = w
        if let math = step.math, !math.isEmpty, let loop = tutor?.loop {
            let mathTop = Vec2(caption.x, caption.y + 46)
            Task { @MainActor [weak self] in
                guard let self else { return }
                let box = await loop.writeTutorMath(Self.handLines(math), at: mathTop, lineHeight: Self.handLine, seedKey: "\(q.id):walk\(k)",
                                                    meta: ["satWalk": .number(Double(k))])
                next = Vec2(caption.x, (box.map { $0.y + $0.h } ?? mathTop.y + Self.handLine) + 40)
                self.walkAdvanced(i, to: next)
            }
        } else {
            walkAdvanced(i, to: next)
        }
        practice.updateLadder(at: i) { $0.walked = k + 1 }
        layoutTick &+= 1
    }

    /// The cursor moves under the step just drawn; the next step's caption waits there, faint.
    private func walkAdvanced(_ i: Int, to next: Vec2) {
        guard var w = walk, w.question == i else { return }
        w.cursor = next
        walk = w
        let q = practice.questions[i]
        if w.shown < w.count {
            words.append(PageWords(id: "walk:\(i):waiting", screen: w.screen, kind: .caption(number: w.shown + 1, waiting: true),
                                   text: q.solution.steps[w.shown].text, at: next))
        }
    }

    // MARK: - writing on the figure

    /// A kid stroke over the question's figure: tagged as on it (ordinary ink, read in its terms).
    func figureTag(_ stroke: StrokeRecord) -> Meta {
        guard let i = question(on: stroke.screen), let figure = practice.questions[i].figure, !stroke.points.isEmpty else { return [:] }
        let layout = printer(i).layout
        let pts = stroke.points.map { stroke.pagePoint($0) }
        let mx = pts.map(\.x).reduce(0, +) / Double(pts.count), my = pts.map(\.y).reduce(0, +) / Double(pts.count)
        switch figure {
        case .plot(let plot):
            guard let map = SATPlotMap(layout: layout, plot: plot), map.covers(mx, my) else { return [:] }
            return [Self.figureMeta: "plot"]
        case .shape:
            guard let art = layout.figureArt, art.contains(mx, my) else { return [:] }
            return [Self.figureMeta: "shape"]
        case .table:
            return [:]
        }
    }

    /// What the student drew on the page's plane, for the tutor (`sat_figure_marks`).
    func refreshFigureMarks() {
        guard let screen = phase.session?.controller.currentScreenID, let i = question(on: screen),
              case .plot(let plot)? = practice.questions[i].figure, let map = SATPlotMap(layout: printer(i).layout, plot: plot) else {
            figureMarks = nil
            tag.satFigureMarks = nil
            return
        }
        let strokes = kidStrokes(on: screen, figure: true).map { s in s.points.map { p -> (x: Double, y: Double) in
            let v = s.pagePoint(p)
            return (v.x, v.y)
        } }
        figureMarks = SATFigureMarks.summary(strokes, on: map)
        tag.satFigureMarks = figureMarks
    }

    /// The question's plane on a page, for the loop (Graph it onto it).
    func questionPlot(on screen: RecordID) -> QuestionPlot? {
        guard let i = question(on: screen), case .plot(let plot)? = practice.questions[i].figure, let g = printer(i).layout.plotGrid else { return nil }
        return QuestionPlot(grid: BrainRect(x: g.x, y: g.y, w: g.w, h: g.h), xMin: plot.x.min, xMax: plot.x.max, yMin: plot.y.min, yMax: plot.y.max)
    }

    // MARK: - Graph an equation

    func graph(_ typed: String) async -> String? {
        guard let loop = tutor?.loop else { return SATCopy.graphNotAFunction }
        switch await loop.graphTyped(typed) {
        case .graphed: return nil
        case .notAFunction: return SATCopy.graphNotAFunction
        case .noRoom: return SATCopy.graphNoRoom
        }
    }

    // MARK: - the end of a set

    func reviewMissed() {
        showingSummary = false
        practice.reviewMissed()
        show(practice.index)
    }

    func endReview() {
        practice.endReview()
        showingSummary = true
    }

    /// Practice 10 more: the next set on this board, from its first question.
    func more() async {
        guard !fetchingMore, let controller = phase.session?.controller else { return }
        fetchingMore = true
        defer { fetchingMore = false }
        do {
            let qs = try await context.service.next(SATNextRequest())
            guard !qs.isEmpty else {
                notice = SATCopy.noQuestions
                return
            }
            guard controller.store.screens.count + qs.count <= ScreenRecord.maxScreens else {
                notice = "This board is full. Go back to SAT home for a fresh one."
                return
            }
            let range = practice.addSet(qs)
            writePages(range, in: controller)
            showingSummary = false
            show(range.lowerBound)
        } catch {
            notice = SATCopy.setFailed
        }
    }

    // MARK: - the app's life

    func leavingScreen() {
        practice.stopClock()
        guard let session = phase.session else { return }
        Task { @MainActor in await session.appWillResignActive() }
    }

    func back() {
        practice.startClock()
    }

    func close() {
        guard !closed else { return }
        closed = true
        noteUse()
        practice.stopClock()
        liveStepTimer?.cancel()
        subscription?.cancel()
        subscription = nil
        watches.removeAll()
        tutor?.stop()
        tutor = nil
        canvas?.printProvider = nil
        let session = phase.session
        session?.isPenDown = { false }
        session?.controller.strokeTagger = nil
        let practice = self.practice
        Task { @MainActor in
            await practice.flush()
            await session?.close()
        }
    }

    // MARK: - Debug

    #if DEBUG
    /// The UI tests' ink: one kid stroke on the page on show, in the work area, as the Pencil would.
    func debugInk() {
        guard let controller = phase.session?.controller else { return }
        let screen = controller.currentScreenID
        let y = (layoutHere?.workTop ?? 300) + 60
        let stroke = StrokeRecord(screen: screen, order: controller.store.nextOrder(on: screen), author: .kid, color: .black, width: Self.pencilWidth,
                                  pressure: .simulated, x: 200, y: y,
                                  points: [AgathonBoard.InkPoint(x: 0, y: 0), AgathonBoard.InkPoint(x: 30, y: 12), AgathonBoard.InkPoint(x: 60, y: 0)], start: 0)
        controller.commitStroke(stroke)
    }

    /// The UI tests' figure ink: a loop round a point of the page's plane (graph units).
    func debugCircle(x gx: Double, y gy: Double) {
        guard let controller = phase.session?.controller, let i = question(on: controller.currentScreenID),
              case .plot(let plot)? = practice.questions[i].figure, let map = SATPlotMap(layout: printer(i).layout, plot: plot) else { return }
        let c = map.page(gx, gy)
        let pts = (0...24).map { k -> AgathonBoard.InkPoint in
            let t = Double(k) / 24 * 2 * .pi
            return AgathonBoard.InkPoint(x: 20 * cos(t), y: 20 * sin(t))
        }
        let screen = controller.currentScreenID
        controller.commitStroke(StrokeRecord(screen: screen, order: controller.store.nextOrder(on: screen), author: .kid, color: .black,
                                             width: Self.pencilWidth, pressure: .simulated, x: c.x, y: c.y, points: pts, start: 0))
    }

    /// What the UI tests read: the question, the tutor's state on it, the passes, the live calls, the
    /// ladder, the page's words, the figure's marks.
    var debugValue: String {
        let state: String
        switch practice.item.tutor {
        case .ready: state = "ready"
        case .asking: state = "asking"
        case .on: state = "on"
        case .capped: state = "capped"
        case .unavailable: state = "unavailable"
        }
        let passes = (context.service as? SATStubService)?.tutorAsked.count ?? -1
        let attempts = (context.service as? SATStubService)?.attempts.count ?? -1
        let live = tutor?.loop.settings.enabled == true ? "on" : "off"
        let rung = practice.item.ladder.reached.map { "\($0.rawValue)" } ?? "0"
        let screen = phase.session?.controller.currentScreenID
        let here = words.filter { $0.screen == screen }
        let tutorInk = screen.map { s in phase.session?.controller.store.drawables(on: s).filter { $0.author == .tutor && $0.meta["live"]?.boolValue == true }.count ?? 0 } ?? 0
        let page = layoutHere.map { "\(Int($0.pageHeight))" } ?? "-"
        return "q \(practice.index + 1) tutor \(state) live \(live) passes \(passes) attempts \(attempts) calls \(quiet?.calls ?? -1) tag \(tag.satQuestionId ?? "-") "
            + "rung \(rung) words \(here.count) yourTurn \(here.contains { $0.kind == .yourTurn } ? "yes" : "no") walk \(walk.map { "\($0.shown)/\($0.count)" } ?? "-") "
            + "tutorInk \(tutorInk) marks \(figureMarks ?? "-") page \(page) step \(lastStepSource) read \(tutor?.loop.readLines.count ?? 0) fig \(screen.map { kidStrokes(on: $0, figure: true).count } ?? -1)/\(screen.map { kidStrokes(on: $0).count } ?? -1)"
    }
    #endif
}

extension SATPractice {
    /// The board went to a page outside the questions under review: review is over.
    func endReviewIfOutside(_ i: Int) {
        if let list = reviewing, !list.contains(i) { endReview() }
    }
}

/// Ask's transport in SAT practice: nothing is asked, no history read (Ask is not on SAT's screen).
final class SATNoAskTransport: AskTransport {
    func ask(_ request: AskRequest) -> AsyncThrowingStream<AskEvent, Error> {
        AsyncThrowingStream { $0.finish() }
    }

    func history(boardId: String, screen: AskHistoryScreen?) async -> (history: AskHistoryResponse?, retry: Bool) { (nil, false) }

    func move(boardId: String, turnIds: [String], screenId: String) async -> Bool { false }
}
