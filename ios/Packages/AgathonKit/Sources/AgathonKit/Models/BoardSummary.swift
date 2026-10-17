import Foundation

/// A board as the boards list shows it: a row of `whiteboards` without its document (`data`, which
/// can be megabytes). The web's home reads the same columns (src/app/(platform)/page.tsx).
public struct BoardSummary: Sendable, Equatable, Identifiable, Decodable {
    /// What a new board is called (the column default; src/lib/boards/boardTitle.ts).
    public static let defaultTitle = "Untitled Whiteboard"
    /// The column allows 200 characters.
    public static let maxTitleLength = 200
    /// The columns a list reads: never `data`.
    public static let columns = "id, title, created_at, updated_at, preview, version"

    public let id: String
    public let title: String
    public let createdAt: Date?
    public let updatedAt: Date?
    /// The thumbnail: a `data:image/webp;base64,…` (or jpeg/png) URL, at most 20,000 characters.
    public let preview: String?
    /// Bumped by every save (the version-checked update); nil on a database before it.
    public let version: Int?

    public init(id: String, title: String, createdAt: Date? = nil, updatedAt: Date? = nil, preview: String? = nil, version: Int? = nil) {
        self.id = id
        self.title = title
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.preview = preview
        self.version = version
    }

    enum CodingKeys: String, CodingKey {
        case id, title, preview, version
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        let title = try c.decodeIfPresent(String.self, forKey: .title)?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.title = (title?.isEmpty ?? true) ? Self.defaultTitle : title ?? Self.defaultTitle
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt).flatMap(PostgresDate.parse)
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt).flatMap(PostgresDate.parse)
        let preview = try c.decodeIfPresent(String.self, forKey: .preview)
        self.preview = (preview?.isEmpty ?? true) ? nil : preview
        // PostgREST writes integers as numbers; a bigint could come back as a string.
        if let number = try? c.decodeIfPresent(Int.self, forKey: .version) {
            version = number
        } else if let text = try? c.decodeIfPresent(String.self, forKey: .version) {
            version = Int(text)
        } else {
            version = nil
        }
    }

    /// The thumbnail's image bytes (decoded from the data URL), or nil when there is none or it is
    /// not a base64 image.
    public var previewImage: DataURL? { preview.flatMap(DataURL.init) }
}

/// A `data:<media type>;base64,<payload>` URL.
public struct DataURL: Sendable, Equatable {
    public let mediaType: String
    public let data: Data

    public init?(_ string: String) {
        guard string.hasPrefix("data:"), let comma = string.firstIndex(of: ",") else { return nil }
        let header = string[string.index(string.startIndex, offsetBy: 5) ..< comma]
        let parts = header.split(separator: ";")
        guard let type = parts.first, type.hasPrefix("image/"), parts.dropFirst().contains("base64") else { return nil }
        let payload = String(string[string.index(after: comma)...])
        guard let data = Data(base64Encoded: payload, options: .ignoreUnknownCharacters), !data.isEmpty else { return nil }
        mediaType = String(type)
        self.data = data
    }
}
