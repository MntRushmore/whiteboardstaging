import AgathonKit
import AVFoundation
import Foundation
import os
import Speech

/// The mic's words (`ASK_VOICE_COPY`): a 7-year-old reads them; a line for the grown-up when only
/// they can fix it.
public enum AskMicCopy {
    public static let mic = "Talk to Ask"
    public static let micHint = "Hold to talk, or tap to start and stop"
    public static let micStop = "Stop and send"
    public static let listeningHold = "Listening… Let go when you're done."
    public static let listeningTap = "Listening… Tap when you're done."
    public static func secondsLeft(_ s: Int) -> String { "\(s) second\(s == 1 ? "" : "s") left" }
    public static let sending = "Getting your words…"
    public static let nothing = "I didn't hear anything. Try again?"
    public static let error = "Oops, that didn't work. Try again?"
    public static let limited = "Let's wait a moment, then try again."
    public static let denied = "I can't hear you yet."
    public static let deniedHint = "Grown-up: allow the microphone for Agathon in Settings."
    public static let busy = "The microphone is busy."
    public static let busyHint = "Grown-up: close other apps that are using the microphone."
}

/// The mic's rules (micLogic.ts): hold or tap, how long, and what the route's answer means.
public enum AskMicLogic {
    /// a press held at least this long is hold-to-talk (let go: sent); shorter is a tap (tap again: sent)
    public static let holdSeconds = 0.35
    /// the longest a kid may talk (the route's cap)
    public static let maxSeconds = AskLimits.audioSeconds
    /// the last seconds are counted down
    public static let countdownSeconds = 10.0
    /// less than this is a slip of the finger: nothing is sent
    public static let minSeconds = 0.3
    /// AAC at 32 kbit/s: clear for one voice, ~240 KB a minute
    public static let bitsPerSecond = 32_000
    /// after the route said `speech_unavailable`, the device's recognizer for this long
    public static let routeDownSeconds = 600.0
    /// failures of the route in a row before the mic uses the device's recognizer for a while
    public static let failuresBeforeFallback = 2

    public enum Press: Equatable { case hold, tap }

    public static func press(heldFor seconds: Double) -> Press { seconds >= holdSeconds ? .hold : .tap }

    /// Seconds left to show while recording (only in the last `countdownSeconds`), else nil.
    public static func secondsLeft(elapsed: Double) -> Int? {
        let left = maxSeconds - elapsed
        if left > countdownSeconds { return nil }
        return max(0, Int(left.rounded(.up)))
    }

    public enum Outcome: Equatable {
        case text(String)
        case nothing
        /// the route will not use Scribe for this kid: the device's recognizer from now on
        case fallback
        case limited(retryAfterMs: Int?)
        case error
    }

    /// POST /api/live/transcribe's answer (status and body) as what the mic does next.
    public static func outcome(status: Int, body: Data) -> Outcome {
        let json = AgathonKit.JSONValue.parse(body)
        if (200..<300).contains(status) {
            guard let text = json?["text"]?.stringValue else { return .error }
            let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? .nothing : .text(String(t.prefix(AskLimits.message)))
        }
        if status == 503, json?["error"]?.stringValue == "speech_unavailable" { return .fallback }
        if status == 429 {
            let ms = json?["retryAfterMs"]?.doubleValue
            return .limited(retryAfterMs: ms.flatMap { $0 > 0 ? Int($0) : nil })
        }
        return .error
    }

    /// A multipart body: the recording as `audio` (ask.m4a, audio/mp4), the kid's language and its length.
    public static func multipart(audio: Data, lang: String, seconds: Double, boundary: String) -> Data {
        var d = Data()
        func field(_ name: String, _ value: String) {
            d.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".data(using: .utf8)!)
        }
        d.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"ask.m4a\"\r\nContent-Type: audio/mp4\r\n\r\n".data(using: .utf8)!)
        d.append(audio)
        d.append("\r\n".data(using: .utf8)!)
        field("lang", lang)
        field("seconds", String(format: "%.1f", seconds))
        d.append("--\(boundary)--\r\n".data(using: .utf8)!)
        return d
    }

    /// The kid's language for Scribe ("en-US" → "en"); English when unsure.
    public static func lang(_ locale: Locale = .current) -> String {
        let code = locale.language.languageCode?.identifier ?? "en"
        return code.range(of: "^[a-z]{2,3}$", options: .regularExpression) != nil ? code : "en"
    }
}

