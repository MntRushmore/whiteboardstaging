import AgathonBrain
import AgathonKit
import Combine
import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// The board's learning record, as a board screen sees it (`LiveLoop.learning`): the web's
/// `learningBus` and `useBoardLearning` in one. The Live loop tells it what happened
/// (`LearningSignal`); it turns that into the student's attempts (`AttemptTracker`), publishes each
/// as it changes (`onAttempt`: Today's practice, Now you try, a replay's "fixed 2 mistakes") and saves
/// them to `learning_attempts` as the signed-in student (`LearningRecorder`) — the rows the Progress
/// page, Today's practice, the skill path, weak-spot practice and the weekly report read.
///
/// Nothing to wire for a board opened with `LiveAPIServices(backend:)`: `LiveLoop.start()` connects
/// it to whoever is signed in (their course from their profile), and `LiveLoop.stop()` closes the
/// board's attempts and saves them. Signals said before it is connected are kept (at most 500) and
/// handed over then. What a screen may add:
///
///  - `onAttempt` / `attempts()`: every attempt's latest state;
///  - `writing(.practice) { … }`: problems the chat writes meanwhile (Ask's `write_problems`) are a
///    practice set's — or `.nowYouTry` with its parent — not the chat's own;
///  - `problemWritten(…)`: a problem the tutor wrote some other way;
///  - `daily(day:goal:)`: this board is Today's practice (`DailyPractice`, stars and the day's row);
///  - `isEnabled = false`: record nothing (a Lab without an account, a demo).
@MainActor
public final class LiveLearning: ObservableObject {
    public let boardId: String
    /// false: nothing is recorded or saved (signals are dropped)
    public var isEnabled = true {
        didSet { if !isEnabled { buffer.removeAll() } }
    }
    /// `LiveLoop.start()` connects to the backend its services carry (on by default)
    public var connectsAutomatically = true
    /// The latest attempt published (SwiftUI observers).
    @Published public private(set) var latest: LearningRecord?
    /// Today's practice on this board, when it is that board (`daily(day:goal:)`).
    @Published public private(set) var dailyPractice: DailyPractice?
    /// The last save's result: nil before any; "" saved; else the store's code (the Lab's line).
    @Published public private(set) var lastSave: String?
    public private(set) var recorder: LearningRecorder?
    private var connection: Connection?

    private var buffer: [LearningSignal] = []
    private var listeners: [UUID: (LearningRecord) -> Void] = [:]
    private var latestById = OrderedMap<String, LearningRecord>()
    /// where the chat's problems come from while a run writes them (`runChatActions`' origins)
    private var chatOrigins: [(origin: LearningOrigin, parentId: String?)] = []
    /// how to reach the signed-in student (`connect(backend:)`); asked again while no one is
    private var source: (@MainActor () async -> Connection?)?
    private var connecting = false
    private var connectTask: Task<Void, Never>?
    /// while no one is connected: a sign-in connects at once
    private var signIns: Task<Void, Never>?
    /// a sign-in came while a connection was being tried: try again when it ends
    private var retryAfterConnect = false
    private var lastTry = -Double.infinity
    private var observers: [NSObjectProtocol] = []
    let brain: Brain
    let scheduler: LiveScheduler

    /// What the recorder needs to save as someone.
    public struct Connection {
        public var store: LearningAttemptStore
        public var userId: String
        public var course: String?
        public var storage: LearningDeviceStorage?
        /// Today's practice's day rows (`daily(day:goal:)`); nil: the day is counted, not saved
        public var daily: DailyPracticeStore?

        public init(store: LearningAttemptStore, userId: String, course: String?, storage: LearningDeviceStorage?, daily: DailyPracticeStore? = nil) {
            self.store = store
            self.userId = userId
            self.course = course
            self.storage = storage
            self.daily = daily
        }
    }

    /// signals kept before the record is connected (MAX_BUFFER)
    static let bufferMax = 500
    /// attempts remembered for `attempts()` (MAX_ATTEMPTS)
    static let attemptsMax = 200
    /// while no one is signed in, the session is asked again no sooner than this (ms)
    static let retryConnectMs = 10_000.0

