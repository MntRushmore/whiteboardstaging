import AgathonBoard
import Foundation
import Testing
@testable import AgathonSync

/// The autosave's guarantees, on a fake row and a clock the test moves (the web's saveQueue tests).
@MainActor
struct SaveQueueTests {
    let screen: RecordID = "screen:s"

    @MainActor
    final class Rig {
        let store: BoardStore
        let remote: FakeRemote
        let scheduler = ManualScheduler()
        let queue: BoardSaveQueue
        let backupDir: URL
        let backups: BoardBackupStore
        var online = true

        init(remote: FakeRemote, document: BoardDocument, version: Int, persisted: [RecordID: BoardRecord]? = nil) {
            store = BoardStore(document: document)
            self.remote = remote
            backupDir = FileManager.default.temporaryDirectory.appendingPathComponent("agathon-sync-tests-\(UUID().uuidString)")
            backups = BoardBackupStore(directory: backupDir)
            let store = self.store
            let remoteRef = remote
            var onlineRef: () -> Bool = { true }
            queue = BoardSaveQueue(
                boardId: "b1", store: store, initialVersion: version, persisted: persisted ?? document.records,
                remote: remote, scheduler: scheduler,
                build: {
                    let doc = store.document
                    let bytes = (try? doc.encoded(sortedKeys: false)) ?? Data()
                    return .update(write: BoardWrite(doc: bytes), records: doc.records, bytes: bytes.count, notice: nil)
                },
                fetchRemote: {
                    guard let row = try await remoteRef.fetch(boardId: "b1") else { return nil }
                    guard case .doc(let d) = row.body else { return ([:], row.version) }
                    return (try BoardDocument.decode(d).records, row.version)
                },
                backup: backups, isOnline: { onlineRef() })
            onlineRef = { [weak self] in self?.online ?? true }
        }

        func cleanUp() { try? FileManager.default.removeItem(at: backupDir) }

        /// Moves the clock and waits for the cycle it started.
        func advance(_ seconds: TimeInterval) async {
            scheduler.advance(by: seconds)
            await queue.waitIdle()
            await settle()
        }
    }

    func doc() -> BoardDocument { BoardDocument([.screen(ScreenRecord(id: screen, order: "a0"))]) }

    func rig(version: Int = 1) async throws -> Rig {
        let remote = FakeRemote(version: version)
        try await remote.otherDeviceSaves(doc()) // the row holds the doc at version + 1
        let v = await remote.version
        return Rig(remote: remote, document: doc(), version: v)
    }

    @Test func savesTwoSecondsAfterTheLastEdit() async throws {
        let r = try await rig()
        r.store.put(kidStroke("stroke:a", screen: screen, order: "a1"), origin: .kid)
        #expect(r.queue.state.status == .dirty && r.queue.state.pending)
        await r.advance(1.9)
        #expect(await r.remote.writeCount() == 0)
        await r.advance(0.2)
        #expect(await r.remote.writeCount() == 1)
        #expect(r.queue.state.status == .saved && !r.queue.state.pending)
        #expect(r.queue.state.version == 3)
        let stored = try #require(try await r.remote.storedDocument())
        #expect(stored.records["stroke:a"] == r.store["stroke:a"])
        // the write was version-checked against the version the board was loaded at
        #expect(await r.remote.lastWrite()?.expected == 2)
    }

    @Test func aBurstThatNeverPausesStillSavesWithinTenSeconds() async throws {
        let r = try await rig()
        for i in 0..<12 {
            r.store.put(kidStroke("stroke:\(i)", screen: screen, order: OrderKey("a\(i + 1)")), origin: .kid)
            await r.advance(1)
        }
        // first write at 10 s into the burst, not 2 s after the (never) last edit
        #expect(await r.remote.writeCount() == 1)
        #expect(r.queue.state.pending) // the edits since are waiting for their own debounce
        await r.advance(3)
        #expect(await r.remote.writeCount() == 2)
        #expect(try await r.remote.storedDocument()?.strokes.count == 12)
    }

    @Test func aNoOpSaveWritesNothing() async throws {
        let r = try await rig()
        r.store.put(kidStroke("stroke:a", screen: screen, order: "a1"), origin: .kid)
        r.store.remove(["stroke:a"], origin: .kid)
        await r.advance(2.1)
        #expect(await r.remote.writeCount() == 0)
        #expect(r.queue.state.status == .saved && !r.queue.state.pending)
    }

