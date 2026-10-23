import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation

extension LiveLoop {
    // MARK: - which line Help acts on

    /// The line Help me and Solve it act on: one the kid picked with the select tool, else the line
    /// their pen last wrote in, else the line read last.
    public func helpTargetLine() -> LiveLine? {
        let picked = board.selection.compactMap { id -> LiveLine? in
            if let line = lineOfStroke(id.rawValue) { return line }
            if let lineId = board.store[id]?.meta.string(LiveMeta.lineId), let line = lines[lineId] { return line }
            if id.prefix == "line" { return lines[String(id.key)] }
            return nil
        }
        if let line = picked.max(by: { ($0.column, $0.row) < ($1.column, $1.row) }) { return line }
        if let pen = penLineId, let line = lines[pen] { return line }
        if let last = lastTouchedLineId, let line = lines[last] { return line }
        return lines.values.max { $0.updatedAt < $1.updatedAt }
    }

    /// Ink the tutor cannot read as maths: a failed or unsure read, a label, a lone symbol, prose of
    /// a word or two. Help puts its "?" beside it (write it again) rather than a guess at it.
    func needsLook(_ st: LiveLine) -> Bool {
        if st.latex.isEmpty || st.confidence < LiveLimits.minConfidence { return true }
        guard let a = st.analysis else { return true }
        if a.kind == "text" { return !LivePolicy.isProblemProse(latex: st.latex, analysis: a) }
        return a.kind == "label" || (LivePolicy.isSingleSymbolLatex(st.latex) && a.bareAnswer != true)
    }

    // MARK: - Help me

    /// Help me, by the dial: Hint (Feedback) opens a hint card, Next step (Suggest) writes the next
    /// step by hand, Solve it writes the rest of the problem. The line it acts on is still being
    /// read: it waits for the read.
    public func helpMe() {
        guard settings.enabled, settings.mode != .off else { return }
        noteAsked()
        // check when done: Help me checks the line's column first (its marks come with the help)
        if checksWhenDone, let target = helpTargetLine(), !reading.contains(target.id) { releaseColumn(target.column, reason: .help) }
        if helpAfterRead() { return }
        _ = helpNow()
    }

    /// Solve it: the rest of the problem, whatever the dial says (the kid's own ask).
    public func solveIt() {
        guard settings.enabled else { return }
        noteAsked()
        requestSolve(lineId: nil, asked: true)
    }

    func helpAfterRead() -> Bool {
        guard let target = helpTargetLine(), reading.contains(target.id) else { return false }
        if helpWaitTimer != nil { return true }
        let id = target.id
        let deadline = scheduler.now + LiveTiming.helpReadWaitMs
        func look() {
            helpWaitTimer = scheduler.after(100) { [weak self] in
                guard let self else { return }
                self.helpWaitTimer = nil
                if self.reading.contains(id) && self.scheduler.now < deadline {
                    look()
                    return
                }
                _ = self.helpNow()
            }
        }
        look()
        return true
    }

    @discardableResult
    func helpNow() -> Bool {
        guard let target = helpTargetLine() else {
            say(LiveCopy.Help.nothingYet)
            return false
        }
        if needsLook(target) {
            syncMark(target, .question, LivePolicy.unjudgedReason(latex: target.latex, confidence: target.confidence, provider: target.provider, analysis: target.analysis) ?? "unread")
            openHint(target, message: LiveCopy.Hint.unread, question: nil, level: 1)
            return true
        }
        if target.analysis?.solved == true {
            // nothing left to do on this one
            say(LiveCopy.Help.nothingYet)
            return false
        }
        switch settings.mode {
        case .off: return false
        case .answer: requestSolve(lineId: target.id, asked: true)
        case .feedback: hint(target)
        case .suggest: escalate(target.id)
        }
        return true
    }

