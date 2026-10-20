import Foundation
import Supabase

/// The Training Center's tables (supabase/migrations/20261020000000_training_center.sql), read and
/// written as the signed-in admin under RLS: `is_admin()` decides, so a non-admin reads nothing and
/// writes nothing, whatever the app does. Rows are JSON the Training Center builds (AgathonLive's
/// `TrainingRun` / `TrainingCaseResult`); this layer only moves them.
public final class TrainingRepository: Sendable {
    public static let runsTable = "training_runs"
    public static let casesTable = "training_cases"

    let client: SupabaseClient

    public init(client: SupabaseClient) {
        self.client = client
    }

    /// `is_admin()`: is the signed-in user an admin (the Training Center shows only then). False when
    /// signed out; throws when it could not be asked.
    public func isAdmin() async throws -> Bool {
        guard client.auth.currentUser != nil else { return false }
        let response = try await SkewRetry.run { try await client.rpc("is_admin").execute() }
        let text = String(decoding: response.data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        return text == "true"
    }

    /// A run's row (`training_runs`).
    public struct RunRow: Codable, Sendable, Equatable {
        public var id: String
        public var kind: String
        public var status: String
        public var target: String
        public var app_build: String?
        public var config: JSONValue
        public var totals: JSONValue
        public var created_at: String?
        public var finished_at: String?
        public var note: String?

        public init(id: String, kind: String, status: String, target: String, app_build: String?, config: JSONValue, totals: JSONValue,
                    created_at: String? = nil, finished_at: String? = nil, note: String? = nil) {
            self.id = id
            self.kind = kind
            self.status = status
            self.target = target
            self.app_build = app_build
            self.config = config
            self.totals = totals
            self.created_at = created_at
            self.finished_at = finished_at
            self.note = note
        }
    }

    /// A case's row (`training_cases`).
    public struct CaseRow: Codable, Sendable, Equatable {
        public var id: String
        public var run_id: String
        public var kind: String
        public var case_key: String
        public var category: String
        public var grade: String?
        public var topic: String?
        public var hand: String
        public var problem: JSONValue
        public var expected: JSONValue
        public var lines: JSONValue
        public var strokes: JSONValue
        public var reads: JSONValue
        public var pass: Bool?
        public var calls: JSONValue
        public var ms: Int?
        public var snapshot: String?
        public var regression: Bool
        public var fixture: JSONValue?
        public var note: String?
        public var updated_at: String?

        public init(id: String, run_id: String, kind: String, case_key: String, category: String, grade: String?, topic: String?, hand: String,
                    problem: JSONValue, expected: JSONValue, lines: JSONValue, strokes: JSONValue, reads: JSONValue, pass: Bool?, calls: JSONValue,
                    ms: Int?, snapshot: String?, regression: Bool, fixture: JSONValue?, note: String? = nil, updated_at: String? = nil) {
            self.id = id
            self.run_id = run_id
            self.kind = kind
            self.case_key = case_key
            self.category = category
            self.grade = grade
            self.topic = topic
            self.hand = hand
            self.problem = problem
            self.expected = expected
            self.lines = lines
            self.strokes = strokes
            self.reads = reads
            self.pass = pass
            self.calls = calls
            self.ms = ms
            self.snapshot = snapshot
            self.regression = regression
            self.fixture = fixture
            self.note = note
            self.updated_at = updated_at
        }
    }

    /// Writes (or rewrites) a run's row.
    public func upsert(run: RunRow) async throws {
        try await SkewRetry.run { try await client.from(Self.runsTable).upsert(run, onConflict: "id").execute() }
    }

    /// Writes (or rewrites) case rows, a few at a time (a snapshot or a long page's strokes are big).
    public func upsert(cases: [CaseRow]) async throws {
        var i = 0
        while i < cases.count {
            let chunk = Array(cases[i..<min(cases.count, i + 5)])
            try await SkewRetry.run { try await client.from(Self.casesTable).upsert(chunk, onConflict: "id").execute() }
            i += chunk.count
        }
    }

    /// The newest runs (the admin's own and other admins').
    public func runs(limit: Int = 50) async throws -> [RunRow] {
        let response = try await SkewRetry.run {
            try await client.from(Self.runsTable).select("id,kind,status,target,app_build,config,totals,created_at,finished_at,note")
                .order("created_at", ascending: false).limit(limit).execute()
        }
        do {
            return try JSONDecoder().decode([RunRow].self, from: response.data)
        } catch {
            throw APIError.invalidResponse("training_runs: \(error)")
        }
    }

    /// A run's cases, oldest first.
    public func cases(run: String) async throws -> [CaseRow] {
        let response = try await SkewRetry.run {
            try await client.from(Self.casesTable).select().eq("run_id", value: run).order("created_at", ascending: true).execute()
        }
        do {
            return try JSONDecoder().decode([CaseRow].self, from: response.data)
        } catch {
            throw APIError.invalidResponse("training_cases: \(error)")
        }
    }

    /// The tables are not there (the migration is not applied on this server yet).
    public static func isMissingTable(_ error: Error) -> Bool {
        let text = String(describing: error)
        return text.contains("PGRST205") || text.contains("42P01") || text.contains("training_runs") && text.contains("does not exist")
            || text.contains("Could not find the table")
    }
}
