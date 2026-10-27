import Foundation
import Testing
@testable import AgathonKit

/// The iPad admin console reads the web console's routes (src/lib/admin/contracts.ts). Synthetic
/// answers shaped like each one (no real accounts: the repository is public).
struct AdminModelsTests {
    func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T { try JSONDecoder().decode(type, from: Data(json.utf8)) }

    static let event = #"{"id":7,"at":"2026-10-27T13:38:18Z","source":"server","level":"info","kind":"board_draw","code":"done","message":"run done","route":"/api/board/draw","userId":"u1","userEmail":"a@example.com","boardId":"b1","requestId":"q","meta":{"mode":"answer","alignScore":0.31,"misaligned":true,"costUsd":0.07,"totalMs":9134},"release":"0d6a6eb","noise":false}"#
    static let user = #"{"id":"u1","email":"a@example.com","name":"Sam","course":"grade-5","createdAt":"2026-10-01T00:00:00Z","onboardedAt":null,"lastActiveAt":"2026-10-27T13:00:00Z","plan":"trialing","trialEndsAt":"2026-11-01T00:00:00Z","boards":3,"attempts7d":12,"solvedAlone7d":8,"aiCalls7d":40,"errors7d":1,"bugReports":2,"isAdmin":false}"#
    static let board = #"{"id":"b1","userId":"u1","ownerEmail":"a@example.com","ownerName":"Sam","title":"Fractions","createdAt":"2026-10-01T00:00:00Z","updatedAt":"2026-10-27T13:00:00Z","preview":"data:image/png;base64,iVBORw0KGgo=","version":12,"sizeKb":40,"attempts":5,"errors7d":0}"#
    static let bug = #"{"id":"r1","at":"2026-10-27T13:00:00Z","userId":"u1","email":"a@example.com","boardId":"b1","message":"it wrote over my text","path":null,"status":"new","note":null,"resolvedAt":null,"hasScreenshot":true,"diagnostics":{"build":"1.0 (1515)","zoom":"1.00"},"logs":[{"level":"info","time":"t","text":"hi"}],"thread":[{"id":"m1","author":"admin","body":"On it","at":"t"}],"waiting":false,"reporterSeenAt":null}"#

