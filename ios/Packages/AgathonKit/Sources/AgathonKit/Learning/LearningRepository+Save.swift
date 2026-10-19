import Foundation
import Supabase

/// Why a write (or read) of the learning record failed: the web's `LearningStoreError`
/// (src/lib/learning/store.ts). The code tells the caller whether to try again: only `network` and
/// `unknown` are worth retrying.
///
/// - `unavailable`: the table is not there (the migration is not applied).
/// - `unauthorized`: signed out, the session was refused, or RLS refused the rows (42501) — a board
///   that is not the signed-in student's.
/// - `invalid`: the database refused a value (22xxx / 23xxx). Every other record of the save was
///   still written.
/// - `network`: no answer, a timeout, a gateway or an overloaded database.
/// - `unknown`: anything else.
public struct LearningStoreError: Error, Sendable, Equatable, CustomStringConvertible {
    public enum Code: String, Sendable { case unavailable, unauthorized, invalid, network, unknown }

    public let code: Code
    public let message: String
    /// the HTTP status, when the server answered and it is known
    public let status: Int?
    /// the PostgREST or Postgres error code (PGRST205, 42501, 23514, …)
    public let dbCode: String?

    public init(_ code: Code, _ message: String, status: Int? = nil, dbCode: String? = nil) {
        self.code = code
        self.message = message
        self.status = status
        self.dbCode = dbCode
    }

    public var description: String { "LearningStoreError(\(code.rawValue)): \(message)" }

    /// The web's `classify(error, status)`: what a failed request means for the caller.
    public static func classify(dbCode: String?, status: Int?, message: String) -> Code {
        let code = dbCode ?? ""
        func matches(_ pattern: String, _ s: String) -> Bool { s.range(of: pattern, options: .regularExpression) != nil }
        // the table (or a column the store uses) is missing: the migration is not applied
        if ["PGRST205", "42P01", "PGRST204", "42703"].contains(code) { return .unavailable }
        if status == 401 || code == "42501" || matches("^PGRST30\\d$", code) { return .unauthorized }
        // 22xxx bad data, 23xxx a constraint, 21000 the same row twice, PGRST1xx a malformed request
        if matches("^2[123]", code) || matches("^PGRST1\\d\\d$", code) { return .invalid }
        if let status, [0, 408, 429, 502, 503, 504].contains(status) { return .network }
        if matches("^PGRST00\\d$", code) || matches("^(08|53|57)", code) || code == "40001" || code == "40P01" { return .network }
        if code.isEmpty, status == nil, message.range(of: "fetch|network|load failed|timed? ?out|abort|offline|connection", options: [.regularExpression, .caseInsensitive]) != nil {
            return .network
        }
        // supabase-swift drops the status of a JSON error: a gateway's 401 has no code, only words
        if code.isEmpty, status == nil, message.range(of: "jwt|unauthori[sz]ed|invalid (api )?key|credentials", options: [.regularExpression, .caseInsensitive]) != nil {
            return .unauthorized
        }
        if status == 400 && code.isEmpty { return .invalid }
        return .unknown
    }

    /// Any error a request threw, as the store's error.
    public static func from(_ error: Error, _ what: String) -> LearningStoreError {
        if let e = error as? LearningStoreError { return e }
        if let e = error as? PostgrestError {
            let code = classify(dbCode: e.code, status: nil, message: e.message)
            return LearningStoreError(code, "\(what): \(e.message)", dbCode: e.code)
        }
        if let e = error as? HTTPError {
            let status = e.response.statusCode
            let body = (try? JSONSerialization.jsonObject(with: e.data)) as? [String: Any]
            let dbCode = body?["code"] as? String
            let message = body?["message"] as? String ?? "HTTP \(status)"
            return LearningStoreError(classify(dbCode: dbCode, status: status, message: message), "\(what): \(message)", status: status, dbCode: dbCode)
        }
        if error is URLError || error is CancellationError {
            return LearningStoreError(.network, "\(what): \(error.localizedDescription)", status: 0)
        }
        if let e = error as? APIError, case .notSignedIn = e { return LearningStoreError(.unauthorized, "\(what): not signed in") }
        if error is AuthError {
            return LearningStoreError(.unauthorized, "\(what): \(error.localizedDescription)")
        }
        return LearningStoreError(classify(dbCode: nil, status: nil, message: "\(error)"), "\(what): \(error)")
    }
}

