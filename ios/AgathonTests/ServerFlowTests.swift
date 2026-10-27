import AgathonKit
import AgathonStore
import CryptoKit
import Foundation
import Testing
@testable import Agathon

/// The app's half of Agathon Unlimited through Apple, end to end WITHOUT StoreKit's local test
/// environment: AgathonStore's server client posts StoreKit-shaped transactions (environment Xcode,
/// as Agathon.storekit signs them) to the local dev server (APPLE_ENVIRONMENT=Xcode), and the plan
/// is read back through ink_summary, as the app does. It covers what the StoreKit run covers past
/// StoreKit itself: the free week recorded, ink_summary unlimited and billed by Apple, another
/// account's purchase refused, a kid covered (and a kid's session forwarding the family's purchase),
/// auto-renew off, an expiry, a resubscribe, a refund, and deleting the account with an Apple plan.
///
/// Why without StoreKit: `xcodebuild` (unlike Xcode's Run) does not sync a StoreKit configuration
/// to the simulator, so SKTestSession answers SKInternalErrorDomain 3 from the command line. The
/// StoreKit half is Billing Lab in Xcode (docs/RUNBOOK-billing.md section 16).
///
/// LOCAL STACK ONLY, skipped unless AGATHON_INTEGRATION=1 (the variables are in StoreKitFlowTests).
@MainActor
@Suite(.serialized, .enabled(if: storeKitFlowEnabled, "set TEST_RUNNER_AGATHON_INTEGRATION=1 and point the app at the local stack"))
struct ServerFlowTests {
    @Test func everyStateReachesTheServerAndTheFamily() async throws {
        let environment = AgathonEnvironment.current
        try #require(["127.0.0.1", "localhost"].contains(environment.apiBaseURL.host ?? ""), "the API must be the local dev server, never production")
        try #require(["127.0.0.1", "localhost"].contains(environment.supabaseURL.host ?? ""), "Supabase must be the local stack")
        let stamp = Int(Date().timeIntervalSince1970)

        // The grown-up, and another family.
        let grownUp = AgathonBackend(environment: environment, release: AppRelease(version: "test", build: "billing"), authStorage: InMemoryAuthStorage())
        let email = "ios-billing-server-\(stamp)@example.com"
        #expect(try await grownUp.auth.signUp(email: email, password: "password123") == .signedIn)
        let grownUpId = try #require(grownUp.auth.userId)
        let other = AgathonBackend(environment: environment, release: AppRelease(version: "test", build: "billing"), authStorage: InMemoryAuthStorage())
        #expect(try await other.auth.signUp(email: "ios-billing-other-\(stamp)@example.com", password: "password123") == .signedIn)

        let ref = try #require(try await grownUp.profiles.inkSummary().unlimited?.checkoutRef)
        let server = APIStoreServer(api: grownUp.api)
        let jws = FakeStoreKit(originalID: "9\(stamp)", token: ref)
        let now = Date()

        // The free week, as StoreKit hands it over after the purchase.
        #expect(await server.record(transaction: jws.transaction(signed: now, expires: now.addingTimeInterval(7 * 86_400), trial: true),
                                    renewalInfo: jws.renewal(signed: now, autoRenew: true))
            == .recorded(status: "trialing", unlimited: true, applied: true))
        var plan = try #require(try await grownUp.profiles.inkSummary().unlimited)
        #expect(plan.status == "trialing" && plan.unlimited == true && plan.provider == "apple")
        #expect(PlanStanding(plan: plan) == .subscribed(provider: "apple", trialEnds: plan.trialEnd, renews: plan.currentPeriodEnd, cancelAtPeriodEnd: false))

        // Another account posting it (its token is the grown-up's): refused, nothing changes.
        #expect(await APIStoreServer(api: other.api).record(transaction: jws.transaction(signed: now.addingTimeInterval(1), expires: now.addingTimeInterval(7 * 86_400), trial: true), renewalInfo: nil)
            == .refused(reason: RecordOutcome.accountMismatch))
        #expect(try await other.profiles.inkSummary().unlimited?.unlimited == false)

        // A kid in the family is covered; the kid's session may forward the family's purchase.
        try await grownUp.family.setPin("2468")
        let kid: FamilyMember = try await grownUp.api.post("/api/family/kids", body: StoreKitFlowTests.AddKid(displayName: "Maya", grade: 3, avatar: "fox"))
        try await grownUp.family.switchProfile(to: kid.userId)
        let kidPlan = try #require(try await grownUp.profiles.inkSummary().unlimited)
        #expect(kidPlan.unlimited == true && kidPlan.provider == "apple", "the kid is covered by the grown-up's Apple plan")
        #expect(await APIStoreServer(api: grownUp.api).record(transaction: jws.transaction(signed: now.addingTimeInterval(2), expires: now.addingTimeInterval(7 * 86_400), trial: true), renewalInfo: nil)
            == .recorded(status: "trialing", unlimited: true, applied: true))
        try await grownUp.family.switchProfile(to: grownUpId, pin: "2468")

        // Auto-renew off: set to cancel, still Unlimited.
        _ = await server.record(transaction: jws.transaction(signed: now.addingTimeInterval(60), expires: now.addingTimeInterval(7 * 86_400), trial: true),
                                renewalInfo: jws.renewal(signed: now.addingTimeInterval(60), autoRenew: false))
        plan = try #require(try await grownUp.profiles.inkSummary().unlimited)
        #expect(plan.cancelAtPeriodEnd == true && plan.unlimited == true)
        #expect(DeletionAdvice(plan: plan) == .clear)

        // An older payload arriving late changes nothing.
        #expect(await server.record(transaction: jws.transaction(signed: now.addingTimeInterval(30), expires: now.addingTimeInterval(7 * 86_400), trial: true), renewalInfo: nil)
            == .recorded(status: "trialing", unlimited: true, applied: false))

        // It expires: help is off.
        #expect(await server.record(transaction: jws.transaction(signed: now.addingTimeInterval(120), expires: now.addingTimeInterval(-60), trial: true),
                                    renewalInfo: jws.renewal(signed: now.addingTimeInterval(120), autoRenew: false))
            == .recorded(status: "canceled", unlimited: false, applied: true))
        #expect(PlanStanding(plan: try await grownUp.profiles.inkSummary().unlimited) == .ended)

        // Subscribing again (same subscription, no second free week): Unlimited again.
        #expect(await server.record(transaction: jws.transaction(signed: now.addingTimeInterval(180), expires: now.addingTimeInterval(30 * 86_400), trial: false, id: "9\(stamp)2"),
                                    renewalInfo: jws.renewal(signed: now.addingTimeInterval(180), autoRenew: true))
            == .recorded(status: "active", unlimited: true, applied: true))
        plan = try #require(try await grownUp.profiles.inkSummary().unlimited)
        #expect(DeletionAdvice(plan: plan) == .cancelAppleFirst)

        // A refund: help is off at once.
        #expect(await server.record(transaction: jws.transaction(signed: now.addingTimeInterval(240), expires: now.addingTimeInterval(30 * 86_400), trial: false, id: "9\(stamp)2", revoked: now.addingTimeInterval(230)), renewalInfo: nil)
            == .recorded(status: "canceled", unlimited: false, applied: true))

        // Active again, then the account is deleted: an Apple plan never blocks it.
        _ = await server.record(transaction: jws.transaction(signed: now.addingTimeInterval(300), expires: now.addingTimeInterval(30 * 86_400), trial: false, id: "9\(stamp)3"), renewalInfo: nil)
        #expect(DeletionAdvice(plan: try await grownUp.profiles.inkSummary().unlimited) == .cancelAppleFirst)
        try await grownUp.supabase.rpc("delete_own_account").execute()
        await #expect(throws: (any Error).self) { try await grownUp.auth.signIn(email: email, password: "password123") }
    }
}