    @Test func aConflictMergesRecordByRecordAndLocalEditsWin() async throws {
        let r = try await rig()
        // another device adds a stroke and moves the screen's name
        var theirs = doc()
        theirs.records["stroke:theirs"] = kidStroke("stroke:theirs", screen: screen, order: "a5", x: 900)
        theirs.records[screen] = .screen(ScreenRecord(id: screen, order: "a0", name: "Theirs"))
        try await r.remote.otherDeviceSaves(theirs)
        // here: a new stroke, and the screen renamed too (ours wins)
        r.store.put(kidStroke("stroke:mine", screen: screen, order: "a1"), origin: .kid)
        r.store.put(.screen(ScreenRecord(id: screen, order: "a0", name: "Mine")), origin: .kid)
        await r.advance(2.1)
        #expect(await r.remote.writeCount() == 2) // the conflict, then the merged write
        let stored = try #require(try await r.remote.storedDocument())
        #expect(stored.records["stroke:theirs"] != nil && stored.records["stroke:mine"] != nil)
        #expect(stored.records[screen]?.screen?.name == "Mine")
        // their stroke is on this device's board too, and is not unsaved here
        #expect(r.store["stroke:theirs"] != nil)
        #expect(r.queue.state.status == .saved && r.queue.state.version == 4)
        #expect(!r.store.hasUnsavedChanges)
    }

    @Test func afterThreeConflictRoundsItAsksToReload() async throws {
        let r = try await rig()
        await r.remote.script([.conflict, .conflict, .conflict, .conflict, .conflict])
        r.store.put(kidStroke("stroke:a", screen: screen, order: "a1"), origin: .kid)
        await r.advance(2.1)
        #expect(r.queue.state.status == .error && r.queue.state.message == SaveCopy.mergeFailed)
        #expect(await r.remote.writeCount() == 4)
        #expect(r.queue.state.pending && r.store.hasUnsavedChanges)
        // halted: no retries until asked
        await r.advance(120)
        #expect(await r.remote.writeCount() == 4)
    }

    @Test func failuresRetryAfterTwoFiveFifteenSixtySeconds() async throws {
        let r = try await rig()
        await r.remote.script(Array(repeating: .failed(.other, message: "boom"), count: 5))
        r.store.put(kidStroke("stroke:a", screen: screen, order: "a1"), origin: .kid)
        await r.advance(2.1)
        #expect(await r.remote.writeCount() == 1 && r.queue.state.status == .error && r.queue.state.attempt == 1)
        var times: [TimeInterval] = []
        for _ in 0..<4 {
            let due = try #require(r.scheduler.nextDue)
            times.append((due.timeIntervalSince(r.scheduler.now) * 10).rounded() / 10)
            await r.advance(due.timeIntervalSince(r.scheduler.now))
        }
        #expect(times == [2, 5, 15, 60])
        #expect(await r.remote.writeCount() == 5)
        // the next one goes through
        let due = try #require(r.scheduler.nextDue)
        #expect((due.timeIntervalSince(r.scheduler.now)).rounded() == 60)
        await r.advance(60)
        #expect(r.queue.state.status == .saved && r.queue.state.attempt == 0)
        #expect(try await r.remote.storedDocument()?.records["stroke:a"] != nil)
    }

    @Test func aWriteThatHangsTimesOutAndIsRetried() async throws {
        let r = try await rig()
        await r.remote.hang()
        r.store.put(kidStroke("stroke:a", screen: screen, order: "a1"), origin: .kid)
        r.scheduler.advance(by: 2.1)
        await settle(200)
        #expect(r.queue.state.status == .saving)
        let limit = BoardSaveQueue.persistTimeout(bytes: 2000)
        #expect(limit > 30 && limit < 30.2)
        r.scheduler.advance(by: 30.5)
        await r.queue.waitIdle()
        #expect(r.queue.state.status == .error && r.queue.state.message == SaveCopy.saveTimeout)
        await r.advance(2.1) // the first retry
        #expect(r.queue.state.status == .saved)
        #expect(await r.remote.writeCount() == 2)
    }

