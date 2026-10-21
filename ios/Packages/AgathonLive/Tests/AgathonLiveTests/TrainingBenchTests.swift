import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation
import Testing
@testable import AgathonLive

/// The HEADLESS bench (docs/TRAINING-CENTER.md, "The headless bench"): the auto bench's cases — the
/// catalogue in every hand, the brain's practice problems right and with a slip — through the real loop
/// and the real routes of a chosen server, with no UI and no kid's pace, judged by the in-app bench's
/// own code. Skipped unless AGATHON_BENCH=1. Run it through `scripts/ios-bench.sh`, which passes:
///
///     AGATHON_BENCH_MODE      server (default) | replay (the cache alone) | oracle (perfect reads, no server)
///     AGATHON_API_URL …       the server (default production); SUPABASE_URL / SUPABASE_ANON_KEY with it
///     AGATHON_BENCH_EMAIL / _PASSWORD   the admin it signs in as (production: qa-bench@agathon.app only)
///     AGATHON_BENCH_OUT       where the run, its summary and its failures' fixtures go
///     AGATHON_BENCH_CACHE     the answers kept from earlier runs (read, then written back)
///     AGATHON_BENCH_HANDS     clean,slanted,steep,messy,big,small (default all six)
///     AGATHON_BENCH_CASES     all (default) | none | ids or id prefixes, comma separated
///     AGATHON_BENCH_PRACTICE  how many practice problems (default 0), AGATHON_BENCH_GRADES their bands
///     AGATHON_BENCH_PRACTICE_HANDS  every hand (each problem in each) or deal (one hand each, default)
///     AGATHON_BENCH_MAX_RECOGNIZE / _MAX_OTHER   the call budgets (default 0: no calls)
///     AGATHON_BENCH_HINTS     local (default: a ringed slip's hint is worded by the loop) | server
///     AGATHON_BENCH_PARALLEL  cases at once (default 3)
///     AGATHON_BENCH_LABEL     the run's name in its files
@MainActor
@Suite(.enabled(if: ProcessInfo.processInfo.environment["AGATHON_BENCH"] == "1", "set AGATHON_BENCH=1 (scripts/ios-bench.sh)"), .serialized)
struct TrainingBenchTests {
    static let productionAccount = "qa-bench@agathon.app"

