import Foundation
import Testing
@testable import Agathon

struct LinkPolicyTests {
    private func destination(_ raw: String) -> LinkDestination {
        LinkPolicy.destination(for: URL(string: raw)!)
    }

    @Test(arguments: [
        "https://www.agathon.app/",
        "https://www.agathon.app/board/7f3c?screen=2",
        "https://agathon.app/login",
        "https://whiteboard.rushilchopra.com/account",
        "https://WWW.Agathon.App/progress",
    ])
    func agathonPagesStayInTheApp(_ url: String) {
        #expect(destination(url) == .app)
    }

    @Test(arguments: [
        "https://buy.stripe.com/test_abc",
        "https://checkout.stripe.com/c/pay/cs_live_123",
        "https://billing.stripe.com/p/session/abc",
    ])
    func stripeCheckoutStaysInTheAppToComeBackSignedIn(_ url: String) {
        #expect(destination(url) == .app)
    }

    @Test(arguments: [
        "https://openrouter.ai/keys",
        "https://www.agathon.app.example.com/",
        "https://notagathon.app/",
        "https://stripe.com/privacy",
        "http://example.com/",
    ])
    func otherSitesOpenInTheBrowserSheet(_ url: String) {
        #expect(destination(url) == .browser)
    }

    @Test(arguments: [
        "mailto:hello@mail.agathon.app",
        "tel:+15555550123",
        "sms:+15555550123",
        "itms-apps://apps.apple.com/app/id1",
    ])
    func nonWebLinksGoToIPadOS(_ url: String) {
        #expect(destination(url) == .system)
    }

    @Test(arguments: [
        "about:blank",
        "blob:https://www.agathon.app/2b9c3c1e-3e8f-4bfa-9d4c-1f1f7a0b8c11",
        "data:text/plain,hi",
    ])
    func thePagesOwnURLsStay(_ url: String) {
        #expect(destination(url) == .app)
    }
}

struct AppConfigTests {
    @Test func userAgentReadsAsSafariOnIPadPlusTheApp() {
        let suffix = AppConfig.userAgentSuffix
        #expect(suffix.contains("Safari/605.1.15"))
        #expect(suffix.contains("AgathonApp/"))
        #expect(suffix.hasPrefix("Version/"))
    }

    @Test func micAndBridgeAreForAgathonOnly() {
        #expect(AppConfig.siteHosts.contains("www.agathon.app"))
        #expect(!AppConfig.siteHosts.contains("checkout.stripe.com"))
        #expect(AppConfig.appHosts.isSuperset(of: AppConfig.siteHosts))
    }
}

struct NativeBridgeTests {
    @Test func bootstrapDefinesTheGlobalOnceAndTouchesNoDOM() {
        let script = NativeBridge.bootstrapScript
        #expect(script.contains("window.AgathonNative = Object.freeze"))
        #expect(script.contains("if (window.AgathonNative) return;"))
        #expect(script.contains("messageHandlers.agathon.postMessage"))
        #expect(!script.contains("document."))
    }
}
