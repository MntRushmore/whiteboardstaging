import Foundation

/// The student's ink: `rpc("ink_summary")` (src/lib/billing/inkSummary.ts). PostgREST writes
/// `numeric` as strings and `integer` as numbers, so every count takes either.
public struct InkSummary: Sendable, Equatable, Decodable {
    /// Ink left.
    public let balance: Double
    /// All ink ever granted, net of refunds.
    public let granted: Double
    public let purchased: Double
    public let refunded: Double
    public let used: Double
    public let starter: Double
    /// How many packs were bought.
    public let purchases: Double
    /// Agathon Unlimited, when the database has it (a kid's is their grown-up's plan).
    public let unlimited: UnlimitedPlan?

    /// Under this the meter warns (LOW_INK).
    public static let low: Double = 100

    public enum Tone: Sendable, Equatable { case ok, low, empty }

    public var tone: Tone {
        if balance <= 0 { return .empty }
        if balance < Self.low { return .low }
        return .ok
    }

    /// True when the plan covers AI help (the server's `unlimited` flag, or an active / trialing
    /// status when it sends no flag).
    public var hasUnlimited: Bool {
        guard let plan = unlimited else { return false }
        if let flag = plan.unlimited { return flag }
        return plan.status == "active" || plan.status == "trialing"
    }

    enum CodingKeys: String, CodingKey {
        case balance, granted, purchased, refunded, used, starter, purchases, unlimited
    }

    /// For previews and tests.
    public init(balance: Double, unlimited: UnlimitedPlan? = nil) {
        self.balance = balance
        granted = balance
        purchased = 0
        refunded = 0
        used = 0
        starter = 0
        purchases = 0
        self.unlimited = unlimited
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        balance = try c.decode(FlexibleNumber.self, forKey: .balance).value
        granted = try c.decodeIfPresent(FlexibleNumber.self, forKey: .granted)?.value ?? 0
        purchased = try c.decodeIfPresent(FlexibleNumber.self, forKey: .purchased)?.value ?? 0
        refunded = try c.decodeIfPresent(FlexibleNumber.self, forKey: .refunded)?.value ?? 0
        used = try c.decodeIfPresent(FlexibleNumber.self, forKey: .used)?.value ?? 0
        starter = try c.decodeIfPresent(FlexibleNumber.self, forKey: .starter)?.value ?? 0
        purchases = try c.decodeIfPresent(FlexibleNumber.self, forKey: .purchases)?.value ?? 0
        unlimited = try? c.decodeIfPresent(UnlimitedPlan.self, forKey: .unlimited)
    }

    /// `ink_summary()` comes back as one object or, defensively, a one-row array. Nil when it is
    /// neither.
    public static func parse(_ data: Data) -> InkSummary? {
        let decoder = JSONDecoder()
        if let one = try? decoder.decode(InkSummary.self, from: data) { return one }
        return (try? decoder.decode([InkSummary].self, from: data))?.first
    }
}

/// `ink_summary().unlimited` (supabase/migrations/20261003020000_unlimited.sql).
public struct UnlimitedPlan: Sendable, Equatable, Decodable {
    /// Stripe's status: trialing, active, past_due, canceled… (nil: none yet).
    public let status: String?
    /// The server's word on whether the plan covers help right now.
    public let unlimited: Bool?
    public let trialEnd: Date?
    public let currentPeriodEnd: Date?
    public let cancelAtPeriodEnd: Bool?
    /// The caller's own checkout reference (`profiles.checkout_ref`, readable only by them): what an
    /// Apple purchase carries as `appAccountToken`, never the user id (20261003040000_go_live_gaps.sql).
    public let checkoutRef: UUID?
    /// Where the plan is billed: `stripe` (the web) or `apple` (this app), nil without a plan or on a
    /// database before 20261017200000_apple_subscriptions.sql.
    public let provider: String?
    /// A free trial on a second plan, which grants no free help (has_unlimited's first-plan rule).
    public let repeatTrial: Bool?

    enum CodingKeys: String, CodingKey {
        case status, unlimited, provider
        case trialEnd = "trial_end"
        case currentPeriodEnd = "current_period_end"
        case cancelAtPeriodEnd = "cancel_at_period_end"
        case checkoutRef = "checkout_ref"
        case repeatTrial = "repeat_trial"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        status = try? c.decodeIfPresent(String.self, forKey: .status)
        unlimited = try? c.decodeIfPresent(Bool.self, forKey: .unlimited)
        trialEnd = (try? c.decodeIfPresent(String.self, forKey: .trialEnd))?.flatMap(PostgresDate.parse)
        currentPeriodEnd = (try? c.decodeIfPresent(String.self, forKey: .currentPeriodEnd))?.flatMap(PostgresDate.parse)
        cancelAtPeriodEnd = try? c.decodeIfPresent(Bool.self, forKey: .cancelAtPeriodEnd)
        checkoutRef = (try? c.decodeIfPresent(String.self, forKey: .checkoutRef))?.flatMap { UUID(uuidString: $0) }
        provider = try? c.decodeIfPresent(String.self, forKey: .provider)
        repeatTrial = try? c.decodeIfPresent(Bool.self, forKey: .repeatTrial)
    }

    /// For previews and tests.
    public init(status: String?, unlimited: Bool?, trialEnd: Date? = nil, currentPeriodEnd: Date? = nil, cancelAtPeriodEnd: Bool? = nil,
                checkoutRef: UUID? = nil, provider: String? = nil, repeatTrial: Bool? = nil) {
        self.status = status
        self.unlimited = unlimited
        self.trialEnd = trialEnd
        self.currentPeriodEnd = currentPeriodEnd
        self.cancelAtPeriodEnd = cancelAtPeriodEnd
        self.checkoutRef = checkoutRef
        self.provider = provider
        self.repeatTrial = repeatTrial
    }
}

/// A number PostgREST may write as a number or as a string.
struct FlexibleNumber: Decodable {
    let value: Double

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let number = try? c.decode(Double.self), number.isFinite {
            value = number
        } else if let text = try? c.decode(String.self), let number = Double(text), number.isFinite {
            value = number
        } else {
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "not a number")
        }
    }
}