/// One `learning_attempts` row as the store writes it (snake_case; no user_id, created_at or
/// updated_at, which the database owns). Every key is sent, nulls included: an upsert of a finished
/// attempt that was reopened must clear `finished_at`.
public struct AttemptRow: Encodable, Equatable, Sendable {
    public var id: String
    public var boardId: String?
    public var problemLatex: String
    public var skill: String
    public var course: String?
    public var origin: String
    public var parentId: String?
    public var outcome: String
    public var linesWritten: Int
    public var linesRight: Int
    public var linesRinged: Int
    public var hints: Int
    public var tutorSteps: Int
    public var solves: Int
    public var asks: Int
    public var mistakes: [String: Int]
    public var activeMs: Int
    public var startedAt: String
    public var finishedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, skill, course, origin, outcome, hints, solves, asks, mistakes
        case boardId = "board_id", problemLatex = "problem_latex", parentId = "parent_id", linesWritten = "lines_written"
        case linesRight = "lines_right", linesRinged = "lines_ringed", tutorSteps = "tutor_steps", activeMs = "active_ms"
        case startedAt = "started_at", finishedAt = "finished_at"
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(boardId, forKey: .boardId)
        try c.encode(problemLatex, forKey: .problemLatex)
        try c.encode(skill, forKey: .skill)
        try c.encode(course, forKey: .course)
        try c.encode(origin, forKey: .origin)
        try c.encode(parentId, forKey: .parentId)
        try c.encode(outcome, forKey: .outcome)
        try c.encode(linesWritten, forKey: .linesWritten)
        try c.encode(linesRight, forKey: .linesRight)
        try c.encode(linesRinged, forKey: .linesRinged)
        try c.encode(hints, forKey: .hints)
        try c.encode(tutorSteps, forKey: .tutorSteps)
        try c.encode(solves, forKey: .solves)
        try c.encode(asks, forKey: .asks)
        try c.encode(mistakes, forKey: .mistakes)
        try c.encode(activeMs, forKey: .activeMs)
        try c.encode(startedAt, forKey: .startedAt)
        try c.encode(finishedAt, forKey: .finishedAt)
    }
}

/// The learning record's writes (src/lib/learning/store.ts `saveAttempts`), as the signed-in user
/// under RLS: upserts by the attempt's id, so saving an attempt again replaces it with its latest
/// state and a retry after a lost answer changes nothing. What goes in is cleaned first (`row`): a
/// record the board made is never refused for a detail.
extension LearningRepository {
    /// SKILL_IDS (src/lib/learning/contracts.ts `SKILLS`), in order: a skill this does not know is
    /// filed under `other`. `LearningSaveTests` checks it against the web's list.
    public static let skillIds = [
        "add_within_10", "subtract_within_10", "add_within_20", "subtract_within_20", "add_tens", "add_within_100",
        "subtract_within_100", "add_subtract_within_1000", "multi_digit_add_subtract", "add_subtract",
        "times_tables", "division_facts", "multiply_by_tens", "multiply_multi_digit", "long_division", "multiply_divide",
        "negative_numbers", "order_of_operations",
        "equivalent_fractions", "add_fractions_like", "add_fractions_unlike", "multiply_fractions", "divide_fractions", "fractions",
        "decimals_add_subtract", "decimals_multiply", "percents", "proportions", "decimals_percents", "powers_roots",
        "simplify_expressions", "one_step_equations", "two_step_equations", "multi_step_equations", "inequalities", "absolute_value",
        "systems", "exponent_rules", "polynomials", "factoring", "quadratic_equations", "radicals", "rational_expressions",
        "complex_numbers", "word_problems",
        "linear_functions", "functions", "exponential_equations", "logarithms",
        "angles", "triangles", "pythagorean", "area_perimeter", "circles", "coordinate_geometry", "proofs",
        "trig_values", "trig_equations",
        "limits", "derivatives", "integrals",
        "units", "chemistry",
        "other",
    ]
    /// ATTEMPT_ORIGINS, OUTCOMES, MISTAKE_KINDS, COURSE_IDS.
    public static let origins = ["student", "tutor_problem", "starter", "now_you_try", "practice", "teach"]
    public static let outcomes = ["in_progress", "first_try", "self_corrected", "with_help", "tutor_solved", "unfinished"]
    public static let mistakeKinds = ["sign", "arithmetic", "distribution", "both_sides", "combining_terms", "inverse_operation",
                                      "fractions", "exponents", "algebra", "units", "concept"]
    public static let courseIds = ["algebra1", "geometry", "algebra2", "precalc_calc", "other"]
    /// LEARNING_LIMITS.problemLatex / maxCount / maxActiveMs; a mistake kind's count
    static let maxProblem = 500
    static let maxCount = 32_767
    static let maxActiveMs = 14_400_000
    static let maxMistakeCount = 9_999
    /// rows per upsert request
    static let writeChunk = 200
    /// the earliest time the database accepts for `started_at` / `finished_at` (2026-01-01), ms
    static let earliestMs = 1_767_225_600_000.0

