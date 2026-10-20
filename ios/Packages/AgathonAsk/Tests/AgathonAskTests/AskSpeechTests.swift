@testable import AgathonAsk
import AgathonBoard
import AgathonBrain
import Foundation
import Testing

/// A voice that says each phrase after a short while (or holds it), and remembers what it said.
@MainActor
final class FakeSpeaker: PhraseSpeaker {
    var said: [String] = []
    var prefetched: [String] = []
    var stops = 0
    var outcome: PhraseOutcome = .voice
    var delayMs = 5

    func speak(_ words: String) async -> PhraseOutcome {
        said.append(words)
        try? await Task.sleep(for: .milliseconds(delayMs))
        return outcome
    }

    func prefetch(_ words: String) { prefetched.append(words) }
    func stop() { stops += 1 }
}

/// Read aloud as a reply streams (speechQueue.test.ts, with the web's own chunking in the brain):
/// sentence by sentence as they complete, the maths in words, never a sentence twice, at most a
/// reply's worth of characters, and silence on a new reply or Stop.
@MainActor
@Suite(.serialized)
struct AskSpeechTests {
    func queue(_ speaker: FakeSpeaker, maxReplyChars: Int = AskSpeechQueue.maxReplyChars) -> AskSpeechQueue {
        AskSpeechQueue(chunker: BrainSpeechChunker(brain: TestBrain.shared), speaker: { speaker }, maxReplyChars: maxReplyChars)
    }

    @Test func theBrainCutsSentencesAsTheWebDoes() async throws {
        let (s, next) = try await AskBrain.sentences(TestBrain.shared, text: "Great question! A half is $\\frac{1}{2}$ of a pizza. Then we add 3.5 more", from: 0, final: false)
        #expect(s.map(\.text) == ["Great question!", "A half is $\\frac{1}{2}$ of a pizza."])
        #expect(s[1].words.contains("one half"))
        let rest = try await AskBrain.sentences(TestBrain.shared, text: "Great question! A half is $\\frac{1}{2}$ of a pizza. Then we add 3.5 more", from: next, final: true)
        #expect(rest.sentences.map(\.text) == ["Then we add 3.5 more"])
        #expect(try await AskBrain.spoken(TestBrain.shared, "What is $\\frac{3}{4}$?").contains("three"))
    }

    @Test func sentencesAreSaidAsTheyCompleteAndTheFinalTextAddsOnlyWhatIsNew() async {
        let speaker = FakeSpeaker()
        let q = queue(speaker)
        q.start("r1")
        q.feed("r1", "Hi there! Let's add $\\frac{1}{4}$")
        #expect(await eventually { speaker.said.first == "Hi there!" })
        q.feed("r1", "Hi there! Let's add $\\frac{1}{4}$ and $\\frac{2}{4}$. You get three quarters")
        q.finish("r1", "Hi there! Let's add $\\frac{1}{4}$ and $\\frac{2}{4}$. You get three quarters.")
        #expect(await eventually(10) { q.idle && speaker.said.joined(separator: " ").contains("three quarters") })
        let all = speaker.said.joined(separator: " ")
        #expect(all.components(separatedBy: "Hi there!").count == 2)
        #expect(!all.contains("$") && !all.contains("\\frac"))
    }

    @Test func offOnlyNotesSentencesAndReplaySaysOneMessageAnyway() async {
        let speaker = FakeSpeaker()
        let q = queue(speaker)
        q.setEnabled(false)
        q.start("r1")
        q.finish("r1", "One. Two.")
        try? await Task.sleep(for: .milliseconds(200))
        #expect(speaker.said.isEmpty)
        q.replay("Read me again.")
        #expect(await eventually { speaker.said == ["Read me again."] })
    }

    @Test func aReplyIsCappedAtItsCharacters() async {
        let speaker = FakeSpeaker()
        let q = queue(speaker, maxReplyChars: 60)
        q.start("r1")
        q.finish("r1", "This is the first sentence of it. This is the second sentence of it. And a third one here. A fourth.")
        #expect(await eventually(10) { q.idle && !speaker.said.isEmpty })
        #expect(speaker.said.joined(separator: " ").count <= 60)
    }

