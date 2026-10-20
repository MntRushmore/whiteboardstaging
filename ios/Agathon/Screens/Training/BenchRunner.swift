import AgathonBoard
import AgathonBrain
import AgathonKit
import AgathonLive
import Foundation
import os

/// The AUTO BENCH: each planned case on a fresh problem page of the training board — the problem
/// written at the top by the tutor (or the writer's own, written first), every line written in the
/// case's synthetic hand through the canvas's touch path at a kid's pace, the page checked as a kid
/// would check it — then what the tutor did with each line read off the loop and the board, and
/// judged (`TrainingJudge`). Stops at the call budget, on Stop, or when the board is full.
@MainActor
final class BenchRunner: ObservableObject {
    enum Phase: Equatable {
        case idle
        case planning
        case running
        case finished(TrainingRun.Status)
    }

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var run: TrainingRun
    @Published private(set) var planned: [TrainingGenerator.Planned] = []
    @Published private(set) var index = 0
    @Published private(set) var now: String = ""
    let board: TrainingBoard
    let config: TrainingConfig
    private weak var backend: AgathonBackend?
    private var stopping = false
    private var task: Task<Void, Never>?

    init(backend: AgathonBackend, config: TrainingConfig) {
        self.backend = backend
        self.config = config
        let settings = LiveSettings(enabled: true, mode: .feedback, auto: true, handwriting: true, celebrations: false,
                                    checking: CheckTiming(rawValue: config.checking) ?? .whenDone, showReadings: true)
        board = TrainingBoard(backend: backend, budget: config.budget, settings: settings)
        run = TrainingRun(kind: .bench, target: TrainingSync.target(backend), appBuild: TrainingSync.appBuild, config: config)
    }

    var pace: KidPace? { KidPace.all.first { $0.name == config.pace } }
    var calls: Int { board.services.totalCalls }
    var finished: Bool { if case .finished = phase { return true } else { return false } }

    func start() {
        guard phase == .idle else { return }
        task = Task { @MainActor [weak self] in await self?.go() }
    }

    func stop() {
        stopping = true
        now = "Stopping after this case…"
    }

    /// Closing the screen: stop at once and let the board go.
    func close() {
        stopping = true
        task?.cancel()
        board.stop()
    }

    private func go() async {
        phase = .planning
        now = "Getting the board ready…"
        guard await board.ready() else {
            finish(.failed, note: "The board did not come up.")
            return
        }
        now = "Choosing cases…"
        planned = await TrainingGenerator.plan(config, brain: .shared)
        phase = .running
        TrainingStore.shared.save(run)
        var status: TrainingRun.Status = .done
        for (i, p) in planned.enumerated() {
            index = i
            if stopping || Task.isCancelled { status = .stopped; break }
            if board.services.spent { status = .budget; break }
            if board.pagesLeft < 2 { status = .stopped; now = "The board is full (50 pages)."; break }
            now = "\(p.spec.title) — \(p.hand.name)"
            let result = await runCase(p)
            run.cases.append(result)
            TrainingStore.shared.save(run)
            if result.why?.code == .budget { status = .budget; break }
        }
        index = planned.count
        finish(status)
    }

    private func finish(_ status: TrainingRun.Status, note: String? = nil) {
        run.status = status
        run.finishedAt = Date()
        phase = .finished(status)
        now = note ?? ""
        TrainingStore.shared.save(run)
        guard let backend else { return }
        Task { @MainActor in
            let saved = await TrainingSync.save(run, backend: backend)
            run.synced = saved.synced
            run.syncNote = saved.syncNote
        }
    }

    /// Runs one failure again, on a fresh page, in the same hand: a new result for the same case.
    func rerun(_ result: TrainingCaseResult) async -> TrainingCaseResult? {
        guard let spec = result.spec, let hand = TrainingHand.named(result.hand), finished || phase == .idle else { return nil }
        if phase == .idle { guard await board.ready() else { return nil } }
        if board.services.spent { board.services.budget += 15 }
        let fresh = await runCase(.init(spec: spec, hand: hand))
        run.cases.append(fresh)
        if let backend { run = await TrainingSync.save(run, backend: backend, cases: [fresh.id]) }
        return fresh
    }

