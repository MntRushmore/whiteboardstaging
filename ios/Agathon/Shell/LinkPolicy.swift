import Foundation

/// Where a link the page opens should go.
enum LinkDestination: Equatable {
    /// Load it in the app's web view (or, for a new window, in a sheet that shares its session).
    case app
    /// Another site: show it in an in-app Safari sheet, so the board stays where it was.
    case browser
    /// Not a web page (mailto:, tel:, sms:, an App Store link…): hand it to iPadOS.
    case system
}

enum LinkPolicy {
    static func destination(for url: URL, appHosts: Set<String> = AppConfig.appHosts) -> LinkDestination {
        switch url.scheme?.lowercased() {
        case nil, "about", "blob", "data", "javascript":
            return .app
        case "http", "https":
            guard let host = url.host?.lowercased() else { return .app }
            return appHosts.contains(host) ? .app : .browser
        default:
            return .system
        }
    }
}