    @Test func aNewReplyOrStopSilencesAndAFailedPhraseDropsTheRest() async {
        let speaker = FakeSpeaker()
        speaker.delayMs = 80
        let q = queue(speaker)
        q.start("r1")
        q.finish("r1", "First one. Second one. Third one.")
        #expect(await eventually { speaker.said.count == 1 })
        q.start("r2")
        #expect(speaker.stops >= 1)
        try? await Task.sleep(for: .milliseconds(300))
        #expect(speaker.said == ["First one."])
        // a phrase that fails: the rest of that reply is not said out of the blue later
        speaker.outcome = .failed
        speaker.delayMs = 5
        q.finish("r2", "Alpha here. Beta here. Gamma here.")
        try? await Task.sleep(for: .milliseconds(300))
        #expect(speaker.said.count == 2)
        // a late finish of a stopped reply is not said
        q.stop()
        q.finish("r1", "Never this.")
        try? await Task.sleep(for: .milliseconds(100))
        #expect(!speaker.said.contains("Never this."))
    }

    @Test func phrasesGrow() {
        #expect(AskSpeechQueue.phraseLimit(0) == 0)
        #expect(AskSpeechQueue.phraseLimit(1) == 80)
        #expect(AskSpeechQueue.phraseLimit(2) == 160)
        #expect(AskSpeechQueue.phraseLimit(3) == 240)
        #expect(AskSpeechQueue.phraseLimit(9) == 240)
    }

    /// ElevenLabs behind Cloudflare: a 502/504 page, a 429 or a dropped connection must not cut the
    /// reply off in silence (it used to answer `.failed`, which ends the reply): the device's voice
    /// for a minute; the route's own 503 "use the device" for ten.
    @Test func aVoiceRouteThatFailsHandsOverToTheDevice() {
        #expect(AskVoice.deviceVoiceSpan(after: SpeechAudioError.unavailable) == AskVoice.routeDown)
        #expect(AskVoice.deviceVoiceSpan(after: SpeechAudioError.failed) == AskVoice.routeHiccup)
        #expect(AskVoice.deviceVoiceSpan(after: URLError(.timedOut)) == AskVoice.routeHiccup)
        #expect(AskVoice.routeHiccup > 0 && AskVoice.routeHiccup < AskVoice.routeDown)
    }

    @Test func theSpeakerSettingIsPerUserAndOnForTheYoungest() {
        let defaults = UserDefaults(suiteName: "ask-tests-\(UUID().uuidString)")!
        let voice = AskVoice(source: nil)
        #expect(AskSpeech(voice: voice, userId: "kid", grade: 1, defaults: defaults).on)
        #expect(!AskSpeech(voice: voice, userId: "teen", grade: 9, defaults: defaults).on)
        let s = AskSpeech(voice: voice, userId: "teen", grade: 9, defaults: defaults)
        s.toggle()
        #expect(defaults.string(forKey: AskSpeech.settingKey("teen")) == "on")
        #expect(AskSpeech(voice: voice, userId: "teen", grade: 9, defaults: defaults).on)
        s.stop()
    }
}

/// The mic's rules (micLogic.test.ts) and the transcribe answer.
struct AskMicLogicTests {
    @Test func holdOrTapAndTheCountdown() {
        #expect(AskMicLogic.press(heldFor: 0.2) == .tap)
        #expect(AskMicLogic.press(heldFor: 0.35) == .hold)
        #expect(AskMicLogic.secondsLeft(elapsed: 10) == nil)
        #expect(AskMicLogic.secondsLeft(elapsed: 50.5) == 10)
        #expect(AskMicLogic.secondsLeft(elapsed: 59.2) == 1)
        #expect(AskMicLogic.secondsLeft(elapsed: 70) == 0)
    }

    @Test func whatTheRouteSaid() {
        #expect(AskMicLogic.outcome(status: 200, body: Data(#"{"text":" what is 7 times 8 ","source":"elevenlabs"}"#.utf8)) == .text("what is 7 times 8"))
        #expect(AskMicLogic.outcome(status: 200, body: Data(#"{"text":"","source":"none"}"#.utf8)) == .nothing)
        #expect(AskMicLogic.outcome(status: 503, body: Data(#"{"error":"speech_unavailable","message":"x"}"#.utf8)) == .fallback)
        #expect(AskMicLogic.outcome(status: 503, body: Data(#"{"error":"upstream"}"#.utf8)) == .error)
        #expect(AskMicLogic.outcome(status: 429, body: Data(#"{"error":"rate_limited","retryAfterMs":3000}"#.utf8)) == .limited(retryAfterMs: 3000))
        #expect(AskMicLogic.outcome(status: 200, body: Data("nope".utf8)) == .error)
    }

