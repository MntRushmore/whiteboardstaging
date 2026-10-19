import AgathonKit
import Foundation
import os

/// What the session tells read-aloud as a reply streams (`AskSpeechSink`).
@MainActor
public protocol AskSpeechSink: AnyObject {
    func start(_ id: String)
    func feed(_ id: String, _ text: String)
    func finish(_ id: String, _ text: String)
    func stop()
}

extension AskSpeechQueue: AskSpeechSink {}

/// Ask on one board (src/components/chat/useBoardChat.ts, for the iPad): a thread per screen, the
/// saved chat read the first time a screen's thread is shown, one ask at a time, the reply's words
/// painted as they stream (`reply` replaces them), the tutor's board actions written in its hand,
/// and a failure as one calm line with Try again.
///
/// A screen the tutor's own actions start takes the exchange with it: here at once, and on the
/// server after (`POST /api/live/ask/history/move` with the saved turns).
@MainActor
public final class AskSession: ObservableObject {
    static let log = Logger(subsystem: "app.agathon.Agathon", category: "ask")
    /// How long the screen's picture may hold an ask up: after this it goes without one.
    public static let imageWait: Duration = .milliseconds(1200)
    /// How long an ask waits for the saved chat still being read.
    public static let historyWait: Duration = .milliseconds(1500)
    /// Words land in the panel at most this often while they stream.
    public static let paintInterval: Duration = .milliseconds(40)

    public let boardId: String
    let transport: AskTransport
    let board: AskBoardContext
    public weak var speech: AskSpeechSink?
    /// the student's grade (0 = K … 8; nil: high school or not known), for the first chips
    public var grade: Int?
    /// the student's record (`LearnerHintSchema`), sent with each ask when the app has it
    public var learner: AgathonKit.JSONValue?
    /// a failure the admin page should hear of (`live.chat`), with the panel's own words
    public var onFailure: ((ChatError, Error) -> Void)?

    /// the screen whose chat is shown
    @Published public private(set) var screen: AskScreenRef
    @Published private var threads: [String: [ChatMessage]] = [:]
    /// a request is in flight or its actions are being written (on any screen of the board)
    @Published public private(set) var busy = false
    /// each thread's saved hello; a missing key: still loading
    @Published private var hellos: [String: AskHello?] = [:]
    /// the screen has work on it ("3 more like these" leads the chips)
    @Published public private(set) var screenHasWork = false

    private var historyRead: [String: Bool] = [:]
    private var historyLoads: [String: Task<Void, Never>] = [:]
    private var inflight: Task<Void, Never>?
    private var stopRequested = false

    public init(boardId: String, transport: AskTransport, board: AskBoardContext, speech: AskSpeechSink? = nil, grade: Int? = nil) {
        self.boardId = boardId
        self.transport = transport
        self.board = board
        self.speech = speech
        self.grade = grade
        screen = board.screenRef
        board.onScreenChange = { [weak self] ref in self?.follow(ref) }
    }

    // MARK: - what the panel shows

    var key: String { ChatView.threadKey(boardId, screen.id) }

    /// The current screen's thread.
    public var messages: [ChatMessage] { threads[key] ?? [] }

    /// A thread's messages (tests).
    public func messages(screenId: String?) -> [ChatMessage] { threads[ChatView.threadKey(boardId, screenId)] ?? [] }

    /// The screen's hello while its thread is empty; nil while its saved chat is being read.
    public var hello: AskHello? {
        guard let saved = hellos[key] else { return nil }
        return ChatView.hello(saved, grade: grade, screenHasWork: screenHasWork, screenIndex: screen.index)
    }

    public var canStop: Bool { ChatView.canStop(messages) }

    /// The panel opened: read this screen's saved chat, and whether it has work on it.
    public func appeared() {
        follow(board.screenRef)
        Task { await refreshWork() }
    }

