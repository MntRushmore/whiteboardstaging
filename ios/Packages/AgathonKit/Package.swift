// swift-tools-version: 6.0
// AgathonKit: the iPad app's backend layer (docs/IPAD-NATIVE.md, "AgathonKit"). Supabase auth and
// family profiles, the API client for the Next.js routes, SSE, models and repositories, telemetry.
import PackageDescription

let package = Package(
    name: "AgathonKit",
    platforms: [
        .iOS(.v17),
        // macOS only so `swift test` runs on a Mac without a simulator; the app is iPad only.
        .macOS(.v14),
    ],
    products: [
        .library(name: "AgathonKit", targets: ["AgathonKit"]),
    ],
    dependencies: [
        .package(url: "https://github.com/supabase/supabase-swift.git", from: "2.0.0"),
    ],
    targets: [
        .target(
            name: "AgathonKit",
            dependencies: [
                .product(name: "Supabase", package: "supabase-swift"),
            ]
        ),
        .testTarget(
            name: "AgathonKitTests",
            dependencies: ["AgathonKit"]
        ),
    ],
    swiftLanguageModes: [.v5]
)
