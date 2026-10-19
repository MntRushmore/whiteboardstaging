import AgathonBrain
import AgathonKit
import Foundation
import Testing
@testable import AgathonLive

/// The learning record's saving, as the web's boardLearning.ts saves: the schedule (5 s after a
/// change, at least 15 s apart, backing off when a retry can fix it, stopping when it cannot), the
/// device's pending queue (offline, an app killed, a relaunch), a board deleted since, and the
/// board's attempts kept for its next visit.
@MainActor
@Suite(.serialized)
struct LearningQueueTests {
    static let board = "5d0c6f1a-2b3c-4d5e-8f60-0123456789ab"
    static let key = "screen:p1#ink:ln_head"

    final class Clock {
        var ms = LearningClock.t0
    }

    func line(_ clock: Clock, _ lineId: String, _ latex: String, _ mark: LineMark?, solved: Bool = false, board: String = board) -> LearningSignal {
        clock.ms += 10_000
        return .line(.init(at: clock.ms, boardId: board, pageId: "screen:p1", problemKey: Self.key, problemLatex: ["2x+3=11"], lineId: lineId,
                           latex: latex, kind: "equation", previousLatex: nil, mark: mark, solved: solved))
    }

    func recorder(_ store: FakeLearningStore, _ storage: LearningDeviceStorage, _ scheduler: ManualScheduler, _ clock: Clock,
                  board: String = board, user: String = "u1") -> LearningRecorder {
        var n = 0
        return LearningRecorder(boardId: board, userId: user, course: "algebra1", store: store, storage: storage, brain: TestBrain.shared,
                                scheduler: scheduler, clock: { clock.ms }, newId: {
                                    n += 1
                                    return "00000000-0000-4000-8000-\(String(format: "%012d", n))-\(user)"
                                })
    }

    /// Moves the clock on and lets what it started (a save) finish.
    func pass(_ scheduler: ManualScheduler, _ ms: Double) async {
        scheduler.advance(ms)
        for _ in 0..<100 { await Task.yield() }
    }

    func settle(_ r: LearningRecorder) async {
        await r.drained()
        await r.tracker.settled()
        for _ in 0..<10 { await Task.yield() }
    }

    // MARK: - the schedule

    @Test func aSaveIsDue5sAfterTheLastChangeButNoMoreThan15sAfterTheFirst() async throws {
        let scheduler = ManualScheduler()
        var saves = 0
        let s = LearningSaveScheduler(flush: { saves += 1 }, scheduler: scheduler)
        let t = scheduler.now
        s.changed()
        #expect(s.dueAt() == t + 5_000)
        await pass(scheduler, 3_000)
        s.changed()
        #expect(s.dueAt() == t + 8_000, "debounced")
        // a student who keeps working: changes every 3 s never push it past 15 s after the first
        for _ in 0..<3 {
            await pass(scheduler, 3_000)
            s.changed()
        }
        #expect(s.dueAt() == t + 15_000)
        await pass(scheduler, 3_001)
        #expect(saves == 1)
        // the next one no sooner than 15 s after that save
        s.changed()
        #expect(s.dueAt() == t + 15_000 + 15_000)
        await pass(scheduler, 14_000)
        #expect(saves == 1)
        await pass(scheduler, 1_100)
        #expect(saves == 2)
    }

    @Test func aFailureARetryCanFixBacksOff() async throws {
        let scheduler = ManualScheduler()
        var attempts = 0
        var codes: [String] = []
        let s = LearningSaveScheduler(flush: {
            attempts += 1
            if attempts <= 3 { throw FakeLearningStore.Failure(learningStoreCode: "network") }
        }, scheduler: scheduler, onFailed: { code, halted in codes.append("\(code)\(halted ? "!" : "")") })
        s.changed()
        await pass(scheduler, 5_000)
        #expect(attempts == 1)
        // backoff 15 s, then 30 s, then 60 s (each no sooner than 15 s after the last try)
        await pass(scheduler, 14_900)
        #expect(attempts == 1)
        await pass(scheduler, 200)
        #expect(attempts == 2)
        await pass(scheduler, 29_000)
        #expect(attempts == 2)
        await pass(scheduler, 1_100)
        #expect(attempts == 3)
        await pass(scheduler, 59_000)
        #expect(attempts == 3)
        await pass(scheduler, 1_100)
        #expect(attempts == 4, "saved on the fourth try")
        #expect(codes == ["network", "network", "network"])
        #expect(s.dueAt() == nil, "nothing left to save")
    }

    @Test func aFailureNoRetryFixesStopsForTheSession() async throws {
        let scheduler = ManualScheduler()
        var attempts = 0
        let s = LearningSaveScheduler(flush: {
            attempts += 1
            throw FakeLearningStore.Failure(learningStoreCode: "unauthorized")
        }, scheduler: scheduler)
        s.changed()
        await pass(scheduler, 5_000)
        #expect(s.halted == "unauthorized")
        s.changed()
        await pass(scheduler, 60_000)
        await s.flushNow()
        #expect(attempts == 1)
    }

