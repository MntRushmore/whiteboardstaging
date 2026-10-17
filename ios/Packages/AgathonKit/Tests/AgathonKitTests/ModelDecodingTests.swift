import Foundation
import Testing
@testable import AgathonKit

struct BoardSummaryDecodingTests {
    // A 1x1 PNG.
    static let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

    @Test func decodesAPostgRESTRow() throws {
        let json = """
        [{"id":"0b9c2f1e-6a1d-4c8e-9f57-3d2b8a7c6e51","title":"Fractions","created_at":"2026-10-17T09:41:12.123456+00:00",
          "updated_at":"2026-10-17T10:00:00+00:00","preview":"data:image/png;base64,\(Self.png)","version":3}]
        """
        let boards = try JSONDecoder().decode([BoardSummary].self, from: Data(json.utf8))
        let board = try #require(boards.first)
        #expect(board.id == "0b9c2f1e-6a1d-4c8e-9f57-3d2b8a7c6e51")
        #expect(board.title == "Fractions")
        #expect(board.version == 3)
        let created = try #require(board.createdAt)
        #expect(abs(created.timeIntervalSince1970 - 1_792_230_072.123) < 0.001)
        #expect(board.updatedAt?.timeIntervalSince1970 == 1_792_231_200)
        let image = try #require(board.previewImage)
        #expect(image.mediaType == "image/png")
        #expect(Array(image.data.prefix(4)) == [0x89, 0x50, 0x4E, 0x47])
    }

    @Test func missingAndNullFields() throws {
        let json = #"[{"id":"b1","title":null,"updated_at":null,"preview":null},{"id":"b2","title":"  ","preview":"","version":"7"}]"#
        let boards = try JSONDecoder().decode([BoardSummary].self, from: Data(json.utf8))
        #expect(boards[0].title == BoardSummary.defaultTitle)
        #expect(boards[0].updatedAt == nil)
        #expect(boards[0].createdAt == nil)
        #expect(boards[0].preview == nil)
        #expect(boards[0].previewImage == nil)
        #expect(boards[0].version == nil)
        #expect(boards[1].title == BoardSummary.defaultTitle)
        #expect(boards[1].preview == nil)
        #expect(boards[1].version == 7)
    }

    @Test func aRowWithoutAnIdIsAnError() {
        #expect(throws: DecodingError.self) {
            try JSONDecoder().decode([BoardSummary].self, from: Data(#"[{"title":"x"}]"#.utf8))
        }
    }

    @Test func listColumnsNeverIncludeTheDocument() {
        let columns = BoardSummary.columns.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        #expect(!columns.contains("data"))
        #expect(columns.contains("preview"))
        #expect(columns.contains("version"))
    }

    @Test func dataURLs() {
        #expect(DataURL("data:image/webp;base64,UklGRg==")?.mediaType == "image/webp")
        #expect(DataURL("data:text/plain;base64,aGk=") == nil)
        #expect(DataURL("data:image/png,rawbytes") == nil)
        #expect(DataURL("https://example.test/a.png") == nil)
        #expect(DataURL("data:image/png;base64,") == nil)
    }
}

struct PostgresDateTests {
    private let expected = Date(timeIntervalSince1970: 1_792_230_072)

    @Test func formatsPostgresAndTheAPIWrite() throws {
        #expect(PostgresDate.parse("2026-10-17T09:41:12Z") == expected)
        #expect(PostgresDate.parse("2026-10-17T09:41:12+00:00") == expected)
        #expect(PostgresDate.parse("2026-10-17 09:41:12+00") == expected)
        #expect(PostgresDate.parse("2026-10-17T15:11:12+05:30") == expected)
        #expect(PostgresDate.parse("2026-10-17T09:41:12") == expected)
        let fraction = try #require(PostgresDate.parse("2026-10-17T09:41:12.5+00:00"))
        #expect(abs(fraction.timeIntervalSince(expected) - 0.5) < 0.001)
        let micro = try #require(PostgresDate.parse("2026-10-17T09:41:12.987654Z"))
        #expect(abs(micro.timeIntervalSince(expected) - 0.987) < 0.001)
    }

