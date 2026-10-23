import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation
@testable import AgathonLive

/// The auto bench without the UI (docs/TRAINING-CENTER.md, "The headless bench"): each case on a fresh
/// problem page of a test board with the real loop on it — the problem written at the top in the
/// tutor's hand as the desk writes a practice page, every line written in the case's synthetic hand
/// (`StudentHand`) where the in-app bench writes it (`TrainingBench.origin`), all of a line's strokes
/// at once and the clock moved on by hand (no kid's pace: the network is the only wait), then Check —
/// and what the tutor did with each line observed and judged by the in-app bench's own code
/// (`TrainingBench.observe`, `TrainingJudge`). The regression fixtures replay through the same page
/// (`TrainingFixtureTests.replay`), so a failure saved from here replays exactly.
@MainActor
enum HeadlessBench {
    /// Between two lines (a kid's line break), and before Check.
    static let lineBreakMs = 1_400.0
    static let beforeCheckMs = 2_000.0
    static let afterCheckMs = 3_000.0

    // MARK: - the page

    /// A fresh problem page on `board` with `problem` at its top as the desk writes a practice page
    /// (`ProblemPageWriter`: the desk's check, the tutor's hand at 72 down to 32 at the problem origin,
    /// `chatProblem` on its strokes, the page its cell), or a page of the kid's own (`problem` nil).
    /// Returns the work area's top, nil when the desk refused the problem.
    static func page(_ problem: [String]?, on board: TestBoard, loop: LiveLoop, brain: Brain) async -> Double? {
        let screen = board.currentScreenID
        guard let problem else {
            board.setProblemPage(ProblemPage(kind: .problem, origin: "student", answer: ProblemPagesRollout.secondPart), on: screen)
            loop.problemsChanged()
            return ProblemPageLayout.defaultWorkTop
        }
        guard let checked = await deskCheck(problem, brain: brain) else {
            // a word problem: its words at the top, heading no column (`ProblemPageWriter`)
            guard let sentences = WordProblem.sentences(problem),
                  let plan = await WordProblem.plan(sentences, brain: brain, seedKey: "page:bench:1:\(sentences.joined(separator: ";"))") else { return nil }
            let page = ProblemPage(kind: .problem, setId: "bench", index: 1, count: 1, origin: "practice",
                                   workTop: ProblemPageLayout.workTop(problemBottom: plan.bounds.y + plan.bounds.h), answer: ProblemPagesRollout.secondPart)
            board.setProblemPage(page, on: screen)
            InstantPen(store: board.store, screen: screen).write(tutorLines(plan), meta: [WordProblem.meta: true, "lineId": "chat", "live": true, "source": "ai"])
            loop.problemsChanged()
            return page.resolvedWorkTop
        }
        let L = ProblemPageLayout.self
        var size = 72.0
        var plan: HandPlan?
        while size >= 32 {
            let request = HandwritingRequest(steps: checked.lines, size: size, seedKey: "page:bench:1:\(checked.lines.joined(separator: ";"))",
                                             origin: AgathonBrain.Point(x: L.problemOrigin.x, y: L.problemOrigin.y))
            guard let result = try? await brain.layoutHandwriting(request), result.unsupported.isEmpty, let p = result.plan else { return nil }
            if p.bounds.x + p.bounds.w <= L.problemMaxX && p.bounds.y + p.bounds.h <= L.problemMaxBottom {
                plan = p
                break
            }
            size -= 8
        }
        guard let plan else { return nil }
        let bottom = plan.bounds.y + plan.bounds.h
        let page = ProblemPage(kind: .problem, setId: "bench", index: 1, count: 1, origin: "practice",
                               workTop: L.workTop(problemBottom: bottom), answer: ProblemPagesRollout.secondPart)
        board.setProblemPage(page, on: screen)
        var meta = checked.meta
        meta["chatProblem"] = .object(["n": .number(1), "lines": .array(checked.lines.map { .string($0) }),
                                       "cell": .object(["x": .number(40), "y": .number(40), "w": .number(1520), "h": .number(840)])])
        meta["lineId"] = "chat"
        if meta["live"] == nil { meta["live"] = true }
        if meta["source"] == nil { meta["source"] = "ai" }
        InstantPen(store: board.store, screen: screen).write(tutorLines(plan), meta: meta)
        loop.problemsChanged()
        return page.resolvedWorkTop
    }

