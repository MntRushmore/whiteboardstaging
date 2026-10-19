import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation

/// The learning record's memory of one loop session (the web's `learnKeys`, `learnSent`,
/// `learnFresh`, `learnProblems`), each bounded as the web bounds them (LEARN_MEMORY).
struct LearnState {
    /// the problem key each student line was given; a line keeps its key for the session
    var keys = OrderedMap<String, String>()
    /// what the record was last told about each line: a line says something only when that changes
    var sent = OrderedMap<String, String>()
    /// lines whose ink was read in this session: new work (a line brought back from its readback is not)
    var fresh = OrderedMap<String, Bool>()
    /// the tutor's problems the record was told about, by problem key
    var problems = OrderedMap<String, Bool>()
    /// the loop's own name for a problem (`problemKey(for:)`, Now you try's) → the record's key
    var loopKeys = OrderedMap<String, String>()
    /// a Now you try offer → the record's key of the problem it follows
    var offerParents: [String: String] = [:]
    /// the chat's problems on the screen (Ask's `chatProblem` strokes), read again after a change
    var chatCells: [ChatCell]?

    /// LEARN_MEMORY
    static let memory = 2_000

    static func remember<V>(_ map: inout OrderedMap<String, V>, _ key: String, _ value: V) {
        map[key] = value
        while map.count > memory { map.removeFirst() }
    }
}

/// One of the chat's problems on the screen (the web's `ProblemCell`): its block, its lines, where
/// its ink is, and the cell the student works it in.
struct ChatCell: Equatable {
    var key: String
    var lines: [String]
    var head: BrainRect
    var cell: BrainRect
}

extension LiveLoop {
    // MARK: - the learning record
    //
    // What the board tells the learning record (`learning`), at the moments the loop already knows
    // about: a problem the tutor wrote, a line's mark decided or changed, a mistake the model named,
    // the tutor's help, the tutor finishing a problem, a screen left, the board closed — the web's
    // `LiveLoop.learn*` (src/lib/live/liveLoop.ts), one for one. Each is cheap, and none ever throws
    // into the loop: the record is never worth the board.
    //
    // `problemKey` names one problem on one screen and stays the same while the problem is there:
    //  - a problem the tutor wrote: `<screen>#cell:<its problem record>` (Now you try, a practice
    //    set), or `<screen>#cell:<its hand block>` for one Ask's chat wrote (`chatProblem` strokes);
    //  - the student's own: `<screen>#ink:<line id>`, the id of its column's head line when the
    //    problem was first seen; every line of the column keeps the key it was given, and a line new
    //    to it takes the key of its topmost line that has one.
    // Never the tutor's own ink, or a readback brought back by a load or a screen switch (`fresh`).

    /// The record's meta key on a problem record: the attempt it follows (Now you try).
    static let parentAttemptMeta = "parentAttempt"

    var learnNow: Double { LearningTime.now() }

    func learnEmit(_ signal: LearningSignal) {
        learning.emit(signal)
    }

    /// Lines read in this session (`applyRecognition`): new work for the record.
    func learnFresh(_ lineId: String) {
        LearnState.remember(&learn.fresh, lineId, true)
    }

    /// Auto is acting for this line (a failure there stays quiet; for the record, help it was not asked for).
    func learnAutoFor(_ lineId: String) -> Bool {
        autoLines.contains(lineId)
    }

    /// The record's key for the problem a student line is in.
    func learnKeyFor(_ st: LiveLine) -> String {
        let page = board.currentScreenID.rawValue
        let key: String
        if let head = head(for: st.column) {
            key = "\(page)\(ProblemKeyKind.cell)\(head.id.key)"
        } else if let cell = chatCell(for: st) {
            key = "\(page)\(ProblemKeyKind.cell)\(cell.key)"
        } else if let own = learn.keys[st.id] {
            key = own
        } else {
            let col = columnLines(st.column)
            let found = col.lazy.compactMap { self.learn.keys[$0.id] }.first
            let k = found ?? "\(page)\(ProblemKeyKind.ink)\((col.first ?? st).id)"
            for s in col where learn.keys[s.id] == nil { LearnState.remember(&learn.keys, s.id, k) }
            if learn.keys[st.id] == nil { LearnState.remember(&learn.keys, st.id, k) }
            key = k
        }
        LearnState.remember(&learn.loopKeys, problemKey(for: st), key)
        return key
    }

