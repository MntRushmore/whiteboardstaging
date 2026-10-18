import AgathonBoard
import Foundation

/// This device's copy of a board's unsaved records (the web's localStorage backup, as a file in
/// Application Support): written half a second after an edit (never more than 2 s into a burst), at
/// once when the app leaves the screen, cleared once a save lands. If the app is killed, or the
/// network never comes back, the next open of the board puts the records back.
public struct BoardBackup: Codable, Equatable, Sendable {
    public var boardId: String
    /// the row version the board was based on when this was written
    public var baseVersion: Int?
    /// ids added or changed since the last save, and ids removed
    public var changed: [RecordID]
    public var removed: [RecordID]
    /// the changed records as they were on this device
    public var records: [String: BoardRecord]
    /// each changed or removed record as the server had it at `baseVersion` (missing: it did not exist):
    /// a restore tells "only this device changed it" from "the server changed it too"
    public var base: [String: BoardRecord]
    /// what a write whose answer never came sent, for ids edited again since (nil: it removed the
    /// record): if it landed, the server holds exactly this and the newer edit is still this device's own
    public var sent: [String: BoardRecord?]?
    public var at: Date

    public init(boardId: String, baseVersion: Int?, changed: [RecordID], removed: [RecordID], records: [String: BoardRecord],
                base: [String: BoardRecord], sent: [String: BoardRecord?]? = nil, at: Date)
    {
        self.boardId = boardId
        self.baseVersion = baseVersion
        self.changed = changed
        self.removed = removed
        self.records = records
        self.base = base
        self.sent = sent
        self.at = at
    }
}

/// Where backups live: one file per board, under a folder per account (a backup is never restored
/// into another account's board).
public final class BoardBackupStore: @unchecked Sendable {
    public let directory: URL
    private let lock = NSLock()

    public init(directory: URL) {
        self.directory = directory
    }

    /// Application Support/AgathonBoardBackups/<userId>/ (excluded from iCloud backup: it is a cache
    /// of work the server will have).
    public static func forUser(_ userId: String) -> BoardBackupStore {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let safe = userId.filter { $0.isLetter || $0.isNumber || $0 == "-" }
        return BoardBackupStore(directory: base.appendingPathComponent("AgathonBoardBackups/\(safe.isEmpty ? "_" : safe)", isDirectory: true))
    }

    func url(_ boardId: String) -> URL {
        let safe = boardId.filter { $0.isLetter || $0.isNumber || $0 == "-" }
        return directory.appendingPathComponent("\(safe.isEmpty ? "_" : safe).json")
    }

    public func read(_ boardId: String) -> BoardBackup? {
        lock.lock()
        defer { lock.unlock() }
        guard let data = try? Data(contentsOf: url(boardId)) else { return nil }
        let dec = JSONDecoder()
        dec.dateDecodingStrategy = .millisecondsSince1970
        guard let backup = try? dec.decode(BoardBackup.self, from: data), backup.boardId == boardId else { return nil }
        return backup
    }

    /// False when it could not be written (the device is full).
    @discardableResult
    public func write(_ backup: BoardBackup) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            var dir = directory
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? dir.setResourceValues(values)
            let enc = JSONEncoder()
            enc.dateEncodingStrategy = .millisecondsSince1970
            enc.outputFormatting = [.withoutEscapingSlashes]
            try enc.encode(backup).write(to: url(backup.boardId), options: [.atomic])
            return true
        } catch {
            return false
        }
    }

    public func clear(_ boardId: String) {
        lock.lock()
        defer { lock.unlock() }
        try? FileManager.default.removeItem(at: url(boardId))
    }

    public func exists(_ boardId: String) -> Bool {
        FileManager.default.fileExists(atPath: url(boardId).path)
    }
}

/// Puts a backup's records back over a freshly loaded board (the web's `restoreBackups`), record by
/// record. For each record the backup changed or removed, the loaded board decides:
///
/// - the server still has it as it was at the backup's base → only this device changed it: restored
/// - the server has exactly what an unanswered write of this device sent → still this device's own: restored
/// - the server changed it too since → the server's stays, and the stale local change is counted
/// - the server already holds the local record → nothing to do
///
/// Restored records are this device's unsaved changes again (`.system`: saved, not undoable).
public enum BackupRestore {
    public struct Report: Equatable, Sendable {
        /// records put or removed
        public var applied = 0
        /// local changes not restored because the server changed the same record since
        public var stale = 0
    }

    @MainActor
    public static func restore(_ backup: BoardBackup, into store: BoardStore, loadedVersion: Int?) -> Report {
        let server = store.records
        var outcome: [RecordID: BoardRecord?] = [:]
        var stale = Set<RecordID>()
        let atBase = backup.baseVersion != nil && backup.baseVersion == loadedVersion

        func serverMoved(_ id: RecordID) -> Bool {
            let now = server[id]
            // `base` holds every record the backup touched as the server had it (none: it was new)
            if now == backup.base[id.rawValue] { return false }
            // …and a board still at the backup's base version has not moved at all
            if atBase && backup.base.isEmpty && now == nil { return false }
            if let sent = backup.sent, let s = sent[id.rawValue], s == now { return false }
            return true
        }

        func decide(_ id: RecordID, _ value: BoardRecord?) {
            if server[id] == value {
                outcome[id] = .some(value)
                stale.remove(id)
            } else if serverMoved(id) {
                if outcome[id] == nil { stale.insert(id) }
            } else {
                outcome[id] = .some(value)
                stale.remove(id)
            }
        }
        for id in backup.changed {
            if let r = backup.records[id.rawValue] { decide(id, r) }
        }
        for id in backup.removed { decide(id, nil) }

        var report = Report(applied: 0, stale: stale.count)
        let changes = outcome.compactMap { id, value -> (RecordID, BoardRecord?)? in
            let target = value ?? nil
            return server[id] == target ? nil : (id, target)
        }
        guard !changes.isEmpty else { return report }
        store.transact(.system) { tx in
            for (id, value) in changes {
                if let value { tx.put(value) } else { tx.remove(id) }
            }
        }
        report.applied = changes.count
        return report
    }
}