    public init(boardId: String, brain: Brain, scheduler: LiveScheduler) {
        self.boardId = boardId
        self.brain = brain
        self.scheduler = scheduler
        observeTheApp()
    }

    deinit {
        for o in observers { NotificationCenter.default.removeObserver(o) }
    }

    // MARK: - signals in

    /// What happened on the board. Never throws; dropped when recording is off.
    public func emit(_ signal: LearningSignal) {
        guard isEnabled else { return }
        if let recorder {
            recorder.handle(signal)
            return
        }
        buffer.append(signal)
        if buffer.count > Self.bufferMax { buffer.removeFirst(buffer.count - Self.bufferMax) }
        tryConnect()
    }

    /// A problem the tutor wrote on the board (not through the Live loop's own `problem` records,
    /// which it reports itself): `key` is its block or record, unique on the screen.
    public func problemWritten(screen: String, key: String, lines: [String], origin: LearningOrigin, parentId: String? = nil, at: Double? = nil) {
        emit(.problem(.init(at: at ?? LearningTime.now(), boardId: boardId, pageId: screen, problemKey: "\(screen)\(ProblemKeyKind.cell)\(key)",
                            problemLatex: lines, origin: origin, parentId: parentId)))
    }

    /// Runs `body` (the chat writing problems: Ask's `write_problems`) with the problems it writes
    /// filed under `origin` — a practice set's, a Now you try's (with the attempt it follows) — as the
    /// web's `runChatActions(actions, { origin, parentId })` does. Runs nest in order.
    public func writing<T>(_ origin: LearningOrigin, parentId: String? = nil, _ body: () async -> T) async -> T {
        chatOrigins.append((origin, parentId))
        defer { if !chatOrigins.isEmpty { chatOrigins.removeFirst() } }
        return await body()
    }

    /// Where a problem the chat is writing now comes from (`tutor_problem` when no run said).
    var chatOrigin: (origin: LearningOrigin, parentId: String?) {
        chatOrigins.first ?? (.tutorProblem, nil)
    }

    // MARK: - attempts out

    /// Called with each attempt's latest state as it changes. Keep the token; cancel it to stop.
    public func onAttempt(_ fn: @escaping (LearningRecord) -> Void) -> AnyCancellable {
        let id = UUID()
        listeners[id] = fn
        return AnyCancellable { [weak self] in
            Task { @MainActor in self?.listeners[id] = nil }
        }
    }

    /// Each attempt published since the board opened, as it is now, oldest change first.
    public func attempts() -> [LearningRecord] {
        latestById.orderedValues
    }

    /// The attempt id for a problem on the board (`#cell:`/`#ink:` key), once what was said before has landed.
    public func attemptId(forProblemKey key: String) async -> String? {
        await connectTask?.value
        guard let recorder else { return nil }
        return await recorder.attemptId(for: key)
    }

    private func publish(_ record: LearningRecord) {
        latestById.remove(record.id)
        latestById[record.id] = record
        if latestById.count > Self.attemptsMax { latestById.removeFirst() }
        latest = record
        dailyPractice?.attempt(record)
        for fn in Array(listeners.values) { fn(record) }
    }

    // MARK: - connecting

    /// Records as whoever is signed in on `backend` (their course from their profile), saved to
    /// `learning_attempts` with AgathonKit's `LearningRepository`, kept on the device in
    /// Application Support. No one signed in yet: asked again as the board goes on.
    public func connect(backend: AgathonBackend) {
        source = { [weak backend] in
            guard let backend else { return nil }
            let repository = LearningRepository(client: backend.supabase)
            guard let userId = await repository.signedInUserId() else { return nil }
            let profile: Profile? = (try? await backend.profiles.profile()) ?? nil
            let course = profile?.course.flatMap { LearningRepository.courseIds.contains($0) ? $0 : nil }
            return Connection(store: RepositoryAttemptStore(repository: repository), userId: userId, course: course,
                              storage: LearningFileStorage.applicationSupport(), daily: RepositoryDailyStore(repository: repository))
        }
        lastTry = -.infinity
        tryConnect()
        // someone signing in later (a Lab that signs in after the board opened) is connected then
        signIns?.cancel()
        let changes = backend.auth.changes()
        signIns = Task { @MainActor [weak self] in
            for await change in changes {
                guard let self, self.recorder == nil else { return }
                if change.userId != nil {
                    if self.connecting {
                        self.retryAfterConnect = true
                    } else {
                        self.lastTry = -.infinity
                        self.tryConnect()
                    }
                }
            }
        }
    }

