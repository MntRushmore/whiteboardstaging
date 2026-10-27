import Foundation

/// The admin routes (src/app/api/admin/**) for the iPad admin console. Admin-only on the server
/// (`requireAdmin`: a 404 for everyone else); the app shows the console only to admins as well.
public struct AdminService: Sendable {
    let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    public func overview() async throws -> AdminOverview { try await api.get("/api/admin/overview") }

    public func users() async throws -> AdminUserList { try await api.get("/api/admin/users") }

    public func user(_ id: String) async throws -> AdminUserDetail { try await api.get("/api/admin/users/\(id)") }

    /// Boards, newest first; `userId` one account's; `before` the next page.
    public func boards(userId: String? = nil, before: String? = nil) async throws -> AdminBoardList {
        var query: [URLQueryItem] = []
        if let userId { query.append(URLQueryItem(name: "userId", value: userId)) }
        if let before { query.append(URLQueryItem(name: "before", value: before)) }
        return try await api.get("/api/admin/boards", query: query)
    }

    public func board(_ id: String) async throws -> AdminBoardDoc { try await api.get("/api/admin/boards/\(id)") }

    public func boardAsk(_ id: String) async throws -> AdminAskChat { try await api.get("/api/admin/boards/\(id)/ask") }

    public func bugs() async throws -> AdminBugList { try await api.get("/api/admin/bugs") }

    /// A bug report's screenshot (image bytes).
    public func bugScreenshot(_ id: String) async throws -> Data {
        let (data, _) = try await api.perform(.get, "/api/admin/bugs/\(id)/screenshot")
        return data
    }

    /// Sets a report's status and/or note (the server answers the report).
    public func updateBug(_ id: String, status: String? = nil, note: String? = nil) async throws {
        struct Body: Encodable { var status: String?; var note: String? }
        let body = try APIClient.encoder.encode(Body(status: status, note: note))
        _ = try await api.perform(.patch, "/api/admin/bugs/\(id)", body: body)
    }

    /// A reply in a report's thread (the reporter sees it in the app, and is emailed).
    public func replyToBug(_ id: String, body: String) async throws {
        struct Body: Encodable { var body: String }
        _ = try await api.perform(.post, "/api/admin/bugs/\(id)/messages", body: try APIClient.encoder.encode(Body(body: body)))
    }

    /// Issues over the last `days` (1, 7 or 30).
    public func issues(days: Int = 7) async throws -> AdminIssueList {
        try await api.get("/api/admin/issues", query: [URLQueryItem(name: "days", value: String(days))])
    }

    /// The picture tutor's runs, newest first (one board's with `boardId`).
    public func runs(boardId: String? = nil, limit: Int = 150) async throws -> AdminRunList {
        var query = [URLQueryItem(name: "limit", value: String(limit))]
        if let boardId { query.append(URLQueryItem(name: "boardId", value: boardId)) }
        return try await api.get("/api/admin/runs", query: query)
    }
}