    /// Marks a case as a regression test (its fixture goes with its row).
    func markRegression(_ id: UUID) {
        guard let i = run.cases.firstIndex(where: { $0.id == id }) else { return }
        run.cases[i].regression = true
        TrainingStore.shared.save(run)
        guard let backend else { return }
        Task { @MainActor in run = await TrainingSync.save(run, backend: backend, cases: [id]) }
    }

    // MARK: - one case

    func runCase(_ p: TrainingGenerator.Planned) async -> TrainingCaseResult {
        let spec = p.spec
        let started = Date()
        let callsBefore = board.services.calls
        let readsBefore = board.services.reads.count
        func failed(_ why: TrainingWhy) -> TrainingCaseResult {
            TrainingCaseResult(kind: .bench, caseKey: spec.id, category: spec.category, grade: spec.grade, topic: spec.topic, hand: p.hand.name,
                               problem: spec.problem ?? [], spec: spec, lines: [], strokes: [], solvedExpected: spec.solved, solvedGot: false,
                               pass: false, why: why, calls: diff(board.services.calls, callsBefore), ms: Date().timeIntervalSince(started) * 1000)
        }
        // 1. every line's ink first: a line the hand cannot write skips the case before any call
        var inks: [[[Vec2]]] = []
        for line in spec.lines {
            guard let ink = try? await StudentHand.ink(line.latex, hand: p.hand, brain: .shared), !ink.isEmpty else {
                return failed(TrainingWhy(.error, "The hand can't write \(line.latex)."))
            }
            inks.append(ink)
        }
        // 2. a fresh page: the tutor's problem at the top, or the writer's own
        if let problem = spec.problem {
            guard await board.problemPage(problem, set: "bench") else {
                return failed(TrainingWhy(.error, "The tutor's desk would not write this problem (it could not check it)."))
            }
        } else {
            guard board.ownPage() != nil else { return failed(TrainingWhy(.error, "No room for another page.")) }
        }
        await board.settle(.seconds(4))
        try? await Task.sleep(for: .milliseconds(400))
        guard let loop = board.loop else { return failed(TrainingWhy(.error, "The tutor went away.")) }
        // 3. the lines, one under another, at a kid's pace
        var rng = SplitMix(seed: Self.stableHash(spec.id + p.hand.name) &+ UInt64(truncatingIfNeeded: config.seed))
        let (rect, workTop) = board.page
        let rules = ProblemPageLayout.rules(workTop: workTop)
        var bottom = workTop + 6
        var prev: Box?
        var ids: [[RecordID]] = []
        var erased = Set<Int>()
        for (k, line) in spec.lines.enumerated() {
            if board.services.spent { return failed(TrainingWhy(.budget, "The run's call budget ran out mid-case.")) }
            let ink = inks[k]
            let w = ink.flatMap { $0 }.map(\.x).max() ?? 0
            let h = ink.flatMap { $0 }.map(\.y).max() ?? 0
            var origin: Vec2
            switch line.place {
            case .problem:
                origin = Vec2(ProblemPageLayout.problemOrigin.x + line.dx, ProblemPageLayout.problemOrigin.y + 10)
            case .answer:
                let a = ProblemPageLayout.answer
                origin = Vec2(a.x + 210 + line.dx, a.y + max(4, (a.h - h) / 2))
            case .beside where prev != nil:
                origin = Vec2(prev!.maxX + 70 + line.dx, prev!.maxY - h)
            case .work, .beside:
                let g = rules.first { $0 - h + 8 >= bottom + 14 } ?? (bottom + 14 + h - 8)
                origin = Vec2(140 + line.dx, g - h + 8)
            }
            let placed = ink.map { s in s.map { ProblemPageLayout.place(Vec2(origin.x + $0.x, origin.y + $0.y), on: rect) } }
            var made = await board.write(placed, pace: pace, rng: &rng)
            let box = Box(x: origin.x, y: origin.y, w: w, h: h)
            if line.place == .work || line.place == .beside { bottom = max(bottom, box.maxY) }
            if line.place != .answer { prev = box }
            switch line.then {
            case .erase?:
                // the read lands, then it is rubbed out
                try? await Task.sleep(for: .milliseconds(1_800))
                await board.erase(made)
                erased.insert(k)
                made = []
            case .strike?:
                try? await Task.sleep(for: .milliseconds(900))
                made += await board.strike(made)
            case nil:
                break
            }
            ids.append(made)
            let pause = pace.map { $0.lineBreak(&rng) } ?? 700
            try? await Task.sleep(for: .milliseconds(Int(pause)))
        }
        // 4. the reads land; then the kid checks (when-done), and the marks are written
        await board.settle(.seconds(10))
        let checkAt = Date()
        if loop.settings.checking == .whenDone { loop.checkPage() }
        try? await Task.sleep(for: .milliseconds(500))
        await board.settle(.seconds(12))
        // the tutor's pen writes the marks at a hand's pace
        try? await Task.sleep(for: .milliseconds(1_400))
        let checkMs = Date().timeIntervalSince(checkAt) * 1000 - 1_400
        // 5. what the tutor did with each line
        let besideQuiet = Set(spec.lines.indices.filter { spec.lines[$0].place == .beside && spec.lines[$0].expect == .quiet })
        var results: [TrainingLineResult] = []
        for (k, line) in spec.lines.enumerated() {
            var r = TrainingLineResult(index: k, written: line.latex, meaning: line.meaning, expect: line.expect, value: line.value, place: line.place)
            if erased.contains(k) {
                // rubbed out: nothing to judge (a mark left behind would show on the next line's)
                r.expect = nil
                results.append(r)
                continue
            }
            let others = Set(ids.enumerated().filter { $0.offset != k && !besideQuiet.contains($0.offset) }.flatMap { $0.element.map(\.rawValue) })
            let obs = loop.trainingObserve(strokes: ids[k], others: others)
            r.lineId = obs.lineIds.first
            r.read = obs.latex
            r.provider = obs.provider
            r.confidence = obs.confidence
            r.reading = obs.reading
            r.verdict = obs.verdict
            r.kind = obs.kind
            r.result = obs.result
            r.mark = obs.mark
            r.released = obs.released
            r.readMs = obs.readMs
            r.markMs = obs.markMs
            r.pieces = obs.merged ? 0 : obs.lineIds.count
            if besideQuiet.contains(k) && (obs.merged || obs.lineIds.isEmpty) {
                // a kid's own tick taken in with the line it ticks: as it should be
                r.pieces = 1
                r.mark = .none
            }
            results.append(r)
        }
        let judged = TrainingJudge.judge(lines: results, solvedExpected: spec.solved, solvedGot: loop.trainingSolved)
        let reads = Array(board.services.reads.dropFirst(readsBefore))
        let pass = judged.pass ?? true
        let result = TrainingCaseResult(kind: .bench, caseKey: spec.id, category: spec.category, grade: spec.grade, topic: spec.topic,
                                        hand: p.hand.name, problem: spec.problem ?? [], spec: spec, lines: judged.lines,
                                        strokes: ids.map { board.points($0) }, reads: reads, solvedExpected: spec.solved,
                                        solvedGot: loop.trainingSolved, pass: judged.pass, why: judged.why,
                                        calls: diff(board.services.calls, callsBefore), ms: Date().timeIntervalSince(started) * 1000,
                                        checkMs: max(0, checkMs), snapshot: pass ? nil : board.snapshot())
        Self.logResult(result)
        return result
    }

