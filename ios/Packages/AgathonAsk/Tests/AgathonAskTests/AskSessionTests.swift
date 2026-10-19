@testable import AgathonAsk
import AgathonKit
import Foundation
import Testing

/// The panel's model (src/components/chat/__tests__/sendAsk.test.ts, for the iPad): the stream's
/// events into the thread, the board's actions, a chat per screen, the saved chat, and failures.
@MainActor
struct AskSessionTests {
    func session(_ transport: FakeTransport, _ board: FakeBoard, speech: FakeSpeech? = nil) -> AskSession {
        AskSession(boardId: "board-1", transport: transport, board: board, speech: speech, grade: 4)
    }

    static let actions: [AgathonKit.JSONValue] = [.object(["type": .string("write_problems"), "problems": .array([.array([.string("2x = 8")])])])]

    @Test func streamsWordsThenTheReplyReplacesThemThenTheBoardWrites() async {
        let t = FakeTransport()
        t.script([
            .event(.model("sonnet")),
            .event(.delta("Let's try ")),
            .event(.delta("$\\frac{1}{2}$ first.")),
            .event(.delta(" <boa")),
            .event(.reply("Let's try $\\frac{1}{2}$ first!")),
            .event(.actions(AskActions(actions: Self.actions, notes: ["1 of 4 problems couldn't be checked, so I left it out."]))),
            .event(.done(AskDone(model: "sonnet", ms: 900, turnId: "t2", userTurnId: "t1"))),
        ])
        let board = FakeBoard()
        board.shot = AskScreen(empty: false, student: ["2x + 3 = 11"])
        board.imageURL = "data:image/jpeg;base64,AAAA"
        let speech = FakeSpeech()
        let s = session(t, board, speech: speech)
        s.send("  3 more like these ")
        #expect(s.busy)
        #expect(await eventually { !s.busy })
        let m = s.messages
        #expect(m.count == 2)
        #expect(m[0].role == .user && m[0].text == "3 more like these" && m[0].clientId != nil)
        #expect(m[1].text == "Let's try $\\frac{1}{2}$ first!")
        #expect(m[1].state == .done)
        #expect(m[1].turnId == "t2")
        #expect(m[1].notes == ["1 of 4 problems couldn't be checked, so I left it out."])
        #expect(board.runs == [Self.actions])
        // the request: the screen, its picture (it has work on it), the chat's screen
        let r = t.requests[0]
        #expect(r.boardId == "board-1" && r.message == "3 more like these" && r.screenId == "page:one")
        #expect(r.screen.student == ["2x + 3 = 11"] && r.screen.image == "data:image/jpeg;base64,AAAA")
        #expect(r.history.isEmpty)
        // read aloud: started, fed the reply without the board block's tag, finished with the final words once
        #expect(speech.log.first == "start")
        #expect(!speech.log.contains { $0.contains("<boa") })
        #expect(speech.log.filter { $0.hasPrefix("finish:") } == ["finish:Let's try $\\frac{1}{2}$ first!"])
    }

    @Test func noPictureOfAnEmptyScreenAndTheChatSoFarGoesWithTheNextAsk() async {
        let t = FakeTransport()
        t.script([.event(.reply("Hi!")), .event(.actions(AskActions(actions: [], notes: []))), .event(.done(AskDone(model: "m", ms: 1)))])
        t.script([.event(.reply("Sure.")), .event(.done(AskDone(model: "m", ms: 1)))])
        let board = FakeBoard()
        board.imageURL = "data:image/jpeg;base64,AAAA"
        let s = session(t, board)
        s.send("hello")
        #expect(await eventually { !s.busy })
        s.send("and again")
        #expect(await eventually { !s.busy && t.requests.count == 2 })
        #expect(t.requests[0].screen.image == nil)
        #expect(t.requests[1].history == [AskTurn(role: .user, text: "hello"), AskTurn(role: .tutor, text: "Hi!")])
        #expect(board.runs.isEmpty)
    }

    @Test func aStreamWithNoWordsAndNoActionsSaysSo() async {
        let t = FakeTransport()
        t.script([.event(.done(AskDone(model: "m", ms: 1)))])
        let s = session(t, FakeBoard())
        s.send("hmm")
        #expect(await eventually { !s.busy })
        #expect(s.messages[1].text == AskCopy.empty)
    }

    @Test func outOfInkIsAGrownUpsJobAndNeverTryAgain() async {
        let t = FakeTransport()
        let failure = HTTPFailure(status: 402, code: "ink_empty", message: "Out of ink")
        t.script([.fail(APIError.http(failure))])
        let s = session(t, FakeBoard())
        var reported: [ChatError] = []
        s.onFailure = { e, _ in reported.append(e) }
        s.send("help")
        #expect(await eventually { !s.busy })
        let m = s.messages[1]
        #expect(m.state == .error)
        #expect(m.text == AskCopy.Errors.ink)
        #expect(m.text.contains("grown-up"))
        #expect(m.retryText == nil)
        #expect(reported.map(\.kind) == [.ink])
    }

