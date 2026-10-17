import SwiftUI
import WebKit

struct RootView: View {
    @StateObject private var shell = WebShell()

    var body: some View {
        ZStack {
            // The status bar and home-indicator strips, the same paper as the site.
            Color.white.ignoresSafeArea()

            WebViewHost(webView: shell.webView)

            if shell.phase == .loading {
                SplashView()
                    .transition(.opacity)
            }
            if shell.phase == .offline {
                OfflineView(onRetry: shell.retry)
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.25), value: shell.phase)
        .task { shell.start() }
    }
}

/// The shell's web view, laid out inside the safe area.
struct WebViewHost: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView { webView }

    func updateUIView(_ webView: WKWebView, context: Context) {}
}

#Preview {
    RootView()
}
