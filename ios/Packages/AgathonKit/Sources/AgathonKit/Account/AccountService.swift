import Foundation
import Supabase

/// The grown-up's account (src/app/(platform)/account, src/lib/billing/deleteAccount.ts): the name
/// and the grade, what Ask remembers, the weekly report email, and deleting the account.
public final class AccountService: Sendable {
    let api: APIClient
    let client: SupabaseClient

    public init(api: APIClient, client: SupabaseClient) {
        self.api = api
        self.client = client
    }

    // MARK: profile

    /// NAME_MAX for a display name on the account page.
    public static let displayNameMax = 60

    /// Sets `profiles.display_name` (trimmed; empty clears it).
    public func updateDisplayName(_ name: String) async throws {
        guard let userId = client.auth.currentUser?.id.uuidString.lowercased() else { throw APIError.notSignedIn }
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard clean.count <= Self.displayNameMax else { throw AccountError.nameTooLong }
        struct Change: Encodable { let display_name: String? }
        _ = try await SkewRetry.run {
            try await client.from("profiles")
                .update(Change(display_name: clean.isEmpty ? nil : clean))
                .eq("user_id", value: userId)
                .execute()
        }
    }

    /// Saves the grade (0 = Kindergarten … 8) through `save_onboarding`, as the account page does:
    /// the course "other" plus the grade, without finishing onboarding.
    public func saveGrade(_ grade: Int) async throws {
        guard (0 ... 8).contains(grade) else { throw AccountError.gradeOutOfRange }
        struct Args: Encodable {
            let p_course: String
            let p_complete: Bool
            let p_grade: Int
        }
        _ = try await SkewRetry.run {
            try await client.rpc("save_onboarding", params: Args(p_course: "other", p_complete: false, p_grade: grade)).execute()
        }
    }

    // MARK: what Ask remembers

    public struct AskMemory: Sendable, Equatable, Decodable {
        public let notes: [String]
        public let updatedAt: Date?

        enum CodingKeys: String, CodingKey { case notes, updatedAt }

        public init(notes: [String], updatedAt: Date? = nil) {
            self.notes = notes
            self.updatedAt = updatedAt
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            notes = (try? c.decodeIfPresent([String].self, forKey: .notes)).flatMap { $0 } ?? []
            updatedAt = (try? c.decodeIfPresent(String.self, forKey: .updatedAt)).flatMap { $0 }.flatMap(PostgresDate.parse)
        }
    }

    public static let askMemoryPath = "/api/live/ask/memory"

    /// GET /api/live/ask/memory (a grown-up may pass one of their kids).
    public func askMemory(kidId: String? = nil) async throws -> AskMemory {
        try await api.get(Self.askMemoryPath, query: kidId.map { [URLQueryItem(name: "kidId", value: $0)] } ?? [])
    }

    /// DELETE /api/live/ask/memory: Ask forgets its notes. Boards and chats stay.
    @discardableResult
    public func clearAskMemory(kidId: String? = nil) async throws -> AskMemory {
        let (data, _) = try await api.perform(.delete, Self.askMemoryPath,
                                              query: kidId.map { [URLQueryItem(name: "kidId", value: $0)] } ?? [])
        return (try? JSONDecoder().decode(AskMemory.self, from: data)) ?? AskMemory(notes: [])
    }

    // MARK: the weekly report email

    /// `set_weekly_report_opt_out`: true stops the Monday email. Returns what is saved.
    @discardableResult
    public func setWeeklyReportOptOut(_ optOut: Bool) async throws -> Bool {
        struct Args: Encodable { let p_opt_out: Bool }
        let response = try await SkewRetry.run {
            try await client.rpc("set_weekly_report_opt_out", params: Args(p_opt_out: optOut)).execute()
        }
        return (try? JSONDecoder().decode(Bool.self, from: response.data)) ?? optOut
    }

    // MARK: deleting the account

    /// Plan statuses that would charge again (deleteAccount.ts CHARGING).
    static let charging: Set<String> = ["trialing", "active", "past_due", "unpaid"]

