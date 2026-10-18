import AgathonBoard
import Foundation
import Testing
@testable import AgathonSync

/// Opening, converting, saving and reopening a board end to end, on a fake row.
@MainActor
struct BoardSessionTests {
    func session(_ remote: FakeRemote, backups: BoardBackupStore? = nil, scheduler: ManualScheduler? = nil) -> BoardSession {
        BoardSession(boardId: "b1", remote: remote, assets: MemoryAssets(), backup: backups, scheduler: scheduler ?? ManualScheduler())
    }

    func tempBackups() -> BoardBackupStore {
        BoardBackupStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent("agathon-session-\(UUID().uuidString)"))
    }

    @Test func anOldWebBoardIsConvertedSavedAndReopened() async throws {
        let remote = FakeRemote(version: 7, data: try Fixture.tldraw("kid-algebra"))
        let clock = ManualScheduler()
        let s = session(remote, scheduler: clock)
        await s.open()
        #expect(s.phase == .ready && s.source == .converted)
        #expect(s.conversion?.strokes == 50)
        let converted = s.controller.store.records
        // converted in memory only: nothing written yet
        #expect(await remote.writeCount() == 0)
        #expect(s.sync.status == .saved && !s.sync.pending)

        // draw on it
        let screen = s.controller.currentScreenID
        s.controller.commitStroke(kidStroke("stroke:new1", screen: screen, order: s.controller.store.nextOrder(on: screen), x: 300, y: 700).stroke!)
        clock.advance(by: 2.1)
        await s.queue?.waitIdle()
        #expect(await remote.writeCount() == 1)
        #expect(s.sync.status == .saved && s.sync.version == 8)
        let stored = try #require(try await remote.storedDocument())
        // the whole board went up: every converted record, and the new stroke
        #expect(stored.records.count == converted.count + 1)
        #expect(stored.records["stroke:new1"] != nil)
        // the thumbnail went with it, within the column's limit
        let preview = try #require(await remote.preview)
        #expect(preview.hasPrefix("data:image/jpeg;base64,") && preview.count <= BoardThumbnail.maxChars)

        // reopen: the doc is the board now
        let again = session(remote)
        await again.open()
        #expect(again.source == .doc)
        #expect(again.controller.store.document == s.controller.store.document)
        await s.close()
        await again.close()
    }

    @Test func aNewBoardStartsBlankAndSavesItsScreen() async throws {
        let remote = FakeRemote(version: 1)
        let clock = ManualScheduler()
        let s = session(remote, scheduler: clock)
        await s.open()
        #expect(s.source == .blank && s.controller.store.screens.count == 1)
        let screen = s.controller.currentScreenID
        s.controller.commitStroke(kidStroke("stroke:a", screen: screen, order: "a1").stroke!)
        clock.advance(by: 2.1)
        await s.queue?.waitIdle()
        let stored = try #require(try await remote.storedDocument())
        #expect(stored.screens.map(\.id) == [screen] && stored.records["stroke:a"] != nil)
        await s.close()
    }

    @Test func workLeftUnsavedWhenTheAppDiedIsPutBack() async throws {
        let backups = tempBackups()
        defer { try? FileManager.default.removeItem(at: backups.directory) }
        let remote = FakeRemote(version: 1)
        await remote.setOffline(true)
        let clock = ManualScheduler()
        let first = session(remote, backups: backups, scheduler: clock)
        await first.open()
        let screen = first.controller.currentScreenID
        first.controller.commitStroke(kidStroke("stroke:unsaved", screen: screen, order: "a1").stroke!)
        clock.advance(by: 0.6) // the backup, half a second after the stroke
        #expect(backups.exists("b1"))
        // the app is killed here: no save, no close
        first.queue?.dispose()

        await remote.setOffline(false)
        let second = session(remote, backups: backups)
        await second.open()
        #expect(second.restored == .init(applied: 1, stale: 0))
        #expect(second.notice == SaveCopy.restored)
        // the blank board's screen was new: the restore brings its stroke onto the screen as loaded
        #expect(second.controller.store.strokeCount == 1)
        #expect(second.controller.store.hasUnsavedChanges)
        await second.close()
        #expect(try await remote.storedDocument()?.strokes.map(\.id.rawValue) == ["stroke:unsaved"])
        #expect(!backups.exists("b1"))
    }

    @Test func aBoardFromANewerAppIsNotOpened() async throws {
        let newer = Data(#"{"format":"agathon.board","schema":99,"records":{}}"#.utf8)
        let remote = FakeRemote(version: 4, doc: newer, docVersion: 4)
        let s = session(remote)
        await s.open()
        guard case .failed(let why) = s.phase else { Issue.record("opened"); return }
        #expect(why.contains("newer"))
    }

    @Test func aGoneBoardSaysSo() async throws {
        let remote = FakeRemote(version: 1)
        await remote.setGone()
        let s = session(remote)
        await s.open()
        #expect(s.phase == .failed(SaveCopy.boardGone))
    }

    @Test func theSaveWaitsForThePenToLift() async throws {
        let remote = FakeRemote(version: 1)
        let s = session(remote)
        await s.open()
        var down = true
        s.isPenDown = { down }
        let started = Date()
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 300_000_000)
            down = false
        }
        let built = await s.buildUpdate()
        let waited = Date().timeIntervalSince(started)
        #expect(waited >= 0.28 && waited < 1.5)
        guard case .update = built else { Issue.record("not built"); return }
        // and never more than 2 s a wait (a build waits twice: before encoding and before the thumbnail)
        down = true
        let t1 = Date()
        _ = await s.buildUpdate()
        let capped = Date().timeIntervalSince(t1)
        #expect(capped >= 1.9 && capped < 7, "\(capped)")
        await s.close()
    }
}

extension FakeRemote {
    /// offline: fetches work (the board opened before), writes fail as the network would
    func setOffline(_ offline: Bool) {
        scripted = offline ? Array(repeating: .failed(.offline, message: nil), count: 100) : []
    }
}
