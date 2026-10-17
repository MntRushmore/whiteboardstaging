import Foundation
import Supabase

/// The signed-in user's boards, read and written as the user under RLS, exactly as the web's home
/// does (src/app/(platform)/page.tsx, src/lib/assets/deleteBoard.ts). Every call is retried once
/// after a "JWT issued at future" refusal (`SkewRetry`).
public final class BoardsRepository: Sendable {
    public static let table = "whiteboards"
    public static let assetsTable = "board_assets"
    public static let assetsBucket = "board-assets"
    /// Storage paths removed per call (DELETE_BATCH_SIZE).
    public static let deleteBatchSize = 100

    let client: SupabaseClient

    public init(client: SupabaseClient) {
        self.client = client
    }

    /// Every board, last edited first, thumbnails included, documents not.
    public func list() async throws -> [BoardSummary] {
        let response = try await SkewRetry.run {
            try await client.from(Self.table)
                .select(BoardSummary.columns)
                .order("updated_at", ascending: false)
                .execute()
        }
        return try Self.decode([BoardSummary].self, response.data)
    }

    /// A new, empty board (`data: {}`, as the web inserts it), named `title`.
    public func create(title: String = BoardSummary.defaultTitle) async throws -> BoardSummary {
        guard let userId = client.auth.currentUser?.id.uuidString.lowercased() else { throw APIError.notSignedIn }
        let row = NewBoard(title: try Self.cleanTitle(title), data: [:], userId: userId)
        let response = try await SkewRetry.run {
            try await client.from(Self.table)
                .insert(row)
                .select(BoardSummary.columns)
                .single()
                .execute()
        }
        return try Self.decode(BoardSummary.self, response.data)
    }

    /// Renames a board; the name is trimmed and must not be empty. Returns the row as saved.
    @discardableResult
    public func rename(id: String, to title: String) async throws -> BoardSummary {
        let clean = try Self.cleanTitle(title)
        let response = try await SkewRetry.run {
            try await client.from(Self.table)
                .update(["title": clean])
                .eq("id", value: id)
                .select(BoardSummary.columns)
                .single()
                .execute()
        }
        return try Self.decode(BoardSummary.self, response.data)
    }

    /// What deleting a board did to its images.
    public struct DeleteResult: Sendable, Equatable {
        /// Image paths registered for the board.
        public var assetsFound = 0
        /// Images removed from Storage.
        public var assetsRemoved = 0
        /// What failed on the image side (the board is gone regardless; the nightly GC finds them).
        public var assetErrors: [String] = []
    }

    /// Deletes a board and its Storage images (`deleteBoardWithAssets`): read the board's image
    /// paths (the cascade would erase the registry), delete the row, then remove the images in
    /// batches, best effort. Throws only when the row delete fails, before anything is removed.
    @discardableResult
    public func delete(id: String) async throws -> DeleteResult {
        var result = DeleteResult()
        var paths: [String] = []
        do {
            let response = try await SkewRetry.run {
                try await client.from(Self.assetsTable).select("object_path").eq("whiteboard_id", value: id).execute()
            }
            let rows = (try? JSONDecoder().decode([AssetRow].self, from: response.data)) ?? []
            for row in rows where !row.objectPath.isEmpty && !paths.contains(row.objectPath) {
                paths.append(row.objectPath)
            }
        } catch {
            result.assetErrors.append("could not list images: \(error.localizedDescription)")
        }
        result.assetsFound = paths.count

        _ = try await SkewRetry.run {
            try await client.from(Self.table).delete(returning: .minimal).eq("id", value: id).execute()
        }

        for start in stride(from: 0, to: paths.count, by: Self.deleteBatchSize) {
            let batch = Array(paths[start ..< min(start + Self.deleteBatchSize, paths.count)])
            do {
                _ = try await client.storage.from(Self.assetsBucket).remove(paths: batch)
                result.assetsRemoved += batch.count
            } catch {
                result.assetErrors.append("could not remove \(batch.count) image(s): \(error.localizedDescription)")
            }
        }
        return result
    }

    // MARK: helpers

    public enum TitleError: Error, Equatable, LocalizedError {
        case empty
        case tooLong

        public var errorDescription: String? {
            switch self {
            case .empty: return "Give the board a name."
            case .tooLong: return "A board name is at most \(BoardSummary.maxTitleLength) characters."
            }
        }
    }

    static func cleanTitle(_ title: String) throws -> String {
        let clean = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { throw TitleError.empty }
        guard clean.count <= BoardSummary.maxTitleLength else { throw TitleError.tooLong }
        return clean
    }

    static func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw APIError.invalidResponse("\(T.self): \(error)")
        }
    }

    struct NewBoard: Encodable {
        let title: String
        let data: [String: String]
        let userId: String

        enum CodingKeys: String, CodingKey {
            case title, data
            case userId = "user_id"
        }
    }

    struct AssetRow: Decodable {
        let objectPath: String

        enum CodingKeys: String, CodingKey {
            case objectPath = "object_path"
        }
    }
}