    /// The desk's check of one problem (the brain's `chatPlan` of `write_problems` on an empty page, as
    /// `ProblemPageWriter.verify` asks it): the lines as the board writes them and the block's meta.
    static func deskCheck(_ problem: [String], brain: Brain) async -> (lines: [String], meta: Meta)? {
        _ = try? await brain.load()
        let args: [String: Any] = [
            "actions": [["type": "write_problems", "problems": [problem]]],
            "shapes": [], "screen": ["x": 0, "y": 0, "w": 1600, "h": 900], "pageId": "page:check",
            "studentLines": [], "handwriting": true, "screensLeft": 0, "carried": [:],
        ]
        guard let json = try? JSONSerialization.data(withJSONObject: args),
              let started = try? await brain.callJSON("chatPlan", args: String(decoding: json, as: UTF8.self)),
              let ticket = (try? JSONSerialization.jsonObject(with: Data(started.utf8)) as? [String: Any])?["ticket"] as? Int,
              let taken = try? await brain.callJSON("chatResult", args: "{\"ticket\":\(ticket)}"),
              let out = try? JSONSerialization.jsonObject(with: Data(taken.utf8)) as? [String: Any],
              let result = out["result"] as? [String: Any], let ops = result["ops"] as? [[String: Any]] else { return nil }
        for op in ops where op["op"] as? String == "write" {
            guard let metaObj = op["meta"], let cp = (metaObj as? [String: Any])?["chatProblem"] as? [String: Any],
                  let lines = cp["lines"] as? [String], !lines.isEmpty,
                  let metaData = try? JSONSerialization.data(withJSONObject: metaObj),
                  let meta = try? JSONDecoder().decode(Meta.self, from: metaData) else { continue }
            return (lines, meta)
        }
        return nil
    }

    static func tutorLines(_ plan: HandPlan) -> [TutorLine] {
        plan.lines.map { line in
            let strokes = line.strokes.sorted { $0.order < $1.order }.map { s in
                TutorStroke(points: s.points.map { FreehandInput(Vec2($0.x + line.x, $0.y + line.y), $0.z) }, weight: s.weight ?? 1)
            }
            return TutorLine(strokes: strokes, latex: line.latex)
        }
    }

    // MARK: - one case

    @MainActor
    struct Clock {
        let loop: LiveLoop
        let scheduler: ManualScheduler

        func idle() async {
            for _ in 0..<3 {
                await loop.waitUntilIdle(timeout: .seconds(45))
                await Task.yield()
            }
        }

        func pass(_ ms: Double) async {
            var left = ms
            while left > 0 {
                scheduler.advance(min(left, 100))
                left -= 100
                await idle()
            }
        }
    }

