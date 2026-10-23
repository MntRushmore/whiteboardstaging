import AgathonBoard
import AgathonKit
import CoreGraphics
import Foundation

/// The picture tutor on one board (Reed Grenager's Nov 2025 hackathon system, sped up): after the
/// kid pauses, a picture of what they can see of the page goes to `/api/board/draw`, and the tutor's
/// picture comes back to lay over it, drawn on by the tutor's cobalt pen.
///
///     idle ──pen lifts, a change──▶ waiting ──0.8 s quiet──▶ reading ──▶ drawing ──▶ shown (Feedback)
///       ▲                              │                       │            │      └▶ ghost (Suggest, Solve)
///       └──────── a new stroke, erase or undo cancels from any of them ─────┘           │ accept / reject
///
/// - Only one run at a time; "Draw now" (source `voice`) always draws and takes over a run in flight.
/// - A capture identical to the last one sent is not sent again (auto only).
/// - A new result replaces a ghost nobody decided on (and Feedback that was showing).
/// - Nothing on screen says words: the pen is the indicator (`PictureTutorOverlay`). A failure is
///   logged; when the grown-up pressed Draw now, its button shakes once.
///
/// The board is reached through `Deps` (the capture, the server, the clock), so the tests drive it
/// with fakes; `PictureTutorBoard` wires it to the real board.
@MainActor
final class PictureTutor: ObservableObject {
    enum Stage: Equatable {
        case reading, drawing
    }

    enum Phase: Equatable {
        case idle
        /// the quiet after the pen lifted
        case waiting
        /// a run in flight
        case working(Stage)
    }

    /// The run in flight: what was sent (the pen thinks in its blank space).
    struct Work: Equatable {
        var id: String
        var capture: PictureCaptureInfo
        var mode: PictureTutorMode
        var source: BoardDrawSource
        var startedAt: Date
    }

    /// The tutor's picture over the board.
    struct Shown: Identifiable, Equatable {
        enum State: Equatable {
            /// being drawn on (the reveal), then a ghost or shown
            case revealing
            /// Suggest / Solve: 30 %, Accept / Reject
            case ghost
            /// Feedback, or a ghost accepted while its picture is saved
            case shown
            case accepting
        }

        let id: String
        var runId: String?
        var logId: String
        var mode: PictureTutorMode
        var screen: RecordID
        /// R: where it was captured, where it goes (page units)
        var region: Box
        var overlay: CGImage
        var png: Data
        var strokes: [BoardDrawStroke]
        var state: State
        var revealStarted: Date
        var revealDuration: Double

        var pixelSize: CGSize { CGSize(width: overlay.width, height: overlay.height) }
        var opacity: Double { mode.isGhost && state != .accepting ? PictureReveal.ghostOpacity : 1 }

        static func == (a: Shown, b: Shown) -> Bool {
            a.id == b.id && a.state == b.state && a.runId == b.runId
        }
    }

    /// Where the pen goes when it leaves (its last place is the overlay's to know).
    struct PenExit: Equatable {
        var id = UUID()
        var at: Date
    }

    /// What the board gives the tutor. Tests pass fakes.
    struct Deps {
        /// A picture of R; nil when there's nothing of the kid's to send.
        var capture: @MainActor () async -> PictureCapture?
        var draw: (BoardDrawRequest) -> AsyncThrowingStream<BoardDrawEvent, Error>
        var report: (String, BoardDrawOutcome) async -> Void
        /// Saves an accepted picture as a locked image on the board; false when it couldn't.
        var accept: @MainActor (Shown) async -> Bool
        var schedule: (Double, @escaping @MainActor () -> Void) -> PictureTimer
        var now: () -> Date = { Date() }
        var reduceMotion: () -> Bool = { false }
    }

    // MARK: what the board shows

    @Published private(set) var phase: Phase = .idle
    @Published var mode: PictureTutorMode {
        didSet { if mode != oldValue { modeChanged() } }
    }
    @Published private(set) var work: Work?
    @Published private(set) var shown: Shown?
    @Published private(set) var penExit: PenExit?
    /// Bumped when a Draw now failed: its button shakes once.
    @Published private(set) var drawNowShake = 0

    let boardId: String?
    let log: PictureTutorLog
    private let deps: Deps
    private var timer: PictureTimer?
    private var revealTimer: PictureTimer?
    private var runTask: Task<Void, Never>?
    /// bumped by every new run and every cancel: a late event of an older run is dropped
    private var runSeq = 0
    private var runId: String?
    private(set) var lastSentHash: String?
    private(set) var penDown = false
    private var stopped = false

