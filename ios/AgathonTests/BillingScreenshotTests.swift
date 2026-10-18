import AgathonDesign
import AgathonKit
import AgathonStore
import Foundation
import SwiftUI
import Testing
import UIKit
@testable import Agathon

/// The billing screens as a grown-up and a kid see them, drawn in the app's own window and saved as
/// docs/qa-screenshots/ipad-billing-*.png: the parental gate, the plan (the free week; no trial; big
/// text; portrait), the plan's states (Apple trial, a failing Apple payment, a web plan) and out of
/// ink for a kid and a grown-up. The App Store's and the server's answers are set with
/// PlanStore.setPreviewState (the price is Agathon.storekit's), so no network is needed. Skipped
/// unless AGATHON_SHOTS=1 (TEST_RUNNER_AGATHON_SHOTS=1).
@MainActor
@Suite(.serialized, .enabled(if: ProcessInfo.processInfo.environment["AGATHON_SHOTS"] == "1", "set TEST_RUNNER_AGATHON_SHOTS=1 to write the billing screenshots"))
struct BillingScreenshotTests {
    static let shots = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("../../docs/qa-screenshots").standardized

    @Test func theBillingScreens() async throws {
        let backend = AgathonBackend(environment: .current, release: AppRelease(version: "test", build: "shots"), authStorage: InMemoryAuthStorage())
        let store = PlanStore(backend: backend)
        let shooter = Shooter(store: store, backend: backend, dir: Self.shots)
        let monthly = PlanPeriod(value: 1, unit: .month)
        let week = PlanPeriod(value: 1, unit: .week)
        let offer = PlanOffer(displayPrice: "$24.99", period: monthly, freeTrial: week, eligibleForTrial: true)
        let day: TimeInterval = 86_400
        let trialEnd = Date().addingTimeInterval(7 * day)

        store.setPreviewState(offer: offer, plan: UnlimitedPlan(status: "none", unlimited: false, checkoutRef: UUID()))
        try await shooter.shoot("gate", landscape: true) { ParentalGateView(onPass: {}, onClose: {}) }
        try await shooter.shoot("plan-offer", landscape: true) { PlanScreen(onClose: {}, loadsOnAppear: false) }
        try await shooter.shoot("plan-offer-portrait", landscape: false) { PlanScreen(onClose: {}, loadsOnAppear: false) }
        try await shooter.shoot("plan-offer-large-text", landscape: true) {
            PlanScreen(onClose: {}, loadsOnAppear: false).environment(\.dynamicTypeSize, .accessibility1)
        }

        store.setPreviewState(offer: PlanOffer(displayPrice: "$24.99", period: monthly, freeTrial: week, eligibleForTrial: false),
                              plan: UnlimitedPlan(status: "canceled", unlimited: false, provider: "apple"))
        try await shooter.shoot("plan-offer-no-trial", landscape: true) { PlanScreen(onClose: {}, loadsOnAppear: false) }

        store.setPreviewState(offer: offer, plan: UnlimitedPlan(status: "trialing", unlimited: true, trialEnd: trialEnd, currentPeriodEnd: trialEnd,
                                                                  cancelAtPeriodEnd: false, provider: "apple"))
        try await shooter.shoot("plan-subscribed", landscape: true) { PlanScreen(onClose: {}, loadsOnAppear: false) }

        store.setPreviewState(offer: offer, plan: UnlimitedPlan(status: "past_due", unlimited: false, provider: "apple"))
        try await shooter.shoot("plan-payment-problem", landscape: true) { PlanScreen(onClose: {}, loadsOnAppear: false) }

        store.setPreviewState(offer: offer, plan: UnlimitedPlan(status: "active", unlimited: true, currentPeriodEnd: Date().addingTimeInterval(20 * day), provider: "stripe"))
        try await shooter.shoot("plan-web", landscape: true) { PlanScreen(onClose: {}, loadsOnAppear: false) }

        try await shooter.shoot("out-of-ink-kid", landscape: true) { OutOfInkView(audience: .kid, onClose: {}) }
        try await shooter.shoot("out-of-ink-grownup", landscape: true) { OutOfInkView(audience: .grownUp, onClose: {}) }
    }
}

/// Puts a billing screen in the app's own window at an iPad Air 11-inch's size (landscape 1180 x 820,
/// or portrait), and writes what it draws as a PNG at the screen's scale.
@MainActor
struct Shooter {
    let store: PlanStore
    let backend: AgathonBackend
    let dir: URL

    func shoot<V: View>(_ name: String, landscape: Bool, settle: Double = 2.0, @ViewBuilder _ view: () -> V) async throws {
        let scene = try #require(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let size = landscape ? CGSize(width: 1180, height: 820) : CGSize(width: 820, height: 1180)
        let window = UIWindow(windowScene: scene)
        let root = UIViewController()
        window.rootViewController = root
        window.makeKeyAndVisible()
        let host = UIHostingController(rootView: view().environment(store).environment(backend))
        root.addChild(host)
        host.view.frame = CGRect(origin: .zero, size: size)
        root.view.addSubview(host.view)
        host.didMove(toParent: root)
        try await Task.sleep(for: .seconds(settle))
        let image = UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in
            _ = host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try #require(image.pngData()).write(to: dir.appendingPathComponent("ipad-billing-\(name).png"))
        window.isHidden = true
    }
}
