import AgathonBoard
import AgathonKit
import Foundation
@testable import AgathonSync

/// The board lane's tldraw fixtures, read from the checkout (Tools/fixtures/make-fixtures.mjs).
enum Fixture {
    static var dir: URL {
        var u = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 { u = u.deletingLastPathComponent() }
        return u.appendingPathComponent("AgathonBoard/Tests/AgathonBoardTests/Fixtures")
    }

    static func tldraw(_ name: String) throws -> Data { try Data(contentsOf: dir.appendingPathComponent("\(name).tldraw.json")) }
}

/// A kid's stroke on `screen`, `n` points along a line from (x, y).
func kidStroke(_ id: String, screen: RecordID, order: OrderKey, x: Double = 200, y: Double = 200, n: Int = 20) -> BoardRecord {
    var pts: [InkPoint] = []
    for i in 0..<n {
        let p: Float = 0.4 + Float(i % 4) * 0.1
        pts.append(InkPoint(x: Float(i) * 4, y: Float(i % 5), pressure: p, t: Float(i * 8)))
    }
    return .stroke(StrokeRecord(
        id: RecordID(id), screen: screen, order: order, author: .kid, color: .black, width: 6, pressure: .real,
        x: x, y: y, points: pts, start: 1_760_000_000_000).normalized())
}

/// A row in a fake `whiteboards` table, with the migration's version rules: a doc write bumps the
/// version and stamps doc_version; the version filter makes a stale write match nothing.
actor FakeRemote: BoardRemote {
    var version: Int
    var doc: Data?
    var docVersion: Int?
    var data: Data?
    var preview: String?
    var gone = false
    /// results to give instead of writing, first first
    var scripted: [PersistResult] = []
    /// the next write never answers (until cancelled)
    var hangNext = false
    var writes: [(expected: Int?, body: Data)] = []
    var fetches = 0

    init(version: Int = 1, doc: Data? = nil, docVersion: Int? = nil, data: Data? = nil) {
        self.version = version
        self.doc = doc
        self.docVersion = docVersion
        self.data = data
    }

    func fetch(boardId: String) async throws -> RemoteBoard? {
        fetches += 1
        if gone { return nil }
        if let doc, let docVersion, docVersion >= version { return RemoteBoard(version: version, body: .doc(doc)) }
        if let data { return RemoteBoard(version: version, body: .tldraw(data)) }
        return RemoteBoard(version: version, body: .empty)
    }

    func persist(boardId: String, write: BoardWrite, expectedVersion: Int?) async -> PersistResult {
        writes.append((expectedVersion, write.body()))
        if hangNext {
            hangNext = false
            try? await Task.sleep(nanoseconds: 3_600_000_000_000)
            return .failed(.timeout, message: nil)
        }
        if !scripted.isEmpty { return scripted.removeFirst() }
        if gone { return .failed(.gone, message: nil) }
        if let expectedVersion, expectedVersion != version { return .conflict }
        version += 1
        doc = write.doc
        docVersion = version
        switch write.preview {
        case .keep: break
        case .clear: preview = nil
        case .set(let p): preview = p
        }
        return .ok(version: version)
    }

    // test controls
    func script(_ results: [PersistResult]) { scripted = results }
    func hang() { hangNext = true }
    func setGone() { gone = true }
    /// another device saves this document
    func otherDeviceSaves(_ document: BoardDocument) throws {
        version += 1
        doc = try document.encoded()
        docVersion = version
    }

    func storedDocument() throws -> BoardDocument? { try doc.map { try BoardDocument.decode($0) } }
    func writeCount() -> Int { writes.count }
    func lastWrite() -> (expected: Int?, body: Data)? { writes.last }
}

/// A picture store in memory.
final class MemoryAssets: BoardAssetStore, @unchecked Sendable {
    var uploads = 0
    func upload(_ data: Data, mimeType: String, boardId: String, width: Int, height: Int, source: String) async throws -> URL {
        uploads += 1
        return URL(string: "https://assets.test/\(boardId)/\(uploads).png")!
    }

    func data(for url: URL) async throws -> Data { Data() }
}

/// A transport answering from a handler (and recording what was asked).
final class FakeTransport: HTTPTransport, @unchecked Sendable {
    var requests: [URLRequest] = []
    var handler: (URLRequest) throws -> (Int, Data)

    init(_ handler: @escaping (URLRequest) throws -> (Int, Data)) {
        self.handler = handler
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        let (status, body) = try handler(request)
        return (body, HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!)
    }

    func stream(for request: URLRequest) async throws -> (HTTPURLResponse, AsyncThrowingStream<Data, Error>) {
        fatalError("not used")
    }
}

/// Lets queued tasks on the main actor run.
@MainActor
func settle(_ times: Int = 20) async {
    for _ in 0..<times { await Task.yield() }
}
