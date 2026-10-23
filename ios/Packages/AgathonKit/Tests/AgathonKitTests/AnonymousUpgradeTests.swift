import Foundation
import Supabase
import Testing
@testable import AgathonKit

/// SAT practice with no account (docs/SAT-MODE.md): an anonymous session made a real account keeps
/// its user id, so the SAT answers, passes and board carry over. Against the LOCAL stack only (see
/// LocalStackIntegrationTests); skipped unless AGATHON_INTEGRATION=1, and when the local project has
/// anonymous sign-ins off. (The app never signs in anonymously itself: the server's /api/sat/anon
/// mints that session; this test makes one directly, on the local stack, to test the upgrade.)
@MainActor
@Suite(.enabled(if: LocalStack.enabled, "set AGATHON_INTEGRATION=1 and point it at the local stack"), .serialized)
struct AnonymousUpgradeTests {
    @Test func upgradingAnAnonymousUserKeepsTheSameUser() async throws {
        let environment = try LocalStack.environment()
        try #require(environment.isLocal, "only against the local stack")
        let backend = AgathonBackend(environment: environment, release: AppRelease(version: "0", build: "test"),
                                     authStorage: InMemoryAuthStorage())
        backend.auth.start()
        let anon: Session
        do {
            anon = try await backend.supabase.auth.signInAnonymously()
        } catch {
            // anonymous sign-ins are off on this local project: nothing to test here
            return
        }
        try await backend.auth.setSession(accessToken: anon.accessToken, refreshToken: anon.refreshToken)
        #expect(backend.auth.isAnonymous)
        let id = try #require(backend.auth.userId)
        let email = "sat-upgrade-\(Int(Date().timeIntervalSince1970))@example.com"
        _ = try await backend.auth.upgradeAnonymous(email: email, password: "sat-practice-2026")
        // the same user, whether or not the address waits for its link
        #expect(backend.auth.userId == id)
        let user = try await backend.supabase.auth.user()
        #expect(user.id.uuidString.lowercased() == id)
        #expect(user.email == email || user.newEmail == email)
    }

    @Test func aRealAccountIsNeverUpgraded() async throws {
        let environment = try LocalStack.environment()
        try #require(environment.isLocal, "only against the local stack")
        let backend = AgathonBackend(environment: environment, release: AppRelease(version: "0", build: "test"),
                                     authStorage: InMemoryAuthStorage())
        backend.auth.start()
        try await backend.auth.signIn(email: LocalStack.email, password: LocalStack.password)
        #expect(!backend.auth.isAnonymous)
        await #expect(throws: APIError.self) { try await backend.auth.upgradeAnonymous(email: "x@example.com", password: "password123") }
        try await backend.auth.signOut(scope: .local)
    }
}
