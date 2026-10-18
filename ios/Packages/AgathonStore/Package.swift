// swift-tools-version: 6.0
// AgathonStore: Agathon Unlimited through Apple in-app purchase (StoreKit 2), docs/IPAD-NATIVE.md
// "Money". The product, the intro offer's eligibility, purchase with the account's checkout
// reference as appAccountToken, the Transaction.updates listener that hands every verified
// transaction to the server before finishing it, restore, the parental gate's logic and the plan's
// words. The server (`ink_summary`) is the source of truth for what the UI says; StoreKit's own
// entitlement is a hint. Depends on AgathonKit for the API and the plan summary. Builds for macOS
// too, so `swift test` runs the pure parts on a Mac.
import PackageDescription

let package = Package(
    name: "AgathonStore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "AgathonStore", targets: ["AgathonStore"]),
    ],
    dependencies: [
        .package(path: "../AgathonKit"),
    ],
    targets: [
        .target(
            name: "AgathonStore",
            dependencies: [.product(name: "AgathonKit", package: "AgathonKit")]
        ),
        .testTarget(
            name: "AgathonStoreTests",
            dependencies: ["AgathonStore"]
        ),
    ],
    swiftLanguageModes: [.v5]
)
