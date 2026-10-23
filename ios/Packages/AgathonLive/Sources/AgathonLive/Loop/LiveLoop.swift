import AgathonBoard
import AgathonBrain
import AgathonKit
import Combine
import Foundation
import os

/// The tutor on the board: the web's `LiveLoop` (src/lib/live/liveLoop.ts) in Swift, with the
/// maths in the brain (AgathonBrain: the web's engine, clustering, payloads, the hand).
///
/// What it does, as the web does it:
///
///  1. **Watches the board.** Every kid stroke finished, moved or rubbed out marks its line dirty and
///     restarts two clocks: the per-line **quiet gate** (600 ms; 450 ms for a line read before) and
///     the whole-board **settle** (2.5 s). Nothing is read while the pen is down.
///  2. **Reads the lines.** When the gate runs out, the kid's strokes are clustered into lines and
///     columns by the brain (line ids carried over from the last flush), each new or changed line is
///     normalized into the recognizer payload (its sha-1 is the cache key), and sent to
///     `/api/live/recognize` (2 at a time; a crop with the vision recognizer, or once after
///     `needsCrop`). A read that looks wrong goes to the second reader (`/api/live/reread`).
///     A line that looks finished is read before its gate runs out (`LiveLoop+ReadEarly`: a pause a
///     little longer than the kid's own, on a relation with its right side started, or the Pencil
///     hovering away); the gate takes that read instead of asking again.
///  3. **Judges them.** Each line is analysed by the engine against its column (the last right line
///     above it, the column's first relation, a problem the tutor wrote above it), and the policy
///     (`LivePolicy`) decides by the help mode what the tutor does: a tick, a ring, a "?", a hint,
///     the right next step beside a ring (Suggest, once the kid stops), an answer after the kid's
///     `=` (Solve, once the kid stops), a model check of what the engine cannot judge (Auto, at the
///     pause).
///  4. **Writes in its own hand.** Marks and steps are the tutor's strokes (AgathonBoard's
///     `TutorWriter`, at handwriting pace; origin `.tutor`, never undone by the kid). Lines and
///     problems are written as `line` / `problem` records, marks as `mark` records.
///  5. **Answers when asked.** Help me (by the dial: a hint card, the next step, the whole solution)
///     and Solve it, on the line picked or written last: the engine first (`localSolve`), a word
///     problem's setup (`/api/live/setup`), else the model's worked solution (`/api/live/solve`),
///     each step checked by the engine before it is drawn.
///  6. **Copes.** Offline: lines wait and are read when the network is back. Out of ink: help is
///     paused (kids see "Ask a grown-up", never prices). Rate limited: it backs off. New ink on a
///     line cancels everything still in flight for it.
@MainActor
public final class LiveLoop: ObservableObject {
    static let log = Logger(subsystem: "app.agathon.Agathon", category: "live")

    // MARK: dependencies

    public let board: LiveBoard
    public let boardId: String
    let services: LiveServices
    /// The loop's brain: analysis, clustering, payloads, the hand. Calls are short.
    let brain: Brain
    /// The brain for slow searches ("Now you try"'s variant), so they never hold up a read.
    let background: Brain
    let scheduler: LiveScheduler
    let connectivity: LiveConnectivity

    // MARK: what the screens show

