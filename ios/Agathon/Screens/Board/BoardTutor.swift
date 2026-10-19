import AgathonAsk
import AgathonBoard
import AgathonKit
import AgathonLive
import Combine
import UIKit

/// The tutor's parts on one open board, made once the canvas is up and taken down with the screen:
///
///  - **Live** (AgathonLive): the loop on the canvas (`CanvasLiveBoard`), the editor's selection as
///    what Help me acts on, the problems the tutor wrote heading the columns under them.
///  - **Ask** (AgathonAsk): the chat, read aloud and the mic; its board driver writes in the tutor's
///    hand (typeset instead when the grown-ups switched the hand off) and asks the loop for the kid's
///    lines, Help me and Solve it (`LiveLoopAskHelper`).
///
/// Nothing here holds the screen: the screen's model holds this, and `stop()` cancels everything in
/// flight so the whole board is freed when it closes (`BoardTutorTests`).
@MainActor
final class BoardTutor {
    let liveBoard: CanvasLiveBoard
    let loop: LiveLoop
    let helper: LiveLoopAskHelper
    let ask: AskParts
    let driver: AskBoardDriver
    /// Live's or Ask's "out of ink" (help is paused): the screen shows the out-of-ink screen.
    var onInkEmpty: (() -> Void)?
    private var watches: Set<AnyCancellable> = []
    private(set) var started = false

    /// - Parameters:
    ///   - services: the Live routes (`LiveAPIServices(backend:)`; tests pass a scripted fake)
    ///   - makeAsk: Ask's parts on this board and helper (`AskParts.live`; tests pass a scripted chat)
    init(controller: BoardController, canvas: BoardCanvasView, boardId: String, services: LiveServices,
         makeAsk: (CanvasLiveBoard, LiveLoopAskHelper) -> (AskParts, AskBoardDriver)) {
        let liveBoard = CanvasLiveBoard(controller: controller, canvas: canvas)
        // what the kid picked with the select tool is what Help me acts on
        liveBoard.selectionProvider = { [weak controller] in Array(controller?.selection ?? []) }
        let loop = LiveLoop(board: liveBoard, boardId: boardId, services: services)
        let helper = LiveLoopAskHelper(loop: loop)
        let (ask, driver) = makeAsk(liveBoard, helper)
        // the tutor writes by hand unless the grown-ups switched the hand off (then it typesets)
        driver.handwriting = { [weak loop] in loop?.settings.handwriting ?? true }
        driver.reduceMotion = { UIAccessibility.isReduceMotionEnabled }
        self.liveBoard = liveBoard
        self.loop = loop
        self.helper = helper
        self.ask = ask
        self.driver = driver
    }

    /// The app's tutor on the signed-in user's board.
    static func live(backend: AgathonBackend, controller: BoardController, canvas: BoardCanvasView, boardId: String,
                     grade: Int?) -> BoardTutor {
        let userId = backend.auth.userId
        var misread: (from: String, to: String)?
        #if DEBUG
        // the UI tests' misread on purpose: `-liveMisread "3x = 15=>3 \\times = 15"` (docs/PROBLEM-PAGES.md)
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-liveMisread"), i + 1 < args.count {
            let parts = args[i + 1].components(separatedBy: "=>")
            if parts.count == 2 { misread = (parts[0], parts[1]) }
        }
        #endif
        return BoardTutor(controller: controller, canvas: canvas, boardId: boardId, services: LiveAPIServices(backend: backend, misread: misread)) { board, helper in
            AskParts.live(backend: backend, boardId: boardId, board: board, helper: helper, userId: userId, grade: grade)
        }
    }

    func start() {
        guard !started else { return }
        started = true
        loop.start()
        // problems on the screen it opened on (the onboarding's first board, a practice set) head
        // their columns from the start; again on every screen the kid moves to
        loop.problemsChanged()
        liveBoard.controller.$currentScreenID.dropFirst().removeDuplicates()
            .sink { [weak self] _ in
                // after the controller and the loop have both moved
                DispatchQueue.main.async { self?.loop.problemsChanged() }
            }
            .store(in: &watches)
        // out of ink: the moment the loop's help pauses
        loop.$activity.removeDuplicates()
            .sink { [weak self] activity in if activity == .outOfInk { self?.onInkEmpty?() } }
            .store(in: &watches)
        // …or the moment Ask's answer comes back "out of ink" (its own reporting stays)
        let report = ask.session.onFailure
        ask.session.onFailure = { [weak self] chatError, error in
            report?(chatError, error)
            if chatError.kind == .ink { self?.onInkEmpty?() }
        }
    }

    /// Stops the loop (its timers, calls and pens), Ask's reply, its voice and the mic.
    func stop() {
        guard started else { return }
        started = false
        watches.removeAll()
        ask.session.stop()
        // the tutor's pen too: a reply still writing would keep the closed board until it finished
        driver.stop()
        ask.speech.stop()
        ask.mic.cancel()
        ask.session.onFailure = nil
        loop.stop()
        onInkEmpty = nil
    }

    // MARK: - practice

    /// Writes a practice set's problems on the board in the tutor's hand, one problem per page
    /// (docs/PROBLEM-PAGES.md: Ask's `write_problems` through `ProblemPageWriter`, each problem checked
    /// by the desk in the brain; the set's pages, then All done), unless they are on the board already
    /// (Today's practice opened again). Each page's problem heads all the work on it.
    /// Returns how many were written (0 when they were there already or none could be).
    @discardableResult
    func writePractice(_ problems: [[String]], key: String) async -> Int {
        let store = liveBoard.controller.store
        guard !problems.isEmpty, !Self.wrote(key, in: store), !Self.hasProblems(problems, in: store) else { return 0 }
        // remembered with the board (saved with the strokes it writes): never written twice
        var done = store.documentMeta[Self.practiceMeta]?.arrayValue ?? []
        done.append(.string(key))
        store.documentMeta[Self.practiceMeta] = .array(done)
        let action = AgathonKit.JSONValue.object([
            "type": .string("write_problems"),
            "problems": .array(problems.map { .array($0.map { .string($0) }) }),
            // the set's pages say which set they are ("Problem 2 of 5") and where it came from
            "set": .string(key),
            "origin": .string("practice"),
        ])
        // the problems it writes are a practice set's for the learning record (the web's
        // `runChatActions(actions, { origin: "practice" })`)
        let driver = self.driver
        let report = await loop.learning.writing(.practice) { await driver.run([action]) { _ in } }
        loop.problemsChanged()
        return report.problemsWritten
    }

    /// The board's meta: the practice sets written on it (`daily:2026-10-18`, `topic:fractions`).
    static let practiceMeta = "practiceWritten"

    static func wrote(_ key: String, in store: BoardStore) -> Bool {
        store.documentMeta[practiceMeta]?.arrayValue?.contains { $0.stringValue == key } == true
    }

    /// Any of `problems` already written on the board (by an earlier open of the same practice).
    static func hasProblems(_ problems: [[String]], in store: BoardStore) -> Bool {
        let wanted = Set(problems.map { $0.joined(separator: ";") })
        for screen in store.screenIDs {
            for record in store.drawables(on: screen) {
                guard let lines = record.meta["chatProblem"]?["lines"]?.arrayValue?.compactMap(\.stringValue) else { continue }
                if wanted.contains(lines.joined(separator: ";")) { return true }
            }
        }
        return false
    }
}