    /// One planned case, start to end, on its own board and loop: its result as the in-app bench makes
    /// it (no snapshot).
    static func run(_ p: TrainingGenerator.Planned, services: BenchServices, oracle: Bool) async -> TrainingCaseResult {
        let spec = p.spec
        let started = Date()
        let boardId = "bench-\(UUID().uuidString.lowercased().prefix(8))"
        let board = TestBoard()
        let scheduler = ManualScheduler()
        let loop = LiveLoop(board: board, boardId: boardId, services: services,
                            settings: LiveSettings(enabled: true, mode: .feedback, auto: true, handwriting: true, celebrations: false,
                                                   checking: .whenDone, showReadings: true),
                            brain: TestBrain.shared, background: TestBrain.background, scheduler: scheduler, connectivity: ManualConnectivity())
        let clock = Clock(loop: loop, scheduler: scheduler)
        let refusedBefore = services.snapshot.counts.refused
        let written = Written()
        var reader: (@MainActor (RecognizeRequest) async -> String?)?
        if oracle {
            reader = { @MainActor request in await Oracle.read(request, written: written.lines, board: board) }
        }
        services.begin(boardId, oracle: reader)
        func result(lines: [TrainingLineResult], strokes: [[TrainingStroke]], pass: Bool?, why: TrainingWhy?, solved: Bool) -> TrainingCaseResult {
            let (reads, calls) = services.end(boardId)
            return TrainingCaseResult(kind: .bench, caseKey: spec.id, category: spec.category, grade: spec.grade, topic: spec.topic, hand: p.hand.name,
                                      problem: spec.problem ?? [], spec: spec, lines: lines, strokes: strokes, reads: reads,
                                      solvedExpected: spec.solved, solvedGot: solved, pass: pass, why: why, calls: calls,
                                      ms: Date().timeIntervalSince(started) * 1000)
        }
        func failed(_ why: TrainingWhy) -> TrainingCaseResult {
            loop.stop()
            return result(lines: [], strokes: [], pass: false, why: why, solved: false)
        }
        // 1. every line's ink first: a line the hand cannot write skips the case before any call
        var inks: [[[Vec2]]] = []
        for line in spec.lines {
            guard let ink = try? await StudentHand.ink(line.latex, hand: p.hand, brain: TestBrain.shared), !ink.isEmpty else {
                return failed(TrainingWhy(.error, "The hand can't write \(line.latex)."))
            }
            inks.append(ink)
        }
        loop.start()
        await clock.idle()
        // 2. the page
        guard let workTop = await page(spec.problem, on: board, loop: loop, brain: TestBrain.shared) else {
            return failed(TrainingWhy(.error, "The tutor's desk would not write this problem (it could not check it)."))
        }
        await clock.pass(300)
        // 3. the lines, one under another
        var bottom = workTop + 6
        var prev: Box?
        var ids: [[RecordID]] = []
        var erased = Set<Int>()
        for (k, line) in spec.lines.enumerated() {
            if services.spent { return failed(TrainingWhy(.budget, "The run's call budget ran out mid-case.")) }
            let ink = inks[k]
            let w = ink.flatMap { $0 }.map(\.x).max() ?? 0
            let h = ink.flatMap { $0 }.map(\.y).max() ?? 0
            let origin = TrainingBench.origin(for: ink, place: line.place, dx: line.dx, workTop: workTop, bottom: bottom, beside: prev)
            let placed = ink.map { s in s.map { ProblemPageLayout.place(Vec2(origin.x + $0.x, origin.y + $0.y), on: board.screenRect.box) } }
            var made = board.kidWrites(placed)
            written.lines.append((Set(made.map(\.rawValue)), line.latex))
            let box = Box(x: origin.x, y: origin.y, w: w, h: h)
            if line.place == .work || line.place == .beside { bottom = max(bottom, box.maxY) }
            if line.place != .answer { prev = box }
            switch line.then {
            case .erase?:
                // the read lands, then it is rubbed out
                await clock.pass(1_800)
                board.erase(made)
                written.lines[written.lines.count - 1].strokes = []
                erased.insert(k)
                made = []
            case .strike?:
                await clock.pass(900)
                let y = box.y + box.h * 0.5
                made += board.kidWrites([densify([Vec2(box.x - 10, y + 4), Vec2(box.maxX + 10, y - 4)])])
                written.lines[written.lines.count - 1].strokes = Set(made.map(\.rawValue))
            case nil:
                break
            }
            ids.append(made)
            await clock.pass(lineBreakMs)
        }
        // 4. the reads land; the kid checks; the marks are written
        await clock.pass(beforeCheckMs)
        if loop.settings.checking == .whenDone { loop.checkPage() }
        await clock.pass(afterCheckMs)
        if services.snapshot.counts.refused > refusedBefore {
            // a call of this case's (or of one beside it) was refused: what it shows is not the tutor's
            return failed(TrainingWhy(.budget, "The run's call budget ran out mid-case."))
        }
        // 5. what the tutor did with each line, judged as the in-app bench judges it
        let observed = TrainingBench.observe(spec: spec, ids: ids, erased: erased, loop: loop)
        let judged = TrainingJudge.judge(lines: observed, solvedExpected: spec.solved, solvedGot: loop.trainingSolved)
        let strokes = ids.map { line in line.compactMap { board.store.stroke($0) }.map { s in
            let pts = s.points.map { s.pagePoint($0) }
            return TrainingStroke(x: pts.map { ($0.x * 100).rounded() / 100 }, y: pts.map { ($0.y * 100).rounded() / 100 })
        } }
        let solved = loop.trainingSolved
        loop.stop()
        return result(lines: judged.lines, strokes: strokes, pass: judged.pass, why: judged.why, solved: solved)
    }