    @Test func rateLimitedSaysHowLongAndOffersTryAgainWhichSendsTheSameWordsOnce() async {
        let t = FakeTransport()
        t.script([.fail(APIError.http(HTTPFailure(status: 429, code: "rate_limited", message: "slow", retryAfterMs: 4200)))])
        t.script([.event(.reply("Here you go.")), .event(.done(AskDone(model: "m", ms: 1)))])
        let s = session(t, FakeBoard())
        s.send("5 problems")
        #expect(await eventually { !s.busy })
        #expect(s.messages[1].text == "That's a lot of questions. Try again in 5 s.")
        #expect(s.messages[1].error?.retry == true)
        s.retry(s.messages[1].id)
        #expect(await eventually { !s.busy && t.requests.count == 2 })
        #expect(s.messages.count == 2)
        #expect(s.messages[1].text == "Here you go.")
        // the same message id: the route saves the turn once
        #expect(t.requests[0].clientId == t.requests[1].clientId)
    }

    @Test func errorEventsByTheirCode() {
        #expect(ChatView.error(for: StreamError(code: "credits_exhausted", message: "x", status: 503)).message == AskCopy.Errors.resting)
        #expect(ChatView.error(for: StreamError(code: "timeout", message: "x")).kind == .timeout)
        #expect(ChatView.error(for: StreamError(code: "rate_limited", message: "x", status: 429)).kind == .rateLimited)
        #expect(ChatView.error(for: StreamError(code: "upstream", message: "x")) == ChatError(kind: .other, message: AskCopy.Errors.other, retry: true))
        #expect(ChatView.error(for: APIError.timeout).kind == .timeout)
        #expect(ChatView.error(for: APIError.network(.notConnectedToInternet)).kind == .network)
        #expect(ChatView.error(for: APIError.incomplete).retry)
        #expect(ChatView.error(for: APIError.http(HTTPFailure(status: 401, code: "unauthorized", message: "x"))) == ChatError(kind: .unauthorized, message: AskCopy.Errors.unauthorized, retry: false))
        // Agathon Unlimited's daily cap is a rate limit, never "out of ink"
        let fair = HTTPFailure(status: 429, code: "rate_limited", message: "x", body: .object(["reason": .string("fair_use")]))
        #expect(ChatView.error(for: APIError.http(fair)).kind == .rateLimited)
    }

    @Test func stopKeepsWhatCameAndIsNotAFailure() async {
        let t = FakeTransport()
        t.script([.event(.delta("Half a thought")), .hold, .event(.reply("never"))])
        let speech = FakeSpeech()
        let s = session(t, FakeBoard(), speech: speech)
        var failures = 0
        s.onFailure = { _, _ in failures += 1 }
        s.send("explain")
        #expect(await eventually { s.messages.last?.text == "Half a thought" })
        #expect(s.canStop)
        s.stop()
        #expect(await eventually { !s.busy })
        t.release()
        let m = s.messages[1]
        #expect(m.state == .done && m.stopped)
        #expect(m.text == "Half a thought")
        #expect(failures == 0)
        #expect(speech.log.last == "stop")
    }

    @Test func aDroppedConnectionAfterTheBoardStartedFinishesTheWritingWithANoteNotTryAgain() async {
        let t = FakeTransport()
        t.script([.event(.reply("Writing them now.")), .event(.actions(AskActions(actions: Self.actions, notes: []))), .fail(APIError.incomplete)])
        let board = FakeBoard()
        let s = session(t, board)
        s.send("3 problems")
        #expect(await eventually { !s.busy })
        let m = s.messages[1]
        #expect(m.state == .done)
        #expect(m.retryText == nil)
        #expect(m.notes.contains(AskCopy.cutOff))
        #expect(board.runs.count == 1)
    }

    @Test func aChatPerScreenAndTheTutorsNewScreenTakesTheExchangeWithIt() async {
        let t = FakeTransport()
        t.script([.event(.reply("On a new screen.")), .event(.actions(AskActions(actions: Self.actions, notes: []))),
                  .event(.done(AskDone(model: "m", ms: 1, turnId: "tt", userTurnId: "ut")))])
        let board = FakeBoard()
        board.startsScreen = AskScreenRef(id: "page:two", index: 2)
        let s = session(t, board)
        s.send("6 more")
        #expect(await eventually { !s.busy })
        #expect(s.messages(screenId: "page:one").isEmpty)
        #expect(s.messages(screenId: "page:two").map(\.text) == ["6 more", "On a new screen."])
        #expect(s.screen.id == "page:two")
        #expect(await eventually { t.moves.count == 1 })
        #expect(t.moves[0].turnIds == ["ut", "tt"] && t.moves[0].screenId == "page:two")
        // the kid going back shows the first screen's (now empty) chat and its hello
        board.move(to: AskScreenRef(id: "page:one", index: 1))
        #expect(s.messages.isEmpty)
    }

