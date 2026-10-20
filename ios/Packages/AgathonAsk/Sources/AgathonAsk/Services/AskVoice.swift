import AgathonBrain
import AgathonKit
import AVFoundation
import Foundation
import os

/// Where a phrase's audio comes from: POST /api/live/speak (Hope on ElevenLabs), or a fake.
public protocol SpeechAudioSource: Sendable {
    /// The phrase as MP3. Throws `SpeechAudioError.unavailable` when the route says to use the
    /// device's own voice (503: no key, no plan, the day's budget spent).
    func audio(for words: String) async throws -> Data
}

public enum SpeechAudioError: Error, Equatable {
    case unavailable
    case failed
}

/// POST /api/live/speak `{ text }` → `audio/mpeg` (streamed by the route as ElevenLabs makes it).
public struct LiveSpeechAudio: SpeechAudioSource {
    public let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    public func audio(for words: String) async throws -> Data {
        struct Body: Encodable { var text: String }
        let body = try APIClient.encoder.encode(Body(text: String(words.prefix(AskLimits.speakChars))))
        do {
            let (data, _) = try await api.perform(.post, AskPaths.speak, body: body)
            guard data.count > 64 else { throw SpeechAudioError.failed }
            return data
        } catch let e as APIError {
            if case .http(let f) = e, f.status == 503 { throw SpeechAudioError.unavailable }
            throw SpeechAudioError.failed
        }
    }
}

/// Ask's voice (docs/ASK-V2.md, "Hears and speaks"): each phrase from /api/live/speak, played with
/// AVAudioPlayer, the next one fetched while this one plays; when the route is unavailable (503),
/// the iPad's own voice (AVSpeechSynthesizer) for ten minutes before the route is tried again.
@MainActor
public final class AskVoice: PhraseSpeaker {
    static let log = Logger(subsystem: "app.agathon.Agathon", category: "ask")
    /// after the route said it is unavailable, the device's voice for this long
    public static let routeDown: TimeInterval = 600
    /// after any other failure (a 502/504 page from Cloudflare, a 429, a dropped connection), the
    /// device's voice for this long: the reply is still read aloud, never cut off in silence, and
    /// each phrase doesn't wait on a route that is failing
    public static let routeHiccup: TimeInterval = 60

    /// How long the device's voice stands in after a phrase's audio couldn't be had.
    public static func deviceVoiceSpan(after error: Error) -> TimeInterval {
        (error as? SpeechAudioError) == .unavailable ? routeDown : routeHiccup
    }

    let source: SpeechAudioSource?
    private var prefetched: [String: Task<Data?, Never>] = [:]
    private var routeDownUntil: Date?
    private var player: AVAudioPlayer?
    private let synth = AVSpeechSynthesizer()
    private let delegate = VoiceDelegate()
    private var ending: CheckedContinuation<PhraseOutcome, Never>?
    private var generation = 0

    /// `source`: nil speaks with the device's voice only (previews, no backend).
    public init(source: SpeechAudioSource?) {
        self.source = source
        synth.delegate = delegate
        delegate.onEnd = { [weak self] finished in
            Task { @MainActor in self?.end(finished ? .voice : .cancelled) }
        }
    }

    public var usesDeviceVoice: Bool {
        guard source != nil else { return true }
        if let until = routeDownUntil, until > Date() { return true }
        return false
    }

    public func prefetch(_ words: String) {
        guard let source, !usesDeviceVoice, prefetched[words] == nil else { return }
        prefetched[words] = Task { try? await source.audio(for: words) }
    }

