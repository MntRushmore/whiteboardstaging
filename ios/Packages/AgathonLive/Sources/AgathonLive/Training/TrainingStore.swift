import Foundation

/// Runs kept on this iPad (Application Support/Training, one JSON file a run): the Training Center's
/// own copy, so a run is never lost — the server's tables may not be there yet (the migration is the
/// lead's to apply), or the network may drop mid-run. Supabase holds the shared copy.
public final class TrainingStore: @unchecked Sendable {
    public let folder: URL
    private let lock = NSLock()

    public init(folder: URL? = nil) {
        let base = folder ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Training", isDirectory: true)
        self.folder = base
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    }

    public static let shared = TrainingStore()

    static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    func url(_ id: UUID) -> URL { folder.appendingPathComponent("\(id.uuidString.lowercased()).json") }

    public func save(_ run: TrainingRun) {
        lock.withLock {
            guard let data = try? Self.encoder.encode(run) else { return }
            try? data.write(to: url(run.id), options: .atomic)
        }
    }

    public func load(_ id: UUID) -> TrainingRun? {
        lock.withLock {
            guard let data = try? Data(contentsOf: url(id)) else { return nil }
            return try? Self.decoder.decode(TrainingRun.self, from: data)
        }
    }

    /// Every run on this iPad, newest first.
    public func all() -> [TrainingRun] {
        lock.withLock {
            let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
            return files.filter { $0.pathExtension == "json" }
                .compactMap { try? Self.decoder.decode(TrainingRun.self, from: Data(contentsOf: $0)) }
                .sorted { $0.startedAt > $1.startedAt }
        }
    }

    public func delete(_ id: UUID) {
        lock.withLock { try? FileManager.default.removeItem(at: url(id)) }
    }
}
