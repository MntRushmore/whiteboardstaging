import AgathonAsk
import AgathonBoard
import AgathonKit
import AgathonLive
import AgathonSAT
import AgathonSync
import Combine
import os
import SwiftUI
import UIKit

/// One SAT practice session, start to end (docs/SAT-MODE.md, "The session"): one board, a problem
/// page per question (the page's problem is the question's stated relations, so the tutor judges the
/// ink against it; its heading "Q3 · Linear functions"), the panel and the board following each other,
/// and the free tutor's gate:
///
///  - a question's page starts with the tutor **ready but off**: no pass is asked for by opening,
///    browsing, choosing or checking;
///  - the **first ink** on the page (`firstInk`, the one trigger) claims the pass
///    (`SATPractice.claimTutorPass(for:)`, the one place); allowed, the tutor goes on and reads what was
///    written meanwhile (`LiveLoop.takeInInk`); not, the cap line shows and the board stays plain ink;
///  - every live call on an SAT page carries `sat_question_id` (`LiveRequestTag`), set to the page's
///    question before the tutor is switched on there;
///  - a refusal on a live call anyway (402 `sat_tutor`) turns the tutor off on that page.
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

    @Published private(set) var phase: Phase = .loading
    @Published private(set) var tutor: BoardTutor?
    @Published var showingSummary = false
    @Published var cover: Cover?
    @Published private(set) var fetchingMore = false
    @Published var notice: String?

    let practice: SATPractice
    let context: SATContext
    /// `sat_question_id` on every live body of this board
    let tag = LiveRequestTag()
    /// the stub run's tutor services (they count calls: a capped page makes none)
    private(set) var quiet: SATQuietLiveServices?

    private weak var backend: AgathonBackend?
    private(set) var boardId = ""
    /// question index ↔ its page
    private var pageOf: [Int: RecordID] = [:]
    private var questionOn: [RecordID: Int] = [:]
    private var subscription: StoreSubscription?
    private var watches: Set<AnyCancellable> = []
    /// the loop's calls when each question's page was last shown (used the tutor: calls made since)
    private var callsAtShow: [Int: Int] = [:]
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
        } else {
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
            session = made
        }
        await session.open()
        guard !closed else {
            await session.close()
            return
        }
        guard session.phase == .ready else {
            phase = .failed("This board didn't open. Check the Wi-Fi, then try again.")
            return
        }
        if let range = practice.sets.last { writePages(range, in: session.controller) }
        phase = .ready(session)
        show(practice.index)
    }

    /// A page per question of `range`, after the board's last (the first set's first question takes
    /// the board's first, blank screen). Each is a problem page with no answer spot (the answer goes in
    /// the panel), its heading, and the question's relations as the page's problem.
    func writePages(_ range: Range<Int>, in controller: BoardController) {
        let store = controller.store
        for i in range {
            let q = practice.questions[i], item = practice.items[i]
            let blankFirst = pageOf.isEmpty && store.screens.count == 1 && store.screens.first?.problemPage == nil
                && store.drawables(on: store.screenIDs[0]).isEmpty
            var page = ProblemPage(setId: practice.setId(item.set), index: item.number, count: item.count, origin: "sat",
                                   workTop: Self.workTop, answer: false, heading: practice.pageHeading(i))
            let screenId: RecordID
            if blankFirst, let first = store.screenIDs.first {
                screenId = first
            } else {
                guard let made = controller.insertScreen(after: store.screenIDs.last, meta: [:], origin: .tutor, go: false) else {
                    notice = "This board is full. Go back to SAT home for a fresh one."
                    break
                }
                screenId = made
            }
            // the question's stated relations head the work on the page (none for a word problem:
            // the student's own first line does, as on a page of their own homework)
            let lines = SATStemMath.problemLines(q.stem)
            if !lines.isEmpty {
                let rect = store[screenId]?.screen?.rect ?? .screen
                let k = rect.w / Box.screen.w
                let head: AgathonBoard.JSONValue = .object(["x": .number(rect.x + 88 * k), "y": .number(rect.y + 56 * k),
                                                            "w": .number(1424 * k), "h": .number(30 * k)])
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

    /// Where an SAT page's work starts: under its small heading, a row more than a practice page.
    static let workTop = 110.0

    // MARK: - the canvas is up: the tutor joins (off)

    func attach(_ canvas: BoardCanvasView) {
        canvas.accessibilityIdentifier = "board.canvas"
        guard tutor == nil, !closed, let backend, let session = phase.session else { return }
        let services: LiveServices
        if context.isStub {
            let q = SATQuietLiveServices()
            quiet = q
            services = q
        } else {
            services = LiveAPIServices(backend: backend, tag: tag)
        }
        let isStub = context.isStub
        let boardId = self.boardId
        let tutor = BoardTutor(controller: session.controller, canvas: canvas, boardId: boardId, services: services) { board, helper in
            // Ask is not shown in SAT practice; its parts are the board's writer for the tutor
            #if DEBUG
            if isStub {
                let driver = AskBoardDriver(canvasBoard: board, helper: helper)
                let speech = AskSpeech(voice: AskVoice(source: nil), grade: nil)
                let chat = AskSession(boardId: boardId, transport: ScriptedAskTransport(), board: driver, speech: speech.queue, grade: nil)
                return (AskParts(session: chat, speech: speech, mic: AskMic(stt: ScriptedSpeechToText())), driver)
            }
            #endif
            return AskParts.live(backend: backend, boardId: boardId, board: board, helper: helper, userId: backend.auth.userId, grade: nil)
        }
        // SAT answers are SAT's own record, not the K–8 learning record
        tutor.loop.learning.connectsAutomatically = false
        tutor.loop.learning.isEnabled = false
        // off until this page's pass is claimed (the first ink)
        tutor.loop.settings.enabled = false
        tutor.onInkEmpty = { [weak self] in self?.tutorRefused() }
        session.isPenDown = { [weak canvas, weak liveBoard = tutor.liveBoard] in
            if liveBoard?.isPenDown == true { return true }
            return canvas?.gestureRecognizers?.contains { $0.state == .began || $0.state == .changed } ?? false
        }
        tutor.start()
        self.tutor = tutor
        let controller = session.controller
        subscription = controller.store.observe { [weak self] change in self?.storeChanged(change) }
        controller.$currentScreenID.dropFirst().removeDuplicates()
            .sink { [weak self] id in DispatchQueue.main.async { self?.screenChanged(id) } }
            .store(in: &watches)
        applyTutor()
    }

    // MARK: - the panel and the board follow each other

    /// The board shows question `i`'s page (the panel moved).
    func show(_ i: Int) {
        guard let controller = phase.session?.controller, let id = pageOf[i] else { return }
        noteUse()
        if controller.currentScreenID != id { controller.goToScreen(id) }
        applyTutor()
    }

    /// The board moved (its ‹ ›, the tutor's Next): the panel follows to that page's question.
    private func screenChanged(_ id: RecordID) {
        noteUse()
        if let i = questionOn[id], i != practice.index {
            practice.endReviewIfOutside(i)
            practice.show(i)
        }
        applyTutor()
    }

    /// The tutor on the page on show: on with its pass (the question's id on every call), else off.
    private func applyTutor() {
        guard let loop = tutor?.loop, let controller = phase.session?.controller else { return }
        let i = questionOn[controller.currentScreenID]
        callsAtShow[practice.index] = Self.calls(loop)
        guard let i, practice.items.indices.contains(i), practice.items[i].tutor.isOn else {
            if loop.settings.enabled { loop.settings.enabled = false }
            return
        }
        tag.satQuestionId = practice.questions[i].id
        if !loop.settings.enabled {
            loop.settings.enabled = true
            // what was written while the pass was asked for is read now: no stroke is lost
            loop.takeInInk()
        }
    }

    // MARK: - the free tutor's one trigger: the first ink on a question's page

    private func storeChanged(_ change: ChangeSet) {
        guard change.origin == .kid, let controller = phase.session?.controller else { return }
        let screen = controller.currentScreenID
        let inked = change.added.values.contains { r in
            if case .stroke(let s) = r { return s.author == .kid && s.screen == screen }
            return false
        }
        if inked { firstInk(on: screen) }
    }

    /// The student wrote on a question's page: its pass is claimed once (the tag set first, so the
    /// reads that follow carry the question), and the tutor goes on if it is allowed.
    func firstInk(on screen: RecordID) {
        guard let i = questionOn[screen], practice.needsTutorClaim(i) else { return }
        tag.satQuestionId = practice.questions[i].id
        Task { @MainActor [weak self] in
            guard let self else { return }
            _ = await self.practice.claimTutorPass(for: i)
            self.applyTutor()
        }
    }

    /// The tutor couldn't be reached: the next ink claims again, or now.
    func retryTutor() {
        guard let screen = phase.session?.controller.currentScreenID, let i = questionOn[screen] else { return }
        practice.resetTutor(at: i)
        if let store = phase.session?.controller.store, !store.drawables(on: screen).filter({ r in
            if case .stroke(let s) = r { return s.author == .kid }
            return false
        }).isEmpty {
            firstInk(on: screen)
        }
    }

    /// A live call was refused all the same (402 `sat_tutor`: no pass, or the pass used up): off here.
    private func tutorRefused() {
        guard let loop = tutor?.loop, let screen = phase.session?.controller.currentScreenID, let i = questionOn[screen] else { return }
        practice.tutorRefused(at: i)
        loop.settings.enabled = false
        loop.inkRestored()
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

    /// Before a check: the tutor's help so far counts for the attempt.
    func beforeCheck() {
        noteUse()
        if let loop = tutor?.loop { callsAtShow[practice.index] = Self.calls(loop) }
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
        subscription?.cancel()
        subscription = nil
        watches.removeAll()
        tutor?.stop()
        tutor = nil
        let session = phase.session
        session?.isPenDown = { false }
        let practice = self.practice
        Task { @MainActor in
            await practice.flush()
            await session?.close()
        }
    }

    // MARK: - Debug

    #if DEBUG
    /// The UI tests' ink: one kid stroke on the page on show, as the Pencil would put it.
    func debugInk() {
        guard let controller = phase.session?.controller else { return }
        let screen = controller.currentScreenID
        let rect = controller.currentScreen?.rect ?? .screen
        let stroke = StrokeRecord(screen: screen, order: controller.store.nextOrder(on: screen), author: .kid, color: .black, width: 6,
                                  pressure: .simulated, x: rect.x + 200, y: rect.y + 320,
                                  points: [InkPoint(x: 0, y: 0), InkPoint(x: 30, y: 12), InkPoint(x: 60, y: 0)], start: 0)
        controller.store.put(.stroke(stroke), origin: .kid)
    }

    /// What the UI tests read: the question, the tutor's state on it, the passes claimed, the live calls.
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
        return "q \(practice.index + 1) tutor \(state) live \(live) passes \(passes) attempts \(attempts) calls \(quiet?.calls ?? -1) tag \(tag.satQuestionId ?? "-")"
    }
    #endif
}

extension SATPractice {
    /// The board went to a page outside the questions under review: review is over.
    func endReviewIfOutside(_ i: Int) {
        if let list = reviewing, !list.contains(i) { endReview() }
    }
}
