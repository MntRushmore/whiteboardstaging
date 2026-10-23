import AgathonBoard
import AgathonBrain
import CoreGraphics
import Foundation

/// What the Live loop needs from a board: its records, the screen on show, the kid's pen, and the
/// tutor's hand. `CanvasLiveBoard` is the app's (AgathonBoard's controller and canvas); the tests
/// use an in-memory one.
@MainActor
public protocol LiveBoard: AnyObject {
    /// The board's records. The loop reads the kid's strokes and writes its own records (lines,
    /// problems, marks, typeset steps) with origin `.tutor`: saved, never in the kid's undo stack.
    var store: BoardStore { get }
    var currentScreenID: RecordID { get }
    /// The current screen's rect (page units; 1600 × 900 for a new screen).
    var screenRect: BrainRect { get }
    /// The board's fit zoom (view points per page unit with the screen fitted): sizes the tutor's
    /// hand and the clustering's sense of a glyph (the web's `getBaseZoom`). nil: unknown.
    var fitZoom: Double? { get }
    /// Records the kid picked with the select tool (Help me acts on their line); empty with none.
    var selection: [RecordID] { get }
    /// A stroke is being drawn right now.
    var isPenDown: Bool { get }
    /// Reduce Motion: the tutor's writing appears at once.
    var reduceMotion: Bool { get }
    /// Set by the loop: the kid's pen went down (true) or up (false).
    var onPen: ((Bool) -> Void)? { get set }
    /// Set by the loop: where a hovering Pencil (or pointer) is over the page, nil when the hover
    /// ends. A board without hover leaves it alone (the default does nothing).
    var onHover: ((AgathonBrain.Point?) -> Void)? { get set }
    /// Set by the loop: the board moved to another screen.
    var onScreenChange: ((RecordID) -> Void)? { get set }
    /// Writes lines in the tutor's hand at handwriting pace on the current screen; `meta` goes on
    /// every stroke. `onDone` runs once the last stroke is in the store (or the pen was cancelled).
    func write(_ lines: [TutorLine], meta: Meta, onDone: @escaping @MainActor () -> Void) -> TutorPen
    /// Adds a blank screen and shows it; nil at the cap.
    func addScreen() -> RecordID?

    // problem pages (docs/PROBLEM-PAGES.md)

    /// Shows another page (Next problem; the page a problem moved to).
    func goToScreen(_ id: RecordID)
    /// A blank page right after `after` (the current one when nil) with `meta`, shown when `go`: the
    /// tutor's (a practice set's pages), no step the kid undoes. Nil at the cap.
    func insertScreen(after: RecordID?, meta: Meta, go: Bool) -> RecordID?
    /// A page's `meta.page` (the tutor's).
    func setProblemPage(_ page: ProblemPage?, on id: RecordID)
    /// "New page for this one": `ids` (the kid's strokes on this page) move to a new page right after
    /// it, shifted by `offset`, with `meta` on the page and `alsoRemove` gone, as ONE kid undo step;
    /// the board shows the new page. Nil when it cannot.
    func moveToNewScreen(_ ids: [RecordID], offset: Vec2, meta: Meta, alsoRemove: [RecordID]) -> RecordID?
    /// "More room": the problem on show goes on on a new page right after its last one (AgathonBoard's
    /// `MoreRoom`), as ONE kid undo step; the board shows the new page. Nil when it cannot.
    func moreRoom() -> RecordID?
}

extension LiveBoard {
    /// No hover on this board.
    public var onHover: ((AgathonBrain.Point?) -> Void)? {
        get { nil }
        set {}
    }

    /// A board that cannot change its page on show stays where it is.
    public func goToScreen(_ id: RecordID) {}

    /// A page put in the board's records after `after` (a board that cannot show another page keeps
    /// the one it is on).
    public func insertScreen(after: RecordID?, meta: Meta, go: Bool) -> RecordID? {
        let screens = store.screens
        guard screens.count < ScreenRecord.maxScreens else { return nil }
        // (after this page: after the last page of its problem, when it needed more room)
        let anchor = after ?? store.lastPageOfProblem(currentScreenID)
        let s = ScreenRecord(order: store.screenOrder(after: anchor), meta: meta)
        store.put(.screen(s), origin: .tutor)
        if go { goToScreen(s.id) }
        return s.id
    }

    public func setProblemPage(_ page: ProblemPage?, on id: RecordID) {
        guard case .screen(var s)? = store[id], s.problemPage != page else { return }
        s.problemPage = page
        store.put(.screen(s), origin: .tutor)
    }

    /// A board without its controller cannot move ink to a page of its own.
    public func moveToNewScreen(_ ids: [RecordID], offset: Vec2, meta: Meta, alsoRemove: [RecordID]) -> RecordID? { nil }