    /// The problem a line is in, as LaTeX: the tutor's, or the student's head line (the first that is
    /// not a label, an operation or unread).
    func learnProblemOf(_ st: LiveLine) -> [String] {
        if let head = head(for: st.column) { return head.lines }
        if let cell = chatCell(for: st) { return cell.lines }
        let col = columnLines(st.column).filter { !$0.latex.isEmpty }
        let first = col.first { !["label", "unknown", "operation"].contains($0.analysis?.kind ?? "unknown") } ?? col.first
        return first.map { [$0.latex] } ?? []
    }

    /// The problem `lineId` is in.
    func learnTargetOf(_ lineId: String) -> (key: String, problem: [String])? {
        guard let st = lines[lineId] else { return nil }
        return (learnKeyFor(st), learnProblemOf(st))
    }

    /// The line a step is judged against when it is the student's own ink (the web's `previousLine`):
    /// the last line above it that is a step and no slip.
    func learnPreviousLine(_ st: LiveLine) -> LiveLine? {
        var previous: LiveLine?
        for s in columnLines(st.column) {
            if s.row >= st.row { break }
            guard !s.latex.isEmpty, let a = s.analysis, !["label", "incomplete", "unknown", "operation"].contains(a.kind) else { continue }
            if a.verdict == "mismatch" || a.carried == true { continue }
            previous = s
        }
        return previous
    }

    /// A first line under one of the tutor's one-line problems: the problem is the line above it.
    func learnHeadAbove(_ st: LiveLine) -> String? {
        if let head = head(for: st.column) { return head.lines.count == 1 ? head.lines[0] : nil }
        if let cell = chatCell(for: st) { return cell.lines.count == 1 ? cell.lines[0] : nil }
        return nil
    }

    /// The mark the record takes for a line: the one decided, drawn or not. In Off, or at the shape
    /// cap, the tutor draws none: then the one its verdict gives, as Feedback would draw it.
    func learnMarkOf(_ st: LiveLine, _ decided: LiveMarks.Kind?) -> LineMark? {
        let mark: LineMark? = decided.map { $0 == .check ? .check : $0 == .circle ? .circle : .question }
        if settings.mode != .off && liveShapeCount() < LiveLimits.maxLiveShapesPerBoard { return mark }
        if mark == .question { return mark }
        let badge = LivePolicy.badge(.feedback, st.analysis)
        if badge == "ok" || badge == "solved" { return .check }
        return badge == "warn" || st.isModelFlagged ? .circle : mark
    }

    /// A student line's mark was decided (`syncMark`): the record hears the line when what it says
    /// about it changes — its read, its kind, its mark, whether it is the answer — and only for work
    /// of this session.
    func learnLine(_ given: LiveLine, _ decided: LiveMarks.Kind?) {
        guard started, learning.isEnabled, let st = lines[given.id], !st.latex.isEmpty else { return }
        let id = st.id
        let mark = learnMarkOf(st, decided)
        let solved = (st.analysis?.solved ?? false) && mark == .check
        let kind = st.analysis?.kind ?? "unknown"
        let key = learnKeyFor(st)
        let said = "\(key)\n\(st.latex)\n\(kind)\n\(mark?.rawValue ?? "")\n\(solved)"
        // most renders change nothing: they stop here
        if learn.sent[id] == said { return }
        // a readback stays quiet, and unsent, until a line of its problem is new
        if learn.fresh[id] == nil && !columnLines(st.column).contains(where: { learn.fresh[$0.id] != nil }) { return }
        LearnState.remember(&learn.sent, id, said)
        let previous = learnPreviousLine(st)?.latex ?? learnHeadAbove(st)
        learnEmit(.line(.init(at: learnNow, boardId: boardId, pageId: board.currentScreenID.rawValue, problemKey: key,
                              problemLatex: learnProblemOf(st), lineId: id, latex: st.latex, kind: kind, previousLatex: previous,
                              mark: mark, solved: solved)))
    }

