import Network
import SafariServices
import SwiftUI
import WebKit

/// The app's one web view and everything around it: where links go, the first-load splash and the
/// offline screen, new windows, downloads, the mic prompt, JS dialogs, and the Pencil's gestures.
@MainActor
final class WebShell: NSObject, ObservableObject {
    enum Phase: Equatable {
        case loading
        case ready
        case offline
    }

    @Published private(set) var phase: Phase = .loading

    let webView: WKWebView

    private let messageProxy: ScriptMessageProxy
    private let pathMonitor = NWPathMonitor()
    private var started = false
    private var failedURL: URL?
    private var downloads: [ObjectIdentifier: URL] = [:]

    /// Errors that mean "no network" rather than "the page is broken".
    private static let offlineErrorCodes: Set<Int> = [
        NSURLErrorNotConnectedToInternet,
        NSURLErrorNetworkConnectionLost,
        NSURLErrorTimedOut,
        NSURLErrorCannotFindHost,
        NSURLErrorCannotConnectToHost,
        NSURLErrorDNSLookupFailed,
        NSURLErrorDataNotAllowed,
        NSURLErrorInternationalRoamingOff,
    ]

    override init() {
        let proxy = ScriptMessageProxy()
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.applicationNameForUserAgent = AppConfig.userAgentSuffix
        config.allowsInlineMediaPlayback = true
        // The tutor's spoken replies start after a network round trip, outside the tap that
        // asked; Safari would hold them back. In the app they just play.
        config.mediaTypesRequiringUserActionForPlayback = []
        config.dataDetectorTypes = []
        NativeBridge.install(in: config.userContentController, proxy: proxy)

        messageProxy = proxy
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        proxy.receiver = self

        webView.navigationDelegate = self
        webView.uiDelegate = self
        // A swipe from the edge with a finger must never leave the board.
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        webView.isOpaque = false
        webView.backgroundColor = .white
        webView.underPageBackgroundColor = .white
        webView.scrollView.backgroundColor = .white
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        #if DEBUG
        // Safari > Develop > (this iPad or simulator) opens Web Inspector on the app's page.
        webView.isInspectable = true
        #endif

        let pencil = UIPencilInteraction()
        pencil.delegate = self
        webView.addInteraction(pencil)
    }

    // MARK: Loading

    /// The first load. Signed in (the site's session flag cookie is set): the boards home.
    /// Otherwise the sign-in page, not the marketing page `/` shows a signed-out visitor.
    func start() {
        guard !started else { return }
        started = true
        watchNetwork()
        Task {
            let cookies = await webView.configuration.websiteDataStore.httpCookieStore.allCookies()
            let signedIn = cookies.contains { $0.name == AppConfig.sessionCookie && !$0.value.isEmpty }
            load(signedIn ? AppConfig.baseURL : AppConfig.baseURL.appending(path: "login"))
        }
    }

    func retry() {
        phase = .loading
        load(failedURL ?? webView.url ?? AppConfig.baseURL)
    }

    private func load(_ url: URL) {
        failedURL = nil
        webView.load(URLRequest(url: url))
    }