    static func densify(_ p: [Vec2]) -> [Vec2] {
        guard p.count >= 2 else { return p }
        var out: [Vec2] = [p[0]]
        for (a, b) in zip(p, p.dropFirst()) {
            let n = max(1, Int(a.dist(b) / 2))
            for k in 1...n { out.append(a.lerp(b, Double(k) / Double(n))) }
        }
        return out
    }
}

/// The lines written so far on a case's page: their strokes and what was written.
@MainActor
final class Written {
    var lines: [(strokes: Set<String>, latex: String)] = []
}

/// Perfect reads (`BenchServices` oracle mode): the strokes of a read are matched against the written
/// lines by the payload they make; one or more whole written lines read as what was written (several:
/// joined, as a merged read), anything else is unreadable.
@MainActor
enum Oracle {
    static func read(_ request: RecognizeRequest, written: [(strokes: Set<String>, latex: String)], board: TestBoard) async -> String? {
        let all = board.store.kidStrokes(on: board.currentScreenID)
        let target = canon(request.strokes.x, request.strokes.y)
        let n = written.count
        for len in 1...max(1, n) {
            for start in 0..<n where start + len <= n {
                let group = written[start..<(start + len)].filter { !$0.strokes.isEmpty }
                guard !group.isEmpty else { continue }
                let ids = group.reduce(into: Set<String>()) { $0.formUnion($1.strokes) }
                guard ids.count == request.strokes.x.count else { continue }
                let mine = all.filter { ids.contains($0.id) }
                guard let payload = try? await TestBrain.shared.recognizerPayload(mine), canon(payload.strokes.x, payload.strokes.y) == target else { continue }
                return group.map { spoken($0.latex) }.joined(separator: " ")
            }
        }
        return nil
    }

    /// The payload's strokes in an order of their own (the line's stroke order is the clusterer's).
    static func canon(_ x: [[Double]], _ y: [[Double]]) -> [String] {
        zip(x, y).map { "\($0)|\($1)" }.sorted()
    }

    /// Rows that are a stacked sum (numbers, an operator on a row after the first, the answer last) as a
    /// perfect reader reads them — an array, the rule before the answer; a lone carry digit over the top
    /// number, or beside it, is not read (Mathpix drops it).
    static func stackedArray(_ rows: [String]) -> String? {
        // a carry written beside a row's number (`6 27`) is not read either
        var r = rows.map { spoken($0).replacingOccurrences(of: #"^\d\s+(?=\d)"#, with: "", options: .regularExpression).replacingOccurrences(of: " ", with: "") }
        let number = #"^\d+(\.\d+)?$"#
        let operand = #"^(\+|-|\\times|\\cdot)?\d+(\.\d+)?$"#
        if r.count >= 4, r[0].range(of: #"^\d$"#, options: .regularExpression) != nil, r[1].range(of: number, options: .regularExpression) != nil { r.removeFirst() }
        // the rule under the last number with an operator; the answer row(s) under it
        guard r.count >= 3, r.allSatisfy({ $0.range(of: operand, options: .regularExpression) != nil }),
              r[0].range(of: number, options: .regularExpression) != nil,
              let lastOp = r.lastIndex(where: { $0.range(of: number, options: .regularExpression) == nil }) ?? (r.count == 3 ? 1 : nil),
              lastOp > 0, lastOp < r.count - 1
        else { return nil }
        return "\\begin{array}{r} " + r[...lastOp].joined(separator: " \\\\ ") + " \\\\ \\hline " + r[(lastOp + 1)...].joined(separator: " \\\\ ") + " \\end{array}"
    }

    /// What a perfect reader says for what was written: no layout spacing.
    static func spoken(_ latex: String) -> String {
        latex.replacingOccurrences(of: "\\qquad", with: " ").replacingOccurrences(of: "\\quad", with: " ")
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
    }
}