    public func speak(_ words: String) async -> PhraseOutcome {
        stopPlaying(.cancelled)
        generation += 1
        let mine = generation
        let text = words.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return .skipped }
        Self.activatePlayback()
        if !usesDeviceVoice, let source {
            let task = prefetched.removeValue(forKey: words) ?? Task { try? await source.audio(for: words) }
            var data = await task.value
            if data == nil {
                // the prefetch swallowed why: ask once more to learn whether the route is down
                do {
                    data = try await source.audio(for: words)
                } catch {
                    let span = Self.deviceVoiceSpan(after: error)
                    routeDownUntil = Date().addingTimeInterval(span)
                    Self.log.notice("ask: the voice route failed (\(String(describing: error), privacy: .public)); the device's voice for \(Int(span)) s")
                    data = nil
                }
            }
            guard mine == generation else { return .cancelled }
            if let data, let player = try? AVAudioPlayer(data: data) {
                return await play(player)
            }
            // audio that came but won't play: this phrase in the device's voice all the same
        }
        guard mine == generation else { return .cancelled }
        return await sayWithDevice(text)
    }

    public func stop() {
        generation += 1
        for t in prefetched.values { t.cancel() }
        prefetched.removeAll()
        stopPlaying(.cancelled)
    }

    private func play(_ p: AVAudioPlayer) async -> PhraseOutcome {
        player = p
        p.delegate = delegate
        delegate.onPlayerEnd = { [weak self] ok in
            Task { @MainActor in self?.end(ok ? .voice : .failed) }
        }
        return await withCheckedContinuation { k in
            ending = k
            if !p.play() { end(.blocked) }
        }
    }

    private func sayWithDevice(_ text: String) async -> PhraseOutcome {
        let u = AVSpeechUtterance(string: text)
        u.voice = AVSpeechSynthesisVoice(language: "en-US")
        u.rate = AVSpeechUtteranceDefaultSpeechRate * 0.95
        let outcome: PhraseOutcome = await withCheckedContinuation { k in
            ending = k
            synth.speak(u)
        }
        return outcome == .voice ? .system : outcome
    }

    private func end(_ outcome: PhraseOutcome) {
        let k = ending
        ending = nil
        player = nil
        k?.resume(returning: outcome)
    }

    private func stopPlaying(_ outcome: PhraseOutcome) {
        player?.stop()
        if synth.isSpeaking { synth.stopSpeaking(at: .immediate) }
        end(outcome)
    }

    /// Spoken audio over whatever else plays, quietly ducked; the mic's recording takes the session over.
    static func activatePlayback() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try? session.setActive(true)
    }
}

/// AVFoundation's delegates, on an NSObject.
final class VoiceDelegate: NSObject, AVAudioPlayerDelegate, AVSpeechSynthesizerDelegate, @unchecked Sendable {
    var onEnd: ((Bool) -> Void)?
    var onPlayerEnd: ((Bool) -> Void)?

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) { onPlayerEnd?(flag) }
    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) { onPlayerEnd?(false) }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) { onEnd?(true) }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) { onEnd?(false) }
}

/// Read aloud for the board (the panel's speaker toggle, each reply as it streams, and anything else
/// the tutor shows): one voice at a time. `speak(text:)` is what a hint card's speaker calls
/// (AgathonLive's `LiveOverlay(onSpeak:)`): the text's maths said in words, Ask's own reading stopped.
@MainActor
public final class AskSpeech: ObservableObject {
    /// `READ_ALOUD_KEY`: one choice per user on this device
    public static func settingKey(_ userId: String) -> String { "agathon.readAloud.\(userId)" }

    @Published public private(set) var on: Bool
    public let queue: AskSpeechQueue
    public let voice: AskVoice
    let brain: Brain
    private let defaults: UserDefaults
    private let userId: String?

    /// - `on`: the starting setting when this user has none saved (on by default for K–2).
    public init(voice: AskVoice, brain: Brain = .shared, chunker: SpeechChunker? = nil, userId: String? = nil, grade: Int? = nil,
                defaults: UserDefaults = .standard) {
        self.voice = voice
        self.brain = brain
        self.defaults = defaults
        self.userId = userId
        let saved = userId.flatMap { defaults.string(forKey: Self.settingKey($0)) }
        on = saved.map { $0 == "on" } ?? (grade.map { $0 <= 2 } ?? false)
        queue = AskSpeechQueue(chunker: chunker ?? BrainSpeechChunker(brain: brain), speaker: { voice })
        queue.setEnabled(on)
    }

    /// The panel's speaker: on says so once; off stops what is being said.
    public func toggle() {
        on.toggle()
        if let userId { defaults.set(on ? "on" : "off", forKey: Self.settingKey(userId)) }
        queue.setEnabled(on)
        if on { queue.replay(AskCopy.turnedOn) }
    }

    /// Says any of the tutor's text once (a hint card, a message's "Read it again"), maths in words.
    public func speak(text: String) {
        let raw = text
        Task { @MainActor in
            let words = (try? await AskBrain.spoken(brain, raw)) ?? RichText.mathAsText(raw)
            queue.replay(words)
        }
    }

    public func stop() {
        queue.stop()
    }
}
