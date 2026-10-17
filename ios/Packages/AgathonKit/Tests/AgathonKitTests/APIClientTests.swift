import Foundation
import Testing
@testable import AgathonKit

struct APIClientTests {
    struct OK: Decodable, Equatable { let ok: Bool }

    @Test func getCarriesTheBearerTokenAndAcceptsJSON() async throws {
        let api = Fixtures.client(FakeTransport())
        let request = try await api.makeRequest(.get, "/api/family", query: [URLQueryItem(name: "tz", value: "300")])
        #expect(request.httpMethod == "GET")
        #expect(request.url?.absoluteString == "https://example.test/api/family?tz=300")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer \(Fixtures.token)")
        #expect(request.value(forHTTPHeaderField: "Accept") == "application/json")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == nil)
        #expect(request.httpBody == nil)
    }

    @Test func postSendsJSON() async throws {
        let transport = FakeTransport(replies: [.json(200, #"{"ok":true}"#)])
        let api = Fixtures.client(transport)
        let answer: OK = try await api.post("/api/family/pin", body: ["pin": "1234"])
        #expect(answer == OK(ok: true))
        let request = try #require(transport.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
        #expect(Fixtures.bodyJSON(request) == .object(["pin": .string("1234")]))
    }

    @Test func aBaseURLWithAPortOrSlashJoinsCleanly() {
        let local = APIClient(baseURL: URL(string: "http://localhost:3101")!, transport: FakeTransport(), token: { nil })
        #expect(local.url(for: "/api/live/ask").absoluteString == "http://localhost:3101/api/live/ask")
        let slashed = APIClient(baseURL: URL(string: "https://example.test/")!, transport: FakeTransport(), token: { nil })
        #expect(slashed.url(for: "/api/family").absoluteString == "https://example.test/api/family")
    }

    @Test func noSessionFailsBeforeAnyRequest() async throws {
        let transport = FakeTransport(replies: [.json(200, "{}")])
        let api = Fixtures.client(transport, token: nil)
        await #expect(throws: APIError.notSignedIn) {
            let _: EmptyResponse = try await api.get("/api/family")
        }
        #expect(transport.requests.isEmpty)
    }

    @Test func optionalAuthSendsTheTokenOnlyWhenThereIsOne() async throws {
        let signedOut = try await Fixtures.client(FakeTransport(), token: nil).makeRequest(.post, "/api/client-errors", body: Data("{}".utf8), auth: .optional)
        #expect(signedOut.value(forHTTPHeaderField: "Authorization") == nil)
        let signedIn = try await Fixtures.client(FakeTransport()).makeRequest(.post, "/api/client-errors", body: Data("{}".utf8), auth: .optional)
        #expect(signedIn.value(forHTTPHeaderField: "Authorization") == "Bearer \(Fixtures.token)")
    }

    @Test func clockSkewIsRetriedOnceAfterASecond() async throws {
        let transport = FakeTransport(replies: [
            .json(401, #"{"code":"PGRST303","details":null,"hint":null,"message":"JWT issued at future"}"#),
            .json(200, #"{"ok":true}"#),
        ])
        let sleeper = SleepRecorder()
        let answer: OK = try await Fixtures.client(transport, sleeper: sleeper).get("/api/family")
        #expect(answer == OK(ok: true))
        #expect(transport.requests.count == 2)
        #expect(sleeper.sleeps == [.milliseconds(1100)])
    }

    @Test func clockSkewIsRetriedOnlyOnce() async throws {
        let skew = FakeTransport.Reply.json(401, #"{"code":"PGRST303","message":"JWT issued at future"}"#)
        let transport = FakeTransport(replies: [skew, skew, .json(200, "{}")])
        do {
            let _: EmptyResponse = try await Fixtures.client(transport).get("/api/family")
            Issue.record("expected a failure")
        } catch let error as APIError {
            #expect(error.status == 401)
        }
        #expect(transport.requests.count == 2)
    }

    @Test func aPlain401IsNotRetried() async throws {
        let transport = FakeTransport(replies: [.json(401, #"{"error":"unauthorized","message":"You need to be signed in to use this feature."}"#)])
        let sleeper = SleepRecorder()
        do {
            let _: EmptyResponse = try await Fixtures.client(transport, sleeper: sleeper).get("/api/family")
            Issue.record("expected a failure")
        } catch let error as APIError {
            #expect(error.isUnauthorized)
        }
        #expect(transport.requests.count == 1)
        #expect(sleeper.sleeps.isEmpty)
    }

    @Test func errorsKeepTheRequestId() async throws {
        let transport = FakeTransport(replies: [.json(402, #"{"error":"ink_empty","message":"Out of ink","remaining":2,"cost":3}"#,
                                                      headers: ["X-Request-Id": "req-42"])])
        do {
            let _: EmptyResponse = try await Fixtures.client(transport).post("/api/live/recognize", body: ["x": 1])
            Issue.record("expected a failure")
        } catch let error as APIError {
            #expect(error.isOutOfInk)
            #expect(error.requestId == "req-42")
            #expect(error.failure?.remaining == 2)
        }
    }

    @Test func transportFailuresAreTyped() async throws {
        let stalled = FakeTransport(replies: [.failing(URLError(.timedOut))])
        await #expect(throws: APIError.timeout) {
            let _: EmptyResponse = try await Fixtures.client(stalled).get("/api/family")
        }
        let offline = FakeTransport(replies: [.failing(URLError(.notConnectedToInternet))])
        await #expect(throws: APIError.network(.notConnectedToInternet)) {
            let _: EmptyResponse = try await Fixtures.client(offline).get("/api/family")
        }
    }

    @Test func aBodyThatIsNotTheRoutesShapeIsInvalidResponse() async throws {
        let transport = FakeTransport(replies: [.json(200, #"{"nope":1}"#)])
        do {
            let _: OK = try await Fixtures.client(transport).get("/api/x")
            Issue.record("expected a failure")
        } catch let error as APIError {
            guard case .invalidResponse = error else { Issue.record("\(error)"); return }
        }
    }

    @Test func emptyResponseAcceptsNoContent() async throws {
        let transport = FakeTransport(replies: [FakeTransport.Reply(status: 204)])
        let answer: EmptyResponse = try await Fixtures.client(transport).post("/api/client-errors", body: ["a": "b"])
        #expect(answer == EmptyResponse())
    }
}