    @Test func theSavedChatComesFirstOncePerScreenWithItsHello() async {
        let t = FakeTransport()
        t.histories["page:one"] = (AskHistoryResponse(turns: [
            AskStoredTurn(id: "a", role: .user, text: "what is 2+2"), AskStoredTurn(id: "b", role: .tutor, text: "It's 4.", notes: ["n"]),
        ], hello: nil), false)
        t.histories["page:two"] = (AskHistoryResponse(turns: [], hello: AskHello(greeting: "New screen! What should we work on?", chips: ["3 more on dividing fractions"])), false)
        let board = FakeBoard()
        let s = session(t, board)
        s.appeared()
        #expect(await eventually { s.messages.count == 2 })
        #expect(s.messages[0].id == "saved_a" && s.messages[1].notes == ["n"] && s.messages[1].saved)
        #expect(t.historyCalls.first??.first == true)
        board.move(to: AskScreenRef(id: "page:two", index: 2))
        #expect(await eventually { s.hello != nil })
        #expect(s.hello?.greeting == "New screen! What should we work on?")
        #expect(s.hello?.chips.first == "3 more on dividing fractions")
        #expect(t.historyCalls.last??.first == false)
        // read once per screen: back and forth reads nothing again
        board.move(to: AskScreenRef(id: "page:one", index: 1))
        board.move(to: AskScreenRef(id: "page:two", index: 2))
        try? await Task.sleep(for: .milliseconds(50))
        #expect(t.historyCalls.count == 2)
    }

    @Test func aReadWorthRetryingIsTriedAgainOnTheNextView() async {
        let t = FakeTransport()
        t.histories["page:one"] = (nil, true)
        let board = FakeBoard()
        let s = session(t, board)
        s.appeared()
        #expect(await eventually { t.historyCalls.count == 1 && s.hello != nil })
        t.histories["page:one"] = (AskHistoryResponse(turns: [AskStoredTurn(id: "x", role: .user, text: "hi"), AskStoredTurn(id: "y", role: .tutor, text: "Hello!")], hello: nil), false)
        s.appeared()
        #expect(await eventually { s.messages.count == 2 })
    }

    @Test func theHelloLeadsWithMoreLikeTheseWhenTheScreenHasWork() async {
        let t = FakeTransport()
        t.histories["page:one"] = (AskHistoryResponse(turns: [], hello: AskHello(greeting: "Welcome back, Maya!", chips: ["3 more like last time", "Practice my weak spots"])), false)
        let board = FakeBoard()
        board.shot = AskScreen(empty: false, student: ["x = 1"])
        let s = session(t, board)
        s.appeared()
        #expect(await eventually { s.hello != nil && s.screenHasWork })
        #expect(s.hello?.greeting == "Welcome back, Maya!")
        #expect(s.hello?.chips == [moreLikeTheseChip, "Practice my weak spots"])
    }
}

/// The pure view logic (chatView.test.ts).
struct ChatViewTests {
    @Test func helloDefaultsByGradeAndScreen() {
        let first = ChatView.hello(nil, grade: 1, screenHasWork: false, screenIndex: 1)
        #expect(first.greeting == AskCopy.hello)
        #expect(first.chips == ["5 adding problems", "What is half of 10?", "Why is the sky blue?"])
        #expect(ChatView.hello(nil, grade: nil, screenHasWork: false, screenIndex: 3).greeting == AskCopy.newScreen)
        #expect(ChatView.hello(nil, grade: 7, screenHasWork: true, screenIndex: 1).chips.first == moreLikeTheseChip)
        #expect(ChatView.hello(AskHello(greeting: " ", chips: ["a"]), grade: 7, screenHasWork: false, screenIndex: 1).greeting == AskCopy.hello)
        #expect(ChatView.hello(AskHello(greeting: "Hi", chips: ["a", "b", "c", "d", "e"]), grade: nil, screenHasWork: true, screenIndex: 1).chips.count == ChatView.maxChips)
    }