/// How the mic turns a recording into words: the route (ElevenLabs Scribe), or a fake in tests.
public protocol SpeechToText: Sendable {
    func transcribe(_ audio: Data, seconds: Double) async -> AskMicLogic.Outcome
}

/// POST /api/live/transcribe, multipart.
public struct LiveSpeechToText: SpeechToText {
    public let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    public func transcribe(_ audio: Data, seconds: Double) async -> AskMicLogic.Outcome {
        do {
            var request = try await api.makeRequest(.post, AskPaths.transcribe)
            let boundary = "agathon-\(UUID().uuidString)"
            request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            request.httpBody = AskMicLogic.multipart(audio: audio, lang: AskMicLogic.lang(), seconds: seconds, boundary: boundary)
            request.timeoutInterval = 25
            let (data, response) = try await api.transport.data(for: request)
            return AskMicLogic.outcome(status: response.statusCode, body: data)
        } catch {
            return .error
        }
    }
}

/// Ask's mic (docs/ASK-V2.md): hold to talk, or tap to start and tap to send. Records AAC at
/// 32 kbit/s (AVAudioRecorder, m4a), sends it to /api/live/transcribe, and when the route says it
/// will not (503 `speech_unavailable`, or twice failed in a row) hears the same recording with the
/// iPad's own recognizer (SFSpeechRecognizer, on the device when it can) for the next ten minutes.
/// The microphone's permission is asked for on the first press, never before.
@MainActor
public final class AskMic: ObservableObject {
    static let log = Logger(subsystem: "app.agathon.Agathon", category: "ask")

    public enum Phase: Equatable {
        case idle
        /// recording: held (let go sends) or tapped (tap again sends)
        case listening(Press)
        case sending
        /// a problem's words for the kid, and one for a grown-up
        case problem(kid: String, grownUp: String?)
    }

    public typealias Press = AskMicLogic.Press

    @Published public private(set) var phase: Phase = .idle
    @Published public private(set) var secondsLeft: Int?
    /// the words heard, for the panel
    public var onText: ((String) -> Void)?
    /// the mic is about to listen: Ask's voice stops (or it would be recorded too)
    public var onListen: (() -> Void)?

    let stt: SpeechToText
    private var recorder: AVAudioRecorder?
    private var pressedAt: Date?
    private var endOnRelease = false
    private var startedAt: Date?
    private var timer: Task<Void, Never>?
    private var failures = 0
    private var routeDownUntil: Date?
    private let fileURL: URL

    public init(stt: SpeechToText) {
        self.stt = stt
        fileURL = FileManager.default.temporaryDirectory.appendingPathComponent("ask-\(UUID().uuidString).m4a")
    }

    public var isListening: Bool {
        if case .listening = phase { return true }
        return false
    }

    // MARK: - the press

    /// The finger went down on the mic.
    public func pressBegan() {
        switch phase {
        case .listening(.tap):
            // the second tap: it sends when the finger comes up
            endOnRelease = true
        case .listening(.hold), .sending:
            break
        case .idle, .problem:
            pressedAt = Date()
            endOnRelease = false
            Task { await start() }
        }
    }

    /// The finger came up: a hold sends now; a tap keeps listening until the next tap.
    public func pressEnded() {
        let held = pressedAt.map { Date().timeIntervalSince($0) } ?? 0
        pressedAt = nil
        if endOnRelease {
            endOnRelease = false
            Task { await finish() }
            return
        }
        if case .listening(.hold) = phase {
            if AskMicLogic.press(heldFor: held) == .tap {
                phase = .listening(.tap)
            } else {
                Task { await finish() }
            }
        }
    }

    /// Stops without sending (the panel closed).
    public func cancel() {
        timer?.cancel()
        recorder?.stop()
        recorder = nil
        phase = .idle
        secondsLeft = nil
    }

    // MARK: - recording