    /// The grown-ups' settings (the dial, Auto, the hand). Saved per board.
    @Published public var settings: LiveSettings {
        didSet { if settings != oldValue { settingsChanged(from: oldValue) } }
    }
    /// What the status pill says.
    @Published public internal(set) var activity: LiveActivity = .idle
    /// Lines waiting for the network.
    @Published public internal(set) var offlineWaiting = 0
    /// The hint card open beside a line (one at a time).
    @Published public internal(set) var hints: [HintCard] = []
    /// Cheers showing beside marks.
    @Published public internal(set) var cheers: [Cheer] = []
    /// "Now you try one", when there is one to offer.
    @Published public internal(set) var offer: NowYouTryOffer?
    /// Lines just read, shown for a moment.
    @Published public internal(set) var readbacks: [Readback] = []
    /// A quiet word for the kid that is no error ("Write a step first, then tap Help me.").
    @Published public internal(set) var note: String?
    /// The lines as the loop holds them (the Lab's list; the board does not need it).
    @Published public internal(set) var lines: [String: LiveLine] = [:]
    /// Latencies, for the Lab and the logs.
    @Published public internal(set) var metrics = LiveMetrics()
    /// A celebration's big burst (a counter: each change fires the burst once).
    @Published public internal(set) var bigBurst = 0
    /// "Graph it" chips beside function lines just read (`LiveLoop+Graph`).
    @Published public internal(set) var graphOffers: [GraphOffer] = []
    /// Problem pages, check when done and "I read" (`LiveLoop+Check`, `+Pages`, `+Fix`;
    /// docs/PROBLEM-PAGES.md): what the board shows for them, and what the loop remembers.
    public let pages = LivePages()

    // MARK: the learning record

    /// The student's attempts on this board, recorded and saved as the web records them
    /// (`LiveLearning`; `LiveLoop+Learning` says what the loop tells it).
    public let learning: LiveLearning
    /// what the record was told this session (`LiveLoop+Learning`)
    var learn = LearnState()

    // MARK: lifecycle state

    var started = false
    /// A loop on another page of the problem on show ("More room", `LiveLoop+MoreRoom`): it judges
    /// that page where it is and writes its marks there, and nothing else — no capabilities call, no
    /// learning of its own (the board's loop tells the record), no Now you try, no settings saved.
    var passive = false
    /// bumped by every reset (a screen left, the loop stopped): work begun before it is dropped
    var generation = 0
    var engineReady = false
    /// mathpix or vision (`/api/live/recognize` GET)
    var recognizer = "mathpix"
    var subscription: StoreSubscription?
    var screenSeen: RecordID = ""

    // MARK: clocks

    var quietTimer: LiveTimer?
    var settleTimer: LiveTimer?
    /// "check as I go": lines whose marks wait for them to look finished (`stillGrowing`)
    var growthTimers: [String: LiveTimer] = [:]
    /// how long a line must go without a new stroke before a ring or a "?" (`PageTiming.doubtHoldMs`;
    /// the real-ink bench sets 0 to measure the tutor without it)
    var doubtHoldMs = PageTiming.doubtHoldMs
    var stuckTimer: LiveTimer?
    var helpWaitTimer: LiveTimer?
    var readingLabelTimer: LiveTimer?
    /// the kid has stopped writing (the settle ran out)
    var settled = false
    var penDown = false
    /// when the kid's last stroke landed (pen-up → tick latency)
    var lastPenUpAt: [String: Double] = [:]

    // MARK: ink → lines

