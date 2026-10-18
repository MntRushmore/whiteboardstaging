import Foundation

/// One problem the student worked on: a row of `learning_attempts` (src/lib/learning/contracts.ts
/// `AttemptRecord`). Decoded from PostgREST's snake_case row; encoded in the web's camelCase shape,
/// which is what the brain's `progressSummary` reads.
public struct AttemptRecord: Sendable, Equatable, Codable, Identifiable {
    public let id: String
    public let boardId: String?
    public let problemLatex: String
    public let skill: String
    public let course: String?
    public let origin: String
    public let parentId: String?
    /// in_progress, first_try, self_corrected, with_help, tutor_solved, unfinished
    public let outcome: String
    public let linesWritten: Int
    public let linesRight: Int
    public let linesRinged: Int
    public let hints: Int
    public let tutorSteps: Int
    public let solves: Int
    public let asks: Int
    public let mistakes: [String: Int]
    public let activeMs: Int
    /// ISO timestamps, as the database wrote them.
    public let startedAt: String
    public let updatedAt: String
    public let finishedAt: String?

    /// The columns a read selects (the web's READ_COLUMNS).
    public static let columns = "id,board_id,problem_latex,skill,course,origin,parent_id,outcome,lines_written,lines_right,lines_ringed,hints,tutor_steps,solves,asks,mistakes,active_ms,started_at,updated_at,finished_at"

    public init(id: String, boardId: String? = nil, problemLatex: String, skill: String, course: String? = nil,
                origin: String = "board", parentId: String? = nil, outcome: String, linesWritten: Int = 0,
                linesRight: Int = 0, linesRinged: Int = 0, hints: Int = 0, tutorSteps: Int = 0, solves: Int = 0,
                asks: Int = 0, mistakes: [String: Int] = [:], activeMs: Int = 0, startedAt: String,
                updatedAt: String? = nil, finishedAt: String? = nil) {
        self.id = id
        self.boardId = boardId
        self.problemLatex = problemLatex
        self.skill = skill
        self.course = course
        self.origin = origin
        self.parentId = parentId
        self.outcome = outcome
        self.linesWritten = linesWritten
        self.linesRight = linesRight
        self.linesRinged = linesRinged
        self.hints = hints
        self.tutorSteps = tutorSteps
        self.solves = solves
        self.asks = asks
        self.mistakes = mistakes
        self.activeMs = activeMs
        self.startedAt = startedAt
        self.updatedAt = updatedAt ?? startedAt
        self.finishedAt = finishedAt
    }

    /// The student solved it themselves (mastery's evidence).
    public var isIndependent: Bool { outcome == "first_try" || outcome == "self_corrected" }

    enum RowKeys: String, CodingKey {
        case id, skill, course, origin, outcome, hints, solves, asks, mistakes
        case boardId = "board_id", problemLatex = "problem_latex", parentId = "parent_id"
        case linesWritten = "lines_written", linesRight = "lines_right", linesRinged = "lines_ringed"
        case tutorSteps = "tutor_steps", activeMs = "active_ms", startedAt = "started_at"
        case updatedAt = "updated_at", finishedAt = "finished_at"
    }

    enum Keys: String, CodingKey {
        case id, boardId, problemLatex, skill, course, origin, parentId, outcome, linesWritten, linesRight
        case linesRinged, hints, tutorSteps, solves, asks, mistakes, activeMs, startedAt, updatedAt, finishedAt
    }

