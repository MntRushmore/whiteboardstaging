import AgathonKit
import Foundation
import Testing
@testable import AgathonStore

// The pure parts of AgathonStore: the offer's words (the price Apple's storefront shows, the trial,
// the auto-renewal disclosure), the parental gate, where the family stands, what deleting means, and
// what the server's answer means for finishing a transaction. The StoreKit glue (PlanStore) runs
// against Agathon.storekit in the app's hosted tests (AgathonTests/StoreKitFlowTests).

struct PlanOfferTests {
    let monthly = PlanPeriod(value: 1, unit: .month)
    let week = PlanPeriod(value: 1, unit: .week)

    @Test func withTheFreeWeek() {
        let offer = PlanOffer(displayPrice: "$24.99", period: monthly, freeTrial: week, eligibleForTrial: true)
        #expect(offer.pricePerPeriod == "$24.99 a month")
        #expect(offer.trialBadge == "7 days free")
        #expect(offer.ctaTitle == "Start your free week")
        #expect(offer.ctaDetail == "7 days free, then $24.99 a month. Cancel any time.")
    }

    @Test func anAppleIDThatHadTheTrialGetsNoTrialWords() {
        let offer = PlanOffer(displayPrice: "$24.99", period: monthly, freeTrial: week, eligibleForTrial: false)
        #expect(offer.trial == nil)
        #expect(offer.trialBadge == nil)
        #expect(offer.ctaTitle == "Subscribe")
        #expect(offer.ctaDetail == "$24.99 a month. Cancel any time.")
        #expect(!offer.disclosure.contains("free"))
    }

    @Test func theStorefrontsPriceIsUsedAsIs() {
        let offer = PlanOffer(displayPrice: "24,99 €", period: monthly, freeTrial: week, eligibleForTrial: true)
        #expect(offer.pricePerPeriod == "24,99 € a month")
        #expect(offer.disclosure.contains("24,99 €"))
    }

    /// App Review 3.1.2 and Schedule 2: title, length, price, auto-renewal, the 24-hour rule, where to cancel.
    @Test func theDisclosureSaysWhatAppleRequires() {
        let text = PlanOffer(displayPrice: "$24.99", period: monthly, freeTrial: week, eligibleForTrial: true).disclosure
        #expect(text.contains("Agathon Unlimited is a monthly subscription."))
        #expect(text.contains("free for 7 days"))
        #expect(text.contains("$24.99 is charged to your Apple Account a month, starting when the free trial ends"))
        #expect(text.contains("renews automatically until you cancel"))
        #expect(text.contains("at least 24 hours before the end"))
        #expect(text.contains("Settings › your name › Subscriptions"))
    }

    @Test func otherTrialsAndPeriods() {
        let threeDays = PlanOffer(displayPrice: "$24.99", period: monthly, freeTrial: PlanPeriod(value: 3, unit: .day), eligibleForTrial: true)
        #expect(threeDays.ctaTitle == "Start your free trial")
        #expect(threeDays.trialBadge == "3 days free")
        let month = PlanOffer(displayPrice: "$24.99", period: monthly, freeTrial: PlanPeriod(value: 1, unit: .month), eligibleForTrial: true)
        #expect(month.trialBadge == "1 month free")
        #expect(PlanPeriod(value: 1, unit: .year).every == "a year")
        #expect(PlanPeriod(value: 3, unit: .month).every == "every 3 months")
        #expect(PlanPeriod(value: 2, unit: .week).length == "14 days")
        #expect(PlanPeriod(value: 0, unit: .day).value == 1)
    }
}

struct ParentalGateTests {
    @Test func numberWords() {
        #expect(NumberWords.english(0) == "zero")
        #expect(NumberWords.english(13) == "thirteen")
        #expect(NumberWords.english(40) == "forty")
        #expect(NumberWords.english(47) == "forty-seven")
        #expect(NumberWords.english(407) == "four hundred seven")
        #expect(NumberWords.english(628) == "six hundred twenty-eight")
        #expect(NumberWords.english(910) == "nine hundred ten")
        #expect(NumberWords.english(999) == "nine hundred ninety-nine")
    }

    @Test func acceptsOnlyTheDigits() {
        let gate = ParentalGateChallenge(answer: 628)
        #expect(gate.words == "six hundred twenty-eight")
        #expect(gate.spokenPrompt == "Type this number: six hundred twenty-eight")
        #expect(gate.accepts("628"))
        #expect(!gate.accepts("62"))
        #expect(!gate.accepts("0628"))
        #expect(!gate.accepts("629"))
        #expect(!gate.accepts("six hundred twenty-eight"))
    }

