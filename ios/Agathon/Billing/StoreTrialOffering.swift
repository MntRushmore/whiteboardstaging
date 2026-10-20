import AgathonOnboarding
import AgathonStore
import StoreKit
import SwiftUI

/// The onboarding's `trial` step on AgathonStore: the App Store's product and free week
/// (`PlanStore.offer`), the purchase with the account's checkout reference as `appAccountToken`
/// (`PlanStore.purchase`: the signed transaction goes to the server before it is finished), Restore,
/// and whether the account already has the plan (the server's `ink_summary`, never StoreKit alone).
///
/// `purchase` is SwiftUI's `@Environment(\.purchase)` from the screen that makes this (RootView), so
/// Apple's sheet shows in the right scene.
@MainActor
final class StoreTrialOffering: TrialOffering {
    let store: PlanStore
    let purchase: PurchaseAction

    init(store: PlanStore, purchase: PurchaseAction) {
        self.store = store
        self.purchase = purchase
    }

    enum Failure: Error, LocalizedError {
        case unavailable(String)
        case failed(String)

        var errorDescription: String? {
            switch self {
            case .unavailable(let words), .failed(let words): return words
            }
        }
    }

    func offer() async throws -> TrialOffer {
        // the launch's own load may still be asking the App Store: wait for its answer (up to 15 s)
        // rather than call that "isn't answering"
        for _ in 0 ..< 60 where store.productState == .loading {
            try? await Task.sleep(for: .milliseconds(250))
        }
        if store.productState != .loaded { await store.loadProduct() }
        switch store.productState {
        case .loaded:
            guard let offer = store.offer else { throw TrialNotOnSale() }
            return TrialOffer(displayPrice: offer.displayPrice, trialDays: offer.trial?.days)
        case .unavailable(let words):
            // no product in the App Store (yet): not a failure to reach it, and "Not now" goes on
            if words == PlanStore.notOnSale { throw TrialNotOnSale() }
            throw Failure.unavailable(words)
        case .idle, .loading:
            throw Failure.unavailable("The App Store isn't answering. Check the connection and try again.")
        }
    }

    /// `checkoutRef` is the onboarding's read of `profiles.checkout_ref`; the store reads the same from
    /// the server's summary (and refuses to buy without it), so the plan is read again first.
    func start(checkoutRef: UUID?) async throws -> TrialOutcome {
        await store.refreshPlan()
        if store.product == nil { await store.loadProduct() }
        let purchase = self.purchase
        let outcome = await store.purchase { product, options in try await purchase(product, options: options) }
        switch outcome {
        case .purchased(let record):
            switch record {
            case .recorded, .ignored: return .started
            // bought: the server hears of it by itself in a moment (the listener retries)
            case .retryLater: return .pending
            case .refused: throw Failure.failed("This Apple Account's plan belongs to another Agathon account.")
            case .rejected: throw Failure.failed("The purchase couldn't be checked. Try Restore in a moment.")
            }
        case .cancelled: return .cancelled
        case .pending: return .pending
        case .failed(let words): throw Failure.failed(words)
        }
    }

    func restore() async throws -> Bool {
        switch await store.restore() {
        case .restored(let unlimited): return unlimited
        case .nothing, .cancelled: return false
        case .otherAccount: throw Failure.failed("This Apple Account's plan belongs to another Agathon account.")
        case .failed(let words): throw Failure.failed(words)
        }
    }

    func hasPlan() async -> Bool {
        await store.refreshPlan()
        return store.plan?.unlimited == true
    }
}
