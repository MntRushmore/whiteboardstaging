import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation
import Testing
@testable import AgathonLive

/// SAT mode (docs/SAT-MODE.md, "Server enforcement"): every live call made on an SAT page carries
/// `sat_question_id`, so the server can hold it to that question's free tutor pass; an ordinary
/// board's bodies are exactly as before.
@Suite(.serialized)
struct LiveRequestTagTests {
    func services(_ t: ScriptedTransport, tag: LiveRequestTag) -> LiveAPIServices {
        let api = APIClient(baseURL: URL(string: "https://example.test")!, transport: t, token: { "token" })
        return LiveAPIServices(api: api, live: LiveAPI(sse: SSEClient(api: api)), tag: tag)
    }

    // (the payload has no public initialiser: the brain makes it)
    static let payload = try! JSONDecoder().decode(RecognizerPayload.self, from: Data(#"{"strokes":{"x":[[0,10]],"y":[[0,0]]},"bounds":{"w":10,"h":1},"hash":"h","points":2}"#.utf8))

    @Test func everyLiveBodyCarriesTheQuestionOnAnSATPage() async throws {
        let t = ScriptedTransport()
        t.json["/api/live/recognize"] = (200, #"{"latex":"x = 5","text":"","kind":"math","confidence":0.97,"provider":"mathpix","ms":420}"#)
        t.json["/api/live/reread"] = (200, #"{"latex":"x = 5","changed":false,"model":"m","ms":1}"#)
        t.json["/api/live/setup"] = (200, #"{"lines":[],"model":"m","ms":1}"#)
        t.sse["/api/live/check"] = ["event: done\ndata: {\"count\":0,\"ms\":1}\n\n"]
        t.sse["/api/live/solve"] = ["event: done\ndata: {\"steps\":0,\"ms\":1}\n\n"]
        let tag = LiveRequestTag()
        let s = services(t, tag: tag)
        tag.satQuestionId = "algebra-linear-functions-0042"

        _ = try await s.recognize(RecognizeRequest(boardId: "b", lineId: "l", payload: Self.payload))
        _ = try await s.reread(RereadRequest(boardId: "b", lineId: "l", crop: "data:", latex: "x", above: [], below: []))
        _ = try await s.setup(SetupRequest(boardId: "b", lines: ["x"]))
        let region = RegionRect(x: 0, y: 0, w: 10, h: 10)
        for try await _ in s.check(CheckRequest(boardId: "b", mode: "feedback", region: region, lines: [], focusLineId: nil, userAsked: true)) {}
        for try await _ in s.solve(SolveRequest(boardId: "b", region: region, lines: [], fromLineId: nil, goal: nil)) {}

        for path in ["/api/live/recognize", "/api/live/reread", "/api/live/setup", "/api/live/check", "/api/live/solve"] {
            let body = try #require(t.body(path), "\(path) sent no body")
            #expect(body["sat_question_id"]?.stringValue == "algebra-linear-functions-0042", "\(path) lost the question")
            // the body's own fields are all still there
            #expect(body["boardId"]?.stringValue == "b", "\(path) lost its own fields")
        }
    }

    @Test func anOrdinaryBoardsBodiesAreUnchanged() async throws {
        let t = ScriptedTransport()
        t.json["/api/live/recognize"] = (200, #"{"latex":"x = 5","text":"","kind":"math","confidence":0.97,"provider":"mathpix","ms":420}"#)
        let s = services(t, tag: LiveRequestTag())
        _ = try await s.recognize(RecognizeRequest(boardId: "b", lineId: "l", payload: Self.payload))
        let body = try #require(t.body("/api/live/recognize"))
        #expect(body["sat_question_id"] == nil)
        let plain = try JSONSerialization.jsonObject(with: APIClient.encoder.encode(RecognizeRequest(boardId: "b", lineId: "l", payload: Self.payload))) as? [String: Any]
        #expect(body.objectValue?.keys.sorted() == plain?.keys.sorted())
    }

    @Test func theTagIsTakenWhenTheRequestIsMade() async throws {
        let t = ScriptedTransport()
        t.json["/api/live/recognize"] = (200, #"{"latex":"x","text":"","kind":"math","confidence":1,"provider":"mathpix","ms":1}"#)
        let tag = LiveRequestTag(satQuestionId: "psda-percentages-0001")
        let s = services(t, tag: tag)
        _ = try await s.recognize(RecognizeRequest(boardId: "b", lineId: "l", payload: Self.payload))
        #expect(t.body("/api/live/recognize")?["sat_question_id"]?.stringValue == "psda-percentages-0001")
        tag.satQuestionId = nil
        _ = try await s.recognize(RecognizeRequest(boardId: "b", lineId: "l", payload: Self.payload))
        #expect(t.body("/api/live/recognize")?["sat_question_id"] == nil)
    }
}
