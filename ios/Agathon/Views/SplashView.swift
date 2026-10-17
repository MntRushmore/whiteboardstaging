import AgathonDesign
import SwiftUI

/// While the app gets ready. Picks up from the launch screen (plain paper white) with the mark,
/// which assembles the way it does in Blocks: the ring snaps in, the bar slides up, the dot drops
/// in, then the name. Shows a spinner only if the wait gets long. Under Reduce Motion it's all
/// simply there.
struct SplashView: View {
    @State private var slow = false

    var body: some View {
        ZStack {
            DS.Color.paper.ignoresSafeArea()
            VStack(spacing: 40) {
                AgathonLogo(size: 64, assembles: true)
                ProgressView()
                    .tint(DS.Color.inkSecondary)
                    .controlSize(.large)
                    .opacity(slow ? 1 : 0)
                    .accessibilityHidden(!slow)
            }
        }
        .task {
            try? await Task.sleep(for: .seconds(2))
            withAnimation(DS.Motion.fade) { slow = true }
        }
    }
}

extension Color {
    /// Blocks ink, for screens written before AgathonDesign. New code uses `DS.Color.ink`.
    static let ink = DS.Color.ink
}

#Preview {
    SplashView()
}