    @Test func aNewNumberEveryTimeNeverARoundHundred() {
        var rng = SeededRNG(seed: 42)
        var previous: Int?
        for _ in 0 ..< 500 {
            let gate = ParentalGateChallenge.random(excluding: previous, using: &rng)
            #expect((101 ... 999).contains(gate.answer))
            #expect(gate.answer % 100 != 0)
            #expect(gate.answer != previous)
            previous = gate.answer
        }
    }
}

struct PlanStandingTests {
    let ref = UUID()

    @Test func fromTheServersSummary() {
        #expect(PlanStanding(plan: nil) == .none)
        #expect(PlanStanding(plan: UnlimitedPlan(status: "none", unlimited: false)) == .none)
        let trialEnd = Date(timeIntervalSince1970: 1_800_000_000)
        #expect(PlanStanding(plan: UnlimitedPlan(status: "trialing", unlimited: true, trialEnd: trialEnd, currentPeriodEnd: trialEnd, cancelAtPeriodEnd: false, provider: "apple"))
            == .subscribed(provider: "apple", trialEnds: trialEnd, renews: trialEnd, cancelAtPeriodEnd: false))
        #expect(PlanStanding(plan: UnlimitedPlan(status: "active", unlimited: true, provider: "stripe")) == .subscribed(provider: "stripe", trialEnds: nil, renews: nil, cancelAtPeriodEnd: false))
        #expect(PlanStanding(plan: UnlimitedPlan(status: "trialing", unlimited: false, trialEnd: trialEnd, provider: "apple", repeatTrial: true)) == .repeatTrial(provider: "apple", startsOn: trialEnd))
        #expect(PlanStanding(plan: UnlimitedPlan(status: "active", unlimited: false, provider: "apple")) == .paymentProblem(provider: "apple"))
        #expect(PlanStanding(plan: UnlimitedPlan(status: "past_due", unlimited: false, provider: "apple")) == .paymentProblem(provider: "apple"))
        #expect(PlanStanding(plan: UnlimitedPlan(status: "canceled", unlimited: false, provider: "apple")) == .ended)
        #expect(PlanStanding(plan: UnlimitedPlan(status: nil, unlimited: false)) == .pending)
        #expect(PlanStanding.none.offersPurchase && PlanStanding.ended.offersPurchase)
        #expect(!PlanStanding.pending.offersPurchase)
        #expect(PlanStanding.paymentProblem(provider: "apple").isApple)
    }

    @Test func deletingTheAccount() {
        #expect(DeletionAdvice(plan: nil) == .clear)
        #expect(DeletionAdvice(plan: UnlimitedPlan(status: "active", unlimited: true, cancelAtPeriodEnd: false, provider: "apple")) == .cancelAppleFirst)
        #expect(DeletionAdvice(plan: UnlimitedPlan(status: "trialing", unlimited: true, cancelAtPeriodEnd: true, provider: "apple")) == .clear)
        #expect(DeletionAdvice(plan: UnlimitedPlan(status: "trialing", unlimited: true, cancelAtPeriodEnd: false, provider: "stripe")) == .cancelOnWebFirst)
        #expect(DeletionAdvice(plan: UnlimitedPlan(status: "canceled", unlimited: false, provider: "apple")) == .clear)
        #expect(DeletionAdvice.cancelAppleFirst.message?.contains("Settings › your name › Subscriptions") == true)
    }
}

struct RecordOutcomeTests {
    func failure(_ status: Int, _ body: String) -> APIError {
        .http(HTTPFailure(status: status, header: { _ in nil }, body: Data(body.utf8)))
    }

