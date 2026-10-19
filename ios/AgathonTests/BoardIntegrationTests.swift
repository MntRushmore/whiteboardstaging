import AgathonAsk
import AgathonBoard
import AgathonKit
import AgathonLive
import AgathonOnboarding
import AgathonStore
import AgathonSync
import Foundation
import Testing
import UIKit
@testable import Agathon

/// The integration's own pieces: the board's tutor lets everything go when the board closes (an
/// allocation sanity check), the app's one parental gate, the save pill's words, a practice set never
/// written twice, and which board opens.
@MainActor
@Suite(.serialized)
struct BoardIntegrationTests {
    /// The Live routes, never called for real: every read fails as offline would.
    final class QuietServices: LiveServices, @unchecked Sendable {
        func capabilities() async throws -> LiveCapabilities { throw APIError.network(.notConnectedToInternet) }
        func recognize(_ request: RecognizeRequest) async throws -> RecognizeResponse { throw APIError.network(.notConnectedToInternet) }
        func reread(_ request: RereadRequest) async throws -> RereadResponse { throw APIError.network(.notConnectedToInternet) }
        func setup(_ request: SetupRequest) async throws -> SetupResponse { throw APIError.network(.notConnectedToInternet) }
        func check(_ request: CheckRequest) -> LiveEventStream { LiveEventStream { $0.finish() } }
        func solve(_ request: SolveRequest) -> LiveEventStream { LiveEventStream { $0.finish() } }
    }

    /// A board with its tutor and Ask, started, used a little, stopped and dropped: nothing of it is
    /// left (no timer, task, subscription or closure keeps the loop, the chat, the board or the canvas).
    @Test func aClosedBoardLetsEverythingGo() async throws {
        weak var weakController: BoardController?
        weak var weakCanvas: BoardCanvasView?
        weak var weakLoop: LiveLoop?
        weak var weakSession: AskSession?
        weak var weakDriver: AskBoardDriver?
        weak var weakBoard: CanvasLiveBoard?
        do {
            let controller = BoardController()
            let canvas = BoardCanvasView(controller: controller)
            canvas.frame = CGRect(x: 0, y: 0, width: 1194, height: 834)
            canvas.layoutIfNeeded()
            let tutor = BoardTutor(controller: controller, canvas: canvas, boardId: "alloc-test", services: QuietServices()) { board, helper in
                let driver = AskBoardDriver(canvasBoard: board, helper: helper)
                let speech = AskSpeech(voice: AskVoice(source: nil), grade: 4)
                let session = AskSession(boardId: "alloc-test", transport: ScriptedAskTransport(), board: driver, speech: speech.queue, grade: 4)
                return (AskParts(session: session, speech: speech, mic: AskMic(stt: ScriptedSpeechToText())), driver)
            }
            var inkEmpty = 0
            tutor.onInkEmpty = { inkEmpty += 1 }
            tutor.start()
            // a kid's stroke, a page turn, an ask that writes on the board
            let screen = controller.currentScreenID
            controller.store.put(.stroke(StrokeRecord(screen: screen, order: controller.store.nextOrder(on: screen), author: .kid, color: .black, width: 6,
                                                      pressure: .simulated, x: 100, y: 100,
                                                      points: [InkPoint(x: 0, y: 0), InkPoint(x: 40, y: 10)], start: 0)), origin: .kid)
            _ = controller.addScreen()
            tutor.ask.session.send("Graph y = x² − 4")
            try await Task.sleep(for: .seconds(3))
            tutor.stop()
            #expect(inkEmpty == 0)
            weakController = controller
            weakCanvas = canvas
            weakLoop = tutor.loop
            weakSession = tutor.ask.session
            weakDriver = tutor.driver
            weakBoard = tutor.liveBoard
        }
        // what was in flight when it stopped finishes or is cancelled
        for _ in 0..<40 where weakLoop != nil || weakSession != nil || weakController != nil {
            try await Task.sleep(for: .milliseconds(100))
        }
        #expect(weakLoop == nil, "the Live loop is still alive")
        #expect(weakSession == nil, "Ask's session is still alive")
        #expect(weakDriver == nil, "Ask's board driver is still alive")
        #expect(weakBoard == nil, "the loop's board is still alive")
        #expect(weakCanvas == nil, "the canvas is still alive")
        #expect(weakController == nil, "the board's controller is still alive")
    }