    init(mode: PictureTutorMode, boardId: String?, deps: Deps, log: PictureTutorLog? = nil) {
        self.mode = mode
        self.boardId = boardId
        self.deps = deps
        self.log = log ?? .shared
    }

    // MARK: - the kid at the board

    /// The kid changed the board (a stroke, an erase, an undo, a move): whatever was in flight is
    /// cancelled and the quiet starts again.
    func noteEdit() {
        guard !stopped else { return }
        cancelRun()
        arm()
    }

    /// The pen (or a finger) on the board, or off it. Down holds the quiet; up starts it again if it
    /// was waiting (a change made with it says so itself).
    func notePen(_ down: Bool) {
        penDown = down
        guard !stopped, mode != .off else { return }
        if down {
            timer?.cancel()
            timer = nil
        } else if phase == .waiting {
            arm()
        }
    }

    /// The board moved to another page: the run and the tutor's picture belong to the one left.
    func screenChanged() {
        cancelRun()
        dropShown(outcome: .cancelled)
        timer?.cancel()
        timer = nil
        phase = .idle
    }

    /// "Draw now": captures at once and always draws (no hash check), taking over any run.
    func drawNow() {
        guard !stopped else { return }
        timer?.cancel()
        timer = nil
        Task { await run(.voice) }
    }

    func stop() {
        cancelRun()
        dropShown(outcome: .cancelled)
        timer?.cancel()
        revealTimer?.cancel()
        stopped = true
        phase = .idle
    }

    private func modeChanged() {
        cancelRun()
        if mode == .off {
            timer?.cancel()
            timer = nil
            phase = .idle
        }
    }

    private func arm() {
        timer?.cancel()
        timer = nil
        guard mode != .off else {
            phase = .idle
            return
        }
        phase = .waiting
        timer = deps.schedule(PictureTutorSettings.quietDelay) { [weak self] in
            guard let self else { return }
            self.timer = nil
            // still writing: the pen's lift arms it again
            guard !self.penDown, self.phase == .waiting else { return }
            Task { await self.run(.auto) }
        }
    }

    // MARK: - a run

    func run(_ source: BoardDrawSource) async {
        guard !stopped, let api = mode.api else {
            if phase == .waiting { phase = .idle }
            return
        }
        let seqAtCapture = runSeq
        guard let capture = await deps.capture() else {
            if phase == .waiting { phase = .idle }
            if source == .voice { drawNowShake += 1 }
            return
        }
        // the kid wrote again while the picture was taken (a cancel bumped the sequence)
        guard source == .voice || seqAtCapture == runSeq, !stopped else { return }
        if source == .auto && capture.hash == lastSentHash {
            PictureTutorLog.os.debug("picture tutor: the same picture as last time, not sent")
            phase = .idle
            return
        }
        cancelRun()
        lastSentHash = capture.hash
        runSeq += 1
        let seq = runSeq
        let logId = UUID().uuidString.lowercased()
        let started = deps.now()
        work = Work(id: logId, capture: PictureCaptureInfo(capture), mode: mode, source: source, startedAt: started)
        penExit = nil
        phase = .working(.reading)
        log.add(PictureTutorRun(id: logId, at: started, mode: mode, source: source.rawValue, outcome: .running))
        let request = BoardDrawRequest(png: capture.png, mode: api, source: source, boardId: boardId, clientRunId: logId)
        let stream = deps.draw(request)
        let mode = self.mode
        runTask = Task { [weak self] in
            do {
                for try await event in stream {
                    guard let self, seq == self.runSeq else { return }
                    await self.handle(event, mode: mode, source: source, capture: capture, logId: logId, started: started)
                    if event.isTerminal { return }
                }
            } catch is CancellationError {
                return
            } catch {
                guard let self, seq == self.runSeq else { return }
                self.failed(String(describing: error), source: source, logId: logId, started: started)
            }
        }
    }

    private func elapsed(_ started: Date) -> Double { deps.now().timeIntervalSince(started) * 1000 }