    var dirtyStrokes = Set<String>()
    var pendingRewrite = false
    var forceRecognize = Set<String>()
    var diagrams: [Diagram] = []
    /// the stacked sums in the ink (`clusterStrokes`' `stacks`), and where a stacked line's marks go
    /// (`LiveLoop+Stacks`)
    var stacks: [AgathonBrain.JSONValue] = []
    var stackMarks: [String: (tick: BrainRect?, ring: BrainRect?)] = [:]
    /// division bars' strokes (`clusterStrokes`' `bars`): a number under one is "divide both sides"
    var barStrokeIds = Set<String>()
    /// the lines that were one problem (one column) at the last flush: they stay one (the web's
    /// `problemMates`)
    var problemMates: [String: Set<String>] = [:]
    /// lines crossed out, by ink version (`LiveLoop+Chain`)
    var struckCache: [String: Bool] = [:]
    /// rings waiting for a second look: the step's line id → its pair of inks; a pair done is drawn at
    /// once from then on (`LiveLoop+Chain`, the web's `chainHolds` / `chainsDone`)
    var chainHolds: [String: String] = [:]
    var chainsDone = Set<String>()
    /// right answers read unsure, looked at once more (by ink hash): nil while the look is out, then its verdict
    var unsureAnswerLooks: [String: Bool?] = [:]
    var flushing = false
    var flushAgain = false
    /// per line: tickets, in-flight work, its mark
    var rt: [String: LineRuntime] = [:]
    /// lines being read (the recognizer or the second reader): nothing to say about them yet
    var reading = Set<String>()
    /// recognitions in flight (the limiter's slots)
    var readsInFlight = 0
    var readWaiters: [CheckedContinuation<Void, Never>] = []
    /// recognitions by payload hash (the web's 500-entry cache)
    var cache = LRUCache<String, RecognizeResponse>(capacity: LiveLimits.cacheEntries)
    /// the second reader per ink version: nil inside = asked and Mathpix stands; a string = taken
    var rereads: [String: String?] = [:]
    /// analyses by line and context (the engine is deterministic)
    var analysisCache = LRUCache<String, LineAnalysis>(capacity: 2_000)
    var analyzing = Set<Int>()
    var analyzeAgain = Set<Int>()

    // MARK: reading early (LiveLoop+ReadEarly)

    /// Start reading a line before its quiet gate runs out when it looks finished (or the Pencil
    /// hovers away from it); the gate stays as the fallback. On by default.
    public var readsEarly = true
    /// the kid's rhythm at the pen: the line being written, their pauses inside a line
    var rhythm = PenRhythm()
    /// a fixed wait before an early read instead of the kid's rhythm (the timing bench)
    var earlyDelayOverride: Double?
    /// bumped by every change to the kid's ink on the screen
    var inkSeq = 0
    /// the kid's last fresh stroke and the ink version it landed at: what an early read is about
    var earlyStroke: (id: String, seq: Int)?
    var earlyTimer: LiveTimer?
    /// early reads in flight, by payload hash
    var earlyReads: [String: EarlyRead] = [:]
    /// payloads an early read put in the cache that no line has used yet
    var earlyUnused = Set<String>()
    /// early reads that failed (not stopped): the gate's read of that ink takes the same error
    var earlyFailures: [String: Error] = [:]
    /// when the loop last called the server (ms): a long quiet warms the road before the next read
    var lastCallAt = -Double.infinity

    // MARK: hint words on the iPad (HintWording)

    /// Writes a ringed step's hint on the iPad (Apple Intelligence) instead of asking the server's
    /// check; nil (the default) asks the server. `start()` sets it when the owner's debug switch is on.
    public var hintWriter: HintWriter?

    // MARK: network

    var offlineQueue = Set<String>()
    var offlineReplayTimer: LiveTimer?
    var offlineReplayStep = 0
    var lastOnline = true
    /// checks and a solve the kid asked for while offline: run once the network is back
    var pendingChecks: [String: Bool] = [:]
    var pendingSolve: String?
    /// out of ink: help is paused
    var inkOut = false
    /// rate limited until (scheduler ms), and whether that is the day's fair-use cap
    var slowUntil = 0.0
    var slowFairUse = false
    var slowTimer: LiveTimer?
    var signedOut = false
    /// the failed call the pill's Retry runs again
    var lastFailure: (failure: LiveFailure, retry: RetryContext?)?
    var checking = 0
    var solving = 0

    // MARK: help

    var pendingSuggestions = Set<String>()
    /// the tutor's writing block in flight (a solution, an answer), and the line it is for
    var writer: TutorPen?
    var writerFor: String?
    /// Auto: what it already did, per state of the problem
    var autoDone = Set<String>()
    /// lines Auto started work on: their failures stay quiet
    var autoLines = Set<String>()
    var askedSinceInk = false
    /// Auto off: the lines of problems the kid asked about, as they read then
    var askedLines: [String: String] = [:]
    /// the kid's last fresh pen stroke on this screen, and its line: where Help acts
    var penStrokeId: String?
    var penLineId: String?
    var lastTouchedLineId: String?
    /// problems the tutor wrote, heading the columns under them (`problem` records)
    var heads: [ProblemHead] = []
    /// which problem heads which column (`anchorAtProblems`)
    var columnHeads: [Int: RecordID] = [:]

