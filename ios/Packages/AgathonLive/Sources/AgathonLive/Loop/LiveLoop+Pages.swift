import AgathonBoard
import AgathonBrain
import Foundation

/// One problem per page (docs/PROBLEM-PAGES.md): on a problem page all the ink is judged against the
/// page's problem; a second problem the kid starts is never ringed and is offered a page of its own
/// ("New page for this one", one undo step); a solved page offers Next; the set ends on All done.
/// Also the judging rules that hold on every page: a true step is never ringed, one answer of several
/// is no slip, a bare number in the answer spot answers the problem's letter.
extension LiveLoop {
    // MARK: - the page's problem

    /// On a problem page, the page's problem (a `problem` record of the tutor's on it): it heads every
    /// column on the page.
    func pageHead() -> RecordID? {
        guard let page = board.currentProblemPage, page.kind == .problem else { return nil }
        if let p = page.problem, heads.contains(where: { $0.id == p }) { return p }
        return heads.first?.id
    }

    /// `anchorAtProblems` on a problem page: every line's home is the page's problem.
    func pageHomes(_ input: [InkLine]) -> [RecordID?]? {
        guard let head = pageHead() else { return nil }
        return input.map { _ in head }
    }

    /// The letters of the problem a line is part of: the page's (or its column's tutor problem),
    /// else its column's first line (the kid's own problem).
    func problemLetters(for st: LiveLine) -> Set<Character> {
        if let own = ownHeadAbove(st), let line = lines[own] { return ReadingContext.letters([line.latex]) }
        if let head = head(for: st.column) { return ReadingContext.letters(head.lines) }
        if let first = columnLines(st.column).first(where: { !$0.latex.isEmpty }) { return ReadingContext.letters([first.latex]) }
        return []
    }

    /// The kid's own problem a line is under in its column (a line that started one), if any.
    func ownHeadAbove(_ st: LiveLine) -> String? {
        columnLines(st.column).last { $0.row <= st.row && pages.ownHeads.contains($0.id) }?.id
    }

    // MARK: - judging on the page (analyze's review of each line)

