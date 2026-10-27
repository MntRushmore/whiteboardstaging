import Foundation

// The admin console's answers (src/lib/admin/contracts.ts), as the iPad admin console reads them.
// Decoded leniently: a field the server adds or drops later never empties a screen (each type reads
// what it knows and defaults the rest).

private extension KeyedDecodingContainer {
    func v<T: Decodable>(_ key: Key, _ fallback: T) -> T { ((try? decodeIfPresent(T.self, forKey: key)) ?? nil) ?? fallback }
    func o<T: Decodable>(_ key: Key) -> T? { (try? decodeIfPresent(T.self, forKey: key)) ?? nil }
}

/// One app_events row (AdminEventSchema).
public struct AdminEvent: Decodable, Identifiable, Sendable, Hashable {
    public var id: Int
    public var at: String
    public var source: String
    public var level: String
    public var kind: String
    public var code: String?
    public var message: String
    public var route: String?
    public var userId: String?
    public var userEmail: String?
    public var boardId: String?
    public var requestId: String?
    public var meta: [String: JSONValue]
    public var release: String?
    public var noise: Bool

    enum K: String, CodingKey { case id, at, source, level, kind, code, message, route, userId, userEmail, boardId, requestId, meta, release, noise }
    public init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        id = c.v(.id, 0); at = c.v(.at, ""); source = c.v(.source, "server"); level = c.v(.level, "info"); kind = c.v(.kind, "")
        code = c.o(.code); message = c.v(.message, ""); route = c.o(.route); userId = c.o(.userId); userEmail = c.o(.userEmail)
        boardId = c.o(.boardId); requestId = c.o(.requestId); meta = c.v(.meta, [:]); release = c.o(.release); noise = c.v(.noise, false)
    }

    /// A number from `meta` (the picture tutor's timings, cost, alignment).
    public func number(_ key: String) -> Double? {
        if case .number(let n)? = meta[key] { return n }
        return nil
    }
    /// A word from `meta` (the picture tutor's mode, model).
    public func text(_ key: String) -> String? {
        switch meta[key] {
        case .string(let s)?: return s
        case .bool(let b)?: return b ? "true" : "false"
        case .number(let n)?: return n.rounded() == n ? String(Int(n)) : String(n)
        default: return nil
        }
    }
    public func flag(_ key: String) -> Bool { if case .bool(true)? = meta[key] { return true } else { return false } }
}

/// GET /api/admin/overview (AdminOverviewSchema): health, errors, people, money.
public struct AdminOverview: Decodable, Sendable {
    public struct Service: Decodable, Sendable, Hashable {
        public var service: String
        public var ok: Bool?
        public var lastCheckAt: String?
        public var latencyMs: Double?
        public var detail: String?
        public var uptime24h: Double?
        public var downSince: String?
    }
    public struct ErrorGroup: Decodable, Sendable, Hashable {
        public var kind: String
        public var code: String?
        public var source: String
        public var level: String
        public var message: String
        public var count: Int
        public var users: Int
        public var lastAt: String
    }
    public struct Errors: Decodable, Sendable {
        public var total24h: Int
        public var users24h: Int
        public var groups: [ErrorGroup]
    }
    public struct Users: Decodable, Sendable {
        public var total: Int
        public var signups24h: Int
        public var signups7d: Int
        public var active24h: Int
        public var active7d: Int
    }
    public struct Money: Decodable, Sendable {
        public var priceUsd: Double
        public var paying: Int
        public var payingCancelling: Int
        public var mrrUsd: Double
        public var trialing: Int
        public var trialsCancelling: Int
        public var pipelineUsd: Double
        public var failing: Int
        public var ended: Int
        public var trialsOver: Int
        public var trialsConverted: Int
        public var started7d: Int
    }
    public struct Funnel: Decodable, Sendable {
        public var accounts: Int
        public var onboarded: Int
        public var trials: Int
        public var paying: Int
    }
    public struct Learning: Decodable, Sendable {
        public var attempts24h: Int
        public var solvedAlone24h: Int
    }
    public struct OpenRouter: Decodable, Sendable {
        public var creditsLeftUsd: Double?
        public var usedUsd: Double?
    }
    public struct AIRoute: Decodable, Sendable, Hashable {
        public var route: String
        public var calls24h: Int
        public var failures24h: Int
        public var fallbacks24h: Int
    }
    public struct AI: Decodable, Sendable { public var routes: [AIRoute] }

