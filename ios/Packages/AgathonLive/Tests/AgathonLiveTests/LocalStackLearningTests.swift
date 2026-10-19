import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation
import Testing
@testable import AgathonLive

/// The learning record against the LOCAL stack (`npm run db:start`), never production: no AI, no
/// ink. Skipped unless AGATHON_INTEGRATION=1, and refused unless every URL is on this machine.
///
///     TEST_RUNNER_AGATHON_INTEGRATION=1 \
///     TEST_RUNNER_AGATHON_API_URL=http://localhost:3951 \
///     TEST_RUNNER_SUPABASE_URL=http://127.0.0.1:54321 \
///     TEST_RUNNER_SUPABASE_ANON_KEY=<ANON_KEY from `npx supabase status -o env`> \
///     xcodebuild test … -only-testing:AgathonLiveTests/LocalStackLearningTests
///
/// Signs in as the seeded QA user, makes a board, records attempts on it the way a board session
/// does (a problem solved alone, a slip classified by the brain, the tutor's solve and a Now you try
/// after it, a Today's practice problem), saves them as the user under RLS, reads them back through
/// `LearningRepository` and the brain's `progressSummary`, checks the day's row went up — then
/// deletes the attempts and the board.
@MainActor
@Suite(.enabled(if: ProcessInfo.processInfo.environment["AGATHON_INTEGRATION"] == "1", "set AGATHON_INTEGRATION=1 and point it at the local stack"), .serialized)
struct LocalStackLearningTests {
    @Test func attemptsAreSavedAsTheStudentAndTheProgressNumbersMove() async throws {
        let env = ProcessInfo.processInfo.environment
        let environment = try AgathonEnvironment.resolve(environment: env, allowOverrides: true)
        try #require(environment.isLocal, "the integration test only runs against the local stack")
        let backend = AgathonBackend(environment: environment, release: AppRelease(version: "0", build: "learning-test"), authStorage: InMemoryAuthStorage())
        backend.auth.start()
        try await backend.auth.signIn(email: env["AGATHON_TEST_EMAIL"] ?? "qa-student@example.com", password: env["AGATHON_TEST_PASSWORD"] ?? "password123")
        let repository = LearningRepository(client: backend.supabase)
        let brain = TestBrain.shared
        try await brain.load()
        let now = Date()
        let tz = FamilyService.tzOffset(.current, at: now)
        func summary() async throws -> (problems: Int, independent: Int, attempts: [AgathonKit.AttemptRecord]) {
            let attempts = try await repository.attempts()
            let values = try JSONDecoder().decode([AgathonBrain.JSONValue].self, from: JSONEncoder().encode(attempts))
            let s = try await brain.progressSummary(attempts: values, now: Date(), tzOffsetMinutes: tz)
            let json = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(s.summary)) as? [String: Any])
            let totals = try #require(json["totals"] as? [String: Any])
            return ((totals["problems"] as? NSNumber)?.intValue ?? -1, (totals["independent"] as? NSNumber)?.intValue ?? -1, attempts)
        }
        let before = try await summary()

        let board = try await backend.boards.create(title: "iOS learning \(Int(now.timeIntervalSince1970))")
        let learning = LiveLearning(boardId: board.id, brain: brain, scheduler: MainScheduler())
        learning.connect(backend: backend)
        let today = LocalDay.of(now)
        let daily = learning.daily(day: today, goal: 2)
        var t = (now.timeIntervalSince1970 * 1000).rounded(.down) - 120_000
        func at() -> Double {
            t += 4_000
            return t
        }
        let page = "screen:learning-test"
        func line(_ key: String, _ id: String, _ latex: String, _ mark: LineMark?, problem: [String], previous: String? = nil, solved: Bool = false) -> LearningSignal {
            .line(.init(at: at(), boardId: board.id, pageId: page, problemKey: key, problemLatex: problem, lineId: id, latex: latex,
                        kind: "equation", previousLatex: previous, mark: mark, solved: solved))
        }
        // 1. the student's own problem, solved alone
        let own = "\(page)#ink:l1"
        learning.emit(line(own, "l1", "2x+3=11", nil, problem: ["2x+3=11"]))
        learning.emit(line(own, "l2", "2x=8", .check, problem: ["2x+3=11"], previous: "2x+3=11"))
        learning.emit(line(own, "l3", "x=4", .check, problem: ["2x+3=11"], previous: "2x=8", solved: true))
        // 2. a slip the brain classifies, then the tutor's solve, then a Now you try after it
        let slip = "\(page)#ink:s1"
        learning.emit(line(slip, "s1", "3x+5=20", nil, problem: ["3x+5=20"]))
        learning.emit(line(slip, "s2", "3x=25", .circle, problem: ["3x+5=20"], previous: "3x+5=20"))
        let solvedAt = at()
        learning.emit(.help(.init(at: solvedAt, problemKey: slip, help: .solve, auto: false)))
        learning.emit(.tutorSolved(.init(at: solvedAt, boardId: board.id, pageId: page, problemKey: slip, problemLatex: ["3x+5=20"])))
        let parent = try #require(await learning.attemptId(forProblemKey: slip))
        let nyt = "\(page)#cell:nyt1"
        learning.emit(.problem(.init(at: at(), boardId: board.id, pageId: page, problemKey: nyt, problemLatex: ["4x+1=13"], origin: .nowYouTry, parentId: parent)))
        learning.emit(line(nyt, "n1", "4x=12", .check, problem: ["4x+1=13"], previous: "4x+1=13"))
        learning.emit(line(nyt, "n2", "x=3", .check, problem: ["4x+1=13"], previous: "4x=12", solved: true))
        // 3. one of Today's practice's problems
        let practice = "\(page)#cell:p1"
        learning.emit(.problem(.init(at: at(), boardId: board.id, pageId: page, problemKey: practice, problemLatex: ["7+5"], origin: .practice)))
        learning.emit(.line(.init(at: at(), boardId: board.id, pageId: page, problemKey: practice, problemLatex: ["7+5"], lineId: "p1",
                                  latex: "12", kind: "expression", previousLatex: "7+5", mark: .check, solved: true)))
        await learning.settled()
        let mine = learning.attempts()
        #expect(mine.count == 4, "\(mine.map { "\($0.problemLatex) \($0.outcome)" })")
        await learning.flush()
        #expect(learning.lastSave == "", "saved: \(learning.lastSave ?? "never tried")")

        // read back as the student
        let after = try await summary()
        let rows = Dictionary(uniqueKeysWithValues: after.attempts.filter { r in mine.contains { $0.id == r.id } }.map { ($0.id, $0) })
        #expect(rows.count == 4, "all four rows are there")
        for r in mine {
            let row = try #require(rows[r.id])
            #expect(row.boardId == board.id)
            #expect(row.outcome == r.outcome.rawValue)
            #expect(row.origin == r.origin.rawValue)
            #expect(row.skill == r.skill)
            #expect(row.parentId == r.parentId)
            #expect(row.mistakes == r.mistakes)
            #expect(row.linesWritten == r.linesWritten && row.linesRight == r.linesRight && row.linesRinged == r.linesRinged)
            #expect(LearningTime.parse(row.startedAt) == LearningTime.parse(r.startedAt), "the device's start time, to the ms")
        }
        let slipRow = try #require(mine.first { $0.problemLatex == "3x+5=20" })
        #expect(slipRow.outcome == .tutorSolved && !slipRow.mistakes.isEmpty)
        #expect(mine.first { $0.origin == .nowYouTry }?.parentId == slipRow.id)
        #expect(after.problems == before.problems + 4, "the Progress page's problem count: \(before.problems) → \(after.problems)")
        #expect(after.independent == before.independent + 3, "solved alone: the own problem, the Now you try, the practice one")

        // Today's practice: one problem done, its star, the day's row saved
        #expect(daily.done == 1 && daily.stars == 1)
        try await Task.sleep(for: .milliseconds(1_800))
        let row = try await repository.dailyPractice(since: today).first { $0.day == today }
        #expect((row?.done ?? 0) >= 1 && (row?.stars ?? 0) >= 1, "the day's row went up: \(String(describing: row))")

        // tidy up: the attempts, then the board
        _ = try await backend.supabase.from("learning_attempts").delete().in("id", values: mine.map(\.id)).execute()
        _ = try await backend.boards.delete(id: board.id)
        learning.stop()
        try await backend.auth.signOut(scope: .local)
    }
}
