import AgathonKit
import Foundation

/// The panel's words. A 7-year-old reads them: short, kind, US English (`CHAT_COPY` in
/// src/components/chat/chatView.ts, with the iPad's kid rules: no prices, out of ink goes to a grown-up).
public enum AskCopy {
    public static let title = "Ask your tutor"
    public static let button = "Ask"
    public static let close = "Close"
    /// the hello when the tutor has nothing of its own to say yet
    public static let hello = "Hi! I'm your tutor. Ask me anything, and I can write on your board too."
    /// the same on a screen after the first
    public static let newScreen = "New screen! What should we work on?"
    public static func screen(_ n: Int) -> String { "Screen \(n)" }
    public static func screenHint(_ n: Int) -> String { "This chat is for screen \(n)" }
    public static let placeholder = "Ask me anything…"
    public static let placeholderShort = "Ask me…"
    public static let send = "Send"
    public static let stop = "Stop"
    public static let stopped = "Stopped."
    /// the board's writing finished and the reply had no words of its own
    public static let done = "Done! Take a look at your board."
    /// the stream ended with no words and nothing to write
    public static let empty = "Hmm, I'm not sure. Can you ask me another way?"
    /// the connection dropped after the board had started writing
    public static let cutOff = "The internet cut out, but your board is done."
    public static let thinking = "Thinking…"
    public static let writing = "Writing on your board…"
    public static let retry = "Try again"
    public static let speakerOn = "Read answers out loud"
    public static let speakerOff = "Stop reading answers out loud"
    public static let replay = "Read it again"
    public static let grow = "Make the chat bigger"
    public static let shrink = "Make the chat smaller"
    public static let you = "You"
    public static let tutor = "Tutor"
    /// said once, right after the panel's speaker is switched on
    public static let turnedOn = "Okay. I'll read my answers out loud."

    public enum Errors {
        /// Out of ink: kids never see prices or plans; a grown-up sorts it (docs/DESIGN-SYSTEM.md).
        public static let ink = "Help is paused. Ask a grown-up to switch it back on."
        public static func rateLimited(_ seconds: Int) -> String { "That's a lot of questions. Try again in \(waitPhrase(seconds))." }
        public static let unauthorized = "Please sign in again."
        public static let network = "Couldn't reach your tutor. Check the internet."
        public static let timeout = "Your tutor took too long to answer."
        public static let resting = "Your tutor is taking a break. Try again in a few minutes."
        public static let other = "Oops! Something went wrong."
        public static let board = "The board isn't ready yet. Try again in a moment."
    }

    /// `waitPhrase` (src/components/live/copy.ts).
    public static func waitPhrase(_ seconds: Int) -> String {
        let s = max(1, seconds)
        if s < 90 { return "\(s) s" }
        let min = Int((Double(s) / 60).rounded())
        if min < 90 { return "\(min) min" }
        return "about \(Int((Double(min) / 60).rounded())) hours"
    }
}

/// "3 more like these": the first chip whenever the screen has work on it.
public let moreLikeTheseChip = "3 more like these"

/// A grade band of first asks: K–2, 3–5, 6–8, and high school (or a grade not known).
public enum GradeBand: String, Sendable {
    case k2, g35, g68, hs

    public init(grade: Int?) {
        guard let grade else { self = .hs; return }
        if grade <= 2 { self = .k2 } else if grade <= 5 { self = .g35 } else if grade <= 8 { self = .g68 } else { self = .hs }
    }

    /// First asks for a board with no chat and no hello of the tutor's own.
    public var suggestions: [String] {
        switch self {
        case .k2: return ["5 adding problems", "What is half of 10?", "Why is the sky blue?"]
        case .g35: return ["5 times-table problems", "How do I add fractions?", "How do plants eat?"]
        case .g68: return ["5 two-step equations", "What is a ratio?", "What causes the seasons?"]
        case .hs: return ["5 two-step equations", "Graph y = x² − 4x + 3", "Help me start an essay"]
        }
    }
}

/// The screen a chat is for: the server's id for it (`page:…`; nil: one chat for the board) and its number from 1.
public struct AskScreenRef: Hashable, Sendable {
    public var id: String?
    public var index: Int?

    public init(id: String?, index: Int?) {
        self.id = id
        self.index = index
    }

    public static let none = AskScreenRef(id: nil, index: nil)

    /// The history route's query for it (none: the whole board's chat).
    public var historyScreen: AskHistoryScreen? {
        id.map { AskHistoryScreen(id: $0, first: (index ?? 1) == 1) }
    }
}

