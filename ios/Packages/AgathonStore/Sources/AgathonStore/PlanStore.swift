import AgathonKit
import Foundation
import Observation
import StoreKit

/// Agathon Unlimited in the App Store, for the screens: the product and its offer, purchase,
/// restore, the transaction listener, and the plan as the server sees it. Made once at launch
/// (`start()`), handed to the screens with `.environment`.
///
/// - **The server decides.** What the UI says comes from `ink_summary().unlimited` (`plan`), which
///   knows a web plan, the family's grown-up's plan and the first-trial rule; StoreKit's entitlement
///   (`hasStoreEntitlement`) is a hint, shown only in the Billing Lab.
/// - **Every transaction goes to the server before it is finished** (`deliver`): a purchase, a
///   renewal or refund from `Transaction.updates`, a restore. One the server could not take is kept
///   unfinished, and StoreKit hands it back at the next launch; `retryUnfinished()` also runs on
///   sign-in.
/// - **The purchase carries the account's checkout reference as `appAccountToken`** (never the user
///   id), from the server's summary; without it there is no purchase.
@MainActor
@Observable
public final class PlanStore {
    public enum ProductState: Sendable, Equatable {
        case idle, loading, loaded
        /// The App Store did not answer, or has no such product (the words say which).
        case unavailable(String)
    }

    public enum Activity: Sendable, Equatable { case purchasing, restoring }

    /// One line of what happened, for the Billing Lab.
    public struct LogLine: Sendable, Identifiable, Equatable {
        public let id = UUID()
        public let at: Date
        public let text: String
    }

    public private(set) var productState: ProductState = .idle
    public private(set) var product: Product?
    public private(set) var offer: PlanOffer?
    /// `ink_summary().unlimited`: the source of truth for the UI. Nil until read.
    public private(set) var plan: UnlimitedPlan?
    public private(set) var planLoaded = false
    public private(set) var planError: String?
    public private(set) var activity: Activity?
    /// The newest transaction of the plan on this Apple ID (for the refund sheet).
    public private(set) var latestTransactionID: UInt64?
    /// StoreKit's own view: this Apple ID has the plan right now. A hint, not the truth.
    public private(set) var hasStoreEntitlement = false
    /// The last thing the server said about a transaction.
    public private(set) var lastRecord: RecordOutcome?
    public private(set) var log: [LogLine] = []

    public var standing: PlanStanding { PlanStanding(plan: plan) }

    let productID: String
    let server: any StoreServer
    let readPlan: @Sendable () async throws -> UnlimitedPlan?
    @ObservationIgnored private var listener: Task<Void, Never>?
    @ObservationIgnored private var statusListener: Task<Void, Never>?

    public init(productID: String = StorePlan.productID, server: any StoreServer,
                readPlan: @escaping @Sendable () async throws -> UnlimitedPlan?) {
        self.productID = productID
        self.server = server
        self.readPlan = readPlan
    }

    /// The app's store: the API for transactions, `ink_summary()` for the plan.
    public convenience init(backend: AgathonBackend) {
        let profiles = backend.profiles
        self.init(server: APIStoreServer(api: backend.api), readPlan: { try await profiles.inkSummary().unlimited })
    }

    // MARK: launch

    /// Starts listening for transactions (renewals, refunds, Ask to Buy approvals, purchases made on
    /// another device, and every unfinished one from before) and for changes of the subscription's
    /// status that bring no new transaction (auto-renew turned off, an expiry, a billing retry), so
    /// the server hears of each at once, not only through Apple's notification. Call once, at launch.
    /// Idempotent.
    public func start() {
        guard listener == nil else { return }
        note("Listening for App Store transactions")
        listener = Task { [weak self] in
            for await result in Transaction.updates {
                guard let self else { return }
                _ = await self.deliver(result, source: "update")
            }
        }
        statusListener = Task { [weak self] in
            for await status in Product.SubscriptionInfo.Status.updates {
                guard let self else { return }
                await self.deliver(status: status)
            }
        }
    }

    /// Hands every unfinished transaction to the server again (after sign-in, or by hand in the Lab).
    public func retryUnfinished() async {
        var count = 0
        for await result in Transaction.unfinished {
            count += 1
            _ = await deliver(result, source: "unfinished")
        }
        if count == 0 { note("No unfinished transactions") }
    }

    // MARK: the product

    /// Loads the product, its price and whether this Apple ID can have the free trial.
    public func loadProduct() async {
        if productState == .loading { return }
        productState = .loading
        do {
            guard let product = try await Product.products(for: [productID]).first else {
                productState = .unavailable("Agathon Unlimited isn't in the App Store yet.")
                note("Product \(productID) not found")
                return
            }
            self.product = product
            offer = await Self.offer(for: product)
            productState = .loaded
            note("Loaded \(product.displayName): \(product.displayPrice), trial \(offer?.trialBadge ?? "none")")
        } catch {
            productState = .unavailable("The App Store isn't answering. Check the connection and try again.")
            note("Products failed: \(error.localizedDescription)")
        }
        await refreshEntitlement()
    }

