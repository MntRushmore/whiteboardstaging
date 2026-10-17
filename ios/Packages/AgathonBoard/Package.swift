// swift-tools-version: 6.0
// AgathonBoard: Agathon's own whiteboard engine (docs/IPAD-NATIVE.md, docs/BOARD-FORMAT.md).
// No third-party dependencies. The model, store, geometry and importer also build for macOS so
// `swift test` runs them on a Mac; the canvas (UIKit) is iOS only.
import PackageDescription

let package = Package(
    name: "AgathonBoard",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "AgathonBoard", targets: ["AgathonBoard"]),
    ],
    targets: [
        .target(
            name: "AgathonBoard",
            path: "Sources/AgathonBoard"
        ),
        .testTarget(
            name: "AgathonBoardTests",
            dependencies: ["AgathonBoard"],
            path: "Tests/AgathonBoardTests",
            resources: [.copy("Fixtures")]
        ),
    ],
    swiftLanguageModes: [.v5]
)
