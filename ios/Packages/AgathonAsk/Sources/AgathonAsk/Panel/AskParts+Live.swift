import AgathonBrain
import AgathonKit
import AgathonLive
import Foundation

extension AskParts {
    /// Ask for a board on the canvas, against the app's backend: the chat (history, streaming, the
    /// move), the board's driver (picture, image, actions in the tutor's hand), read aloud through
    /// /api/live/speak and hold-to-talk through /api/live/transcribe. Failures are reported to the
    /// admin page as `live.chat`, with the panel's own words.
    ///
    /// ```swift
    /// let (ask, driver) = AskParts.live(backend: backend, boardId: id, board: canvasBoard,
    ///                                   helper: LiveLoopAskHelper(loop: loop), userId: userId, grade: grade)
    /// AskPanelContainer(isOpen: $askOpen, ask: ask) { BoardEditorView(…) }
    /// LiveOverlay(loop: loop, geometry: canvasBoard, onSpeak: { ask.speech.speak(text: $0) })
    /// ```
    @MainActor
    public static func live(backend: AgathonBackend, boardId: String, board: CanvasLiveBoard, helper: AskBoardHelper? = nil,
                            userId: String? = nil, grade: Int? = nil, brain: Brain = .shared) -> (AskParts, AskBoardDriver) {
        let driver = AskBoardDriver(canvasBoard: board, brain: brain, helper: helper)
        // every problem the tutor gives goes on a page of its own (docs/PROBLEM-PAGES.md)
        driver.problemPages = true
        let voice = AskVoice(source: LiveSpeechAudio(api: backend.api))
        let speech = AskSpeech(voice: voice, brain: brain, userId: userId, grade: grade)
        let session = AskSession(boardId: boardId, transport: LiveAskTransport(backend: backend), board: driver, speech: speech.queue, grade: grade)
        let errors = backend.errors
        session.onFailure = { chatError, error in
            Task { _ = await errors.reportUserError(kind: "live.chat", code: AskParts.failureCode(chatError, error), message: chatError.message,
                                                    level: chatError.kind == .ink ? .info : .error, path: "/board", boardId: boardId, error: error) }
        }
        let mic = AskMic(stt: LiveSpeechToText(api: backend.api))
        return (AskParts(session: session, speech: speech, mic: mic), driver)
    }

    /// The admin page's code for a failed ask (`chatFailureReport`): the kind, or the API's code.
    static func failureCode(_ chatError: ChatError, _ error: Error) -> String {
        guard chatError.kind == .other else { return chatError.kind.rawValue }
        if let api = error as? APIError, let f = api.failure { return f.status >= 500 ? "upstream" : (f.code ?? "http_\(f.status)") }
        if let e = error as? StreamError { return e.code.range(of: "^[a-z0-9_]{1,40}$", options: .regularExpression) != nil ? "stream_\(e.code)" : "stream_error" }
        return "unknown"
    }
}