    public var generatedAt: String
    public var services: [Service]
    public var openrouter: OpenRouter?
    public var errors: Errors
    public var ai: AI?
    public var users: Users
    public var money: Money?
    public var funnel: Funnel?
    public var learning: Learning?
}

/// One account (AdminUserRowSchema).
public struct AdminUserRow: Decodable, Identifiable, Sendable, Hashable {
    public var id: String
    public var email: String?
    public var name: String?
    public var course: String?
    public var createdAt: String
    public var onboardedAt: String?
    public var lastActiveAt: String?
    public var plan: String
    public var trialEndsAt: String?
    public var boards: Int
    public var attempts7d: Int
    public var solvedAlone7d: Int
    public var aiCalls7d: Int
    public var errors7d: Int
    public var bugReports: Int
    public var isAdmin: Bool

    enum K: String, CodingKey { case id, email, name, course, createdAt, onboardedAt, lastActiveAt, plan, trialEndsAt, boards, attempts7d, solvedAlone7d, aiCalls7d, errors7d, bugReports, isAdmin }
    public init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        id = try c.decode(String.self, forKey: .id)
        email = c.o(.email); name = c.o(.name); course = c.o(.course); createdAt = c.v(.createdAt, ""); onboardedAt = c.o(.onboardedAt)
        lastActiveAt = c.o(.lastActiveAt); plan = c.v(.plan, "none"); trialEndsAt = c.o(.trialEndsAt); boards = c.v(.boards, 0)
        attempts7d = c.v(.attempts7d, 0); solvedAlone7d = c.v(.solvedAlone7d, 0); aiCalls7d = c.v(.aiCalls7d, 0); errors7d = c.v(.errors7d, 0)
        bugReports = c.v(.bugReports, 0); isAdmin = c.v(.isAdmin, false)
    }
}

public struct AdminUserList: Decodable, Sendable {
    public var total: Int
    public var users: [AdminUserRow]
}

/// One board (AdminBoardRowSchema).
public struct AdminBoardRow: Decodable, Identifiable, Sendable, Hashable {
    public var id: String
    public var userId: String
    public var ownerEmail: String?
    public var ownerName: String?
    public var title: String?
    public var createdAt: String
    public var updatedAt: String
    /// an inline image data URL of the student's current screen
    public var preview: String?
    public var version: Int
    public var sizeKb: Int
    public var attempts: Int
    public var errors7d: Int

    enum K: String, CodingKey { case id, userId, ownerEmail, ownerName, title, createdAt, updatedAt, preview, version, sizeKb, attempts, errors7d }
    public init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        id = try c.decode(String.self, forKey: .id)
        userId = c.v(.userId, ""); ownerEmail = c.o(.ownerEmail); ownerName = c.o(.ownerName); title = c.o(.title)
        createdAt = c.v(.createdAt, ""); updatedAt = c.v(.updatedAt, ""); preview = c.o(.preview); version = c.v(.version, 0)
        sizeKb = c.v(.sizeKb, 0); attempts = c.v(.attempts, 0); errors7d = c.v(.errors7d, 0)
    }

    /// The preview's bytes (a data URL's base64).
    public var previewData: Data? {
        guard let preview, let comma = preview.firstIndex(of: ","), preview.hasPrefix("data:image/") else { return nil }
        return Data(base64Encoded: String(preview[preview.index(after: comma)...]))
    }
}

public struct AdminBoardList: Decodable, Sendable {
    public var boards: [AdminBoardRow]
    public var nextBefore: String?
}

/// One learning attempt (AdminAttemptSchema).
public struct AdminAttempt: Decodable, Identifiable, Sendable, Hashable {
    public var id: String
    public var boardId: String?
    public var problemLatex: String
    public var skill: String
    public var outcome: String
    public var hints: Int
    public var solves: Int
    public var startedAt: String
}

/// GET /api/admin/boards/<id> (AdminBoardDocSchema): the board's tldraw snapshot and what happened on it.
public struct AdminBoardDoc: Decodable, Sendable {
    public var board: AdminBoardRow
    public var snapshot: JSONValue
    public var snapshotSource: String?
    public var events: [AdminEvent]
    public var attempts: [AdminAttempt]
}

/// A bug report's thread message (BugMessageSchema).
public struct AdminBugMessage: Decodable, Identifiable, Sendable, Hashable {
    public var id: String
    public var author: String
    public var body: String
    public var at: String
}