    /// "More room" on the board's records, as the controller does it (one kid change), then the new page.
    public func moreRoom() -> RecordID? {
        guard let plan = MoreRoom.plan(store, from: currentScreenID) else { return nil }
        let id = MoreRoom.apply(plan, to: store, origin: .kid)
        goToScreen(id)
        return id
    }

    /// The page on show as a problem page (or the All done page), if it is one.
    public var currentProblemPage: ProblemPage? { store[currentScreenID]?.screen?.problemPage }
}

/// One block of the tutor's writing in progress.
@MainActor
public protocol TutorPen: AnyObject {
    var isWriting: Bool { get }
    /// How long the block takes to write (wall clock, ms; 0 under Reduce Motion).
    var wallMs: Double { get }
    /// Stops: lines begun are finished whole, the rest are not written.
    func cancel()
}

/// Where page points are on screen, for the overlays (hint cards, cheers, readbacks).
@MainActor
public protocol LiveCanvasGeometry: AnyObject {
    /// A page point in the board view's coordinates (points).
    func viewPoint(_ page: AgathonBrain.Point) -> CGPoint
    /// The board view's size (points).
    var viewSize: CGSize { get }
}

/// The meta keys the loop stamps on what it writes (the web's own keys, so a board read by either
/// app means the same).
enum LiveMeta {
    static let live = "live"
    static let source = "source"
    static let lineId = "lineId"
    static let createdAt = "createdAt"
    /// on a mark's strokes: its key (`check:12,30,40,10`)
    static let mark = "mark"
    /// on a question mark's strokes: `unread` or `unjudged`
    static let markWhy = "markWhy"
    /// on a worked solution: what it solves (written once)
    static let solvedLatex = "solvedLatex"
    /// on the right next step beside a ringed line: the ringed read
    static let suggestFor = "suggestFor"
    /// on an answer finishing the kid's `=`: the line as read
    static let answerFor = "answerFor"
    static let answerLatex = "answerLatex"
    /// on Help's step after a line's `=`
    static let nextStepFor = "nextStepFor"
    /// on a graph the kid asked for ("Graph it"): the line it plots, as read
    static let graphFor = "graphFor"
    /// on everything one write made (the loop finds a block's strokes by it)
    static let job = "liveJob"
    /// on a kid's stroke over a question's printed figure (SAT v2): "plot" or "shape". Not read as a line.
    static let onFigure = "figure"
    /// on a line record: the read the model called wrong
    static let aiWarnLatex = "aiWarnLatex"
    /// on a line record: its confidence and provider, and its ink hash
    static let confidence = "confidence"
    static let provider = "provider"
    static let hash = "hash"
    /// on a problem record: where the problem is written (page rect) and the attempt it follows
    static let rect = "rect"
    static let parent = "parentId"
}

extension BoardStore {
    /// The kid's finished strokes on a screen, as the brain takes ink (page coordinates).
    func kidStrokes(on screen: RecordID) -> [BrainStroke] {
        drawables(on: screen).compactMap { record -> BrainStroke? in
            // (ink on a question's figure is read in the figure's terms, never as a line: SAT v2)
            guard case .stroke(let s) = record, s.author == .kid, s.meta["highlight"]?.boolValue != true, s.meta[LiveMeta.onFigure] == nil,
                  !s.points.isEmpty else { return nil }
            var xs: [Double] = []
            var ys: [Double] = []
            xs.reserveCapacity(s.points.count)
            ys.reserveCapacity(s.points.count)
            for p in s.points {
                let v = s.pagePoint(p)
                xs.append((v.x * 100).rounded() / 100)
                ys.append((v.y * 100).rounded() / 100)
            }
            return BrainStroke(id: s.id.rawValue, x: xs, y: ys)
        }
    }

    /// Records on a screen whose meta says the loop wrote them for `lineId`.
    func liveRecords(on screen: RecordID, lineId: String) -> [BoardRecord] {
        drawables(on: screen).filter { $0.meta[LiveMeta.lineId]?.stringValue == lineId && $0.meta[LiveMeta.live]?.boolValue == true }
    }

    /// Every record the loop wrote on a screen (drawn ones).
    func liveDrawables(on screen: RecordID) -> [BoardRecord] {
        drawables(on: screen).filter { $0.meta[LiveMeta.live]?.boolValue == true }
    }

    /// The semantic records (lines, problems, marks) of a screen.
    func semantic(on screen: RecordID) -> [BoardRecord] {
        records.values.filter { r in
            switch r {
            case .line(let l): return l.screen == screen
            case .problem(let p): return p.screen == screen
            case .mark(let m): return m.screen == screen
            default: return false
            }
        }
    }
}

extension Meta {
    func string(_ key: String) -> String { self[key]?.stringValue ?? "" }
}
