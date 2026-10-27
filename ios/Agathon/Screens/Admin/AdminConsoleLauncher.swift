import AgathonDesign
import AgathonKit
import SwiftUI

/// Account → Admin console (admins only): opens the console full screen.
struct AdminConsoleLauncher: View {
    @Environment(AgathonBackend.self) private var backend
    @State private var open = false

    var body: some View {
        AreaPage("Admin console", subtitle: "Everything: health, people, money, boards, bug reports, issues and the picture tutor's runs. Admins only.") {
            PillButton("Open the admin console", icon: .chart, kind: .primary) { open = true }
                .fixedSize()
                .accessibilityIdentifier("admin.open")
        }
        .fullScreenCover(isPresented: $open) {
            AdminConsole(data: AdminService(api: backend.api)) { open = false }
        }
    }
}
