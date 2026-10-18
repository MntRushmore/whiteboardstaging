import AgathonBoard
import AgathonKit
import Foundation
import Testing
@testable import Agathon

/// The Blocks screens' logic: Home's words and search, the ink meter's level, opening a stored
/// board, the family's words.
struct HomeFormatTests {
    let now = Date(timeIntervalSince1970: 1_792_300_000)

    @Test func editedWords() {
        #expect(HomeFormat.edited(nil, now: now) == "Not opened yet")
        #expect(HomeFormat.edited(now.addingTimeInterval(-10), now: now) == "Edited just now")
        // The server's clock a moment ahead of the iPad's is still "just now", never "in 3 seconds".
        #expect(HomeFormat.edited(now.addingTimeInterval(3), now: now) == "Edited just now")
        #expect(HomeFormat.edited(now.addingTimeInterval(-2 * 86_400), now: now) == "Edited 2 days ago")
        #expect(HomeFormat.edited(now.addingTimeInterval(-3 * 3600), now: now) == "Edited 3 hours ago")
    }

    @Test func greetingUsesTheFirstName() {
        #expect(HomeFormat.greetingName("Maya") == "Maya")
        #expect(HomeFormat.greetingName("  Maya Lopez ") == "Maya")
        #expect(HomeFormat.greetingName("Grown-up") == nil)
        #expect(HomeFormat.greetingName("grown-up") == nil)
        #expect(HomeFormat.greetingName("") == nil)
        #expect(HomeFormat.greetingName(nil) == nil)
    }
}

struct HomeSearchTests {
    let boards = [
        BoardSummary(id: "1", title: "Fractions practice"),
        BoardSummary(id: "2", title: "Times tables"),
        BoardSummary(id: "3", title: "Today's practice · Wednesday"),
        BoardSummary(id: "4", title: "Área y perímetro"),
    ]

    @Test func everyWordMustMatch() {
        #expect(HomeModel.filter(boards, query: "").map(\.id) == ["1", "2", "3", "4"])
        #expect(HomeModel.filter(boards, query: "  ").count == 4)
        #expect(HomeModel.filter(boards, query: "practice").map(\.id) == ["1", "3"])
        #expect(HomeModel.filter(boards, query: "PRACTICE wed").map(\.id) == ["3"])
        #expect(HomeModel.filter(boards, query: "area").map(\.id) == ["4"], "accents don't matter")
        #expect(HomeModel.filter(boards, query: "zebra").isEmpty)
    }
}

struct InkLevelTests {
    static func ink(_ json: String) throws -> InkSummary {
        try #require(InkSummary.parse(Data(json.utf8)))
    }

    @Test func wordsNotNumbers() throws {
        #expect(InkLevel.level(nil) == 1, "unknown yet: no alarm")
        #expect(InkLevel.level(try Self.ink(#"{"balance":0}"#)) == 0)
        #expect(InkLevel.level(try Self.ink(#"{"balance":"40"}"#)) < 0.2)
        #expect(InkLevel.level(try Self.ink(#"{"balance":200}"#)) < 0.6)
        #expect(InkLevel.level(try Self.ink(#"{"balance":900}"#)) >= 0.6)
        // A plan covers help, whatever the balance.
        #expect(InkLevel.level(try Self.ink(#"{"balance":0,"unlimited":{"status":"trialing"}}"#)) == 1)
    }
}

struct BoardOpeningTests {
    @Test func anEmptyBoardOpensBlank() throws {
        for stored in ["{}", "null"] {
            let converted = try BoardPreviewModel.convert(Data(stored.utf8))
            #expect(converted.document.screens.count == 1)
            #expect(converted.document.strokes.isEmpty)
            #expect(converted.report == nil)
        }
    }

    @Test func aSnapshotWithoutPagesOpensBlank() throws {
        let converted = try BoardPreviewModel.convert(Data(#"{"document":{"store":{}},"session":{}}"#.utf8))
        #expect(converted.document.screens.count == 1)
    }

    @Test func aTldrawSnapshotConverts() throws {
        let snapshot = """
        {"document":{"store":{
          "page:a":{"typeName":"page","id":"page:a","index":"a1","name":"Page 1","meta":{}},
          "page:b":{"typeName":"page","id":"page:b","index":"a2","name":"Page 2","meta":{}},
          "shape:s1":{"typeName":"shape","id":"shape:s1","type":"draw","parentId":"page:b","index":"a1","x":100,"y":100,
            "rotation":0,"isLocked":false,"opacity":1,"meta":{},
            "props":{"color":"black","fill":"none","dash":"draw","size":"m","isComplete":true,"isClosed":false,"isPen":false,
              "scale":1,"segments":[{"type":"free","points":[{"x":0,"y":0,"z":0.5},{"x":20,"y":10,"z":0.5},{"x":40,"y":0,"z":0.5}]}]}}
        },"schema":{}},"session":{"currentPageId":"page:b"}}
        """
        let converted = try BoardPreviewModel.convert(Data(snapshot.utf8))
        #expect(converted.document.screens.count == 2)
        #expect(converted.document.strokes.count == 1)
        let current = try #require(converted.currentScreen)
        #expect(converted.document.screens.firstIndex { $0.id == current } == 1, "opens on the screen tldraw had open")
    }

    @Test func garbageIsAnError() {
        #expect(throws: (any Error).self) { try BoardPreviewModel.convert(Data("<html>".utf8)) }
        #expect(throws: (any Error).self) { try BoardPreviewModel.convert(Data(#"{"hello":1}"#.utf8)) }
    }

    @Test func aMissingBoardSaysSo() {
        let gone = BoardPreviewModel.failure(forLoad: BoardsRepository.BoardError.notFound)
        #expect(gone.retry == false)
        #expect(gone.title.contains("isn't here"))
        let offline = BoardPreviewModel.failure(forLoad: URLError(.notConnectedToInternet))
        #expect(offline.retry)
    }

    @Test func thePensAreBlocksAndTheEngines() {
        for entry in BoardPreviewCanvasPens.all {
            #expect(InkColor.kidPalette.contains(entry.ink))
            #expect(entry.ink != .tutor)
        }
    }
}

struct FamilyCopyTests {
    static func refusal(_ status: Int, _ body: String) -> APIError {
        .http(HTTPFailure(status: status, header: { _ in nil }, body: Data(body.utf8)))
    }

    @Test func pinWords() {
        let wrong = FamilyCopy.switchMessage(Self.refusal(403, #"{"error":"forbidden","message":"x","reason":"wrong_pin","triesLeft":2}"#))
        #expect(wrong == "That PIN isn't right. 2 tries left.")
        let last = FamilyCopy.switchMessage(Self.refusal(403, #"{"error":"forbidden","message":"x","reason":"wrong_pin","triesLeft":1}"#))
        #expect(last == "That PIN isn't right. 1 try left.")
        let noPin = FamilyCopy.switchMessage(Self.refusal(409, #"{"error":"conflict","message":"x","reason":"no_pin"}"#))
        #expect(noPin == "The grown-up hasn't set a PIN yet.")
        for message in [wrong, last, noPin] {
            #expect(!message.lowercased().contains("wrong"), "kid copy never says wrong")
        }
    }
}
