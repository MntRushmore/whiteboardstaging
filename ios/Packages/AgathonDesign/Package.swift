// swift-tools-version: 6.0
// AgathonDesign: the iPad app's design system in the Blocks brand (docs/DESIGN-SYSTEM.md).
// Tokens, the bundled fonts (Bricolage Grotesque, Lexend, Kalam; SIL OFL 1.1), components, the
// mark and the shapes. No third-party dependencies.
import PackageDescription

let package = Package(
    name: "AgathonDesign",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "AgathonDesign", targets: ["AgathonDesign"]),
    ],
    targets: [
        .target(
            name: "AgathonDesign",
            path: "Sources/AgathonDesign",
            resources: [.copy("Resources/Fonts")]
        ),
        .testTarget(
            name: "AgathonDesignTests",
            dependencies: ["AgathonDesign"],
            path: "Tests/AgathonDesignTests"
        ),
    ],
    swiftLanguageModes: [.v5]
)
