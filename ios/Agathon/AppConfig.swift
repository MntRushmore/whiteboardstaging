import Foundation

/// Where the app's backend lives: the Next.js API on Vercel and Supabase (docs/IPAD-NATIVE.md).
enum AppConfig {
    /// The API the app calls (`/api/*`). A Debug run can point it at `npm run dev` with
    /// `AGATHON_API_URL` (the scheme has it, unticked).
    static let apiBaseURL: URL = {
        #if DEBUG
        if let url = overrideURL("AGATHON_API_URL") { return url }
        #endif
        return URL(string: "https://www.agathon.app")!
    }()

    static var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
    }

    static var build: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
    }

    #if DEBUG
    private static func overrideURL(_ key: String) -> URL? {
        guard let raw = ProcessInfo.processInfo.environment[key],
              let url = URL(string: raw), url.scheme != nil, url.host != nil
        else { return nil }
        return url
    }
    #endif
}
