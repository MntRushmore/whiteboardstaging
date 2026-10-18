import Foundation
import Network

/// Whether the iPad is online, and a word when that changes (the web's `navigator.onLine` and its
/// `online` / `offline` events).
@MainActor
public protocol LiveConnectivity: AnyObject {
    var isOnline: Bool { get }
    /// Called on the main actor whenever `isOnline` changes.
    var onChange: ((Bool) -> Void)? { get set }
}

/// NWPathMonitor: online when the path is satisfied.
@MainActor
public final class NetworkConnectivity: LiveConnectivity {
    public private(set) var isOnline = true
    public var onChange: ((Bool) -> Void)?
    private let monitor = NWPathMonitor()

    public init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor [weak self] in
                guard let self, self.isOnline != online else { return }
                self.isOnline = online
                self.onChange?(online)
            }
        }
        monitor.start(queue: DispatchQueue(label: "app.agathon.live.network"))
    }

    deinit { monitor.cancel() }
}

/// Always online (previews, the Lab's offline switch flips it by hand).
@MainActor
public final class ManualConnectivity: LiveConnectivity {
    public var isOnline: Bool {
        didSet { if oldValue != isOnline { onChange?(isOnline) } }
    }
    public var onChange: ((Bool) -> Void)?

    public init(online: Bool = true) {
        isOnline = online
    }
}
