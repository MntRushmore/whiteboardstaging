// swift-tools-version: 5.9
// SwiftMath 1.7.3 (github.com/mgriebling/SwiftMath, MIT, commit fa8244e), vendored for the board's
// typeset maths (AgathonBoardUI's `SwiftMathTypesetter`). Changes from upstream, all small:
//  - only the Latin Modern Math font ships (the other eleven fonts are never requested);
//  - `AgathonEntry.swift` adds one public entry point: LaTeX → a display list, drawn by the board's
//    tile renderer in vector on any thread (upstream only offers a UIView or a bitmap);
//  - the font-registration `debugPrint`s are gone.
// Licences: LICENSE (SwiftMath, MIT), Sources/SwiftMath/mathFonts.bundle/LICENSE (iosMath, MIT) and
// GUST-FONT-LICENSE.txt (Latin Modern Math, GUST Font License).
import PackageDescription

let package = Package(
    name: "SwiftMath",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "SwiftMath", targets: ["SwiftMath"]),
    ],
    targets: [
        .target(
            name: "SwiftMath",
            resources: [.copy("mathFonts.bundle")]
        ),
    ],
    swiftLanguageVersions: [.v5]
)
