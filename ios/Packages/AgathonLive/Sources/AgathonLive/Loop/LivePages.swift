import AgathonBoard
import AgathonBrain
import Combine
import Foundation

/// Problem pages, check when done and "I read" on one board (docs/PROBLEM-PAGES.md): what the
/// overlay shows (published), and what the loop remembers for them on the page on show.
///
/// The loop owns one (`LiveLoop.pages`); `LiveLoop+Check`, `+Pages` and `+Fix` do the work.
@MainActor
public final class LivePages: ObservableObject {
    // MARK: what the board shows

    /// "I read" for each read line on the page (empty with "Show what the tutor read" off)
    @Published public internal(set) var readings: [LineReading] = []
    /// "Fix what I read", open on a line
    @Published public internal(set) var fixing: ReadingFix?
    /// "New page for this one", under a second problem's first line
    @Published public internal(set) var offer: NewPageOffer?
    /// the page's action corner: Check, Next problem, All done
    @Published public internal(set) var action: PageAction?
    /// the page on show, when it is a problem page (or the All done page)
    @Published public internal(set) var page: ProblemPage?
    /// on the All done page: the set's problems and how each went
    @Published public internal(set) var setProblems: [SetProblem] = []
    /// "More room": the page is getting full (the kid's work reaches its last row), the problem can
    /// go on on a new page (`LiveLoop+MoreRoom`)
    @Published public internal(set) var moreRoom = false
    /// the chips step aside while the pen writes (and a moment after)
    @Published public internal(set) var chipsHidden = false

    /// Ask the server for a second opinion on every line (a crop with each read; the route's
    /// `RECOGNIZE_SECOND_OPINION` flag decides). Off by default: it doubles Mathpix's calls. The Live
    /// Lab's switch (`secondOpinionDebug`) turns it on for this iPad's boards in a Debug build.
    public var secondOpinion = false

    /// The Live Lab's switch for the second opinion (UserDefaults, this iPad). Read only by Debug builds:
    /// a Release build asks for it when the owner turns it on (a remote setting, later).
    public static let secondOpinionDebugKey = "agathon.debug.secondOpinion"

    public static var secondOpinionDebug: Bool {
        get {
            #if DEBUG
            return UserDefaults.standard.bool(forKey: secondOpinionDebugKey)
            #else
            return false
            #endif
        }
        set { UserDefaults.standard.set(newValue, forKey: secondOpinionDebugKey) }
    }
    /// The second part of problem pages (`ProblemPagesRollout`): the page's judging rules (a true step,
    /// one answer of several, the kid's own problem), never ringing a read in doubt, "New page for this
    /// one". Off: the pages alone, judged as the loop judges (scoped to the page's problem).
    public var extras = ProblemPagesRollout.secondPart

    // MARK: what the loop remembers (the page on show)

    /// the reading each line was checked at (check when done): a line is held until then
    var released: [String: String] = [:]
    /// lines whose read has landed but is still being put on them (`applyRecognition`'s awaits): to a
    /// check they are still being read (one ran in that moment and skipped a just-read answer)
    var applying = Set<String>()
    /// a check waiting for the reads in flight, and its watchdog
    var pendingCheck: CheckReason?
    var pendingCheckTimer: LiveTimer?
    var pauseTimer: LiveTimer?
    var answerTimer: LiveTimer?
    var chipsTimer: LiveTimer?
    /// the safety net (`safetyNetCheck`): its timer, the ink it last checked after, and why the work
    /// it checked had been held (the Debug probe shows it)
    var netTimer: LiveTimer?
    var netFiredFor = -Double.infinity
    public internal(set) var lastSafetyNet: String?
    /// the kid's last stroke on the page (scheduler ms)
    var lastInkAt = -Double.infinity
    /// per stroke: when the kid last drew or changed it (the line the pen is on is never judged at a
    /// pause)
    var strokeAt: [String: Double] = [:]
    /// readings the kid (or a grown-up) gave or confirmed, by line: for which ink
    var fixed: [String: (hash: String, latex: String)] = [:]
    var confirmed: [String: String] = [:]
    /// the second opinion, by line: its read, and whether it agreed (for this reading)
    var second: [String: (latex: String, agree: Bool, read: String)] = [:]
    /// lines that start a problem of the kid's own (no mark of their own; they head what follows)
    var ownHeads = Set<String>()
    /// offers the kid answered "Keep it here" to
    var keptHere = Set<String>()
    /// lines that are one answer of several (`x = 2` of a quadratic): ticked, not solved
    var partial = Set<String>()
    /// the page's problem is solved (the cheer and Next)
    var solved = false
    /// "More room": how the problem's work stood at the bottom of the page before (a continued page;
    /// a loop on another page is given it), and how each column of this page ends (`LiveLoop+MoreRoom`)
    var carry: PageCarry?
    var columnEnds: [Int: PageCarry] = [:]
    /// the problem's other pages, as the board's records say (cached by the store's change count)
    var elsewhere: (seq: UInt64, screen: RecordID, held: Bool, solvedBefore: Bool, solvedAfter: Bool, ringedLater: Bool)?

