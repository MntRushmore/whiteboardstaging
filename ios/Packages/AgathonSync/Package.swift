// swift-tools-version: 6.0
// AgathonSync: saving boards (docs/IPAD-NATIVE.md, Phase 1). Opens a board by id (its Agathon
// document, or the web's tldraw board converted once in memory), autosaves it with the web's
// guarantees (version-checked writes, record merge on conflict, retries, a device backup, waiting
// for the pen to lift), writes the thumbnail, and keeps the board's pictures in Supabase Storage.
// The model, the queue and the merge also build for macOS so `swift test` runs them on a Mac.
import PackageDescription

let package = Package(
    name: "AgathonSync",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "AgathonSync", targets: ["AgathonSync"]),
    ],
    dependencies: [
        .package(path: "../AgathonBoard"),
        .package(path: "../AgathonKit"),
    ],
    targets: [
        .target(
            name: "AgathonSync",
            dependencies: ["AgathonBoard", "AgathonKit"],
            path: "Sources/AgathonSync"
        ),
        .testTarget(
            name: "AgathonSyncTests",
            dependencies: ["AgathonSync"],
            path: "Tests/AgathonSyncTests"
        ),
    ],
    swiftLanguageModes: [.v5]
)
