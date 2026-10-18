import Foundation

/// The App Store Connect record the app sells: one auto-renewing monthly subscription in one group,
/// with a 7-day free trial as Apple's introductory offer. Must match `APPLE_PLAN` in
/// src/lib/billing/apple.ts and ios/Agathon/Agathon.storekit (StorePlanTests checks the file).
public enum StorePlan {
    /// The auto-renewable subscription's product id.
    public static let productID = "app.agathon.unlimited.monthly"
    /// The subscription group's reference name.
    public static let subscriptionGroup = "Agathon Unlimited"
    /// What the plan is called everywhere.
    public static let name = "Agathon Unlimited"
    /// The server route the app hands each transaction to.
    public static let transactionPath = "/api/billing/apple/transaction"
}