    // MARK: celebrations, practice

    var celebrate = CelebrateState()
    lazy var settler = MarkSettler(scheduler: scheduler) { [weak self] id, kind in self?.verdictLanded(id, kind) }
    var cheerSeq = 0
    var tracker = ProblemTracker()
    var offeredFor = Set<String>()
    var readbackTimers: [String: LiveTimer] = [:]
    var noteTimer: LiveTimer?
    /// the reading of each line a graph was offered for (once per reading), and the offers' clocks
    var graphOffered: [String: String] = [:]
    var graphOfferTimers: [String: LiveTimer] = [:]

    // MARK: tasks (for `waitUntilIdle`)

    var tasks: [UUID: Task<Void, Never>] = [:]

    /// - Parameters:
    ///   - board: the board (the app's `CanvasLiveBoard`)
    ///   - services: the Live routes (`LiveAPIServices(backend:)`)
    ///   - brain: the loop's brain (default the app's shared one)
    ///   - background: the brain for slow searches (default a second one, loaded when first needed)
    public init(board: LiveBoard, boardId: String, services: LiveServices, settings: LiveSettings? = nil,
                brain: Brain = .shared, background: Brain? = nil,
                scheduler: LiveScheduler? = nil, connectivity: LiveConnectivity? = nil) {
        self.board = board
        self.boardId = boardId
        self.services = services
        self.brain = brain
        self.background = background ?? LiveLoop.backgroundBrain
        let clock = scheduler ?? MainScheduler()
        self.scheduler = clock
        self.connectivity = connectivity ?? NetworkConnectivity()
        learning = LiveLearning(boardId: boardId, brain: brain, scheduler: clock)
        self.settings = settings ?? LiveSettings.load(boardId: boardId)
    }

    /// The app's second brain, for "Now you try" (one JavaScriptCore context of its own).
    public static let backgroundBrain = Brain()

    // MARK: - lifecycle

    /// Starts watching the board: the lines on the current screen come back from their records (no
    /// re-reading), the engine loads, the recognizer is asked which reader is in use.
    public func start() {
        guard !started else { return }
        started = true
        board.onPen = { [weak self] down in self?.pen(down) }
        board.onHover = { [weak self] at in self?.penHover(at) }
        board.onScreenChange = { [weak self] _ in self?.switchScreen() }
        connectivity.onChange = { [weak self] online in self?.setOnline(online) }
        lastOnline = connectivity.isOnline
        subscription = board.store.observe { [weak self] change in self?.storeChanged(change) }
        screenSeen = board.currentScreenID
        if !passive && hintWriter == nil && HintWording.debugEnabled { hintWriter = HintWording.onDevice() }
        if !passive && LivePages.secondOpinionDebug { pages.secondOpinion = true }
        // the learning record: the signed-in student's, when the services know the backend
        if !passive, learning.connectsAutomatically, learning.recorder == nil, let backend = (services as? LiveAPIServices)?.backend {
            learning.connect(backend: backend)
        }
        track { [weak self] in
            guard let self else { return }
            do {
                try await self.brain.load()
                self.engineReady = true
                self.rebuild()
            } catch {
                Self.log.error("live: the brain did not load: \(String(describing: error), privacy: .public)")
            }
        }
        if !passive { fetchCapabilities() }
        refreshActivity()
    }

