import SwiftUI

/// When the site can't be reached. Comes down by itself when the network comes back (WebShell).
struct OfflineView: View {
    let onRetry: () -> Void

    var body: some View {
        ZStack {
            Color.white.ignoresSafeArea()
            VStack(spacing: 14) {
                Image(systemName: "wifi.slash")
                    .font(.system(size: 44))
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 6)
                Text("Agathon can't connect")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(Color.ink)
                Text("Check the Wi-Fi, then try again. Agathon needs the internet to read your writing and help.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 420)
                Button(action: onRetry) {
                    Text("Try again")
                        .font(.headline)
                        .padding(.horizontal, 12)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .padding(.top, 10)
            }
            .padding(32)
        }
    }
}

#Preview {
    OfflineView(onRetry: {})
}
