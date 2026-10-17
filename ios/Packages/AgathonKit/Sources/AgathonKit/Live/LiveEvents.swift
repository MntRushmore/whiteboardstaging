import Foundation

/// An `error` event inside a stream: Ask's `{ code, message, status }`, or check/solve's
/// `{ error, message }` (src/lib/server/live-route.ts `sseErrorPayload`).
public struct StreamError: Sendable, Equatable, Error {
    public let code: String
    public let message: String
    public let status: Int?

    public init(code: String, message: String, status: Int? = nil) {
        self.code = code
        self.message = message
        self.status = status
    }
}

// MARK: - Ask (POST /api/live/ask)

/// Ask's events, in order (src/lib/live/ask/contracts.ts `ASK_EVENTS`): `model` (again if the
/// fallback takes over), `delta`* (the reply as written), `reply` (the reply as finally shown),
/// `actions` (once), `done`. Or `error` at any point, after which nothing else comes.
public enum AskEvent: Sendable, Equatable {
    case model(String)
    case delta(String)
    case reply(String)
    case actions(AskActions)
    case done(AskDone)
    case error(StreamError)

    public var isTerminal: Bool {
        switch self {
        case .done, .error: return true
        default: return false
        }
    }

    /// The event a frame carries, or nil for one this app does not know or that does not parse
    /// (skipped, as the web does). A `done` or `error` that does not parse still ends the stream.
    public static func decode(_ frame: SSEFrame) -> AskEvent? {
        let json = JSONValue.parse(Data(frame.data.utf8))
        switch frame.event {
        case "model":
            return json?["model"]?.stringValue.map(AskEvent.model)
        case "delta":
            guard let text = json?["text"]?.stringValue, !text.isEmpty else { return nil }
            return .delta(text)
        case "reply":
            return json?["text"]?.stringValue.map(AskEvent.reply)
        case "actions":
            guard let actions = json?["actions"]?.arrayValue else { return nil }
            let notes = json?["notes"]?.arrayValue?.compactMap(\.stringValue) ?? []
            return .actions(AskActions(actions: actions, notes: notes))
        case "done":
            return .done(AskDone(json: json))
        case "error":
            guard let code = json?["code"]?.stringValue, let message = json?["message"]?.stringValue else {
                return .error(StreamError(code: "upstream", message: "The tutor ran into a problem"))
            }
            return .error(StreamError(code: code, message: message, status: json?["status"]?.intValue))
        default:
            return nil
        }
    }
}

/// What the tutor writes on the board. The actions stay raw JSON (`ChatAction`,
/// src/lib/live/chat/contracts.ts) until the board lane models them.
public struct AskActions: Sendable, Equatable {
    public let actions: [JSONValue]
    /// What was left out, in words for the panel.
    public let notes: [String]

    public init(actions: [JSONValue], notes: [String]) {
        self.actions = actions
        self.notes = notes
    }
}

public struct AskDone: Sendable, Equatable {
    public let model: String
    public let ms: Double
    /// Every proposed action was dropped and the ink given back.
    public let refunded: Bool
    /// The saved tutor turn's id (absent when saving failed).
    public let turnId: String?
    /// The saved student turn's id.
    public let userTurnId: String?

    public init(model: String, ms: Double, refunded: Bool = false, turnId: String? = nil, userTurnId: String? = nil) {
        self.model = model
        self.ms = ms
        self.refunded = refunded
        self.turnId = turnId
        self.userTurnId = userTurnId
    }

    init(json: JSONValue?) {
        self.init(
            model: json?["model"]?.stringValue ?? "",
            ms: json?["ms"]?.doubleValue ?? 0,
            refunded: json?["refunded"]?.boolValue ?? false,
            turnId: json?["turnId"]?.stringValue,
            userTurnId: json?["userTurnId"]?.stringValue
        )
    }
}

// MARK: - Check and Solve (POST /api/live/check, /api/live/solve)

/// The check and solve streams' events (src/lib/live/contracts.ts `LiveSseEvent`): `meta` (the
/// request and the model; again when a fallback takes over), `annotation`* (check) or `step`*
/// (solve), then `done` or `error`.
public enum LiveEvent: Sendable, Equatable {
    case meta(requestId: String, model: String)
    case annotation(Annotation)
    case step(SolveStep)
    case done(count: Int, ms: Double)
    case error(StreamError)

    public var isTerminal: Bool {
        switch self {
        case .done, .error: return true
        default: return false
        }
    }

