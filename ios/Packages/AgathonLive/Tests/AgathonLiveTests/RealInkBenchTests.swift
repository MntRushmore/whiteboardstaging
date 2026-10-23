import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation
import Testing
@testable import AgathonLive

/// The REAL-INK bench (docs/TRAINING-CENTER.md, "Real handwriting"): children's own handwriting from
/// production boards — de-identified, labeled by hand, and kept OUTSIDE every repo (the repo is public;
/// the corpus never enters it) — written stroke by stroke with its real pauses on a problem page of a
/// test board with the real loop, then Check, and judged as a teacher would: a ring on right work is the
/// worst outcome, then a missed slip, then a "?" on right work.
///
/// Skipped unless AGATHON_REALINK=1. Run it through `scripts/ios-realink-bench.sh`, which passes the
/// headless bench's server, mode, budget and cache settings (`TrainingBenchTests`) and:
///     AGATHON_REALINK_CASES   the corpus's bench cases (a JSON file outside the repo)
///     AGATHON_REALINK_ONLY    ids or id prefixes, or tag:<tag>, comma separated (default every case)
///     AGATHON_REALINK_PACE    real (default: the board's own pauses, capped) | fast (a quick kid) | line (a line's
///                             strokes at once, a line break between: no read of a half-written line)
@MainActor
@Suite(.enabled(if: ProcessInfo.processInfo.environment["AGATHON_REALINK"] == "1", "set AGATHON_REALINK=1 (scripts/ios-realink-bench.sh)"), .serialized)
struct RealInkBenchTests {
    /// One attempt: what the kid wrote, line by line, and every stroke in writing order (page units, from
    /// the attempt's top-left; `line` -1 is ink no line owns: a stray, a doodle, the kid's own tick).
    struct Case: Decodable {
        struct Line: Decodable {
            var latex: String
            var expect: TrainingExpect
            var value: String?
        }

        struct Stroke: Decodable {
            var x: [Double]
            var y: [Double]
            /// pen up of the stroke before to pen down of this one, and pen down to pen up (ms)
            var dt: Double
            var dur: Double
            var line: Int
        }

        var id: String
        var grade: TrainingGrade
        var category: TrainingCategory
        var tags: [String]
        var timed: Bool
        var problem: [String]?
        var solved: Bool
        var lines: [Line]
        var strokes: [Stroke]
    }

    /// What became of one labeled line.
    struct LineOutcome: Codable {
        var written: String
        var expect: TrainingExpect
        var read: String?
        var readRight: Bool?
        /// the tutor's lines its strokes became (1: as written)
        var pieces: Int
        /// every piece's mark
        var marks: [TrainingMark]
        var falseRing: Bool
        var missedRing: Bool
        var questionOnRight: Bool
        var pass: Bool?
        var why: String?
        var readMs: Double?
        var markMs: Double?
    }

    struct CaseOutcome: Codable {
        var id: String
        var grade: TrainingGrade
        var category: TrainingCategory
        var tags: [String]
        var ownPage: Bool
        var lines: [LineOutcome]
        /// rings on ink no labeled line owns (a stray ringed)
        var strayRings: Int
        var solvedExpected: Bool?
        var solvedGot: Bool
        var pass: Bool?
        var why: String?
        var calls: [String: Int]
        var ms: Double
        /// marks seen on a labeled line before all its strokes were written (`kind@line`): kid-visible
        /// noise on a half-written line ("check as I go")
        var earlyMarks: [String] = []
    }