    /// Back online while the offline screen is up: try again without waiting for a tap.
    private func watchNetwork() {
        pathMonitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor in
                guard let self, self.phase == .offline else { return }
                self.retry()
            }
        }
        pathMonitor.start(queue: DispatchQueue(label: "app.agathon.network"))
    }

    private func handleFailure(_ error: Error, in webView: WKWebView, provisional: Bool) {
        guard webView === self.webView else { return }
        let error = error as NSError
        // A navigation replaced by another one, or turned into a download: not a failure.
        if error.domain == NSURLErrorDomain, error.code == NSURLErrorCancelled { return }
        if error.domain == "WebKitErrorDomain", error.code == 102 { return }

        let offline = error.domain == NSURLErrorDomain && Self.offlineErrorCodes.contains(error.code)
        if provisional || offline {
            failedURL = error.userInfo[NSURLErrorFailingURLErrorKey] as? URL ?? webView.url
            phase = .offline
        }
    }

    // MARK: Presenting

    /// The view controller on top, to present sheets from (a new-window sheet may be up).
    private var presenter: UIViewController? {
        var top = webView.window?.rootViewController
        while let next = top?.presentedViewController, !next.isBeingDismissed { top = next }
        return top
    }

    private func openInBrowser(_ url: URL) {
        guard let presenter else { return openInSystem(url) }
        let safari = SFSafariViewController(url: url)
        safari.dismissButtonStyle = .done
        safari.modalPresentationStyle = .pageSheet
        presenter.present(safari, animated: true)
    }

    private func openInSystem(_ url: URL) {
        UIApplication.shared.open(url)
    }

    private func share(_ items: [Any]) {
        guard let presenter, !items.isEmpty else { return }
        let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
        if let popover = sheet.popoverPresentationController {
            popover.sourceView = presenter.view
            popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 0, height: 0)
            popover.permittedArrowDirections = []
        }
        presenter.present(sheet, animated: true)
    }

    /// A page of ours opened in a new window (`target="_blank"`, `window.open`): show it in a
    /// sheet over the board, sharing the board's session, instead of navigating away from it.
    private func presentWindow(with configuration: WKWebViewConfiguration) -> WKWebView? {
        guard let presenter else { return nil }
        let window = WKWebView(frame: .zero, configuration: configuration)
        window.navigationDelegate = self
        window.uiDelegate = self
        window.allowsLinkPreview = false
        window.underPageBackgroundColor = .white
        #if DEBUG
        window.isInspectable = true
        #endif
        let controller = WindowSheetController(webView: window)
        let navigation = UINavigationController(rootViewController: controller)
        navigation.modalPresentationStyle = .pageSheet
        presenter.present(navigation, animated: true)
        return window
    }

    private func alert(title: String?, message: String?, actions: [UIAlertAction], textField: ((UITextField) -> Void)? = nil) -> Bool {
        guard let presenter else { return false }
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        if let textField { alert.addTextField(configurationHandler: textField) }
        actions.forEach(alert.addAction)
        presenter.present(alert, animated: true)
        return true
    }

    // MARK: Talking to the page

    /// Fires `name` as a DOM event on the page's window, with `detail` (see NativeBridge).
    func dispatch(_ name: String, detail: [String: Any]) {
        webView.callAsyncJavaScript(
            "window.dispatchEvent(new CustomEvent(name, { detail }))",
            arguments: ["name": name, "detail": detail],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }
}

// MARK: - WKNavigationDelegate

extension WebShell: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        if navigationAction.shouldPerformDownload { return decisionHandler(.download) }
        guard let url = navigationAction.request.url else { return decisionHandler(.allow) }
        switch LinkPolicy.destination(for: url) {
        case .app:
            decisionHandler(.allow)
        case .browser:
            // Frames inside a page (Stripe's, an embed) load what they load; only where a whole
            // page goes is the app's to decide.
            if navigationAction.targetFrame?.isMainFrame == false { return decisionHandler(.allow) }
            decisionHandler(.cancel)
            openInBrowser(url)
        case .system:
            decisionHandler(.cancel)
            openInSystem(url)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void) {
        if let response = navigationResponse.response as? HTTPURLResponse,
           let disposition = response.value(forHTTPHeaderField: "Content-Disposition"),
           disposition.lowercased().hasPrefix("attachment") {
            return decisionHandler(.download)
        }
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        guard webView === self.webView, phase == .loading else { return }
        // The page is painting its own loading state by now; don't wait for every image.
        Task {
            try? await Task.sleep(for: .milliseconds(500))
            if phase == .loading { phase = .ready }
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === self.webView else { return }
        phase = .ready
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handleFailure(error, in: webView, provisional: true)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleFailure(error, in: webView, provisional: false)
    }

    /// iPadOS ends a web view's content process under memory pressure (a big board, the app
    /// long in the background). The board autosaves; bring it back.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if webView.url == nil, webView === self.webView {
            load(AppConfig.baseURL)
        } else {
            webView.reload()
        }
    }
}

// MARK: - WKUIDelegate

