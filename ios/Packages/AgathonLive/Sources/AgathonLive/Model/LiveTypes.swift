import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation

// Names that exist in more than one of the packages this one joins up.
public typealias BrainRect = AgathonBrain.Rect
public typealias LiveMode = AgathonBrain.HelpMode
typealias MetaValue = AgathonBoard.JSONValue
typealias KitJSON = AgathonKit.JSONValue

/// The loop's clocks, as the web's `LIVE_TIMING` (src/lib/live/contracts.ts) — the same numbers,
/// because they are what a kid's writing was measured against.
public enum LiveTiming {
    /// pen-up → read the line; more ink in the line starts it again
    public static let quietMs = 600.0
    /// the same, for a line that was read already (a rewrite)
    public static let rewriteQuietMs = 450.0
    /// a quiet gate that ran out while the pen is down looks again this soon
    public static let quietRecheckMs = 150.0
    /// no kid ink anywhere for this long: the kid has stopped (answers and Auto wait for it)
    public static let settleMs = 2_500.0
    /// Auto in Suggest: stopped this long on an unfinished problem, the tutor writes its next step
    public static let stuckMs = 6_000.0
    /// a line just read shows its readback this long
    public static let readbackMs = 2_500.0
    /// an unsure read gets its "?" only after this
    public static let unreadableChipMs = 3_000.0
    /// "Reading…" shows only when a read takes longer than this
    public static let readingLabelDelayMs = 600.0
    /// a read is abandoned after this
    public static let recognizeTimeoutMs = 6_000.0
    /// a read that failed like a blip is tried once more this long after
    public static let readRetryMs = 1_500.0
    /// the offline queue's replays while the device says it is online: one wait per failed replay
    public static let offlineReplayMs: [Double] = [2_000, 4_000, 8_000, 15_000]
    /// Help tapped while its line is still being read: how long it waits for the read, at most
    public static let helpReadWaitMs = 7_000.0
    /// a mark's write holds up what waits for it (a step beside a ring) at most this long
    public static let markBusyMaxMs = 4_000.0
    /// a tick counts for a cheer after this; a ring only after the longer wait
    public static let cheerSettleMs = 700.0
    public static let cheerMissSettleMs = 3_000.0
    /// no call to the server for this long: the next pen-down warms the road (a free capabilities GET)
    public static let warmAfterMs = 60_000.0
    /// a "Graph it" chip shows this long after its line is read
    public static let graphOfferMs = 12_000.0
}

/// The web's `LIVE_LIMITS`.
public enum LiveLimits {
    public static let minConfidence = 0.6
    public static let maxLiveShapesPerBoard = 60
    public static let maxLinesPerCheck = 40
    public static let maxHintsPerLine = 1
    public static let maxSolveSteps = 8
    public static let maxCropBytes = 200_000
    public static let cacheEntries = 500
    /// recognitions at once (the web's limiter)
    public static let concurrentReads = 2
}

/// What the status pill says (the web's `LiveStatus`, plus the states the kid's bar has).
public enum LiveActivity: Equatable, Sendable {
    case idle
    case reading
    case checking
    case solving
    /// no network: `waiting` lines wait to be read
    case offline(waiting: Int)
    /// Live switched off by a grown-up
    case paused
    /// the tutor's ink ran out: help is paused until a grown-up sorts it
    case outOfInk
    /// slowed down by the rate limit until `until` (ms on the loop's clock); `fairUse`: the day's cap
    case slowDown(until: Double, fairUse: Bool)
    /// the session was refused
    case signedOut
    /// a call failed; `retry` says whether Retry can run it again
    case trouble(retry: Bool)
}

/// Where a line's read came from.
public enum ReadProvider: String, Sendable, Equatable {
    /// `fixed`: the kid (or a grown-up) picked or typed the line's reading ("Fix what I read")
    case none, mathpix, vision, reread, restored, fixed
}

/// When the tutor judges the kid's lines (docs/PROBLEM-PAGES.md, "Check when done").
public enum CheckTiming: String, Sendable, Codable, CaseIterable {
    /// quiet while the kid works; checks when they write in the answer spot, tap Check, or stop for a
    /// long pause (the default since 2026-10-19)
    case whenDone
    /// every line as soon as it is read (the tutor before 2026-10-19)
    case asIGo
}

/// One line of the kid's work as the loop holds it (the web's `LiveLineState`).
public struct LiveLine: Equatable, Sendable {
    public var ink: InkLine
    public var latex: String
    public var confidence: Double
    public var provider: ReadProvider
    public var analysis: LineAnalysis?
    /// ms on the loop's clock
    public var updatedAt: Double
    public var hintsShown: Int
    public var rewritesWithWarn: Int
    /// the model called this read wrong (its `aiWarnLatex`): the ring stays while it reads the same
    public var modelWarned: String?

    public init(ink: InkLine, latex: String = "", confidence: Double = 0, provider: ReadProvider = .none,
                analysis: LineAnalysis? = nil, updatedAt: Double = 0) {
        self.ink = ink
        self.latex = latex
        self.confidence = confidence
        self.provider = provider
        self.analysis = analysis
        self.updatedAt = updatedAt
        hintsShown = 0
        rewritesWithWarn = 0
        modelWarned = nil
    }

    public var id: String { ink.id }
    public var bounds: BrainRect { ink.bounds }
    public var column: Int { ink.column }
    public var row: Int { ink.row }
    /// the model flagged this read (and it still reads the same)
    public var isModelFlagged: Bool { modelWarned != nil && modelWarned == latex && !latex.isEmpty }
}