    /// Stops: timers, calls in flight and the tutor's pens (lines begun are finished).
    public func stop() {
        guard started else { return }
        started = false
        subscription?.cancel()
        subscription = nil
        board.onPen = nil
        board.onHover = nil
        board.onScreenChange = nil
        connectivity.onChange = nil
        resetRuntime()
        for t in tasks.values { t.cancel() }
        tasks.removeAll()
        // (a loop on another page of the problem saves nothing and closes nothing of the board's)
        guard !passive else { return }
        settings.save(boardId: boardId)
        // the board is closed: the problems on it are over, and saved, as far as the record goes
        learnClosed()
    }

    /// Waits until every piece of work the loop started (reads, analyses, checks, solves) is done.
    /// Tests and the Lab; the board never needs it.
    public func waitUntilIdle(timeout: Duration = .seconds(60)) async {
        let deadline = ContinuousClock.now + timeout
        while !tasks.isEmpty && ContinuousClock.now < deadline {
            try? await Task.sleep(for: .milliseconds(1))
        }
    }

    /// Work in flight (reads, analyses, model calls): the Lab's "is it busy" and the tests.
    public var busy: Bool { !tasks.isEmpty }

    /// Runs `op` as tracked work.
    func track(_ op: @escaping @MainActor () async -> Void) {
        let id = UUID()
        let task = Task { @MainActor [weak self] in
            await op()
            self?.tasks[id] = nil
        }
        if tasks[id] == nil && !task.isCancelled { tasks[id] = task }
    }

    func fetchCapabilities() {
        track { [weak self] in
            guard let self else { return }
            do {
                let caps = try await self.services.capabilities()
                self.recognizer = caps.recognizer
            } catch {
                // the reads say what is wrong, if anything; the recognizer stays Mathpix
                Self.log.notice("live: capabilities failed: \(String(describing: error), privacy: .public)")
            }
        }
    }

    /// Everything that belongs to the ink on the screen: timers, calls, per-line state.
    func resetRuntime() {
        generation += 1
        for t in [quietTimer, settleTimer, stuckTimer, helpWaitTimer, readingLabelTimer, offlineReplayTimer] { t?.cancel() }
        quietTimer = nil
        settleTimer = nil
        stuckTimer = nil
        helpWaitTimer = nil
        readingLabelTimer = nil
        offlineReplayTimer = nil
        settled = false
        cancelHandwriting()
        dropEarlyReads()
        // problem pages: what the loop remembered of the page left (its records keep what matters)
        pages.reset()
        for r in rt.values {
            r.checkTask?.cancel()
            r.solveTask?.cancel()
            r.markPen?.cancel()
            r.stepPen?.cancel()
            r.unreadableTimer?.cancel()
            r.readRetryTimer?.cancel()
        }
        rt.removeAll()
        for t in readbackTimers.values { t.cancel() }
        readbackTimers.removeAll()
        readbacks = []
        withdrawGraphOffers()
        graphOffered.removeAll()
        hints = []
        settler.reset()
        reading.removeAll()
        dirtyStrokes.removeAll()
        forceRecognize.removeAll()
        offlineQueue.removeAll()
        offlineWaiting = 0
        offlineReplayStep = 0
        pendingChecks.removeAll()
        pendingSolve = nil
        pendingSuggestions.removeAll()
        autoLines.removeAll()
        askedLines.removeAll()
        askedSinceInk = false
        penStrokeId = nil
        penLineId = nil
        lastTouchedLineId = nil
        diagrams = []
        stacks = []
        stackMarks = [:]
        barStrokeIds = []
        problemMates = [:]
        struckCache = [:]
        chainHolds = [:]
        chainsDone = []
        heads = []
        columnHeads = [:]
        lines = [:]
        checking = 0
        solving = 0
        lastFailure = nil
        refreshActivity()
    }

