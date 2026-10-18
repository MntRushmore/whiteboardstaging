import AgathonDesign
import AgathonKit
import Observation
import UIKit

/// What Home shows: the signed-in profile's boards (thumbnails, names, when they were edited), the
/// tutor's ink, who is signed in and their family. Read as the user under RLS, the way the web's
/// home does (src/app/(platform)/page.tsx). One model per profile: RootView makes Home again after
/// a family switch, so nothing read as the last profile carries over.
@MainActor
@Observable
final class HomeModel {
    /// A short message over the screen after an action (a board that couldn't be made…).
    struct Toast: Equatable, Identifiable {
        let id = UUID()
        let kind: Banner.Kind
        let title: String
        let message: String?
    }

    private(set) var boards: [BoardSummary] = []
    private(set) var loaded = false
    private(set) var listError: String?
    private(set) var ink: InkSummary?
    private(set) var family: FamilyState?
    private(set) var profile: Profile?
    private(set) var creating = false
    var toast: Toast?

    // Today's practice and the path
    private(set) var summary: LearningSummary?
    private(set) var daily: [DailyRow] = []
    private(set) var learningLoaded = false
    private(set) var startingPractice = false

    @ObservationIgnored private var thumbnails: [String: UIImage] = [:]

    // MARK: who is signed in

    /// A kid profile in a family: no billing, no grown-up areas without the PIN.
    var isKid: Bool { family?.role == .kid }