    // MARK: - cleaning

    /// A record as a row, or why it cannot be one (`toRow`).
    public static func row(_ record: AttemptRecord) -> Result<AttemptRow, LearningStoreError> {
        guard let id = uuidOrNil(record.id) else {
            return .failure(LearningStoreError(.invalid, "attempt id is not a uuid (\(record.id.prefix(40)))"))
        }
        guard origins.contains(record.origin) else { return .failure(LearningStoreError(.invalid, "attempt \(id): unknown origin \(record.origin.prefix(40))")) }
        guard outcomes.contains(record.outcome) else { return .failure(LearningStoreError(.invalid, "attempt \(id): unknown outcome \(record.outcome.prefix(40))")) }
        let problem = cleanText(record.problemLatex.trimmingCharacters(in: .whitespacesAndNewlines), max: maxProblem)
        guard !problem.isEmpty else { return .failure(LearningStoreError(.invalid, "attempt \(id): no problem")) }
        guard let startedAt = timeOrNil(record.startedAt) else {
            return .failure(LearningStoreError(.invalid, "attempt \(id): start time missing or before 2026 (\(record.startedAt.prefix(40)))"))
        }
        let parentId = uuidOrNil(record.parentId)
        var mistakes: [String: Int] = [:]
        for kind in mistakeKinds {
            let n = clamp(record.mistakes[kind] ?? 0, maxMistakeCount)
            if n > 0 { mistakes[kind] = n }
        }
        return .success(AttemptRow(
            id: id, boardId: uuidOrNil(record.boardId), problemLatex: problem,
            skill: skillIds.contains(record.skill) ? record.skill : "other",
            course: record.course.flatMap { courseIds.contains($0) ? $0 : nil },
            origin: record.origin, parentId: parentId == id ? nil : parentId, outcome: record.outcome,
            linesWritten: clamp(record.linesWritten, maxCount), linesRight: clamp(record.linesRight, maxCount),
            linesRinged: clamp(record.linesRinged, maxCount), hints: clamp(record.hints, maxCount),
            tutorSteps: clamp(record.tutorSteps, maxCount), solves: clamp(record.solves, maxCount), asks: clamp(record.asks, maxCount),
            mistakes: mistakes, activeMs: clamp(record.activeMs, maxActiveMs), startedAt: startedAt,
            finishedAt: record.finishedAt.flatMap(timeOrNil)))
    }

    static func clamp(_ n: Int, _ max: Int) -> Int { Swift.min(max, Swift.max(0, n)) }

    static func uuidOrNil(_ value: String?) -> String? {
        guard let value, value.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", options: [.regularExpression, .caseInsensitive]) != nil else { return nil }
        return value.lowercased()
    }

    /// Text Postgres takes: no NUL, at most `max` characters as `char_length` counts them (code points).
    static func cleanText(_ value: String, max: Int) -> String {
        var out = String.UnicodeScalarView()
        var n = 0
        for scalar in value.unicodeScalars {
            if n >= max { break }
            if scalar.value == 0 { continue }
            out.append(scalar)
            n += 1
        }
        return String(out)
    }