    private func handle(_ event: BoardDrawEvent, mode: PictureTutorMode, source: BoardDrawSource, capture: PictureCapture,
                        logId: String, started: Date) async {
        switch event {
        case .status(.reading, let id, _):
            if let id { runId = id }
            phase = .working(.reading)
            let ms = elapsed(started)
            log.update(logId) { $0.readingMs = ms; $0.runId = id ?? $0.runId }
        case .status(.drawing, let id, _):
            if let id { runId = id }
            phase = .working(.drawing)
            let ms = elapsed(started)
            log.update(logId) { $0.drawingMs = ms }
        case .none(let reason):
            let ms = elapsed(started)
            log.update(logId) { $0.endMs = ms; $0.outcome = .none; $0.note = reason }
            // nothing to add: the pen lifts away; Feedback from before is old now
            if shown?.mode == .feedback { dropShown(outcome: nil) }
            finishRun()
        case .done(let result):
            let ms = elapsed(started)
            guard let overlay = PictureTutorCapture.decode(result.overlay) else {
                failed("the overlay isn't a picture", source: source, logId: logId, started: started)
                return
            }
            if overlay.width != capture.image.width || overlay.height != capture.image.height {
                PictureTutorLog.os.notice("picture tutor: overlay \(overlay.width)x\(overlay.height) for a \(capture.image.width)x\(capture.image.height) capture; stretched over R")
            }
            log.update(logId) {
                $0.endMs = ms
                $0.timings = result.timings
                $0.costUsd = result.costUsd
                $0.outcome = mode.isGhost ? .ghost : .shown
                $0.note = result.instructions
            }
            // a ghost nobody decided on, or Feedback from before: this one replaces it
            dropShown(outcome: .cancelled, logOutcome: .replaced)
            let runId = self.runId
            let duration = PictureReveal.duration(result.strokes, reduceMotion: deps.reduceMotion())
            let now = deps.now()
            shown = Shown(id: logId, runId: runId, logId: logId, mode: mode, screen: capture.screen, region: capture.region,
                          overlay: overlay, png: result.overlay, strokes: result.strokes, state: duration > 0 ? .revealing : (mode.isGhost ? .ghost : .shown),
                          revealStarted: now, revealDuration: duration)
            finishRun(leaving: false)
            if duration > 0 {
                revealTimer?.cancel()
                revealTimer = deps.schedule(duration) { [weak self] in self?.revealFinished(logId) }
            } else {
                revealFinished(logId)
            }
            if !mode.isGhost, let runId { await deps.report(runId, .shown) }
        case .error(let message, let retryable):
            failed("\(message)\(retryable ? " (retryable)" : "")", source: source, logId: logId, started: started)
        }
    }

    private var exitTimer: PictureTimer?

    /// The pen lifts away and fades (the overlay draws it; cleared once it's gone, so nothing runs).
    private func penLeaves() {
        let exit = PenExit(at: deps.now())
        penExit = exit
        exitTimer?.cancel()
        exitTimer = deps.schedule(PictureTutorPen.exitSeconds + 0.15) { [weak self] in
            if self?.penExit?.id == exit.id { self?.penExit = nil }
        }
    }

    private func revealFinished(_ id: String) {
        guard var s = shown, s.id == id, s.state == .revealing else { return }
        s.state = s.mode.isGhost ? .ghost : .shown
        shown = s
        // the pen has drawn it: it leaves now
        penLeaves()
    }

    private func failed(_ why: String, source: BoardDrawSource, logId: String, started: Date) {
        PictureTutorLog.os.error("picture tutor: run failed: \(why, privacy: .public)")
        let ms = elapsed(started)
        log.update(logId) { $0.endMs = ms; $0.outcome = .error; $0.note = String(why.prefix(200)) }
        if source == .voice { drawNowShake += 1 }
        finishRun()
    }

    /// The run is over: the pen lifts away (unless it stays to draw the result on).
    private func finishRun(leaving: Bool = true) {
        runTask = nil
        runId = nil
        work = nil
        if leaving { penLeaves() }
        if case .working = phase { phase = .idle }
    }

    /// Stops the run in flight (its request is cancelled) and tells the server.
    private func cancelRun() {
        runSeq += 1
        guard let task = runTask else { return }
        task.cancel()
        runTask = nil
        if let w = work {
            let ms = elapsed(w.startedAt)
            log.update(w.id) { $0.endMs = ms; $0.outcome = .cancelled }
        }
        if let id = runId {
            let report = deps.report
            Task { await report(id, .cancelled) }
        }
        runId = nil
        work = nil
        penLeaves()
        if case .working = phase { phase = .idle }
    }

    // MARK: - the picture

    func accept() {
        guard let s = shown, s.state == .ghost || s.state == .revealing else { return }
        var accepting = s
        accepting.state = .accepting
        shown = accepting
        log.update(s.logId) { $0.outcome = .accepted }
        let deps = self.deps
        Task { [weak self] in
            if let runId = s.runId { await deps.report(runId, .accepted) }
            let saved = await deps.accept(accepting)
            guard let self, self.shown?.id == s.id else { return }
            if saved {
                // it's on the board now, as a locked picture
                self.shown = nil
            } else {
                PictureTutorLog.os.error("picture tutor: the accepted picture couldn't be saved")
                var back = accepting
                back.state = .ghost
                self.shown = back
            }
        }
    }