    @Test func theMultipartBody() {
        let body = AskMicLogic.multipart(audio: Data([1, 2, 3]), lang: "en", seconds: 2.5, boundary: "B")
        let text = String(decoding: body, as: UTF8.self)
        #expect(text.hasPrefix("--B\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"ask.m4a\"\r\nContent-Type: audio/mp4\r\n\r\n"))
        #expect(text.contains("name=\"lang\"\r\n\r\nen\r\n"))
        #expect(text.contains("name=\"seconds\"\r\n\r\n2.5\r\n"))
        #expect(text.hasSuffix("--B--\r\n"))
    }

    @Test @MainActor func theRouteFirstThenTheDeviceAfterItSaysUnavailable() async {
        final class Fake: SpeechToText, @unchecked Sendable {
            var answers: [AskMicLogic.Outcome]
            var calls = 0
            init(_ a: [AskMicLogic.Outcome]) { answers = a }
            func transcribe(_ audio: Data, seconds: Double) async -> AskMicLogic.Outcome {
                calls += 1
                return answers.isEmpty ? .error : answers.removeFirst()
            }
        }
        let fake = Fake([.text("seven times eight"), .error])
        let mic = AskMic(stt: fake)
        #expect(await mic.hear(Data(), seconds: 1) == .text("seven times eight"))
        // one failure is said as one; the second in a row turns to the device's recognizer
        #expect(await mic.hear(Data(), seconds: 1) == .error)
        #expect(fake.calls == 2)
    }
}

/// The screen's picture for the tutor's eyes (boardImage.test.ts).
@MainActor
struct AskBoardImageTests {
    @Test func onlyWhenTheScreenHoldsWhatTheMathsCannotSay() {
        let screen: RecordID = "screen:a"
        let kid = BoardRecord.stroke(StrokeRecord(screen: screen, order: OrderKey.after(nil), author: .kid, color: .black, width: 6, pressure: .simulated,
                                                  points: [InkPoint(x: 0, y: 0), InkPoint(x: 10, y: 10)]))
        let problem = BoardRecord.stroke(StrokeRecord(screen: screen, order: OrderKey.after(nil), author: .tutor, color: .tutor, width: 3, pressure: .real,
                                                      points: [InkPoint(x: 0, y: 0)], meta: ["live": true, "source": "ai", "chatProblem": ["n": 1]]))
        let graph = BoardRecord.stroke(StrokeRecord(screen: screen, order: OrderKey.after(nil), author: .tutor, color: .tutor, width: 3, pressure: .real,
                                                    points: [InkPoint(x: 0, y: 0)], meta: ["live": true, "source": "ai", "chatBlock": "graph", "handLine": "y = x"]))
        let sticker = BoardRecord.image(ImageRecord(screen: screen, order: OrderKey.after(nil), x: 0, y: 0, w: 10, h: 10, asset: AssetRef(src: "x"),
                                                    meta: ["isProtected": true, "kind": "sticker"]))
        #expect(AskBoardImage.role(of: kid) == .unsaid)
        #expect(AskBoardImage.role(of: problem) == .said)
        #expect(AskBoardImage.role(of: graph) == .unsaid)
        #expect(AskBoardImage.role(of: sticker) == .hidden)
        #expect(!AskBoardImage.wanted([problem, sticker]))
        #expect(AskBoardImage.wanted([problem, kid]))
    }

    @Test func aJPEGOfWhatIsOnTheScreenAtMost1024Wide() async {
        let board = MemoryBoard()
        board.kidLine(y: 300, x: 200)
        guard let url = await AskBoardImage.capture(store: board.store, screen: board.currentScreenID) else {
            Issue.record("no picture")
            return
        }
        #expect(url.hasPrefix("data:image/jpeg;base64,"))
        #expect(url.count <= AskLimits.imageChars)
        let data = Data(base64Encoded: String(url.dropFirst("data:image/jpeg;base64,".count)))
        let image = data.flatMap { UIImage(data: $0) }
        #expect(image != nil)
        if let image {
            #expect(max(image.size.width, image.size.height) * image.scale <= 1024.5)
            // cropped to the ink, blown up at most 2x: a line in a corner is not a speck
            #expect(image.size.width * image.scale <= (200 + 30) * 2 + 1)
        }
        // an empty screen sends none
        let empty = MemoryBoard()
        #expect(await AskBoardImage.capture(store: empty.store, screen: empty.currentScreenID) == nil)
        #expect(AskBoardImage.size(for: Box(x: 0, y: 0, w: 1600, h: 900)).w == 1024)
        #expect(AskBoardImage.size(for: Box(x: 0, y: 0, w: 100, h: 50)).scale == 2)
    }
}

import UIKit
