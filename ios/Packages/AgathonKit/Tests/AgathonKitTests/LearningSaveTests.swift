import Foundation
import Supabase
import Testing
@testable import AgathonKit

/// The learning record's writes (`LearningRepository.saveAttempts`), as the web's store.ts makes
/// them: rows cleaned so a record the board made is never refused for a detail, parents before the
/// attempts that follow them, a refused row isolated from the rest, failures classified for the
/// save schedule — and the exact times both sides write.
@Suite(.serialized)
struct LearningSaveTests {
    static let id1 = "0F8FAD5B-D9CB-469F-A165-70867728950E"
    static let id2 = "7c9e6679-7425-40de-944b-e07fc1f90ae7"
    static let board = "5d0c6f1a-2b3c-4d5e-8f60-0123456789ab"

    func record(id: String = id1, parent: String? = nil, problem: String = "2x+3=11", origin: String = "student",
                outcome: String = "first_try", started: String = "2026-10-18T15:00:00.123Z", finished: String? = "2026-10-18T15:01:00.000Z",
                skill: String = "two_step_equations", course: String? = "algebra1", mistakes: [String: Int] = [:]) -> AttemptRecord {
        AttemptRecord(id: id, boardId: Self.board, problemLatex: problem, skill: skill, course: course, origin: origin, parentId: parent,
                      outcome: outcome, linesWritten: 3, linesRight: 2, linesRinged: 0, hints: 0, tutorSteps: 0, solves: 0, asks: 1,
                      mistakes: mistakes, activeMs: 61_000, startedAt: started, updatedAt: started, finishedAt: finished)
    }

    // MARK: - cleaning

