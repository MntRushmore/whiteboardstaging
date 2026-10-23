// swift-tools-version: 6.0
// AgathonSAT: SAT math practice on the iPad (docs/SAT-MODE.md). Two targets:
//  - AgathonSATCore: the contract's models (src/lib/sat/contracts.ts on the web), the client for
//    /api/sat/*, the grid-in rules, the session's answer flow and the free tutor's gate. Foundation
//    and AgathonKit only, so `swift test` runs it on a Mac.
//  - AgathonSAT: the screens in grown-up Blocks (the question panel, its figures drawn natively, the
//    solution, the set's summary, SAT home). iPad only: AgathonDesign is, so it is linked on iOS only
//    and the views compile there only. Maths is typeset through AgathonBoard's `MathRendering`, which
//    the app fills with the board's SwiftMath typesetter (AgathonBoardUI's `BoardEditorSetup`).
import PackageDescription

let package = Package(
    name: "AgathonSAT",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "AgathonSAT", targets: ["AgathonSAT", "AgathonSATCore"]),
    ],
    dependencies: [
        .package(path: "../AgathonKit"),
        .package(path: "../AgathonDesign"),
        .package(path: "../AgathonBoard"),
    ],
    targets: [
        .target(
            name: "AgathonSATCore",
            dependencies: [.product(name: "AgathonKit", package: "AgathonKit")],
            path: "Sources/AgathonSATCore",
            resources: [.copy("Resources/sat-fixtures.json"), .copy("Resources/sat-sample-20.json")]
        ),
        .target(
            name: "AgathonSAT",
            dependencies: [
                "AgathonSATCore",
                .product(name: "AgathonDesign", package: "AgathonDesign", condition: .when(platforms: [.iOS])),
                .product(name: "AgathonBoard", package: "AgathonBoard", condition: .when(platforms: [.iOS])),
            ],
            path: "Sources/AgathonSAT"
        ),
        .testTarget(
            name: "AgathonSATCoreTests",
            dependencies: ["AgathonSATCore", .product(name: "AgathonKit", package: "AgathonKit")],
            path: "Tests/AgathonSATCoreTests",
            // the bank lane's hand-checked sample (docs/sat/sample-20.json on feat/sat-bank), as the server sends it
            resources: [.copy("Resources/bank-sample-20.json")]
        ),
        .testTarget(
            name: "AgathonSATTests",
            dependencies: ["AgathonSAT", "AgathonSATCore"],
            path: "Tests/AgathonSATTests"
        ),
    ],
    swiftLanguageModes: [.v5]
)
