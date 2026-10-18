import AgathonDesign
import AgathonKit
import AgathonStore
import Foundation
import StoreKit
import StoreKitTest
import SwiftUI
import Testing
import UIKit
@testable import Agathon

/// Agathon Unlimited bought through StoreKit, end to end, inside the app: StoreKit's local test
/// environment (Agathon.storekit, through SKTestSession: no App Store, no dialogs), the real
/// AgathonStore code, the real server route (POST /api/billing/apple/transaction on a dev server with
/// APPLE_ENVIRONMENT=Xcode) and the local Supabase stack. A fresh grown-up starts the free week; the
/// server records it and ink_summary says unlimited; a kid added to the family is covered; auto-renew
/// off, an expiry, a resubscribe and a refund each reach the server; deleting the account with an
/// Apple plan works.
///
/// Run it from XCODE (Product > Test, with the scheme's StoreKit configuration): `xcodebuild` does not
/// sync a StoreKit configuration to the simulator, and SKTestSession then answers
/// SKInternalErrorDomain 3 (checked with Xcode 26.6). ServerFlowTests covers the same server half
/// from the command line. LOCAL STACK ONLY, and skipped unless AGATHON_STOREKIT=1 and
/// AGATHON_INTEGRATION=1 (in Xcode: the test action's environment variables):
///
///     APPLE_ENVIRONMENT=Xcode npx next dev -p 3401        # with the local stack's .env.local
///     TEST_RUNNER_AGATHON_INTEGRATION=1 \
///     TEST_RUNNER_AGATHON_API_URL=http://127.0.0.1:3401 \
///     TEST_RUNNER_SUPABASE_URL=http://127.0.0.1:54321 \
///     TEST_RUNNER_SUPABASE_ANON_KEY=<ANON_KEY from `npx supabase status -o env`> \
///     xcodebuild test -project ios/Agathon.xcodeproj -scheme Agathon \
///       -destination 'platform=iOS Simulator,name=iPad Air 11-inch (M4)' -only-testing:AgathonTests/StoreKitFlowTests
/// The live flows run only when asked for (TEST_RUNNER_AGATHON_INTEGRATION=1).
let storeKitFlowEnabled = ProcessInfo.processInfo.environment["AGATHON_INTEGRATION"] == "1"
/// The StoreKit run needs Xcode's StoreKit testing (see StoreKitFlowTests).
let storeKitTestingEnabled = storeKitFlowEnabled && ProcessInfo.processInfo.environment["AGATHON_STOREKIT"] == "1"

@MainActor
@Suite(.serialized, .enabled(if: storeKitTestingEnabled, "run from Xcode with AGATHON_STOREKIT=1 and AGATHON_INTEGRATION=1, pointed at the local stack"))
struct StoreKitFlowTests {

    static let storekit = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("../Agathon/Agathon.storekit").standardized