    @Test func invalidIsNotTheEnd() async throws {
        let scheduler = ManualScheduler()
        var attempts = 0
        let s = LearningSaveScheduler(flush: {
            attempts += 1
            if attempts == 1 { throw FakeLearningStore.Failure(learningStoreCode: "invalid") }
        }, scheduler: scheduler)
        s.changed()
        await pass(scheduler, 5_000)
        #expect(s.halted == nil)
        await pass(scheduler, 15_000)
        #expect(attempts == 2, "what that round did not reach goes in the next save")
    }

    @Test func flushNowSavesAtOnce() async throws {
        let scheduler = ManualScheduler()
        var saves = 0
        let s = LearningSaveScheduler(flush: { saves += 1 }, scheduler: scheduler)
        s.changed()
        await s.flushNow()
        #expect(saves == 1)
        await pass(scheduler, 20_000)
        #expect(saves == 1, "nothing left for the timer")
    }

    // MARK: - the device

    func rec(_ id: String, updated: String, outcome: LearningOutcome = .inProgress) -> LearningRecord {
        LearningRecord(id: id, boardId: Self.board, problemLatex: "2x+3=11", skill: "two_step_equations", course: nil, origin: .student,
                       parentId: nil, outcome: outcome, startedAt: "2026-10-18T15:00:00.000Z", updatedAt: updated, finishedAt: nil)
    }

    @Test func pendingKeepsTheLatestOfEachNewestFirstAtMost100() {
        let storage = LearningMemoryStorage()
        LearningDevice.writePending("u1", [rec("a", updated: "2026-10-18T15:01:00.000Z"), rec("b", updated: "2026-10-18T15:03:00.000Z"),
                                           rec("a", updated: "2026-10-18T15:02:00.000Z", outcome: .firstTry)], storage)
        let read = LearningDevice.readPending("u1", storage)
        #expect(read.map(\.id) == ["b", "a"])
        #expect(read.last?.outcome == .firstTry)
        #expect(LearningDevice.readPending("u2", storage).isEmpty, "another student's are not theirs")
        LearningDevice.writePending("u1", (0..<130).map { rec("r\($0)", updated: LearningTime.iso(LearningClock.t0 + Double($0) * 1000)) }, storage)
        let many = LearningDevice.readPending("u1", storage)
        #expect(many.count == 100 && many.first?.id == "r129")
        LearningDevice.writePending("u1", [], storage)
        #expect(storage.files[LearningDevice.pendingName("u1")] == nil, "none clears it")
    }

    @Test func aBrokenEntryIsSkippedNotFatal() throws {
        let storage = LearningMemoryStorage()
        let good = try JSONEncoder().encode(rec("ok", updated: "2026-10-18T15:01:00.000Z"))
        storage.write(LearningDevice.pendingName("u1"), Data("[{\"id\":\"x\"},\(String(decoding: good, as: UTF8.self)),{\"origin\":\"nope\"}]".utf8))
        #expect(LearningDevice.readPending("u1", storage).map(\.id) == ["ok"])
        storage.write(LearningDevice.pendingName("u1"), Data("not json".utf8))
        #expect(LearningDevice.readPending("u1", storage).isEmpty)
    }

    @Test func boardsKeptAreTheEightLeftLast() {
        let storage = LearningMemoryStorage()
        let attempt = SavedAttempt(key: Self.key, record: rec("a", updated: "2026-10-18T15:01:00.000Z"), pageId: "screen:p1", lines: [],
                                   mistakes: [], help: HelpCounts(), active: 0, solvedByStudent: false, tutorFinished: false, given: false)
        for i in 0..<10 { LearningDevice.writeBoardAttempts("u1", boardId: "b\(i)", [attempt], at: Double(i), storage) }
        #expect(LearningDevice.readBoardAttempts("u1", boardId: "b0", storage).isEmpty)
        #expect(LearningDevice.readBoardAttempts("u1", boardId: "b1", storage).isEmpty)
        #expect(LearningDevice.readBoardAttempts("u1", boardId: "b2", storage).count == 1)
        LearningDevice.writeBoardAttempts("u1", boardId: "b9", [], at: 11, storage)
        #expect(LearningDevice.readBoardAttempts("u1", boardId: "b9", storage).isEmpty)
    }

    @Test func filesLiveInApplicationSupport() throws {
        let files = try #require(LearningFileStorage.applicationSupport())
        #expect(files.directory.path.contains("Application Support/Agathon/Learning"))
        files.write("test.json", Data("[]".utf8))
        #expect(files.read("test.json") == Data("[]".utf8))
        files.write("test.json", nil)
        #expect(files.read("test.json") == nil)
    }

    // MARK: - the recorder: offline, killed, relaunched