    /// The board is on another screen: its own chat shows.
    public func follow(_ ref: AskScreenRef) {
        if ref != screen { screen = ref }
        loadSaved(for: ref)
        Task { await refreshWork() }
    }

    func refreshWork() async {
        let at = screen
        let picture = await board.picture()
        if at == screen { screenHasWork = !picture.empty }
    }

    // MARK: - the saved chat

    /// Reads a screen's saved chat once per session (again on a later view after a failure worth
    /// retrying). Its turns go BEFORE anything asked meanwhile; its hello is kept for the empty panel.
    @discardableResult
    public func loadSaved(for ref: AskScreenRef) -> Task<Void, Never> {
        let key = ChatView.threadKey(boardId, ref.id)
        if let pending = historyLoads[key] { return pending }
        if historyRead[key] == true { return Task {} }
        historyRead[key] = false
        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            let (history, retry) = await self.transport.history(boardId: self.boardId, screen: ref.historyScreen)
            if retry { self.historyRead[key] = nil } else { self.historyRead[key] = true }
            let cur = self.threads[key] ?? []
            if let history, !history.turns.isEmpty, !cur.contains(where: \.saved) {
                self.set(key, ChatView.mergeSaved(ChatView.messages(fromHistory: history.turns), into: cur))
            }
            self.hellos[key] = .some(history?.hello)
            self.historyLoads[key] = nil
        }
        historyLoads[key] = task
        return task
    }

    // MARK: - asking

    /// Sends the kid's words (typed, a chip, or said into the mic).
    public func send(_ text: String, voice: Bool = false) {
        let message = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty, !busy else { return }
        start(message, voice: voice, prior: nil, clientId: nil)
    }

    /// Stop: ends the reply being written (what came stays); the board's writing, once started, finishes.
    public func stop() {
        stopRequested = true
        inflight?.cancel()
    }

    /// Sends a failed request again (its user message and the error are replaced).
    public func retry(_ messageId: String) {
        guard !busy, let again = ChatView.retry(messages, id: messageId) else { return }
        start(again.text, voice: again.voice, prior: again.prior, clientId: again.clientId)
    }

    private func start(_ message: String, voice: Bool, prior: [ChatMessage]?, clientId: String?) {
        busy = true
        stopRequested = false
        let ref = screen
        inflight = Task { @MainActor [weak self] in
            await self?.ask(message, voice: voice, prior: prior, clientId: clientId, from: ref)
            self?.busy = false
            self?.inflight = nil
        }
    }

    /// One reply's stream: what came, when it was last painted, whether the board is writing.
    final class StreamState {
        var written = ""
        var lastPaint = ContinuousClock.now
        var paintPending = false
        var ended = false
        var spoken = false
        var acting = false
    }

    /// The exchange's thread: it moves with a screen the tutor's actions start.
    final class Where {
        var key: String
        var movedTo: String?
        init(_ key: String) { self.key = key }
    }

    /// One ask, start to end (`sendAsk`).
    func ask(_ message: String, voice: Bool, prior: [ChatMessage]?, clientId: String?, from ref: AskScreenRef) async {
        let from = ChatView.threadKey(boardId, ref.id)
        let place = Where(from)
        let before = prior ?? threads[from] ?? []
        let userId = ChatView.nextId()
        let tutorId = ChatView.nextId()
        let cid = clientId ?? ChatView.nextId()
        set(from, before + [
            ChatMessage(id: userId, role: .user, text: message, clientId: cid, voice: voice),
            ChatMessage(id: tutorId, role: .tutor, text: "", state: .thinking),
        ])
        speech?.start(tutorId)

        // the reply so far, painted at most every `paintInterval`
        let st = StreamState()
        func paint() {
            st.lastPaint = .now
            let text = ChatView.shownReply(st.written)
            patch(place.key, tutorId) { m in m.text = text; if m.state != .writing { m.state = .streaming } }
        }
        func finishSpeech(_ final: String) {
            guard !st.spoken, !final.isEmpty else { return }
            st.spoken = true
            speech?.finish(tutorId, final)
        }
        var turnId: String?
        var userTurnId: String?
        var boardRun: Task<AskRunReport, Never>?
        let ids: Set<String> = [userId, tutorId]

        let moveTo: @MainActor (AskScreenRef) -> Void = { [weak self] to in
            guard let self, st.acting, let id = to.id else { return }
            let target = ChatView.threadKey(self.boardId, id)
            guard target != place.key else { return }
            let moved = ChatView.moveExchange(from: self.threads[place.key] ?? [], to: self.threads[target] ?? [], ids: ids)
            self.threads[place.key] = moved.from
            self.threads[target] = Array(moved.to.suffix(AskLimits.messagesKept))
            place.key = target
            place.movedTo = id
        }
        func moveSaved() {
            guard let to = place.movedTo, let turnId, let userTurnId else { return }
            let boardId = self.boardId
            let transport = self.transport
            Task { _ = await transport.move(boardId: boardId, turnIds: [userTurnId, turnId], screenId: to) }
        }

        defer { st.ended = true }
        do {
            // the picture and the saved chat still being read: each a moment at most, side by side
            let picture = await board.picture()
            async let image: String? = picture.empty ? nil : Self.within(Self.imageWait) { [board] in await board.image() }
            if let loading = historyLoads[from] { _ = await Self.within(Self.historyWait) { await loading.value; return true } }
            let shot = await image
            try Task.checkCancellation()
            let now = threads[from] ?? []
            let at = now.firstIndex { $0.role == .user && $0.clientId == cid }
            let context = at.map { Array(now[..<$0]) } ?? before
            let history = ChatView.history(context)
            var screenNow = picture
            if let shot, shot.count <= AskLimits.imageChars { screenNow.image = shot }
            let request = AskRequest(boardId: boardId, message: message, history: history, screen: screenNow,
                                     problem: ChatView.problem(context, sent: history), learner: learner, voice: voice ? true : nil,
                                     clientId: cid, screenId: ref.id)
            for try await event in transport.ask(request) {
                switch event {
                case .model:
                    break
                case .delta(let d):
                    st.written += d
                    speech?.feed(tutorId, ChatView.shownReply(st.written))
                    if ContinuousClock.now - st.lastPaint >= Self.paintInterval {
                        paint()
                    } else if !st.paintPending {
                        // the last words of a burst still land a moment later
                        st.paintPending = true
                        Task { @MainActor [weak self] in
                            try? await Task.sleep(for: Self.paintInterval)
                            st.paintPending = false
                            guard let self, !st.ended else { return }
                            let text = ChatView.shownReply(st.written)
                            self.patch(place.key, tutorId) { m in m.text = text; if m.state != .writing { m.state = .streaming } }
                            st.lastPaint = .now
                        }
                    }
                case .reply(let final):
                    st.written = final
                    patch(place.key, tutorId) { m in m.text = ChatView.shownReply(final); if m.state != .writing { m.state = .streaming } }
                    finishSpeech(ChatView.shownReply(final).trimmingCharacters(in: .whitespacesAndNewlines))
                case .actions(let ev):
                    let writes = !ev.actions.isEmpty
                    patch(place.key, tutorId) { m in
                        m.text = ChatView.shownReply(st.written)
                        m.notes = ev.notes
                        if writes { m.state = .writing }
                    }
                    if writes {
                        st.acting = true
                        let board = self.board
                        // written as soon as the engine has passed them: the stream's end is not waited for
                        boardRun = Task { @MainActor in await board.run(ev.actions, onTutorScreen: moveTo) }
                    }
                case .done(let done):
                    turnId = done.turnId
                    userTurnId = done.userTurnId
                case .error(let e):
                    throw e
                }
            }
            // a Stop ends the stream quietly (its iteration just stops): not a finished answer
            if stopRequested || Task.isCancelled { throw CancellationError() }
            st.ended = true
            let shown = ChatView.shownReply(st.written).trimmingCharacters(in: .whitespacesAndNewlines)
            finishSpeech(shown)
            if let boardRun {
                patch(place.key, tutorId) { m in m.text = shown; m.turnId = turnId }
                let report = await boardRun.value
                followAfterRun(report, place: place, moveTo: moveTo)
                patch(place.key, tutorId) { m in
                    m.notes = Self.unique(m.notes + ChatView.runNotes(report))
                    m.state = .done
                    if shown.isEmpty { m.text = AskCopy.done }
                }
                moveSaved()
            } else {
                patch(place.key, tutorId) { m in m.text = shown.isEmpty ? AskCopy.empty : shown; m.state = .done; m.turnId = turnId }
            }
        } catch {
            let aborted = stopRequested || error is CancellationError || Task.isCancelled
            if let boardRun {
                // the board was already writing when the stream ended early: the words stay, the
                // writing finishes, and the ask is done with a short note (never Try again: it would
                // write the problems a second time)
                let shown = ChatView.shownReply(st.written).trimmingCharacters(in: .whitespacesAndNewlines)
                finishSpeech(shown)
                patch(place.key, tutorId) { m in m.text = shown }
                let report = await boardRun.value
                followAfterRun(report, place: place, moveTo: moveTo)
                let cut = aborted || st.ended ? [] : [AskCopy.cutOff]
                patch(place.key, tutorId) { m in
                    m.notes = Self.unique(m.notes + ChatView.runNotes(report) + cut)
                    m.state = .done
                    if shown.isEmpty { m.text = AskCopy.done }
                }
                if !aborted { onFailure?(ChatView.error(for: error), error) }
                moveSaved()
                return
            }
            speech?.stop()
            if aborted {
                patch(place.key, tutorId) { m in
                    m.state = .done
                    m.stopped = true
                    let t = ChatView.shownReply(st.written).trimmingCharacters(in: .whitespacesAndNewlines)
                    m.text = t.isEmpty ? AskCopy.stopped : t
                }
                return
            }
            let chatError = ChatView.error(for: error)
            Self.log.notice("ask: failed (\(chatError.kind.rawValue, privacy: .public)): \(String(describing: error), privacy: .public)")
            patch(place.key, tutorId) { m in
                m.state = .error
                m.error = chatError
                m.text = chatError.message
                m.retryText = chatError.retry ? message : nil
            }
            onFailure?(chatError, error)
        }
    }

    /// After the run: the tutor started a screen this did not hear of as it happened, so the
    /// exchange goes to the screen the board is on now.
    private func followAfterRun(_ report: AskRunReport, place: Where, moveTo: (AskScreenRef) -> Void) {
        guard place.movedTo == nil, report.screensAdded > 0 else { return }
        moveTo(board.screenRef)
    }

    // MARK: - the store

    private func set(_ key: String, _ next: [ChatMessage]) {
        threads[key] = Array(next.suffix(AskLimits.messagesKept))
    }

    private func patch(_ key: String, _ id: String, _ body: (inout ChatMessage) -> Void) {
        guard var list = threads[key], let i = list.firstIndex(where: { $0.id == id }) else { return }
        body(&list[i])
        threads[key] = list
    }

    static func unique(_ notes: [String]) -> [String] {
        var out: [String] = []
        for n in notes where !out.contains(n) { out.append(n) }
        return out
    }

    /// `body`'s value, or nil once `limit` has passed: the picture never holds an ask up.
    static func within<T: Sendable>(_ limit: Duration, _ body: @escaping @Sendable @MainActor () async -> T?) async -> T? {
        await withTaskGroup(of: T?.self) { group in
            group.addTask { await body() }
            group.addTask {
                try? await Task.sleep(for: limit)
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }
}
