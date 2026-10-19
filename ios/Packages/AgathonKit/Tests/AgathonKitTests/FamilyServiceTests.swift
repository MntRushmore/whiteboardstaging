import Foundation
import Testing
@testable import AgathonKit

struct FamilyServiceTests {
    final class Adopted: @unchecked Sendable {
        private let lock = NSLock()
        private var _results: [SwitchResult] = []
        var results: [SwitchResult] { lock.withLock { _results } }
        func add(_ result: SwitchResult) { lock.withLock { _results.append(result) } }
    }

    private func service(_ transport: FakeTransport, adopted: Adopted = Adopted()) -> FamilyService {
        FamilyService(api: Fixtures.client(transport)) { adopted.add($0) }
    }

    private static let solo = #"{"role":"solo","me":"u1","parentId":"u1","hasPin":false,"members":[{"userId":"u1","displayName":"Grown-up","avatar":null,"grade":null,"isParent":true,"stats":null}]}"#

    @Test func loadSendsTheTimeZoneOffsetAsTheBrowserDoes() async throws {
        let transport = FakeTransport(replies: [.json(200, Self.solo)])
        let winter = try #require(PostgresDate.parse("2026-01-15T12:00:00Z"))
        let state = try await service(transport).load(timeZone: try #require(TimeZone(identifier: "America/New_York")), now: winter)
        #expect(state.role == .solo)
        let request = try #require(transport.requests.first)
        #expect(request.httpMethod == "GET")
        #expect(request.url?.absoluteString == "https://example.test/api/family?tz=300")
    }

    @Test func tzOffsetMatchesGetTimezoneOffset() throws {
        let date = try #require(PostgresDate.parse("2026-01-15T12:00:00Z"))
        #expect(FamilyService.tzOffset(try #require(TimeZone(identifier: "UTC")), at: date) == 0)
        #expect(FamilyService.tzOffset(try #require(TimeZone(identifier: "Asia/Kolkata")), at: date) == -330)
        #expect(FamilyService.tzOffset(try #require(TimeZone(identifier: "America/Los_Angeles")), at: date) == 480)
    }

    @Test func switchingToAKidSendsNoPinAndTakesTheSession() async throws {
        let transport = FakeTransport(replies: [.json(200, #"{"access_token":"kid.access.token","refresh_token":"kid-refresh"}"#)])
        let adopted = Adopted()
        try await service(transport, adopted: adopted).switchProfile(to: "0b9c2f1e-6a1d-4c8e-9f57-3d2b8a7c6e51")
        let request = try #require(transport.requests.first)
        #expect(request.url?.path == "/api/family/switch")
        // The schema is strict: no `pin` key unless there is a PIN.
        #expect(Fixtures.bodyJSON(request) == .object(["to": .string("0b9c2f1e-6a1d-4c8e-9f57-3d2b8a7c6e51")]))
        #expect(adopted.results == [SwitchResult(accessToken: "kid.access.token", refreshToken: "kid-refresh")])
    }

    @Test func switchingToTheGrownUpSendsThePin() async throws {
        let transport = FakeTransport(replies: [.json(200, #"{"access_token":"a.b.c","refresh_token":"r"}"#)])
        try await service(transport).switchProfile(to: "p1", pin: "0420")
        #expect(Fixtures.bodyJSON(try #require(transport.requests.first)) == .object(["to": .string("p1"), "pin": .string("0420")]))
    }

    @Test func aWrongPinIsAnHTTPFailureAndNoSessionIsTaken() async throws {
        let transport = FakeTransport(replies: [.json(403, #"{"error":"invalid_request","message":"That PIN isn't right.","reason":"wrong_pin","triesLeft":4}"#)])
        let adopted = Adopted()
        do {
            try await service(transport, adopted: adopted).switchProfile(to: "p1", pin: "1111")
            Issue.record("expected a failure")
        } catch let error as APIError {
            #expect(error.failure?.reason == "wrong_pin")
            #expect(error.failure?.triesLeft == 4)
        }
        #expect(adopted.results.isEmpty)
    }

    @Test func aMalformedPinNeverLeavesTheDevice() async throws {
        let transport = FakeTransport()
        await #expect(throws: FamilyError.pinFormat) {
            try await service(transport).switchProfile(to: "p1", pin: "12a4")
        }
        await #expect(throws: FamilyError.pinFormat) {
            try await service(transport).setPin("12345")
        }
        #expect(transport.requests.isEmpty)
        #expect(FamilyService.isValidPin("0000"))
        #expect(!FamilyService.isValidPin("١٢٣٤")) // Arabic-Indic digits are not the server's \d
    }

    @Test func setPin() async throws {
        let transport = FakeTransport(replies: [.json(200, #"{"hasPin":true}"#)])
        try await service(transport).setPin("2468")
        let request = try #require(transport.requests.first)
        #expect(request.url?.path == "/api/family/pin")
        #expect(Fixtures.bodyJSON(request) == .object(["pin": .string("2468")]))
    }
}