    @Test func bench() async throws {
        let env = ProcessInfo.processInfo.environment
        func int(_ k: String, _ d: Int) -> Int { env[k].flatMap(Int.init) ?? d }
        let mode = BenchServices.Mode(rawValue: env["AGATHON_BENCH_MODE"] ?? "server") ?? .server
        let label = env["AGATHON_BENCH_LABEL"] ?? "bench-\(mode.rawValue)"
        let out = URL(fileURLWithPath: try #require(env["AGATHON_BENCH_OUT"], "AGATHON_BENCH_OUT: where the results go"))
        try FileManager.default.createDirectory(at: out.appendingPathComponent("fixtures"), withIntermediateDirectories: true)
        let cacheURL = env["AGATHON_BENCH_CACHE"].map { URL(fileURLWithPath: $0) }
        var cache = BenchServices.Cache()
        if let cacheURL, let data = try? Data(contentsOf: cacheURL) { cache = try JSONDecoder().decode(BenchServices.Cache.self, from: data) }
        try await TestBrain.shared.load()

        // the server, signed in as the bench's admin, and asked first whether it takes training calls
        var upstream: TrainingServices?
        var backend: AgathonBackend?
        if mode == .server {
            let environment = try AgathonEnvironment.resolve(environment: env, allowOverrides: true)
            let email = try #require(env["AGATHON_BENCH_EMAIL"], "AGATHON_BENCH_EMAIL")
            if !environment.isLocal {
                try #require(email == Self.productionAccount, "against production the bench only signs in as \(Self.productionAccount)")
            }
            let b = AgathonBackend(environment: environment, release: AppRelease(version: "0", build: "headless-bench"), authStorage: InMemoryAuthStorage())
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
        let services = BenchServices(mode: mode, upstream: upstream, cache: cache, hintsFromServer: env["AGATHON_BENCH_HINTS"] == "server",
                                     maxRecognize: int("AGATHON_BENCH_MAX_RECOGNIZE", 0), maxOther: int("AGATHON_BENCH_MAX_OTHER", 0))

        // the cases
        let hands = (env["AGATHON_BENCH_HANDS"].map { $0.split(separator: ",").map(String.init) } ?? TrainingHand.all.map(\.name)).compactMap(TrainingHand.named)
        let picked = Self.catalogue(env["AGATHON_BENCH_CASES"] ?? "all")
        var planned: [TrainingGenerator.Planned] = []
        for spec in picked { for hand in hands { planned.append(.init(spec: spec, hand: hand)) } }
        let practiceCount = int("AGATHON_BENCH_PRACTICE", 0)
        if practiceCount > 0 {
            let grades = (env["AGATHON_BENCH_GRADES"] ?? "K-2,3-4,5-6,7-8").split(separator: ",").compactMap { TrainingGrade(rawValue: String($0)) }
            let practice = await TrainingGenerator.practiceCases(grades: grades, count: practiceCount, seed: int("AGATHON_BENCH_SEED", 1),
                                                                 includeWrong: true, brain: TestBrain.shared)
            for (i, spec) in practice.enumerated() {
                if env["AGATHON_BENCH_PRACTICE_HANDS"] == "every" {
                    for hand in hands { planned.append(.init(spec: spec, hand: hand)) }
                } else {
                    planned.append(.init(spec: spec, hand: hands[i % hands.count]))
                }
            }
        }
        print("BENCH \(label): \(planned.count) cases (\(picked.count) catalogue × \(hands.count) hands + practice), mode \(mode.rawValue)")

        // the run: a few cases at once, each on its own board
        var run = TrainingRun(kind: .bench, target: backend.map { $0.environment.apiBaseURL.host ?? "?" } ?? mode.rawValue, appBuild: "headless",
                              config: TrainingConfig(grades: TrainingGrade.allCases, count: planned.count, hands: hands.map(\.name), pace: "headless",
                                                     budget: services.maxRecognize + services.maxOther))
        let parallel = max(1, int("AGATHON_BENCH_PARALLEL", 3))
        var results: [Int: TrainingCaseResult] = [:]
        var next = 0
        var stopped = false
        await withTaskGroup(of: (Int, TrainingCaseResult).self) { group in
            func add() {
                guard next < planned.count, !stopped else { return }
                if services.spent {
                    stopped = true
                    return
                }
                let i = next
                let p = planned[i]
                next += 1
                group.addTask { @MainActor in (i, await HeadlessBench.run(p, services: services, oracle: mode == .oracle)) }
            }
            for _ in 0..<parallel { add() }
            while let (i, r) = await group.next() {
                results[i] = r
                if results.count % 25 == 0 {
                    let c = services.snapshot.counts
                    print("BENCH \(label): \(results.count)/\(planned.count) — reads \(c.recognizeCalls) called, \(c.recognizeCached) cached; other \(c.otherCalls)")
                    Self.saveCache(services, to: cacheURL)
                }
                add()
            }
        }
        run.cases = results.keys.sorted().compactMap { results[$0] }
        run.status = stopped ? .budget : .done
        run.finishedAt = Date()

        // what it found
        Self.saveCache(services, to: cacheURL)
        let counts = services.snapshot.counts
        let summary = BenchReport.text(run, counts: counts, label: label)
        print(summary)
        try summary.write(to: out.appendingPathComponent("\(label)-summary.txt"), atomically: true, encoding: .utf8)
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys]
        enc.dateEncodingStrategy = .iso8601
        try enc.encode(run).write(to: out.appendingPathComponent("\(label)-run.json"))
        try enc.encode(counts).write(to: out.appendingPathComponent("\(label)-calls.json"))
        for r in run.cases where r.pass == false && r.firstWhy?.code != .budget && r.firstWhy?.code != .error {
            let f = TrainingFixture(r, settings: .init())
            try f.encoded().write(to: out.appendingPathComponent("fixtures").appendingPathComponent("\(r.hand)-\(f.fileName)"))
        }
        if let backend { try? await backend.auth.signOut(scope: .local) }
    }

    /// The catalogue's cases named by `filter`: all, none, or ids / id prefixes.
    static func catalogue(_ filter: String) -> [TrainingCase] {
        if filter == "all" { return TrainingCatalogue.all }
        if filter == "none" { return [] }
        let keys = filter.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        return TrainingCatalogue.all.filter { c in keys.contains { c.id == $0 || c.id.hasPrefix($0) } }
    }

    static func saveCache(_ services: BenchServices, to url: URL?) {
        guard let url, let data = try? JSONEncoder().encode(services.snapshot.cache) else { return }
        try? data.write(to: url, options: .atomic)
    }
}

/// The run in words: lines and pages right by kind of writing, hand and grade, the failure classes, the
/// calls.
enum BenchReport {
    /// The classes a failed line falls in.
    static func failureClass(_ code: TrainingWhy.Code) -> String {
        switch code {
        case .misread, .unread: return "reading"
        case .split, .merged: return "clustering"
        case .wrongRing, .missedRing, .wrongMark, .asked, .wrongValue, .held, .notSolved, .falselySolved: return "judging"
        case .budget, .error: return "bench"
        }
    }

