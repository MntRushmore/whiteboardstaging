import Foundation
import Supabase

/// The student's learning record and Today's practice, read as the user under RLS
/// (src/lib/learning/store.ts, src/lib/daily/store.ts). Every call retries once after a "JWT issued
/// at future" refusal (`SkewRetry`).
public final class LearningRepository: Sendable {
    public static let attemptsTable = "learning_attempts"
    public static let dailyTable = "daily_practice"
    /// LEARNING_LIMITS.readDays / readLimit: what the Progress page reads.
    public static let readDays = 120
    public static let readLimit = 5_000
    static let pageSize = 1_000

    let client: SupabaseClient

    public init(client: SupabaseClient) {
        self.client = client
    }

    /// The signed-in student's attempts of the last `days` days, newest first, at most `limit`.
    public func attempts(days: Int = LearningRepository.readDays, limit: Int = LearningRepository.readLimit,
                         now: Date = Date()) async throws -> [AttemptRecord] {
        guard let userId = client.auth.currentUser?.id.uuidString.lowercased() else { throw APIError.notSignedIn }
        let since = ISO8601DateFormatter().string(from: now.addingTimeInterval(-Double(days) * 86_400))
        var out: [AttemptRecord] = []
        var seen = Set<String>()
        var from = 0
        while out.count < limit {
            let start = from
            let response = try await SkewRetry.run {
                try await client.from(Self.attemptsTable)
                    .select(AttemptRecord.columns)
                    .eq("user_id", value: userId)
                    .gte("started_at", value: since)
                    .order("started_at", ascending: false)
                    .order("id", ascending: false)
                    .range(from: start, to: start + Self.pageSize - 1)
                    .execute()
            }
            let page = Self.decodeRows(response.data)
            for record in page.records where !seen.contains(record.id) {
                seen.insert(record.id)
                out.append(record)
            }
            if page.count < Self.pageSize { break }
            from += page.count
        }
        return Array(out.prefix(limit))
    }

    /// Rows as attempts, skipping any that don't read (the web's `fromRow` returning null), and how
    /// many rows the page had.
    static func decodeRows(_ data: Data) -> (records: [AttemptRecord], count: Int) {
        guard let rows = try? JSONDecoder().decode([LossyRow].self, from: data) else { return ([], 0) }
        return (rows.compactMap(\.record), rows.count)
    }

    private struct LossyRow: Decodable {
        let record: AttemptRecord?
        init(from decoder: Decoder) throws { record = try? AttemptRecord(from: decoder) }
    }

    /// The student's Today's practice days from `since` (YYYY-MM-DD) on, newest first.
    public func dailyPractice(since: String) async throws -> [DailyRow] {
        guard let userId = client.auth.currentUser?.id.uuidString.lowercased() else { throw APIError.notSignedIn }
        let response = try await SkewRetry.run {
            try await client.from(Self.dailyTable)
                .select(DailyRow.columns)
                .eq("user_id", value: userId)
                .gte("day", value: since)
                .order("day", ascending: false)
                .execute()
        }
        do {
            return try JSONDecoder().decode([DailyRow].self, from: response.data)
        } catch {
            throw APIError.invalidResponse("daily_practice: \(error)")
        }
    }

    /// Records a day's practice (`save_daily_practice`): one row per local day, counts only go up.
    @discardableResult
    public func saveDailyPractice(day: String, boardId: String?, goal: Int = DailyRow.defaultGoal, done: Int = 0,
                                  stars: Int = 0) async throws -> DailyRow? {
        struct Args: Encodable {
            let p_day: String
            let p_board_id: String?
            let p_goal: Int
            let p_done: Int
            let p_stars: Int
        }
        let args = Args(p_day: day, p_board_id: boardId, p_goal: goal, p_done: done, p_stars: stars)
        let response = try await SkewRetry.run {
            try await client.rpc("save_daily_practice", params: args).execute()
        }
        let decoder = JSONDecoder()
        if let row = try? decoder.decode(DailyRow.self, from: response.data) { return row }
        return (try? decoder.decode([DailyRow].self, from: response.data))?.first
    }
}
