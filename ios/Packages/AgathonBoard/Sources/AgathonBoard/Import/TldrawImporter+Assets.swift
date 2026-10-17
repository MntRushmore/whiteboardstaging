import Foundation

extension TldrawImporter {
    /// Converts a board and moves its inline pictures (`data:` URLs, from boards saved before the
    /// web's asset store) into `assets`: a saved board holds a picture's URL, never its bytes. A
    /// picture whose upload fails stays inline (counted in `failedUploads`, with a warning) so
    /// nothing is lost; the next save tries again (`uploadInlineImages`).
    public static func importSnapshot(_ data: Data, boardId: String, assets: any BoardAssetStore) async throws -> Result {
        var result = try importSnapshot(data)
        let moved = await uploadInlineImages(in: result.document, boardId: boardId, assets: assets)
        result.document = moved.document
        result.report.uploadedImages += moved.uploaded
        result.report.failedUploads += moved.failed.count
        result.report.warnings += moved.failed
        return result
    }

    public struct InlineUpload: Sendable {
        public var document: BoardDocument
        public var uploaded = 0
        /// what could not be uploaded, and why
        public var failed: [String] = []
    }

    /// Uploads every image record's inline `data:` picture and points the record at its URL. The
    /// same picture (an asset two images share, or the same bytes) is uploaded once.
    public static func uploadInlineImages(in document: BoardDocument, boardId: String, assets: any BoardAssetStore) async -> InlineUpload {
        var out = InlineUpload(document: document)
        var done: [String: URL] = [:]
        for (id, record) in document.records.sorted(by: { $0.key < $1.key }) {
            guard case .image(var image) = record, image.asset.src.hasPrefix("data:") else { continue }
            let src = image.asset.src
            if let url = done[src] {
                image.asset.src = url.absoluteString
                out.document.records[id] = .image(image)
                continue
            }
            guard let inline = InlineData(src) else {
                out.failed.append("\(id): an inline picture that is not base64 data")
                continue
            }
            let source = image.meta["tldraw"]?["asset"]?["meta"]?["source"]?.stringValue ?? "user"
            do {
                let url = try await assets.upload(
                    inline.bytes, mimeType: image.asset.mime ?? inline.mimeType, boardId: boardId,
                    width: Int((image.asset.w ?? image.w).rounded()), height: Int((image.asset.h ?? image.h).rounded()),
                    source: ["user", "ai", "sticker", "pdf", "worksheet"].contains(source) ? source : "user")
                done[src] = url
                image.asset.src = url.absoluteString
                if image.asset.mime == nil { image.asset.mime = inline.mimeType }
                out.document.records[id] = .image(image)
                out.uploaded += 1
            } catch {
                out.failed.append("\(id): the inline picture could not be uploaded (\(error.localizedDescription)); it stays inline")
            }
        }
        return out
    }
}

/// A `data:<mime>;base64,<payload>` URL's bytes.
public struct InlineData: Sendable, Equatable {
    public var mimeType: String
    public var bytes: Data

    public init?(_ src: String) {
        guard src.hasPrefix("data:"), let comma = src.firstIndex(of: ",") else { return nil }
        let header = src[src.index(src.startIndex, offsetBy: 5)..<comma]
        let parts = header.split(separator: ";").map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
        guard parts.contains("base64"), let mime = parts.first, mime.contains("/") else { return nil }
        guard let bytes = Data(base64Encoded: String(src[src.index(after: comma)...]), options: .ignoreUnknownCharacters), !bytes.isEmpty else { return nil }
        mimeType = mime
        self.bytes = bytes
    }
}