    static func text(_ run: TrainingRun, counts: BenchServices.Counts, label: String) -> String {
        let s = run.summary
        func pct(_ a: Int, _ b: Int) -> String { b == 0 ? "-" : String(format: "%.1f%%", 100 * Double(a) / Double(b)) }
        var out = "BENCH REPORT \(label)\n"
        out += "pages \(s.passed)/\(s.cases) (\(pct(s.passed, s.cases)))  lines \(s.linesPassed)/\(s.lines) (\(pct(s.linesPassed, s.lines)))  reads right \(s.readsRight)/\(s.readsChecked) (\(pct(s.readsRight, s.readsChecked)))\n"
        out += "rings on right work \(s.wrongRings)  slips not ringed \(s.missedRings)\n"
        out += "calls: recognize \(counts.recognizeCalls) (+\(counts.recognizeCached) cached, \(counts.recognizeMisses) misses), other \(counts.otherCalls) (+\(counts.otherCached) cached, \(counts.otherMisses) misses), hints worded locally \(counts.hintsLocal), refused \(counts.refused), errors \(counts.errors)\n"
        var classes: [String: Int] = [:]
        for r in run.cases {
            for l in r.lines where l.pass == false { classes[failureClass(l.why?.code ?? .error), default: 0] += 1 }
            if r.pass == false, r.lines.allSatisfy({ $0.pass != false }), let w = r.why { classes[failureClass(w.code), default: 0] += 1 }
        }
        out += "failure classes: " + classes.sorted { $0.value > $1.value }.map { "\($0.key) \($0.value)" }.joined(separator: ", ") + "\n"
        out += "reasons: " + s.reasons.map { "\($0.code.rawValue) \($0.count)" }.joined(separator: ", ") + "\n"
        func table(_ title: String, _ buckets: [TrainingSummary.Bucket]) {
            out += "\n\(title)\n"
            for b in buckets { out += "  \(b.name.padding(toLength: 28, withPad: " ", startingAt: 0)) pages \(b.passed)/\(b.cases) (\(pct(b.passed, b.cases)))  lines \(b.linesPassed)/\(b.lines) (\(pct(b.linesPassed, b.lines)))\n" }
        }
        table("by kind of writing", s.byCategory)
        table("by hand", s.byHand)
        table("by grade", s.byGrade)
        out += "\nfailures\n"
        for r in run.cases where r.pass == false {
            let lines = r.lines.map { l in "\(l.written) → \(l.read ?? "-") [\(l.mark.rawValue)/\(l.expect?.rawValue ?? "-")]\(l.pass == false ? " ✗ \(l.why?.code.rawValue ?? "")" : "")" }
            out += "  \(r.caseKey)@\(r.hand): \(lines.joined(separator: " | "))\(r.why.map { " — \($0.code.rawValue)" } ?? "")\n"
        }
        return out
    }
}