/// One bug report (AdminBugSchema).
public struct AdminBug: Decodable, Identifiable, Sendable, Hashable {
    public struct LogLine: Decodable, Sendable, Hashable { public var level: String; public var time: String; public var text: String }
    public var id: String
    public var at: String
    public var userId: String?
    public var email: String?
    public var boardId: String?
    public var message: String
    public var path: String?
    public var status: String
    public var note: String?
    public var resolvedAt: String?
    public var hasScreenshot: Bool
    public var diagnostics: [String: JSONValue]
    public var logs: [LogLine]
    public var thread: [AdminBugMessage]
    public var waiting: Bool

    enum K: String, CodingKey { case id, at, userId, email, boardId, message, path, status, note, resolvedAt, hasScreenshot, diagnostics, logs, thread, waiting }
    public init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        id = try c.decode(String.self, forKey: .id)
        at = c.v(.at, ""); userId = c.o(.userId); email = c.o(.email); boardId = c.o(.boardId); message = c.v(.message, ""); path = c.o(.path)
        status = c.v(.status, "new"); note = c.o(.note); resolvedAt = c.o(.resolvedAt); hasScreenshot = c.v(.hasScreenshot, false)
        diagnostics = c.v(.diagnostics, [:]); logs = c.v(.logs, []); thread = c.v(.thread, []); waiting = c.v(.waiting, false)
    }

    public static let statuses = ["new", "seen", "fixed", "wontfix"]
}

public struct AdminBugList: Decodable, Sendable { public var bugs: [AdminBug] }

/// One issue (AdminIssueSchema): app_events that are the same problem.
public struct AdminIssue: Decodable, Identifiable, Sendable, Hashable {
    public var fingerprint: String
    public var kind: String
    public var code: String?
    public var source: String
    public var level: String
    public var message: String
    public var count: Int
    public var users: Int
    public var boards: Int
    public var firstAt: String
    public var lastAt: String
    public var perDay: [Int]
    public var status: String
    public var note: String?
    public var regressed: Bool
    public var noise: Bool
    public var samples: [AdminEvent]
    public var id: String { fingerprint }

    enum K: String, CodingKey { case fingerprint, kind, code, source, level, message, count, users, boards, firstAt, lastAt, perDay, status, note, regressed, noise, samples }
    public init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        fingerprint = try c.decode(String.self, forKey: .fingerprint)
        kind = c.v(.kind, ""); code = c.o(.code); source = c.v(.source, "server"); level = c.v(.level, "error"); message = c.v(.message, "")
        count = c.v(.count, 0); users = c.v(.users, 0); boards = c.v(.boards, 0); firstAt = c.v(.firstAt, ""); lastAt = c.v(.lastAt, "")
        perDay = c.v(.perDay, []); status = c.v(.status, "open"); note = c.o(.note); regressed = c.v(.regressed, false); noise = c.v(.noise, false)
        samples = c.v(.samples, [])
    }
}

public struct AdminIssueList: Decodable, Sendable {
    public var days: Int
    public var issues: [AdminIssue]
}

/// GET /api/admin/users/<id> (AdminUserDetailSchema): everything about one account.
public struct AdminUserDetail: Decodable, Sendable {
    public struct Subscription: Decodable, Sendable {
        public var status: String
        public var trialEnd: String?
        public var currentPeriodEnd: String?
        public var cancelAtPeriodEnd: Bool
        public var payerEmail: String?
    }
    public struct Learning: Decodable, Sendable {
        public struct Skill: Decodable, Sendable, Hashable { public var skill: String; public var attempts: Int; public var solvedAlone: Int }
        public var attempts: Int
        public var solvedAlone: Int
        public var withHelp: Int
        public var tutorSolved: Int
        public var activeMinutes: Int
        public var skills: [Skill]
        public var recent: [AdminAttempt]
    }
    public struct Day: Decodable, Sendable, Hashable { public var day: String; public var attempts: Int; public var aiCalls: Int; public var boards: Int }
    public var user: AdminUserRow
    public var subscription: Subscription?
    public var inkBalance: Int?
    public var boards: [AdminBoardRow]
    public var learning: Learning?
    public var activity: [Day]
    public var events: [AdminEvent]
    public var bugs: [AdminBug]
}

/// GET /api/admin/runs (AdminRunListSchema): the picture tutor's runs.
public struct AdminRunList: Decodable, Sendable { public var runs: [AdminEvent] }

/// GET /api/admin/boards/<id>/ask (AdminAskChatSchema): a board's Ask chat.
public struct AdminAskChat: Decodable, Sendable {
    public struct Turn: Decodable, Identifiable, Sendable, Hashable {
        public var id: String
        public var role: String
        public var text: String
        public var notes: [String]
        public var at: String
    }
    public var turns: [Turn]
}