    @Test func offlineTheRecordsWaitOnTheDeviceAndGoWhenTheNetworkIsBack() async throws {
        let store = FakeLearningStore()
        let storage = LearningMemoryStorage()
        let scheduler = ManualScheduler()
        let clock = Clock()
        try await TestBrain.shared.load()
        let r = recorder(store, storage, scheduler, clock)
        r.handle(line(clock, "ln_head", "2x+3=11", nil))
        r.handle(line(clock, "ln_b", "2x=8", .check))
        await settle(r)
        // written to the device a moment after the change, before any save
        await pass(scheduler, 1_000)
        #expect(LearningDevice.readPending("u1", storage).count == 1)
        store.failures = ["network", "network"]
        await pass(scheduler, 4_000)
        #expect(store.batches.count == 1)
        #expect(store.rows.isEmpty)
        #expect(LearningDevice.readPending("u1", storage).count == 1, "still pending on the device")
        // the next try after the backoff (15 s); the one after that 30 s later
        await pass(scheduler, 15_000)
        #expect(store.batches.count == 2)
        await pass(scheduler, 30_000)
        #expect(store.batches.count == 3)
        #expect(store.rows.count == 1)
        #expect(LearningDevice.readPending("u1", storage).isEmpty, "saved: nothing pending")
    }

    @Test func anAppKilledMidBoardLosesNothing() async throws {
        let store = FakeLearningStore()
        let storage = LearningMemoryStorage()
        let scheduler = ManualScheduler()
        let clock = Clock()
        try await TestBrain.shared.load()
        let first = recorder(store, storage, scheduler, clock)
        first.handle(line(clock, "ln_head", "2x+3=11", nil))
        first.handle(line(clock, "ln_b", "2x=8", .check))
        await settle(first)
        await pass(scheduler, 1_000)
        // killed here: no stop, no save; the device has it
        let id = try #require(LearningDevice.readPending("u1", storage).first?.id)
        // the next launch, another board: what the last visit left is saved first, closed
        let scheduler2 = ManualScheduler()
        let second = recorder(store, storage, scheduler2, clock, board: "6e1d7a2b-3c4d-4e5f-8a61-123456789abc")
        #expect(second.replay.map(\.id) == [id])
        #expect(second.replay.first?.outcome == .unfinished, "a visit that ended without closing it: over now")
        await pass(scheduler2, 5_000)
        #expect(store.rows[id]?.outcome == .unfinished)
        #expect(store.rows[id]?.finishedAt == store.rows[id]?.updatedAt)
        #expect(second.replay.isEmpty)
        second.persist()
        #expect(LearningDevice.readPending("u1", storage).isEmpty)
    }

    @Test func aBoardDeletedSinceIsSavedWithoutItButOnlyForItsOwnStudent() async throws {
        let store = FakeLearningStore()
        let storage = LearningMemoryStorage()
        let clock = Clock()
        LearningDevice.writePending("u1", [rec("left", updated: "2026-10-18T15:01:00.000Z")], storage)
        store.refuseBoard = Self.board
        let scheduler = ManualScheduler()
        let first = recorder(store, storage, scheduler, clock, board: "6e1d7a2b-3c4d-4e5f-8a61-123456789abc")
        await pass(scheduler, 5_000)
        #expect(store.rows["left"]?.boardId == nil, "saved, unlinked from the board the database no longer has")
        // another student signed in on this device: never saved into their account
        let store2 = FakeLearningStore()
        store2.refuseBoard = Self.board
        store2.user = "u2"
        LearningDevice.writePending("u1", [rec("left2", updated: "2026-10-18T15:02:00.000Z")], storage)
        let scheduler2 = ManualScheduler()
        let second = recorder(store2, storage, scheduler2, clock, board: "6e1d7a2b-3c4d-4e5f-8a61-123456789abc")
        await pass(scheduler2, 5_000)
        #expect(store2.rows.isEmpty)
        #expect(store2.batches.count == 1, "tried once with its board, never without")
        withExtendedLifetime((first, second)) {}
    }

    @Test func comingBackToTheBoardGoesOnWithTheSameAttempt() async throws {
        let store = FakeLearningStore()
        let storage = LearningMemoryStorage()
        let scheduler = ManualScheduler()
        let clock = Clock()
        try await TestBrain.shared.load()
        let first = recorder(store, storage, scheduler, clock)
        first.handle(line(clock, "ln_head", "2x+3=11", nil))
        first.handle(line(clock, "ln_b", "2x=8", .check))
        await settle(first)
        first.stop()
        for _ in 0..<30 { await Task.yield() }
        let id = try #require(store.rows.values.first?.id)
        #expect(store.rows[id]?.outcome == .unfinished, "closed with the board, saved")
        let second = recorder(store, storage, ManualScheduler(), clock)
        second.handle(line(clock, "ln_c", "x=4", .check, solved: true))
        await settle(second)
        let records = second.tracker.records()
        #expect(records.map(\.id) == [id], "the same attempt")
        #expect(records.first?.outcome == .firstTry && records.first?.linesWritten == 3)
    }

    @Test func signalsOfAnotherBoardAreNotThisOnes() async throws {
        let store = FakeLearningStore()
        let clock = Clock()
        let r = recorder(store, LearningMemoryStorage(), ManualScheduler(), clock)
        r.handle(line(clock, "ln_b", "2x=8", .check, board: "someone-elses"))
        await settle(r)
        #expect(r.tracker.records().isEmpty)
    }
}
