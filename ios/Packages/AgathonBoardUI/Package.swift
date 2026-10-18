// swift-tools-version: 6.0
// AgathonBoardUI: the board editor in Blocks — the canvas, the kid dock, the top bar, pages,
// pictures and PDF pages, and typeset maths (docs/IPAD-NATIVE.md, Phase 1). Built on AgathonBoard
// (the engine) and AgathonDesign (the brand). Its one third-party piece is the vendored SwiftMath.
import PackageDescription

let package = Package(
    name: "AgathonBoardUI",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "AgathonBoardUI", targets: ["AgathonBoardUI"]),
    ],
    dependencies: [
        .package(path: "../AgathonBoard"),
        .package(path: "../AgathonDesign"),
        .package(path: "../SwiftMath"),
    ],
    targets: [
        .target(
            name: "AgathonBoardUI",
            dependencies: ["AgathonBoard", "AgathonDesign", "SwiftMath"],
            path: "Sources/AgathonBoardUI"
        ),
        .testTarget(
            name: "AgathonBoardUITests",
            dependencies: ["AgathonBoardUI"],
            path: "Tests/AgathonBoardUITests",
            resources: [.copy("Fixtures")]
        ),
    ],
    swiftLanguageModes: [.v5]
)
