import AgathonKit
import Combine
import Foundation

/// The count on a Today's practice board: the web's `progressReducer` (src/lib/daily/progress.ts),
/// pure. An attempt counts once, when its outcome first leaves `in_progress` (anything but
/// `unfinished`), when it is one of the set's problems on this board (origin `practice`, or
/// `tutor_problem` after a reload); once per problem by its LaTeX, not per attempt; its star follows
/// its counting attempt's latest outcome; the screen never shows fewer stars than the row was
/// saved with. `base` is what was counted before this visit, `fresh` what was counted since.
public struct DailyProgress: Equatable, Sendable {
    public struct Fresh: Equatable, Sendable {
        public var id: String
        public var star: Bool
    }

    public var goal: Int
    public var base = 0
    public var baseStars = 0
    /// problem keys and attempt ids counted before this visit
    public var known: [String] = []
    /// problems counted on this visit, by problem key, in order
    public var freshKeys: [String] = []
    public var fresh: [String: Fresh] = [:]
    /// the stars the saved row holds (it never goes down)
    public var savedStars = 0
    /// the goal was reached on this visit: the celebration's moment (once)
    public var reachedNow = false

    /// DAILY_ORIGINS
    static let origins: [LearningOrigin] = [.practice, .tutorProblem]
    static let maxCounted = 100

    public init(goal: Int) {
        self.goal = max(1, goal)
    }

    public var done: Int { base + freshKeys.count }

    public var stars: Int {
        let earned = baseStars + freshKeys.filter { fresh[$0]?.star == true }.count
        return min(done, max(savedStars, earned))
    }

    /// `problemKeyOf`: the LaTeX with no spaces.
    public static func problemKey(_ latex: String) -> String {
        let flat = latex.components(separatedBy: .whitespacesAndNewlines).joined()
        return flat.isEmpty ? "" : "p:\(flat)"
    }

    /// `countsForDaily`.
    public static func counts(_ r: LearningRecord, boardId: String) -> Bool {
        r.boardId == boardId && origins.contains(r.origin) && r.outcome != .inProgress && r.outcome != .unfinished
    }

    /// What was counted before this visit: the saved row, this device's note, the board's record.
    public mutating func restore(done: Int, stars: Int, counted: [String] = []) {
        var merged = known
        for k in counted where !merged.contains(k) { merged.append(k) }
        known = Array(merged.suffix(Self.maxCounted))
        // a problem already counted elsewhere is in that number: not again
        freshKeys = freshKeys.filter { key in !known.contains(key) && !known.contains(fresh[key]?.id ?? "") }
        fresh = fresh.filter { freshKeys.contains($0.key) }
        base = max(base, done)
        baseStars = max(baseStars, stars)
    }

    /// An attempt's latest state.
    public mutating func attempt(_ r: LearningRecord, boardId: String) {
        guard Self.counts(r, boardId: boardId) else { return }
        let key = Self.problemKey(r.problemLatex).isEmpty ? r.id : Self.problemKey(r.problemLatex)
        if known.contains(key) || known.contains(r.id) { return }
        let star = r.outcome.isIndependent
        // already counted: only its own attempt's latest outcome moves its star
        if let counted = fresh[key] != nil ? key : freshKeys.first(where: { fresh[$0]?.id == r.id }) {
            if let f = fresh[counted], f.id == r.id, f.star != star { fresh[counted] = Fresh(id: f.id, star: star) }
            return
        }
        let before = done
        freshKeys.append(key)
        fresh[key] = Fresh(id: r.id, star: star)
        if before < goal && done >= goal { reachedNow = true }
    }

    public mutating func saved(stars: Int) {
        savedStars = max(savedStars, stars)
    }

    public mutating func celebrated() {
        reachedNow = false
    }

    /// Every problem key and attempt id counted so far (`countedKeys`).
    public var counted: [String] {
        var out = known
        for key in freshKeys {
            if !out.contains(key) { out.append(key) }
            if let id = fresh[key]?.id, id != key, !out.contains(id) { out.append(id) }
        }
        return Array(out.suffix(Self.maxCounted))
    }
}

/// Where Today's practice reads and writes its day (`daily_practice`, the learning record).
@MainActor
public protocol DailyPracticeStore: AnyObject {
    /// the student's rows from `since` (YYYY-MM-DD) on; nil when they could not be read
    func rows(since: String) async -> [DailyRow]?
    /// one board's attempts (what another device counted); nil when they could not be read
    func boardAttempts(boardId: String) async -> [LearningRepository.BoardAttempt]?
    /// `save_daily_practice`: the row as it now is, nil when the save failed
    func save(day: String, boardId: String?, goal: Int, done: Int, stars: Int) async -> DailyRow?
}

/// The app's: AgathonKit's `LearningRepository`.
@MainActor
public final class RepositoryDailyStore: DailyPracticeStore {
    public let repository: LearningRepository

    public init(repository: LearningRepository) {
        self.repository = repository
    }

    public func rows(since: String) async -> [DailyRow]? {
        try? await repository.dailyPractice(since: since)
    }

    public func boardAttempts(boardId: String) async -> [LearningRepository.BoardAttempt]? {
        try? await repository.boardAttempts(boardId: boardId)
    }

    public func save(day: String, boardId: String?, goal: Int, done: Int, stars: Int) async -> DailyRow? {
        try? await repository.saveDailyPractice(day: day, boardId: boardId, goal: goal, done: done, stars: stars)
    }
}

