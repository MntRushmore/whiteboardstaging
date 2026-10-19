import AgathonBrain
import Foundation

/// How a phrase ended (the web speaker's `SpeakOutcome`).
public enum PhraseOutcome: String, Sendable {
    /// said by Ask's voice (ElevenLabs through /api/live/speak)
    case voice
    /// said by the iPad's own voice (the route was unavailable)
    case system
    case cancelled, skipped, blocked, failed
}

/// What the queue needs of the voice.
@MainActor
public protocol PhraseSpeaker: AnyObject {
    /// says the words (cancelling whatever was being said); returns when they end
    func speak(_ words: String) async -> PhraseOutcome
    /// fetches the words' audio ahead of `speak`
    func prefetch(_ words: String)
    func stop()
}

/// Where a reply is cut into what the voice says: the web's own splitter (speechChunks.ts) in the
/// brain, or a fake in tests.
public protocol SpeechChunker: Sendable {
    func sentences(_ text: String, from: Int, final: Bool) async -> (sentences: [AskBrain.Sentence], next: Int)
    func split(_ words: String, max: Int) async -> [String]
    func fit(_ words: String, left: Int) async -> String
}

/// The web's chunking, run in the brain.
public struct BrainSpeechChunker: SpeechChunker {
    public let brain: Brain

    public init(brain: Brain = .shared) {
        self.brain = brain
    }

    public func sentences(_ text: String, from: Int, final: Bool) async -> (sentences: [AskBrain.Sentence], next: Int) {
        (try? await AskBrain.sentences(brain, text: text, from: from, final: final)) ?? ([], from)
    }

    public func split(_ words: String, max: Int) async -> [String] {
        (try? await AskBrain.split(brain, words: words, max: max)) ?? [words]
    }

    public func fit(_ words: String, left: Int) async -> String {
        (try? await AskBrain.fit(brain, words: words, left: left)) ?? ""
    }
}

/// Ask's replies read aloud as they stream (src/components/chat/voice/speechQueue.ts, ported):
///
///  - A reply's first sentence is said the moment it is whole; the ones after are gathered into
///    phrases while the one before is said, and the next phrase's audio is fetched ahead, so there
///    is no wait between them. Phrases grow: one sentence, then ~80, ~160, `phraseChars` characters.
///  - `finish` says what is left of the final reply, never a sentence twice.
///  - At most `maxReplyChars` of one reply are said (the voice's bill); the rest stays on screen.
///  - A new reply or `stop` silences whatever is being said. When the voice is cut short, cannot
///    play, or fails, the rest of that reply is dropped rather than said out of the blue later.
///  - Off, sentences are only noted as shown, so switching it on mid-reply goes on from the next.
///    `replay` says one message whatever the setting.
@MainActor
public final class AskSpeechQueue {
    nonisolated public static let maxReplyChars = 700
    nonisolated public static let phraseChars = 240

    final class Reply {
        let id: String
        var forced = false
        var text = ""
        var cursor = 0
        var keys = Set<String>()
        var queue: [String] = []
        var next: String?
        var chars = 0
        var phrases = 0
        var speaking = false
        var finished = false
        var over = false
        init(id: String) { self.id = id }
    }

    enum Job {
        case chunk(Reply)
        case final(Reply, String)
    }

    private let chunker: SpeechChunker
    private let speakerFactory: @MainActor () -> PhraseSpeaker
    private var loaded: PhraseSpeaker?
    private var reply: Reply?
    private var jobs: [Job] = []
    private var working = false
    private var seen: [String] = []
    private var replays = 0
    public private(set) var enabled = true
    let maxReplyChars: Int
    let phraseChars: Int

    public init(chunker: SpeechChunker, speaker: @escaping @MainActor () -> PhraseSpeaker, maxReplyChars: Int = AskSpeechQueue.maxReplyChars,
                phraseChars: Int = AskSpeechQueue.phraseChars) {
        self.chunker = chunker
        speakerFactory = speaker
        self.maxReplyChars = maxReplyChars
        self.phraseChars = phraseChars
    }

    /// The most characters phrase number `n` (from 0) may join sentences up to.
    nonisolated public static func phraseLimit(_ n: Int, max: Int = phraseChars) -> Int {
        n <= 0 ? 0 : min(max, 80 * (1 << (n - 1)))
    }

    var speaker: PhraseSpeaker {
        if let loaded { return loaded }
        let s = speakerFactory()
        loaded = s
        return s
    }

    /// Read aloud on or off. Off stops what is being said.
    public func setEnabled(_ on: Bool) {
        enabled = on
        if !on, let r = reply, !r.forced { stop() }
    }

    /// A new reply: whatever is being said stops.
    public func start(_ id: String) {
        stop()
        remember(id)
        reply = Reply(id: id)
    }