    @Test func offlineWaitsAndSavesWhenTheNetworkReturns() async throws {
        let r = try await rig()
        r.online = false
        r.store.put(kidStroke("stroke:a", screen: screen, order: "a1"), origin: .kid)
        #expect(r.queue.state.status == .offline)
        await r.advance(2.1)
        #expect(await r.remote.writeCount() == 0 && r.queue.state.status == .offline)
        r.online = true
        r.queue.setOnline(true)
        await r.queue.waitIdle()
        await settle()
        #expect(await r.remote.writeCount() == 1 && r.queue.state.status == .saved)
    }

    @Test func goneStopsAndTooLargeRefuses() async throws {
        let r = try await rig()
        await r.remote.script([.failed(.tooLarge, message: nil)])
        r.store.put(kidStroke("stroke:a", screen: screen, order: "a1"), origin: .kid)
        await r.advance(2.1)
        #expect(r.queue.state.status == .refused && r.queue.state.message == SaveCopy.boardFull)
        await r.remote.setGone()
        r.store.put(kidStroke("stroke:b", screen: screen, order: "a2"), origin: .kid)
        await r.advance(2.1)
        #expect(r.queue.state.status == .error && r.queue.state.message == SaveCopy.boardGone)
        let writes = await r.remote.writeCount()
        await r.advance(200)
        #expect(await r.remote.writeCount() == writes)
    }

    @Test func theBackupFollowsTheUnsavedRecords() async throws {
        let r = try await rig()
        await r.remote.script([.failed(.offline, message: nil)])
        r.store.put(kidStroke("stroke:a", screen: screen, order: "a1"), origin: .kid)
        #expect(!r.backups.exists("b1"))
        await r.advance(0.6) // half a second after the edit
        let first = try #require(r.backups.read("b1"))
        #expect(first.changed == ["stroke:a"] && first.records["stroke:a"] != nil && first.baseVersion == 2)
        #expect(first.base.isEmpty) // a new record: the server had nothing
        await r.advance(2) // the write fails offline: the backup stays, with what the write sent
        let second = try #require(r.backups.read("b1"))
        #expect(second.changed == ["stroke:a"])
        // the retry lands: the backup goes
        await r.advance(2.1)
        #expect(r.queue.state.status == .saved)
        #expect(!r.backups.exists("b1"))
    }

    @Test func flushSavesAtOnce() async throws {
        let r = try await rig()
        r.store.put(kidStroke("stroke:a", screen: screen, order: "a1"), origin: .kid)
        let s = await r.queue.flush()
        #expect(s.status == .saved)
        #expect(await r.remote.writeCount() == 1)
    }

    @Test func backoffAndTimeoutNumbers() {
        #expect(BoardSaveQueue.backoff(1) == 2 && BoardSaveQueue.backoff(2) == 5 && BoardSaveQueue.backoff(3) == 15 && BoardSaveQueue.backoff(4) == 60 && BoardSaveQueue.backoff(9) == 60)
        // a 4 MB board gets 200 s more (a 20 KB/s link)
        #expect(BoardSaveQueue.persistTimeout(bytes: 4_000_000) == 230)
    }
}

/// The record merge (the web's mergeDocumentRecords cases).
struct RecordMergeTests {
    let s: RecordID = "screen:s"

    func stroke(_ id: String, x: Double = 0) -> BoardRecord { kidStroke(id, screen: s, order: "a1", x: x) }

    @Test func cases() {
        let local: [RecordID: BoardRecord] = ["stroke:mine": stroke("stroke:mine"), "stroke:both": stroke("stroke:both", x: 1), "stroke:old": stroke("stroke:old"), "stroke:kept": stroke("stroke:kept")]
        let remote: [RecordID: BoardRecord] = ["stroke:both": stroke("stroke:both", x: 2), "stroke:new": stroke("stroke:new"), "stroke:erasedHere": stroke("stroke:erasedHere"), "stroke:kept": stroke("stroke:kept", x: 9)]
        let r = RecordMerge.merge(local: local, remote: remote, changed: ["stroke:mine", "stroke:both"], removed: ["stroke:erasedHere"])
        #expect(r.merged["stroke:mine"] == local["stroke:mine"]) // added here
        #expect(r.merged["stroke:both"] == local["stroke:both"]) // changed on both: ours
        #expect(r.merged["stroke:new"] == remote["stroke:new"]) // added there
        #expect(r.merged["stroke:erasedHere"] == nil) // removed here
        #expect(r.merged["stroke:old"] == nil) // untouched here, gone there
        #expect(r.merged["stroke:kept"] == remote["stroke:kept"]) // untouched here, changed there
        #expect(Set(r.put.map(\.id)) == ["stroke:new", "stroke:kept"])
        #expect(Set(r.remove) == ["stroke:erasedHere", "stroke:old"])
    }
}