    @Test func aRecordBecomesTheWebsRow() throws {
        let row = try LearningRepository.row(record()).get()
        #expect(row.id == Self.id1.lowercased(), "ids are lower case")
        #expect(row.boardId == Self.board)
        #expect(row.startedAt == "2026-10-18T15:00:00.123Z")
        #expect(row.finishedAt == "2026-10-18T15:01:00.000Z")
        let json = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(row)) as? [String: Any])
        #expect(Set(json.keys) == ["id", "board_id", "problem_latex", "skill", "course", "origin", "parent_id", "outcome", "lines_written",
                                   "lines_right", "lines_ringed", "hints", "tutor_steps", "solves", "asks", "mistakes", "active_ms",
                                   "started_at", "finished_at"], "every column the store writes, and no other")
        #expect(json["parent_id"] is NSNull, "nulls are sent: an upsert clears them")
        #expect(json["user_id"] == nil && json["updated_at"] == nil && json["created_at"] == nil)
    }

    @Test func detailsAreCleanedNotRefused() throws {
        var r = record(problem: "  \u{0}" + String(repeating: "é", count: 600) + "  ", skill: "made_up", course: "year9",
                       mistakes: ["sign": 3, "bogus": 2, "arithmetic": 0, "concept": 12_000])
        r = AttemptRecord(id: r.id, boardId: "not-a-board", problemLatex: r.problemLatex, skill: r.skill, course: r.course, origin: r.origin,
                          parentId: r.id, outcome: r.outcome, linesWritten: 40_000, linesRight: -2, linesRinged: 1, hints: 0, tutorSteps: 0,
                          solves: 0, asks: 0, mistakes: r.mistakes, activeMs: 99_999_999, startedAt: r.startedAt, finishedAt: "2025-12-31T23:59:59Z")
        let row = try LearningRepository.row(r).get()
        #expect(row.problemLatex.unicodeScalars.count == 500 && !row.problemLatex.contains("\u{0}"))
        #expect(row.skill == "other")
        #expect(row.course == nil)
        #expect(row.boardId == nil)
        #expect(row.parentId == nil, "an attempt never follows itself")
        #expect(row.linesWritten == 32_767 && row.linesRight == 0)
        #expect(row.mistakes == ["sign": 3, "concept": 9_999])
        #expect(row.activeMs == 14_400_000)
        #expect(row.finishedAt == nil, "a time before 2026 is dropped")
    }

    @Test func whatCannotBeARowIsRefused() {
        func refused(_ r: AttemptRecord) -> Bool {
            if case .failure(let e) = LearningRepository.row(r) { return e.code == .invalid }
            return false
        }
        #expect(refused(record(id: "att-1")))
        #expect(refused(record(origin: "board")))
        #expect(refused(record(outcome: "done")))
        #expect(refused(record(problem: "   ")))
        #expect(refused(record(started: "2025-06-01T00:00:00Z")))
        #expect(refused(record(started: "yesterday")))
    }

    @Test func parentsComeFirst() {
        let a = try! LearningRepository.row(record(id: Self.id1)).get()
        var b = try! LearningRepository.row(record(id: Self.id2, parent: Self.id1, origin: "now_you_try")).get()
        let layers = LearningRepository.parentsFirst([b, a])
        #expect(layers.map { $0.map(\.id) } == [[Self.id1.lowercased()], [Self.id2]])
        // a loop (never made by the board) goes as one last layer
        var a2 = a
        a2.parentId = b.id
        b.parentId = a2.id
        #expect(LearningRepository.parentsFirst([a2, b]).count == 1)
    }

    @Test func theWebsSkillListIsOurs() throws {
        // the repository's root, from this file: ios/Packages/AgathonKit/Tests/AgathonKitTests/
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let contracts = try String(contentsOf: root.appendingPathComponent("src/lib/learning/contracts.ts"), encoding: .utf8)
        let start = try #require(contracts.range(of: "export const SKILLS = ["))
        let end = try #require(contracts.range(of: "] as const satisfies readonly SkillDef[]", range: start.upperBound..<contracts.endIndex))
        let body = String(contracts[start.upperBound..<end.lowerBound])
        let regex = try NSRegularExpression(pattern: #"\{ id: "([a-z0-9_]+)""#)
        let ids = regex.matches(in: body, range: NSRange(body.startIndex..., in: body)).compactMap { Range($0.range(at: 1), in: body).map { String(body[$0]) } }
        #expect(ids.count > 50)
        #expect(ids == LearningRepository.skillIds)
        let hint = try String(contentsOf: root.appendingPathComponent("src/lib/learning/hint.ts"), encoding: .utf8)
        for kind in LearningRepository.mistakeKinds { #expect(hint.contains("\"\(kind)\",")) }
    }

    // MARK: - errors

    @Test func failuresAreClassifiedAsTheWebDoes() {
        func code(_ db: String?, _ status: Int?, _ message: String = "") -> LearningStoreError.Code {
            LearningStoreError.classify(dbCode: db, status: status, message: message)
        }
        #expect(code("PGRST205", 404) == .unavailable)
        #expect(code("42P01", nil) == .unavailable)
        #expect(code("42501", 403) == .unauthorized, "RLS: not the student's board")
        #expect(code("PGRST303", nil) == .unauthorized)
        #expect(code(nil, 401) == .unauthorized)
        #expect(code(nil, nil, "JWT expired") == .unauthorized)
        #expect(code("23514", 400) == .invalid)
        #expect(code("22P02", 400) == .invalid)
        #expect(code("PGRST102", 400) == .invalid)
        #expect(code(nil, 400) == .invalid)
        #expect(code(nil, 503) == .network)
        #expect(code("57014", nil) == .network)
        #expect(code("40P01", nil) == .network)
        #expect(code(nil, nil, "The network connection was lost.") == .network)
        #expect(code("XX000", 500) == .unknown)
        #expect(LearningStoreError.from(URLError(.notConnectedToInternet), "save").code == .network)
        #expect(LearningStoreError.from(PostgrestError(code: "23514", message: "violates check"), "save").code == .invalid)
    }

    // MARK: - times

    @Test func timesAreTheWebsToTheMillisecond() {
        #expect(LearningTime.iso(1_792_335_600_123) == "2026-10-18T15:00:00.123Z")
        #expect(LearningTime.iso(0) == "1970-01-01T00:00:00.000Z")
        #expect(LearningTime.iso(.nan) == "1970-01-01T00:00:00.000Z")
        #expect(LearningTime.iso(-1) == "1969-12-31T23:59:59.999Z")
        #expect(LearningTime.iso(1_709_164_800_000) == "2024-02-29T00:00:00.000Z")
        #expect(LearningTime.iso(1_792_335_600_123.9) == "2026-10-18T15:00:00.123Z", "a fraction of a millisecond is cut, as Date does")
        #expect(LearningTime.parse("2026-10-18T15:00:00.123Z") == 1_792_335_600_123)
        #expect(LearningTime.parse("2026-10-18T15:00:00Z") == 1_792_335_600_000)
        #expect(LearningTime.parse("2026-10-18T17:00:00.5+02:00") == 1_792_335_600_500)
        #expect(LearningTime.parse("2026-10-18") == nil)
        #expect(LearningTime.parse("not a time") == nil)
        for ms in stride(from: 1_767_225_600_000.0, to: 1_830_000_000_000, by: 7_777_777_777.0) {
            #expect(LearningTime.parse(LearningTime.iso(ms)) == ms)
        }
    }

    // MARK: - the upsert

    @Test func theUpsertIsTheWebs() async throws {
        let stub = StubSupabase()
        stub.reply = { _ in (201, Data()) }
        try await stub.repository.saveAttempts([record(id: Self.id2, parent: Self.id1, origin: "now_you_try"), record(id: Self.id1)], userId: "u1")
        let writes = stub.requests.filter { $0.httpMethod == "POST" }
        #expect(writes.count == 2, "the parent first, then the attempt that follows it")
        let first = try #require(writes.first)
        let url = try #require(first.url?.absoluteString)
        #expect(url.contains("/rest/v1/learning_attempts"))
        #expect(url.contains("on_conflict=id"))
        #expect(first.value(forHTTPHeaderField: "Prefer")?.contains("resolution=merge-duplicates") == true)
        #expect(first.value(forHTTPHeaderField: "Prefer")?.contains("return=minimal") == true)
        let rows = try #require(try JSONSerialization.jsonObject(with: StubSupabase.body(first)) as? [[String: Any]])
        #expect(rows.first?["id"] as? String == Self.id1.lowercased())
        #expect(rows.first?["problem_latex"] as? String == "2x+3=11")
        #expect(stub.requests.allSatisfy { $0.httpMethod != "GET" }, "a parent in the same batch needs no lookup")
    }

    @Test func aRefusedRowIsIsolatedAndTheRestSaved() async throws {
        let stub = StubSupabase()
        let bad = "11111111-1111-4111-8111-111111111111"
        stub.reply = { request in
            let rows = (try? JSONSerialization.jsonObject(with: StubSupabase.body(request)) as? [[String: Any]]) ?? []
            if rows.contains(where: { $0["id"] as? String == bad }) {
                return (400, Data(#"{"code":"23514","message":"new row violates check constraint","details":null,"hint":null}"#.utf8))
            }
            return (201, Data())
        }
        let ids = ["22222222-2222-4222-8222-222222222222", bad, "33333333-3333-4333-8333-333333333333"]
        await #expect(throws: LearningStoreError.self) {
            try await stub.repository.saveAttempts(ids.map { record(id: $0) }, userId: "u1")
        }
        let saved = stub.requests.compactMap { r -> [String]? in
            guard let rows = try? JSONSerialization.jsonObject(with: StubSupabase.body(r)) as? [[String: Any]] else { return nil }
            return rows.compactMap { $0["id"] as? String }
        }
        #expect(saved == [ids, [ids[0], bad], [ids[0]], [bad], [ids[2]]], "halved until the refused row is alone")
        do {
            try await stub.repository.saveAttempts(ids.map { record(id: $0) }, userId: "u1")
        } catch let e as LearningStoreError {
            #expect(e.code == .invalid)
        }
    }

    @Test func aFailureARetryCanFixThrowsAtOnce() async throws {
        let stub = StubSupabase()
        stub.reply = { _ in (503, Data("<html>gateway</html>".utf8)) }
        do {
            try await stub.repository.saveAttempts([record(), record(id: Self.id2)], userId: "u1")
            Issue.record("a 503 must throw")
        } catch let e as LearningStoreError {
            #expect(e.code == .network)
        }
        #expect(stub.requests.count == 1, "no isolating for a failure that is not a refused value")
        stub.reply = { _ in (403, Data(#"{"code":"42501","message":"new row violates row-level security policy"}"#.utf8)) }
        do {
            try await stub.repository.saveAttempts([record()], userId: "u1")
        } catch let e as LearningStoreError {
            #expect(e.code == .unauthorized)
        }
    }

    @Test func aNowYouTryWhoseParentWasNeverSavedKeepsItsRecordNotTheLink() async throws {
        let stub = StubSupabase()
        let orphanParent = "44444444-4444-4444-8444-444444444444"
        stub.reply = { request in
            if request.httpMethod == "GET" { return (200, Data("[]".utf8)) }
            return (201, Data())
        }
        try await stub.repository.saveAttempts([record(id: Self.id2, parent: orphanParent, origin: "now_you_try")], userId: "u-orphan")
        #expect(stub.requests.first?.httpMethod == "GET", "the parent is looked up first")
        let write = try #require(stub.requests.last)
        let rows = try #require(try JSONSerialization.jsonObject(with: StubSupabase.body(write)) as? [[String: Any]])
        #expect(rows.first?["parent_id"] is NSNull)
        // a parent saved from here needs no lookup next time
        stub.requests = []
        try await stub.repository.saveAttempts([record(id: orphanParent)], userId: "u-orphan")
        try await stub.repository.saveAttempts([record(id: "55555555-5555-4555-8555-555555555555", parent: orphanParent, origin: "now_you_try")], userId: "u-orphan")
        #expect(stub.requests.allSatisfy { $0.httpMethod == "POST" })
    }
}

/// A Supabase client whose requests a test answers (a URLProtocol on its session).
final class StubSupabase: @unchecked Sendable {
    let repository: LearningRepository
    var requests: [URLRequest] {
        get { StubProtocol.lock.withLock { StubProtocol.seen } }
        set { StubProtocol.lock.withLock { StubProtocol.seen = newValue } }
    }
    var reply: (URLRequest) -> (Int, Data) {
        get { StubProtocol.lock.withLock { StubProtocol.reply } }
        set { StubProtocol.lock.withLock { StubProtocol.reply = newValue } }
    }

    init() {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        let session = URLSession(configuration: config)
        let client = SupabaseClient(
            supabaseURL: URL(string: "http://stub.local")!, supabaseKey: "anon",
            options: SupabaseClientOptions(auth: .init(storage: InMemoryAuthStorage(), autoRefreshToken: false), global: .init(session: session)))
        repository = LearningRepository(client: client)
        requests = []
    }

    static func body(_ request: URLRequest) -> Data {
        if let data = request.httpBody { return data }
        guard let stream = request.httpBodyStream else { return Data() }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let n = stream.read(&buffer, maxLength: buffer.count)
            if n <= 0 { break }
            data.append(buffer, count: n)
        }
        return data
    }
}

final class StubProtocol: URLProtocol {
    static let lock = NSLock()
    nonisolated(unsafe) static var seen: [URLRequest] = []
    nonisolated(unsafe) static var reply: (URLRequest) -> (Int, Data) = { _ in (200, Data("[]".utf8)) }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        var copy = request
        if copy.httpBody == nil, request.httpBodyStream != nil { copy.httpBody = StubSupabase.body(request) }
        let (status, data) = Self.lock.withLock { () -> (Int, Data) in
            Self.seen.append(copy)
            return Self.reply(copy)
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