/// A Today's practice board's count (the web's `useDailyBoard`): starts from this device's note
/// and the saved row (when the row holds more than the note, the learning record says which
/// problems another device counted), goes up with each finished set problem the tracker publishes,
/// and is written back — to the note at once, to the day's row (`save_daily_practice`) a moment
/// later and when the board closes or the app goes away. Reaching the goal on this visit is the
/// celebration's moment (`reachedNow`, then `celebrated()`).
@MainActor
public final class DailyPractice: ObservableObject {
    public let boardId: String
    /// the student's local date, YYYY-MM-DD
    public let day: String
    public let goal: Int
    @Published public private(set) var progress: DailyProgress
    /// the day's row has been read (nothing is saved before, so a save never races the read)
    @Published public private(set) var rowRead = false

    public var done: Int { progress.done }
    public var stars: Int { progress.stars }
    public var reachedNow: Bool { progress.reachedNow }

    private let scheduler: LiveScheduler
    private var store: DailyPracticeStore?
    private var storage: LearningDeviceStorage?
    private var saved = (done: 0, stars: 0)
    private var pendingSave: LiveTimer?
    private var saving = false

    /// SAVE_DEBOUNCE_MS: a burst of attempts is one save
    public static let saveDebounceMs = 1_200.0

    init(boardId: String, day: String, goal: Int, scheduler: LiveScheduler) {
        self.boardId = boardId
        self.day = day
        self.goal = max(1, goal)
        self.scheduler = scheduler
        progress = DailyProgress(goal: goal)
    }

    /// The device's note for this board (`agathon.dailyProgress.<boardId>`).
    struct Note: Codable {
        var boardId: String
        var day: String
        var done: Int
        var stars: Int
        var counted: [String]
    }

    static func noteName(_ boardId: String) -> String { "daily.\(LearningDevice.safe(boardId)).json" }

    /// Reads the note and the row, and counts from them.
    public func connect(_ store: DailyPracticeStore, storage: LearningDeviceStorage?) {
        guard self.store == nil else { return }
        self.store = store
        self.storage = storage
        if let data = storage?.read(Self.noteName(boardId)), let note = try? JSONDecoder().decode(Note.self, from: data),
           note.boardId == boardId, note.day == day {
            progress.restore(done: note.done, stars: note.stars, counted: note.counted)
        }
        let noteDone = progress.base
        Task { @MainActor in
            let rows = await store.rows(since: self.day)
            if let row = rows?.first(where: { $0.day == self.day }), row.boardId == nil || row.boardId == self.boardId {
                self.saved = (row.done, row.stars)
                self.progress.restore(done: row.done, stars: row.stars)
                // counted where this device's note did not see it: which problems, from the learning
                // record, before anything is saved (a problem answered again here is not one more)
                if row.done > noteDone, let attempts = await store.boardAttempts(boardId: self.boardId) {
                    var problems: [String] = []
                    var counted: [String] = []
                    for a in attempts {
                        guard let origin = LearningOrigin(rawValue: a.origin), let outcome = LearningOutcome(rawValue: a.outcome),
                              DailyProgress.origins.contains(origin), outcome != .inProgress, outcome != .unfinished else { continue }
                        let key = DailyProgress.problemKey(a.problemLatex).isEmpty ? a.id : DailyProgress.problemKey(a.problemLatex)
                        if !problems.contains(key) { problems.append(key) }
                        for k in [key, a.id] where !counted.contains(k) { counted.append(k) }
                    }
                    self.progress.restore(done: problems.count, stars: 0, counted: counted)
                }
            }
            self.rowRead = rows != nil
            self.changed()
        }
    }

    /// An attempt's latest state, from the board's tracker.
    func attempt(_ record: LearningRecord) {
        let before = (progress.done, progress.stars, progress.reachedNow)
        progress.attempt(record, boardId: boardId)
        if before != (progress.done, progress.stars, progress.reachedNow) { changed() }
    }

    /// The celebration has been shown.
    public func celebrated() {
        progress.celebrated()
    }

    private func changed() {
        if let storage, let data = try? JSONEncoder().encode(Note(boardId: boardId, day: day, done: done, stars: stars, counted: progress.counted)) {
            storage.write(Self.noteName(boardId), data)
        }
        guard rowRead, done > saved.done || stars > saved.stars else { return }
        pendingSave?.cancel()
        pendingSave = scheduler.after(Self.saveDebounceMs) { [weak self] in self?.save() }
    }

    /// Saves what is waiting now (the board closing, the app going away).
    public func flush() {
        if pendingSave != nil { save() }
    }

    private func save() {
        pendingSave?.cancel()
        pendingSave = nil
        guard let store, !saving else { return }
        let d = done, s = stars
        let before = saved
        if d <= before.done && s <= before.stars { return }
        saved = (max(d, before.done), max(s, before.stars))
        saving = true
        Task { @MainActor in
            // the web's limits: a goal of 1–20, at most 100 done or starred, a board id or none
            let board = self.boardId.range(of: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", options: .regularExpression) != nil ? self.boardId : nil
            let row = await store.save(day: self.day, boardId: board, goal: min(20, max(1, self.goal)),
                                       done: min(100, max(0, d)), stars: min(100, max(0, s)))
            self.saving = false
            guard let row else {
                // not saved: the next change (or visit) sends the higher numbers again
                self.saved = before
                return
            }
            // the row's stars never go down: neither do the ones on screen
            self.progress.saved(stars: row.stars)
            if self.done > self.saved.done || self.stars > self.saved.stars { self.changed() }
        }
    }
}