/// StoreKit-shaped JWS for the Xcode environment (what Agathon.storekit's purchases look like). The
/// dev server only decodes these: Xcode's payloads are not Apple-signed, which is why production
/// refuses the Xcode setting.
struct FakeStoreKit {
    let originalID: String
    let token: UUID
    let key = P256.Signing.PrivateKey()

    func transaction(signed: Date, expires: Date, trial: Bool, id: String? = nil, revoked: Date? = nil) -> String {
        var body: [String: Any] = [
            "originalTransactionId": originalID, "transactionId": id ?? originalID, "bundleId": "app.agathon.ios",
            "productId": StorePlan.productID, "purchaseDate": ms(signed), "originalPurchaseDate": ms(signed), "expiresDate": ms(expires),
            "quantity": 1, "type": "Auto-Renewable Subscription", "appAccountToken": token.uuidString.lowercased(),
            "inAppOwnershipType": "PURCHASED", "signedDate": ms(signed), "environment": "Xcode", "storefront": "USA",
            "transactionReason": trial ? "PURCHASE" : "RENEWAL", "currency": "USD", "price": trial ? 0 : 24990,
        ]
        if trial {
            body["offerType"] = 1
            body["offerDiscountType"] = "FREE_TRIAL"
        }
        if let revoked {
            body["revocationDate"] = ms(revoked)
            body["revocationReason"] = 0
        }
        return sign(body)
    }

    func renewal(signed: Date, autoRenew: Bool) -> String {
        sign(["originalTransactionId": originalID, "autoRenewProductId": StorePlan.productID, "productId": StorePlan.productID,
              "autoRenewStatus": autoRenew ? 1 : 0, "signedDate": ms(signed), "environment": "Xcode",
              "renewalPrice": 24990, "currency": "USD"])
    }

    private func ms(_ date: Date) -> Int { Int(date.timeIntervalSince1970 * 1000) }

    private func sign(_ body: [String: Any]) -> String {
        let header = b64(try! JSONSerialization.data(withJSONObject: ["alg": "ES256", "kid": "Apple_Xcode_Key"]))
        let payload = b64(try! JSONSerialization.data(withJSONObject: body))
        let signature = try! key.signature(for: Data("\(header).\(payload)".utf8)).rawRepresentation
        return "\(header).\(payload).\(b64(signature))"
    }

    private func b64(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
