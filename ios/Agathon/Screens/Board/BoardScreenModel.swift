import AgathonAsk
import AgathonBoard
import AgathonBrain
import AgathonDesign
import AgathonKit
import AgathonLive
import AgathonSync
import Combine
import os
import SwiftUI
import UIKit

/// One open board, start to end: AgathonSync reads it (the iPad's document, or the web's board
/// converted on this open) and saves it as the kid works; once the canvas is up the tutor joins
/// (`BoardTutor`: Live on the board, Ask beside it); a practice set is written on it in the tutor's
/// hand; leaving the app saves at once; closing saves, stops everything and lets it all go.
@MainActor
final class BoardScreenModel: ObservableObject {
    nonisolated static let log = Logger(subsystem: "app.agathon.Agathon", category: "board")

    enum Phase {
        case loading
        case failed(BoardPreviewModel.Failure)
        case ready(BoardSession)

        var session: BoardSession? {
            if case .ready(let s) = self { return s }
            return nil
        }
    }

    /// What covers the board for money: help paused (kid or grown-up words), or the plan behind the gate.
    enum MoneyScreen: String, Identifiable {
        case outOfInk, plan
        var id: String { rawValue }
    }

    @Published private(set) var phase: Phase = .loading
    @Published private(set) var tutor: BoardTutor?
    @Published var askOpen = false
    /// the Mac screen panel: a window shared from a computer (agathon.app/share), live beside the board
    @Published var macOpen = MacScreenModel.openAtLaunch
    let mac = MacScreenModel()
    @Published var money: MoneyScreen?
    @Published private(set) var audience: BoardAudience?
    /// A word for the kid over the board for a moment (work put back from the backup, nearly full).
    @Published private(set) var notice: String?
    /// Today's practice on this board (its count and stars), when it is that board.
    @Published private(set) var daily: DailyPractice?
    /// The picture tutor, when an admin switched it on (Account → Picture tutor (test)): it runs on this
    /// board instead of the Live loop's marks (`BoardTutor.start(live: false)`).
    @Published private(set) var picture: PictureTutor?
    private var pictureBoard: PictureTutorBoard?

    /// The Live loop, when it is the board's tutor (not while the picture tutor runs): its Help me,
    /// status pill and settings show only then.
    var liveLoop: LiveLoop? { picture == nil ? tutor?.loop : nil }

    private(set) var request: OpenBoard?
    private weak var backend: AgathonBackend?
    private weak var canvas: BoardCanvasView?
    private var opened = false
    private(set) var closed = false
    private var practiceTask: Task<Void, Never>?
    private var noticeTask: Task<Void, Never>?
    private var watches: Set<AnyCancellable> = []
    private var inkShownAt: Date?

    deinit {
        Self.log.debug("board screen model freed")
    }

    // MARK: - opening

    func open(_ request: OpenBoard, backend: AgathonBackend) async {
        guard !opened else { return }
        opened = true
        self.request = request
        self.backend = backend
        audience = request.audience
        await openSession()
        if audience == nil {
            let read = await Self.readAudience(backend)
            audience = read
            // the tutor may have joined first: Ask's first chips follow the grade
            if tutor?.ask.session.grade == nil { tutor?.ask.session.grade = read.grade }
        }
    }

    /// Opens (or opens again, after a failure) the board's session.
    func openSession() async {
        guard let request, let backend, !closed else { return }
        phase = .loading
        guard let session = BoardSession.make(boardId: request.board.id, backend: backend) else {
            phase = .failed(.init(icon: .lock, title: "Sign in again to open this board.", message: "You were signed out on this iPad.", retry: false))
            return
        }
        // the infinite board test flag: the canvas spans far past the page (nothing about it is saved)
        session.controller.infinite = BoardFlags.infinite
        if let seed = request.seed { await Self.saveSeedIfEmpty(seed, boardId: request.board.id, backend: backend) }
        await session.open()
        guard !closed else {
            await session.close()
            return
        }
        switch session.phase {
        case .ready:
            if let seed = request.seed, session.source == .blank { Self.putSeed(seed, into: session.controller.store) }
            watch(session)
            phase = .ready(session)
        case .failed(let why):
            phase = .failed(.init(icon: .offline, title: "This board didn't open.", message: Self.kidWords(why), retry: true))
            await backend.errors.reportUserError(kind: "live.boards", code: "open_failed", message: "Couldn't open a board on the iPad: \(why)",
                                                 path: "/board", boardId: request.board.id)
        case .loading:
            break
        }
    }

