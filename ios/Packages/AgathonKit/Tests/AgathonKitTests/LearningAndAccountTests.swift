import Foundation
import Supabase
import Testing
@testable import AgathonKit

/// The screens lane's AgathonKit pieces: the learning record's rows, Today's practice streak, the
/// family's kids routes, the account's plan rule, the weekly report and bug reports' shapes.
struct AttemptRecordTests {
    @Test func aRowReadsAndEncodesTheWebsShape() throws {
        let row = """
        [{"id":"a1","board_id":"b1","problem_latex":"\\\\frac{3}{4}+\\\\frac{1}{8}","skill":"add_fractions_unlike","course":null,
          "origin":"board","parent_id":null,"outcome":"first_try","lines_written":3,"lines_right":"3","lines_ringed":0,"hints":0,
          "tutor_steps":0,"solves":0,"asks":1,"mistakes":{"sign":2},"active_ms":91000,"started_at":"2026-10-17T09:00:00+00:00",
          "updated_at":"2026-10-17T09:02:00+00:00","finished_at":"2026-10-17T09:02:00+00:00"}]
        """
        let records = try JSONDecoder().decode([AttemptRecord].self, from: Data(row.utf8))
        let record = try #require(records.first)
        #expect(record.boardId == "b1")
        #expect(record.linesRight == 3, "a count PostgREST wrote as a string")
        #expect(record.mistakes == ["sign": 2])
        #expect(record.isIndependent)
        let encoded = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(record)) as? [String: Any])
        #expect(encoded["problemLatex"] as? String == "\\frac{3}{4}+\\frac{1}{8}")
        #expect(encoded["startedAt"] as? String == "2026-10-17T09:00:00+00:00")
        #expect(encoded["linesWritten"] as? Int == 3)
        #expect(encoded["course"] is NSNull)
        #expect(encoded["started_at"] == nil)
    }

    @Test func badRowsAreSkippedNotFatal() {
        let page = #"[{"id":"a1","outcome":"with_help","started_at":"2026-10-17T09:00:00Z"},{"id":"a2"},{"nope":1}]"#
        let decoded = LearningRepository.decodeRows(Data(page.utf8))
        #expect(decoded.count == 3)
        #expect(decoded.records.map(\.id) == ["a1"])
        #expect(decoded.records.first?.skill == "other")
    }
}

struct DailyStreakTests {
    func row(_ day: String, done: Int = 5, goal: Int = 5) -> DailyRow { DailyRow(day: day, goal: goal, done: done) }

    @Test func daysAsTheWebCountsThem() {
        #expect(LocalDay.adding(1, to: "2026-02-28") == "2026-03-01")
        #expect(LocalDay.adding(-1, to: "2026-03-01") == "2026-02-28")
        #expect(LocalDay.monday(of: "2026-10-17") == "2026-10-12", "a Saturday's Monday")
        #expect(LocalDay.monday(of: "2026-10-18") == "2026-10-12", "a Sunday is the week's 7th day")
        #expect(LocalDay.monday(of: "2026-10-12") == "2026-10-12")
        #expect(!LocalDay.isDay("2026-02-31"))
        #expect(LocalDay.weekdayName("2026-10-17") == "Saturday")
        let utc = TimeZone(identifier: "UTC")!
        #expect(LocalDay.of(Date(timeIntervalSince1970: 1_792_300_000), in: utc) == "2026-10-18")
    }

    @Test func todayNotDoneYetKeepsTheStreak() {
        let rows = [row("2026-10-14"), row("2026-10-15"), row("2026-10-16"), row("2026-10-17", done: 2)]
        let streak = DailyStreak.compute(rows, today: "2026-10-17")
        #expect(streak.current == 3)
        #expect(!streak.todayDone)
        #expect(streak.week.map(\.state) == [.before, .before, .done, .done, .done, .started, .future])
    }

    @Test func aMissedDayBreaksItAndBestRemembers() {
        let rows = [row("2026-10-05"), row("2026-10-06"), row("2026-10-07"), row("2026-10-08"), row("2026-10-12"), row("2026-10-13")]
        let streak = DailyStreak.compute(rows, today: "2026-10-15")
        #expect(streak.current == 0)
        #expect(streak.best == 4)
        #expect(streak.week.map(\.state) == [.done, .done, .missed, .today, .future, .future, .future])
    }

    @Test func doneToday() {
        let streak = DailyStreak.compute([row("2026-10-16"), DailyRow(day: "2026-10-17", goal: 5, done: 3, completedAt: Date())], today: "2026-10-17")
        #expect(streak.current == 2)
        #expect(streak.todayDone)
    }
}

struct FamilyKidsTests {
    private func service(_ transport: FakeTransport) -> FamilyService {
        FamilyService(api: Fixtures.client(transport)) { _ in }
    }

    @Test func addingAKidSendsTheStrictBody() async throws {
        let member = #"{"userId":"k1","displayName":"Maya","avatar":"fox","grade":3,"isParent":false}"#
        let transport = FakeTransport(replies: [.json(201, member)])
        let added = try await service(transport).addKid(name: "  Maya ", grade: 3, avatar: "fox")
        #expect(added.userId == "k1")
        let request = try #require(transport.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.path == "/api/family/kids")
        let body = try #require(try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any])
        #expect(body["displayName"] as? String == "Maya")
        #expect(body["grade"] as? Int == 3)
        #expect(body.count == 3)
    }