    /// An ISO time the database accepts (2026 or later), normalized as `toISOString` writes it.
    static func timeOrNil(_ value: String) -> String? {
        guard let ms = LearningTime.parse(value) ?? PostgresDate.parse(value).map({ ($0.timeIntervalSince1970 * 1000).rounded() }),
              ms >= earliestMs else { return nil }
        return LearningTime.iso(ms)
    }

    /// Rows in the order the database needs them: an attempt before the attempts that follow it
    /// (the policy checks a `parent_id` against the rows there when the statement starts).
    public static func parentsFirst(_ rows: [AttemptRow]) -> [[AttemptRow]] {
        var pending = rows
        var layers: [[AttemptRow]] = []
        while !pending.isEmpty {
            let ids = Set(pending.map(\.id))
            let layer = pending.filter { $0.parentId == nil || !ids.contains($0.parentId!) }
            if layer.isEmpty {
                // a loop of parents: the board never makes one, and the database refuses it
                layers.append(pending)
                break
            }
            let taken = Set(layer.map(\.id))
            pending.removeAll { taken.contains($0.id) }
            layers.append(layer)
        }
        return layers
    }

    // MARK: - writing

    /// Upsert by id (the attempt's latest state wins). Throws `LearningStoreError`, so the caller can
    /// retry. Records that cannot be saved at all, and rows the database refuses, are skipped and
    /// reported at the end as one `invalid` error, after everything else was written; any other
    /// failure throws at once, and saving the same records again is safe.
    public func saveAttempts(_ records: [AttemptRecord]) async throws {
        guard !records.isEmpty else { return }
        let userId = try await sessionUserId()
        try await saveAttempts(records, userId: userId)
    }

    /// `saveAttempts` for this user (the session already read).
    func saveAttempts(_ records: [AttemptRecord], userId: String) async throws {
        var refused: LearningStoreError?
        // the same attempt twice in a batch: its last state wins (one upsert cannot touch a row twice)
        var order: [String] = []
        var rows: [String: AttemptRow] = [:]
        for record in records {
            switch Self.row(record) {
            case .failure(let why):
                if refused == nil { refused = LearningStoreError(.invalid, "Learning attempt not saved: \(why.message)") }
            case .success(let row):
                if rows[row.id] != nil { order.removeAll { $0 == row.id } }
                order.append(row.id)
                rows[row.id] = row
            }
        }
        if !order.isEmpty {
            var all = order.compactMap { rows[$0] }
            try await dropUnsavedParents(userId: userId, &all)
            var refusedIds = Set<String>()
            for var layer in Self.parentsFirst(all) {
                // a parent refused in an earlier layer was not saved: its followers keep their record, not the link
                for i in layer.indices where layer[i].parentId.map(refusedIds.contains) == true { layer[i].parentId = nil }
                var start = 0
                while start < layer.count {
                    let chunk = Array(layer[start..<min(layer.count, start + Self.writeChunk)])
                    let error = try await writeIsolating(chunk, refusedIds: &refusedIds)
                    if refused == nil { refused = error }
                    SavedAttempts.shared.remember(userId: userId, chunk.map(\.id).filter { !refusedIds.contains($0) })
                    start += Self.writeChunk
                }
            }
        }
        if let refused { throw refused }
    }

    /// Who is signed in on this client now (lower case), or nil: a record is only ever saved for its
    /// own student.
    public func signedInUserId() async -> String? {
        try? await sessionUserId()
    }

    /// The signed-in student's id (the session refreshed when it has expired), or why there is none.
    func sessionUserId() async throws -> String {
        do {
            return try await client.auth.session.user.id.uuidString.lowercased()
        } catch {
            if error is URLError { throw LearningStoreError(.network, "Could not refresh the session: \(error.localizedDescription)") }
            throw LearningStoreError(.unauthorized, "Not signed in.")
        }
    }

    private func upsert(_ rows: [AttemptRow]) async -> LearningStoreError? {
        do {
            _ = try await SkewRetry.run {
                try await client.from(Self.attemptsTable).upsert(rows, onConflict: "id", returning: .minimal).execute()
            }
            return nil
        } catch {
            return LearningStoreError.from(error, "Could not save \(rows.count) learning attempt(s)")
        }
    }