    /// The event a frame carries; nil for an unknown event or one that does not parse (the web's
    /// `toLiveSseEvent` drops those too).
    public static func decode(_ frame: SSEFrame) -> LiveEvent? {
        let data = Data(frame.data.utf8)
        let json = JSONValue.parse(data)
        switch frame.event {
        case "meta":
            guard let requestId = json?["requestId"]?.stringValue, let model = json?["model"]?.stringValue else { return nil }
            return .meta(requestId: requestId, model: model)
        case "annotation":
            return (try? JSONDecoder().decode(Annotation.self, from: data)).map(LiveEvent.annotation)
        case "step":
            return (try? JSONDecoder().decode(SolveStep.self, from: data)).map(LiveEvent.step)
        case "done":
            guard let count = json?["count"]?.intValue, let ms = json?["ms"]?.doubleValue else { return nil }
            return .done(count: count, ms: ms)
        case "error":
            guard let code = json?["error"]?.stringValue, let message = json?["message"]?.stringValue else { return nil }
            return .error(StreamError(code: code, message: message))
        default:
            return nil
        }
    }
}

/// One note from Check on the student's work (`AnnotationSchema`).
public struct Annotation: Sendable, Equatable, Codable {
    public enum Verdict: String, Sendable, Codable { case ok, warn, info }

    public let lineId: String?
    public let verdict: Verdict
    /// arithmetic, sign, algebra, units, concept, notation, incomplete, praise
    public let kind: String
    public let message: String
    public let question: String?
    public let latex: String?
    /// mathjs expression the line's right side should equal (verified locally before display)
    public let expected: String?
    public let confidence: Double

    enum CodingKeys: String, CodingKey {
        case lineId, verdict, kind, message, question, latex, expected, confidence
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        lineId = try c.decodeIfPresent(String.self, forKey: .lineId)
        verdict = try c.decode(Verdict.self, forKey: .verdict)
        kind = try c.decode(String.self, forKey: .kind)
        message = try c.decode(String.self, forKey: .message)
        question = try c.decodeIfPresent(String.self, forKey: .question)
        latex = try c.decodeIfPresent(String.self, forKey: .latex)
        expected = try c.decodeIfPresent(String.self, forKey: .expected)
        confidence = try c.decodeIfPresent(Double.self, forKey: .confidence) ?? 0.8
        guard !message.isEmpty else {
            throw DecodingError.dataCorruptedError(forKey: .message, in: c, debugDescription: "empty message")
        }
    }
}

/// One step of a worked solution (`SolveStepSchema`).
public struct SolveStep: Sendable, Equatable, Codable {
    public let index: Int
    public let latex: String
    public let explanation: String
    public let final: Bool
}

// MARK: - The streaming routes

/// The tutor's streaming routes. Request bodies are anything Encodable for now: the board and brain
/// lanes model them (`AskRequestSchema`, `CheckRequestSchema`, `SolveRequestSchema`).
public final class LiveAPI: Sendable {
    public static let askPath = "/api/live/ask"
    public static let checkPath = "/api/live/check"
    public static let solvePath = "/api/live/solve"

    /// ASK_IDLE_TIMEOUT_MS: the route pings while the model thinks, so 30 s of silence is a stall.
    public static let askStallTimeout: Duration = .seconds(30)
    /// SSE_IDLE_TIMEOUT_MS: check and solve ping every 15 s.
    public static let liveStallTimeout: Duration = .seconds(45)

    public let sse: SSEClient

    public init(sse: SSEClient) {
        self.sse = sse
    }

    /// One ask, streamed. Ends after `done` or `error`; a stream that closes before either throws
    /// `APIError.incomplete` (the answer was cut off).
    public func ask(_ body: some Encodable, stallTimeout: Duration = LiveAPI.askStallTimeout) throws -> ServerEvents<AskEvent> {
        let data = try APIClient.encoder.encode(body)
        return sse.events(path: Self.askPath, body: data, stallTimeout: stallTimeout, requireTerminal: true,
                          decode: { AskEvent.decode($0) }, isTerminal: { $0.isTerminal })
    }

    /// Check the student's lines: `meta`, `annotation`*, `done`.
    public func check(_ body: some Encodable, stallTimeout: Duration = LiveAPI.liveStallTimeout) throws -> ServerEvents<LiveEvent> {
        let data = try APIClient.encoder.encode(body)
        return sse.events(path: Self.checkPath, body: data, stallTimeout: stallTimeout, requireTerminal: false,
                          decode: { LiveEvent.decode($0) }, isTerminal: { $0.isTerminal })
    }

    /// A worked solution: `meta`, `step`*, `done`.
    public func solve(_ body: some Encodable, stallTimeout: Duration = LiveAPI.liveStallTimeout) throws -> ServerEvents<LiveEvent> {
        let data = try APIClient.encoder.encode(body)
        return sse.events(path: Self.solvePath, body: data, stallTimeout: stallTimeout, requireTerminal: false,
                          decode: { LiveEvent.decode($0) }, isTerminal: { $0.isTerminal })
    }
}
