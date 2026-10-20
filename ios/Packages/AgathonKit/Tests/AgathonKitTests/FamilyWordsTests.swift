import Foundation
import Testing
@testable import AgathonKit

/// The family's refusals in words (FamilyWords), and who may open the grown-up places
/// (FamilyState.who). The owner's iPad, 2026-10-20: "I'm unable to set my PIN" was a kid's profile
/// offered Set PIN, refused 403 `kid`, and told only "The PIN wasn't saved. Try again."
struct FamilyWordsTests {
    private func http(_ status: Int, _ body: String) -> APIError {
        .http(HTTPFailure(status: status, header: { _ in nil }, body: Data(body.utf8)))
    }

    @Test func aKidSettingThePinIsToldToSwitchToTheGrownUp() {
        let error = http(403, #"{"error":"invalid_request","message":"A kid profile can't do that. Ask your grown-up.","requestId":"r","reason":"kid"}"#)
        #expect(FamilyRefusal(error) == .kid)
        let words = FamilyWords.message(error, .setPin)
        #expect(words.contains("kid's profile"))
        #expect(words.contains("Switch to the grown-up"))
        #expect(!words.contains("Try again"))
    }

    @Test func everyReasonHasItsOwnWords() {
        let cases: [(String, Int, FamilyRefusal)] = [
            (#"{"error":"invalid_request","reason":"pin_required"}"#, 409, .pinRequired),
            (#"{"error":"invalid_request","reason":"no_pin"}"#, 403, .noPin),
            (#"{"error":"invalid_request","reason":"wrong_pin","triesLeft":3}"#, 403, .wrongPin(triesLeft: 3, locked: false)),
            (#"{"error":"invalid_request","reason":"wrong_pin","triesLeft":0,"locked":true}"#, 403, .wrongPin(triesLeft: 0, locked: true)),
            (#"{"error":"rate_limited","reason":"pin_locked","retryAfterMs":1000}"#, 429, .pinLocked),
            (#"{"error":"feature_unavailable","reason":"pin_unavailable"}"#, 503, .pinUnavailable),
            (#"{"error":"invalid_request","reason":"plan_required"}"#, 409, .planRequired),
            (#"{"error":"invalid_request","reason":"too_many"}"#, 409, .tooMany),
            (#"{"error":"rate_limited","reason":"kid_add_limit"}"#, 429, .kidAddLimit),
            (#"{"error":"invalid_request","reason":"self"}"#, 400, .alreadyThem),
            (#"{"error":"not_found","message":"No one in your family has that profile."}"#, 404, .gone),
            (#"{"error":"rate_limited","retryAfterMs":5000}"#, 429, .tooManyTries),
            (#"{"error":"unauthorized"}"#, 401, .signedOut),
            (#"{"error":"upstream_error","message":"Something went wrong on our side."}"#, 502, .server),
            ("<html><body>502 Bad gateway · Cloudflare</body></html>", 502, .server),
        ]
        var seen = Set<String>()
        for (body, status, expected) in cases {
            let refusal = FamilyRefusal(http(status, body))
            #expect(refusal == expected, "\(status) \(body)")
            let words = FamilyWords.message(refusal, .switchProfile)
            #expect(!words.isEmpty)
            #expect(!words.contains("<"), "HTML in \(words)")
            #expect(!words.contains("(5"), "a status in \(words)")
            seen.insert(words)
        }
        // the switcher's words differ by reason (the server and Cloudflare's 502 both say "try again")
        #expect(seen.count >= cases.count - 1)
    }

    @Test func wrongPinCountsTheTriesLeft() {
        #expect(FamilyWords.message(.wrongPin(triesLeft: 3, locked: false), .switchProfile) == "That PIN isn't right. 3 tries left.")
        #expect(FamilyWords.message(.wrongPin(triesLeft: 1, locked: false), .switchProfile) == "That PIN isn't right. 1 try left.")
        #expect(FamilyWords.message(.wrongPin(triesLeft: 0, locked: true), .switchProfile).contains("locked"))
    }

    @Test func pinRequiredMeansSomethingElseWhenAddingAKid() {
        #expect(FamilyWords.message(.pinRequired, .switchProfile) == "Enter the grown-up's PIN.")
        #expect(FamilyWords.message(.pinRequired, .addKid) == "Set your PIN first, then add kids.")
    }

    @Test func offlineAndStallsSayCheckTheWiFi() {
        #expect(FamilyRefusal(APIError.network(.notConnectedToInternet)) == .offline)
        #expect(FamilyRefusal(APIError.timeout) == .offline)
        #expect(FamilyRefusal(URLError(.timedOut)) == .offline)
        #expect(FamilyWords.message(APIError.timeout, .setPin).contains("Wi-Fi"))
    }

    @Test func aPinThatIsNotFourDigitsSaysSo() {
        #expect(FamilyWords.message(FamilyError.pinFormat, .setPin) == "A PIN is exactly 4 digits.")
    }

    // MARK: who is signed in

    private func family(_ role: FamilyState.Role) -> FamilyState {
        FamilyState(role: role, me: "u1", parentId: role == .kid ? "p1" : "u1",
                    members: [FamilyMember(userId: role == .kid ? "p1" : "u1", displayName: "Grown-up", avatar: nil, grade: nil, isParent: true, stats: nil)],
                    hasPin: role != .solo)
    }

    @Test func aKidAddressIsAKidBeforeTheFamilyLoads() {
        #expect(FamilyState.isKidEmail("kid-0b9c2f1e-6a1d-4c8e-9f57-3d2b8a7c6e51@kids.agathon.app"))
        #expect(FamilyState.isKidEmail(" KID-1@Kids.Agathon.App "))
        #expect(!FamilyState.isKidEmail("mom@agathon.app"))
        #expect(!FamilyState.isKidEmail("someone@notkids.agathon.app.evil"))
        #expect(!FamilyState.isKidEmail(nil))
        #expect(FamilyState.who(nil, email: "kid-1@kids.agathon.app") == .kid)
        // the family says grown-up but the address is a kid's: a kid (the server refuses it anyway)
        #expect(FamilyState.who(family(.parent), email: "kid-1@kids.agathon.app") == .kid)
    }

    @Test func aGrownUpOnlyOnceTheFamilySaysSo() {
        #expect(FamilyState.who(nil, email: "mom@agathon.app") == .unknown)
        #expect(!FamilyState.who(nil, email: "mom@agathon.app").isGrownUp)
        #expect(FamilyState.who(family(.parent), email: "mom@agathon.app").isGrownUp)
        #expect(FamilyState.who(family(.solo), email: "mom@agathon.app").isGrownUp)
        #expect(FamilyState.who(family(.kid), email: "maya@example.com") == .kid)
    }
}