    /// The name on the profile chip.
    func displayName(email: String?) -> String {
        // A solo account is the student's own (the family's "Grown-up" label is only a default).
        if family?.role != .solo, let name = family?.meMember?.displayName.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
            return name
        }
        if let name = profile?.displayName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty { return name }
        if let email, let local = email.split(separator: "@").first, !local.isEmpty { return String(local) }
        return "You"
    }

    /// "Hi Maya." uses the first name; nil when there's none worth using ("Hi there.").
    func greetingName(email: String?) -> String? {
        if let me = family?.meMember, family?.role != .solo {
            return HomeFormat.greetingName(me.isParent ? profile?.displayName ?? me.displayName : me.displayName)
        }
        return HomeFormat.greetingName(profile?.displayName)
    }

    var avatarColor: RGB {
        guard family?.role != .solo, let me = family?.meMember else { return DS.Palette.tomato }
        return AvatarColor.color(for: me, in: family)
    }

    // MARK: learning

    /// The grade the path follows: the profile's, else the family's word for this kid.
    var grade: Int? { profile?.grade ?? family?.meMember?.grade }

    /// A grown-up with kids practises through the kids' profiles: no Today card for them.
    var showsPractice: Bool { family?.role != .parent }

    var path: PathView? { grade.flatMap { GradePath.paths[$0] == nil ? nil : PathView(grade: $0, summary: summary) } }

    var today: String { LocalDay.of(Date()) }

    var todayRow: DailyRow? { daily.first { $0.day == today } }

    var streak: DailyStreak { DailyStreak.compute(daily, today: today) }

    /// Today's practice rows (60 days, for the streak) and the learning summary (the path's levels).
    func loadLearning(_ backend: AgathonBackend) async {
        let learning = LearningRepository(client: backend.supabase)
        let since = LocalDay.adding(-60, to: today)
        async let rows = attempt { try await learning.dailyPractice(since: since) }
        if case let .success(list) = await rows { daily = list }
        if let made = try? await LearningLoader.summary(backend: backend, grade: grade, course: profile?.course) {
            summary = made
        }
        learningLoaded = true
    }

    /// Today's practice: today's board when there is one, else a new board for it (titled as the
    /// web titles it) with the day recorded. The problems ride along for the board to show.
    func startPractice(_ backend: AgathonBackend) async -> OpenBoard? {
        guard !startingPractice else { return nil }
        startingPractice = true
        defer { startingPractice = false }
        let day = today
        let problems = await PracticePlanner.daily(day: day, userId: backend.auth.userId ?? "", path: path, summary: summary)
        let set = PracticeSet(kind: .daily(day: day), title: "Today's practice", problems: problems)
        if let id = todayRow?.boardId, let board = boards.first(where: { $0.id == id }) {
            return OpenBoard(board: board, practice: set)
        }
        do {
            let board = try await backend.boards.create(title: "Today's practice · \(LocalDay.weekdayName(day))")
            boards.insert(board, at: 0)
            let learning = LearningRepository(client: backend.supabase)
            if let row = try? await learning.saveDailyPractice(day: day, boardId: board.id, goal: DailyRow.defaultGoal) {
                daily.removeAll { $0.day == day }
                daily.insert(row, at: 0)
            }
            return OpenBoard(board: board, practice: set)
        } catch {
            toast = Toast(kind: .lookAgain, title: "Today's practice didn't open.", message: "Try again in a moment.")
            await backend.errors.reportUserError(kind: "live.daily", code: "start_failed", message: "Today's practice didn't open",
                                                 path: "/", error: error)
            return nil
        }
    }

    /// A topic's problems on a new board named for it.
    func startTopic(_ skill: String, backend: AgathonBackend) async -> OpenBoard? {
        let name = GradePath.name(skill, summary: summary)
        do {
            let board = try await backend.boards.create(title: name)
            boards.insert(board, at: 0)
            let problems = await PracticePlanner.topic(skill, seed: PracticePlanner.seed("\(board.id)|\(skill)"))
            return OpenBoard(board: board, practice: PracticeSet(kind: .topic(skill: skill), title: name, problems: problems))
        } catch {
            toast = Toast(kind: .lookAgain, title: "That topic didn't open.", message: "Try again in a moment.")
            await backend.errors.reportUserError(kind: "live.topics", code: "start_failed", message: "That topic didn't open",
                                                 path: "/", error: error)
            return nil
        }
    }

    // MARK: boards

    /// Search shows once there are this many boards.
    nonisolated static let searchThreshold = 9

    /// The boards whose name has every word of `query` in it (any case, any accents).
    nonisolated static func filter(_ boards: [BoardSummary], query: String) -> [BoardSummary] {
        let words = query.split(whereSeparator: \.isWhitespace).map(String.init)
        guard !words.isEmpty else { return boards }
        return boards.filter { board in
            words.allSatisfy { board.title.range(of: $0, options: [.caseInsensitive, .diacriticInsensitive]) != nil }
        }
    }

    /// The board's thumbnail, decoded once.
    func thumbnail(for board: BoardSummary) -> UIImage? {
        let key = "\(board.id)|\(board.preview?.count ?? 0)|\(board.updatedAt?.timeIntervalSince1970 ?? 0)"
        if let hit = thumbnails[key] { return hit }
        guard let data = board.previewImage?.data, let image = UIImage(data: data) else { return nil }
        thumbnails[key] = image
        return image
    }

    // MARK: loading

    func load(_ backend: AgathonBackend) async {
        let boardsRepository = backend.boards
        let profiles = backend.profiles
        let familyService = backend.family
        async let boardsResult = attempt { try await boardsRepository.list() }
        async let inkResult = attempt { try await profiles.inkSummary() }
        async let familyResult = attempt { try await familyService.load() }
        async let profileResult = attempt { try await profiles.profile() }

        switch await boardsResult {
        case let .success(list):
            boards = list
            listError = nil
        case let .failure(error):
            if error is CancellationError { break }
            // Boards already on screen stay; a first load shows the error.
            if boards.isEmpty { listError = userMessage(for: error) }
            await backend.errors.reportUserError(kind: "live.boards", code: "load_failed", message: "Couldn't load your boards",
                                                 path: "/", error: error)
        }
        loaded = true
        if case let .success(summary) = await inkResult { ink = summary }
        if case let .success(state) = await familyResult { family = state }
        if case let .success(row) = await profileResult { profile = row }
        if showsPractice { await loadLearning(backend) }
    }

    /// Makes a new board and returns it (Home then opens it), or nil with a toast.
    func create(_ backend: AgathonBackend) async -> BoardSummary? {
        guard !creating else { return nil }
        creating = true
        defer { creating = false }
        do {
            let board = try await backend.boards.create()
            boards.insert(board, at: 0)
            return board
        } catch {
            toast = Toast(kind: .lookAgain, title: "Couldn't make a board.", message: "Try again in a moment.")
            await backend.errors.reportUserError(kind: "live.boards", code: "create_failed", message: "Couldn't create a board",
                                                 path: "/", error: error)
            return nil
        }
    }

    /// Renames a board. Returns what to say when it didn't work (nil: done).
    func rename(_ board: BoardSummary, to title: String, backend: AgathonBackend) async -> String? {
        do {
            let saved = try await backend.boards.rename(id: board.id, to: title)
            if let index = boards.firstIndex(where: { $0.id == board.id }) { boards[index] = saved }
            return nil
        } catch let error as BoardsRepository.TitleError {
            return error.errorDescription
        } catch {
            await backend.errors.reportUserError(kind: "live.boards", code: "rename_failed", message: "Couldn't rename this board",
                                                 path: "/", error: error)
            return "The new name wasn't saved. Try again in a moment."
        }
    }

    /// Deletes a board and its pictures. Returns what to say when it didn't work (nil: done).
    func delete(_ board: BoardSummary, backend: AgathonBackend) async -> String? {
        do {
            let result = try await backend.boards.delete(id: board.id)
            boards.removeAll { $0.id == board.id }
            if !result.assetErrors.isEmpty {
                await backend.errors.reportUserError(kind: "live.boards", code: "delete_images_left",
                                                     message: "Board deleted, but some images could not be removed", level: .warn, path: "/")
            }
            toast = Toast(kind: .success, title: "Board deleted.", message: nil)
            return nil
        } catch {
            await backend.errors.reportUserError(kind: "live.boards", code: "delete_failed", message: "Couldn't delete this board",
                                                 path: "/", error: error)
            return "The board is still here. Try again in a moment."
        }
    }

    #if DEBUG
    func setForTesting(family: FamilyState?, profile: Profile? = nil) {
        self.family = family
        self.profile = profile
    }
    #endif

    /// The row as it is now, after the board screen closed (its name or thumbnail may have changed).
    func refreshQuietly(_ backend: AgathonBackend) async {
        if let list = try? await backend.boards.list() { boards = list }
    }
}
