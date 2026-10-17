import Foundation
import Testing
@testable import AgathonKit

struct EnvironmentTests {
    private let localAnon = Fixtures.jwt(["iss": "supabase-demo", "role": "anon"])

    @Test func productionIsTheLiveAppOverHTTPS() {
        let prod = AgathonEnvironment.production
        #expect(prod.apiBaseURL.absoluteString == "https://www.agathon.app")
        #expect(prod.supabaseURL.absoluteString == "https://sgolkponjdkphndosrea.supabase.co")
        #expect(!prod.isLocal)
    }

    @Test func productionShipsOnlyThePublicAnonKey() throws {
        let claims = try #require(JWTClaims.payload(of: AgathonEnvironment.production.supabaseAnonKey))
        #expect(claims["role"] as? String == "anon")
        #expect(claims["ref"] as? String == "sgolkponjdkphndosrea")
        try AgathonEnvironment.checkPublicKey(AgathonEnvironment.production.supabaseAnonKey)
    }

    @Test func noOverridesIsProduction() throws {
        #expect(try AgathonEnvironment.resolve(environment: [:], allowOverrides: true) == .production)
        // Empty and blank values count as unset.
        let blank = ["AGATHON_API_URL": "", "SUPABASE_URL": "  ", "SUPABASE_ANON_KEY": ""]
        #expect(try AgathonEnvironment.resolve(environment: blank, allowOverrides: true) == .production)
    }

    @Test func releaseBuildsIgnoreOverrides() throws {
        let env = ["AGATHON_API_URL": "http://localhost:3101", "SUPABASE_URL": "http://127.0.0.1:54321", "SUPABASE_ANON_KEY": localAnon]
        #expect(try AgathonEnvironment.resolve(environment: env, allowOverrides: false) == .production)
    }

    @Test func debugTestBuildsAllowOverrides() {
        #expect(AgathonEnvironment.overridesAllowed)
    }

    @Test func apiOverrideAlone() throws {
        let env = try AgathonEnvironment.resolve(environment: ["AGATHON_API_URL": "http://localhost:3101/"], allowOverrides: true)
        #expect(env.apiBaseURL.absoluteString == "http://localhost:3101")
        #expect(env.supabaseURL == AgathonEnvironment.production.supabaseURL)
        #expect(env.supabaseAnonKey == AgathonEnvironment.production.supabaseAnonKey)
        #expect(env.isLocal)
    }

    @Test func theLocalStack() throws {
        let env = try AgathonEnvironment.resolve(environment: [
            "AGATHON_API_URL": "http://localhost:3101",
            "SUPABASE_URL": "http://127.0.0.1:54321",
            "SUPABASE_ANON_KEY": localAnon,
        ], allowOverrides: true)
        #expect(env.supabaseURL.absoluteString == "http://127.0.0.1:54321")
        #expect(env.supabaseAnonKey == localAnon)
        #expect(env.isLocal)
    }

    @Test func supabaseURLAndKeyGoTogether() {
        #expect(throws: AgathonEnvironment.ResolveError.incompleteSupabaseOverride(missing: "SUPABASE_ANON_KEY")) {
            try AgathonEnvironment.resolve(environment: ["SUPABASE_URL": "http://127.0.0.1:54321"], allowOverrides: true)
        }
        #expect(throws: AgathonEnvironment.ResolveError.incompleteSupabaseOverride(missing: "SUPABASE_URL")) {
            try AgathonEnvironment.resolve(environment: ["SUPABASE_ANON_KEY": localAnon], allowOverrides: true)
        }
    }

    @Test func aServiceRoleKeyIsRefused() {
        let serviceRole = Fixtures.jwt(["role": "service_role"])
        #expect(throws: AgathonEnvironment.ResolveError.notAPublicKey(reason: "its role is service_role")) {
            try AgathonEnvironment.resolve(environment: ["SUPABASE_URL": "http://127.0.0.1:54321", "SUPABASE_ANON_KEY": serviceRole],
                                           allowOverrides: true)
        }
        #expect(throws: AgathonEnvironment.ResolveError.self) {
            try AgathonEnvironment.checkPublicKey("sb_secret_abc123")
        }
        #expect(throws: AgathonEnvironment.ResolveError.self) {
            try AgathonEnvironment.checkPublicKey("<ANON_KEY from npx supabase status -o env>")
        }
    }

    @Test func aPublishableKeyIsAccepted() throws {
        try AgathonEnvironment.checkPublicKey("sb_publishable_abc123")
    }

    @Test func urlsMustBeHTTP() {
        #expect(throws: AgathonEnvironment.ResolveError.self) {
            try AgathonEnvironment.resolve(environment: ["AGATHON_API_URL": "localhost:3101"], allowOverrides: true)
        }
        #expect(throws: AgathonEnvironment.ResolveError.self) {
            try AgathonEnvironment.resolve(environment: ["AGATHON_API_URL": "ftp://example.test"], allowOverrides: true)
        }
    }
}
