import SafariServices
import SwiftUI

/// A web page in an in-app Safari sheet (the Terms, the Privacy Policy): the person stays in the
/// app and whatever they typed stays where it was.
struct SafariSheet: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let configuration = SFSafariViewController.Configuration()
        configuration.entersReaderIfAvailable = false
        let controller = SFSafariViewController(url: url, configuration: configuration)
        controller.dismissButtonStyle = .done
        controller.preferredControlTintColor = UIColor(red: 0x14 / 255, green: 0x15 / 255, blue: 0x1F / 255, alpha: 1)
        return controller
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}

/// A URL that can drive `.sheet(item:)`.
struct WebPage: Identifiable, Hashable {
    let url: URL
    var id: String { url.absoluteString }
}
