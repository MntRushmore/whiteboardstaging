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
/// Apple plan works. Screenshots of the billing screens go to docs/qa-screenshots/ipad-billing-*.png.
///
/// LOCAL STACK ONLY, and skipped unless AGATHON_INTEGRATION=1:
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

@MainActor
@Suite(.serialized, .enabled(if: storeKitFlowEnabled, "set TEST_RUNNER_AGATHON_INTEGRATION=1 and point the app at the local stack"))
struct StoreKitFlowTests {

    static let storekit = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("../Agathon/Agathon.storekit").standardized
    static let shots = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("../../docs/qa-screenshots").standardized

    @Test func aGrownUpStartsTheFreeWeekAndEveryChangeReachesTheServer() async throws {
        let environment = AgathonEnvironment.current
        let host = environment.apiBaseURL.host ?? ""
        try #require(["127.0.0.1", "localhost"].contains(host), "the API must be the local dev server, never production (\(host))")
        try #require(["127.0.0.1", "localhost"].contains(environment.supabaseURL.host ?? ""), "Supabase must be the local stack")

        let session = try SKTestSession(configurationFileNamed: "Agathon")
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

        let shooter = Shooter(store: store, backend: backend, dir: Self.shots)
        try await shooter.shoot("gate", landscape: true) { ParentalGateView(onPass: {}, onClose: {}) }
        try await shooter.shoot("plan-offer", landscape: true) { PlanScreen(onClose: {}) }
        try await shooter.shoot("plan-offer-portrait", landscape: false) { PlanScreen(onClose: {}) }
        try await shooter.shoot("out-of-ink-kid", landscape: true) { OutOfInkView(audience: .kid, onClose: {}) }
        try await shooter.shoot("out-of-ink-grownup", landscape: true) { OutOfInkView(audience: .grownUp, onClose: {}) }

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
        try await shooter.shoot("plan-subscribed", landscape: true) { PlanScreen(onClose: {}) }

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
        try await shooter.shoot("plan-ended", landscape: true) { PlanScreen(onClose: {}) }

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

/// Puts a billing screen in a window of the app's own scene and writes what it draws as a PNG.
@MainActor
struct Shooter {
    let store: PlanStore
    let backend: AgathonBackend
    let dir: URL

    func shoot<V: View>(_ name: String, landscape: Bool, settle: Double = 2.0, @ViewBuilder _ view: () -> V) async throws {
        let scene = try #require(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        if scene.interfaceOrientation.isLandscape != landscape {
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: landscape ? .landscapeRight : .portrait)) { _ in }
            try await Task.sleep(for: .seconds(1.5))
        }
        let window = UIWindow(windowScene: scene)
        window.rootViewController = UIHostingController(rootView: view().environment(store).environment(backend))
        window.makeKeyAndVisible()
        try await Task.sleep(for: .seconds(settle))
        let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
            _ = window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try #require(image.pngData()).write(to: dir.appendingPathComponent("ipad-billing-\(name).png"))
        window.isHidden = true
    }
}
