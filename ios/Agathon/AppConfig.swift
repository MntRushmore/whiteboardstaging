import Foundation

/// Where the app points and how it introduces itself to the site.
enum AppConfig {
    static let productionURL = URL(string: "https://www.agathon.app")!

    /// The site the app shows: production, unless a Debug run sets `AGATHON_URL`
    /// (e.g. `http://localhost:3000` for `npm run dev`; the scheme has it, unticked).
    static let baseURL: URL = {
        #if DEBUG
        if let raw = ProcessInfo.processInfo.environment["AGATHON_URL"],
           let url = URL(string: raw), url.scheme != nil, url.host != nil {
            return url
        }
        #endif
        return productionURL
    }()

    /// Agathon's own hosts: pages here open in the app, may use the mic and may talk to the app
    /// (NativeBridge). The apex and the old host only redirect to www.
    static let siteHosts: Set<String> = {
        var hosts: Set<String> = ["www.agathon.app", "agathon.app", "whiteboard.rushilchopra.com"]
        if let host = baseURL.host?.lowercased() { hosts.insert(host) }
        return hosts
    }()

    /// Hosts whose pages open inside the app: the site, plus Stripe, so a checkout started in the
    /// app comes back to the app still signed in. (How the app sells plans on the App Store is
    /// still open: see ios/README.md.)
    static let appHosts: Set<String> = siteHosts.union([
        "checkout.stripe.com",
        "buy.stripe.com",
        "billing.stripe.com",
    ])

    /// The flag cookie the site keeps in step with the supabase-js session
    /// (src/lib/landing/sessionCookie.ts). Without it, `/` is the marketing page.
    static let sessionCookie = "agathon_session"

    static var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
    }

    static var build: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
    }

    /// Appended to WebKit's user agent. A web view on an iPad already reports the Mac UA that
    /// Safari on iPad sends, minus Safari's own tokens; "Version/… Safari/605.1.15" puts them back
    /// so tldraw and the mic recorder take the same paths they do in Safari (QA'd in
    /// docs/QA-2026-10-03-webkit.md). "AgathonApp/<version>" tells the site it is in the app.
    static var userAgentSuffix: String {
        let major = ProcessInfo.processInfo.operatingSystemVersion.majorVersion
        return "Version/\(major).0 Safari/605.1.15 AgathonApp/\(version)"
    }
}
