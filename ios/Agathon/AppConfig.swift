import AgathonKit
import Foundation

/// Where the app's backend lives: the Next.js API on Vercel and Supabase (docs/IPAD-NATIVE.md).
/// The values come from AgathonKit's `AgathonEnvironment`: production, or a Debug run's
/// AGATHON_API_URL / SUPABASE_URL + SUPABASE_ANON_KEY (in the scheme, unticked).
enum AppConfig {
    /// What this run talks to.
    static var environment: AgathonEnvironment { .current }

    /// The API the app calls (`/api/*`).
    static var apiBaseURL: URL { environment.apiBaseURL }

    static var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
    }

    static var build: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
    }

    /// The commit this build came from (`AgathonCommit`; "dev" when built without it).
    static var commit: String {
        Bundle.main.object(forInfoDictionaryKey: "AgathonCommit") as? String ?? "dev"
    }

    /// What the Account page shows, so a tester can say which build they have: "Version 1.0 (2412) · 784f1c9".
    static var versionLine: String { "Version \(version) (\(build)) · \(commit)" }

    /// What error reports carry as `release`: `ios-<version>-<build>`.
    static var release: AppRelease { AppRelease(version: version, build: build) }
}