    @Test func highSchoolIsANullGrade() async throws {
        let transport = FakeTransport(replies: [.json(200, #"{"updated":true}"#)])
        try await service(transport).updateKid(id: "k1", name: "Sam", grade: nil, avatar: "owl")
        let request = try #require(transport.requests.first)
        #expect(request.httpMethod == "PATCH")
        #expect(request.url?.path == "/api/family/kids/k1")
        let body = try #require(try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any])
        #expect(body["grade"] is NSNull)
    }

    @Test func removing() async throws {
        let transport = FakeTransport(replies: [.json(200, #"{"removed":true}"#)])
        try await service(transport).removeKid(id: "k1")
        #expect(transport.requests.first?.httpMethod == "DELETE")
    }

    @Test func names() throws {
        #expect(try FamilyService.cleanKidName(" Maya ") == "Maya")
        #expect(throws: FamilyError.nameEmpty) { try FamilyService.cleanKidName("   ") }
        #expect(throws: FamilyError.nameTooLong) { try FamilyService.cleanKidName(String(repeating: "a", count: 31)) }
    }
}

struct AccountRuleTests {
    @Test func aPlanThatWouldChargeBlocksDeletion() {
        func blocks(_ json: String) -> Bool { AccountService.planBlocksDeletion(rows: Data(json.utf8)) }
        #expect(blocks(#"[{"status":"trialing","cancel_at_period_end":false,"cancel_at":null}]"#))
        #expect(blocks(#"[{"status":"active","cancel_at_period_end":null}]"#))
        #expect(!blocks(#"[{"status":"active","cancel_at_period_end":true,"cancel_at":null}]"#))
        #expect(!blocks(#"[{"status":"active","cancel_at_period_end":false,"cancel_at":"2026-11-01T00:00:00Z"}]"#))
        #expect(!blocks(#"[{"status":"canceled","cancel_at_period_end":false,"cancel_at":null}]"#))
        #expect(!blocks("[]"))
        // a web plan blocks; an Apple plan never does (delete_own_account lets it through: the app
        // tells the grown-up to cancel it in Settings instead, DeletionAdvice)
        #expect(blocks(#"[{"status":"active","cancel_at_period_end":false,"cancel_at":null,"provider":"stripe"}]"#))
        #expect(!blocks(#"[{"status":"active","cancel_at_period_end":false,"cancel_at":null,"provider":"apple"}]"#))
        #expect(blocks(#"[{"status":"active","provider":"apple"},{"status":"past_due","provider":"stripe"}]"#))
    }

    @Test func askMemoryShape() throws {
        let memory = try JSONDecoder().decode(AccountService.AskMemory.self,
                                              from: Data(#"{"notes":["Likes pizza examples"],"updatedAt":"2026-10-17T09:00:00Z"}"#.utf8))
        #expect(memory.notes == ["Likes pizza examples"])
        #expect(memory.updatedAt != nil)
        let empty = try JSONDecoder().decode(AccountService.AskMemory.self, from: Data(#"{"notes":[],"updatedAt":null}"#.utf8))
        #expect(empty.notes.isEmpty)
    }
}

struct ReportShapeTests {
    @Test func weeklyReport() async throws {
        let answer = """
        {"report":{"weekStart":"2026-10-12","timeZone":"America/New_York","ownerId":"p1","generatedAt":"2026-10-17T10:00:00Z",
          "children":[{"userId":"k1","displayName":"Maya","avatar":"fox","grade":3,"problems":12,"independent":9,"minutes":48,
          "activeDays":4,"dailySets":3,"streak":4,"newlyMastered":["Times tables"],
          "practised":[{"skill":"times_tables","name":"Times tables","problems":8,"independent":7}],
          "focus":{"skill":"division_facts","name":"Division facts","tip":"Try sharing snacks."},"highlightBoardId":null,"days":[2,3,0,4,3,0,0]}]},
         "role":"parent","email":{"optedOut":false,"sending":true}}
        """
        let transport = FakeTransport(replies: [.json(200, answer)])
        let service = ReportsService(api: Fixtures.client(transport),
                                     client: SupabaseClient(supabaseURL: URL(string: "https://example.test")!, supabaseKey: "anon"))
        let report = try await service.weeklyReport(week: "2026-10-12", timeZone: TimeZone(identifier: "America/New_York")!)
        #expect(report.report.children.first?.focus?.name == "Division facts")
        #expect(report.email?.sending == true)
        let url = try #require(transport.requests.first?.url?.absoluteString)
        #expect(url.contains("week=2026-10-12"))
        #expect(url.contains("tz=America/New_York"))
    }

    @Test func bugReports() throws {
        let rows = """
        [{"id":"r1","created_at":"2026-10-16T10:00:00Z","message":"The pen lags","status":"seen","resolved_at":null,"seen_at":null,
          "unread":true,"thread":[{"id":"m1","author":"admin","body":"Thanks, looking now.","at":"2026-10-16T11:00:00Z"}]}]
        """
        let reports = try JSONDecoder().decode([BugReport].self, from: Data(rows.utf8))
        let report = try #require(reports.first)
        #expect(report.statusWords == "Looking into it")
        #expect(report.unread)
        #expect(report.thread.first?.fromAgathon == true)
    }
}