    enum LearnDepth { case step, solve }

    /// The tutor wrote for a problem: its next step, or the rest of it — which finishes it.
    func learnTutor(_ target: (key: String, problem: [String])?, _ depth: LearnDepth, auto: Bool) {
        guard let target else { return }
        let at = learnNow
        learnEmit(.help(.init(at: at, problemKey: target.key, help: depth == .step ? .nextStep : .solve, auto: auto)))
        if depth == .solve {
            learnEmit(.tutorSolved(.init(at: at, boardId: boardId, pageId: board.currentScreenID.rawValue, problemKey: target.key,
                                         problemLatex: target.problem)))
        }
    }

    /// The tutor wrote for the problem `lineId` is in.
    func learnWrote(_ lineId: String, _ depth: LearnDepth, auto: Bool? = nil) {
        learnTutor(learnTargetOf(lineId), depth, auto: auto ?? learnAutoFor(lineId))
    }

    /// Solve's paths wrote something new: a step (Help), or the rest.
    func learnSolveWritten(_ st: LiveLine, onlyFirstStep: Bool) {
        learnWrote(st.id, onlyFirstStep ? .step : .solve)
    }

    /// The answer after a line's `=`, written by the tutor: the line, then the tutor finishing it.
    func learnInlineAnswer(_ st: LiveLine) {
        learnLine(st, nil)
        // asked (Solve it) since the student last wrote, or the settle's own
        learnWrote(st.id, .solve, auto: !askedSinceInk)
    }

    /// A hint the kid asked for was shown (the iPad's own words, or the engine's when the model had none).
    func learnHint(_ lineId: String, auto: Bool = false) {
        guard let target = learnTargetOf(lineId) else { return }
        learnEmit(.help(.init(at: learnNow, problemKey: target.key, help: .hint, auto: auto)))
    }

    /// A model check rang a line: the kind of mistake it named, when the record counts it — and, when
    /// the student asked for the check, its words are a hint.
    func learnAnnotation(_ st: LiveLine, _ a: Annotation, userAsked: Bool) {
        guard let target = learnTargetOf(st.id) else { return }
        let at = learnNow
        if MistakeKinds.isKind(a.kind) {
            learnEmit(.mistake(.init(at: at, problemKey: target.key, lineId: st.id, kind: a.kind, source: .model)))
        }
        if userAsked { learnEmit(.help(.init(at: at, problemKey: target.key, help: .hint, auto: false))) }
    }

    /// An explicit ask (Help me, Solve it, More help): about the line asked on, else what Help acts on.
    func learnAsk(_ lineId: String?) {
        guard started, settings.enabled, settings.mode != .off else { return }
        guard let line = lineId.flatMap({ lines[$0] }) ?? helpTargetLine(), let target = learnTargetOf(line.id) else { return }
        learnEmit(.help(.init(at: learnNow, problemKey: target.key, help: .ask, auto: false)))
    }

    /// The student moved to another screen: the problems on the one left are over (for now).
    func learnScreen() {
        learn.chatCells = nil
        learnEmit(.screen(at: learnNow, boardId: boardId, pageId: board.currentScreenID.rawValue))
    }

    /// The board is closing.
    func learnClosed() {
        learnEmit(.closed(at: learnNow, boardId: boardId))
        learning.stop()
    }

    // MARK: - problems the tutor wrote

