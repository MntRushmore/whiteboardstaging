import Foundation

/// Where the device keeps what the learning record has not saved yet, and each board's attempts
/// for its next visit: the web's `agathon.learning.pending.<userId>` and `agathon.learning.boards.<userId>`
/// (localStorage there), as small JSON files here. Survives offline, app kills and relaunches.
@MainActor
public protocol LearningDeviceStorage: AnyObject {
    func read(_ name: String) -> Data?
    /// nil removes it
    func write(_ name: String, _ data: Data?)
}

/// Files in Application Support/Agathon/Learning: written atomically, kept from backups' iCloud
/// copies, readable after the first unlock (a save in the background can still find them).
@MainActor
public final class LearningFileStorage: LearningDeviceStorage {
    public let directory: URL

    public init(directory: URL) {
        self.directory = directory
    }

    /// The app's own folder, made when missing; nil when the system gives none.
    public static func applicationSupport() -> LearningFileStorage? {
        guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        var dir = base.appendingPathComponent("Agathon/Learning", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? dir.setResourceValues(values)
        } catch {
            return nil
        }
        return LearningFileStorage(directory: dir)
    }

    public func read(_ name: String) -> Data? {
        try? Data(contentsOf: directory.appendingPathComponent(name))
    }

    public func write(_ name: String, _ data: Data?) {
        let url = directory.appendingPathComponent(name)
        guard let data else {
            try? FileManager.default.removeItem(at: url)
            return
        }
        #if os(iOS)
        try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try? data.write(to: url, options: .atomic)
        #endif
    }
}

/// In memory (tests, previews).
@MainActor
public final class LearningMemoryStorage: LearningDeviceStorage {
    public private(set) var files: [String: Data] = [:]

    public init() {}

    public func read(_ name: String) -> Data? { files[name] }

    public func write(_ name: String, _ data: Data?) {
        files[name] = data
    }
}

/// The web's device keeping (boardLearning.ts): unsaved records, newest first, at most 100; each
/// board's attempts for its next visit, for the 8 boards left last.
@MainActor
public enum LearningDevice {
    /// LEARNING_SAVE.pendingMax
    public static let pendingMax = 100
    /// SAVED_BOARDS
    public static let savedBoards = 8

    static func safe(_ userId: String) -> String {
        String(userId.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_" }.prefix(64))
    }

    public static func pendingName(_ userId: String) -> String { "pending.\(safe(userId)).json" }
    public static func boardsName(_ userId: String) -> String { "boards.\(safe(userId)).json" }

    /// The records a visit could not save (newest first); [] when none or unreadable (`readPending`).
    public static func readPending(_ userId: String, _ storage: LearningDeviceStorage?) -> [LearningRecord] {
        guard let data = storage?.read(pendingName(userId)),
              let list = try? JSONDecoder().decode([Lossy<LearningRecord>].self, from: data) else { return [] }
        return Array(list.compactMap(\.value).filter { !$0.id.isEmpty }.prefix(pendingMax))
    }

    /// Keeps these records (newest first, the latest of each, at most 100); none clears it (`writePending`).
    public static func writePending(_ userId: String, _ records: [LearningRecord], _ storage: LearningDeviceStorage?) {
        guard let storage else { return }
        var byId = OrderedMap<String, LearningRecord>()
        for r in records {
            if let cur = byId[r.id], cur.updatedAt > r.updatedAt { continue }
            byId[r.id] = r
        }
        let list = AttemptTracker.stableSorted(byId.orderedValues) { $0.updatedAt > $1.updatedAt }.prefix(pendingMax)
        storage.write(pendingName(userId), list.isEmpty ? nil : try? JSONEncoder().encode(Array(list)))
    }

    private struct SavedBoard: Codable {
        var at: Double
        var attempts: [Lossy<SavedAttempt>]
    }

    private static func readBoards(_ userId: String, _ storage: LearningDeviceStorage?) -> [String: SavedBoard] {
        guard let data = storage?.read(boardsName(userId)),
              let boards = try? JSONDecoder().decode([String: SavedBoard].self, from: data) else { return [:] }
        return boards
    }

    /// The attempts an earlier visit to this board left (`readBoardAttempts`); [] when none.
    public static func readBoardAttempts(_ userId: String, boardId: String, _ storage: LearningDeviceStorage?) -> [SavedAttempt] {
        readBoards(userId, storage)[boardId]?.attempts.compactMap(\.value) ?? []
    }

    /// Keeps this board's attempts for its next visit, and the 8 boards left last (`writeBoardAttempts`).
    public static func writeBoardAttempts(_ userId: String, boardId: String, _ attempts: [SavedAttempt], at: Double, _ storage: LearningDeviceStorage?) {
        guard let storage else { return }
        var boards = readBoards(userId, storage)
        if attempts.isEmpty { boards[boardId] = nil } else { boards[boardId] = SavedBoard(at: at, attempts: attempts.map { Lossy(value: $0) }) }
        let kept = boards.sorted { $0.value.at > $1.value.at }.prefix(savedBoards)
        storage.write(boardsName(userId), kept.isEmpty ? nil : try? JSONEncoder().encode(Dictionary(uniqueKeysWithValues: kept.map { ($0.key, $0.value) })))
    }
}

/// A value that may not read (a shape this version cannot): skipped, never fatal to the list.
struct Lossy<T: Codable>: Codable {
    var value: T?

    init(value: T?) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        value = try? T(from: decoder)
    }

    func encode(to encoder: Encoder) throws {
        try value.encode(to: encoder)
    }
}
