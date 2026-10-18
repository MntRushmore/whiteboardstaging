// swift-tools-version: 6.0
// AgathonLive: the tutor on the board (docs/IPAD-NATIVE.md, Phase 2). The Live loop in Swift — it
// watches the board, reads each line (the API's recognizer), judges it with the brain (the web's
// maths engine in JavaScriptCore), and ticks, rings, hints or writes in the tutor's hand — and the
// SwiftUI pieces a board screen shows for it (Help me, the status pill, hint cards, celebrations,
// Now you try, the grown-ups' dial). iPad only: AgathonDesign is.
import PackageDescription

let package = Package(
    name: "AgathonLive",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "AgathonLive", targets: ["AgathonLive"]),
    ],
    dependencies: [
        .package(path: "../AgathonBoard"),
        .package(path: "../AgathonBrain"),
        .package(path: "../AgathonKit"),
        .package(path: "../AgathonDesign"),
    ],
    targets: [
        .target(
            name: "AgathonLive",
            dependencies: ["AgathonBoard", "AgathonBrain", "AgathonKit", "AgathonDesign"],
            path: "Sources/AgathonLive"
        ),
        .testTarget(
            name: "AgathonLiveTests",
            dependencies: ["AgathonLive", "AgathonBoard", "AgathonBrain", "AgathonKit"],
            path: "Tests/AgathonLiveTests",
            resources: [.copy("Fixtures")]
        ),
    ],
    swiftLanguageModes: [.v5]
)
