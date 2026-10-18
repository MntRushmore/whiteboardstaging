import Foundation

/// Where a board's pictures live. The app gives the board a store backed by Supabase Storage
/// (`board-assets`); tests and Board Lab use `MemoryBoardAssetStore`.
public protocol BoardAssetStore: Sendable {
    /// Stores a picture for a board and returns the URL to put in the image record.
    func upload(_ data: Data, mimeType: String, boardId: String, width: Int, height: Int, source: String) async throws -> URL
    /// The bytes behind an image record's URL (cached by the store).
    func data(for url: URL) async throws -> Data
}
