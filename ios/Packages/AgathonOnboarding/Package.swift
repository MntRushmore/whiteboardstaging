// swift-tools-version: 6.0
// AgathonOnboarding: the iPad app's first run (docs/ONBOARDING.md). Who is holding the iPad, the
// kid's name and grade, one real problem the tutor ticks before any account, the plan, then the
// grown-up's part: the gate, the account, Apple's trial, the PIN and the kid's profile.
//
// Seams for what other lanes own: `TryItChecking` (the tutor's read and verdict), `TrialOffering`
// (StoreKit) and `ParentalGate`. The package depends only on merged packages; AgathonLive and
// AgathonStore are swapped in by the app.
import PackageDescription

let package = Package(
    name: "AgathonOnboarding",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "AgathonOnboarding", targets: ["AgathonOnboarding"]),
    ],
    dependencies: [
        .package(path: "../AgathonDesign"),
        .package(path: "../AgathonKit"),
        .package(path: "../AgathonBoard"),
        .package(path: "../AgathonBrain"),
    ],
    targets: [
        .target(
            name: "AgathonOnboarding",
            dependencies: ["AgathonDesign", "AgathonKit", "AgathonBoard", "AgathonBrain"],
            path: "Sources/AgathonOnboarding",
            resources: [.copy("Resources/onboarding-catalog.json")]
        ),
        .testTarget(
            name: "AgathonOnboardingTests",
            dependencies: ["AgathonOnboarding"],
            path: "Tests/AgathonOnboardingTests"
        ),
    ],
    swiftLanguageModes: [.v5]
)
