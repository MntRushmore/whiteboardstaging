import AgathonBoard
import AgathonKit
import CryptoKit
import Foundation

/// The board's pictures in Supabase Storage, as the web keeps them (src/lib/assets/boardAssetStore.ts):
/// the PUBLIC `board-assets` bucket, at `<uid>/<boardId>/<assetId>.<ext>` (the storage policies only
/// let a user write their own folder), plus a `board_assets` row so the nightly GC knows the object
/// belongs to the board. The asset id is the picture's SHA-256, so the same picture is one object
/// (an upload that finds it there already is a success). Pictures read back are cached on disk.
public final class SupabaseBoardAssetStore: BoardAssetStore, @unchecked Sendable {
    public static let bucket = "board-assets"
    public static let table = "rest/v1/board_assets"
    public static let sources: Set<String> = ["user", "ai", "sticker", "pdf", "worksheet"]

    let connection: SupabaseConnection
    let userId: String
    let cacheDirectory: URL
    private let memory = NSCache<NSString, NSData>()

    public init(connection: SupabaseConnection, userId: String, cacheDirectory: URL? = nil) {
        self.connection = connection
        self.userId = userId
        self.cacheDirectory = cacheDirectory
            ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("AgathonBoardAssets", isDirectory: true)
        memory.totalCostLimit = 64 * 1024 * 1024
    }

    public enum AssetError: Error, LocalizedError, Equatable {
        case uploadFailed(status: Int, message: String)
        case notFound(URL)

        public var errorDescription: String? {
            switch self {
            case let .uploadFailed(status, message): return "Picture upload failed (\(status)): \(message)"
            case let .notFound(url): return "No picture at \(url.absoluteString)"
            }
        }
    }

    // MARK: paths (scripts/lib/snapshotAssets.mjs)

    public static func ext(for mime: String) -> String {
        switch mime.lowercased().split(separator: ";").first.map({ $0.trimmingCharacters(in: .whitespaces) }) ?? "" {
        case "image/png": return "png"
        case "image/jpeg", "image/jpg": return "jpg"
        case "image/webp": return "webp"
        case "image/gif": return "gif"
        case "image/svg+xml": return "svg"
        default: return "bin"
        }
    }

    /// One path segment: [A-Za-z0-9_-] only (no traversal), never empty.
    public static func safeSegment(_ s: String) -> String {
        let cleaned = String(s.map { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") ? $0 : "_" })
        let trimmed = cleaned.trimmingCharacters(in: CharacterSet(charactersIn: "_"))
        return trimmed.isEmpty ? "_" : trimmed
    }

    public static func objectPath(userId: String, boardId: String, assetId: String, mime: String) -> String {
        let bare = assetId.hasPrefix("asset:") ? String(assetId.dropFirst(6)) : assetId
        return "\(safeSegment(userId))/\(safeSegment(boardId))/\(safeSegment(bare)).\(ext(for: mime))"
    }

    public func publicURL(_ path: String) -> URL {
        connection.url.appendingPathComponent("storage/v1/object/public/\(Self.bucket)/\(path)")
    }

    // MARK: BoardAssetStore

    public func upload(_ data: Data, mimeType: String, boardId: String, width: Int, height: Int, source: String) async throws -> URL {
        let assetId = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined().prefix(32)
        let path = Self.objectPath(userId: userId, boardId: boardId, assetId: String(assetId), mime: mimeType)
        let (body, response) = try await connection.send(
            "POST", "storage/v1/object/\(Self.bucket)/\(path)",
            headers: ["Content-Type": mimeType, "cache-control": "max-age=31536000", "x-upsert": "false"], body: data)
        let exists = Self.isAlreadyExists(status: response.statusCode, body: body)
        guard (200..<300).contains(response.statusCode) || exists else {
            throw AssetError.uploadFailed(status: response.statusCode, message: String(decoding: body.prefix(300), as: UTF8.self))
        }
        let url = publicURL(path)
        cache(data, for: url)
        if !exists {
            // the registry is for the GC; the picture is safe already, so a failure here is not one
            let row: [String: Any] = [
                "whiteboard_id": boardId, "user_id": userId, "object_path": path, "mime_type": mimeType, "bytes": data.count,
                "width": width > 0 ? width : NSNull(), "height": height > 0 ? height : NSNull(),
                "source": Self.sources.contains(source) ? source : "user",
            ]
            if let json = try? JSONSerialization.data(withJSONObject: row) {
                _ = try? await connection.send("POST", Self.table, headers: ["Content-Type": "application/json", "Prefer": "return=minimal"], body: json)
            }
        }
        return url
    }

    /// Storage answers an upload that would overwrite with 409 (or 400 carrying statusCode 409 / Duplicate).
    static func isAlreadyExists(status: Int, body: Data) -> Bool {
        if status == 409 { return true }
        let text = String(decoding: body.prefix(400), as: UTF8.self)
        return text.contains("\"409\"") || text.localizedCaseInsensitiveContains("duplicate") || text.localizedCaseInsensitiveContains("already exists")
    }

    public func data(for url: URL) async throws -> Data {
        if url.scheme == "data", let inline = InlineData(url.absoluteString) { return inline.bytes }
        let key = url.absoluteString as NSString
        if let hit = memory.object(forKey: key) { return hit as Data }
        let file = cacheFile(url)
        if let disk = try? Data(contentsOf: file) {
            memory.setObject(disk as NSData, forKey: key, cost: disk.count)
            return disk
        }
        // a public URL: no token (an https picture from elsewhere, e.g. a bookmark's preview, too)
        let (data, response) = try await connection.transport.data(for: URLRequest(url: url))
        guard (200..<300).contains(response.statusCode), !data.isEmpty else { throw AssetError.notFound(url) }
        cache(data, for: url)
        return data
    }

    func cacheFile(_ url: URL) -> URL {
        let name = SHA256.hash(data: Data(url.absoluteString.utf8)).map { String(format: "%02x", $0) }.joined()
        return cacheDirectory.appendingPathComponent(name)
    }

    func cache(_ data: Data, for url: URL) {
        memory.setObject(data as NSData, forKey: url.absoluteString as NSString, cost: data.count)
        try? FileManager.default.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
        try? data.write(to: cacheFile(url), options: [.atomic])
    }
}
