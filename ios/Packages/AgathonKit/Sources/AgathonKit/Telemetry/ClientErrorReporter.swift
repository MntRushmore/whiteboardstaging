import Foundation

/// One report for POST /api/client-errors (ReportSchema in src/app/api/client-errors/route.ts):
/// a crash, or an error the student saw (`kind` set). Never board content or anything the student
/// wrote or typed: our own words, the screen's path, ids.
public struct ClientErrorReport: Sendable, Equatable, Encodable {
    /// The iPad app's reports: `ios`.
    public let source: String
    public let message: String
    public let stack: String?
    /// The screen, as a path starting with "/" (`/boards`, `/board/<id>`), no query.
    public let path: String
    public let boardId: String?
    public let userAgent: String
    /// `ios-<version>-<build>`.
    public let release: String
    /// What failed (`live.boards`, `live.auth`… the EVENT_KIND conventions); nil for a crash.
    public let kind: String?
    /// `error`, `warn` or `info` (out of ink is info, a rate limit warn).
    public let level: String?
    public let code: String?
    /// The failed request's X-Request-Id.
    public let requestId: String?
    public let vercelError: String?
}

/// Sends errors to the server's log and the admin page (src/lib/clientErrors.ts, for the app):
/// fire and forget, never throws, at most `maxReports` per launch, and the same kind + code +
/// message only once per `window`. Signed in, the request carries the token so the server can say
/// who it was.
public actor ClientErrorReporter {
    public static let path = "/api/client-errors"
    public static let source = "ios"

    public enum Level: String, Sendable { case error, warn, info }

    let api: APIClient
    let release: AppRelease
    let maxReports: Int
    let window: TimeInterval
    let now: @Sendable () -> Date
    private var sent = 0
    private var lastSent: [String: Date] = [:]

    public init(
        api: APIClient,
        release: AppRelease,
        maxReports: Int = 30,
        window: TimeInterval = 60,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.api = api
        self.release = release
        self.maxReports = maxReports
        self.window = window
        self.now = now
    }

    /// An error the student saw.
    @discardableResult
    public func reportUserError(
        kind: String,
        code: String? = nil,
        message: String,
        level: Level = .error,
        path: String,
        boardId: String? = nil,
        error: Error? = nil
    ) async -> Bool {
        let failure = (error as? APIError)?.failure
        let report = makeReport(message: message, stack: nil, path: path, boardId: boardId, kind: kind, level: level,
                                code: code, requestId: failure?.requestId, vercelError: failure?.vercelError)
        return await send(report)
    }

    /// Something that went wrong in the app itself (no `kind`: the admin page files it as a crash).
    @discardableResult
    public func reportCrash(message: String, stack: String? = nil, path: String, boardId: String? = nil) async -> Bool {
        await send(makeReport(message: message, stack: stack, path: path, boardId: boardId, kind: nil, level: nil,
                              code: nil, requestId: nil, vercelError: nil))
    }

    /// The report as it would be sent: every field cut to the server's limits, anything that would
    /// not pass its checks left out.
    public nonisolated func makeReport(
        message: String,
        stack: String?,
        path: String,
        boardId: String?,
        kind: String?,
        level: Level?,
        code: String?,
        requestId: String?,
        vercelError: String?
    ) -> ClientErrorReport {
        let message = message.trimmingCharacters(in: .whitespacesAndNewlines)
        return ClientErrorReport(
            source: Self.source,
            message: String((message.isEmpty ? "Unknown error" : message).prefix(1000)),
            stack: stack.map { String($0.prefix(4000)) },
            path: Self.cleanPath(path),
            boardId: boardId.flatMap { Self.matches($0, "^[0-9a-fA-F-]{36}$") ? $0 : nil },
            userAgent: String(release.userAgent.prefix(512)),
            release: release.string,
            kind: kind.flatMap { Self.matches($0, "^[a-z0-9][a-z0-9_.:-]{0,63}$") ? $0 : nil },
            level: level?.rawValue,
            code: code.map { String($0.prefix(40)) },
            requestId: requestId.flatMap { Self.matches($0, HTTPFailure.requestIdPattern) ? $0 : nil },
            vercelError: vercelError.flatMap { Self.matches($0, HTTPFailure.vercelErrorPattern) ? $0 : nil }
        )
    }

    /// Sends one report unless it is a repeat inside the window or the launch's budget is spent.
    @discardableResult
    public func send(_ report: ClientErrorReport) async -> Bool {
        let key = "\(report.kind ?? "crash")|\(report.code ?? "")|\(report.message)"
        let at = now()
        if let last = lastSent[key], at.timeIntervalSince(last) < window { return false }
        guard sent < maxReports else { return false }
        sent += 1
        lastSent[key] = at
        do {
            _ = try await api.send(.post, Self.path, body: report, as: EmptyResponse.self, auth: .optional)
            return true
        } catch {
            return false
        }
    }

    /// A path the server accepts: starts with "/", no query or fragment, at most 512 characters.
    static func cleanPath(_ path: String) -> String {
        var clean = path.trimmingCharacters(in: .whitespacesAndNewlines)
        if let cut = clean.firstIndex(where: { $0 == "?" || $0 == "#" }) { clean = String(clean[..<cut]) }
        if !clean.hasPrefix("/") { clean = "/" + clean }
        return String(clean.prefix(512))
    }

    static func matches(_ value: String, _ pattern: String) -> Bool {
        value.range(of: pattern, options: .regularExpression) != nil
    }
}