/// A failure as the panel shows it.
public struct ChatError: Hashable, Sendable {
    public enum Kind: String, Sendable { case ink, rateLimited = "rate_limited", unauthorized, network, timeout, other }
    public var kind: Kind
    public var message: String
    /// Try again is offered for everything but running out of ink and being signed out
    public var retry: Bool

    public init(kind: Kind, message: String, retry: Bool) {
        self.kind = kind
        self.message = message
        self.retry = retry
    }
}

/// A tutor message's life: waiting for the first word, words arriving, its board actions being
/// written, finished (also after a Stop), or failed.
public enum TutorState: String, Hashable, Sendable {
    case thinking, streaming, writing, done, error
}

/// One message in a thread (`ChatMessage` in chatView.ts).
public struct ChatMessage: Identifiable, Hashable, Sendable {
    public enum Role: String, Sendable { case user, tutor }

    public var id: String
    public var role: Role
    public var text: String
    public var notes: [String] = []
    public var state: TutorState?
    public var error: ChatError?
    /// a failed tutor message: the request to send again
    public var retryText: String?
    /// a user message: its id for the route (a retry sends the same one)
    public var clientId: String?
    /// a user message said into the mic
    public var voice = false
    /// a tutor message the student stopped
    public var stopped = false
    /// loaded from the saved chat
    public var saved = false
    /// a finished tutor message: its saved turn's id
    public var turnId: String?

    public init(id: String, role: Role, text: String, notes: [String] = [], state: TutorState? = nil, error: ChatError? = nil,
                retryText: String? = nil, clientId: String? = nil, voice: Bool = false, stopped: Bool = false, saved: Bool = false, turnId: String? = nil) {
        self.id = id
        self.role = role
        self.text = text
        self.notes = notes
        self.state = state
        self.error = error
        self.retryText = retryText
        self.clientId = clientId
        self.voice = voice
        self.stopped = stopped
        self.saved = saved
        self.turnId = turnId
    }
}

/// Pure view logic for the panel (chatView.ts), unit-tested in ChatViewTests.
public enum ChatView {
    public static let maxChips = 4
    public static let weakSpotsChip = "Practice my weak spots"

