import AgathonKit
import Foundation
@testable import AgathonLive

/// `learning_attempts` in memory: upserts by id, as the database does; failures on demand.
@MainActor
final class FakeLearningStore: LearningAttemptStore {
    struct Failure: Error, LearningStoreErrorConvertible {
        var learningStoreCode: String
    }

    /// every batch the store was asked to save, in order
    private(set) var batches: [[LearningRecord]] = []
    /// the rows as they stand (each attempt's latest)
    private(set) var rows: [String: LearningRecord] = [:]
    /// the next saves fail with these codes, in order
    var failures: [String] = []
    /// a save fails with this code when its batch holds a record of this board (RLS: not the student's)
    var refuseBoard: String?
    var user: String? = "u1"

    func save(_ records: [LearningRecord]) async throws {
        batches.append(records)
        if !failures.isEmpty { throw Failure(learningStoreCode: failures.removeFirst()) }
        if let refuseBoard, records.contains(where: { $0.boardId == refuseBoard }) { throw Failure(learningStoreCode: "unauthorized") }
        for r in records { rows[r.id] = r }
    }

    func sessionUserId() async -> String? { user }
}

/// `daily_practice` in memory, with the RPC's rules: counts only go up.
@MainActor
final class FakeDailyStore: DailyPracticeStore {
    var row: DailyRow?
    var attemptsOnBoard: [LearningRepository.BoardAttempt] = []
    private(set) var saves: [(done: Int, stars: Int)] = []
    var failSaves = false

    func rows(since: String) async -> [DailyRow]? { row.map { [$0] } ?? [] }

    func boardAttempts(boardId: String) async -> [LearningRepository.BoardAttempt]? { attemptsOnBoard }

    func save(day: String, boardId: String?, goal: Int, done: Int, stars: Int) async -> DailyRow? {
        saves.append((done, stars))
        if failSaves { return nil }
        let next = DailyRow(day: day, boardId: boardId, goal: goal, done: max(done, row?.done ?? 0), stars: max(stars, row?.stars ?? 0),
                            completedAt: done >= goal ? Date() : nil)
        row = next
        return next
    }
}

extension LiveLearning {
    /// Waits until every signal said so far has reached the tracker and its classifications landed.
    func settled() async {
        for _ in 0..<3 {
            await recorder?.drained()
            await recorder?.tracker.settled()
            for _ in 0..<5 { await Task.yield() }
        }
    }
}

enum LearningClock {
    /// 2026-10-18T15:00:00.000Z
    static let t0 = 1_792_335_600_000.0
}