    /// The kid asked: Auto's quiet ends (what fails now is theirs to see), Auto adds nothing of its
    /// own until they write again, and with Auto off the problem asked about gets its marks now.
    func noteAsked(_ lineId: String? = nil) {
        // the learning record: an explicit ask about this problem (before what it changes below)
        learnAsk(lineId)
        autoLines.removeAll()
        askedSinceInk = true
        if lastFailure != nil { clearFailure() }
        guard !settings.auto, settings.enabled, settings.mode != .off, let target = lineId.flatMap({ lines[$0] }) ?? helpTargetLine() else { return }
        for st in columnLines(target.column) where askedLines[st.id] != st.latex {
            askedLines[st.id] = st.latex
            if !st.latex.isEmpty { render(st.id, quiet: true) }
        }
    }

    // MARK: - the ladder: a hint, a closer look, one step

    /// Hint (Feedback): the hint card with the model's words about the line (where to look, never
    /// the answer); More help on it goes on to the next step.
    func hint(_ target: LiveLine) {
        if let open = hints.first(where: { $0.lineId == target.id }) {
            moreHelp(open)
            return
        }
        let wrong = target.analysis?.verdict == "mismatch" || target.isModelFlagged
        if target.analysis?.verdict == "mismatch", !target.isModelFlagged, let writer = hintWriter, writer.isReady {
            // the engine found the slip: the iPad words where to look; the server only if it cannot
            hintOnDevice(target, writer: writer)
        } else if wrong || target.analysis?.verdict == "unknown" {
            startCheck(column: target.column, focus: target.id, userAsked: true, forceHint: true)
        } else {
            openHint(target, message: "Your steps so far look right.", question: "What could you do next?", level: 1)
        }
    }

    /// The next help for a line (Suggest's Help me, More help on a card): a wrong line gets the right
    /// step beside it; a right one its next step (`localSolve`, else the model's first step).
    public func escalate(_ id: String) {
        guard let target = lines[id], !target.latex.isEmpty, settings.mode != .off else { return }
        hints.removeAll { $0.lineId == id }
        rt[id]?.escalation += 1
        let wrong = target.analysis?.verdict == "mismatch" || target.isModelFlagged
        if wrong {
            if suggestNextStep(id, now: true) { return }
            if let good = lastGoodLineAbove(target) {
                startSolve(column: target.column, fromLineId: good.id, lineId: good.id, onlyFirstStep: true)
                return
            }
        }
        if writeNextStep(target) { return }
        startSolve(column: target.column, fromLineId: id, lineId: id, onlyFirstStep: true)
    }

    // MARK: - hint cards

    func openHint(_ st: LiveLine, message: String, question: String?, level: Int) {
        guard !message.isEmpty else { return }
        // pointed with the ink, never "line 4" (a server's or a model's words alike)
        let message = LiveCopy.Hint.pointing(message)
        let question = question.map(LiveCopy.Hint.pointing)
        let card = HintCard(id: "\(st.id):\(level):\(message.hashValue)", lineId: st.id, anchor: st.bounds,
                            title: LiveCopy.Hint.level(level), message: message, question: question, level: level)
        hints = [card]
        lines[st.id]?.hintsShown += 1
        rt[st.id]?.shownHints.insert(message)
        tracker.helped(problem: problemKey(for: st), solved: false)
    }

    /// Got it: the card closes.
    public func dismissHint(_ id: String) {
        hints.removeAll { $0.id == id }
    }

    /// More help: the next rung (the next step, by hand).
    public func moreHelp(_ card: HintCard) {
        hints.removeAll { $0.id == card.id }
        noteAsked(card.lineId)
        escalate(card.lineId)
    }

    // MARK: - check (SSE)

