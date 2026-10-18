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

/// Production before the doc migration: boards open from `data`, edits stay on the device, nothing is
/// written, and the work is saved on the first open after the migration.
@MainActor
struct LocalOnlyTests {
    @Test func aDatabaseWithoutTheDocColumnNeverGetsAWrite() async throws {
        let backups = BoardBackupStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent("agathon-local-\(UUID().uuidString)"))
        defer { try? FileManager.default.removeItem(at: backups.directory) }
        let remote = FakeRemote(version: 5, data: try Fixture.tldraw("all-shapes"))
        await remote.setDocColumn(false)
        let clock = ManualScheduler()
        let assets = MemoryAssets()
        let s = BoardSession(boardId: "b1", remote: remote, assets: assets, backup: backups, scheduler: clock)
        await s.open()
        #expect(s.phase == .ready && s.source == .converted && !s.canSave)
        #expect(assets.uploads == 0) // its inline picture stays inline: nothing goes to the server
        let screen = s.controller.currentScreenID
        s.controller.commitStroke(kidStroke("stroke:local", screen: screen, order: s.controller.store.nextOrder(on: screen)).stroke!)
        #expect(s.sync.status == .localOnly && s.sync.message == SaveCopy.notSavedYet && s.sync.pending)
        clock.advance(by: 30)
        await s.queue?.waitIdle()
        await s.appWillResignActive()
        await s.retry()
        #expect(await remote.writeCount() == 0)
        #expect(backups.read("b1")?.changed == ["stroke:local"])
        s.queue?.dispose()

        // the migration lands: the next open saves what this iPad kept
        await remote.setDocColumn(true)
        let after = BoardSession(boardId: "b1", remote: remote, assets: assets, backup: backups, scheduler: ManualScheduler())
        await after.open()
        #expect(after.canSave && after.restored == .init(applied: 1, stale: 0))
        await after.close()
        #expect(await remote.writeCount() == 1)
        #expect(try await remote.storedDocument()?.records["stroke:local"] != nil)
    }

    @Test func aWriteRefusedForTheMissingColumnSwitchesToLocalOnly() async throws {
        let remote = FakeRemote(version: 1)
        let clock = ManualScheduler()
        let s = BoardSession(boardId: "b1", remote: remote, assets: MemoryAssets(), backup: nil, scheduler: clock)
        await s.open()
        await remote.script([.failed(.unsupported, message: nil)])
        let screen = s.controller.currentScreenID
        s.controller.commitStroke(kidStroke("stroke:a", screen: screen, order: "a1").stroke!)
        clock.advance(by: 2.1)
        await s.queue?.waitIdle()
        #expect(s.sync.status == .localOnly && !s.canSave)
        clock.advance(by: 120)
        await s.queue?.waitIdle()
        #expect(await remote.writeCount() == 1) // never retried
    }
}

/// PostgREST as the app sees it (a fake transport).
struct PostgrestBoardRemoteTests {
    func remote(_ handler: @escaping (URLRequest) throws -> (Int, Data)) -> (PostgrestBoardRemote, FakeTransport) {
        let t = FakeTransport(handler)
        return (PostgrestBoardRemote(connection: SupabaseConnection(url: URL(string: "http://127.0.0.1:54321")!, anonKey: "anon", transport: t, token: { "tok" })), t)
    }

