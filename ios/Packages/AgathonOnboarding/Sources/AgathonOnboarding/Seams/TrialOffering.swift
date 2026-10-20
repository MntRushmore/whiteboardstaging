import Foundation

/// Apple's offer as the trial screen shows it. Every number comes from StoreKit; none is typed into
/// the screen.
public struct TrialOffer: Sendable, Equatable {
    /// "$9.99", the product's `displayPrice`
    public var displayPrice: String
    /// the introductory offer's free days (7); nil when this Apple ID can't have one
    public var trialDays: Int?

    public init(displayPrice: String, trialDays: Int?) {
        self.displayPrice = displayPrice
        self.trialDays = trialDays
    }

    /// `isEligibleForIntroOffer`
    public var hasTrial: Bool { (trialDays ?? 0) > 0 }
}

/// The App Store has no plan to sell yet (no product in App Store Connect, as production before the
/// subscription exists): not a failure to reach it. The trial screen says so and "Not now" carries on.
public struct TrialNotOnSale: Error, Sendable, Equatable, LocalizedError {
    public init() {}
    public var errorDescription: String? { "Agathon Unlimited isn't in the App Store yet." }
}

/// What came of the tap on Start (StoreKit 2's purchase result, after the server has the signed
/// transaction and it is finished).
public enum TrialOutcome: Sendable, Equatable {
    /// the plan is on: the trial started (or the subscription, without an offer)
    case started
    /// Ask to Buy: waiting for the Apple ID's owner. The kid gets the free board meanwhile.
    case pending
    /// the grown-up closed Apple's sheet: stay on the screen
    case cancelled
}

/// The seam for Apple's trial (docs/ONBOARDING.md, `trial`). The BILLING lane's `AgathonStore`
/// implements it; until it is merged, `StubTrialOffering` stands in. The lead swaps it in
/// RootView: `OnboardingFlow(trial: StoreTrialOffering(store), onFinish:)`.
public protocol TrialOffering: Sendable {
    /// The product and whether this Apple ID gets the free trial. Throws when the App Store can't be
    /// reached ("Couldn't reach the App Store. Try again.").
    func offer() async throws -> TrialOffer
    /// Buys the plan with the grown-up's `checkoutRef` (`profiles.checkout_ref`) as the
    /// `appAccountToken`, sends the signed transaction to the server, then finishes it.
    func start(checkoutRef: UUID?) async throws -> TrialOutcome
    /// "Restore purchase": true when a plan was found and is on.
    func restore() async throws -> Bool
    /// The plan is on for the signed-in grown-up (a Stripe or Apple subscriber): the screen is skipped.
    func hasPlan() async -> Bool
}

/// A stand-in for StoreKit until the BILLING lane's `AgathonStore` is merged: the offer is fixed,
/// Start answers `.started` without charging anyone (nothing is written on the server), Restore
/// finds nothing. Debug and Labs only — the app must swap it before release.
public struct StubTrialOffering: TrialOffering {
    public var outcome: TrialOutcome
    public var price: String
    public var days: Int?

    public init(outcome: TrialOutcome = .started, price: String = "$9.99", days: Int? = 7) {
        self.outcome = outcome
        self.price = price
        self.days = days
    }

    public func offer() async throws -> TrialOffer {
        try await Task.sleep(for: .milliseconds(150))
        return TrialOffer(displayPrice: price, trialDays: days)
    }

    public func start(checkoutRef: UUID?) async throws -> TrialOutcome {
        try await Task.sleep(for: .milliseconds(700))
        return outcome
    }

    public func restore() async throws -> Bool {
        try await Task.sleep(for: .milliseconds(400))
        return false
    }

    public func hasPlan() async -> Bool { false }
}