    @Test func theAppsGateIsTheNumberInWords() {
        let gate = AppParentalGate(challenge: ParentalGateChallenge(answer: 628))
        #expect(gate.length == 3)
        #expect(gate.question == "Type this number:")
        #expect(gate.prompt == "six hundred twenty-eight")
        #expect(gate.spokenPrompt == "Type this number: six hundred twenty-eight")
        #expect(gate.check("628", now: Date()) == .open)
        // a miss: a new number (never the same one), and the gate's own words, never a pause
        #expect(gate.check("100", now: Date()) == .miss)
        #expect(gate.prompt != "six hundred twenty-eight")
        #expect(gate.missNote == "Look again. Here's a new number.")
        #expect(gate.pausedUntil(now: Date()) == nil)
    }

    @Test func notSavedYetOnlyWhenTheServerCantHoldTheBoard() {
        for status in [SyncState.Status.saved, .dirty, .saving, .merging, .offline, .error, .refused] {
            #expect(BoardSaveStatus.look(status, message: nil).words != "Not saved yet", "\(status)")
        }
        #expect(BoardSaveStatus.look(.localOnly, message: nil).words == "Not saved yet")
        #expect(BoardSaveStatus.look(.offline, message: nil).words.contains("kept on this iPad"))
        #expect(BoardSaveStatus.look(.error, message: nil).retry)
        #expect(!BoardSaveStatus.look(.saved, message: nil).retry)
    }

    @Test func aPracticeSetIsWrittenOnce() {
        let store = BoardStore(document: .blank())
        let screen = store.screenIDs[0]
        #expect(!BoardTutor.wrote("daily:2026-10-18", in: store))
        #expect(!BoardTutor.hasProblems([["2x + 3 = 11"]], in: store))
        store.documentMeta[BoardTutor.practiceMeta] = .array([.string("daily:2026-10-18")])
        #expect(BoardTutor.wrote("daily:2026-10-18", in: store))
        #expect(!BoardTutor.wrote("daily:2026-10-19", in: store))
        // a board that has the problems already (written before the meta existed)
        let meta: Meta = ["chatProblem": .object(["n": .number(1), "lines": .array([.string("2x + 3 = 11")]),
                                                  "cell": .object(["x": .number(0), "y": .number(0), "w": .number(100), "h": .number(100)])])]
        store.put(.stroke(StrokeRecord(screen: screen, order: store.nextOrder(on: screen), author: .tutor, color: .tutor, width: 4,
                                       pressure: .real, x: 10, y: 10, points: [InkPoint(x: 0, y: 0), InkPoint(x: 30, y: 0)], meta: meta)), origin: .tutor)
        #expect(BoardTutor.hasProblems([["2x + 3 = 11"], ["5x = 15"]], in: store))
        #expect(!BoardTutor.hasProblems([["5x = 15"]], in: store))
    }

    @Test func boardsOpenInTheRealBoard() {
        // the app's opening is the editor with saving, the tutor and Ask (not the read-only stand-in)
        let request = OpenBoard(board: BoardSummary(id: "b1", title: "Fractions"))
        let view = BoardOpening.current.makeView(request)
        #expect(String(describing: view).contains("BoardScreen"))
        #expect(!String(describing: view).contains("BoardPreviewScreen"))
    }

    @Test func theFirstBoardsTitleIsTheKids() {
        #expect(FirstBoardRequest(boardId: "b", document: .blank(), kidName: "Sam").title == "Sam’s first board")
        #expect(FirstBoardRequest(boardId: nil, document: .blank(), kidName: nil).title == "My first board")
    }
}