    /// Writes `rows`; when the database refuses a value, halves the batch until the refused rows are
    /// alone, so one bad record never costs the others.
    private func writeIsolating(_ rows: [AttemptRow], refusedIds: inout Set<String>) async throws -> LearningStoreError? {
        guard let error = await upsert(rows) else { return nil }
        guard error.code == .invalid else { throw error }
        if rows.count == 1 {
            refusedIds.insert(rows[0].id)
            return error
        }
        let mid = (rows.count + 1) / 2
        let first = try await writeIsolating(Array(rows[..<mid]), refusedIds: &refusedIds)
        let second = try await writeIsolating(Array(rows[mid...]), refusedIds: &refusedIds)
        return first ?? second
    }

    /// A "Now you try" can only point at an attempt that was saved: when the attempt it follows never
    /// was, the link is dropped and the attempt kept (one read, only for parents not saved from here).
    private func dropUnsavedParents(userId: String, _ rows: inout [AttemptRow]) async throws {
        let inBatch = Set(rows.map(\.id))
        let unknown = Array(Set(rows.compactMap(\.parentId).filter { !inBatch.contains($0) && !SavedAttempts.shared.knows(userId: userId, $0) })).sorted()
        guard !unknown.isEmpty else { return }
        var found = Set<String>()
        var start = 0
        while start < unknown.count {
            let ids = Array(unknown[start..<min(unknown.count, start + Self.writeChunk)])
            do {
                let response = try await SkewRetry.run {
                    try await client.from(Self.attemptsTable).select("id").in("id", values: ids).execute()
                }
                let list = (try? JSONSerialization.jsonObject(with: response.data)) as? [[String: Any]] ?? []
                for r in list { if let id = r["id"] as? String { found.insert(id.lowercased()) } }
            } catch {
                throw LearningStoreError.from(error, "Could not check the attempts these follow")
            }
            start += Self.writeChunk
        }
        SavedAttempts.shared.remember(userId: userId, found)
        for i in rows.indices {
            if let p = rows[i].parentId, !inBatch.contains(p), !found.contains(p), !SavedAttempts.shared.knows(userId: userId, p) {
                rows[i].parentId = nil
            }
        }
    }

    // MARK: - one board's attempts (Today's practice)

    /// One attempt of a board, as Today's practice counts it (`loadBoardCounted`).
    public struct BoardAttempt: Sendable, Equatable {
        public let id: String
        public let problemLatex: String
        public let origin: String
        public let outcome: String
    }

    /// The student's attempts on one board (at most 200), for Today's practice: what another device
    /// counted. Throws `LearningStoreError`.
    public func boardAttempts(boardId: String) async throws -> [BoardAttempt] {
        guard let board = Self.uuidOrNil(boardId) else { return [] }
        do {
            let response = try await SkewRetry.run {
                try await client.from(Self.attemptsTable).select("id,problem_latex,origin,outcome").eq("board_id", value: board).limit(200).execute()
            }
            let list = (try? JSONSerialization.jsonObject(with: response.data)) as? [[String: Any]] ?? []
            return list.compactMap { r in
                guard let id = r["id"] as? String, let origin = r["origin"] as? String, let outcome = r["outcome"] as? String else { return nil }
                return BoardAttempt(id: id, problemLatex: r["problem_latex"] as? String ?? "", origin: origin, outcome: outcome)
            }
        } catch {
            throw LearningStoreError.from(error, "Could not read the board's attempts")
        }
    }
}

/// Ids saved (or seen saved) for the signed-in student: a "Now you try" whose parent is among them
/// needs no lookup. Forgotten when the student changes (the web's module-level `known`).
final class SavedAttempts: @unchecked Sendable {
    static let shared = SavedAttempts()
    private let lock = NSLock()
    private var userId = ""
    private var ids = Set<String>()

    func remember(userId: String, _ more: some Sequence<String>) {
        lock.withLock {
            if self.userId != userId || ids.count > 20_000 {
                self.userId = userId
                ids = []
            }
            ids.formUnion(more)
        }
    }

    func knows(userId: String, _ id: String) -> Bool {
        lock.withLock { self.userId == userId && ids.contains(id) }
    }
}