    public init() {}

    /// The page on show changed (or the loop stopped): what it remembered of the last goes.
    func reset() {
        for t in [pendingCheckTimer, pauseTimer, answerTimer, chipsTimer, netTimer] { t?.cancel() }
        pendingCheckTimer = nil
        pauseTimer = nil
        answerTimer = nil
        chipsTimer = nil
        netTimer = nil
        netFiredFor = -.infinity
        pendingCheck = nil
        released = [:]
        applying = []
        lastInkAt = -.infinity
        strokeAt = [:]
        fixed = [:]
        confirmed = [:]
        second = [:]
        ownHeads = []
        keptHere = []
        partial = []
        solved = false
        carry = nil
        columnEnds = [:]
        elsewhere = nil
        if moreRoom { moreRoom = false }
        if !readings.isEmpty { readings = [] }
        if fixing != nil { fixing = nil }
        if offer != nil { offer = nil }
        if action != nil { action = nil }
        if chipsHidden { chipsHidden = false }
    }
}

/// What started a check (docs/PROBLEM-PAGES.md, "Triggers and timings").
public enum CheckReason: String, Sendable {
    /// the kid tapped Check
    case button
    /// a line written in the answer spot, then a moment's quiet there
    case answer
    /// a long pause with no ink (Auto on)
    case pause
    /// Help me on a line (its column)
    case help
    /// a reading fixed or confirmed (that line)
    case fixed
    /// the safety net: work still unchecked, nothing being read or written, and no ink for longer
    /// than the long pause and a margin (whatever held it: a touch left on the board, a lost timer)
    case idle
}

/// The clocks of check when done.
public enum PageTiming {
    /// no kid ink on the page this long (Auto on): the work is checked
    public static let checkPauseMs = 9_000.0
    /// a line in the answer spot, then no ink there this long: checked
    public static let answerQuietMs = 1_500.0
    /// at a pause or the answer spot, a line whose ink changed this recently is still being written
    public static let unfinishedMs = 1_200.0
    /// a check waits for the reads in flight at most this long
    public static let readWaitMs = 7_000.0
    /// the "I read" chips step aside this long after the pen lifts
    public static let chipsBackMs = 1_000.0
    /// the safety net checks this long after the long pause, if the work is still unchecked
    public static let safetyMarginMs = 3_000.0
    /// Mathpix's strokes confidence under this: "Is this right?" (the eval's threshold)
    public static let askBelowConfidence = 0.99
}

/// LiveMeta's keys for problem pages (on a `line` record).
enum PageMeta {
    /// the reading the line was checked at
    static let checked = "checked"
    /// the kid's own reading, and the ink hash it was given for
    static let fixed = "fixed"
    static let fixedHash = "fixedHash"
    /// the reading the kid said is right
    static let confirmed = "confirmed"
    /// the second opinion's read, and whether it agreed
    static let second = "second"
    static let agree = "agree"
    /// the kid kept their own problem on this page ("Keep it here"): the offer does not come back
    static let keptHere = "keptHere"
}
