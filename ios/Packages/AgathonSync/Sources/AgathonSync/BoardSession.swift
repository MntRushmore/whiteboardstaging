import AgathonBoard
import Combine
import Foundation
import Network

/// One board open in the app: read it, show it, save it.
///
/// - **Open:** the row's Agathon document when it is the board (`doc`, current); else the web's
///   tldraw board (`data`) converted once (`TldrawImporter`, its inline pictures uploaded) and kept in
///   memory: nothing is written until the first edit is saved, and the tldraw original is never
///   changed. A new board starts blank.
/// - **Unsaved work from before** (the app was killed, or the network never came back): the device
///   backup is put back record by record over the board as loaded (`BackupRestore`).
/// - **Save:** `BoardSaveQueue`: 2 s after an edit (10 s at most), after the pen lifts (2 s at most),
///   version-checked, merged on conflict, retried, backed up; the thumbnail rides along. At once when
///   the app leaves the screen (`appWillResignActive`).
@MainActor
public final class BoardSession: ObservableObject {
    public enum Phase: Equatable {
        case loading
        case ready
        case failed(String)
    }

    /// Where the board on screen came from.
    public enum Source: Equatable {
        /// the iPad app's document
        case doc
        /// the web's board, converted on this open (not written until the first save)
        case converted
        /// a new board
        case blank
    }

    @Published public private(set) var phase: Phase = .loading
    @Published public private(set) var sync = SyncState()
    @Published public private(set) var source: Source?
    /// what converting the web's board did (nil for a document)
    @Published public private(set) var conversion: TldrawImporter.Report?
    /// a note for the kid (work put back from the backup)
    @Published public private(set) var notice: String?
    @Published public private(set) var restored: BackupRestore.Report?
    /// how long opening took, and its parts (the QA numbers)
    @Published public private(set) var openTimings: [String: Double] = [:]
    /// False when the server cannot hold the app's board yet (no `doc` column: the migration is not
    /// applied there): the board opens and can be drawn on, edits stay on this device ("Not saved yet").
    @Published public private(set) var canSave = true

    public let boardId: String
    public let controller: BoardController
    public let remote: any BoardRemote
    public let assets: any BoardAssetStore
    public let backup: BoardBackupStore?
    public let scheduler: SaveScheduler
    /// True while a pen or finger is on the board (the canvas's gesture state), so a save is built
    /// between strokes, never in the middle of one.
    public var isPenDown: @MainActor () -> Bool = { false }

    public private(set) var queue: BoardSaveQueue?
    private var queueWatch: AnyCancellable?
    private let rungs = RungMemory()
    private var network: NWPathMonitor?
    private var networkOnline = true

    /// The web refuses to autosave above this (SNAPSHOT_LIMITS.hardBytes); the app too.
    public static let hardBytes = 4_000_000
    public static let nearlyFullBytes = hardBytes * 8 / 10
    /// The pen: how long a save waits for it to lift, and how often it looks.
    public static let penUpWait: TimeInterval = 2
    public static let penUpPoll: TimeInterval = 0.05

    public init(
        boardId: String, remote: any BoardRemote, assets: any BoardAssetStore, backup: BoardBackupStore?,
        scheduler: SaveScheduler? = nil, controller: BoardController? = nil
    ) {
        self.boardId = boardId
        self.remote = remote
        self.assets = assets
        self.backup = backup
        self.scheduler = scheduler ?? LiveScheduler()
        self.controller = controller ?? BoardController()
    }

    // MARK: - opening

    public func open() async {
        phase = .loading
        let t0 = Date()
        do {
            guard let row = try await remote.fetch(boardId: boardId) else {
                phase = .failed(SaveCopy.boardGone)
                return
            }
            let t1 = Date()
            canSave = row.docColumn
            let loaded = try await load(row.body, uploadPictures: row.docColumn)
            let t2 = Date()
            source = loaded.source
            conversion = loaded.report
            controller.load(loaded.document, screen: loaded.currentScreen)
            let queue = BoardSaveQueue(
                boardId: boardId, store: controller.store, initialVersion: row.version, persisted: loaded.persisted,
                remote: remote, scheduler: scheduler,
                build: { [weak self] in await self?.buildUpdate() ?? .refused(SaveCopy.saveFailed) },
                fetchRemote: { [weak self] in try await self?.fetchRemoteRecords() },
                backup: backup, isOnline: { [weak self] in self?.networkOnline ?? true }, localOnly: !row.docColumn)
            self.queue = queue
            queueWatch = queue.$state.sink { [weak self] state in
                self?.sync = state
                if state.status == .localOnly { self?.canSave = false }
            }
            sync = queue.state
            restoreBackup(loadedVersion: row.version)
            watchNetwork()
            openTimings = ["fetch": t1.timeIntervalSince(t0) * 1000, "decode": t2.timeIntervalSince(t1) * 1000, "total": Date().timeIntervalSince(t0) * 1000]
            phase = .ready
        } catch let BoardDocument.BoardFormatError.newerSchema(v) {
            phase = .failed("This board was saved by a newer Agathon (format \(v)). Update the app to open it.")
        } catch {
            phase = .failed("Couldn't open this board. \((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)")
        }
    }

    struct Loaded {
        var document: BoardDocument
        /// the records as the server holds them at the row's version (empty for a blank board)
        var persisted: [RecordID: BoardRecord]
        var source: Source
        var report: TldrawImporter.Report?
        var currentScreen: RecordID?
    }