    @Test func whatTheServersAnswerMeansForFinishing() {
        let mismatch = RecordOutcome.from(error: failure(409, #"{"error":"invalid_request","message":"x","reason":"apple_account_mismatch"}"#))
        #expect(mismatch == .refused(reason: "apple_account_mismatch"))
        #expect(mismatch.shouldFinish)
        #expect(RecordOutcome.from(error: failure(400, #"{"error":"invalid_request","reason":"apple_invalid"}"#)) == .rejected(reason: "apple_invalid"))
        for status in [401, 429, 500, 503] {
            #expect(!RecordOutcome.from(error: failure(status, #"{"error":"x","message":"later"}"#)).shouldFinish, "HTTP \(status)")
        }
        #expect(!RecordOutcome.from(error: APIError.notSignedIn).shouldFinish)
        #expect(!RecordOutcome.from(error: APIError.network(.notConnectedToInternet)).shouldFinish)
        #expect(!RecordOutcome.from(error: APIError.timeout).shouldFinish)
        #expect(RecordOutcome.recorded(status: "trialing", unlimited: true, applied: true).shouldFinish)
        #expect(RecordOutcome.ignored(reason: "x").shouldFinish)
    }

    @Test func postsTheTransactionAndReadsTheAnswer() async throws {
        let transport = ScriptedTransport(status: 200, body: #"{"recorded":true,"applied":true,"status":"trialing","unlimited":true}"#)
        let api = APIClient(baseURL: URL(string: "http://localhost:3401")!, transport: transport, token: { "aaa.bbb.ccc" })
        let outcome = await APIStoreServer(api: api).record(transaction: "h.p.s", renewalInfo: nil)
        #expect(outcome == .recorded(status: "trialing", unlimited: true, applied: true))
        let request = try #require(transport.requests.first)
        #expect(request.url?.path == "/api/billing/apple/transaction")
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer aaa.bbb.ccc")
        // the schema is strict: no renewalInfo key at all without one
        let body = try #require(request.httpBody.flatMap { try JSONSerialization.jsonObject(with: $0) as? [String: Any] })
        #expect(body.keys.sorted() == ["transaction"])
    }

    @Test func anIgnoredPayloadAndARefusal() async {
        let ignored = ScriptedTransport(status: 200, body: #"{"recorded":false,"ignored":"another product"}"#)
        let api = APIClient(baseURL: URL(string: "http://localhost")!, transport: ignored, token: { "a.b.c" })
        #expect(await APIStoreServer(api: api).record(transaction: "h.p.s", renewalInfo: "r.e.n") == .ignored(reason: "another product"))
        let refused = ScriptedTransport(status: 409, body: #"{"error":"invalid_request","message":"another account","reason":"apple_account_mismatch"}"#)
        let api2 = APIClient(baseURL: URL(string: "http://localhost")!, transport: refused, token: { "a.b.c" })
        #expect(await APIStoreServer(api: api2).record(transaction: "h.p.s", renewalInfo: nil) == .refused(reason: "apple_account_mismatch"))
    }
}

struct StorePlanTests {
    @Test func matchesTheServerAndTheStoreKitConfiguration() throws {
        #expect(StorePlan.productID == "app.agathon.unlimited.monthly")
        // ios/Agathon/Agathon.storekit, from this file's place in the repo
        let here = URL(fileURLWithPath: #filePath)
        let storekit = here.deletingLastPathComponent().appendingPathComponent("../../../../Agathon/Agathon.storekit").standardized
        let data = try Data(contentsOf: storekit)
        let json = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        let groups = try #require(json["subscriptionGroups"] as? [[String: Any]])
        let group = try #require(groups.first { ($0["name"] as? String) == StorePlan.subscriptionGroup })
        let subs = try #require(group["subscriptions"] as? [[String: Any]])
        let product = try #require(subs.first { ($0["productID"] as? String) == StorePlan.productID })
        #expect(product["recurringSubscriptionPeriod"] as? String == "P1M")
        #expect(product["familyShareable"] as? Bool == false)
        let intro = try #require(product["introductoryOffer"] as? [String: Any])
        #expect(intro["paymentMode"] as? String == "free")
        #expect(intro["subscriptionPeriod"] as? String == "P1W")
    }
}

// MARK: - helpers

/// One scripted answer, recording the requests.
final class ScriptedTransport: HTTPTransport, @unchecked Sendable {
    let status: Int
    let body: String
    private let lock = NSLock()
    private var _requests: [URLRequest] = []
    var requests: [URLRequest] { lock.withLock { _requests } }

    init(status: Int, body: String) {
        self.status = status
        self.body = body
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        lock.withLock { _requests.append(request) }
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        return (Data(body.utf8), response)
    }

    func stream(for request: URLRequest) async throws -> (HTTPURLResponse, AsyncThrowingStream<Data, Error>) {
        throw URLError(.unsupportedURL)
    }
}

/// A repeatable random source for the gate's test.
struct SeededRNG: RandomNumberGenerator {
    var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}