    /// A web (Stripe) plan that would charge again and isn't set to cancel blocks deletion: the
    /// grown-up cancels it on agathon.app first. An Apple plan never blocks (only the person can
    /// cancel it, in Settings; `delete_own_account` lets it through, and the app says to cancel it
    /// first: AgathonStore's `DeletionAdvice`).
    public func planBlocksDeletion() async throws -> Bool {
        let response: PostgrestResponse<Void>
        do {
            response = try await SkewRetry.run {
                try await client.from("unlimited_subscriptions").select("status,cancel_at_period_end,cancel_at,provider").execute()
            }
        } catch let error as PostgrestError where error.message.range(of: "could not find the table|does not exist",
                                                                         options: [.regularExpression, .caseInsensitive]) != nil {
            return false
        }
        return Self.planBlocksDeletion(rows: response.data)
    }

    static func planBlocksDeletion(rows data: Data) -> Bool {
        guard let rows = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else { return false }
        return rows.contains { row in
            let status = row["status"] as? String ?? ""
            let cancelling = row["cancel_at_period_end"] as? Bool == true
            let cancelAt = row["cancel_at"]
            let apple = row["provider"] as? String == "apple"
            return !apple && charging.contains(status) && !cancelling && (cancelAt == nil || cancelAt is NSNull)
        }
    }

    /// What deleting did to the pictures (the account is gone regardless).
    public struct DeleteResult: Sendable, Equatable {
        public var assetsFound = 0
        public var assetsRemoved = 0
        public var problems: [String] = []
    }

    /// Deletes the signed-in grown-up's account the web's way: refuse while a plan would charge
    /// again, remove the kids' pictures (DELETE /api/family) and the account's own, then
    /// `delete_own_account()` (the kids' accounts go in the same transaction), then drop the session
    /// on this device. Throws `AccountError.planStillActive` when a plan blocks it.
    @discardableResult
    public func deleteAccount(signOutLocally: @Sendable () async throws -> Void) async throws -> DeleteResult {
        if try await planBlocksDeletion() { throw AccountError.planStillActive }
        var result = DeleteResult()
        do {
            _ = try await api.perform(.delete, "/api/family")
        } catch {
            result.problems.append("kids' pictures: \(error.localizedDescription)")
        }
        do {
            let response = try await SkewRetry.run {
                try await client.from(BoardsRepository.assetsTable).select("object_path").execute()
            }
            let rows = (try? JSONDecoder().decode([PathRow].self, from: response.data)) ?? []
            let paths = Array(Set(rows.map(\.objectPath).filter { !$0.isEmpty }))
            result.assetsFound = paths.count
            for start in stride(from: 0, to: paths.count, by: BoardsRepository.deleteBatchSize) {
                let batch = Array(paths[start ..< min(start + BoardsRepository.deleteBatchSize, paths.count)])
                do {
                    _ = try await client.storage.from(BoardsRepository.assetsBucket).remove(paths: batch)
                    result.assetsRemoved += batch.count
                } catch {
                    result.problems.append("pictures: \(error.localizedDescription)")
                }
            }
        } catch {
            result.problems.append("picture list: \(error.localizedDescription)")
        }
        do {
            _ = try await SkewRetry.run { try await client.rpc("delete_own_account").execute() }
        } catch let error as PostgrestError where error.hint?.contains("plan") == true || error.message.localizedCaseInsensitiveContains("cancel") {
            throw AccountError.planStillActive
        }
        try? await signOutLocally()
        return result
    }

    struct PathRow: Decodable {
        let objectPath: String
        enum CodingKeys: String, CodingKey { case objectPath = "object_path" }
    }
}

public enum AccountError: Error, Equatable, LocalizedError {
    case nameTooLong
    case gradeOutOfRange
    /// A plan would charge again: cancel it first.
    case planStillActive

    public var errorDescription: String? {
        switch self {
        case .nameTooLong: return "A name is at most \(AccountService.displayNameMax) characters."
        case .gradeOutOfRange: return "Pick a grade from Kindergarten to 8th."
        case .planStillActive: return "Cancel Agathon Unlimited first, then delete the account."
        }
    }
}