    /// A row's board as a document, off the main thread.
    func load(_ body: RemoteBoard.Body, uploadPictures: Bool = true) async throws -> Loaded {
        switch body {
        case .doc(let bytes):
            let doc = try await Task.detached(priority: .userInitiated) { try BoardDocument.decode(bytes) }.value
            return Loaded(document: doc, persisted: doc.records, source: .doc)
        case .tldraw(let bytes):
            let boardId = self.boardId
            let assets = self.assets
            // (a board that cannot be saved here keeps its inline pictures inline: nothing is written)
            let result = try await Task.detached(priority: .userInitiated) {
                uploadPictures ? try await TldrawImporter.importSnapshot(bytes, boardId: boardId, assets: assets) : try TldrawImporter.importSnapshot(bytes)
            }.value
            return Loaded(document: result.document, persisted: result.document.records, source: .converted, report: result.report, currentScreen: result.currentScreen)
        case .empty:
            return Loaded(document: Self.blankDocument(boardId: boardId), persisted: [:], source: .blank)
        }
    }

    /// A new board: one screen, its id from the board's (the same on every open, so work put back
    /// from a backup lands on the screen it was drawn on before the board was ever saved).
    public static func blankDocument(boardId: String) -> BoardDocument {
        let key = String(boardId.filter { $0.isASCII && ($0.isLetter || $0.isNumber) }.prefix(24))
        return BoardDocument([.screen(ScreenRecord(id: RecordID("screen:\(key.isEmpty ? "first" : key)"), order: .first))])
    }

    /// The server's board now, as records (for the merge after a conflict).
    func fetchRemoteRecords() async throws -> (records: [RecordID: BoardRecord], version: Int)? {
        guard let row = try await remote.fetch(boardId: boardId) else { return nil }
        return (try await load(row.body, uploadPictures: row.docColumn).persisted, row.version)
    }

    private func restoreBackup(loadedVersion: Int) {
        guard let backup, let saved = backup.read(boardId) else { return }
        let report = BackupRestore.restore(saved, into: controller.store, loadedVersion: loadedVersion)
        restored = report
        if report.stale > 0 {
            notice = SaveCopy.staleRestore
        } else if report.applied > 0 {
            notice = SaveCopy.restored
        } else {
            backup.clear(boardId) // the server has all of it already
        }
        if report.applied > 0 { queue?.writeBackupNow() }
    }

    // MARK: - saving

    /// Waits (up to `penUpWait`) for the pen to lift.
    func waitForPenUp() async {
        var waited: TimeInterval = 0
        while isPenDown(), waited < Self.penUpWait {
            try? await Task.sleep(nanoseconds: UInt64(Self.penUpPoll * 1_000_000_000))
            waited += Self.penUpPoll
        }
    }

    /// The write: the whole document (inline pictures moved out first), and the thumbnail.
    func buildUpdate() async -> BuiltUpdate {
        await waitForPenUp()
        await uploadInlineImages()
        let doc = controller.store.document
        let bytes: Data
        do {
            bytes = try await Task.detached(priority: .utility) { try doc.encoded(sortedKeys: false) }.value
        } catch {
            return .refused(SaveCopy.saveFailed)
        }
        if bytes.count > Self.hardBytes { return .refused(SaveCopy.boardFull) }
        // the pen may have come down again while the board was encoded
        await waitForPenUp()
        let preview = await BoardThumbnail.preview(store: controller.store, screen: controller.currentScreenID, memory: rungs, now: scheduler.now)
        return .update(
            write: BoardWrite(doc: bytes, preview: preview, updatedAt: scheduler.now), records: doc.records, bytes: bytes.count,
            notice: bytes.count > Self.nearlyFullBytes ? SaveCopy.boardNearlyFull : nil)
    }

    /// A picture still inline (its upload failed when the board was converted) gets another try.
    func uploadInlineImages() async {
        let store = controller.store
        let inline = store.records.values.filter { if case .image(let i) = $0 { return i.asset.src.hasPrefix("data:") }; return false }
        guard !inline.isEmpty else { return }
        let moved = await TldrawImporter.uploadInlineImages(in: BoardDocument(inline), boardId: boardId, assets: assets)
        guard moved.uploaded > 0 else { return }
        store.transact(.system) { tx in
            for (id, rec) in moved.document.records {
                // only where the record is still the one that was uploaded
                guard case .image(var now)? = tx[id], case .image(let up) = rec,
                      now.asset.src.hasPrefix("data:"), !up.asset.src.hasPrefix("data:") else { continue }
                now.asset.src = up.asset.src
                if now.asset.mime == nil { now.asset.mime = up.asset.mime }
                tx.put(.image(now))
            }
        }
    }

    // MARK: - the app's life

    /// The app is leaving the screen: back up and save now (iPadOS may end it without another word).
    public func appWillResignActive() async {
        queue?.writeBackupNow()
        await queue?.flush()
    }

    /// Saves now and stops (the board is closing).
    public func close() async {
        queue?.writeBackupNow()
        await queue?.flush()
        queue?.dispose()
        network?.cancel()
        network = nil
    }

    public func retry() async {
        await queue?.retry()
    }

    private func watchNetwork() {
        guard network == nil else { return }
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor [weak self] in
                guard let self, self.networkOnline != online else { return }
                self.networkOnline = online
                self.queue?.setOnline(online)
            }
        }
        monitor.start(queue: DispatchQueue(label: "agathon.sync.network"))
        network = monitor
    }
}
