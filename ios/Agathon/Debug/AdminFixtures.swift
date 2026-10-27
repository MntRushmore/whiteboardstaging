#if DEBUG
import AgathonKit
import Foundation
import UIKit

/// The admin console on synthetic answers (Labs › Admin console, `-lab admin`): screenshots and
/// layout without an admin account or anyone's real data (the repository is public).
struct AdminFixtures: AdminData {
    private func decode<T: Decodable>(_ json: String) throws -> T { try JSONDecoder().decode(T.self, from: Data(json.utf8)) }
    private static func iso(_ minutesAgo: Double) -> String { ISO8601DateFormatter().string(from: Date().addingTimeInterval(-minutesAgo * 60)) }

    private static func user(_ i: Int, plan: String, admin: Bool = false) -> String {
        #"{"id":"00000000-0000-4000-8000-00000000000\#(i)","email":"family\#(i)@example.com","name":"Kid \#(i)","course":"grade-\#(3 + i)","createdAt":"\#(iso(Double(i) * 4000))","onboardedAt":null,"lastActiveAt":"\#(iso(Double(i) * 37))","plan":"\#(plan)","trialEndsAt":null,"boards":\#(i + 1),"attempts7d":\#(i * 6),"solvedAlone7d":\#(i * 4),"aiCalls7d":\#(i * 20),"errors7d":\#(i == 2 ? 3 : 0),"bugReports":\#(i % 2),"isAdmin":\#(admin)}"#
    }
    private static func board(_ i: Int) -> String {
        #"{"id":"10000000-0000-4000-8000-00000000000\#(i)","userId":"00000000-0000-4000-8000-00000000000\#(i)","ownerEmail":"family\#(i)@example.com","ownerName":"Kid \#(i)","title":"\#(["Fractions", "Long division", "Two-step equations", "SAT practice"][i % 4])","createdAt":"\#(iso(5000))","updatedAt":"\#(iso(Double(i) * 12))","preview":null,"version":\#(10 + i),"sizeKb":\#(30 + i * 7),"attempts":\#(i * 3),"errors7d":\#(i == 1 ? 2 : 0)}"#
    }
    private static func event(_ i: Int, kind: String, code: String, level: String = "info", meta: String = "{}") -> String {
        #"{"id":\#(i),"at":"\#(iso(Double(i) * 9))","source":"server","level":"\#(level)","kind":"\#(kind)","code":"\#(code)","message":"\#(kind) \#(code)","route":"/api/board/draw","userId":"u1","userEmail":"family1@example.com","boardId":"10000000-0000-4000-8000-000000000001","requestId":"r\#(i)","meta":\#(meta),"release":"fa51d748","noise":false}"#
    }
    private static func bug(_ i: Int, status: String) -> String {
        #"{"id":"20000000-0000-4000-8000-00000000000\#(i)","at":"\#(iso(Double(i) * 50))","userId":"u\#(i)","email":"family\#(i)@example.com","boardId":"10000000-0000-4000-8000-000000000001","message":"\#(["It wrote over my text", "The 60 never showed up after 36+24=", "Ink looks smudged when I zoom"][i % 3])","path":null,"status":"\#(status)","note":null,"resolvedAt":null,"hasScreenshot":true,"diagnostics":{"build":"1.0 (1515) 0d6a6eb","zoom":"1.00","infinite":"on","pictureTutor":"answer"},"logs":[],"thread":[],"waiting":\#(i == 0),"reporterSeenAt":null}"#
    }