    /// The kid moved to another screen: the loop forgets the one left and takes this one in from
    /// its records (no re-reading, no model call).
    func switchScreen() {
        guard started, board.currentScreenID != screenSeen else { return }
        // (another page of the same problem: the kid's last ink there still counts for the pause)
        let from = screenSeen, lastInk = pages.lastInkAt
        resetRuntime()
        screenSeen = board.currentScreenID
        // the learning record: the problems on the screen the student left are over (for now)
        learnScreen()
        offer = nil
        rebuild()
        arrived(from: from, lastInk: lastInk)
    }

    // MARK: - settings

    func settingsChanged(from old: LiveSettings) {
        settings.save(boardId: boardId)
        guard started else { return }
        if old.checking != settings.checking {
            // into "when they're done": what is marked now stays (checked at its reading)
            if settings.checking == .whenDone {
                for st in lines.values where !st.latex.isEmpty && pages.released[st.id] == nil { pages.released[st.id] = st.latex }
            }
            reanalyzeAll()
        }
        if old.showReadings != settings.showReadings || old.checking != settings.checking { refreshPage() }
        if !settings.enabled || settings.mode == .off { withdrawGraphOffers() }
        if old.enabled != settings.enabled {
            if !settings.enabled {
                for r in rt.values {
                    r.checkTask?.cancel()
                    r.solveTask?.cancel()
                }
                cancelHandwriting()
            } else {
                // back on: what was written meanwhile is read now
                for l in lines.values where l.latex.isEmpty { l.ink.strokeIds.forEach { dirtyStrokes.insert($0) } }
                armQuietTimer()
            }
        }
        if old.answerOnEquals != settings.answerOnEquals && old.mode == settings.mode { reanalyzeAll() }
        if old.mode != settings.mode {
            cancelHandwriting()
            hints = []
            reanalyzeAll()
            if (settings.mode == .suggest || settings.mode == .answer) && !(old.mode == .suggest || old.mode == .answer) {
                checkMismatchesAfterLadderRise()
            }
        }
        if old.auto != settings.auto {
            if !settings.auto { autoInk() } else { reanalyzeAll() }
        }
        if settings.enabled && (old.mode != settings.mode || old.auto != settings.auto) && settleTimer == nil {
            // the kid is not writing: Auto picks up as if they had paused in this mode
            autoPause(stopped: true)
            armStuck()
        }
        refreshActivity()
    }

    // MARK: - the status pill

    func refreshActivity() {
        let now = scheduler.now
        let next: LiveActivity
        if !settings.enabled {
            next = .paused
        } else if signedOut {
            next = .signedOut
        } else if inkOut {
            next = .outOfInk
        } else if slowUntil > now {
            next = .slowDown(until: slowUntil, fairUse: slowFairUse)
        } else if !connectivity.isOnline || !offlineQueue.isEmpty {
            next = .offline(waiting: offlineQueue.count)
        } else if let f = lastFailure {
            next = .trouble(retry: f.retry != nil)
        } else if solving > 0 {
            next = .solving
        } else if checking > 0 {
            next = .checking
        } else if readingLabelShown {
            next = .reading
        } else {
            next = .idle
        }
        if next != activity { activity = next }
        if offlineWaiting != offlineQueue.count { offlineWaiting = offlineQueue.count }
    }

    /// "Reading…" shows only once a read has taken longer than `readingLabelDelayMs`.
    var readingLabelShown = false {
        didSet { if oldValue != readingLabelShown { refreshActivity() } }
    }

    /// A quiet word for the kid (not an error): shown a few seconds.
    func say(_ text: String) {
        note = text
        noteTimer?.cancel()
        noteTimer = scheduler.after(3_500) { [weak self] in self?.note = nil }
    }

    public func dismissNote() {
        note = nil
    }
}