    @Test func historyIsFinishedTurnsOnlyCappedAndPaired() {
        var msgs: [ChatMessage] = []
        for i in 0..<10 {
            msgs.append(ChatMessage(id: "u\(i)", role: .user, text: "q\(i)"))
            msgs.append(ChatMessage(id: "t\(i)", role: .tutor, text: "a\(i)", state: .done))
        }
        msgs.append(ChatMessage(id: "u-failed", role: .user, text: "lost"))
        msgs.append(ChatMessage(id: "t-failed", role: .tutor, text: "Oops", state: .error))
        msgs.append(ChatMessage(id: "u-stopped", role: .user, text: "stop me"))
        msgs.append(ChatMessage(id: "t-stopped", role: .tutor, text: AskCopy.stopped, state: .done, stopped: true))
        let h = ChatView.history(msgs)
        #expect(h.count == AskLimits.turns)
        #expect(h.last == AskTurn(role: .tutor, text: "a9"))
        #expect(!h.contains { $0.text == "lost" || $0.text == "stop me" || $0.text == "Oops" })
        let long = ChatView.history([ChatMessage(id: "u", role: .user, text: String(repeating: "x", count: 3000)), ChatMessage(id: "t", role: .tutor, text: "ok", state: .done)])
        #expect(long[0].text.count == AskLimits.turnText)
    }

    @Test func theProblemTypedEarlierWhenItLeftTheTurns() {
        let problem = "O is the center of the circle and OR = 5. What is RS²?"
        let msgs = [ChatMessage(id: "1", role: .user, text: problem), ChatMessage(id: "2", role: .tutor, text: "Let's see", state: .done),
                    ChatMessage(id: "3", role: .user, text: "now explain")]
        #expect(ChatView.problem(msgs, sent: []) == problem)
        #expect(ChatView.problem(msgs, sent: [AskTurn(role: .user, text: problem)]) == nil)
        #expect(ChatView.problem([ChatMessage(id: "1", role: .user, text: "5 two-step equations please, with = signs")], sent: []) == nil)
    }

    @Test func shownReplyHidesTheBoardBlockAndItsHalfTag() {
        #expect(ChatView.shownReply("Here you go. <board>{\"actions\":[]}</board>") == "Here you go. ")
        #expect(ChatView.shownReply("Here you go. <bo") == "Here you go. ")
        #expect(ChatView.shownReply("x < 3") == "x < 3")
        #expect(ChatView.shownReply("a <") == "a ")
    }

    @Test func mergeSavedNeverShowsAnExchangeTwice() {
        let saved = ChatView.messages(fromHistory: [
            AskStoredTurn(id: "1", role: .user, text: "hi"), AskStoredTurn(id: "2", role: .tutor, text: "Hello"),
            AskStoredTurn(id: "3", role: .user, text: "2+2"), AskStoredTurn(id: "4", role: .tutor, text: "4"),
        ])
        let cur = [ChatMessage(id: "u", role: .user, text: "2+2"), ChatMessage(id: "t", role: .tutor, text: "4", state: .done, turnId: "4")]
        #expect(ChatView.mergeSaved(saved, into: cur).map(\.text) == ["hi", "Hello", "2+2", "4"])
        let unsaved = [ChatMessage(id: "u", role: .user, text: "2+2"), ChatMessage(id: "t", role: .tutor, text: "4", state: .done)]
        #expect(ChatView.mergeSaved(saved, into: unsaved).map(\.id) == ["saved_1", "saved_2", "u", "t"])
        #expect(ChatView.mergeSaved(saved, into: []).count == 4)
    }

    @Test func spokenWordsWaitInTheBoxWhileTheTutorAnswers() {
        #expect(ChatView.spokenWords(busy: false, draft: "typed", said: " what is 3 times 4 ") == ("what is 3 times 4", "typed"))
        let waiting = ChatView.spokenWords(busy: true, draft: "and ", said: "what next")
        #expect(waiting.send == nil && waiting.draft == "and what next")
        #expect(ChatView.spokenWords(busy: true, draft: "", said: "  ").draft == "")
    }

    @Test func threadsAndMoves() {
        #expect(ChatView.threadKey("b", "page:x") == "b#page:x")
        #expect(ChatView.threadKey("b", nil) == "b")
        let a = [ChatMessage(id: "1", role: .user, text: "a"), ChatMessage(id: "2", role: .tutor, text: "b")]
        let moved = ChatView.moveExchange(from: a, to: [ChatMessage(id: "0", role: .user, text: "z")], ids: ["2"])
        #expect(moved.from.map(\.id) == ["1"] && moved.to.map(\.id) == ["0", "2"])
        #expect(AskScreenRef(id: "page:a", index: 1).historyScreen == AskHistoryScreen(id: "page:a", first: true))
        #expect(AskScreenRef(id: "page:a", index: 3).historyScreen?.first == false)
        #expect(AskScreenRef.none.historyScreen == nil)
    }

    @Test func idsTheRouteTakes() {
        let ids = (0..<50).map { _ in ChatView.nextId() }
        #expect(Set(ids).count == 50)
        #expect(ids.allSatisfy { $0.range(of: "^[A-Za-z0-9_-]{1,64}$", options: .regularExpression) != nil })
        #expect(AskCopy.waitPhrase(4) == "4 s" && AskCopy.waitPhrase(600) == "10 min")
    }
}