    /// A PostgREST row (snake_case). A row without an id or a start is an error; anything else
    /// missing or odd falls back the way the web's `fromRow` does.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: RowKeys.self)
        func int(_ key: RowKeys) -> Int { max(0, (try? c.decodeIfPresent(FlexibleNumber.self, forKey: key)).flatMap { $0 }.map { Int($0.value) } ?? 0) }
        func text(_ key: RowKeys) -> String? {
            guard let value = try? c.decodeIfPresent(String.self, forKey: key), !value.isEmpty else { return nil }
            return value
        }
        id = try c.decode(String.self, forKey: .id)
        guard let started = text(.startedAt) else {
            throw DecodingError.dataCorruptedError(forKey: .startedAt, in: c, debugDescription: "no start")
        }
        boardId = text(.boardId)
        problemLatex = text(.problemLatex) ?? ""
        skill = text(.skill) ?? "other"
        course = text(.course)
        origin = text(.origin) ?? "board"
        parentId = text(.parentId)
        outcome = text(.outcome) ?? "unfinished"
        linesWritten = int(.linesWritten)
        linesRight = int(.linesRight)
        linesRinged = int(.linesRinged)
        hints = int(.hints)
        tutorSteps = int(.tutorSteps)
        solves = int(.solves)
        asks = int(.asks)
        mistakes = (try? c.decodeIfPresent([String: Int].self, forKey: .mistakes)).flatMap { $0 } ?? [:]
        activeMs = int(.activeMs)
        startedAt = started
        updatedAt = text(.updatedAt) ?? started
        finishedAt = text(.finishedAt)
    }

    /// The web's camelCase shape (what `summarize` reads).
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        try c.encode(id, forKey: .id)
        try c.encode(boardId, forKey: .boardId)
        try c.encode(problemLatex, forKey: .problemLatex)
        try c.encode(skill, forKey: .skill)
        try c.encode(course, forKey: .course)
        try c.encode(origin, forKey: .origin)
        try c.encode(parentId, forKey: .parentId)
        try c.encode(outcome, forKey: .outcome)
        try c.encode(linesWritten, forKey: .linesWritten)
        try c.encode(linesRight, forKey: .linesRight)
        try c.encode(linesRinged, forKey: .linesRinged)
        try c.encode(hints, forKey: .hints)
        try c.encode(tutorSteps, forKey: .tutorSteps)
        try c.encode(solves, forKey: .solves)
        try c.encode(asks, forKey: .asks)
        try c.encode(mistakes, forKey: .mistakes)
        try c.encode(activeMs, forKey: .activeMs)
        try c.encode(startedAt, forKey: .startedAt)
        try c.encode(updatedAt, forKey: .updatedAt)
        try c.encode(finishedAt, forKey: .finishedAt)
    }
}

/// A day of Today's practice: a row of `daily_practice` (src/lib/daily/contracts.ts `DailyRow`).
public struct DailyRow: Sendable, Equatable, Decodable {
    /// The student's local date, YYYY-MM-DD.
    public let day: String
    public let boardId: String?
    public let goal: Int
    public let done: Int
    public let stars: Int
    public let completedAt: Date?

    public static let columns = "day,board_id,goal,done,stars,completed_at"
    /// DAILY_GOAL: five problems a day.
    public static let defaultGoal = 5

    public init(day: String, boardId: String? = nil, goal: Int = DailyRow.defaultGoal, done: Int = 0, stars: Int = 0,
                completedAt: Date? = nil) {
        self.day = day
        self.boardId = boardId
        self.goal = goal
        self.done = done
        self.stars = stars
        self.completedAt = completedAt
    }

    enum CodingKeys: String, CodingKey {
        case day, goal, done, stars
        case boardId = "board_id"
        case completedAt = "completed_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        day = try c.decode(String.self, forKey: .day)
        boardId = (try? c.decodeIfPresent(String.self, forKey: .boardId)).flatMap { $0 }
        goal = (try? c.decodeIfPresent(FlexibleNumber.self, forKey: .goal)).flatMap { $0 }.map { Int($0.value) } ?? Self.defaultGoal
        done = (try? c.decodeIfPresent(FlexibleNumber.self, forKey: .done)).flatMap { $0 }.map { Int($0.value) } ?? 0
        stars = (try? c.decodeIfPresent(FlexibleNumber.self, forKey: .stars)).flatMap { $0 }.map { Int($0.value) } ?? 0
        completedAt = (try? c.decodeIfPresent(String.self, forKey: .completedAt)).flatMap { $0 }.flatMap(PostgresDate.parse)
    }

    /// The set was finished: stamped complete, or as many done as the goal (`isDayDone`).
    public var isDone: Bool { completedAt != nil || (goal > 0 && done >= goal) }
    /// A board was made for it, or a problem finished on it.
    public var isStarted: Bool { done > 0 || boardId != nil }
}