    @Test func realInk() async throws {
        let env = ProcessInfo.processInfo.environment
        func int(_ k: String, _ d: Int) -> Int { env[k].flatMap(Int.init) ?? d }
        let mode = BenchServices.Mode(rawValue: env["AGATHON_BENCH_MODE"] ?? "server") ?? .server
        let label = env["AGATHON_BENCH_LABEL"] ?? "realink-\(mode.rawValue)"
        let out = URL(fileURLWithPath: try #require(env["AGATHON_BENCH_OUT"], "AGATHON_BENCH_OUT: where the results go"))
        try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        let casesURL = URL(fileURLWithPath: try #require(env["AGATHON_REALINK_CASES"], "AGATHON_REALINK_CASES: the corpus's bench cases"))
        guard let data = try? Data(contentsOf: casesURL) else {
            Issue.record("no corpus at \(casesURL.path): the real-ink bench needs the private corpus (never in the repo)")
            return
        }
        let all = try JSONDecoder().decode([Case].self, from: data)
        let picked = Self.pick(all, env["AGATHON_REALINK_ONLY"] ?? "")
        let fast = env["AGATHON_REALINK_PACE"] == "fast"
        let linePace = env["AGATHON_REALINK_PACE"] == "line"
        let checking = CheckTiming(rawValue: env["AGATHON_REALINK_CHECK"] ?? "") ?? .whenDone
        let cacheURL = env["AGATHON_BENCH_CACHE"].map { URL(fileURLWithPath: $0) }
        var cache = BenchServices.Cache()
        if let cacheURL, let data = try? Data(contentsOf: cacheURL) { cache = try JSONDecoder().decode(BenchServices.Cache.self, from: data) }
        try await TestBrain.shared.load()

        var backend: AgathonBackend?
        var upstream: TrainingServices?
        if mode == .server {
            let environment = try AgathonEnvironment.resolve(environment: env, allowOverrides: true)
            let email = try #require(env["AGATHON_BENCH_EMAIL"], "AGATHON_BENCH_EMAIL")
            if !environment.isLocal {
                try #require(email == TrainingBenchTests.productionAccount, "against production the bench only signs in as \(TrainingBenchTests.productionAccount)")
            }
            let b = AgathonBackend(environment: environment, release: AppRelease(version: "0", build: "realink-bench"), authStorage: InMemoryAuthStorage())
            b.auth.start()
            try await b.auth.signIn(email: email, password: try #require(env["AGATHON_BENCH_PASSWORD"], "AGATHON_BENCH_PASSWORD"))
            let status = await TrainingStatus.fetch(b.api)
            guard case .success(let s?) = status, s.training else {
                Issue.record("the server does not take training calls (\(status)): a bench there would spend ink — stopped")
                return
            }
            upstream = TrainingServices(backend: b, budget: Int.max)
            backend = b
        }
        let services = BenchServices(mode: mode, upstream: upstream, cache: cache, hintsFromServer: false,
                                     maxRecognize: int("AGATHON_BENCH_MAX_RECOGNIZE", 0), maxOther: int("AGATHON_BENCH_MAX_OTHER", 0))
        print("REALINK \(label): \(picked.count) of \(all.count) cases, mode \(mode.rawValue), pace \(fast ? "fast" : "real")")

        let parallel = max(1, int("AGATHON_BENCH_PARALLEL", 3))
        var results: [Int: CaseOutcome] = [:]
        var next = 0
        var stopped = false
        await withTaskGroup(of: (Int, CaseOutcome?).self) { group in
            func add() {
                guard next < picked.count, !stopped else { return }
                if services.spent {
                    stopped = true
                    return
                }
                let i = next
                next += 1
                group.addTask { @MainActor in (i, await Self.run(picked[i], services: services, oracle: mode == .oracle, fast: fast, linePace: linePace, checking: checking)) }
            }
            for _ in 0..<parallel { add() }
            while let (i, r) = await group.next() {
                results[i] = r
                if results.count % 20 == 0 {
                    let c = services.snapshot.counts
                    print("REALINK \(label): \(results.count)/\(picked.count) — reads \(c.recognizeCalls) called, \(c.recognizeCached) cached; other \(c.otherCalls)")
                    TrainingBenchTests.saveCache(services, to: cacheURL)
                }
                add()
            }
        }
        TrainingBenchTests.saveCache(services, to: cacheURL)
        let outcomes = results.keys.sorted().compactMap { results[$0] }
        let counts = services.snapshot.counts
        let summary = Self.summary(outcomes, counts: counts, label: label, stopped: stopped)
        print(summary)
        try summary.write(to: out.appendingPathComponent("\(label)-summary.txt"), atomically: true, encoding: .utf8)
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys, .prettyPrinted]
        try enc.encode(outcomes).write(to: out.appendingPathComponent("\(label)-cases.json"))
        try enc.encode(counts).write(to: out.appendingPathComponent("\(label)-calls.json"))
        if let backend { try? await backend.auth.signOut(scope: .local) }
    }

    static func pick(_ all: [Case], _ filter: String) -> [Case] {
        let keys = filter.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        guard !keys.isEmpty else { return all }
        let ids = Set(all.map(\.id))
        return all.filter { c in
            keys.contains { k in
                if k.hasPrefix("tag:") { return c.tags.contains(String(k.dropFirst(4))) }
                // an id is itself (b31babbf3_a1 is not b31babbf3_a10); a prefix only when no case is it
                return c.id == k || (!ids.contains(k) && c.id.hasPrefix(k))
            }
        }
    }

    // MARK: - one case

    /// One attempt on its own board and loop: the page (the problem in the tutor's hand, or the kid's
    /// own page), every stroke where the kid put it with the pause before it, then Check.
    static func run(_ c: Case, services: BenchServices, oracle: Bool, fast: Bool, linePace: Bool = false, checking: CheckTiming = .whenDone) async -> CaseOutcome? {
        let started = Date()
        let boardId = "realink-\(UUID().uuidString.lowercased().prefix(8))"
        let board = TestBoard()
        let scheduler = ManualScheduler()
        let loop = LiveLoop(board: board, boardId: boardId, services: services,
                            settings: LiveSettings(enabled: true, mode: .feedback, auto: true, handwriting: true, celebrations: false,
                                                   checking: checking, showReadings: true),
                            brain: TestBrain.shared, background: TestBrain.background, scheduler: scheduler, connectivity: ManualConnectivity())
        // HOLD=0: the tutor without the wait before a ring or a "?" on a line still being written
        if let hold = ProcessInfo.processInfo.environment["AGATHON_REALINK_HOLD"].flatMap(Double.init) { loop.doubtHoldMs = hold }
        let clock = HeadlessBench.Clock(loop: loop, scheduler: scheduler)
        let written = Written()
        var earlyMarks: [String] = []
        written.lines = c.lines.map { (Set<String>(), $0.latex) }
        // every stroke written, in order (the newest strokes of a read may not be in its line yet)
        var order: [String] = []
        let total = c.lines.indices.map { k in c.strokes.filter { $0.line == k }.count }
        var reader: (@MainActor (RecognizeRequest) async -> String?)?
        if oracle {
            // perfect reads of real ink: the labeled lines the read holds whole and finished, as written;
            // ink no line owns (a stray, her own tick) is invisible; a line held in part or still being
            // written is unreadable
            reader = { @MainActor [weak loop] request in
                guard let loop else { return nil }
                // the read's line; an early read's line is the clusterer's, not the loop's yet: its ink is
                // the early read in flight with as many strokes
                var held: Set<String>
                if let line = loop.lines[request.lineId] {
                    held = Set(line.ink.strokeIds)
                } else if let early = loop.earlyReads.values.filter({ $0.strokeIds.count == request.strokes.x.count })
                    .max(by: { $0.startedAt < $1.startedAt }) {
                    held = early.strokeIds
                } else {
                    held = []
                }
                // the read was asked for with new strokes the line does not hold yet: the newest ones
                if request.strokes.x.count > held.count {
                    for id in order.reversed() where held.count < request.strokes.x.count && !held.contains(id) { held.insert(id) }
                }
                var whole: [String] = []
                var partial = false
                for (k, line) in written.lines.enumerated() where !line.strokes.isEmpty && !line.strokes.isDisjoint(with: held) {
                    if !line.strokes.isSubset(of: held) || line.strokes.count < total[k] { partial = true; break }
                    whole.append(Oracle.spoken(line.latex))
                }
                if ProcessInfo.processInfo.environment["AGATHON_REALINK_DEBUG"] == "1" {
                    print("ORACLE \(request.lineId) inLines=\(loop.lines[request.lineId] != nil) held=\(held.count) req=\(request.strokes.x.count) "
                          + "partial=\(partial) whole=\(whole) lines=\(written.lines.map { "\($0.strokes.intersection(held).count)/\($0.strokes.count)" })")
                }
                return partial || whole.isEmpty ? nil : whole.joined(separator: " ")
            }
        }
        services.begin(boardId, oracle: reader)
        loop.start()
        await clock.idle()
        // the problem page; a problem the desk will not write leaves the kid's own page (said so)
        var ownPage = c.problem == nil
        var workTop = await HeadlessBench.page(c.problem, on: board, loop: loop, brain: TestBrain.shared)
        if workTop == nil {
            ownPage = true
            workTop = await HeadlessBench.page(nil, on: board, loop: loop, brain: TestBrain.shared)
        }
        await clock.pass(300)
        let origin = Vec2(ProblemPageLayout.ruleLeft + 16, (workTop ?? ProblemPageLayout.defaultWorkTop) + 14)
        var ids: [[RecordID]] = Array(repeating: [], count: c.lines.count)
        var lastLine = Int.min
        for s in c.strokes {
            if services.spent { break }
            // `line`: a line's strokes all at once, a kid's line break between lines (no read mid-line)
            let wait = linePace ? (s.line != lastLine ? HeadlessBench.lineBreakMs : 0) : fast ? min(s.dt, 400) + min(s.dur, 300) : s.dt + s.dur
            lastLine = s.line
            if wait > 0 { await clock.pass(wait) }
            // a mark on a labeled line not finished yet: what the kid sees mid-line
            for (k, line) in written.lines.enumerated() where !line.strokes.isEmpty && line.strokes.count < total[k] {
                for st in loop.lines.values where !line.strokes.isDisjoint(with: Set(st.ink.strokeIds)) {
                    let m = loop.trainingMark(on: st.id)
                    if m != .none, !earlyMarks.contains("\(m.rawValue)@\(k)") { earlyMarks.append("\(m.rawValue)@\(k)") }
                }
            }
            let pts = zip(s.x, s.y).map { ProblemPageLayout.place(Vec2(origin.x + $0, origin.y + $1), on: board.screenRect.box) }
            let made = board.kidWrites([pts])
            order += made.map(\.rawValue)
            if s.line >= 0 && s.line < c.lines.count {
                ids[s.line] += made
                written.lines[s.line].strokes.formUnion(made.map(\.rawValue))
            }
        }
        await clock.pass(HeadlessBench.beforeCheckMs)
        if checking == .whenDone { loop.checkPage() }
        await clock.pass(HeadlessBench.afterCheckMs)
        if services.spent && services.snapshot.counts.refused > 0 {
            _ = services.end(boardId)
            loop.stop()
            return nil
        }

        // judged as the in-app bench judges, then every piece's mark as a teacher sees the page
        let solvedExpected: Bool? = ownPage ? nil : c.solved
        let spec = TrainingCase(id: c.id, category: c.category, grade: c.grade, topic: "", problem: ownPage ? nil : c.problem,
                                lines: c.lines.map { TrainingLineSpec($0.latex, $0.expect, value: $0.value, place: .work) }, solved: solvedExpected)
        let observed = TrainingBench.observe(spec: spec, ids: ids, erased: [], loop: loop)
        let judged = TrainingJudge.judge(lines: observed, solvedExpected: solvedExpected, solvedGot: loop.trainingSolved)
        var lines: [LineOutcome] = []
        var owned = Set<String>()
        for (k, line) in c.lines.enumerated() {
            let others = Set(ids.enumerated().filter { $0.offset != k }.flatMap { $0.element.map(\.rawValue) })
            let obs = loop.trainingObserve(strokes: ids[k], others: others)
            owned.formUnion(obs.lineIds)
            let r = judged.lines[k]
            // a row of a stacked sum: the sum's mark is its answer row's (`TrainingBench.observe`)
            let stackRow = obs.lineIds.count == 1 && loop.trainingStacked(obs.lineIds[0])
            let marks = stackRow ? [r.mark] : obs.lineIds.map { loop.trainingMark(on: $0) }
            let right = line.expect != .ring
            lines.append(LineOutcome(written: line.latex, expect: line.expect, read: r.read, readRight: r.readRight, pieces: obs.lineIds.count,
                                     marks: marks, falseRing: right && marks.contains(.ring), missedRing: !right && !marks.contains(.ring),
                                     questionOnRight: right && marks.contains(.question), pass: r.pass, why: r.why?.text,
                                     readMs: r.readMs, markMs: r.markMs))
        }
        let strayRings = loop.lines.keys.filter { !owned.contains($0) && loop.trainingMark(on: $0) == .ring }.count
        if ProcessInfo.processInfo.environment["AGATHON_REALINK_DEBUG"] == "1" {
            for st in loop.lines.values.sorted(by: { ($0.column, $0.row) < ($1.column, $1.row) }) {
                print("LINE \(c.id) \(owned.contains(st.id) ? "labeled" : "STRAY") col\(st.column) row\(st.row) \(st.latex) conf=\(st.confidence) "
                      + "[\(st.analysis?.verdict ?? "-")\(st.analysis?.misreadLikely == true ? " misread?" : "")] mark=\(loop.trainingMark(on: st.id).rawValue) strokes=\(st.ink.strokeIds.count) box=\(st.bounds)")
            }
        }
        let solved = loop.trainingSolved
        let (_, calls) = services.end(boardId)
        loop.stop()
        return CaseOutcome(id: c.id, grade: c.grade, category: c.category, tags: c.tags, ownPage: ownPage, lines: lines, strayRings: strayRings,
                           solvedExpected: solvedExpected, solvedGot: solved, pass: judged.pass, why: judged.why?.text, calls: calls,
                           ms: Date().timeIntervalSince(started) * 1000, earlyMarks: earlyMarks)
    }

    // MARK: - the report

    /// A case right as a teacher sees the page: every line's pieces carry the mark it wants (a tick on an
    /// answer, a ring on a slip, never a ring or a "?" on right work), no stray ringed, and the page
    /// solved as it should be. A stacked sum read as one block is right when its marks are.
    static func teacherRight(_ c: CaseOutcome) -> Bool {
        guard c.strayRings == 0, c.solvedExpected == nil || c.solvedExpected == c.solvedGot else { return false }
        return c.lines.allSatisfy { l in
            if l.expect != .ring && (l.marks.contains(.ring) || l.marks.contains(.question)) { return false }
            switch l.expect {
            case .tick: return l.marks.contains(.tick)
            case .ring: return l.marks.contains(.ring)
            case .calm, .quiet: return true
            }
        }
    }

    static func summary(_ cases: [CaseOutcome], counts: BenchServices.Counts, label: String, stopped: Bool) -> String {
        func pct(_ a: Int, _ b: Int) -> String { b == 0 ? "-" : String(format: "%.1f%%", 100 * Double(a) / Double(b)) }
        let lines = cases.flatMap(\.lines)
        let right = lines.filter { $0.expect != .ring }
        let slips = lines.filter { $0.expect == .ring }
        let read = lines.filter { $0.readRight != nil }
        var s = "REALINK \(label)\(stopped ? " (stopped: budget)" : "")\n"
        let teacherRight = cases.filter(Self.teacherRight).count
        s += "TEACHER-RIGHT: \(teacherRight)/\(cases.count) = \(pct(teacherRight, cases.count))\n"
        s += "cases \(cases.count): pass \(pct(cases.filter { $0.pass == true }.count, cases.count))"
        s += "; no ring on right work \(pct(cases.filter { c in !c.lines.contains(where: \.falseRing) && c.strayRings == 0 }.count, cases.count))\n"
        s += "lines \(lines.count): judged right \(pct(lines.filter { $0.pass == true }.count, lines.count))"
        s += "; read right \(pct(read.filter { $0.readRight == true }.count, read.count)) of \(read.count) read; one piece \(pct(lines.filter { $0.pieces == 1 }.count, lines.count))\n"
        s += "RINGS ON RIGHT WORK: \(right.filter(\.falseRing).count) of \(right.count) right lines; strays ringed \(cases.map(\.strayRings).reduce(0, +))\n"
        s += "missed slips: \(slips.filter(\.missedRing).count) of \(slips.count); \"?\" on right work: \(right.filter(\.questionOnRight).count)\n"
        let solvedCases = cases.filter { $0.solvedExpected != nil }
        s += "solved as expected: \(pct(solvedCases.filter { $0.solvedExpected == $0.solvedGot }.count, solvedCases.count)) of \(solvedCases.count)\n"
        let readMs = lines.compactMap(\.readMs).sorted()
        let markMs = lines.compactMap(\.markMs).sorted()
        func median(_ a: [Double]) -> String { a.isEmpty ? "-" : String(format: "%.0f ms", a[a.count / 2]) }
        let early = cases.flatMap(\.earlyMarks)
        s += "marks on half-written lines: \(early.count) in \(cases.filter { !$0.earlyMarks.isEmpty }.count) cases (\(Dictionary(grouping: early) { $0.split(separator: "@").first.map(String.init) ?? "" }.mapValues(\.count)))\n"
        s += "read after pen-up median \(median(readMs)); mark after pen-up median \(median(markMs))\n"
        var byTag: [String: (Int, Int)] = [:]
        for c in cases {
            let ok = c.pass == true
            for t in c.tags { byTag[t, default: (0, 0)].0 += ok ? 1 : 0; byTag[t, default: (0, 0)].1 += 1 }
        }
        s += "by tag (cases passing):\n"
        for (t, v) in byTag.sorted(by: { $0.value.1 > $1.value.1 }) where v.1 >= 3 { s += "  \(t): \(v.0)/\(v.1)\n" }
        var why: [String: Int] = [:]
        for l in lines where l.pass == false { why[String((l.why ?? "?").prefix(while: { $0 != ":" && $0 != "(" })), default: 0] += 1 }
        s += "why lines failed:\n"
        for (w, n) in why.sorted(by: { $0.value > $1.value }) { s += "  \(n) × \(w)\n" }
        s += "calls: reads \(counts.recognizeCalls) called, \(counts.recognizeCached) cached; other \(counts.otherCalls); refused \(counts.refused)\n"
        return s
    }
}