    /// The column's lines as check and solve take them (operation lines and unread lines left out),
    /// the tutor's problem above them first.
    func buildCheckLines(_ column: Int) -> (lines: [CheckLine], region: BrainRect, states: [LiveLine])? {
        let states = columnLines(column).filter { !$0.latex.isEmpty && $0.analysis?.kind != "operation" }
        guard !states.isEmpty else { return nil }
        let head = head(for: column)
        guard let region0 = BrainRect.around(states.map(\.bounds) + (head.map { [$0.rect] } ?? [])) else { return nil }
        let region = region0.expanded(24)
        var out: [CheckLine] = []
        if let head {
            for (i, latex) in head.lines.prefix(3).enumerated() {
                let a = i < head.analyses.count ? head.analyses[i] : nil
                out.append(CheckLine(id: "chat-problem-\(head.id.key)-\(i)", latex: String(latex.prefix(2000)), bbox: region.normalized(head.rect),
                                     local: .init(kind: a?.kind ?? "unknown", verdict: a?.verdict ?? "none")))
            }
        }
        for s in states.suffix(LiveLimits.maxLinesPerCheck - out.count) {
            let a = s.analysis
            out.append(CheckLine(id: s.id, latex: String(s.latex.prefix(2000)), bbox: region.normalized(s.bounds),
                                 local: .init(kind: a?.kind ?? "unknown", verdict: a?.verdict ?? "unknown",
                                              resultLatex: (a?.resultLatex).flatMap { $0.isEmpty ? nil : String($0.prefix(500)) },
                                              note: (a?.note).flatMap { $0.isEmpty ? nil : String($0.prefix(200)) })))
        }
        return (out, region, states)
    }

