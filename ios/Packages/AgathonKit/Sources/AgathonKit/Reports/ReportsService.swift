import Foundation
import Supabase

// The weekly report (GET /api/report, src/lib/report/contracts.ts) and the bug reports the person
// sent (`my_bug_reports`, src/lib/bugReports).

/// One kid's week (`ChildWeek`).
public struct ChildWeek: Sendable, Equatable, Decodable, Identifiable {
    public struct Practised: Sendable, Equatable, Decodable {
        public let skill: String
        public let name: String
        public let problems: Int
        public let independent: Int
    }

    public struct Focus: Sendable, Equatable, Decodable {
        public let skill: String
        public let name: String
        public let tip: String
    }

    public let userId: String
    public let displayName: String
    public let avatar: String?
    public let grade: Int?
    public let problems: Int
    public let independent: Int
    public let minutes: Int
    public let activeDays: Int
    public let dailySets: Int
    public let streak: Int
    public let newlyMastered: [String]
    public let practised: [Practised]
    public let focus: Focus?
    public let highlightBoardId: String?
    /// Problems each day, Monday first, when the server sends them.
    public let days: [Int]?

    public var id: String { userId }
}

public struct WeeklyReport: Sendable, Equatable, Decodable {
    /// The Monday, YYYY-MM-DD.
    public let weekStart: String
    public let timeZone: String
    public let ownerId: String
    public let children: [ChildWeek]
    public let generatedAt: String
}

/// GET /api/report's answer.
public struct ReportAnswer: Sendable, Equatable, Decodable {
    public struct Email: Sendable, Equatable, Decodable {
        public let optedOut: Bool
        /// The Monday email is switched on for this deployment (the toggle shows only then).
        public let sending: Bool
    }

    public let report: WeeklyReport
    public let role: String
    public let email: Email?
}

/// A bug report the person sent, with its thread (`my_bug_reports()`).
public struct BugReport: Sendable, Equatable, Decodable, Identifiable {
    public struct Message: Sendable, Equatable, Decodable, Identifiable {
        public let id: String
        /// `admin` or `reporter`
        public let author: String
        public let body: String
        public let at: Date?

        enum CodingKeys: String, CodingKey { case id, author, body, at }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = (try? c.decode(String.self, forKey: .id)) ?? UUID().uuidString
            author = (try? c.decode(String.self, forKey: .author)) ?? "reporter"
            body = (try? c.decode(String.self, forKey: .body)) ?? ""
            at = (try? c.decodeIfPresent(String.self, forKey: .at)).flatMap { $0 }.flatMap(PostgresDate.parse)
        }

        public var fromAgathon: Bool { author == "admin" }
    }

    public let id: String
    public let createdAt: Date?
    public let message: String?
    /// new, seen, fixed, wontfix
    public let status: String
    public let unread: Bool
    public let thread: [Message]

    enum CodingKeys: String, CodingKey {
        case id, message, status, unread, thread
        case createdAt = "created_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        createdAt = (try? c.decodeIfPresent(String.self, forKey: .createdAt)).flatMap { $0 }.flatMap(PostgresDate.parse)
        message = (try? c.decodeIfPresent(String.self, forKey: .message)).flatMap { $0 }
        status = (try? c.decodeIfPresent(String.self, forKey: .status)).flatMap { $0 } ?? "new"
        unread = (try? c.decodeIfPresent(Bool.self, forKey: .unread)).flatMap { $0 } ?? false
        thread = (try? c.decodeIfPresent([Message].self, forKey: .thread)).flatMap { $0 } ?? []
    }

    /// The web's status words: Got it, Looking into it, Fixed, Closed.
    public var statusWords: String {
        switch status {
        case "seen": return "Looking into it"
        case "fixed": return "Fixed"
        case "wontfix": return "Closed"
        default: return "Got it"
        }
    }
}

public final class ReportsService: Sendable {
    public static let reportPath = "/api/report"
    /// A reply's body: 1–4000 characters.
    public static let replyMax = 4_000

    let api: APIClient
    let client: SupabaseClient

    public init(api: APIClient, client: SupabaseClient) {
        self.api = api
        self.client = client
    }

    /// GET /api/report?week=YYYY-MM-DD&tz=<IANA zone>: the grown-up's week for each kid (this week
    /// when `week` is nil).
    public func weeklyReport(week: String? = nil, timeZone: TimeZone = .current) async throws -> ReportAnswer {
        var query = [URLQueryItem(name: "tz", value: timeZone.identifier)]
        if let week { query.insert(URLQueryItem(name: "week", value: week), at: 0) }
        return try await api.get(Self.reportPath, query: query)
    }

    /// The bug reports this person sent, newest first, with their threads.
    public func myBugReports() async throws -> [BugReport] {
        let response = try await SkewRetry.run { try await client.rpc("my_bug_reports").execute() }
        do {
            return try JSONDecoder().decode([BugReport].self, from: response.data)
        } catch {
            throw APIError.invalidResponse("my_bug_reports: \(error)")
        }
    }

    /// Marks every reply read (`bug_reports_mark_seen(null)`).
    public func markBugRepliesSeen() async throws {
        struct Args: Encodable { let p_report_id: String? }
        _ = try await SkewRetry.run {
            try await client.rpc("bug_reports_mark_seen", params: Args(p_report_id: nil)).execute()
        }
    }

    /// POST /api/bug-reports/<id>/messages: a reply in a report's thread.
    public func reply(to reportId: String, body: String) async throws {
        let clean = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, clean.count <= Self.replyMax else { throw APIError.invalidResponse("a reply is 1–4000 characters") }
        _ = try await api.post("/api/bug-reports/\(reportId)/messages", body: ["body": clean], as: EmptyResponse.self)
    }

    /// Files a bug report (a row of `bug_reports`, as the web's Report a bug does): the words, what the
    /// app knows about where it happened, and a picture of the board when flagged from one (a JPEG).
    public func fileBugReport(message: String?, boardId: String? = nil, diagnostics: [String: String], screenshot: Data? = nil) async throws {
        let user = client.auth.currentUser
        struct Row: Encodable {
            let user_id: String?
            let user_email: String?
            let board_id: String?
            let message: String?
            let diagnostics: [String: String]
            let screenshot: String?
        }
        let clean = message?.trimmingCharacters(in: .whitespacesAndNewlines)
        let row = Row(user_id: user?.id.uuidString.lowercased(), user_email: user?.email, board_id: boardId,
                      message: (clean?.isEmpty ?? true) ? nil : clean, diagnostics: diagnostics,
                      screenshot: screenshot.map { "data:image/jpeg;base64,\($0.base64EncodedString())" })
        _ = try await SkewRetry.run {
            try await client.from("bug_reports").insert(row, returning: .minimal).execute()
        }
    }
}
