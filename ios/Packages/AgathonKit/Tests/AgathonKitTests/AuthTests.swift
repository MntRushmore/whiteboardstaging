import Foundation
import Supabase
import Testing
@testable import AgathonKit

struct TermsVersionTests {
    /// src/lib/legal.ts, found from this file (ios/Packages/AgathonKit/Tests/AgathonKitTests/).
    static let legalFile: URL = {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0 ..< 6 { url.deleteLastPathComponent() }
        return url.appendingPathComponent("src/lib/legal.ts")
    }()

    @Test(.enabled(if: FileManager.default.isReadableFile(atPath: legalFile.path), "needs the repo's src/lib/legal.ts"))
    func matchesTheWeb() throws {
        let source = try String(contentsOf: Self.legalFile, encoding: .utf8)
        let match = try #require(source.firstMatch(of: #/export const TERMS_VERSION = "(\d{4}-\d{2}-\d{2})"/#))
        #expect(TermsVersion.current == String(match.1), "TermsVersion.current must equal TERMS_VERSION in src/lib/legal.ts")
    }

    @Test func isADateNoLaterThanTomorrow() throws {
        // The database refuses a sign-up whose version is in the future (signup_terms_version()).
        let date = try #require(PostgresDate.parse(TermsVersion.current + "T00:00:00Z"))
        #expect(date <= Date().addingTimeInterval(86_400))
    }

    @Test func signUpSendsTheTermsVersion() {
        #expect(AuthService.signUpMetadata == ["terms_version": .string(TermsVersion.current)])
    }
}

@MainActor
struct AuthWiringTests {
    /// A backend whose services point nowhere (nothing in these tests reaches the network).
    private func backend() -> AgathonBackend {
        let nowhere = AgathonEnvironment(apiBaseURL: URL(string: "http://127.0.0.1:9")!,
                                         supabaseURL: URL(string: "http://127.0.0.1:9")!,
                                         supabaseAnonKey: Fixtures.jwt(["role": "anon"]))
        return AgathonBackend(environment: nowhere, release: AppRelease(version: "1", build: "1"), authStorage: InMemoryAuthStorage())
    }

    @Test func withNoStoredSessionTheAppIsSignedOut() async throws {
        let backend = backend()
        #expect(backend.auth.phase == .restoring)
        backend.auth.start()
        let deadline = ContinuousClock.now + .seconds(5)
        while backend.auth.phase == .restoring, ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(20))
        }
        #expect(backend.auth.phase == .signedOut)
        #expect(backend.auth.userId == nil)
    }

    @Test func signedOutHasNoToken() async throws {
        let backend = backend()
        #expect(try await AuthService.accessToken(from: backend.supabase) == nil)
        // So every API call fails before it is sent.
        await #expect(throws: APIError.notSignedIn) {
            _ = try await backend.family.load()
        }
    }

    @Test func authErrorsReadKindly() {
        #expect(AuthService.message(for: URLError(.notConnectedToInternet)).contains("Check your connection"))
        #expect(AuthService.message(for: APIError.timeout).contains("stalled"))
    }
}
