@testable import AgathonAsk
import AgathonBoard
import AgathonKit
import Foundation
import Testing

/// Ask end to end against the LOCAL stack (`npm run db:start`, `npm run dev -- -p 3701`), never
/// production, and only when asked: each run makes real model, voice and transcription calls that
/// cost money.
///
///     TEST_RUNNER_AGATHON_ASK_INTEGRATION=1 \
///     TEST_RUNNER_AGATHON_API_URL=http://127.0.0.1:3701 \
///     TEST_RUNNER_SUPABASE_URL=http://127.0.0.1:54321 \
///     TEST_RUNNER_SUPABASE_ANON_KEY=<ANON_KEY from `npx supabase status -o env`> \
///     xcodebuild test -scheme AgathonAsk -only-testing:AgathonAskTests/AskLocalStackTests …
///
/// Signs in as the seeded QA user (AGATHON_TEST_EMAIL / AGATHON_TEST_PASSWORD), makes a board, reads
/// its first screen's (empty) chat and hello, asks once — streamed, with the screen's picture —
/// writes the reply's actions on a board in memory, reads the saved chat back, has one phrase said
/// and one recording heard, then deletes the board.
@MainActor
@Suite(.enabled(if: ProcessInfo.processInfo.environment["AGATHON_ASK_INTEGRATION"] == "1", "set AGATHON_ASK_INTEGRATION=1 and point it at the local stack"), .serialized)
struct AskLocalStackTests {
    static let env = ProcessInfo.processInfo.environment

    @Test func askStreamsWritesSavesSpeaksAndHears() async throws {
        let environment = try AgathonEnvironment.resolve(environment: Self.env, allowOverrides: true)
        try #require(environment.isLocal, "the Ask integration test only runs against the local stack")
        let backend = AgathonBackend(environment: environment, release: AppRelease(version: "0", build: "test"), authStorage: InMemoryAuthStorage())
        backend.auth.start()
        try await backend.auth.signIn(email: Self.env["AGATHON_TEST_EMAIL"] ?? "qa-student@example.com", password: Self.env["AGATHON_TEST_PASSWORD"] ?? "password123")
        let made = try await backend.boards.create(title: "iOS Ask integration \(Int(Date().timeIntervalSince1970))")

        let board = MemoryBoard()
        board.kidLine(y: 140)
        let transport = LiveAskTransport(backend: backend)
        let driver = AskBoardDriver(board: board, brain: TestBrain.shared)
        let session = AskSession(boardId: made.id, transport: transport, board: driver, grade: 6)
        let ref = driver.screenRef

        // the first screen's chat: none yet, and a hello built from what the tutor knows
        let first = await transport.history(boardId: made.id, screen: ref.historyScreen)
        #expect(first.history?.turns.isEmpty == true)
        #expect(first.history?.hello?.greeting.isEmpty == false)

        // one ask, streamed: words, then the board's actions written in the tutor's hand
        session.appeared()
        session.send("Write 2 problems like 2x + 3 = 11 on my board, and tell me what 1/2 + 1/4 is.")
        #expect(await eventually(90) { !session.busy })
        // problems on a screen with work go on a new one: the exchange went with them, and the panel too
        let now = driver.screenRef
        #expect(session.screen == now)
        let reply = try #require(session.messages.last)
        #expect(reply.role == .tutor)
        #expect(reply.state == .done, "\(reply.text)")
        #expect(!reply.text.isEmpty)
        #expect(reply.turnId != nil)
        print("ASK reply: \(reply.text) notes=\(reply.notes) strokes=\(board.tutorStrokes.count)")
        #expect(board.tutorStrokes.contains { $0.meta["chatProblem"] != nil }, "the problems were written")

        // the saved chat, read back as a fresh view would: on the screen the tutor started, once moved
        var saved = await transport.history(boardId: made.id, screen: now.historyScreen)
        for _ in 0..<20 where saved.history?.turns.isEmpty != false {
            try? await Task.sleep(for: .milliseconds(250))
            saved = await transport.history(boardId: made.id, screen: now.historyScreen)
        }
        #expect(saved.history?.turns.map(\.role) == [.user, .tutor])
        if now.id != ref.id {
            let first = await transport.history(boardId: made.id, screen: ref.historyScreen)
            #expect(first.history?.turns.isEmpty == true)
        }

        // one phrase said by Ask's voice (or the route says to use the device's: no key or no plan)
        do {
            let mp3 = try await LiveSpeechAudio(api: backend.api).audio(for: "One half plus one quarter is three quarters.")
            #expect(mp3.count > 1000)
        } catch SpeechAudioError.unavailable {
            print("ASK speak: unavailable on this stack (the device's voice)")
        }

        // one recording heard: a second of silence is nothing heard (or the route is unavailable)
        let silence = try Self.silentM4A()
        let heard = await LiveSpeechToText(api: backend.api).transcribe(silence, seconds: 1)
        print("ASK transcribe: \(heard)")
        #expect([AskMicLogic.Outcome.nothing, .fallback].contains(heard) || { if case .text = heard { return true } else { return false } }())

        _ = try? await backend.boards.delete(id: made.id)
        try await backend.auth.signOut(scope: .local)
    }

    /// A second of silence as AAC in M4A (what the mic records).
    static func silentM4A() throws -> Data {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("silence-\(UUID().uuidString).m4a")
        try write(url)
        return try Data(contentsOf: url)
    }

    /// The file is finished when it goes out of scope.
    static func write(_ url: URL) throws {
        let settings: [String: Any] = [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 22_050, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 32_000]
        let file = try AVAudioFile(forWriting: url, settings: settings)
        let format = file.processingFormat
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(format.sampleRate)) else { return }
        buffer.frameLength = buffer.frameCapacity
        try file.write(from: buffer)
    }
}

import AVFoundation
