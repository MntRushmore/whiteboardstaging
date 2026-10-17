import Foundation
import Testing
@testable import AgathonKit

/// End to end against the LOCAL stack (`npm run db:start`, `npm run db:seed`, `npm run dev`), never
/// production: skipped unless AGATHON_INTEGRATION=1, and refused unless every URL is on this machine.
///
///     TEST_RUNNER_AGATHON_INTEGRATION=1 \
///     TEST_RUNNER_AGATHON_API_URL=http://127.0.0.1:3101 \
///     TEST_RUNNER_SUPABASE_URL=http://127.0.0.1:54321 \
///     TEST_RUNNER_SUPABASE_ANON_KEY=<ANON_KEY from `npx supabase status -o env`> \
///     xcodebuild test -scheme Agathon …
///
/// (`swift test` takes the same variables without the TEST_RUNNER_ prefix.) Signs in as the seeded
/// QA user (AGATHON_TEST_EMAIL / AGATHON_TEST_PASSWORD, default qa-student@example.com /
/// password123), makes a board, renames it, deletes it, reads the family, the profile and the ink,
/// sends an error report, and signs out.
@MainActor
@Suite(.enabled(if: LocalStack.enabled, "set AGATHON_INTEGRATION=1 and point it at the local stack"), .serialized)
struct LocalStackIntegrationTests {
    @Test func signInBoardsFamilyInkAndSignOut() async throws {
        let environment = try LocalStack.environment()
        try #require(environment.isLocal, "the integration test only runs against the local stack")
        let backend = AgathonBackend(environment: environment, release: AppRelease(version: "0", build: "test"),
                                     authStorage: InMemoryAuthStorage())
        backend.auth.start()

        try await backend.auth.signIn(email: LocalStack.email, password: LocalStack.password)
        #expect(backend.auth.phase == .signedIn)
        let userId = try #require(backend.auth.userId)
        #expect(backend.auth.email == LocalStack.email)
        let token = try #require(try await AuthService.accessToken(from: backend.supabase))
        #expect(!token.isEmpty)

        // Boards: make one, see it, rename it, delete it.
        let before = try await backend.boards.list()
        let made = try await backend.boards.create(title: "iOS integration \(Int(Date().timeIntervalSince1970))")
        #expect(made.title.hasPrefix("iOS integration"))
        #expect(made.updatedAt != nil)
        let listed = try await backend.boards.list()
        #expect(listed.count == before.count + 1)
        #expect(listed.first?.id == made.id, "newest first")
        let renamed = try await backend.boards.rename(id: made.id, to: "  Renamed by iOS  ")
        #expect(renamed.title == "Renamed by iOS")
        let deleted = try await backend.boards.delete(id: made.id)
        #expect(deleted.assetErrors.isEmpty)
        #expect(try await backend.boards.list().contains { $0.id == made.id } == false)

        // The family, as the API sees this user.
        let family = try await backend.family.load()
        #expect(family.me == userId)

        // The profile and the ink.
        let profile = try await backend.profiles.profile()
        #expect(profile?.userId == userId)
        let ink = try await backend.profiles.inkSummary()
        #expect(ink.balance >= 0)

        // An error report the server accepts (204).
        let reported = await backend.errors.reportUserError(kind: "live.app", code: "ios_integration",
                                                            message: "iOS integration test report", level: .info, path: "/integration")
        #expect(reported, "POST /api/client-errors refused source \"ios\"")

        try await backend.auth.signOut(scope: .local)
        #expect(backend.auth.phase == .signedOut)
        #expect(try await AuthService.accessToken(from: backend.supabase) == nil)
    }
}

enum LocalStack {
    static let env = ProcessInfo.processInfo.environment
    static var enabled: Bool { env["AGATHON_INTEGRATION"] == "1" }
    static var email: String { env["AGATHON_TEST_EMAIL"] ?? "qa-student@example.com" }
    static var password: String { env["AGATHON_TEST_PASSWORD"] ?? "password123" }

    static func environment() throws -> AgathonEnvironment {
        try AgathonEnvironment.resolve(environment: env, allowOverrides: true)
    }
}