    @Test func aGrownUpStartsTheFreeWeekAndEveryChangeReachesTheServer() async throws {
        let environment = AgathonEnvironment.current
        let host = environment.apiBaseURL.host ?? ""
        try #require(["127.0.0.1", "localhost"].contains(host), "the API must be the local dev server, never production (\(host))")
        try #require(["127.0.0.1", "localhost"].contains(environment.supabaseURL.host ?? ""), "Supabase must be the local stack")

        let session = try SKTestSession(contentsOf: Self.storekit)
        session.resetToDefaultState()
        session.disableDialogs = true
        session.askToBuyEnabled = false
        session.clearTransactions()

        // A fresh grown-up on the local stack.
        let backend = AgathonBackend(environment: environment, release: AppRelease(version: "test", build: "billing"), authStorage: InMemoryAuthStorage())
        let email = "ios-billing-\(Int(Date().timeIntervalSince1970))@example.com"
        #expect(try await backend.auth.signUp(email: email, password: "password123") == .signedIn)
        let grownUpId = try #require(backend.auth.userId)

        let store = PlanStore(backend: backend)
        store.start()
        await store.refreshPlan()
        #expect(store.standing == .none)
        let checkoutRef = try #require(store.plan?.checkoutRef, "ink_summary carries the checkout reference")

        // The App Store's product, price and free week.
        await store.loadProduct()
        let offer = try #require(store.offer, "no offer: \(store.productState); \(store.log.map(\.text).joined(separator: " | "))")
        #expect(offer.displayPrice == "$24.99")
        #expect(offer.trialBadge == "7 days free")
        #expect(offer.ctaTitle == "Start your free week")


        // Start the free week: the purchase carries the checkout reference and the server records it.
        let outcome = await store.purchase { product, options in try await product.purchase(options: options) }
        #expect(outcome == .purchased(.recorded(status: "trialing", unlimited: true, applied: true)))
        let latest = try #require(await Transaction.latest(for: StorePlan.productID)?.unsafePayloadValue)
        #expect(latest.appAccountToken == checkoutRef)
        var plan = try await backend.profiles.inkSummary().unlimited
        #expect(plan?.status == "trialing")
        #expect(plan?.unlimited == true)
        #expect(plan?.provider == "apple")
        #expect(DeletionAdvice(plan: plan) == .cancelAppleFirst)

        // A kid added to the family is covered by the grown-up's Apple plan.
        try await backend.family.setPin("2468")
        let kid: FamilyMember = try await backend.api.post("/api/family/kids", body: AddKid(displayName: "Maya", grade: 3, avatar: "fox"))
        try await backend.family.switchProfile(to: kid.userId)
        #expect(backend.auth.userId == kid.userId)
        let kidPlan = try await backend.profiles.inkSummary().unlimited
        #expect(kidPlan?.unlimited == true, "the kid's ink_summary says unlimited")
        #expect(kidPlan?.provider == "apple")
        try await backend.family.switchProfile(to: grownUpId, pin: "2468")
        #expect(backend.auth.userId == grownUpId)

        // Auto-renew off in the App Store: set to cancel, still unlimited until the week ends.
        try session.disableAutoRenewForTransaction(identifier: UInt(latest.id))
        #expect(await eventually { await store.refreshPlan(); return store.plan?.cancelAtPeriodEnd == true }, "auto-renew off reached the server")
        #expect(store.plan?.unlimited == true)
        try session.enableAutoRenewForTransaction(identifier: UInt(latest.id))
        #expect(await eventually { await store.refreshPlan(); return store.plan?.cancelAtPeriodEnd == false }, "auto-renew on reached the server")

        // The subscription expires: help is off.
        try session.expireSubscription(productIdentifier: StorePlan.productID)
        #expect(await eventually { await store.refreshPlan(); return store.plan?.status == "canceled" }, "the expiry reached the server")
        #expect(store.plan?.unlimited == false)

        // Subscribe again (no second free week on this Apple ID), then a refund.
        await store.loadProduct()
        #expect(store.offer?.trialBadge == nil, "the intro offer is once per Apple ID")
        let again = await store.purchase { product, options in try await product.purchase(options: options) }
        #expect(again == .purchased(.recorded(status: "active", unlimited: true, applied: true)))
        let renewed = try #require(await Transaction.latest(for: StorePlan.productID)?.unsafePayloadValue)
        try session.refundTransaction(identifier: UInt(renewed.id))
        #expect(await eventually { await store.refreshPlan(); return store.plan?.status == "canceled" && store.plan?.unlimited == false }, "the refund reached the server")

        // An Apple plan that would charge again never blocks deleting the account.
        let third = await store.purchase { product, options in try await product.purchase(options: options) }
        #expect(third == .purchased(.recorded(status: "active", unlimited: true, applied: true)))
        plan = try await backend.profiles.inkSummary().unlimited
        #expect(DeletionAdvice(plan: plan) == .cancelAppleFirst)
        try await backend.supabase.rpc("delete_own_account").execute()
        await #expect(throws: (any Error).self) { try await backend.auth.signIn(email: email, password: "password123") }

        session.clearTransactions()
    }

    struct AddKid: Encodable {
        let displayName: String
        let grade: Int
        let avatar: String
    }

    /// Polls until `condition` holds (StoreKit's updates and the server are a moment behind).
    func eventually(timeout: TimeInterval = 30, _ condition: () async -> Bool) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if await condition() { return true }
            try? await Task.sleep(for: .milliseconds(500))
        }
        return false
    }
}
