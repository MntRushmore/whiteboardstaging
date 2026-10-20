import AgathonDesign
import AgathonKit
import AgathonLive
import SwiftUI

/// Account → Training Center: shown to admins only (`is_admin()`). Opens the Training Center full
/// screen (its boards need the whole iPad).
struct TrainingCenterPage: View {
    @Environment(AgathonBackend.self) private var backend
    @State private var open = false

    var body: some View {
        AreaPage("Training Center", subtitle: "For admins: brute-test the tutor with real maths, with your own Pencil or a bench of synthetic hands.") {
            AreaCard("What's in it") {
                VStack(alignment: .leading, spacing: DS.Space.s) {
                    Text("My Pencil: write problems and work in any handwriting, then 👍 or 👎 each line the tutor answers.")
                    Text("Auto bench: \(TrainingCatalogue.all.count) cases of how kids write, in synthetic hands, judged against what a teacher wants.")
                    Text("Training calls spend no ink when the server has the training pass (\(TrainingSync.target(backend))).")
                        .foregroundStyle(DS.Color.inkSecondary)
                }
                .dsFont(.body)
                .foregroundStyle(DS.Color.ink)
                .fixedSize(horizontal: false, vertical: true)
                PillButton("Open the Training Center", icon: .play, kind: .primary) { open = true }
                    .fixedSize()
                    .accessibilityIdentifier("area.training.open")
            }
        }
        .fullScreenCover(isPresented: $open) {
            TrainingCenterView { open = false }
                .environment(backend)
        }
    }
}