    /// What a line is judged as: a bare number in the answer spot answers the problem's one letter
    /// (`3` under `4x - 5 = 7` is `x = 3`); otherwise its reading.
    func judgedForm(_ st: LiveLine) -> String {
        guard inAnswerSpot(st.bounds), st.latex.range(of: #"^\s*=?\s*-?\s*\d+(?:\.\d+)?\s*$"#, options: .regularExpression) != nil else { return st.latex }
        let letters = problemLetters(for: st)
        guard letters.count == 1, let v = letters.first else { return st.latex }
        let n = st.latex.replacingOccurrences(of: #"^\s*=\s*"#, with: "", options: .regularExpression)
        return "\(v) = \(n)"
    }

    /// The engine's verdict looked at again before anything is marked (docs/PROBLEM-PAGES.md, "The new
    /// judging rules"):
    ///  - a line that starts a problem of the kid's own (after a solved line, or with none of the
    ///    problem's letters) is no slip: it heads what follows (`ownHead`);
    ///  - a true statement on its own (`3 × 4 = 12`, `2(x+1) = 2x + 2`) is no slip;
    ///  - one answer of several (`x = 2` of `x² − 5x + 6 = 0`) is a right step, not solved.
    ///
    /// `side`: the line is true on its own but no step of the problem's chain (a side fact in an
    /// algebra problem, an identity): the next line is not judged against it.
    func reviewOnPage(_ st: LiveLine, _ a: LineAnalysis, judged: String, solvedAbove: Bool, problem: [String],
                      original: LineAnalysis?) async -> (analysis: LineAnalysis, ownHead: Bool, side: Bool) {
        pages.partial.remove(st.id)
        // the pages alone (the first part): judged as the loop judges
        guard pages.extras else { return (a, false, false) }
        var a = a
        // a bare number answering the letter is the answer, not a lone symbol to keep quiet about
        if judged != st.latex { a.bareAnswer = true }
        // a sum of numbers in a problem with letters (`3 × 4 = 12` beside `4x - 5 = 7`) is side work,
        // and so is an identity (true for every x: `2(x + 1) = 2x + 2`)
        let theirs = ReadingContext.letters(problem)
        let mine = ReadingContext.letters([judged])
        let identity = a.kind == "equation" && a.variable != nil && a.solutions?.isEmpty == true
        let sideWork = (!theirs.isEmpty && mine.isEmpty && a.bareAnswer != true) || identity
        // a relation that does not follow, after a solved line or with none of the problem's letters:
        // the kid's own next problem (the engine calls a new letter's equation none or unknown, not a slip)
        if a.verdict != "ok", a.solved != true, a.bareAnswer != true,
           a.kind == "equation" || a.kind == "inequality" {
            let otherLetters = !mine.isEmpty && !theirs.isEmpty && mine.isDisjoint(with: theirs)
            if solvedAbove || otherLetters {
                var r = a
                r.verdict = "none"
                r.note = ""
                return (r, true, false)
            }
        }
        guard a.verdict == "mismatch", a.solved != true else { return (a, false, sideWork) }
        var r = a
        if let alone = try? await brain.analyzeLine(judged, context: AnalyzeContext(mode: .answer)), alone.verdict == "ok" {
            r.verdict = "none"
            r.note = ""
            return (r, false, true)
        }
        if let roots = original?.solutions, roots.count > 1, a.kind == "equation" || a.kind == "assignment" {
            for root in roots where (try? await brain.verifyExpected(root, latex: judged)) == .equal {
                r.verdict = "ok"
                r.note = ""
                pages.partial.insert(st.id)
                return (r, false, true)
            }
        }
        return (r, false, sideWork)
    }

    // MARK: - a second problem: "New page for this one"

    /// The offer, for the newest problem of the kid's own on the page (a line that started one, or on a
    /// page with no problem of the tutor's, a second column of their own work), unless they kept it here.
    func refreshOffer() {
        guard pages.extras else {
            if pages.offer != nil { pages.offer = nil }
            return
        }
        var candidate: LiveLine?
        for id in pages.ownHeads {
            guard let st = lines[id], !pages.keptHere.contains(id), !st.latex.isEmpty else { continue }
            if candidate.map({ ($0.bounds.y, $0.bounds.x) < (st.bounds.y, st.bounds.x) }) ?? true { candidate = st }
        }
        if candidate == nil, pageHead() == nil {
            // a free page: the kid's problems are its columns; from the second on, each is offered a page
            let starts = Set(lines.values.map(\.column)).sorted().compactMap { c -> LiveLine? in
                guard head(for: c) == nil, let first = columnLines(c).first(where: { !$0.latex.isEmpty }),
                      let kind = first.analysis?.kind, kind == "equation" || kind == "inequality" || kind == "expression" else { return nil }
                return first
            }
            if starts.count >= 2 {
                candidate = starts.dropFirst().filter { !pages.keptHere.contains($0.id) }
                    .max { ($0.bounds.y, $0.bounds.x) < ($1.bounds.y, $1.bounds.x) }
            }
        }
        // an offer waits for its line's check (when done): the kid may still be writing it
        let offer = candidate.flatMap { st -> NewPageOffer? in
            if isHeld(st) && !settled { return nil }
            return NewPageOffer(id: st.id, lines: ownProblemLines(st).map(\.id), anchor: st.bounds)
        }
        if pages.offer != offer { pages.offer = offer }
    }

    /// The lines of the kid's problem that starts at `head`: it and every line after it in its column,
    /// to the next problem of their own (a whole column, for a free page's second column).
    func ownProblemLines(_ head: LiveLine) -> [LiveLine] {
        var out: [LiveLine] = []
        for st in columnLines(head.column) where st.row >= head.row {
            if st.id != head.id && pages.ownHeads.contains(st.id) { break }
            out.append(st)
        }
        return out
    }

    /// "New page for this one": the problem's ink moves to a new page right after this one, its first
    /// line at the top as the page's problem; what the tutor read and marked of it goes with the move
    /// (it is read again from the cache there). One undo step.
    public func takeNewPage() {
        guard let offer = pages.offer, let head = lines[offer.id] else { return }
        let moving = ownProblemLines(head)
        let strokes = moving.flatMap(\.ink.strokeIds).map { RecordID($0) }
        guard !strokes.isEmpty else { return }
        let screen = board.currentScreenID
        var gone: [RecordID] = []
        for st in moving {
            let lineRecord = RecordID("line:\(st.id)")
            if board.store[lineRecord] != nil { gone.append(lineRecord) }
            gone += board.store.liveRecords(on: screen, lineId: st.id).map(\.id)
            for case .mark(let m) in board.store.semantic(on: screen) where m.target == lineRecord { gone.append(m.id) }
        }
        let rect = board.screenRect
        let k = rect.w / Box.screen.w
        let origin = ProblemPageLayout.place(ProblemPageLayout.problemOrigin, on: rect.box)
        let offset = Vec2(origin.x - head.bounds.x, origin.y - head.bounds.y)
        let headBottom = (head.bounds.maxY - head.bounds.y) / k + ProblemPageLayout.problemOrigin.y
        let page = ProblemPage(kind: .problem, origin: "student", workTop: ProblemPageLayout.workTop(problemBottom: headBottom), answer: ProblemPagesRollout.secondPart)
        pages.offer = nil
        guard board.moveToNewScreen(strokes, offset: offset, meta: [ProblemPage.metaKey: page.json], alsoRemove: gone) != nil else { return }
        // the loop takes the new page in now (not when the board's notice arrives)
        switchScreen()
    }

    /// "Keep it here": the problem stays, judged as its own; the offer does not come back for it.
    public func keepHere() {
        guard let offer = pages.offer else { return }
        pages.keptHere.insert(offer.id)
        pages.offer = nil
        refreshPage()
    }

    // MARK: - Next, All done

    /// Next problem (or All done): the page after this one.
    public func nextPage() {
        let ids = board.store.screenIDs
        guard let i = ids.firstIndex(of: board.currentScreenID), i + 1 < ids.count else { return }
        board.goToScreen(ids[i + 1])
    }

    /// A page of the set (the All done page's stickers).
    public func goToPage(_ id: String) {
        let rid = RecordID(id)
        guard board.store[rid]?.screen != nil else { return }
        board.goToScreen(rid)
    }

    /// On the All done page: each problem of its set, and how it went (the learning record's latest
    /// outcome for it this session, else what its page shows).
    func refreshSetProblems() {
        guard let done = board.currentProblemPage, done.kind == .done, let set = done.setId else {
            if !pages.setProblems.isEmpty { pages.setProblems = [] }
            return
        }
        let store = board.store
        let attempts = learning.attempts()
        var out: [SetProblem] = []
        for id in store.screenIDs {
            guard let p = store[id]?.screen?.problemPage, p.kind == .problem, p.setId == set else { continue }
            let latex = Self.problemLatex(on: id, in: store)
            let key = DailyProgress.problemKey(latex)
            let attempt = key.isEmpty ? nil : attempts.last { DailyProgress.problemKey($0.problemLatex) == key && $0.outcome != .inProgress }
            let outcome: SetProblem.Outcome
            switch attempt?.outcome {
            case .firstTry?, .selfCorrected?: outcome = .alone
            case .withHelp?: outcome = .withHelp
            case .tutorSolved?: outcome = .together
            default: outcome = Self.pageOutcome(id, in: store)
            }
            out.append(SetProblem(id: id.rawValue, number: p.index ?? out.count + 1, outcome: outcome))
        }
        if pages.setProblems != out { pages.setProblems = out }
    }

    /// A page's problem as LaTeX: its tutor's `problem` record, else the chat problem on its strokes.
    static func problemLatex(on screen: RecordID, in store: BoardStore) -> String {
        for case .problem(let p) in store.semantic(on: screen) where p.origin != "student" {
            if let latex = p.latex, !latex.isEmpty { return latex }
        }
        for r in store.drawables(on: screen) {
            if let lines = r.meta["chatProblem"]?["lines"]?.arrayValue?.compactMap(\.stringValue), !lines.isEmpty {
                return lines.joined(separator: "\n")
            }
        }
        return ""
    }

    /// What a page shows of how it went: solved by the tutor's working, solved, or not yet.
    static func pageOutcome(_ screen: RecordID, in store: BoardStore) -> SetProblem.Outcome {
        let solved = store.semantic(on: screen).contains { if case .line(let l) = $0 { return l.verdict == .solved } else { return false } }
        guard solved else { return .notYet }
        let tutorWorked = store.drawables(on: screen).contains { $0.meta[LiveMeta.solvedLatex] != nil }
        return tutorWorked ? .together : .alone
    }

    // MARK: - Now you try on its own page

    /// Now you try's problem goes on a page of its own, right after this one (a problem page, origin
    /// `nowYouTry`): the board shows it, and the problem is written at its top. Nil at the page cap.
    func ownPageForProblem(origin: String) -> AgathonBrain.Point? {
        let page = ProblemPage(kind: .problem, origin: origin, answer: ProblemPagesRollout.secondPart)
        guard board.insertScreen(after: nil, meta: [ProblemPage.metaKey: page.json], go: true) != nil else { return nil }
        if board.currentScreenID != screenSeen { switchScreen() }
        let o = ProblemPageLayout.place(ProblemPageLayout.problemOrigin, on: board.screenRect.box)
        return AgathonBrain.Point(x: o.x, y: o.y)
    }

    /// The page's problem was written: the page knows its record and where its work starts.
    func pageProblemWritten(_ id: RecordID, bounds: BrainRect) {
        let screen = board.currentScreenID
        guard var page = board.currentProblemPage, page.kind == .problem else { return }
        let local = ProblemPageLayout.unplace(bounds.box, from: board.screenRect.box)
        page.problem = id
        page.workTop = ProblemPageLayout.workTop(problemBottom: local.maxY)
        board.setProblemPage(page, on: screen)
    }
}