/// Per-line state the screens never see (the web's `LineRuntime`).
struct LineRuntime {
    /// bumped by each new read of the line: a reply for an older one is dropped
    var processing = 0
    var checkTask: Task<Void, Never>?
    var solveTask: Task<Void, Never>?
    var unreadableShown = false
    var unreadableTimer: LiveTimer?
    var readRefused = false
    var readRetriedHash: String?
    var readRetryTimer: LiveTimer?
    /// the mark wanted on the line (its key); `markDecided` false until the first render
    var markKey: String?
    var markDecided = false
    /// its ring or tick came off because new ink looked like more of it (`unringGrowingLine`): its
    /// strokes then and the mark, so the next flush can tell whether that ink really joined it
    var unrungStrokes: [String]?
    var unrungKind: LiveMarks.Kind?
    var markPen: TutorPen?
    var markBusySince = 0.0
    var afterMark: [() -> Void] = []
    /// the right next step being written beside it, for which read
    var stepPen: TutorPen?
    var stepFor: String?
    var escalation = 0
    var shownHints = Set<String>()
}

/// What Retry runs again.
enum RetryContext: Equatable {
    case recognize(lineId: String)
    case check(lineId: String, userAsked: Bool, forceHint: Bool)
    case solve(lineId: String, onlyFirstStep: Bool)
}

/// A problem the tutor wrote ("Now you try"), heading the column of the kid's work under it.
struct ProblemHead: Equatable {
    var id: RecordID
    var lines: [String]
    var rect: BrainRect
    var analyses: [LineAnalysis?] = []
    /// a chat problem's grid cell: the kid's lines whose middle is in it are its work (the web's `cellOf`)
    var cell: BrainRect?
}

/// The latencies the Lab shows and the logs keep (ms).
public struct LiveMetrics: Equatable, Sendable {
    /// the kid's pen lifted → the tutor's tick or ring starts, per mark
    public var penUpToMark: [Double] = []
    /// by the line's last stroke (its id): its pen-up → the line's read in, and → its mark (ms)
    public var readAfterPenUp: [String: Double] = [:]
    public var markAfterPenUp: [String: Double] = [:]
    /// `/api/live/recognize` round trips (cache misses)
    public var recognize: [Double] = []
    /// reads answered from the cache
    public var cacheHits = 0
    /// reads started before the quiet gate ran out (each is one of `calls["recognize"]`)
    public var readsEarly = 0
    /// …of which a line used (the gate's read, or the early flush, took it)
    public var readsEarlyUsed = 0
    /// …of which were stopped because the kid wrote on in that line
    public var readsEarlyCancelled = 0
    /// early reads that let the gate finish before its time
    public var earlyFlushes = 0
    /// Solve asked → the tutor's first stroke of the steps
    public var solveFirstStep: [Double] = []
    /// Help me → a hint card worded on the iPad (`HintWording`)
    public var deviceHint: [Double] = []
    /// hint words the iPad wrote that failed `HintWording.accept` (the server worded those)
    public var deviceHintRefused = 0
    /// `/api/live/check` asked → its first annotation
    public var checkFirstAnnotation: [Double] = []
    public var calls: [String: Int] = [:]

    public static func median(_ xs: [Double]) -> Double? {
        guard !xs.isEmpty else { return nil }
        let s = xs.sorted()
        return s.count % 2 == 1 ? s[s.count / 2] : (s[s.count / 2 - 1] + s[s.count / 2]) / 2
    }
}

/// A small least-recently-used cache.
struct LRUCache<Key: Hashable, Value> {
    private var values: [Key: Value] = [:]
    private var order: [Key] = []
    let capacity: Int

    init(capacity: Int) {
        self.capacity = capacity
    }

    var count: Int { values.count }

    subscript(key: Key) -> Value? {
        mutating get {
            guard let v = values[key] else { return nil }
            if let i = order.firstIndex(of: key) { order.remove(at: i) }
            order.append(key)
            return v
        }
        set {
            if let i = order.firstIndex(of: key) { order.remove(at: i) }
            guard let newValue else {
                values[key] = nil
                return
            }
            values[key] = newValue
            order.append(key)
            while order.count > capacity { values[order.removeFirst()] = nil }
        }
    }

    func peek(_ key: Key) -> Value? { values[key] }
}
