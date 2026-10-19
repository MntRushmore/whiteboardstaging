import AgathonKit
import Foundation

/// Where the board's attempts are saved: `learning_attempts`, as the signed-in student under RLS
/// (`RepositoryAttemptStore`, AgathonKit's `LearningRepository.saveAttempts`); a fake in tests.
@MainActor
public protocol LearningAttemptStore: AnyObject {
    /// Upserts by id; throws an error with a store code (`LearningStoreError`).
    func save(_ records: [LearningRecord]) async throws
    /// Who is signed in now (lower case), nil when no one: a record is only ever saved for its own student.
    func sessionUserId() async -> String?
}

extension LearningStoreError: LearningStoreErrorConvertible {
    public var learningStoreCode: String { code.rawValue }
}

/// The app's store: AgathonKit's `LearningRepository` on the backend's Supabase client.
@MainActor
public final class RepositoryAttemptStore: LearningAttemptStore {
    public let repository: LearningRepository

    public init(repository: LearningRepository) {
        self.repository = repository
    }

    public func save(_ records: [LearningRecord]) async throws {
        try await repository.saveAttempts(records.map(\.kitRecord))
    }

    public func sessionUserId() async -> String? {
        await repository.signedInUserId()
    }
}

extension LearningRecord {
    /// The record as AgathonKit's row model (what `saveAttempts` cleans and writes).
    public var kitRecord: AttemptRecord {
        AttemptRecord(id: id, boardId: boardId, problemLatex: problemLatex, skill: skill, course: course, origin: origin.rawValue,
                      parentId: parentId, outcome: outcome.rawValue, linesWritten: linesWritten, linesRight: linesRight,
                      linesRinged: linesRinged, hints: hints, tutorSteps: tutorSteps, solves: solves, asks: asks, mistakes: mistakes,
                      activeMs: activeMs, startedAt: startedAt, updatedAt: updatedAt, finishedAt: finishedAt)
    }

    /// This record unlinked from its board (a board deleted since: the database unlinks too).
    func withoutBoard() -> LearningRecord {
        var r = self
        r.boardId = nil
        return r
    }

    /// A record left on the device by a visit that ended without closing it: it is over now (`closedPending`).
    func closedPending() -> LearningRecord {
        guard outcome == .inProgress else { return self }
        var r = self
        r.outcome = .unfinished
        r.finishedAt = r.finishedAt ?? r.updatedAt
        return r
    }
}
