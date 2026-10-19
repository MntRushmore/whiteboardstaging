import Foundation
import Testing
@testable import AgathonKit

struct ClientErrorReporterTests {
    private let release = AppRelease(version: "1.2", build: "34")

    final class Clock: @unchecked Sendable {
        private let lock = NSLock()
        private var _now = Date(timeIntervalSince1970: 1_792_230_072)
        var now: Date { lock.withLock { _now } }
        func advance(_ seconds: TimeInterval) { lock.withLock { _now += seconds } }
    }

    @Test func releaseIsIOSVersionBuild() {
        #expect(release.string == "ios-1.2-34")
        #expect(AppRelease(version: String(repeating: "9", count: 80), build: "1").string.count == 64)
    }

    @Test func aReportPassesTheServersChecks() {
        let reporter = ClientErrorReporter(api: Fixtures.client(FakeTransport()), release: release)
        let report = reporter.makeReport(
            message: "  Couldn't load your boards  ", stack: nil, path: "board/123?token=secret#x", boardId: "not-a-uuid",
            kind: "Live.Boards", level: .warn, code: String(repeating: "c", count: 60), requestId: "bad id", vercelError: "nope"
        )
        #expect(report.source == "ios")
        #expect(report.release == "ios-1.2-34")
        #expect(report.message == "Couldn't load your boards")
        #expect(report.path == "/board/123")
        #expect(report.boardId == nil)
        #expect(report.kind == nil)
        #expect(report.level == "warn")
        #expect(report.code?.count == 40)
        #expect(report.requestId == nil)
        #expect(report.vercelError == nil)
        #expect(report.userAgent.hasPrefix("Agathon-iOS/1.2 (34;"))

        let long = reporter.makeReport(message: String(repeating: "m", count: 5000), stack: String(repeating: "s", count: 9000),
                                       path: "/", boardId: "0b9c2f1e-6a1d-4c8e-9f57-3d2b8a7c6e51", kind: "live.boards",
                                       level: nil, code: nil, requestId: "req_1", vercelError: nil)
        #expect(long.message.count == 1000)
        #expect(long.stack?.count == 4000)
        #expect(long.boardId == "0b9c2f1e-6a1d-4c8e-9f57-3d2b8a7c6e51")
        #expect(long.kind == "live.boards")
        #expect(long.requestId == "req_1")
    }

    @Test func postsJSONToClientErrors() async throws {
        let transport = FakeTransport(replies: [FakeTransport.Reply(status: 204)])
        let reporter = ClientErrorReporter(api: Fixtures.client(transport, token: nil), release: release)
        let failure = HTTPFailure(status: 502, code: "upstream_error", message: "x", requestId: "req_9")
        let sent = await reporter.reportUserError(kind: "live.boards", code: "load_failed", message: "Couldn't load your boards",
                                                  path: "/boards", error: APIError.http(failure))
        #expect(sent)
        let request = try #require(transport.requests.first)
        #expect(request.url?.path == "/api/client-errors")
        #expect(request.httpMethod == "POST")
        // Signed out: no token, and that is fine (the route is public).
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        let body = try #require(Fixtures.bodyJSON(request))
        #expect(body["source"]?.stringValue == "ios")
        #expect(body["kind"]?.stringValue == "live.boards")
        #expect(body["level"]?.stringValue == "error")
        #expect(body["path"]?.stringValue == "/boards")
        #expect(body["release"]?.stringValue == "ios-1.2-34")
        #expect(body["requestId"]?.stringValue == "req_9")
        #expect(body["stack"] == nil)
    }

    @Test func theSameErrorIsSentOncePerWindow() async throws {
        let transport = FakeTransport(replies: Array(repeating: FakeTransport.Reply(status: 204), count: 5))
        let clock = Clock()
        let reporter = ClientErrorReporter(api: Fixtures.client(transport), release: release, now: { clock.now })
        #expect(await reporter.reportCrash(message: "boom", path: "/boards"))
        #expect(await !reporter.reportCrash(message: "boom", path: "/boards"))
        #expect(await reporter.reportCrash(message: "other", path: "/boards"))
        clock.advance(61)
        #expect(await reporter.reportCrash(message: "boom", path: "/boards"))
        #expect(transport.requests.count == 3)
    }

    @Test func aLaunchHasABudget() async throws {
        let transport = FakeTransport(replies: Array(repeating: FakeTransport.Reply(status: 204), count: 5))
        let reporter = ClientErrorReporter(api: Fixtures.client(transport), release: release, maxReports: 2)
        #expect(await reporter.reportCrash(message: "a", path: "/"))
        #expect(await reporter.reportCrash(message: "b", path: "/"))
        #expect(await !reporter.reportCrash(message: "c", path: "/"))
        #expect(transport.requests.count == 2)
    }

    @Test func aFailedSendNeverThrows() async {
        let transport = FakeTransport(replies: [.failing(URLError(.notConnectedToInternet))])
        let reporter = ClientErrorReporter(api: Fixtures.client(transport), release: release)
        #expect(await !reporter.reportCrash(message: "offline", path: "/"))
    }
}
