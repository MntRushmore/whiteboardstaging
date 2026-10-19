import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation
import Testing
@testable import AgathonLive

/// The loop against the LOCAL stack (`npm run db:start`, `npm run dev`), never production: real
/// Mathpix reads and one real check (about 4 ink and a few cents of AI). Skipped unless
/// AGATHON_INTEGRATION=1, and refused unless every URL is on this machine.
///
///     TEST_RUNNER_AGATHON_INTEGRATION=1 \
///     TEST_RUNNER_AGATHON_API_URL=http://localhost:3201 \
///     TEST_RUNNER_SUPABASE_URL=http://127.0.0.1:54321 \
///     TEST_RUNNER_SUPABASE_ANON_KEY=<ANON_KEY from `npx supabase status -o env`> \
///     xcodebuild test -scheme AgathonLive -only-testing:AgathonLiveTests/LocalStackLiveTests …
///
/// Signs in as the seeded QA user (AGATHON_TEST_EMAIL / AGATHON_TEST_PASSWORD, default
/// qa-student@example.com / password123).
@MainActor
@Suite(.enabled(if: ProcessInfo.processInfo.environment["AGATHON_INTEGRATION"] == "1", "set AGATHON_INTEGRATION=1 and point it at the local stack"), .serialized)
struct LocalStackLiveTests {
    @Test func aSlipIsReadTickedRingedAndHinted() async throws {
        let env = ProcessInfo.processInfo.environment
        let environment = try AgathonEnvironment.resolve(environment: env, allowOverrides: true)
        try #require(environment.isLocal, "the integration test only runs against the local stack")
        let backend = AgathonBackend(environment: environment, release: AppRelease(version: "0", build: "live-test"), authStorage: InMemoryAuthStorage())
        backend.auth.start()
        try await backend.auth.signIn(email: env["AGATHON_TEST_EMAIL"] ?? "qa-student@example.com", password: env["AGATHON_TEST_PASSWORD"] ?? "password123")

        let board = TestBoard()
        let scheduler = ManualScheduler()
        let loop = LiveLoop(board: board, boardId: "ios-live-integration", services: LiveAPIServices(backend: backend),
                            settings: LiveSettings(enabled: true, mode: .feedback, auto: true, checking: .asIGo), brain: TestBrain.shared,
                            background: TestBrain.background, scheduler: scheduler, connectivity: ManualConnectivity())
        loop.start()
        await loop.waitUntilIdle()
        func pass(_ ms: Double) async {
            var left = ms
            while left > 0 {
                scheduler.advance(min(100, left))
                left -= 100
                for _ in 0..<3 { await loop.waitUntilIdle(timeout: .seconds(30)) }
            }
        }
        for (i, latex) in ["2x + 3 = 11", "2x = 8", "x = 5"].enumerated() {
            board.kidWrites(KidHands.strokes(latex, hand: "slanted", at: Vec2(200, 120 + Double(i) * 100), scale: 1.5))
        }
        await pass(700)
        let reads = loop.lines.values.sorted { $0.row < $1.row }.map(\.latex)
        #expect(reads.count == 3, "three lines read: \(reads)")
        #expect(board.mark(on: reads.count == 3 ? reads[1] : "") == .tick, "2x = 8 ticked (read as \(reads))")
        #expect(board.mark(on: reads.count == 3 ? reads[2] : "") == .ring, "x = 5 ringed")
        #expect(loop.metrics.recognize.allSatisfy { $0 < 6_000 })

        let slip = try #require(loop.lines.values.max { $0.row < $1.row })
        loop.startCheck(column: slip.column, focus: slip.id, userAsked: true, forceHint: true)
        await pass(100)
        #expect(loop.hints.first.map { !$0.message.isEmpty } == true, "a hint card with the tutor's words")
        #expect(loop.activity == .idle)
        loop.stop()
        try await backend.auth.signOut(scope: .local)
    }
}