extension WebShell: WKUIDelegate {
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = navigationAction.request.url, !url.absoluteString.isEmpty else {
            return presentWindow(with: configuration)
        }
        switch LinkPolicy.destination(for: url) {
        case .app:
            return presentWindow(with: configuration)
        case .browser:
            openInBrowser(url)
            return nil
        case .system:
            openInSystem(url)
            return nil
        }
    }

    func webViewDidClose(_ webView: WKWebView) {
        guard webView !== self.webView else { return }
        WindowSheetController.owning(webView)?.dismiss(animated: true)
    }

    /// The site asks for the mic itself (Ask's hold-to-talk, Lecture mode); iPadOS still asks the
    /// kid once, with NSMicrophoneUsageDescription. Granting here skips WebKit's second prompt.
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping @MainActor (WKPermissionDecision) -> Void) {
        let ours = AppConfig.siteHosts.contains(origin.host.lowercased())
        decisionHandler(ours && type == .microphone ? .grant : .prompt)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor () -> Void) {
        let shown = alert(title: nil, message: message, actions: [
            UIAlertAction(title: "OK", style: .default) { _ in completionHandler() },
        ])
        if !shown { completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (Bool) -> Void) {
        let shown = alert(title: nil, message: message, actions: [
            UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) },
            UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) },
        ])
        if !shown { completionHandler(false) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (String?) -> Void) {
        var field: UITextField?
        let shown = alert(title: nil, message: prompt, actions: [
            UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) },
            UIAlertAction(title: "OK", style: .default) { _ in completionHandler(field?.text ?? "") },
        ], textField: { textField in
            textField.text = defaultText
            field = textField
        })
        if !shown { completionHandler(nil) }
    }
}

// MARK: - WKDownloadDelegate

/// A download (a saved replay video, a board picture, an exported file) lands in a temporary
/// folder and opens the share sheet: Save to Files, Save Video, AirDrop, Messages.
extension WebShell: WKDownloadDelegate {
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping @MainActor (URL?) -> Void) {
        let folder = FileManager.default.temporaryDirectory
            .appending(path: "Downloads", directoryHint: .isDirectory)
            .appending(path: UUID().uuidString, directoryHint: .isDirectory)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        } catch {
            return completionHandler(nil)
        }
        let name = suggestedFilename.isEmpty ? "Agathon" : suggestedFilename
        let destination = folder.appending(path: name, directoryHint: .notDirectory)
        downloads[ObjectIdentifier(download)] = destination
        completionHandler(destination)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let file = downloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
        share([file])
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloads.removeValue(forKey: ObjectIdentifier(download))
    }
}

// MARK: - WKScriptMessageHandler

extension WebShell: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              AppConfig.siteHosts.contains(message.frameInfo.securityOrigin.host.lowercased()),
              let body = message.body as? [String: Any],
              let type = body["type"] as? String
        else { return }

        switch NativeBridge.Message(rawValue: type) {
        case .ready:
            if message.webView === webView, phase == .loading { phase = .ready }
        case .openExternal:
            // In Safari itself, not a sheet: what a link to a purchase outside the app must do.
            if let raw = body["url"] as? String, let url = URL(string: raw),
               ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
                openInSystem(url)
            }
        case .share:
            var items: [Any] = []
            if let text = body["text"] as? String, !text.isEmpty { items.append(text) }
            if let raw = body["url"] as? String, let url = URL(string: raw) { items.append(url) }
            share(items)
        case nil:
            break
        }
    }
}

// MARK: - UIPencilInteractionDelegate

/// A double-tap or squeeze on the Pencil goes to the page as `agathon:pencil`, with the action the
/// kid picked in Settings > Apple Pencil (the page decides what to do with it; "ignore" never arrives).
extension WebShell: UIPencilInteractionDelegate {
    @available(iOS 17.5, *)
    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveTap tap: UIPencilInteraction.Tap) {
        sendPencil(gesture: "tap", preferred: UIPencilInteraction.preferredTapAction)
    }

    @available(iOS 17.5, *)
    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveSqueeze squeeze: UIPencilInteraction.Squeeze) {
        guard squeeze.phase == .ended else { return }
        sendPencil(gesture: "squeeze", preferred: UIPencilInteraction.preferredSqueezeAction)
    }

    /// iPadOS 17.0–17.4 (the method above replaces it from 17.5).
    func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
        sendPencil(gesture: "tap", preferred: UIPencilInteraction.preferredTapAction)
    }

    private func sendPencil(gesture: String, preferred: UIPencilPreferredAction) {
        guard preferred != .ignore else { return }
        dispatch(NativeBridge.Event.pencil, detail: [
            "gesture": gesture,
            "preferredAction": NativeBridge.name(of: preferred),
        ])
    }
}