    /// `/api/live/check` on a column: each annotation becomes a ring (and, asked for or allowed,
    /// a hint card); praise changes nothing (a tick is only ever what the engine verified).
    func startCheck(column: Int, focus: String, userAsked: Bool, forceHint: Bool = false) {
        guard settings.enabled, settings.mode != .off, let built = buildCheckLines(column) else { return }
        guard connectivity.isOnline else {
            if userAsked { pendingChecks[focus] = true }
            refreshActivity()
            return
        }
        if inkOut || slowUntil > scheduler.now {
            refreshActivity()
            return
        }
        rt[focus, default: LineRuntime()].checkTask?.cancel()
        let request = CheckRequest(boardId: boardId, mode: settings.mode == .feedback ? "feedback" : "suggest",
                                   region: built.region.region, lines: built.lines, focusLineId: focus, userAsked: userAsked)
        let started = scheduler.now
        let gen = generation
        checking += 1
        refreshActivity()
        count("check")
        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            var first = true
            var carded = false
            var failed = false
            do {
                for try await event in self.services.check(request) {
                    guard gen == self.generation, !Task.isCancelled else { break }
                    switch event {
                    case .annotation(let a):
                        if first {
                            first = false
                            self.metrics.checkFirstAnnotation.append(self.scheduler.now - started)
                        }
                        if await self.applyAnnotation(a, focus: focus, userAsked: userAsked, forceHint: forceHint) { carded = true }
                    case .error(let e):
                        failed = true
                        self.fail(StreamFailure(e), kind: "check", lineId: focus, retry: .check(lineId: focus, userAsked: userAsked, forceHint: forceHint))
                    default:
                        break
                    }
                }
            } catch {
                if !Task.isCancelled && gen == self.generation {
                    failed = true
                    if LiveFailure.from(error) == .offline && userAsked { self.pendingChecks[focus] = true }
                    self.fail(error, kind: "check", lineId: focus, retry: .check(lineId: focus, userAsked: userAsked, forceHint: forceHint))
                }
            }
            guard gen == self.generation else { return }
            self.checking = max(0, self.checking - 1)
            if self.rt[focus]?.checkTask != nil { self.rt[focus]?.checkTask = nil }
            if !failed && !Task.isCancelled {
                self.noteSuccess()
                if forceHint && !carded, let st = self.lines[focus] { self.localHint(st) }
            }
            self.refreshActivity()
            self.questionIfSettled(focus)
        }
        rt[focus, default: LineRuntime()].checkTask = task
        track { await task.value }
    }

    /// A hint for a step the engine found wrong, worded on the iPad (`HintWording`): the engine's
    /// facts in, one checked sentence out; anything the rules refuse goes to the server's check.
    func hintOnDevice(_ target: LiveLine, writer: HintWriter) {
        let id = target.id
        let latex = target.latex
        let started = scheduler.now
        checking += 1
        refreshActivity()
        track { [weak self] in
            guard let self else { return }
            let facts = HintFacts(previous: self.lastGoodLineAbove(target)?.latex, line: latex,
                                  expected: await self.rightNextStep(target), note: target.analysis?.note ?? "")
            let raw = await writer.write(facts)
            self.checking = max(0, self.checking - 1)
            self.refreshActivity()
            guard let cur = self.lines[id], cur.latex == latex else { return }
            if let words = HintWording.accept(raw, facts: facts) {
                self.metrics.deviceHint.append(self.scheduler.now - started)
                self.openHint(cur, message: words, question: nil, level: 1)
                // the learning record: the hint the kid asked for (the web's check would have said it)
                self.learnHint(id)
            } else {
                if raw != nil { self.metrics.deviceHintRefused += 1 }
                self.startCheck(column: cur.column, focus: id, userAsked: true, forceHint: true)
            }
        }
    }

    /// The engine's own words, when the kid asked for a hint and the model had none for the line.
    func localHint(_ st: LiveLine) {
        let wrong = st.analysis?.verdict == "mismatch" || st.isModelFlagged
        let note = st.analysis?.note ?? ""
        openHint(st, message: wrong ? (note.isEmpty ? LiveCopy.Hint.lookAgain : note) : "Your steps so far look right.",
                 question: wrong ? nil : "What could you do next?", level: 1)
        // the learning record: words about a slip, asked for, are a hint
        if wrong { learnHint(st.id) }
    }

    /// One annotation: a ring and its words. True when it opened a hint card.
    func applyAnnotation(_ a: Annotation, focus: String, userAsked: Bool, forceHint: Bool) async -> Bool {
        let id = a.lineId.flatMap { lines[$0] != nil ? $0 : nil } ?? focus
        guard let st = lines[id] else { return false }
        if a.verdict == .warn && st.analysis?.verdict == "ok" { return false }
        if let expected = a.expected, !expected.isEmpty,
           (try? await brain.verifyExpected(expected, latex: st.latex)) == .equal { return false }
        if a.kind == "praise" || a.kind == "notation" { return false }
        // a line still being written is no mistake (SAT v2 end-to-end run, 2026-10-23: the model's "This
        // equation stops abruptly after the minus sign" ringed `3y = 21 -` mid-thought): a line not checked
        // yet (held: unfinished, ending in `=` or an operator) or a warn that says only "unfinished" is never
        // ringed unasked; asked about, its words may still come as a card
        let unfinished = a.kind == "incomplete" || isHeld(st)
        if a.verdict == .warn && unfinished && !userAsked && !forceHint { return false }
        guard a.verdict == .warn || (forceHint && id == focus) else { return false }
        guard let cur = lines[id], cur.latex == st.latex else { return false }
        if a.verdict == .warn && !unfinished {
            lines[id]?.modelWarned = cur.latex
            persistLine(id)
            if let fresh = lines[id] {
                syncMark(fresh, .circle)
                updateVerdict(fresh, "warn")
                // the learning record: the kind of mistake the model saw — and, asked for, its words are a hint
                learnAnnotation(fresh, a, userAsked: userAsked)
            }
        }
        var carded = false
        let d = decision(cur, userAsked: userAsked)
        if forceHint || userAsked || d.allowHint, !(rt[id]?.shownHints.contains(a.message) ?? false) {
            openHint(cur, message: a.message, question: settings.mode == .feedback && !forceHint ? nil : a.question, level: 1)
            carded = true
        }
        if a.verdict == .warn && !forceHint && !unfinished { suggestNextStep(id) }
        return carded
    }

    // MARK: - solve

    /// Solve it on a line (or the line Help acts on): the line's `=` answered now, else the rest of
    /// its problem — the engine first, a word problem's setup, else the model's worked solution.
    public func requestSolve(lineId: String?, asked: Bool = true) {
        guard let target = lineId.flatMap({ lines[$0] }) ?? helpTargetLine(), !target.latex.isEmpty else {
            say(LiveCopy.Help.nothingYet)
            return
        }
        let id = target.id
        // a line the kid ended with `=`: finished where they left off, now
        if let a = target.analysis, a.kind == "expression", !a.resultLatex.isEmpty, LivePolicy.endsWithRelation(target.latex) {
            var d = decision(target, userAsked: true)
            d.showResult = d.echo
            if inlineAnswer(target, d) { return }
        }
        let col = columnLines(target.column).filter { !$0.latex.isEmpty && $0.analysis?.kind != "operation" }
        let lastOk = col.last { $0.analysis?.verdict == "ok" || $0.analysis?.solved == true }
        startSolve(column: target.column, fromLineId: lastOk?.id ?? id, lineId: id, onlyFirstStep: false, askedAt: scheduler.now)
    }

    func startSolve(column: Int, fromLineId: String?, lineId: String, onlyFirstStep: Bool, askedAt: Double? = nil) {
        guard settings.enabled, let built = buildCheckLines(column), let st = lines[lineId] ?? built.states.last else { return }
        let asked = askedAt ?? scheduler.now
        let gen = generation
        solving += 1
        refreshActivity()
        track { [weak self] in
            guard let self else { return }
            defer {
                if gen == self.generation { self.solving = max(0, self.solving - 1) }
                self.refreshActivity()
            }
            let wrote = await self.writeLocal(built, st: st, onlyFirstStep: onlyFirstStep, askedAt: asked)
            guard gen == self.generation else { return }
            switch wrote {
            case .written, .nothing:
                return
            case .simplest:
                if !self.autoLines.contains(lineId) { self.say(LiveCopy.Help.simplest) }
                return
            case .none:
                break
            }
            guard self.connectivity.isOnline else {
                if !self.autoLines.contains(lineId) { self.pendingSolve = lineId }
                return
            }
            if self.inkOut || self.slowUntil > self.scheduler.now { return }
            let upto = built.states.firstIndex { $0.id == lineId }.map { Array(built.states.prefix($0 + 1)) } ?? built.states
            if upto.contains(where: { LivePolicy.isProblemProse(latex: $0.latex, analysis: $0.analysis) }) {
                if await self.solveWordProblem(built, upto: upto.map(\.latex), st: st, onlyFirstStep: onlyFirstStep, askedAt: asked) { return }
            }
            await self.solveWithModel(built, fromLineId: fromLineId, st: st, onlyFirstStep: onlyFirstStep, askedAt: asked)
        }
    }

    enum LocalOutcome { case written, nothing, simplest, none }

    /// What Solve writes without a model (`localSolve`), by hand under the work (typeset when the hand
    /// lacks a symbol). A solution already on the page is not written twice.
    func writeLocal(_ built: (lines: [CheckLine], region: BrainRect, states: [LiveLine]), st: LiveLine, onlyFirstStep: Bool, askedAt: Double) async -> LocalOutcome {
        let latexes = built.states.map(\.latex)
        let head = head(for: st.column)?.lines ?? []
        let idx = built.states.firstIndex { $0.id == st.id }
        let target = idx.map { $0 + head.count }
        guard let local = try? await brain.localSolve(head + latexes, options: LocalSolveOptions(targetIndex: target, handwriting: settings.handwriting)),
              local.source != nil else {
            if st.analysis?.kind == "expression", !LivePolicy.endsWithRelation(st.latex), st.latex.range(of: "[a-zA-Z]", options: .regularExpression) != nil {
                // a lone expression with nothing to do to it: `2x^{2}`
                if let simplified = try? await brain.localSolve([st.latex]), simplified.source == nil { return .simplest }
            }
            return .none
        }
        let steps = onlyFirstStep ? Array(local.steps.prefix(1)) : Array(local.steps.prefix(LiveLimits.maxSolveSteps))
        guard !steps.isEmpty else { return .nothing }
        let key = local.source == "solveLatex" ? st.latex : steps.joined(separator: " ; ")
        if !onlyFirstStep && hasHandSolution(st.id, key: key) { return .nothing }
        if !onlyFirstStep { clearSolveOutput(built.states.map(\.id)) }
        let meta: Meta = onlyFirstStep ? [:] : [LiveMeta.solvedLatex: .string(key)]
        let problem = problemKey(for: st)
        await writeSteps(steps, for: st, column: st.column, meta: meta) { [weak self] in
            guard let self else { return }
            if !onlyFirstStep { self.tutorSolved(problem: problem, lines: head + latexes) }
        }
        metrics.solveFirstStep.append(scheduler.now - askedAt)
        tracker.helped(problem: problem, solved: !onlyFirstStep)
        learnSolveWritten(st, onlyFirstStep: onlyFirstStep)
        return .written
    }

    /// A word problem: the model sets it up (`/api/live/setup`), the engine solves the setup, and the
    /// tutor writes both as one block. False: the setup did not hold up (the model's solution then).
    func solveWordProblem(_ built: (lines: [CheckLine], region: BrainRect, states: [LiveLine]), upto: [String], st: LiveLine, onlyFirstStep: Bool, askedAt: Double) async -> Bool {
        let key = "problem: \(upto.joined(separator: " ; "))"
        if !onlyFirstStep && hasHandSolution(st.id, key: key) { return true }
        count("setup")
        let res: SetupResponse
        do {
            res = try await services.setup(SetupRequest(boardId: boardId, lines: upto))
        } catch {
            let f = LiveFailure.from(error)
            if f == .outOfInk || f == .signedOut || { if case .rateLimited = f { return true } else { return false } }() {
                fail(error, kind: "setup", lineId: st.id, retry: .solve(lineId: st.id, onlyFirstStep: onlyFirstStep))
                return true
            }
            return false
        }
        if res.reason == "nothing_asked" {
            say("Nothing to solve here yet. Write what to find, like x = ?")
            return true
        }
        // every setup line must be maths the engine reads, with no words
        var setup: [String] = []
        for line in res.lines.map(SolveSteps.unwrapBoxed) where line.range(of: #"=|<|>|\\(?:le|ge|leq|geq|neq)(?![a-zA-Z])"#, options: .regularExpression) != nil {
            guard !ReadCheck.hasWords(line), await engineReads(line) else { return false }
            setup.append(line)
        }
        guard !setup.isEmpty, setup.count <= 4,
              let solved = try? await brain.localSolve(setup, options: LocalSolveOptions(handwriting: true)), solved.source != nil else { return false }
        let block = SolveSteps.block(setup, solved.steps, onlyFirst: onlyFirstStep)
        clearSolveOutput(built.states.map(\.id))
        let problem = problemKey(for: st)
        await writeSteps(block, for: st, column: st.column, meta: onlyFirstStep ? [:] : [LiveMeta.solvedLatex: .string(key)]) { [weak self] in
            if !onlyFirstStep { self?.tutorSolved(problem: problem, lines: upto) }
        }
        metrics.solveFirstStep.append(scheduler.now - askedAt)
        noteSuccess()
        learnSolveWritten(st, onlyFirstStep: onlyFirstStep)
        return true
    }

    /// `/api/live/solve`: the model's worked solution, each step checked by the engine before it is
    /// drawn, written as one block when the stream ends.
    func solveWithModel(_ built: (lines: [CheckLine], region: BrainRect, states: [LiveLine]), fromLineId: String?, st: LiveLine, onlyFirstStep: Bool, askedAt: Double) async {
        let asks = built.states.last { LivePolicy.endsWithEquals($0.latex) }
        let goal = asks.map { "what line id \($0.id) equals (\($0.latex.prefix(80))): continue it after its =, using any values the other lines give" }
        let request = SolveRequest(boardId: boardId, region: built.region.region, lines: built.lines, fromLineId: fromLineId,
                                   goal: goal.map { String($0.prefix(200)) })
        let given = Set(built.lines.map { SolveSteps.key($0.latex) })
        var accepted: [String] = []
        var discarded = 0
        var failed = false
        let gen = generation
        count("solve")
        do {
            for try await event in services.solve(request) {
                guard gen == generation, !Task.isCancelled else { return }
                switch event {
                case .step(let s):
                    var latex = SolveSteps.unwrapBoxed(s.latex)
                    // `= \frac{18}{45} = 0.4` under `4 \cdot 60 = 240` (SAT v2 end-to-end run): written there it says
                    // 240 = 18/45. A step goes on after `=` from an expression or a line ending in `=` (`asks`),
                    // never from a finished relation
                    if asks == nil, LiveLoop.continuesWithEquals(latex), let last = built.states.last?.latex,
                       last.range(of: #"=|<|>|\\(?:le|ge|leq|geq|neq)(?![a-zA-Z])"#, options: .regularExpression) != nil {
                        latex = LiveLoop.withoutLeadingEquals(latex)
                    }
                    let key = SolveSteps.key(latex)
                    if key.isEmpty || given.contains(key) || accepted.last.map(SolveSteps.key) == key { continue }
                    let reads = ReadCheck.hasWords(latex) ? false : await engineReads(latex)
                    if !reads {
                        discarded += 1
                        continue
                    }
                    accepted.append(latex)
                case .error(let e):
                    failed = true
                    fail(StreamFailure(e), kind: "solve", lineId: st.id, retry: .solve(lineId: st.id, onlyFirstStep: onlyFirstStep))
                default:
                    break
                }
                if onlyFirstStep && !accepted.isEmpty { break }
            }
        } catch {
            guard gen == generation, !Task.isCancelled else { return }
            if LiveFailure.from(error) == .offline && !autoLines.contains(st.id) { pendingSolve = st.id }
            fail(error, kind: "solve", lineId: st.id, retry: .solve(lineId: st.id, onlyFirstStep: onlyFirstStep))
            return
        }
        guard gen == generation else { return }
        if !accepted.isEmpty {
            noteSuccess()
            if !onlyFirstStep { clearSolveOutput(built.states.map(\.id)) }
            let problem = problemKey(for: st)
            let lines = built.states.map(\.latex)
            await writeSteps(accepted, for: st, column: st.column, meta: onlyFirstStep ? [:] : [LiveMeta.solvedLatex: .string(accepted.joined(separator: " ; "))]) { [weak self] in
                if !onlyFirstStep { self?.tutorSolved(problem: problem, lines: lines) }
            }
            metrics.solveFirstStep.append(scheduler.now - askedAt)
            tracker.helped(problem: problem, solved: !onlyFirstStep)
            learnSolveWritten(st, onlyFirstStep: onlyFirstStep)
        } else if !failed && discarded > 0 {
            fail(LiveFailure.other(LiveCopy.Help.solveFailed), kind: "solve", lineId: st.id, retry: .solve(lineId: st.id, onlyFirstStep: onlyFirstStep))
        }
    }

    /// A step written as the rest of a chain (`= 26x + 50`).
    nonisolated static func continuesWithEquals(_ latex: String) -> Bool {
        latex.trimmingCharacters(in: .whitespaces).hasPrefix("=")
    }

    /// The step on its own: `= \frac{18}{45} = 0.4` → `\frac{18}{45} = 0.4`.
    nonisolated static func withoutLeadingEquals(_ latex: String) -> String {
        var t = latex.trimmingCharacters(in: .whitespaces)
        while t.hasPrefix("=") { t = String(t.dropFirst()).trimmingCharacters(in: .whitespaces) }
        return t
    }

    // MARK: - Auto

    /// The kid paused: the model checks what the engine cannot judge; in Solve the latest problem
    /// is finished. Once per state of each problem; never offline, never with no ink.
    func autoPause(stopped: Bool) {
        autoChecks(column: nil, stopped: stopped)
        autoSolve()
    }

    func autoReady() -> Bool {
        started && settings.enabled && settings.mode != .off && settings.auto && engineReady && connectivity.isOnline && !inkOut
            && slowUntil <= scheduler.now && !signedOut
    }

    func autoKey(_ kind: String, _ st: LiveLine) -> String {
        let col = columnLines(st.column).filter { $0.row <= st.row && !$0.latex.isEmpty }.map(\.latex).joined(separator: "\n")
        return "\(kind)|\(board.currentScreenID)|\(col)"
    }

    /// True the first time this key is seen (and remembers it).
    func autoOnce(_ key: String) -> Bool {
        autoDone.insert(key).inserted
    }

    func autoChecks(column: Int?, stopped: Bool? = nil) {
        guard autoReady() else { return }
        var due: [Int: [LiveLine]] = [:]
        for st in lines.values {
            if let column, st.column != column { continue }
            guard !st.latex.isEmpty, !reading.contains(st.id), rt[st.id]?.checkTask == nil, !isHeld(st) else { continue }
            guard decision(st, settled: stopped ?? settled).runLlmCheck, !autoDone.contains(autoKey("check", st)) else { continue }
            due[st.column, default: []].append(st)
        }
        for (_, col) in due {
            guard let focus = col.max(by: { $0.row < $1.row }) else { continue }
            for st in col { _ = autoOnce(autoKey("check", st)) }
            autoLines.insert(focus.id)
            startCheck(column: focus.column, focus: focus.id, userAsked: false)
        }
    }

    /// Auto in Solve, at the pause: the latest problem finished, once per state of it.
    func autoSolve() {
        guard settings.mode == .answer, autoReady(), !askedSinceInk, writer == nil, solving == 0 else { return }
        guard let target = autoTarget(), autoWorkable(target), autoOnce(autoKey("solve", target)) else { return }
        autoLines.insert(target.id)
        requestSolve(lineId: target.id, asked: false)
    }

    /// Auto in Suggest: stuck for `stuckMs` on an unfinished problem, its next step, as Help me writes it.
    func autoStuck() {
        stuckTimer = nil
        guard settings.mode == .suggest, autoReady(), !askedSinceInk, writer == nil, solving == 0 else { return }
        guard let target = autoTarget(), autoWorkable(target, steps: true), autoOnce(autoKey("step", target)) else { return }
        autoLines.insert(target.id)
        escalate(target.id)
    }

    func armStuck() {
        stuckTimer?.cancel()
        stuckTimer = settings.auto && settings.mode == .suggest ? scheduler.after(LiveTiming.stuckMs) { [weak self] in self?.autoStuck() } : nil
    }

    /// The line Auto works on: where the pen last wrote (never a pick, never an old line).
    func autoTarget() -> LiveLine? {
        guard penStrokeId != nil, board.selection.isEmpty, let id = penLineId, let st = lines[id], !isHeld(st) else { return nil }
        return st
    }

    /// A line Auto may finish: maths the tutor judges, with a next step, not solved, no ring in its
    /// column, nothing still out for it — and not a lone expression nobody asked anything of.
    func autoWorkable(_ st: LiveLine, steps: Bool = false) -> Bool {
        guard let a = st.analysis else { return false }
        let kinds: Set<String> = steps ? ["equation", "expression", "inequality", "operation"] : ["equation", "expression", "inequality"]
        guard kinds.contains(a.kind), a.solved != true, !reading.contains(st.id), rt[st.id]?.checkTask == nil else { return false }
        if !a.resultLatex.isEmpty && LivePolicy.endsWithRelation(st.latex) { return false }
        if a.kind == "expression" && !LivePolicy.endsWithRelation(st.latex) { return false }
        return !columnLines(st.column).contains { $0.analysis?.verdict == "mismatch" || $0.isModelFlagged }
    }

    /// The kid is writing again: Auto's answers not yet written are stopped; the stuck pause restarts.
    func autoInk() {
        askedSinceInk = false
        for id in autoLines { rt[id]?.solveTask?.cancel() }
        armStuck()
    }

    // MARK: - a problem finished

    /// A line was ticked as solving its problem.
    func problemSolved(_ st: LiveLine) {
        let key = problemKey(for: st)
        if tracker.solvedByKid(problem: key) { offerNowYouTry(problem: key, lines: problemLines(st)) }
    }

    /// The tutor finished writing a problem's solution.
    func tutorSolved(problem key: String, lines: [String]) {
        tracker.tutorSolved(problem: key)
        offerNowYouTry(problem: key, lines: lines)
    }

    func problemLines(_ st: LiveLine) -> [String] {
        if let head = head(for: st.column) { return head.lines }
        return columnLines(st.column).filter { !$0.latex.isEmpty }.prefix(1).map(\.latex)
    }
}

/// An `error` event inside a check or solve stream, as an error the loop classifies.
struct StreamFailure: Error {
    let code: String
    let message: String
    init(_ e: StreamError) {
        code = e.code
        message = e.message
    }
}

extension LiveFailure {
    static func from(stream e: StreamFailure) -> LiveFailure {
        switch e.code {
        case "ink_empty", "credits_exhausted": return .outOfInk
        case "rate_limited": return .rateLimited(retryAfterMs: 30_000, fairUse: false)
        case "unauthorized": return .signedOut
        case "timeout", "upstream", "upstream_error": return .transient
        default: return .other(e.message)
        }
    }
}