    static func offer(for product: Product) async -> PlanOffer? {
        guard let subscription = product.subscription else { return nil }
        let trial = subscription.introductoryOffer.flatMap { $0.paymentMode == .freeTrial ? PlanPeriod($0.period) : nil }
        let eligible = await subscription.isEligibleForIntroOffer
        return PlanOffer(displayPrice: product.displayPrice, period: PlanPeriod(subscription.subscriptionPeriod),
                         freeTrial: trial, eligibleForTrial: eligible)
    }

    // MARK: the plan (server)

    /// Reads `ink_summary().unlimited` again.
    public func refreshPlan() async {
        do {
            plan = try await readPlan()
            planLoaded = true
            planError = nil
        } catch {
            planError = "Couldn't check your plan. Try again in a moment."
            note("ink_summary failed: \(error.localizedDescription)")
        }
    }

    /// Forgets the last account's plan (sign-out, a profile switch).
    public func resetForNewAccount() {
        plan = nil
        planLoaded = false
        planError = nil
        lastRecord = nil
    }

    // MARK: purchase

    public enum PurchaseOutcome: Sendable, Equatable {
        /// Bought (or the trial started) and handed to the server.
        case purchased(RecordOutcome)
        case cancelled
        /// Waiting for approval (Ask to Buy) or extra authentication: it arrives through the listener.
        case pending
        /// Couldn't start: the words say why.
        case failed(String)
    }

    /// What `purchase` calls to show Apple's sheet: SwiftUI's `@Environment(\.purchase)`
    /// (`{ try await purchase($0, options: $1) }`), which presents it in the right scene.
    public typealias PurchaseAction = @MainActor (Product, Set<Product.PurchaseOption>) async throws -> Product.PurchaseResult

    /// Buys the plan for the signed-in account: `appAccountToken` is its checkout reference.
    public func purchase(using perform: PurchaseAction) async -> PurchaseOutcome {
        guard activity == nil else { return .failed("Already working on it.") }
        guard let product else { return .failed("The plan hasn't loaded yet.") }
        if !planLoaded { await refreshPlan() }
        guard let token = plan?.checkoutRef else {
            return .failed("Couldn't reach your account. Check the connection and try again.")
        }
        activity = .purchasing
        defer { activity = nil }
        note("Purchase started (appAccountToken = checkout_ref)")
        do {
            let result = try await perform(product, [.appAccountToken(token)])
            switch result {
            case let .success(verification):
                let outcome = await deliver(verification, source: "purchase")
                return .purchased(outcome)
            case .userCancelled:
                note("Purchase cancelled")
                return .cancelled
            case .pending:
                note("Purchase pending (Ask to Buy or authentication)")
                return .pending
            @unknown default:
                return .failed("The App Store answered in a way this version doesn't know.")
            }
        } catch {
            note("Purchase failed: \(error.localizedDescription)")
            return .failed(Self.words(for: error))
        }
    }

    // MARK: restore

    public enum RestoreOutcome: Sendable, Equatable {
        /// The plan on this Apple ID was handed to the server; `unlimited` is the server's answer.
        case restored(unlimited: Bool)
        /// This Apple ID has no current plan.
        case nothing
        /// This Apple ID's plan belongs to another Agathon account.
        case otherAccount
        case cancelled
        case failed(String)
    }

    /// "Restore purchases": syncs with the App Store, then hands this Apple ID's current plan to the server.
    public func restore() async -> RestoreOutcome {
        guard activity == nil else { return .failed("Already working on it.") }
        activity = .restoring
        defer { activity = nil }
        note("Restore: AppStore.sync()")
        do {
            try await AppStore.sync()
        } catch StoreKitError.userCancelled {
            return .cancelled
        } catch {
            note("Restore failed: \(error.localizedDescription)")
            return .failed(Self.words(for: error))
        }
        var outcomes: [RecordOutcome] = []
        for await result in Transaction.currentEntitlements where result.unsafePayloadValue.productID == productID {
            outcomes.append(await deliver(result, source: "restore"))
        }
        await refreshEntitlement()
        if outcomes.isEmpty { return .nothing }
        if outcomes.contains(where: { if case .refused = $0 { return true } else { return false } }) { return .otherAccount }
        if let retry = outcomes.first(where: { !$0.shouldFinish }), case let .retryLater(message) = retry { return .failed(message) }
        return .restored(unlimited: plan?.unlimited == true)
    }

    // MARK: StoreKit's own view

