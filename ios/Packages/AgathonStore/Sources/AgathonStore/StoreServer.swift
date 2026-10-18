import AgathonKit
import Foundation

/// What the server did with a transaction the app handed over (POST /api/billing/apple/transaction,
/// src/app/api/billing/apple/transaction/route.ts), and so whether to finish it.
///
/// StoreKit keeps a transaction until the app calls `finish()`, and hands every unfinished one back
/// on the next launch (`Transaction.updates`, `Transaction.unfinished`). So a transaction is finished
/// once the server has it (or never will: another account's purchase, a payload it cannot verify),
/// and kept when the server could not be asked (offline, signed out, a 5xx, a rate limit): the next
/// launch, sign-in or restore hands it over again. Apple's server notification records the plan
/// either way; this makes it show up at once.
public enum RecordOutcome: Sendable, Equatable {
    /// Recorded. `applied` is false when the server already had a newer state.
    case recorded(status: String?, unlimited: Bool, applied: Bool)
    /// Not this plan (another product): nothing to record.
    case ignored(reason: String)
    /// Another Agathon account's purchase (its appAccountToken is theirs), or another family's
    /// subscription: refused with nothing written (409).
    case refused(reason: String)
    /// The server could not verify it (400): asking again would not help.
    case rejected(reason: String?)
    /// The server could not be asked, or asked us to wait: keep the transaction and try later.
    case retryLater(message: String)

    /// Finish the transaction (true for everything but `retryLater`).
    public var shouldFinish: Bool {
        if case .retryLater = self { return false }
        return true
    }

    /// The server's 409 reason for another account's purchase (`APPLE_REFUSALS`).
    public static let accountMismatch = "apple_account_mismatch"
    public static let accountUnknown = "apple_account_unknown"
    public static let otherFamily = "apple_other_family"

    /// A failed call, as an outcome: a 409 is a refusal, another 4xx (but 401 and 429) a rejection,
    /// everything else (offline, a stall, a 5xx, signed out, rate limited) a retry later.
    public static func from(error: Error) -> RecordOutcome {
        if let api = error as? APIError {
            switch api {
            case let .http(failure):
                let reason = failure.body?.objectValue?["reason"]?.stringValue
                if failure.status == 409 { return .refused(reason: reason ?? accountMismatch) }
                if failure.status == 401 || failure.status == 408 || failure.status == 429 || failure.status >= 500 {
                    return .retryLater(message: failure.message)
                }
                if (400 ..< 500).contains(failure.status) { return .rejected(reason: reason) }
                return .retryLater(message: failure.message)
            case .notSignedIn:
                return .retryLater(message: "Not signed in.")
            case .timeout, .incomplete, .network:
                return .retryLater(message: api.errorDescription ?? "Offline.")
            case let .invalidResponse(detail):
                return .retryLater(message: detail)
            }
        }
        if error is CancellationError { return .retryLater(message: "Cancelled.") }
        return .retryLater(message: error.localizedDescription)
    }
}

/// Where transactions go. The app uses `APIStoreServer`; tests pass a fake.
public protocol StoreServer: Sendable {
    /// Hands over a transaction's JWS (and its renewal info's, when known). Never throws.
    func record(transaction: String, renewalInfo: String?) async -> RecordOutcome
}

/// POST /api/billing/apple/transaction with the signed-in user's Bearer token (AgathonKit's APIClient).
public struct APIStoreServer: StoreServer {
    let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    struct Body: Encodable {
        let transaction: String
        /// Omitted when nil: the server's schema is strict.
        let renewalInfo: String?
    }

    struct Response: Decodable {
        let recorded: Bool
        let applied: Bool?
        let status: String?
        let unlimited: Bool?
        let ignored: String?
    }

    public func record(transaction: String, renewalInfo: String?) async -> RecordOutcome {
        do {
            let response: Response = try await api.post(StorePlan.transactionPath, body: Body(transaction: transaction, renewalInfo: renewalInfo))
            return Self.outcome(response)
        } catch {
            return RecordOutcome.from(error: error)
        }
    }

    static func outcome(_ response: Response) -> RecordOutcome {
        guard response.recorded else { return .ignored(reason: response.ignored ?? "not this plan") }
        return .recorded(status: response.status, unlimited: response.unlimited ?? false, applied: response.applied ?? true)
    }
}
