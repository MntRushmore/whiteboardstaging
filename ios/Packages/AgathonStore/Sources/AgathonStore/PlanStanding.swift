import AgathonKit
import Foundation

/// Where the family stands with Agathon Unlimited, as the plan screen and the out-of-ink panel say it,
/// from the SERVER's summary (`ink_summary().unlimited`), never from StoreKit alone: the server knows
/// a plan bought on the web, a kid's grown-up's plan, a refund Apple told it about, and the
/// one-free-trial-per-account rule. Pure.
public enum PlanStanding: Sendable, Equatable {
    /// No plan: offer it.
    case none
    /// A plan that ended (cancelled, expired, refunded): offer it again (Apple decides the trial).
    case ended
    /// Help is on. `provider` "apple" is managed in Settings; "stripe" on agathon.app.
    case subscribed(provider: String?, trialEnds: Date?, renews: Date?, cancelAtPeriodEnd: Bool)
    /// A second plan's free trial: help uses ink until the first payment (has_unlimited's first-plan rule).
    case repeatTrial(provider: String?, startsOn: Date?)
    /// A payment is failing (Apple's billing retry, or the web's past_due): help uses ink meanwhile.
    case paymentProblem(provider: String?)
    /// The purchase is recorded but its state has not arrived yet.
    case pending

    public init(plan: UnlimitedPlan?) {
        guard let plan else { self = .none; return }
        switch plan.status {
        case "trialing" where plan.repeatTrial == true:
            self = .repeatTrial(provider: plan.provider, startsOn: plan.trialEnd)
        case "trialing", "active":
            if plan.unlimited == false {
                self = .paymentProblem(provider: plan.provider)
            } else {
                self = .subscribed(provider: plan.provider, trialEnds: plan.status == "trialing" ? plan.trialEnd : nil,
                                   renews: plan.currentPeriodEnd, cancelAtPeriodEnd: plan.cancelAtPeriodEnd == true)
            }
        case "past_due", "unpaid", "paused":
            self = .paymentProblem(provider: plan.provider)
        case "canceled", "incomplete_expired":
            self = .ended
        case "incomplete", nil:
            self = .pending
        default:
            self = .none
        }
    }

    /// The plan screen offers a purchase.
    public var offersPurchase: Bool {
        switch self {
        case .none, .ended: return true
        default: return false
        }
    }

    /// Billed by Apple (managed in Settings, refunds through Apple).
    public var isApple: Bool {
        switch self {
        case let .subscribed(provider, _, _, _), let .repeatTrial(provider, _), let .paymentProblem(provider):
            return provider == "apple"
        default:
            return false
        }
    }
}

/// What deleting the account means for the plan (delete_own_account in
/// supabase/migrations/20261017200000_apple_subscriptions.sql).
public enum DeletionAdvice: Sendable, Equatable {
    /// Nothing will charge again.
    case clear
    /// An Apple plan will charge again: deleting is allowed (we cannot cancel it), but tell the
    /// grown-up to cancel it in Settings first, or Apple keeps charging.
    case cancelAppleFirst
    /// A web (Stripe) plan will charge again: the server refuses until it is cancelled on agathon.app.
    case cancelOnWebFirst

    public init(plan: UnlimitedPlan?) {
        guard let plan, plan.cancelAtPeriodEnd != true,
              let status = plan.status, ["trialing", "active", "past_due", "unpaid"].contains(status) else {
            self = .clear
            return
        }
        self = plan.provider == "apple" ? .cancelAppleFirst : .cancelOnWebFirst
    }

    /// What the account screen says before the Delete button (nil when nothing needs saying).
    public var message: String? {
        switch self {
        case .clear:
            return nil
        case .cancelAppleFirst:
            return "Your plan is billed through Apple, and deleting your account doesn't cancel it. Cancel it first in Settings › your name › Subscriptions, or Apple keeps charging."
        case .cancelOnWebFirst:
            return "Cancel your plan on agathon.app first: deleting your account doesn't cancel it, so you'd still be charged."
        }
    }
}
