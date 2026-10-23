import AgathonKit
import Foundation
import Testing
@testable import AgathonSATCore

/// The client sends what the routes read (docs/SAT-MODE.md, "Routes") with the app's usual auth.
struct ClientTests {
    final class Transport: HTTPTransport, @unchecked Sendable {
        var requests: [URLRequest] = []
        var replies: [(Int, String)]

        init(_ replies: [(Int, String)]) {
            self.replies = replies
        }

        func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
            requests.append(request)
            let (status, body) = replies.isEmpty ? (200, "{}") : replies.removeFirst()
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            return (Data(body.utf8), response)
        }

        func stream(for request: URLRequest) async throws -> (HTTPURLResponse, AsyncThrowingStream<Data, Error>) {
            throw URLError(.unsupportedURL)
        }
    }

    func client(_ t: Transport) -> SATClient {
        let api = APIClient(baseURL: URL(string: "https://example.test")!, transport: t, token: { "tok" })
        return SATClient(api: api, timeZone: { TimeZone(identifier: "America/New_York")! })
    }

    func json(_ r: URLRequest?) -> [String: Any]? {
        r?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    }

    @Test func nextAsksForASet() async throws {
        let t = Transport([(200, #"{"questions":[]}"#), (200, #"{"questions":[]}"#)])
        let c = client(t)
        _ = try await c.next(SATNextRequest())
        _ = try await c.next(SATNextRequest(count: 10, domain: .psda, skill: "ratios, rates, proportions, units", difficulty: 2))
        #expect(t.requests[0].url?.absoluteString == "https://example.test/api/sat/next?count=10&tz=America/New_York")
        let q = URLComponents(url: t.requests[1].url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
        #expect(q.first { $0.name == "domain" }?.value == "psda")
        #expect(q.first { $0.name == "skill" }?.value == "ratios, rates, proportions, units")
        #expect(q.first { $0.name == "difficulty" }?.value == "2")
        #expect(t.requests[0].value(forHTTPHeaderField: "Authorization") == "Bearer tok")
    }

    @Test func attemptsTutorAndProgress() async throws {
        let t = Transport([(200, #"{"ok":true}"#), (200, #"{"allowed":true,"used_today":3,"cap":5,"unlimited":false}"#), (200, #"{"answered":0,"correct":0}"#)])
        let c = client(t)
        _ = try await c.record(SATAttempt(questionId: "psda-percentages-0001", chosen: "3/4", correct: true, seconds: 30, usedTutor: false))
        let pass = try await c.tutorPass(questionId: "psda-percentages-0001")
        let progress = try await c.progress()
        #expect(t.requests[0].url?.path == "/api/sat/attempts")
        #expect(t.requests[0].httpMethod == "POST")
        #expect(json(t.requests[0])?["used_tutor"] as? Bool == false)
        // v2: the deck's days are the student's
        #expect(json(t.requests[0])?["tz"] as? String == "America/New_York")
        #expect(json(t.requests[0])?["question_id"] as? String == "psda-percentages-0001")
        #expect(t.requests[1].url?.path == "/api/sat/tutor")
        #expect(json(t.requests[1])?["question_id"] as? String == "psda-percentages-0001")
        #expect(json(t.requests[1])?["tz"] as? String == "America/New_York")
        #expect(pass.allowed && pass.usedToday == 3)
        #expect(t.requests[2].url?.absoluteString == "https://example.test/api/sat/progress?tz=America/New_York")
        #expect(progress.answered == 0)
    }

    @Test func theServersRefusalsAreAPIErrors() async throws {
        let t = Transport([(429, #"{"error":"rate_limited","retryAfterMs":2000}"#)])
        await #expect(throws: APIError.self) { try await client(t).tutorPass(questionId: "psda-percentages-0001") }
    }
}