    /// Records as this student, saving to this store (tests, a custom backend).
    public func connect(_ connection: Connection) {
        source = nil
        start(connection)
    }

    private func tryConnect() {
        guard recorder == nil, !connecting, isEnabled, let source else { return }
        let now = scheduler.now
        guard now - lastTry >= Self.retryConnectMs else { return }
        lastTry = now
        connecting = true
        connectTask = Task { @MainActor in
            let connection = await source()
            self.connecting = false
            guard self.recorder == nil, self.isEnabled else { return }
            if let connection {
                self.start(connection)
            } else if self.retryAfterConnect {
                self.retryAfterConnect = false
                self.lastTry = -.infinity
                self.tryConnect()
            }
        }
    }

    /// Waits for a connection being made now (the session read, the profile's course); true when
    /// the record is connected.
    @discardableResult
    public func ready() async -> Bool {
        if recorder == nil { tryConnect() }
        await connectTask?.value
        return recorder != nil
    }

    private func start(_ c: Connection) {
        guard recorder == nil else { return }
        signIns?.cancel()
        signIns = nil
        let recorder = LearningRecorder(boardId: boardId, userId: c.userId.lowercased(), course: c.course, store: c.store, storage: c.storage,
                                        brain: brain, scheduler: scheduler)
        recorder.onPublish = { [weak self] in self?.publish($0) }
        recorder.onSaveResult = { [weak self] in self?.lastSave = $0 ?? "" }
        self.recorder = recorder
        connection = c
        let waiting = buffer
        buffer = []
        for s in waiting { recorder.handle(s) }
        if let d = dailyPractice, let store = c.daily { d.connect(store, storage: c.storage) }
    }

    // MARK: - saving

    /// Saves what is pending now (a test, the board's own "done"); the device keeps what fails.
    public func flush() async {
        await connectTask?.value
        await recorder?.flushNow()
    }

    /// The board is closing: its attempts end, and are saved (`LiveLoop.stop()` calls it).
    public func stop() {
        signIns?.cancel()
        signIns = nil
        recorder?.stop()
        dailyPractice?.flush()
        source = nil
        // a loop started again connects again (the board's attempts come back from the device)
        recorder = nil
        connection = nil
    }

    // MARK: - Today's practice

    /// This board is Today's practice for `day` (the student's local date, YYYY-MM-DD) with `goal`
    /// problems: finished set problems count, solved alone earn a star, and the day's row
    /// (`save_daily_practice`) goes up as they do.
    @discardableResult
    public func daily(day: String, goal: Int = DailyRow.defaultGoal) -> DailyPractice {
        if let d = dailyPractice, d.day == day { return d }
        let d = DailyPractice(boardId: boardId, day: day, goal: goal, scheduler: scheduler)
        dailyPractice = d
        for r in attempts() { d.attempt(r) }
        if let c = connection, let store = c.daily { d.connect(store, storage: c.storage) }
        return d
    }

    // MARK: - the app going away

    private func observeTheApp() {
        #if canImport(UIKit)
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.wentToBackground() }
        })
        observers.append(center.addObserver(forName: UIApplication.willTerminateNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.recorder?.terminate()
                self?.dailyPractice?.flush()
            }
        })
        #endif
    }

    /// Out of sight: what is pending is kept on the device and saved now, with the time iOS gives.
    private func wentToBackground() {
        guard let recorder else { return }
        recorder.persist()
        dailyPractice?.flush()
        #if canImport(UIKit)
        var task = UIBackgroundTaskIdentifier.invalid
        task = UIApplication.shared.beginBackgroundTask(withName: "agathon.learning.save") {
            UIApplication.shared.endBackgroundTask(task)
            task = .invalid
        }
        Task { @MainActor in
            await recorder.flushNow()
            if task != .invalid { UIApplication.shared.endBackgroundTask(task) }
        }
        #else
        Task { await recorder.flushNow() }
        #endif
    }
}