    /// The session's words for the kid (its own are written for a person, but some carry the error).
    static func kidWords(_ why: String) -> String {
        why.hasPrefix("Couldn't open this board.") ? "Check the Wi-Fi, then try again." : why
    }

    private func watch(_ session: BoardSession) {
        session.$notice.compactMap { $0 }.sink { [weak self] in self?.say($0) }.store(in: &watches)
        session.$sync.map(\.notice).removeDuplicates().compactMap { $0 }.sink { [weak self] in self?.say($0) }.store(in: &watches)
    }

    /// A word over the board for a few seconds.
    func say(_ words: String) {
        notice = words
        noticeTask?.cancel()
        noticeTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(6))
            guard !Task.isCancelled else { return }
            self?.notice = nil
        }
    }

    func dismissNotice() {
        noticeTask?.cancel()
        notice = nil
    }

    /// The onboarding's first board, when its own save never reached the row: saved now, before the
    /// board opens, so it opens as the kid last saw it.
    static func saveSeedIfEmpty(_ seed: BoardDocument, boardId: String, backend: AgathonBackend) async {
        let remote = PostgrestBoardRemote(connection: SupabaseConnection.signedIn(backend))
        guard let row = try? await remote.fetch(boardId: boardId), case .empty = row.body, row.docColumn,
              let bytes = try? seed.encoded() else { return }
        _ = await remote.persist(boardId: boardId, write: BoardWrite(doc: bytes), expectedVersion: nil)
    }

    /// The seed couldn't be saved (offline): put on the blank board as an edit, so it is backed up
    /// and saved with the rest.
    static func putSeed(_ seed: BoardDocument, into store: BoardStore) {
        guard seed.records.values.contains(where: \.isDrawable) else { return }
        store.transact(.system) { tx in
            for record in seed.records.values { tx.put(record) }
        }
    }

    /// Who is at the board when the request didn't say: a kid profile, and the grade. A family that
    /// couldn't be read is a kid's (`FamilyState.who`): out of ink then sends them to a grown-up
    /// rather than offering the plan to whoever holds the iPad.
    static func readAudience(_ backend: AgathonBackend) async -> BoardAudience {
        async let family = try? backend.family.load()
        async let profile = try? backend.profiles.profile()
        let f = await family
        let p = await profile
        return BoardAudience(isKid: !FamilyState.who(f, email: backend.auth.email).isGrownUp, grade: p?.grade ?? f?.meMember?.grade)
    }

    // MARK: - the canvas is up: the tutor joins

    func attach(_ canvas: BoardCanvasView) {
        canvas.accessibilityIdentifier = "board.canvas"
        guard tutor == nil, !closed, let backend, let request, let session = phase.session else { return }
        self.canvas = canvas
        let tutor = BoardTutor.live(backend: backend, controller: session.controller, canvas: canvas, boardId: request.board.id,
                                    grade: audience?.grade ?? request.audience?.grade)
        tutor.onInkEmpty = { [weak self] in self?.inkEmpty() }
        // a save is built between strokes: the pen (the loop's observer) or any gesture on the canvas
        session.isPenDown = { [weak canvas, weak liveBoard = tutor.liveBoard] in
            if liveBoard?.isPenDown == true { return true }
            return canvas?.gestureRecognizers?.contains { $0.state == .began || $0.state == .changed } ?? false
        }
        self.tutor = tutor
        if PictureTutorSettings.enabled {
            // an admin's test: the picture tutor instead of Live's marks (asked once per user)
            Task { @MainActor [weak self, weak tutor] in
                let admin = await PictureTutorAccess.isAdmin(backend)
                guard let self, let tutor, !self.closed, self.tutor === tutor else { return }
                if admin { self.startPicture(on: tutor, boardId: request.board.id, backend: backend) }
                tutor.start(live: !admin)
            }
        } else {
            tutor.start()
        }
        if let practice = request.practice { writePractice(practice, with: tutor) }
    }

    /// The picture tutor on this board, on the real route (or, in Debug with `pictureTutor.stub`, the stub).
    private func startPicture(on tutor: BoardTutor, boardId: String, backend: AgathonBackend) {
        let client: BoardDrawClient
        #if DEBUG
        client = PictureTutorSettings.usesStub ? PictureTutorStub.client() : BoardDrawClient(api: backend.api)
        #else
        client = BoardDrawClient(api: backend.api)
        #endif
        let controller = tutor.liveBoard.controller
        let picture = PictureTutor(mode: PictureTutorSettings.defaultMode, boardId: boardId,
                                   deps: PictureTutorBoard.deps(controller: controller, canvas: { [weak tutor] in tutor?.liveBoard.canvas }, client: client))
        pictureBoard = PictureTutorBoard(controller: controller, tutor: picture)
        // the kid's pen (the Live loop, which would own it, is not started on this board)
        tutor.liveBoard.onPen = { [weak picture] down in picture?.notePen(down) }
        self.picture = picture
        Self.log.notice("picture tutor on (\(picture.mode.rawValue, privacy: .public)\(PictureTutorSettings.usesStub ? ", stub" : "", privacy: .public))")
    }

    private func writePractice(_ practice: PracticeSet, with tutor: BoardTutor) {
        let problems = practice.problems.map(\.lines).filter { !$0.isEmpty }
        let key: String
        switch practice.kind {
        case .daily(let day):
            key = "daily:\(day)"
            // this board is Today's practice: finished problems count, alone earns a star, the day's
            // row goes up as they do (AgathonLive's learning record, `save_daily_practice`)
            daily = tutor.loop.learning.daily(day: day, goal: DailyRow.defaultGoal)
        case .topic(let skill):
            key = "topic:\(skill)"
        }
        practiceTask = Task { @MainActor [weak self, weak tutor] in
            // the canvas laid out (the hand is sized by the board's zoom) and the brain loaded
            for _ in 0..<50 where (self?.canvas?.bounds.width ?? 0) == 0 { try? await Task.sleep(for: .milliseconds(100)) }
            _ = try? await Brain.shared.load()
            try? await Task.sleep(for: .milliseconds(400))
            guard let tutor, self?.closed == false, !Task.isCancelled else { return }
            let written = await tutor.writePractice(problems, key: key)
            Self.log.notice("practice \(key, privacy: .public): \(written) problems written")
        }
    }

    // MARK: - out of ink

    /// Live or Ask says help is paused: the out-of-ink screen, once a minute at most.
    func inkEmpty() {
        guard money == nil, !closed else { return }
        if let shown = inkShownAt, Date().timeIntervalSince(shown) < 60 { return }
        inkShownAt = Date()
        askOpen = false
        money = .outOfInk
    }

    // MARK: - the app's life

    /// The app is going to the background: back up and save now, with the time iPadOS gives for it.
    func leavingScreen() {
        guard let session = phase.session else { return }
        tutor?.ask.speech.stop()
        let app = UIApplication.shared
        var task: UIBackgroundTaskIdentifier = .invalid
        task = app.beginBackgroundTask(withName: "agathon.board.save") {
            app.endBackgroundTask(task)
            task = .invalid
        }
        Task { @MainActor in
            await session.appWillResignActive()
            if task != .invalid { app.endBackgroundTask(task) }
        }
    }

    /// The board is closing: save what's left, stop the tutor and Ask, let everything go.
    func close() {
        guard !closed else { return }
        closed = true
        practiceTask?.cancel()
        noticeTask?.cancel()
        watches.removeAll()
        pictureBoard?.stop()
        pictureBoard = nil
        picture = nil
        tutor?.stop()
        tutor = nil
        let session = phase.session
        session?.isPenDown = { false }
        Task { @MainActor in await session?.close() }
    }

    func retry() async {
        await phase.session?.retry()
    }
}