    func overview() async throws -> AdminOverview {
        try decode(#"{"generatedAt":"\#(Self.iso(1))","services":[{"service":"supabase","ok":true,"lastCheckAt":"\#(Self.iso(2))","latencyMs":84,"detail":null,"uptime24h":1,"downSince":null},{"service":"openrouter","ok":true,"lastCheckAt":"\#(Self.iso(2))","latencyMs":310,"detail":null,"uptime24h":0.996,"downSince":null},{"service":"mathpix","ok":false,"lastCheckAt":"\#(Self.iso(2))","latencyMs":null,"detail":"timeout","uptime24h":0.97,"downSince":"\#(Self.iso(6))"}],"openrouter":{"creditsLeftUsd":41.2,"usedUsd":8.8},"errors":{"total24h":12,"users24h":4,"perHour":[],"groups":[{"kind":"board_draw","code":"misaligned","source":"server","level":"error","message":"The drawing didn't line up with the board","count":5,"users":2,"firstAt":"\#(Self.iso(300))","lastAt":"\#(Self.iso(9))","samples":[]},{"kind":"recognize","code":"timeout","source":"server","level":"warn","message":"Mathpix took too long","count":7,"users":3,"firstAt":"\#(Self.iso(600))","lastAt":"\#(Self.iso(30))","samples":[]}]},"ai":{"routes":[{"route":"board/draw","calls24h":64,"failures24h":5,"fallbacks24h":0},{"route":"live/check","calls24h":420,"failures24h":2,"fallbacks24h":1}]},"users":{"total":214,"signups24h":3,"signups7d":19,"active24h":41,"active7d":102},"money":{"priceUsd":24.99,"paying":6,"payingCancelling":1,"mrrUsd":124.95,"trialing":9,"trialsCancelling":2,"pipelineUsd":174.93,"failing":1,"ended":4,"trialsOver":14,"trialsConverted":6,"started7d":5,"upcoming":[]},"funnel":{"accounts":214,"onboarded":160,"trials":29,"paying":6},"learning":{"attempts24h":88,"solvedAlone24h":51},"bugReports":[]}"#)
    }

    func users() async throws -> AdminUserList {
        try decode(#"{"generatedAt":"t","total":4,"users":[\#(Self.user(1, plan: "active", admin: true)),\#(Self.user(2, plan: "trialing")),\#(Self.user(3, plan: "cancelling")),\#(Self.user(4, plan: "none"))]}"#)
    }

    func user(_ id: String) async throws -> AdminUserDetail {
        try decode(#"{"generatedAt":"t","user":\#(Self.user(2, plan: "trialing")),"subscription":{"status":"trialing","trialEnd":"\#(Self.iso(-4000))","currentPeriodEnd":null,"cancelAtPeriodEnd":false,"cancelAt":null,"payerEmail":null,"createdAt":"t"},"inkBalance":null,"boards":[\#(Self.board(1)),\#(Self.board(2))],"learning":{"attempts":42,"solvedAlone":27,"withHelp":11,"tutorSolved":4,"activeMinutes":190,"skills":[{"skill":"fractions","attempts":18,"solvedAlone":12},{"skill":"two-step equations","attempts":9,"solvedAlone":5}],"recent":[]},"activity":[],"events":[\#(Self.event(1, kind: "board_draw", code: "done"))],"bugs":[\#(Self.bug(1, status: "seen"))],"emails":[]}"#)
    }

    func boards(userId: String?, before: String?) async throws -> AdminBoardList {
        try decode(#"{"generatedAt":"t","boards":[\#((1...4).map(Self.board).joined(separator: ","))],"nextBefore":null}"#)
    }

    func board(_ id: String) async throws -> AdminBoardDoc {
        // one synthetic tldraw page with a pen line, so the page renderer has something to draw
        let snapshot = #"{"document":{"store":{"document:document":{"id":"document:document","typeName":"document","name":""},"page:a":{"id":"page:a","typeName":"page","name":"Page 1","index":"a1"},"shape:s1":{"id":"shape:s1","typeName":"shape","type":"draw","parentId":"page:a","index":"a1","x":200,"y":200,"rotation":0,"isLocked":false,"opacity":1,"meta":{},"props":{"color":"black","size":"m","dash":"draw","fill":"none","isComplete":true,"isClosed":false,"isPen":true,"scale":1,"segments":[{"type":"free","points":[{"x":0,"y":0,"z":0.5},{"x":120,"y":40,"z":0.5},{"x":260,"y":0,"z":0.5},{"x":400,"y":60,"z":0.5}]}]}}},"schema":{"schemaVersion":2,"sequences":{}}}}"#
        return try decode(#"{"generatedAt":"t","board":\#(Self.board(1)),"snapshot":\#(snapshot),"snapshotSource":"data","events":[\#(Self.event(3, kind: "board_draw", code: "done"))],"attempts":[],"history":[]}"#)
    }

    func boardAsk(_ id: String) async throws -> AdminAskChat {
        try decode(#"{"generatedAt":"t","boardId":"\#(id)","turns":[{"id":"t1","role":"user","text":"how do I add 1/2 and 1/3?","notes":[],"wrote":[],"at":"\#(Self.iso(20))"},{"id":"t2","role":"tutor","text":"Find a common bottom number first. What number do 2 and 3 both go into?","notes":["asked a question"],"wrote":[],"at":"\#(Self.iso(19))"}]}"#)
    }

    func bugs() async throws -> AdminBugList {
        try decode(#"{"generatedAt":"t","bugs":[\#(Self.bug(0, status: "new")),\#(Self.bug(1, status: "seen")),\#(Self.bug(2, status: "fixed"))]}"#)
    }

    func bugScreenshot(_ id: String) async throws -> Data {
        UIGraphicsImageRenderer(size: CGSize(width: 600, height: 340)).image { ctx in
            UIColor.white.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 600, height: 340))
            UIColor.systemBlue.setStroke()
            let p = UIBezierPath(); p.move(to: CGPoint(x: 60, y: 200)); p.addCurve(to: CGPoint(x: 540, y: 160), controlPoint1: CGPoint(x: 200, y: 60), controlPoint2: CGPoint(x: 380, y: 300))
            p.lineWidth = 6; p.stroke()
        }.pngData() ?? Data()
    }

    func updateBug(_ id: String, status: String?, note: String?) async throws {}
    func replyToBug(_ id: String, body: String) async throws {}

    func issues(days: Int) async throws -> AdminIssueList {
        try decode(#"{"generatedAt":"t","days":\#(days),"issues":[{"fingerprint":"board_draw|misaligned|x","kind":"board_draw","code":"misaligned","source":"server","level":"error","message":"The drawing didn't line up with the board","count":5,"users":2,"boards":2,"firstAt":"\#(Self.iso(3000))","lastAt":"\#(Self.iso(9))","perDay":[0,0,1,0,2,0,2],"status":"open","note":null,"fixedAt":null,"regressed":false,"noise":false,"samples":[\#(Self.event(5, kind: "board_draw", code: "misaligned", level: "error"))]},{"fingerprint":"recognize|timeout|y","kind":"recognize","code":"timeout","source":"server","level":"warn","message":"Mathpix took too long","count":7,"users":3,"boards":4,"firstAt":"\#(Self.iso(9000))","lastAt":"\#(Self.iso(30))","perDay":[1,2,0,1,1,0,2],"status":"muted","note":"their side","fixedAt":null,"regressed":false,"noise":false,"samples":[]}]}"#)
    }

    func runs(boardId: String?, limit: Int) async throws -> AdminRunList {
        let runs = [
            Self.event(1, kind: "board_draw", code: "done", meta: #"{"mode":"answer","tutorModel":"google/gemini-3.8-flash","totalMs":8700,"costUsd":0.036,"alignScore":0.98,"strokes":24}"#),
            Self.event(2, kind: "board_draw_outcome", code: "accepted"),
            Self.event(3, kind: "board_draw", code: "error", level: "error", meta: #"{"mode":"answer","tutorModel":"google/gemini-3.8-flash","totalMs":17400,"costUsd":0.072,"alignScore":0.31,"misaligned":true,"paints":2}"#),
            Self.event(4, kind: "board_draw", code: "write", meta: #"{"mode":"answer","tutorModel":"google/gemini-3.8-flash","totalMs":3300,"costUsd":0.002,"simple":"36 + 24"}"#),
            Self.event(6, kind: "board_draw", code: "none", meta: #"{"mode":"feedback","tutorModel":"google/gemini-3.8-flash","totalMs":3600,"costUsd":0.002,"correct":true}"#),
        ]
        return try decode(#"{"generatedAt":"t","runs":[\#(runs.joined(separator: ","))]}"#)
    }
}
#endif
