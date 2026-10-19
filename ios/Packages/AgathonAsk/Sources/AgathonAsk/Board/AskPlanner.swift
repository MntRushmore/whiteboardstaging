import AgathonBoard
import AgathonBrain
import Foundation

/// What running one action did on the board (`ChatActionOutcome`).
public struct AskActionOutcome: Codable, Hashable, Sendable {
    public var type: String
    public var ok: Bool
    /// a short note for the panel when something was left out
    public var note: String?
    /// why, for the report (`note_<type>_<why>`)
    public var why: String?

    public init(type: String, ok: Bool, note: String? = nil, why: String? = nil) {
        self.type = type
        self.ok = ok
        self.note = note
        self.why = why
    }
}

/// A reply's run on the board (`ChatRunReport`).
public struct AskRunReport: Codable, Hashable, Sendable {
    public var outcomes: [AskActionOutcome]
    public var problemsWritten: Int
    public var problemsDropped: Int
    public var screensAdded: Int

    public init(outcomes: [AskActionOutcome] = [], problemsWritten: Int = 0, problemsDropped: Int = 0, screensAdded: Int = 0) {
        self.outcomes = outcomes
        self.problemsWritten = problemsWritten
        self.problemsDropped = problemsDropped
        self.screensAdded = screensAdded
    }
}

/// A record on the screen as the brain's desk sees it (`BrainChatShape` in src/lib/brain/chat.ts).
public struct AskChatShape: Encodable, Hashable, Sendable {
    public var id: String
    public var type: String
    public var meta: Meta
    public var bounds: AgathonBrain.Rect?
    public var latex: String?

    public init(id: String, type: String, meta: Meta, bounds: AgathonBrain.Rect?, latex: String? = nil) {
        self.id = id
        self.type = type
        self.meta = meta
        self.bounds = bounds
        self.latex = latex
    }
}

/// One thing the app does for a reply's actions, in order (`ChatOp`).
public enum AskOp: Hashable, Sendable {
    case write(page: String, plan: HandPlan, meta: Meta)
    case typeset(page: String, latex: String, rect: AgathonBrain.Rect, meta: Meta)
    case addScreen(page: String)
    case clearTutor(page: String)
    case problemsChanged(page: String)
    case helpProblem(page: String, n: Int, depth: String)
    case helpBoard(page: String, depth: String)
    case pause(page: String, ms: Double)
    case metric(page: String, name: String)

    public var page: String {
        switch self {
        case .write(let p, _, _), .typeset(let p, _, _, _), .addScreen(let p), .clearTutor(let p), .problemsChanged(let p),
             .helpProblem(let p, _, _), .helpBoard(let p, _), .pause(let p, _), .metric(let p, _):
            return p
        }
    }
}

extension AskOp: Decodable {
    enum CodingKeys: String, CodingKey { case op, page, plan, meta, lead, latex, rect, n, depth, ms, name }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let page = try c.decode(String.self, forKey: .page)
        switch try c.decode(String.self, forKey: .op) {
        case "write":
            var meta = try c.decodeIfPresent(Meta.self, forKey: .meta) ?? [:]
            // a lead meta is said once on the web (a lecture's summary): the chat never sends one, and the
            // iPad's pen stamps one meta on a block, so it rides along
            for (k, v) in try c.decodeIfPresent(Meta.self, forKey: .lead) ?? [:] { meta[k] = v }
            self = .write(page: page, plan: try c.decode(HandPlan.self, forKey: .plan), meta: meta)
        case "typeset":
            self = .typeset(page: page, latex: try c.decode(String.self, forKey: .latex), rect: try c.decode(AgathonBrain.Rect.self, forKey: .rect),
                            meta: try c.decodeIfPresent(Meta.self, forKey: .meta) ?? [:])
        case "addScreen": self = .addScreen(page: page)
        case "clearTutor": self = .clearTutor(page: page)
        case "problemsChanged": self = .problemsChanged(page: page)
        case "helpProblem": self = .helpProblem(page: page, n: try c.decode(Int.self, forKey: .n), depth: try c.decode(String.self, forKey: .depth))
        case "helpBoard": self = .helpBoard(page: page, depth: try c.decode(String.self, forKey: .depth))
        case "pause": self = .pause(page: page, ms: try c.decode(Double.self, forKey: .ms))
        default: self = .metric(page: page, name: try c.decodeIfPresent(String.self, forKey: .name) ?? "")
        }
    }
}

/// The brain's plan for a reply (`ChatPlanResult`).
public struct AskPlan: Decodable, Hashable, Sendable {
    public var ops: [AskOp]
    public var report: AskRunReport
    /// each screen the run started (`new:n`) that carries the problems of the screen it came from
    public var carried: [String: AskScreenFrom]
    public var skipped: Int
    public var failed: String?
    /// the panel's words for each Help me outcome that wrote nothing (`HELP_BOARD_NOTES`)
    public var helpNotes: [String: String]
}