    @Test func garbageIsNil() {
        #expect(PostgresDate.parse("") == nil)
        #expect(PostgresDate.parse("yesterday") == nil)
    }
}

struct FamilyDecodingTests {
    @Test func familyState() throws {
        let json = """
        {"role":"parent","me":"p1","parentId":"p1","hasPin":true,"members":[
          {"userId":"p1","displayName":"Grown-up","avatar":null,"grade":null,"isParent":true,"stats":null},
          {"userId":"k1","displayName":"Maya","avatar":"fox","grade":3,"isParent":false,
           "stats":{"streak":4,"problemsThisWeek":21,"mastered":2}}]}
        """
        let state = try JSONDecoder().decode(FamilyState.self, from: Data(json.utf8))
        #expect(state.role == .parent)
        #expect(state.hasPin)
        #expect(state.meMember?.displayName == "Grown-up")
        #expect(state.switchTargets.map(\.userId) == ["k1"])
        let kid = state.members[1]
        #expect(kid.grade == 3)
        #expect(kid.stats?.problemsThisWeek == 21)
        #expect(!kid.needsPin)
        #expect(state.members[0].needsPin)
        #expect(FamilyAvatar.emoji(for: kid.avatar) == "🦊")
        #expect(FamilyAvatar.emoji(for: nil) == "🙂")
        #expect(FamilyAvatar.emoji(for: "dragon") == "🙂")
    }

    @Test func soloHasNobodyToSwitchTo() throws {
        let json = #"{"role":"solo","me":"u1","parentId":"u1","hasPin":false,"members":[{"userId":"u1","displayName":"Grown-up","avatar":null,"grade":null,"isParent":true,"stats":null}]}"#
        let state = try JSONDecoder().decode(FamilyState.self, from: Data(json.utf8))
        #expect(state.switchTargets.isEmpty)
    }

    @Test func switchResult() throws {
        let result = try JSONDecoder().decode(SwitchResult.self, from: Data(#"{"access_token":"a.b.c","refresh_token":"r1"}"#.utf8))
        #expect(result.accessToken == "a.b.c")
        #expect(result.refreshToken == "r1")
    }
}

struct InkAndProfileDecodingTests {
    @Test func inkSummaryTakesNumbersAsStrings() throws {
        let json = #"{"balance":"250","granted":300,"purchased":"0","refunded":0,"used":"50","starter":300,"starter_at":null,"purchases":0,"last_purchase":null}"#
        let ink = try #require(InkSummary.parse(Data(json.utf8)))
        #expect(ink.balance == 250)
        #expect(ink.used == 50)
        #expect(ink.tone == .ok)
        #expect(ink.unlimited == nil)
        #expect(!ink.hasUnlimited)
    }

    @Test func inkSummaryAsAOneRowArrayWithAPlan() throws {
        let json = #"[{"balance":40,"granted":100,"purchased":0,"refunded":0,"used":60,"starter":100,"purchases":0,"unlimited":{"status":"trialing","unlimited":true,"trial_end":"2026-10-24T00:00:00+00:00","current_period_end":null,"cancel_at_period_end":false,"checkout_ref":"c1"}}]"#
        let ink = try #require(InkSummary.parse(Data(json.utf8)))
        #expect(ink.tone == .low)
        #expect(ink.hasUnlimited)
        #expect(ink.unlimited?.status == "trialing")
        #expect(ink.unlimited?.trialEnd == PostgresDate.parse("2026-10-24T00:00:00Z"))
    }

    @Test func inkTone() throws {
        #expect(try #require(InkSummary.parse(Data(#"{"balance":0}"#.utf8))).tone == .empty)
        #expect(InkSummary.parse(Data(#"{"nope":1}"#.utf8)) == nil)
        #expect(InkSummary.parse(Data("null".utf8)) == nil)
    }

    @Test func profile() throws {
        let json = #"[{"user_id":"u1","display_name":"Maya","avatar":"owl","grade":4,"course":null,"onboarded_at":"2026-10-12T08:00:00+00:00","terms_version":"2026-10-11"}]"#
        let profile = try #require(try JSONDecoder().decode([Profile].self, from: Data(json.utf8)).first)
        #expect(profile.displayName == "Maya")
        #expect(profile.grade == 4)
        #expect(profile.onboardedAt != nil)
        #expect(profile.termsVersion == "2026-10-11")
    }
}

struct JSONValueTests {
    @Test func roundTrips() throws {
        let text = #"{"a":[1,2.5,"x",true,null],"b":{"c":"d"}}"#
        let value = try #require(JSONValue.parse(Data(text.utf8)))
        #expect(value["a"]?.arrayValue?.count == 5)
        #expect(value["a"]?.arrayValue?[0].intValue == 1)
        #expect(value["a"]?.arrayValue?[1].intValue == nil)
        #expect(value["b"]?["c"]?.stringValue == "d")
        #expect(JSONValue.parse(Data(value.jsonString.utf8)) == value)
    }
}
