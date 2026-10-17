import SwiftUI

/// Over the web view until the first page starts drawing. Picks up from the launch screen (plain
/// white) with the mark, and shows a spinner only if the wait gets long.
struct SplashView: View {
    @State private var slow = false

    var body: some View {
        ZStack {
            Color.white.ignoresSafeArea()
            VStack(spacing: 28) {
                Image("Logo")
                    .renderingMode(.template)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 112, height: 112)
                    .foregroundStyle(Color.ink)
                    .accessibilityLabel("Agathon")
                ProgressView()
                    .opacity(slow ? 1 : 0)
            }
        }
        .task {
            try? await Task.sleep(for: .seconds(2))
            withAnimation(.easeIn(duration: 0.3)) { slow = true }
        }
    }
}

extension Color {
    /// The site's ink: text and the mark.
    static let ink = Color(red: 0.07, green: 0.07, blue: 0.07)
}

#Preview {
    SplashView()
}
