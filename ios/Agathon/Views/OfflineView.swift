import AgathonDesign
import SwiftUI

/// When Agathon can't reach the internet. Comes down by itself when the network comes back.
struct OfflineView: View {
    let onRetry: () -> Void

    var body: some View {
        ZStack {
            DS.Color.ground.ignoresSafeArea()
            EmptyState(
                .icon(.offline, .sunny),
                title: "Agathon can't connect",
                message: "Check the Wi-Fi, then try again. Agathon needs the internet to read your writing and help.",
                actionTitle: "Try again",
                actionIcon: .retry,
                action: onRetry
            )
        }
    }
}

#Preview {
    OfflineView(onRetry: {})
}