    func reject() {
        dropShown(outcome: .rejected, logOutcome: .rejected)
    }

    /// Takes the tutor's picture off the board (a ghost undecided is reported as `outcome`).
    private func dropShown(outcome: BoardDrawOutcome?, logOutcome: PictureTutorRun.Outcome? = nil) {
        guard let s = shown else { return }
        shown = nil
        revealTimer?.cancel()
        revealTimer = nil
        guard s.mode.isGhost, s.state != .accepting else { return }
        if let logOutcome { log.update(s.logId) { $0.outcome = logOutcome } }
        if let outcome, let id = s.runId {
            let report = deps.report
            Task { await report(id, outcome) }
        }
    }
}

/// What the overlay needs of a capture (the picture stays with the run).
struct PictureCaptureInfo: Equatable {
    var region: Box
    var screen: RecordID
    var pixelSize: CGSize
    var blank: CGRect?
    var ink: CGRect?

    init(_ c: PictureCapture) {
        region = c.region
        screen = c.screen
        pixelSize = c.pixelSize
        blank = c.blank
        ink = c.ink
    }

    init(region: Box, screen: RecordID, pixelSize: CGSize, blank: CGRect?, ink: CGRect?) {
        self.region = region
        self.screen = screen
        self.pixelSize = pixelSize
        self.blank = blank
        self.ink = ink
    }
}

/// A timer the tutor can cancel.
@MainActor
protocol PictureTimer: AnyObject {
    func cancel()
}

/// The app's clock: a main-actor task.
@MainActor
final class TaskTimer: PictureTimer {
    private var task: Task<Void, Never>?

    init(after seconds: Double, _ fn: @escaping @MainActor () -> Void) {
        task = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(Int(seconds * 1000)))
            guard !Task.isCancelled else { return }
            fn()
        }
    }

    func cancel() {
        task?.cancel()
        task = nil
    }

    static func schedule(_ seconds: Double, _ fn: @escaping @MainActor () -> Void) -> PictureTimer {
        TaskTimer(after: seconds, fn)
    }
}

/// The reveal: the overlay drawn on along the tutor's strokes, the pen riding the tip.
enum PictureReveal {
    static let ghostOpacity = 0.3
    /// a stroke uncovers this much either side of its line (× its width, at least `minMask` px)
    static let maskFactor = 2.5
    static let minMask = 6.0
    static let fade = 0.3

    /// 1.2–1.8 s by how much there is to draw (2 s at most); a 0.3 s fade without strokes; nothing
    /// under Reduce Motion.
    static func duration(_ strokes: [BoardDrawStroke], reduceMotion: Bool) -> Double {
        if reduceMotion { return 0 }
        let length = strokes.reduce(0) { $0 + $1.length }
        guard length > 0 else { return fade }
        return min(2.0, 1.2 + 0.6 * min(1, length / 4000))
    }

    static func maskWidth(_ stroke: BoardDrawStroke) -> Double {
        max(stroke.width * maskFactor, minMask)
    }

    /// The strokes drawn up to `progress` (0…1) of their whole length, as polylines (pixels), and the
    /// pen's tip.
    static func partial(_ strokes: [BoardDrawStroke], progress: Double) -> (lines: [(points: [CGPoint], width: Double)], tip: CGPoint?) {
        let total = strokes.reduce(0) { $0 + $1.length }
        var budget = max(0, min(1, progress)) * total
        var out: [(points: [CGPoint], width: Double)] = []
        var tip: CGPoint?
        for s in strokes {
            let p = s.points
            guard p.count >= 2 else { continue }
            var line = [CGPoint(x: p[0], y: p[1])]
            tip = line[0]
            var i = 2
            while i + 1 < p.count, budget > 0 {
                let a = CGPoint(x: p[i - 2], y: p[i - 1]), b = CGPoint(x: p[i], y: p[i + 1])
                let seg = hypot(b.x - a.x, b.y - a.y)
                if seg <= budget {
                    line.append(b)
                    budget -= seg
                } else {
                    let t = budget / seg
                    line.append(CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t))
                    budget = 0
                }
                tip = line.last
                i += 2
            }
            out.append((line, maskWidth(s)))
            if budget <= 0 { break }
        }
        return (out, tip)
    }
}