/// The arguments of a plan (`ChatPlanArgs`).
public struct AskPlanArgs: Encodable, Sendable {
    public var actions: [AgathonBrain.JSONValue]
    public var shapes: [AskChatShape]
    public var screen: AgathonBrain.Rect
    public var pageId: String
    public var screenIndex: Int?
    public var studentLines: [String]
    public var handwriting: Bool
    public var screensLeft: Int
    public var carried: [String: AskScreenFrom]

    public init(actions: [AgathonBrain.JSONValue], shapes: [AskChatShape], screen: AgathonBrain.Rect, pageId: String, screenIndex: Int?,
                studentLines: [String], handwriting: Bool, screensLeft: Int, carried: [String: AskScreenFrom]) {
        self.actions = actions
        self.shapes = shapes
        self.screen = screen
        self.pageId = pageId
        self.screenIndex = screenIndex
        self.studentLines = studentLines
        self.handwriting = handwriting
        self.screensLeft = screensLeft
        self.carried = carried
    }
}

public enum AskPlannerError: Error, Equatable {
    case unsettled
    case failed(String)
}

/// The brain's Ask methods (src/lib/brain/chat.ts, speech.ts) as typed calls. The brain is an actor:
/// every call is one hop, and a plan is two (`chatPlan` starts the web's desk on a copy of the
/// screen, `chatResult` reads it once the run has settled between the calls).
public enum AskBrain {
    static let encoder = JSONEncoder()
    static let decoder = JSONDecoder()

    /// The desk's plan for `actions` on the screen described in `args`.
    public static func plan(_ brain: Brain, _ args: AskPlanArgs) async throws -> AskPlan {
        try await brain.load()
        let json = String(decoding: try encoder.encode(args), as: UTF8.self)
        struct Ticket: Decodable { var ticket: Int }
        let ticket = try decoder.decode(Ticket.self, from: Data(try await brain.callJSON("chatPlan", args: json).utf8))
        struct Taken: Decodable { var done: Bool; var result: AskPlan?; var error: String? }
        let taken = try decoder.decode(Taken.self, from: Data(try await brain.callJSON("chatResult", args: "{\"ticket\":\(ticket.ticket)}").utf8))
        if let error = taken.error { throw AskPlannerError.failed(error) }
        guard taken.done, let result = taken.result else { throw AskPlannerError.unsettled }
        return result
    }

    /// What is on a screen as maths (`chatPicture`), for an ask's `screen`.
    public static func picture(_ brain: Brain, shapes: [AskChatShape], pageId: String, screenIndex: Int?, studentLines: [String],
                               carried: [String: AskScreenFrom]) async throws -> AskScreen {
        try await brain.load()
        struct Args: Encodable {
            var shapes: [AskChatShape]
            var pageId: String
            var screenIndex: Int?
            var studentLines: [String]
            var carried: [String: AskScreenFrom]
        }
        let json = String(decoding: try encoder.encode(Args(shapes: shapes, pageId: pageId, screenIndex: screenIndex, studentLines: studentLines, carried: carried)), as: UTF8.self)
        return try decoder.decode(AskScreen.self, from: Data(try await brain.callJSON("chatPicture", args: json).utf8))
    }

    public struct Sentence: Decodable, Hashable, Sendable {
        public var text: String
        public var words: String
        public var key: String
    }

    /// The whole sentences of `text` from `from`, each with its words to say (`speechTake`).
    public static func sentences(_ brain: Brain, text: String, from: Int, final: Bool) async throws -> (sentences: [Sentence], next: Int) {
        try await brain.load()
        struct Args: Encodable { var text: String; var from: Int; var final: Bool }
        struct Out: Decodable { var sentences: [Sentence]; var next: Int }
        let json = String(decoding: try encoder.encode(Args(text: text, from: from, final: final)), as: UTF8.self)
        let out = try decoder.decode(Out.self, from: Data(try await brain.callJSON("speechTake", args: json).utf8))
        return (out.sentences, out.next)
    }

    /// Words longer than a phrase, cut where a voice can breathe (`speechSplit`).
    public static func split(_ brain: Brain, words: String, max: Int) async throws -> [String] {
        try await brain.load()
        struct Args: Encodable { var words: String; var max: Int }
        return try decoder.decode([String].self, from: Data(try await brain.callJSON("speechSplit", args: String(decoding: try encoder.encode(Args(words: words, max: max)), as: UTF8.self)).utf8))
    }

    /// Words cut to what is left of a reply's characters (`speechFit`).
    public static func fit(_ brain: Brain, words: String, left: Int) async throws -> String {
        try await brain.load()
        struct Args: Encodable { var words: String; var left: Int }
        return try decoder.decode(String.self, from: Data(try await brain.callJSON("speechFit", args: String(decoding: try encoder.encode(Args(words: words, left: left)), as: UTF8.self)).utf8))
    }

    /// Any text the tutor shows (LaTeX and all) as words to say (`spokenText`).
    public static func spoken(_ brain: Brain, _ text: String) async throws -> String {
        try await brain.load()
        struct Args: Encodable { var text: String }
        return try decoder.decode(String.self, from: Data(try await brain.callJSON("spoken", args: String(decoding: try encoder.encode(Args(text: text)), as: UTF8.self)).utf8))
    }
}
