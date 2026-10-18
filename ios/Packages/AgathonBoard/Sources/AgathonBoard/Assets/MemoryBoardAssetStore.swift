import Foundation

/// A `BoardAssetStore` that keeps pictures in memory under `memory://` URLs: for tests, previews and
/// Board Lab. It can be made slow (to see the placeholder) or failing (to see the error).
public actor MemoryBoardAssetStore: BoardAssetStore {
    public enum StoreError: Error, Equatable {
        case notFound(String)
        case uploadFailed
    }

    /// One picture uploaded, as the app's store would record it in `board_assets`.
    public struct Upload: Sendable, Equatable {
        public var url: URL
        public var mimeType: String
        public var boardId: String
        public var width: Int
        public var height: Int
        public var source: String
        public var bytes: Int
    }

    private var blobs: [String: Data] = [:]
    public private(set) var uploads: [Upload] = []
    private var failing = false
    private var delay: UInt64 = 0
    public private(set) var reads = 0

    public init(_ seed: [URL: Data] = [:]) {
        for (url, data) in seed { blobs[url.absoluteString] = data }
    }

    /// Uploads fail from now on (or work again).
    public func setFailing(_ failing: Bool) { self.failing = failing }

    /// Every upload and read waits this long first.
    public func setDelay(seconds: Double) { delay = UInt64(max(0, seconds) * 1_000_000_000) }

    /// Puts bytes at a URL (a fixture's pictures).
    public func put(_ data: Data, at url: URL) { blobs[url.absoluteString] = data }

    public func upload(_ data: Data, mimeType: String, boardId: String, width: Int, height: Int, source: String) async throws -> URL {
        if delay > 0 { try? await Task.sleep(nanoseconds: delay) }
        if failing { throw StoreError.uploadFailed }
        let ext = Self.fileExtension(mimeType)
        let url = URL(string: "memory://board-assets/\(boardId)/\(UUID().uuidString.lowercased()).\(ext)")!
        blobs[url.absoluteString] = data
        uploads.append(Upload(url: url, mimeType: mimeType, boardId: boardId, width: width, height: height, source: source, bytes: data.count))
        return url
    }

    public func data(for url: URL) async throws -> Data {
        if delay > 0 { try? await Task.sleep(nanoseconds: delay) }
        reads += 1
        guard let d = blobs[url.absoluteString] else { throw StoreError.notFound(url.absoluteString) }
        return d
    }

    static func fileExtension(_ mime: String) -> String {
        switch mime {
        case "image/png": return "png"
        case "image/jpeg": return "jpg"
        case "image/webp": return "webp"
        case "image/gif": return "gif"
        case "image/svg+xml": return "svg"
        default: return "bin"
        }
    }
}