    /// The hello a thread with no chat opens on: the tutor's own with its chips, else a friendly
    /// default with the grade's suggestions; "3 more like these" first when the screen has work.
    public static func hello(_ own: AskHello?, grade: Int?, screenHasWork: Bool, screenIndex: Int?) -> AskHello {
        let mine = own.flatMap { $0.greeting.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 }
        let base = mine.map { $0.chips.isEmpty ? GradeBand(grade: grade).suggestions : $0.chips } ?? GradeBand(grade: grade).suggestions
        let rest = screenHasWork ? base.filter { $0.range(of: #"\bmore (like|on)\b"#, options: [.regularExpression, .caseInsensitive]) == nil } : base
        var chips: [String] = []
        for c in (screenHasWork ? [moreLikeTheseChip] : []) + rest {
            let t = c.trimmingCharacters(in: .whitespacesAndNewlines)
            if !t.isEmpty, !chips.contains(t) { chips.append(t) }
        }
        let later = (screenIndex ?? 1) > 1
        return AskHello(greeting: mine?.greeting ?? (later ? AskCopy.newScreen : AskCopy.hello), chips: Array(chips.prefix(maxChips)))
    }

    /// A thread's key: the board's, and the screen's when the board says which.
    public static func threadKey(_ boardId: String, _ screenId: String?) -> String {
        screenId.map { "\(boardId)#\($0)" } ?? boardId
    }

    /// An exchange moving to another screen's thread: its messages leave `from` and go after `to`'s.
    public static func moveExchange(from: [ChatMessage], to: [ChatMessage], ids: Set<String>) -> (from: [ChatMessage], to: [ChatMessage]) {
        let taken = from.filter { ids.contains($0.id) }
        return (from.filter { !ids.contains($0.id) }, to.filter { !ids.contains($0.id) } + taken)
    }

    /// The chat so far as the route wants it: finished turns only, each at most `turnText`, newest
    /// last, at most `turns`; a question with no answer is not part of it.
    public static func history(_ messages: [ChatMessage]) -> [AskTurn] {
        var turns: [AskTurn] = []
        for m in messages {
            if m.role == .tutor && m.state != .done && m.state != .writing { continue }
            if m.role == .tutor && m.stopped && m.text == AskCopy.stopped { continue }
            let text = String(m.text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(AskLimits.turnText)).trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty { turns.append(AskTurn(role: m.role == .user ? .user : .tutor, text: text)) }
        }
        var out: [AskTurn] = []
        for (i, t) in turns.enumerated() {
            if t.role == .user && (i + 1 >= turns.count || turns[i + 1].role != .tutor) { continue }
            out.append(t)
        }
        return Array(out.suffix(AskLimits.turns))
    }

    /// The last problem the student typed, when the turns sent no longer hold it (`problemFor`).
    public static func problem(_ messages: [ChatMessage], sent: [AskTurn]) -> String? {
        for m in messages.reversed() {
            let t = m.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard m.role == .user, t.count >= 24,
                  t.range(of: #"[\d=²√^+×÷∠°π]"#, options: .regularExpression) != nil,
                  t.range(of: #"[?=]|\b(what|find|solve|how (many|much|long|far)|calculate|compute|evaluate|simplify|determine|prove)\b"#, options: [.regularExpression, .caseInsensitive]) != nil
            else { continue }
            if t.range(of: #"^\s*(\d+|a few|some)\s+(more\s+)?[\w-]+(\s+[\w-]+)?\s+(problems?|equations?|questions?)\b"#, options: [.regularExpression, .caseInsensitive]) != nil { continue }
            let capped = String(t.prefix(AskLimits.turnText)).trimmingCharacters(in: .whitespacesAndNewlines)
            return sent.contains { $0.role == .user && $0.text == capped } ? nil : String(t.prefix(600))
        }
        return nil
    }

    /// The saved chat as messages (oldest first): finished turns, their notes kept.
    public static func messages(fromHistory turns: [AskStoredTurn]) -> [ChatMessage] {
        turns.filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }.map { t in
            t.role == .user
                ? ChatMessage(id: "saved_\(t.id)", role: .user, text: t.text, saved: true)
                : ChatMessage(id: "saved_\(t.id)", role: .tutor, text: t.text, notes: t.notes, state: .done, saved: true)
        }
    }

    /// The saved chat merged with what this session holds: saved first, never an exchange twice
    /// (`mergeSavedChat`).
    public static func mergeSaved(_ saved: [ChatMessage], into cur: [ChatMessage]) -> [ChatMessage] {
        if saved.isEmpty || cur.contains(where: \.saved) { return cur }
        if cur.isEmpty { return saved }
        let ids = Set(cur.compactMap { $0.role == .tutor ? $0.turnId.map { "saved_\($0)" } : nil })
        func key(_ a: String, _ b: String) -> String { a.trimmingCharacters(in: .whitespacesAndNewlines) + "\u{0}" + b.trimmingCharacters(in: .whitespacesAndNewlines) }
        var unsaved = Set<String>()
        if cur.count > 1 {
            for i in 1..<cur.count {
                let asked = cur[i - 1], answer = cur[i]
                if asked.role == .user, answer.role == .tutor, answer.turnId == nil, !answer.stopped, answer.state == .done || answer.state == .writing {
                    unsaved.insert(key(asked.text, answer.text))
                }
            }
        }
        func startOf(_ i: Int) -> Int { i > 0 && saved[i - 1].role == .user ? i - 1 : i }
        var cut = saved.count
        for (i, m) in saved.enumerated() where m.role == .tutor && ids.contains(m.id) { cut = min(cut, startOf(i)) }
        for k in unsaved {
            var i = saved.count - 1
            while i > 0 {
                if saved[i].role == .tutor, saved[i - 1].role == .user, key(saved[i - 1].text, saved[i].text) == k {
                    cut = min(cut, i - 1)
                    break
                }
                i -= 1
            }
        }
        return Array(saved.prefix(cut)) + cur
    }

    /// The reply as shown while it streams: never the board block, nor the start of its tag at the end.
    public static func shownReply(_ text: String) -> String {
        let open = "<board>"
        let cut = text.range(of: open).map { String(text[..<$0.lowerBound]) } ?? text
        return String(cut.dropLast(partialSuffix(cut, open)))
    }

    /// How many characters at the end of `text` could be the start of `tag` (splitter.ts).
    public static func partialSuffix(_ text: String, _ tag: String) -> Int {
        let chars = Array(text)
        let maxN = min(chars.count, tag.count - 1)
        guard maxN > 0 else { return 0 }
        for n in stride(from: maxN, to: 0, by: -1) where tag.hasPrefix(String(chars.suffix(n))) {
            return n
        }
        return 0
    }

    /// The board's notes on a run, each once.
    public static func runNotes(_ report: AskRunReport?) -> [String] {
        var out: [String] = []
        for n in report?.outcomes.compactMap(\.note) ?? [] where !out.contains(n) { out.append(n) }
        return out
    }

    /// What Try again sends: the failed ask's words, the chat without it and its error, its id and voice.
    public static func retry(_ messages: [ChatMessage], id: String) -> (text: String, prior: [ChatMessage], voice: Bool, clientId: String?)? {
        guard let i = messages.firstIndex(where: { $0.id == id }), let text = messages[i].retryText else { return nil }
        let asked: ChatMessage? = i > 0 && messages[i - 1].role == .user ? messages[i - 1] : nil
        let start = asked == nil ? i : i - 1
        return (text, Array(messages[..<start]) + Array(messages[(i + 1)...]), asked?.voice ?? false, asked?.clientId)
    }

    /// Stop is offered while words can still come (not while the board is being written).
    public static func canStop(_ messages: [ChatMessage]) -> Bool {
        guard let last = messages.last, last.role == .tutor else { return false }
        return last.state == .thinking || last.state == .streaming
    }

    /// Words said into the mic: sent as said, or — the tutor still answering — put in the box.
    public static func spokenWords(busy: Bool, draft: String, said: String) -> (send: String?, draft: String) {
        let s = said.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { return (nil, draft) }
        if !busy { return (s, draft) }
        let typed = draft.replacingOccurrences(of: #"\s+$"#, with: "", options: .regularExpression)
        return (nil, String((typed.isEmpty ? s : "\(typed) \(s)").prefix(AskLimits.message)))
    }

    /// A failure of the ask as the panel shows it (`chatErrorFor`).
    public static func error(for error: Error) -> ChatError {
        if let api = error as? APIError {
            switch api {
            case .http(let f):
                if f.isOutOfInk { return ChatError(kind: .ink, message: AskCopy.Errors.ink, retry: false) }
                if f.isRateLimited { return rateLimited(f.retryAfterMs) }
                if f.isUnauthorized { return ChatError(kind: .unauthorized, message: AskCopy.Errors.unauthorized, retry: false) }
                return ChatError(kind: .other, message: AskCopy.Errors.other, retry: true)
            case .notSignedIn:
                return ChatError(kind: .unauthorized, message: AskCopy.Errors.unauthorized, retry: false)
            case .timeout:
                return ChatError(kind: .timeout, message: AskCopy.Errors.timeout, retry: true)
            case .network:
                return ChatError(kind: .network, message: AskCopy.Errors.network, retry: true)
            case .incomplete, .invalidResponse:
                return ChatError(kind: .other, message: AskCopy.Errors.other, retry: true)
            }
        }
        // an `error` event once the answer was streaming: never ink (it was taken before and given back)
        if let e = error as? StreamError {
            if e.code == "credits_exhausted" { return ChatError(kind: .other, message: AskCopy.Errors.resting, retry: true) }
            if e.status == 429 || e.code == "rate_limited" { return rateLimited(nil) }
            if e.code == "timeout" { return ChatError(kind: .timeout, message: AskCopy.Errors.timeout, retry: true) }
            if e.status == 401 || e.code == "unauthorized" { return ChatError(kind: .unauthorized, message: AskCopy.Errors.unauthorized, retry: false) }
            return ChatError(kind: .other, message: AskCopy.Errors.other, retry: true)
        }
        if let u = error as? URLError {
            return u.code == .timedOut ? ChatError(kind: .timeout, message: AskCopy.Errors.timeout, retry: true) : ChatError(kind: .network, message: AskCopy.Errors.network, retry: true)
        }
        return ChatError(kind: .other, message: AskCopy.Errors.other, retry: true)
    }

    static func rateLimited(_ retryAfterMs: Int?) -> ChatError {
        let seconds = max(1, Int((Double(retryAfterMs ?? 10_000) / 1000).rounded(.up)))
        return ChatError(kind: .rateLimited, message: AskCopy.Errors.rateLimited(seconds), retry: true)
    }

    /// A user message's id for the route (`[A-Za-z0-9_-]{1,64}`).
    public static func nextId() -> String {
        idLock.lock()
        defer { idLock.unlock() }
        idSeq += 1
        return "cm_\(String(Int(Date().timeIntervalSince1970 * 1000), radix: 36))_\(idSeq)"
    }

    nonisolated(unsafe) private static var idSeq = 0
    private static let idLock = NSLock()
}