    private func start() async {
        guard await permission() else {
            phase = .problem(kid: AskMicCopy.denied, grownUp: AskMicCopy.deniedHint)
            return
        }
        onListen?()
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothHFP])
            try session.setActive(true)
            let settings: [String: Any] = [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 22_050,
                AVNumberOfChannelsKey: 1,
                AVEncoderBitRateKey: AskMicLogic.bitsPerSecond,
            ]
            try? FileManager.default.removeItem(at: fileURL)
            let r = try AVAudioRecorder(url: fileURL, settings: settings)
            guard r.record(forDuration: AskMicLogic.maxSeconds) else { throw CocoaError(.fileWriteUnknown) }
            recorder = r
            startedAt = Date()
            phase = .listening(pressedAt == nil ? .tap : .hold)
            timer = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: .milliseconds(250))
                    guard let self, let at = self.startedAt else { return }
                    let elapsed = Date().timeIntervalSince(at)
                    self.secondsLeft = AskMicLogic.secondsLeft(elapsed: elapsed)
                    if elapsed >= AskMicLogic.maxSeconds { await self.finish(); return }
                }
            }
        } catch {
            Self.log.error("ask: the mic did not start: \(String(describing: error), privacy: .public)")
            phase = .problem(kid: AskMicCopy.busy, grownUp: AskMicCopy.busyHint)
        }
    }

    /// Asked on the first press only (the system asks once; afterwards it answers at once).
    private func permission() async -> Bool {
        switch AVAudioApplication.shared.recordPermission {
        case .granted: return true
        case .denied: return false
        default: return await AVAudioApplication.requestRecordPermission()
        }
    }

    private func finish() async {
        timer?.cancel()
        timer = nil
        guard let r = recorder else { return }
        let seconds = r.currentTime > 0 ? r.currentTime : Date().timeIntervalSince(startedAt ?? Date())
        r.stop()
        recorder = nil
        secondsLeft = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        guard seconds >= AskMicLogic.minSeconds, let audio = try? Data(contentsOf: fileURL), audio.count > 512 else {
            phase = .idle
            return
        }
        phase = .sending
        let words = await hear(audio, seconds: seconds)
        try? FileManager.default.removeItem(at: fileURL)
        switch words {
        case .text(let t):
            phase = .idle
            onText?(t)
        case .nothing:
            phase = .problem(kid: AskMicCopy.nothing, grownUp: nil)
        case .limited:
            phase = .problem(kid: AskMicCopy.limited, grownUp: nil)
        case .fallback, .error:
            phase = .problem(kid: AskMicCopy.error, grownUp: nil)
        }
    }

    /// The route first (unless it said lately it will not), then the device's recognizer.
    func hear(_ audio: Data, seconds: Double) async -> AskMicLogic.Outcome {
        let routeDown = routeDownUntil.map { $0 > Date() } ?? false
        if !routeDown {
            let outcome = await stt.transcribe(audio, seconds: seconds)
            switch outcome {
            case .fallback:
                routeDownUntil = Date().addingTimeInterval(AskMicLogic.routeDownSeconds)
            case .error:
                failures += 1
                if failures < AskMicLogic.failuresBeforeFallback { return .error }
                routeDownUntil = Date().addingTimeInterval(AskMicLogic.routeDownSeconds)
                failures = 0
            default:
                failures = 0
                return outcome
            }
        }
        return await Self.recognizeOnDevice(fileURL)
    }

    /// The recording heard by the iPad's own recognizer (on the device when the language has it).
    static func recognizeOnDevice(_ url: URL) async -> AskMicLogic.Outcome {
        let authorized: Bool = await withCheckedContinuation { k in
            if SFSpeechRecognizer.authorizationStatus() == .authorized { return k.resume(returning: true) }
            SFSpeechRecognizer.requestAuthorization { k.resume(returning: $0 == .authorized) }
        }
        guard authorized, let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), recognizer.isAvailable else { return .error }
        let request = SFSpeechURLRecognitionRequest(url: url)
        request.shouldReportPartialResults = false
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        return await withCheckedContinuation { k in
            var done = false
            _ = recognizer.recognitionTask(with: request) { result, error in
                guard !done else { return }
                if let result, result.isFinal {
                    done = true
                    let t = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
                    k.resume(returning: t.isEmpty ? .nothing : .text(t))
                } else if error != nil {
                    done = true
                    k.resume(returning: .nothing)
                }
            }
        }
    }
}