    /// Reads this Apple ID's current entitlement and newest transaction (for the refund sheet).
    public func refreshEntitlement() async {
        var entitled = false
        for await result in Transaction.currentEntitlements where result.unsafePayloadValue.productID == productID {
            if case .verified = result { entitled = true }
        }
        hasStoreEntitlement = entitled
        latestTransactionID = await Transaction.latest(for: productID)?.unsafePayloadValue.id
    }

    // MARK: handing a transaction to the server

    /// Posts the transaction (and its renewal info) to the server, finishes it unless the server could
    /// not be asked, then reads the plan again. Never throws.
    @discardableResult
    func deliver(_ result: VerificationResult<Transaction>, source: String) async -> RecordOutcome {
        let transaction = result.unsafePayloadValue
        guard transaction.productID == productID else {
            await transaction.finish()
            note("[\(source)] finished \(transaction.productID): not this plan")
            return .ignored(reason: "another product")
        }
        if case let .unverified(_, error) = result {
            // The server verifies with Apple's chain itself and will say no; sent so it is logged there.
            note("[\(source)] StoreKit could not verify transaction \(transaction.id): \(error.localizedDescription)")
        }
        let renewal = await transaction.subscriptionStatus?.renewalInfo.jwsRepresentation
        let outcome = await server.record(transaction: result.jwsRepresentation, renewalInfo: renewal)
        lastRecord = outcome
        if outcome.shouldFinish { await transaction.finish() }
        note("[\(source)] transaction \(transaction.id) (original \(transaction.originalID)) -> \(Self.describe(outcome))\(outcome.shouldFinish ? ", finished" : ", kept for later")")
        await refreshPlan()
        await refreshEntitlement()
        return outcome
    }

    /// A status change (no new transaction to finish): the latest transaction and its renewal info.
    func deliver(status: Product.SubscriptionInfo.Status) async {
        let transaction = status.transaction.unsafePayloadValue
        guard transaction.productID == productID else { return }
        let outcome = await server.record(transaction: status.transaction.jwsRepresentation,
                                          renewalInfo: status.renewalInfo.jwsRepresentation)
        lastRecord = outcome
        note("[status \(Self.describe(status.state))] transaction \(transaction.id) -> \(Self.describe(outcome))")
        await refreshPlan()
        await refreshEntitlement()
    }

    // MARK: words

    static func describe(_ state: Product.SubscriptionInfo.RenewalState) -> String {
        switch state {
        case .subscribed: return "subscribed"
        case .expired: return "expired"
        case .inBillingRetryPeriod: return "billing retry"
        case .inGracePeriod: return "grace period"
        case .revoked: return "revoked"
        default: return "\(state)"
        }
    }

    static func describe(_ outcome: RecordOutcome) -> String {
        switch outcome {
        case let .recorded(status, unlimited, applied): return "recorded \(status ?? "?")\(unlimited ? " (unlimited)" : "")\(applied ? "" : " (older; newer state kept)")"
        case let .ignored(reason): return "ignored: \(reason)"
        case let .refused(reason): return "refused: \(reason)"
        case let .rejected(reason): return "rejected: \(reason ?? "not verified")"
        case let .retryLater(message): return "not recorded yet: \(message)"
        }
    }

    /// A StoreKit failure in a grown-up's words.
    static func words(for error: Error) -> String {
        if let error = error as? Product.PurchaseError {
            switch error {
            case .purchaseNotAllowed: return "Purchases are turned off on this iPad (Screen Time). A grown-up can turn them on in Settings."
            case .productUnavailable: return "Agathon Unlimited isn't available in this country's App Store yet."
            default: break
            }
        }
        if let error = error as? StoreKitError {
            switch error {
            case .networkError: return "The App Store isn't reachable. Check the connection and try again."
            case .notAvailableInStorefront: return "Agathon Unlimited isn't available in this country's App Store yet."
            case .notEntitled: return "This Apple Account can't make purchases right now."
            default: break
            }
        }
        return "The App Store couldn't finish that. Try again in a moment."
    }

    func note(_ text: String) {
        log.append(LogLine(at: Date(), text: text))
        if log.count > 200 { log.removeFirst(log.count - 200) }
    }
}

#if DEBUG
extension PlanStore {
    /// Previews, screenshots and the Billing Lab: a plan and an offer as if the App Store and the
    /// server had answered. Debug builds only.
    public func setPreviewState(offer: PlanOffer?, plan: UnlimitedPlan?, productState: ProductState = .loaded) {
        self.offer = offer
        self.plan = plan
        planLoaded = true
        planError = nil
        self.productState = productState
    }
}
#endif

extension PlanPeriod {
    init(_ period: Product.SubscriptionPeriod) {
        let unit: Unit
        switch period.unit {
        case .day: unit = .day
        case .week: unit = .week
        case .month: unit = .month
        case .year: unit = .year
        @unknown default: unit = .month
        }
        self.init(value: period.value, unit: unit)
    }
}
