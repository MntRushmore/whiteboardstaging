// swift-tools-version: 6.0
// The board's TypeScript logic (src/lib/brain), bundled into Resources/brain.js by
// `npm run brain:build` and run in JavaScriptCore. docs/IPAD-NATIVE.md, "The brain".
import PackageDescription

let package = Package(
    name: "AgathonBrain",
    // macOS only so `swift test` runs on a Mac too; the app is iPad-only.
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "AgathonBrain", targets: ["AgathonBrain"]),
    ],
    targets: [
        .target(
            name: "AgathonBrain",
            resources: [.copy("Resources/brain.js")]
        ),
        .testTarget(
            name: "AgathonBrainTests",
            dependencies: ["AgathonBrain"],
            resources: [.copy("Resources/golden.ndjson")]
        ),
    ],
    swiftLanguageModes: [.v5]
)