/// Putting a backup back over a freshly loaded board.
@MainActor
struct BackupRestoreTests {
    let s: RecordID = "screen:s"

    func store(_ records: [BoardRecord]) -> BoardStore {
        BoardStore(document: BoardDocument([.screen(ScreenRecord(id: s, order: "a0"))] + records))
    }

    @Test func onlyThisDeviceChangedIt() {
        let mine = kidStroke("stroke:a", screen: s, order: "a1")
        let b = BoardBackup(boardId: "b", baseVersion: 3, changed: ["stroke:a"], removed: [], records: ["stroke:a": mine], base: [:], at: Date())
        let st = store([])
        let r = BackupRestore.restore(b, into: st, loadedVersion: 3)
        #expect(r == .init(applied: 1, stale: 0))
        #expect(st["stroke:a"] == mine && st.hasUnsavedChanges)
    }

    @Test func theServerChangedItTooSoTheServerWins() {
        let base = kidStroke("stroke:a", screen: s, order: "a1", x: 1)
        let mine = kidStroke("stroke:a", screen: s, order: "a1", x: 2)
        let theirs = kidStroke("stroke:a", screen: s, order: "a1", x: 3)
        let b = BoardBackup(boardId: "b", baseVersion: 3, changed: ["stroke:a"], removed: [], records: ["stroke:a": mine], base: ["stroke:a": base], at: Date())
        let st = store([theirs])
        let r = BackupRestore.restore(b, into: st, loadedVersion: 5)
        #expect(r == .init(applied: 0, stale: 1))
        #expect(st["stroke:a"] == theirs)
    }

    @Test func aWriteThatLandedIsStillThisDevicesOwn() {
        let base = kidStroke("stroke:a", screen: s, order: "a1", x: 1)
        let sent = kidStroke("stroke:a", screen: s, order: "a1", x: 2)
        let newer = kidStroke("stroke:a", screen: s, order: "a1", x: 4)
        let b = BoardBackup(boardId: "b", baseVersion: 3, changed: ["stroke:a"], removed: [], records: ["stroke:a": newer], base: ["stroke:a": base], sent: ["stroke:a": sent], at: Date())
        let st = store([sent])
        #expect(BackupRestore.restore(b, into: st, loadedVersion: 4) == .init(applied: 1, stale: 0))
        #expect(st["stroke:a"] == newer)
    }

    @Test func anEraseIsPutBack() {
        let gone = kidStroke("stroke:a", screen: s, order: "a1")
        let b = BoardBackup(boardId: "b", baseVersion: 3, changed: [], removed: ["stroke:a"], records: [:], base: ["stroke:a": gone], at: Date())
        let st = store([gone])
        #expect(BackupRestore.restore(b, into: st, loadedVersion: 3) == .init(applied: 1, stale: 0))
        #expect(st["stroke:a"] == nil)
    }

    @Test func theServerAlreadyHasItNothingToDo() {
        let mine = kidStroke("stroke:a", screen: s, order: "a1")
        let b = BoardBackup(boardId: "b", baseVersion: 3, changed: ["stroke:a"], removed: [], records: ["stroke:a": mine], base: [:], at: Date())
        let st = store([mine])
        #expect(BackupRestore.restore(b, into: st, loadedVersion: 4) == .init(applied: 0, stale: 0))
        #expect(!st.hasUnsavedChanges)
    }

    @Test func backupFilesRoundTrip() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("agathon-backup-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = BoardBackupStore(directory: dir)
        let mine = kidStroke("stroke:a", screen: s, order: "a1")
        let b = BoardBackup(boardId: "11111111-2222", baseVersion: 3, changed: ["stroke:a"], removed: ["stroke:b"], records: ["stroke:a": mine], base: [:], sent: ["stroke:b": nil], at: Date(timeIntervalSince1970: 1_760_000_000))
        #expect(store.write(b))
        #expect(store.read("11111111-2222") == b)
        store.clear("11111111-2222")
        #expect(store.read("11111111-2222") == nil)
    }
}