    @Test func overview() throws {
        let o = try decode(AdminOverview.self, #"{"generatedAt":"t","services":[{"service":"supabase","ok":true,"lastCheckAt":"t","latencyMs":120,"detail":null,"uptime24h":1,"downSince":null}],"openrouter":{"creditsLeftUsd":12.5,"usedUsd":3},"errors":{"total24h":4,"users24h":2,"perHour":[],"groups":[{"kind":"route","code":"x","source":"server","level":"error","message":"boom","count":4,"users":2,"firstAt":"t","lastAt":"t","samples":[]}]},"ai":{"routes":[{"route":"live/check","calls24h":10,"failures24h":1,"fallbacks24h":0}]},"users":{"total":100,"signups24h":2,"signups7d":9,"active24h":20,"active7d":50},"money":{"priceUsd":24.99,"paying":3,"payingCancelling":0,"mrrUsd":74.97,"trialing":5,"trialsCancelling":1,"pipelineUsd":99.96,"failing":0,"ended":2,"trialsOver":6,"trialsConverted":3,"started7d":2,"upcoming":[]},"funnel":{"accounts":100,"onboarded":80,"trials":20,"paying":3},"learning":{"attempts24h":30,"solvedAlone24h":18},"bugReports":[]}"#)
        #expect(o.services.first?.ok == true)
        #expect(o.users.active24h == 20)
        #expect(o.money?.mrrUsd == 74.97)
        #expect(o.errors.groups.first?.count == 4)
        #expect(o.openrouter?.creditsLeftUsd == 12.5)
    }

    @Test func usersAndDetail() throws {
        let list = try decode(AdminUserList.self, #"{"generatedAt":"t","total":1,"users":[\#(Self.user)]}"#)
        #expect(list.users.first?.plan == "trialing")
        let detail = try decode(AdminUserDetail.self, #"{"generatedAt":"t","user":\#(Self.user),"subscription":{"status":"trialing","trialEnd":"t","currentPeriodEnd":null,"cancelAtPeriodEnd":false,"cancelAt":null,"payerEmail":null,"createdAt":"t"},"inkBalance":null,"boards":[\#(Self.board)],"learning":{"attempts":12,"solvedAlone":8,"withHelp":3,"tutorSolved":1,"activeMinutes":40,"skills":[{"skill":"fractions","attempts":5,"solvedAlone":3}],"recent":[{"id":"a1","boardId":"b1","problemLatex":"\\frac{1}{2}+\\frac{1}{3}","skill":"fractions","outcome":"first_try","hints":0,"solves":0,"linesRinged":0,"activeMs":1000,"startedAt":"t","finishedAt":null}]},"activity":[{"day":"2026-10-27","attempts":3,"aiCalls":10,"boards":1}],"events":[\#(Self.event)],"bugs":[\#(Self.bug)],"emails":[]}"#)
        #expect(detail.boards.count == 1)
        #expect(detail.learning?.skills.first?.skill == "fractions")
        #expect(detail.events.first?.flag("misaligned") == true)
    }

    @Test func boardsAndDoc() throws {
        let list = try decode(AdminBoardList.self, #"{"generatedAt":"t","boards":[\#(Self.board)],"nextBefore":"2026-10-20T00:00:00Z"}"#)
        #expect(list.boards.first?.previewData != nil)
        #expect(list.nextBefore != nil)
        let doc = try decode(AdminBoardDoc.self, #"{"generatedAt":"t","board":\#(Self.board),"snapshot":{"document":{"store":{},"schema":{}}},"snapshotSource":"doc","events":[],"attempts":[],"history":[]}"#)
        #expect(doc.snapshotSource == "doc")
        if case .object = doc.snapshot {} else { Issue.record("the snapshot is an object") }
    }

    @Test func bugsIssuesRunsAndAsk() throws {
        let bugs = try decode(AdminBugList.self, #"{"generatedAt":"t","bugs":[\#(Self.bug)]}"#)
        #expect(bugs.bugs.first?.thread.first?.author == "admin")
        #expect(bugs.bugs.first?.diagnostics["build"] == .string("1.0 (1515)"))
        let issues = try decode(AdminIssueList.self, #"{"generatedAt":"t","days":7,"issues":[{"fingerprint":"k||m","kind":"k","code":null,"source":"ios","level":"error","message":"m","count":3,"users":1,"boards":1,"firstAt":"t","lastAt":"t","perDay":[0,1,2],"status":"open","note":null,"fixedAt":null,"regressed":false,"noise":false,"samples":[\#(Self.event)]}]}"#)
        #expect(issues.issues.first?.perDay == [0, 1, 2])
        let runs = try decode(AdminRunList.self, #"{"generatedAt":"t","runs":[\#(Self.event)]}"#)
        let run = try #require(runs.runs.first)
        #expect(run.text("mode") == "answer")
        #expect(run.number("alignScore") == 0.31)
        let ask = try decode(AdminAskChat.self, #"{"generatedAt":"t","boardId":"b1","turns":[{"id":"t1","role":"user","text":"help","notes":[],"wrote":[],"at":"t"}]}"#)
        #expect(ask.turns.count == 1)
    }

    @Test func aFieldTheServerDropsDoesNotEmptyTheScreen() throws {
        // a user row with only its id still decodes, the rest defaulted
        let u = try decode(AdminUserRow.self, #"{"id":"u9"}"#)
        #expect(u.plan == "none" && u.boards == 0)
        let e = try decode(AdminEvent.self, #"{"id":1}"#)
        #expect(e.level == "info" && e.meta.isEmpty)
    }
}