/// Calendar days as the web writes them (YYYY-MM-DD, the student's local date). Arithmetic on the
/// date, never on clock time, so a daylight-saving change never moves a day.
public enum LocalDay {
    private static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()

    /// The local date of `date` in `timeZone`.
    public static func of(_ date: Date, in timeZone: TimeZone = .current) -> String {
        var local = Calendar(identifier: .gregorian)
        local.timeZone = timeZone
        let parts = local.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 1970, parts.month ?? 1, parts.day ?? 1)
    }

    static func date(_ day: String) -> Date? {
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        let components = DateComponents(year: parts[0], month: parts[1], day: parts[2])
        guard let date = calendar.date(from: components) else { return nil }
        // 2026-02-31 is not a day: the round trip tells.
        return of(date, in: calendar.timeZone) == day ? date : nil
    }

    public static func isDay(_ day: String) -> Bool { date(day) != nil }

    /// The day `n` days after `day` (before, for a negative `n`).
    public static func adding(_ n: Int, to day: String) -> String {
        guard let date = date(day), let moved = calendar.date(byAdding: .day, value: n, to: date) else { return day }
        return of(moved, in: calendar.timeZone)
    }

    /// The Monday of `day`'s week (the week strip starts there).
    public static func monday(of day: String) -> String {
        guard let date = date(day) else { return day }
        let weekday = calendar.component(.weekday, from: date) // Sunday 1 … Saturday 7
        return adding(-((weekday + 5) % 7), to: day)
    }

    /// "Monday" … "Sunday".
    public static func weekdayName(_ day: String) -> String {
        guard let date = date(day) else { return "" }
        let names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
        return names[calendar.component(.weekday, from: date) - 1]
    }
}

/// The Today's practice streak (src/lib/daily/streak.ts `dailyStreak`): how many days in a row the
/// set was finished, the best run, and this week's days.
public struct DailyStreak: Sendable, Equatable {
    public enum DayState: String, Sendable { case before, future, done, started, today, missed }

    public let current: Int
    public let best: Int
    public let todayDone: Bool
    /// Monday first.
    public let week: [(day: String, state: DayState)]

    public static func == (a: DailyStreak, b: DailyStreak) -> Bool {
        a.current == b.current && a.best == b.best && a.todayDone == b.todayDone
            && a.week.map(\.day) == b.week.map(\.day) && a.week.map(\.state) == b.week.map(\.state)
    }

    /// `today` is the student's local date. Today not done YET keeps yesterday's streak alive.
    public static func compute(_ rows: [DailyRow], today: String) -> DailyStreak {
        var days: [String: DailyRow] = [:]
        for row in rows where LocalDay.isDay(row.day) {
            if let seen = days[row.day], !((row.isDone && !seen.isDone) || row.done > seen.done) { continue }
            days[row.day] = row
        }
        func doneOn(_ day: String) -> Bool { days[day]?.isDone ?? false }
        let todayDone = doneOn(today)

        var current = 0
        var day = todayDone ? today : LocalDay.adding(-1, to: today)
        while doneOn(day) {
            current += 1
            day = LocalDay.adding(-1, to: day)
        }

        var best = 0
        var run = 0
        var previous: String?
        for doneDay in days.keys.filter({ $0 <= today && doneOn($0) }).sorted() {
            run = previous.map { LocalDay.adding(1, to: $0) == doneDay } == true ? run + 1 : 1
            best = max(best, run)
            previous = doneDay
        }
        best = max(best, current)

        let first = days.keys.filter { $0 <= today }.sorted().first ?? today
        let monday = LocalDay.monday(of: today)
        let week: [(day: String, state: DayState)] = (0 ..< 7).map { i in
            let day = LocalDay.adding(i, to: monday)
            let row = days[day]
            if day < first && row == nil { return (day, .before) }
            if day > today { return (day, .future) }
            if row?.isDone == true { return (day, .done) }
            if row?.isStarted == true { return (day, .started) }
            return (day, day == today ? .today : .missed)
        }
        return DailyStreak(current: current, best: best, todayDone: todayDone, week: week)
    }
}
