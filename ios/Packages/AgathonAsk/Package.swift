// swift-tools-version: 6.0
// AgathonAsk: Ask on the iPad (docs/IPAD-NATIVE.md, Phase 3; docs/ASK-V2.md). The chat panel in
// Blocks (docked beside the board held sideways, a sheet held upright), a thread per screen, replies
// streamed from /api/live/ask with typeset maths, a picture of the screen for the tutor to see, the
// tutor's board actions written in its hand (planned by the web's own desk in the brain), hold-to-talk
// and read aloud. iPad only: AgathonDesign and AgathonBoardUI are.
import PackageDescription

let package = Package(
    name: "AgathonAsk",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "AgathonAsk", targets: ["AgathonAsk"]),
    ],
    dependencies: [
        .package(path: "../AgathonKit"),
        .package(path: "../AgathonBrain"),
        .package(path: "../AgathonBoard"),
        .package(path: "../AgathonBoardUI"),
        .package(path: "../AgathonLive"),
        .package(path: "../AgathonDesign"),
    ],
    targets: [
        .target(
            name: "AgathonAsk",
            dependencies: ["AgathonKit", "AgathonBrain", "AgathonBoard", "AgathonBoardUI", "AgathonLive", "AgathonDesign"],
            path: "Sources/AgathonAsk"
        ),
        .testTarget(
            name: "AgathonAskTests",
            dependencies: ["AgathonAsk", "AgathonKit", "AgathonBrain", "AgathonBoard", "AgathonLive"],
            path: "Tests/AgathonAskTests"
        ),
    ],
    swiftLanguageModes: [.v5]
)
