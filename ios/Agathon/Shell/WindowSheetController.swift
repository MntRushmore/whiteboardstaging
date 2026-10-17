import UIKit
import WebKit

/// A page the site opened in a new window, shown in a sheet with Done (WebShell.presentWindow).
final class WindowSheetController: UIViewController {
    private let webView: WKWebView
    private var titleObservation: NSKeyValueObservation?

    init(webView: WKWebView) {
        self.webView = webView
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func loadView() {
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        navigationItem.rightBarButtonItem = UIBarButtonItem(systemItem: .done, primaryAction: UIAction { [weak self] _ in
            self?.dismiss(animated: true)
        })
        titleObservation = webView.observe(\.title, options: [.initial, .new]) { [weak self] webView, _ in
            MainActor.assumeIsolated { self?.title = webView.title }
        }
    }

    /// The sheet showing `webView`, found up its responder chain (for `window.close()`).
    static func owning(_ webView: WKWebView) -> UIViewController? {
        var responder: UIResponder? = webView
        while let next = responder?.next {
            if let controller = next as? WindowSheetController {
                return controller.navigationController ?? controller
            }
            responder = next
        }
        return nil
    }
}
