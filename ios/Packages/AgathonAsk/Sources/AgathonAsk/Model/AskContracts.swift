import AgathonKit
import Foundation

/// Ask's contract with the server (src/lib/live/ask/contracts.ts), as the app sends and reads it.
public enum AskPaths {
    public static let ask = "/api/live/ask"
    public static let history = "/api/live/ask/history"
    public static let move = "/api/live/ask/history/move"
    public static let memory = "/api/live/ask/memory"
    public static let transcribe = "/api/live/transcribe"
    public static let speak = "/api/live/speak"
}

/// `ASK_LIMITS`: what the route takes.
public enum AskLimits {
    public static let message = 1000
    public static let turns = 12
    public static let turnText = 2000
    public static let reply = 2400
    public static let imageChars = 700_000
    public static let storedTurns = 60
    public static let compressedAudioBytes = 1_200_000
    public static let audioSeconds = 60.0
    /// the saved chat (at most 60 turns) and this session's on top (`MAX_MESSAGES`)
    public static let messagesKept = 100
    /// `SPEAK_MAX_CHARS`
    public static let speakChars = 280
}

/// One turn of the chat so far (`AskTurnSchema`).
public struct AskTurn: Codable, Hashable, Sendable {
    public enum Role: String, Codable, Sendable { case user, tutor }
    public var role: Role
    public var text: String

    public init(role: Role, text: String) {
        self.role = role
        self.text = text
    }
}

/// The problems of the screen a tutor-started screen came from (`ChatScreen.from`).
public struct AskScreenFrom: Codable, Hashable, Sendable {
    public var screen: Int?
    public var problems: [String]
    public var numbers: [Int]?

    public init(screen: Int? = nil, problems: [String], numbers: [Int]? = nil) {
        self.screen = screen
        self.problems = problems
        self.numbers = numbers
    }
}

/// What is on the current screen, as maths (`ChatScreenSchema`, the brain's `chatPicture`), and
/// its picture (`AskScreenSchema.image`).
public struct AskScreen: Codable, Hashable, Sendable {
    public var empty: Bool
    public var student: [String]
    public var tutor: [String]
    public var problems: [String]
    public var numbers: [Int]?
    public var lecture: String?
    public var from: AskScreenFrom?
    /// a JPEG data URL of the screen (`captureAskImage`); nil: none
    public var image: String?

    public init(empty: Bool, student: [String] = [], tutor: [String] = [], problems: [String] = [], numbers: [Int]? = nil,
                lecture: String? = nil, from: AskScreenFrom? = nil, image: String? = nil) {
        self.empty = empty
        self.student = student
        self.tutor = tutor
        self.problems = problems
        self.numbers = numbers
        self.lecture = lecture
        self.from = from
        self.image = image
    }

    public static let blank = AskScreen(empty: true)

    enum CodingKeys: String, CodingKey { case empty, student, tutor, problems, numbers, lecture, from, image }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        empty = try c.decode(Bool.self, forKey: .empty)
        student = try c.decodeIfPresent([String].self, forKey: .student) ?? []
        tutor = try c.decodeIfPresent([String].self, forKey: .tutor) ?? []
        problems = try c.decodeIfPresent([String].self, forKey: .problems) ?? []
        numbers = try c.decodeIfPresent([Int].self, forKey: .numbers)
        lecture = try c.decodeIfPresent(String.self, forKey: .lecture)
        from = try c.decodeIfPresent(AskScreenFrom.self, forKey: .from)
        image = try c.decodeIfPresent(String.self, forKey: .image)
    }
}

/// POST /api/live/ask's body (`AskRequestSchema`).
public struct AskRequest: Encodable, Hashable, Sendable {
    public var boardId: String
    public var message: String
    public var history: [AskTurn]
    public var screen: AskScreen
    /// the last problem the student typed, when it has left `history`
    public var problem: String?
    /// the student's record (`LearnerHintSchema`), when the app has it
    public var learner: AgathonKit.JSONValue?
    /// said, not typed: the reply will be read aloud
    public var voice: Bool?
    /// the student's message id (a retry is saved once)
    public var clientId: String?
    /// the screen's id as the server knows screens (`page:…`)
    public var screenId: String?

    public init(boardId: String, message: String, history: [AskTurn], screen: AskScreen, problem: String? = nil,
                learner: AgathonKit.JSONValue? = nil, voice: Bool? = nil, clientId: String? = nil, screenId: String? = nil) {
        self.boardId = boardId
        self.message = message
        self.history = history
        self.screen = screen
        self.problem = problem
        self.learner = learner
        self.voice = voice
        self.clientId = clientId
        self.screenId = screenId
    }
}

/// A saved turn (`AskStoredTurnSchema`), oldest first.
public struct AskStoredTurn: Codable, Hashable, Sendable {
    public var id: String
    public var role: AskTurn.Role
    public var text: String
    public var notes: [String]
    public var wrote: [String]
    public var at: String
    public var screenId: String?

    public init(id: String, role: AskTurn.Role, text: String, notes: [String] = [], wrote: [String] = [], at: String = "", screenId: String? = nil) {
        self.id = id
        self.role = role
        self.text = text
        self.notes = notes
        self.wrote = wrote
        self.at = at
        self.screenId = screenId
    }

    enum CodingKeys: String, CodingKey { case id, role, text, notes, wrote, at, screenId }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        role = try c.decode(AskTurn.Role.self, forKey: .role)
        text = try c.decode(String.self, forKey: .text)
        notes = try c.decodeIfPresent([String].self, forKey: .notes) ?? []
        wrote = try c.decodeIfPresent([String].self, forKey: .wrote) ?? []
        at = try c.decodeIfPresent(String.self, forKey: .at) ?? ""
        screenId = try c.decodeIfPresent(String.self, forKey: .screenId)
    }
}

/// The tutor's own hello for a board or screen with no chat yet (`AskHelloSchema`).
public struct AskHello: Codable, Hashable, Sendable {
    public var greeting: String
    public var chips: [String]

    public init(greeting: String, chips: [String]) {
        self.greeting = greeting
        self.chips = chips
    }
}

/// GET /api/live/ask/history (`AskHistoryResponseSchema`).
public struct AskHistoryResponse: Codable, Hashable, Sendable {
    public var turns: [AskStoredTurn]
    public var hello: AskHello?

    public init(turns: [AskStoredTurn], hello: AskHello?) {
        self.turns = turns
        self.hello = hello
    }
}

/// Which screen's saved chat to read: its id, and whether it is the board's first (its turns saved
/// without a screen are). `HistoryScreen` in useBoardChat.ts.
public struct AskHistoryScreen: Hashable, Sendable {
    public var id: String
    public var first: Bool

    public init(id: String, first: Bool) {
        self.id = id
        self.first = first
    }
}

/// POST /api/live/transcribe's answer (`TranscribeResponseSchema`).
public struct TranscribeResponse: Codable, Hashable, Sendable {
    public var text: String
    public var source: String
}
