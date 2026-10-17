import Foundation

/// Which build of the app is running: what error reports carry as `release` (`ios-1.0-7`), so the
/// admin page tells the iPad app's reports from the web's (whose release is a commit).
public struct AppRelease: Sendable, Equatable {
    public let version: String
    public let build: String

    public init(version: String, build: String) {
        self.version = version
        self.build = build
    }

    /// From an Info.plist (`CFBundleShortVersionString`, `CFBundleVersion`).
    public init(bundle: Bundle) {
        self.init(
            version: bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0",
            build: bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
        )
    }

    /// `ios-<version>-<build>`, at most 64 characters (the server's cap).
    public var string: String {
        String("ios-\(version)-\(build)".prefix(64))
    }

    /// What the app calls itself in an error report's `userAgent`.
    public var userAgent: String {
        let os = ProcessInfo.processInfo.operatingSystemVersion
        return "Agathon-iOS/\(version) (\(build); iPadOS \(os.majorVersion).\(os.minorVersion).\(os.patchVersion))"
    }
}
