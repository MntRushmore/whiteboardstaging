import UIKit
import WebKit

/// The contract between the site and the app (ios/README.md, "Talking to the page").
///
/// Page → app: before any of the page's own scripts run, `window.AgathonNative` is set to
/// `{ platform: "ipad", version, build, features, post(type, payload) }`. `post` sends a `Message`.
/// Only Agathon's own pages, in the main frame, are listened to.
///
/// App → page: DOM events on `window` (`Event`), with a `detail` object.
enum NativeBridge {
    static let handlerName = "agathon"

    enum Message: String {
        /// The page is up and drawn: drop the splash now.
        case ready
        /// `{ url }`: open in Safari itself (a link that must leave the app).
        case openExternal
        /// `{ text?, url? }`: the share sheet.
        case share
    }

    enum Event {
        /// `{ gesture: "tap" | "squeeze", preferredAction }`, from the Apple Pencil.
        static let pencil = "agathon:pencil"
    }

    /// What the page can count on, so it can feature-detect rather than check versions.
    static let features = ["pencilGestures", "downloads", "share", "openExternal"]

    static func install(in controller: WKUserContentController, proxy: ScriptMessageProxy) {
        controller.addUserScript(WKUserScript(
            source: bootstrapScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true,
            in: .page
        ))
        controller.add(proxy, contentWorld: .page, name: handlerName)
    }

    /// Defines `window.AgathonNative`. Touches no DOM, so React's hydration sees the server's HTML.
    static var bootstrapScript: String {
        let info: [String: Any] = [
            "platform": "ipad",
            "version": AppConfig.version,
            "build": AppConfig.build,
            "features": features,
        ]
        let data = (try? JSONSerialization.data(withJSONObject: info, options: [.sortedKeys])) ?? Data("{}".utf8)
        let json = String(decoding: data, as: UTF8.self)
        return """
        (() => {
          if (window.AgathonNative) return;
          const post = (type, payload) => {
            try {
              window.webkit.messageHandlers.\(handlerName).postMessage({ ...(payload || {}), type });
            } catch (_) {}
          };
          window.AgathonNative = Object.freeze({ ...\(json), post });
        })();
        """
    }

    static func name(of action: UIPencilPreferredAction) -> String {
        switch action {
        case .ignore: return "ignore"
        case .switchEraser: return "switchEraser"
        case .switchPrevious: return "switchPrevious"
        case .showColorPalette: return "showColorPalette"
        case .showInkAttributes: return "showInkAttributes"
        default: return "other"
        }
    }
}

/// WKUserContentController keeps its handlers alive; this holds the shell weakly so the shell can go.
final class ScriptMessageProxy: NSObject, WKScriptMessageHandler {
    weak var receiver: WKScriptMessageHandler?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        receiver?.userContentController(userContentController, didReceive: message)
    }
}
