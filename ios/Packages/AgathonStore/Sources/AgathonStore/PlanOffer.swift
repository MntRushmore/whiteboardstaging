import Foundation

/// A subscription period as StoreKit gives it (`Product.SubscriptionPeriod`), without StoreKit, so
/// the words can be tested.
public struct PlanPeriod: Sendable, Equatable {
    public enum Unit: Sendable, Equatable { case day, week, month, year }
    public let value: Int
    public let unit: Unit

    public init(value: Int, unit: Unit) {
        self.value = max(1, value)
        self.unit = unit
    }

    /// "a month", "a week", "every 3 months": how often the price is charged.
    public var every: String {
        if value == 1 {
            switch unit {
            case .day: return "a day"
            case .week: return "a week"
            case .month: return "a month"
            case .year: return "a year"
            }
        }
        return "every \(value) \(plural)"
    }

    /// "7 days", "1 month", "2 weeks": how long a free trial lasts. Weeks are said in days ("7 days"),
    /// as the web's plan screen says it.
    public var length: String {
        switch unit {
        case .day: return value == 1 ? "1 day" : "\(value) days"
        case .week: return "\(value * 7) days"
        case .month: return value == 1 ? "1 month" : "\(value) months"
        case .year: return value == 1 ? "1 year" : "\(value) years"
        }
    }

    /// The period in days, when it is a whole number of days (a week is 7).
    public var days: Int? {
        switch unit {
        case .day: return value
        case .week: return value * 7
        case .month, .year: return nil
        }
    }

    /// "monthly", "weekly", "yearly".
    public var adjective: String {
        switch (unit, value) {
        case (.month, 1): return "monthly"
        case (.year, 1): return "yearly"
        case (.week, 1): return "weekly"
        case (.day, 1): return "daily"
        default: return "every \(value) \(plural)"
        }
    }

    private var plural: String {
        switch unit {
        case .day: return "days"
        case .week: return "weeks"
        case .month: return "months"
        case .year: return "years"
        }
    }
}

/// What the plan screen offers, from the App Store's product: the price as the App Store shows it in
/// the buyer's storefront (`Product.displayPrice`, never a hard-coded "$25"), how often it renews, and
/// the free trial when this Apple ID can still have it (`isEligibleForIntroOffer`). Pure: the words a
/// grown-up reads before subscribing, including the auto-renewal disclosure Apple requires
/// (App Review Guideline 3.1.2, the Paid Apps Agreement's Schedule 2).
public struct PlanOffer: Sendable, Equatable {
    public let displayPrice: String
    public let period: PlanPeriod
    /// The introductory free trial, when the product has one.
    public let freeTrial: PlanPeriod?
    /// StoreKit's answer for this Apple ID: the intro offer is once per Apple ID per subscription group.
    public let eligibleForTrial: Bool

    public init(displayPrice: String, period: PlanPeriod, freeTrial: PlanPeriod?, eligibleForTrial: Bool) {
        self.displayPrice = displayPrice
        self.period = period
        self.freeTrial = freeTrial
        self.eligibleForTrial = eligibleForTrial
    }

    /// The trial this person will get, if any.
    public var trial: PlanPeriod? { eligibleForTrial ? freeTrial : nil }

    /// "$24.99 a month": the billed amount, the most prominent price on the screen.
    public var pricePerPeriod: String { "\(displayPrice) \(period.every)" }

    /// "7 days free", or nil without a trial.
    public var trialBadge: String? { trial.map { "\($0.length) free" } }

    /// The button: "Start your free week", "Start your free trial", or "Subscribe".
    public var ctaTitle: String {
        guard let trial else { return "Subscribe" }
        return trial.days == 7 ? "Start your free week" : "Start your free trial"
    }

    /// Under the button, the money in one line: "7 days free, then $24.99 a month." or "$24.99 a month."
    public var ctaDetail: String {
        if let trial { return "\(trial.length) free, then \(pricePerPeriod). Cancel any time." }
        return "\(pricePerPeriod). Cancel any time."
    }

    /// The auto-renewal disclosure, under the button and before the links to the Terms and the
    /// Privacy Policy: the title, the length and the price, that it renews until cancelled, when the
    /// charge happens, the 24-hour rule and where to cancel.
    public var disclosure: String {
        let plan = "\(StorePlan.name) is a \(period.adjective) subscription."
        let money: String
        if let trial {
            money = "It's free for \(trial.length); then \(displayPrice) is charged to your Apple Account \(period.every), starting when the free trial ends."
        } else {
            money = "\(displayPrice) is charged to your Apple Account when you confirm, then \(period.every)."
        }
        let renews = "It renews automatically until you cancel. Cancel at least 24 hours before the end of the "
            + (trial == nil ? "current period" : "free trial or the current period")
            + " and you won't be charged again; Apple charges the renewal in the 24 hours before."
        let manage = "Manage or cancel any time in Settings › your name › Subscriptions."
        return [plan, money, renews, manage].joined(separator: " ")
    }
}