    static func logResult(_ r: TrainingCaseResult) {
        let lines = r.lines.map { l in "\(l.written) → \(l.read ?? "-") [\(l.mark.rawValue)/\(l.expect?.rawValue ?? "-")] \(l.pass.map { $0 ? "ok" : "FAIL" } ?? "-")" }
        TrainingBoard.log.notice("TRAINING case \(r.caseKey, privacy: .public) \(r.hand, privacy: .public) \(r.pass == true ? "PASS" : "FAIL", privacy: .public) calls \(r.calls.values.reduce(0, +)) :: \(lines.joined(separator: " | "), privacy: .public) \(r.firstWhy?.text ?? "", privacy: .public)")
    }

    /// FNV-1a: the same case in the same hand gets the same pauses on every run (Swift's own hash is
    /// seeded per launch).
    static func stableHash(_ s: String) -> UInt64 {
        var h: UInt64 = 0xCBF2_9CE4_8422_2325
        for b in s.utf8 {
            h ^= UInt64(b)
            h = h &* 0x0000_0100_0000_01B3
        }
        return h
    }

    private func diff(_ now: [String: Int], _ before: [String: Int]) -> [String: Int] {
        var out: [String: Int] = [:]
        for (k, v) in now where v - (before[k] ?? 0) > 0 { out[k] = v - (before[k] ?? 0) }
        return out
    }
}