/// The grown-ups' settings for one board (the web keeps the dial per board on the device too).
public struct LiveSettings: Equatable, Sendable, Codable {
    /// Live reads the board at all
    public var enabled: Bool
    /// how much help: off, feedback (Hint), suggest (Next step), answer (Solve it)
    public var mode: LiveMode
    /// the tutor helps by itself when the kid stops writing; off, only when asked
    public var auto: Bool
    /// the tutor writes by hand (off: typeset steps)
    public var handwriting: Bool
    /// cheers and confetti when the tutor ticks a step
    public var celebrations: Bool
    /// "Show the answer when I write =": a sum the kid ends with `=` is answered after it at once, in
    /// any mode (homework checking, practice checking). Off by default: tutoring shouldn't hand out
    /// answers.
    public var answerOnEquals: Bool
    /// When the tutor judges: when the kid is done (default), or as they go.
    public var checking: CheckTiming
    /// "I read: …" under each line, tap to fix (default on).
    public var showReadings: Bool

    public init(enabled: Bool = true, mode: LiveMode = .feedback, auto: Bool = true, handwriting: Bool = true, celebrations: Bool = true,
                answerOnEquals: Bool = false, checking: CheckTiming = ProblemPagesRollout.secondPart ? .whenDone : .asIGo,
                showReadings: Bool = ProblemPagesRollout.secondPart) {
        self.enabled = enabled
        self.mode = mode
        self.auto = auto
        self.handwriting = handwriting
        self.celebrations = celebrations
        self.answerOnEquals = answerOnEquals
        self.checking = checking
        self.showReadings = showReadings
    }

    enum CodingKeys: String, CodingKey {
        case enabled, mode, auto, handwriting, celebrations, answerOnEquals, checking, showReadings
    }

    /// Settings saved before a field existed keep the rest, with the new field at its default.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = LiveSettings()
        enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? d.enabled
        mode = try c.decodeIfPresent(LiveMode.self, forKey: .mode) ?? d.mode
        auto = try c.decodeIfPresent(Bool.self, forKey: .auto) ?? d.auto
        handwriting = try c.decodeIfPresent(Bool.self, forKey: .handwriting) ?? d.handwriting
        celebrations = try c.decodeIfPresent(Bool.self, forKey: .celebrations) ?? d.celebrations
        answerOnEquals = try c.decodeIfPresent(Bool.self, forKey: .answerOnEquals) ?? d.answerOnEquals
        // settings saved before 2026-10-19 take the new default (the owner's: check when done, once it ships)
        checking = (try? c.decodeIfPresent(CheckTiming.self, forKey: .checking)) ?? d.checking
        showReadings = try c.decodeIfPresent(Bool.self, forKey: .showReadings) ?? d.showReadings
    }

    /// New boards start in Feedback ("Hint"): Off makes Live look broken.
    public static let `default` = LiveSettings()

    /// The settings remembered for `boardId` on this device, else the default.
    public static func load(boardId: String, defaults: UserDefaults = .standard) -> LiveSettings {
        guard let data = defaults.data(forKey: key(boardId)),
              let s = try? JSONDecoder().decode(LiveSettings.self, from: data) else { return .default }
        return s
    }

    public func save(boardId: String, defaults: UserDefaults = .standard) {
        if let data = try? JSONEncoder().encode(self) { defaults.set(data, forKey: Self.key(boardId)) }
    }

    static func key(_ boardId: String) -> String { "agathon.live.\(boardId)" }
}

/// A hint card the kid sees beside a line (Got it / More help / read aloud).
public struct HintCard: Identifiable, Equatable, Sendable {
    public let id: String
    public let lineId: String
    /// where it points (page units): the line's ink
    public var anchor: BrainRect
    public var title: String
    public var message: String
    public var question: String?
    /// 1: a hint, 2: a closer look, 3: one step
    public var level: Int
}

/// A cheer the board shows beside a tick (or a kind word beside a ring).
public struct Cheer: Identifiable, Equatable, Sendable {
    public enum Tone: Sendable { case win, miss, solved }
    public let id: Int
    public let lineId: String
    public let tone: Tone
    public let text: String
    /// ticks in a row (shown from 3)
    public let streak: Int
    /// the big burst: a milestone streak, or a problem finished
    public let big: Bool
    /// where (page units): the mark's right edge, middle
    public let at: AgathonBrain.Point
}

/// "Now you try one": a problem like the one the tutor just helped with.
public struct NowYouTryOffer: Identifiable, Equatable, Sendable {
    public let id: String
    /// the new problem's lines (LaTeX)
    public let problem: [String]
    /// the problem it is like
    public let parent: [String]
}

/// A line's typeset readback, shown for a moment after the line is read ("the tutor saw it").
public struct Readback: Identifiable, Equatable, Sendable {
    public let id: String
    public let latex: String
    public let anchor: BrainRect
}

extension BrainRect {
    var maxX: Double { x + w }
    var maxY: Double { y + h }
    var box: Box { Box(x: x, y: y, w: w, h: h) }
    func union(_ o: BrainRect) -> BrainRect {
        let x0 = min(x, o.x), y0 = min(y, o.y)
        return BrainRect(x: x0, y: y0, w: max(maxX, o.maxX) - x0, h: max(maxY, o.maxY) - y0)
    }
    func intersects(_ b: BrainRect) -> Bool { x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y }
    func expanded(_ d: Double) -> BrainRect { BrainRect(x: x - d, y: y - d, w: w + 2 * d, h: h + 2 * d) }
    static func around(_ rects: [BrainRect]) -> BrainRect? {
        guard var r = rects.first else { return nil }
        for o in rects.dropFirst() { r = r.union(o) }
        return r
    }
}

extension Box {
    var rect: BrainRect { BrainRect(x: x, y: y, w: w, h: h) }
}