    /// More of reply `id` as it streams: the new piece, or the whole text so far.
    public func feed(_ id: String, _ text: String) {
        guard let r = reply, r.id == id, !r.finished, !text.isEmpty else { return }
        if !r.text.isEmpty && text.hasPrefix(r.text) { r.text = text } else { r.text += text }
        enqueue(.chunk(r))
    }

    /// Reply `id` is final: what it says that was not said yet is said now.
    public func finish(_ id: String, _ finalText: String) {
        var r = reply
        if r == nil || r!.id != id {
            if seen.contains(id) && r?.id != id { return }
            start(id)
            r = reply
        }
        guard let r, !r.finished else { return }
        r.finished = true
        enqueue(.final(r, finalText))
    }

    /// Says one message again (its speaker button), whatever the setting.
    public func replay(_ text: String) {
        replays += 1
        let id = "replay:\(replays)"
        start(id)
        reply?.forced = true
        finish(id, text)
    }

    /// Silence: what is being said stops, and nothing waiting is said.
    public func stop() {
        reply = nil
        jobs.removeAll()
        loaded?.stop()
    }

    /// What is waiting to be said (tests).
    public var waiting: [String] {
        guard let r = reply else { return [] }
        return (r.next.map { [$0] } ?? []) + r.queue
    }

    /// Everything is said or dropped (tests).
    public var idle: Bool {
        guard let r = reply else { return true }
        return !working && jobs.isEmpty && !r.speaking && r.queue.isEmpty && r.next == nil
    }

    // MARK: - inside

    private func remember(_ id: String) {
        seen.append(id)
        if seen.count > 50 { seen.removeFirst() }
    }

    private func enqueue(_ job: Job) {
        jobs.append(job)
        guard !working else { return }
        working = true
        Task { @MainActor in
            while !jobs.isEmpty {
                let job = jobs.removeFirst()
                await handle(job)
            }
            working = false
        }
    }

    private func handle(_ job: Job) async {
        switch job {
        case .chunk(let r):
            guard r === reply, !r.finished else { return }
            let (sentences, next) = await chunker.sentences(r.text, from: r.cursor, final: false)
            guard r === reply else { return }
            r.cursor = next
            await take(r, sentences)
        case .final(let r, let text):
            guard r === reply else { return }
            let (sentences, _) = await chunker.sentences(text, from: 0, final: true)
            guard r === reply else { return }
            await take(r, sentences)
        }
    }

    private func take(_ r: Reply, _ sentences: [AskBrain.Sentence]) async {
        for s in sentences {
            guard !s.key.isEmpty, !r.keys.contains(s.key) else { continue }
            r.keys.insert(s.key)
            if r.over || (!enabled && !r.forced) { continue }
            let parts = await chunker.split(s.words, max: phraseChars)
            guard r === reply else { return }
            r.queue.append(contentsOf: parts.filter { !$0.isEmpty })
        }
        await pump(r)
    }

    private func pump(_ r: Reply) async {
        guard r === reply else { return }
        if r.speaking {
            await prepareNext(r)
            return
        }
        var phrase = r.next
        if phrase == nil { phrase = await form(r) }
        r.next = nil
        guard let phrase, r === reply else { return }
        r.speaking = true
        Task { @MainActor in await self.say(r, phrase) }
        await prepareNext(r)
    }

    private func prepareNext(_ r: Reply) async {
        guard r.next == nil, !r.queue.isEmpty, !r.over else { return }
        if !r.finished && r.queue.joined(separator: " ").count < Self.phraseLimit(r.phrases, max: phraseChars) / 4 { return }
        let next = await form(r)
        guard r === reply else { return }
        r.next = next
        if let next { speaker.prefetch(next) }
    }

    /// Waiting words joined into one phrase, within its size and what is left of the reply's characters.
    private func form(_ r: Reply) async -> String? {
        var phrase = ""
        let limit = Self.phraseLimit(r.phrases, max: phraseChars)
        while let words = r.queue.first {
            let joined = phrase.isEmpty ? words : "\(phrase) \(words)"
            if !phrase.isEmpty && (limit == 0 || joined.count > limit) { break }
            if r.chars + joined.count > maxReplyChars {
                // the reply's characters run out here: it stops at a sentence's end, unless nothing of
                // it was said yet (one very long first sentence), which is cut to fit
                let fitted = r.chars == 0 && phrase.isEmpty ? await chunker.fit(words, left: maxReplyChars) : ""
                if !fitted.isEmpty { phrase = fitted }
                r.queue = []
                r.over = true
                break
            }
            phrase = joined
            r.queue.removeFirst()
        }
        guard !phrase.isEmpty else { return nil }
        r.chars += phrase.count
        r.phrases += 1
        return phrase
    }

    private func say(_ r: Reply, _ phrase: String) async {
        let outcome = await speaker.speak(phrase)
        guard r === reply else { return }
        r.speaking = false
        if outcome == .cancelled || outcome == .blocked || outcome == .failed {
            r.over = true
            r.queue = []
            r.next = nil
            return
        }
        await pump(r)
    }
}