    /// The tutor's own changes: a problem it wrote (a `problem` record of the tutor's — Now you try,
    /// a practice set — or the first stroke of one of Ask's chat problems) is a new problem for the
    /// record, from where the run writing it says.
    func learnTutorChanges(_ change: ChangeSet) {
        learn.chatCells = nil
        // the tutor writing now (not a board opened, converted or synced from another device)
        guard change.origin == .tutor, learning.isEnabled else { return }
        var told: [(key: String, signal: LearningSignal)] = []
        for (_, record) in change.added {
            switch record {
            case .problem(let p):
                guard p.origin != "student", let latex = p.latex else { continue }
                let problem = latex.components(separatedBy: "\n").filter { !$0.isEmpty }
                guard !problem.isEmpty else { continue }
                let key = "\(p.screen.rawValue)\(ProblemKeyKind.cell)\(p.id.key)"
                let parent = p.meta[Self.parentAttemptMeta]?.stringValue
                told.append((key, .problem(.init(at: learnNow, boardId: boardId, pageId: p.screen.rawValue, problemKey: key,
                                                 problemLatex: problem, origin: Self.learnOrigin(p.origin), parentId: parent))))
            case .stroke(let s) where s.author == .tutor:
                guard let cell = Self.chatProblem(s.meta, bounds: StrokeBounds.of(s)) else { continue }
                let key = "\(s.screen.rawValue)\(ProblemKeyKind.cell)\(cell.key)"
                let from = learning.chatOrigin
                told.append((key, .problem(.init(at: learnNow, boardId: boardId, pageId: s.screen.rawValue, problemKey: key,
                                                 problemLatex: cell.lines, origin: from.origin, parentId: from.parentId))))
            default:
                continue
            }
        }
        for (key, signal) in told.sorted(by: { $0.key < $1.key }) where learn.problems[key] == nil {
            LearnState.remember(&learn.problems, key, true)
            learnEmit(signal)
        }
    }

    /// A problem record's origin as the record names it.
    static func learnOrigin(_ origin: String?) -> LearningOrigin {
        switch origin {
        case "practice": return .practice
        case "nowYouTry", "now_you_try": return .nowYouTry
        case "tour", "starter": return .starter
        case "taught", "teach": return .teach
        default: return .tutorProblem
        }
    }

    // MARK: - the chat's problems (Ask)

    /// A tutor stroke of one of the chat's problems: its block (the problem's key), lines and cell.
    static func chatProblem(_ meta: Meta, bounds: BrainRect) -> ChatCell? {
        guard let p = meta["chatProblem"] else { return nil }
        let lines = p["lines"]?.arrayValue?.compactMap(\.stringValue).filter { !$0.isEmpty } ?? []
        guard !lines.isEmpty, let cell = p["cell"].flatMap(BrainRect.init(meta:)), cell.w > 0, cell.h > 0 else { return nil }
        let block = meta.string(HandPace.blockMeta)
        let n = p["n"]?.numberValue.map { String(Int($0)) } ?? "0"
        return ChatCell(key: block.isEmpty ? "\(n):\(lines.joined(separator: ";"))" : block, lines: lines, head: bounds, cell: cell)
    }

    /// The chat's problems on this screen (`readProblemCells`), from the tutor's strokes.
    func chatCells() -> [ChatCell] {
        if let cells = learn.chatCells { return cells }
        var byKey = OrderedMap<String, ChatCell>()
        for r in board.store.drawables(on: board.currentScreenID) {
            guard case .stroke(let s) = r, s.author == .tutor, s.meta["chatProblem"] != nil, let c = Self.chatProblem(s.meta, bounds: StrokeBounds.of(s)) else { continue }
            if var known = byKey[c.key] {
                known.head = known.head.union(c.head)
                byKey[c.key] = known
            } else {
                byKey[c.key] = c
            }
        }
        let cells = byKey.orderedValues
        learn.chatCells = cells
        return cells
    }

    /// The chat's problem whose cell a line is in (`cellOf`): its middle inside the cell, below the
    /// problem's top — or beside the problem, on its row.
    func chatCell(for st: LiveLine) -> ChatCell? {
        let b = st.bounds
        let cx = b.x + b.w / 2
        let cy = b.y + b.h / 2
        for c in chatCells() {
            let r = c.cell
            if cx < r.x || cx > r.x + r.w || cy > r.y + r.h { continue }
            if (cy < r.y || cy < c.head.y) && !Self.besideProblem(b, c.head) { continue }
            return c
        }
        return nil
    }
}