    @Test func readsACurrentDocAsItsBytes() async throws {
        let doc = #"{"format":"agathon.board","schema":1,"records":{"screen:a":{"id":"screen:a","type":"screen","order":"a0","rect":{"x":0,"y":0,"w":1600,"h":900}}}}"#
        let (r, t) = remote { _ in (200, Data(#"{"version": 4, "doc_version": 4, "doc": \#(doc)}"#.utf8)) }
        let row = try #require(try await r.fetch(boardId: "b1"))
        #expect(row.version == 4 && row.docColumn)
        guard case .doc(let bytes) = row.body else { Issue.record("not the doc"); return }
        #expect(try BoardDocument.decode(bytes).screens.count == 1)
        #expect(t.requests.count == 1)
        #expect(t.requests[0].value(forHTTPHeaderField: "Authorization") == "Bearer tok")
    }

    @Test func aStaleDocReadsTheData() async throws {
        let (r, t) = remote { req in
            req.url!.query!.contains("data") ? (200, Data(#"{"version":5,"data":{"store":{}}}"#.utf8)) : (200, Data(#"{"version":5,"doc_version":4,"doc":{}}"#.utf8))
        }
        let row = try #require(try await r.fetch(boardId: "b1"))
        guard case .tldraw = row.body else { Issue.record("not the data"); return }
        #expect(row.docColumn && t.requests.count == 2)
    }

    @Test func aDatabaseWithoutTheColumnsIsDetected() async throws {
        let (r, _) = remote { req in
            req.url!.query!.contains("doc")
                ? (400, Data(#"{"code":"42703","message":"column whiteboards.doc_version does not exist"}"#.utf8))
                : (200, Data(#"{"version":2,"data":{}}"#.utf8))
        }
        let row = try #require(try await r.fetch(boardId: "b1"))
        #expect(!row.docColumn)
        guard case .empty = row.body else { Issue.record("not empty"); return }
    }

    @Test func writesMapLikeTheWebs() async throws {
        func result(_ status: Int, _ body: String, exists: Bool = true) async -> PersistResult {
            let (r, _) = remote { req in req.httpMethod == "PATCH" ? (status, Data(body.utf8)) : (200, Data(exists ? "[{\"version\":9}]".utf8 : "[]".utf8)) }
            return await r.persist(boardId: "b1", write: BoardWrite(doc: Data("{}".utf8)), expectedVersion: 3)
        }
        #expect(await result(200, #"[{"version":4}]"#) == .ok(version: 4))
        #expect(await result(200, "[]") == .conflict)
        #expect(await result(200, "[]", exists: false) == .failed(.gone, message: nil))
        #expect(await result(400, #"{"code":"23514","message":"violates check"}"#) == .failed(.tooLarge, message: nil))
        #expect(await result(500, #"{"code":"57014","message":"canceling statement due to statement timeout"}"#) == .failed(.timeout, message: nil))
        #expect(await result(400, #"{"code":"PGRST204","message":"Could not find the 'doc' column of 'whiteboards' in the schema cache"}"#) == .failed(.unsupported, message: nil))
    }

    @Test func theWriteBodyIsTheDocumentSplicedIn() throws {
        let w = BoardWrite(doc: Data(#"{"format":"agathon.board","schema":1,"records":{}}"#.utf8), preview: .set("data:image/jpeg;base64,AAA"), updatedAt: Date(timeIntervalSince1970: 1_760_000_000))
        let obj = try #require(try JSONSerialization.jsonObject(with: w.body()) as? [String: Any])
        #expect((obj["doc"] as? [String: Any])?["format"] as? String == "agathon.board")
        #expect(obj["preview"] as? String == "data:image/jpeg;base64,AAA")
        #expect((obj["updated_at"] as? String)?.hasPrefix("2025-10-09T") == true)
        let cleared = try #require(try JSONSerialization.jsonObject(with: BoardWrite(doc: Data("{}".utf8), preview: .clear).body()) as? [String: Any])
        #expect(cleared["preview"] is NSNull)
    }

    @Test func topLevelFieldsAreFoundWithoutParsingTheValues() throws {
        let f = try TopLevelJSON.fields(of: Data(#" { "version" : 12 , "s":"a\"}b", "doc" : {"x":[1,{"y":"}"}]} } "#.utf8))
        #expect(f.int("version") == 12)
        #expect(String(decoding: f.raw("doc")!, as: UTF8.self) == #"{"x":[1,{"y":"}"}]}"#)
    }
}

/// The thumbnail fits the column.
@MainActor
struct ThumbnailTests {
    @Test func aDenseScreenFitsTwentyThousandCharacters() throws {
        let doc = try TldrawImporter.importSnapshot(Fixture.tldraw("kid-algebra")).document
        let store = BoardStore(document: doc)
        let screen = try #require(store.screenIDs.first)
        let scene = try #require(BoardThumbnail.scene(store: store, screen: screen))
        let fit = try #require(BoardThumbnail.fitted(scene.items, rect: scene.rect, maxChars: BoardThumbnail.maxChars))
        #expect(fit.url.hasPrefix("data:image/jpeg;base64,") && fit.url.count <= BoardThumbnail.maxChars)
        // a blank board clears it
        let blank = BoardStore(document: BoardSession.blankDocument(boardId: "b"))
        #expect(BoardThumbnail.scene(store: blank, screen: blank.screenIDs[0]) == nil)
    }
}

/// The asset store's paths and uploads.
struct AssetStoreTests {
    @Test func pathsFollowTheWebsRule() {
        #expect(SupabaseBoardAssetStore.objectPath(userId: "u-1", boardId: "b/../x", assetId: "asset:abc", mime: "image/jpeg") == "u-1/b____x/abc.jpg")
        #expect(SupabaseBoardAssetStore.ext(for: "image/png") == "png" && SupabaseBoardAssetStore.ext(for: "video/mp4") == "bin")
    }

    @Test func uploadsOnceAndRegistersTheRow() async throws {
        let t = FakeTransport { req in
            if req.url!.path.contains("/storage/v1/object/board-assets/") { return (200, Data("{}".utf8)) }
            return (201, Data())
        }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("agathon-assets-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = SupabaseBoardAssetStore(
            connection: SupabaseConnection(url: URL(string: "http://127.0.0.1:54321")!, anonKey: "anon", transport: t, token: { "tok" }),
            userId: "user1", cacheDirectory: dir)
        let png = Data([0x89, 0x50, 0x4E, 0x47, 1, 2, 3])
        let url = try await store.upload(png, mimeType: "image/png", boardId: "board1", width: 4, height: 4, source: "sticker")
        #expect(url.absoluteString.hasPrefix("http://127.0.0.1:54321/storage/v1/object/public/board-assets/user1/board1/"))
        #expect(url.pathExtension == "png")
        #expect(t.requests.count == 2)
        let row = try #require(try JSONSerialization.jsonObject(with: t.requests[1].httpBody ?? Data()) as? [String: Any])
        #expect(row["whiteboard_id"] as? String == "board1" && row["source"] as? String == "sticker" && row["bytes"] as? Int == 7)
        // read back from the cache, no request
        #expect(try await store.data(for: url) == png)
        #expect(t.requests.count == 2)
        // an object that is there already is a success (and no second row)
        t.handler = { _ in (400, Data(#"{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}"#.utf8)) }
        _ = try await store.upload(png, mimeType: "image/png", boardId: "board1", width: 4, height: 4, source: "user")
        #expect(t.requests.count == 3)
    }
}
