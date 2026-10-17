import Foundation
import Testing
@testable import AgathonKit

struct APIErrorTests {
    private func failure(_ status: Int, _ body: String, headers: [String: String] = [:], now: Date = Date()) -> HTTPFailure {
        let lowered = Dictionary(uniqueKeysWithValues: headers.map { ($0.key.lowercased(), $0.value) })
        return HTTPFailure(status: status, header: { lowered[$0.lowercased()] }, body: Data(body.utf8), now: now)
    }

    @Test func routeContractErrorAndMessage() {
        let f = failure(400, #"{"error":"invalid_request","message":"The profile id must be a uuid."}"#)
        #expect(f.code == "invalid_request")
        #expect(f.message == "The profile id must be a uuid.")
        #expect(!f.isUnauthorized && !f.isRateLimited && !f.isOutOfInk && !f.isBareServerError)
    }

    @Test func unauthorized() {
        let f = failure(401, #"{"error":"unauthorized","message":"You need to be signed in to use this feature."}"#,
                        headers: ["WWW-Authenticate": "Bearer"])
        #expect(f.isUnauthorized)
        #expect(APIError.http(f).isUnauthorized)
        #expect(APIError.notSignedIn.isUnauthorized)
    }

    @Test func rateLimitedPrefersTheBodysMilliseconds() {
        let f = failure(429, #"{"error":"rate_limited","message":"You're doing that too fast. Try again in 5 seconds.","retryAfterMs":4200}"#,
                        headers: ["Retry-After": "5"])
        #expect(f.isRateLimited)
        #expect(!f.isFairUse)
        #expect(f.retryAfterMs == 4200)
    }

    @Test func retryAfterHeaderInSeconds() {
        let f = failure(429, #"{"error":"rate_limited","message":"Slow down"}"#, headers: ["retry-after": "12"])
        #expect(f.retryAfterMs == 12000)
    }

    @Test func retryAfterHeaderAsADate() {
        let now = Date(timeIntervalSince1970: 1_791_000_000)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "GMT")
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
        let header = formatter.string(from: now.addingTimeInterval(90))
        let f = failure(503, #"{"error":"feature_unavailable","message":"Later"}"#, headers: ["Retry-After": header], now: now)
        #expect(f.retryAfterMs == 90000)
    }

    @Test func fairUseIsARateLimitNotOutOfInk() {
        let f = failure(429, #"{"error":"rate_limited","message":"You've reached the daily fair-use limit of Agathon Unlimited. The tutor is back in about 3 hours.","retryAfterMs":10800000,"reason":"fair_use"}"#,
                        headers: ["Retry-After": "10800"])
        #expect(f.isFairUse)
        #expect(f.isRateLimited)
        #expect(!f.isOutOfInk)
        #expect(f.retryAfterMs == 10_800_000)
        #expect(APIError.http(f).isFairUse)
    }

    @Test func inkEmptyCarriesRemainingAndCost() {
        let f = failure(402, #"{"error":"ink_empty","message":"You're out of ink.","remaining":0,"cost":3,"buyUrl":"/welcome/plan"}"#)
        #expect(f.isOutOfInk)
        #expect(f.remaining == 0)
        #expect(f.cost == 3)
        #expect(APIError.http(f).isOutOfInk)
    }

    @Test func askShapeCodeMessageStatus() {
        let f = failure(504, #"{"code":"timeout","message":"The tutor took too long to answer. Please try again.","status":504}"#)
        #expect(f.code == "timeout")
        #expect(f.message == "The tutor took too long to answer. Please try again.")
        #expect(f.body?["status"]?.intValue == 504)
    }

    @Test func requestIdFromTheHeaderOrTheBody() {
        #expect(failure(500, #"{"error":"internal_error"}"#, headers: ["X-Request-Id": "8f14e45f-ceea-467a"]).requestId == "8f14e45f-ceea-467a")
        // A header that is not an id is not kept.
        #expect(failure(500, #"{"error":"internal_error"}"#, headers: ["X-Request-Id": "not an id!"]).requestId == nil)
        // The family routes put it in the body too.
        #expect(failure(502, #"{"error":"upstream_error","message":"x","requestId":"abc_123"}"#).requestId == "abc_123")
    }

    @Test func vercelErrorOnlyWhenItLooksLikeOne() {
        #expect(failure(504, "", headers: ["x-vercel-error": "FUNCTION_INVOCATION_TIMEOUT"]).vercelError == "FUNCTION_INVOCATION_TIMEOUT")
        #expect(failure(504, "", headers: ["x-vercel-error": "<script>"]).vercelError == nil)
    }

    @Test func aPageThatIsNotOursIsABareServerError() {
        let f = failure(502, "<html><body>Bad gateway</body></html>")
        #expect(f.code == nil)
        #expect(f.message == "Request failed (502)")
        #expect(f.isBareServerError)
        #expect(f.body == nil)
    }

    @Test func wrongPinCarriesTriesLeftAndLock() {
        let f = failure(403, #"{"error":"invalid_request","message":"That PIN isn't right.","requestId":"r1","reason":"wrong_pin","triesLeft":3}"#)
        #expect(f.reason == "wrong_pin")
        #expect(f.triesLeft == 3)
        #expect(!f.locked)
        let last = failure(403, #"{"error":"invalid_request","message":"x","reason":"wrong_pin","triesLeft":0,"locked":true}"#)
        #expect(last.locked)
    }

    @Test func urlErrorsBecomeAPIErrors() {
        #expect(APIError.wrap(URLError(.timedOut)) as? APIError == .timeout)
        #expect(APIError.wrap(URLError(.notConnectedToInternet)) as? APIError == .network(.notConnectedToInternet))
        #expect(APIError.wrap(URLError(.cancelled)) is CancellationError)
    }

    @Test func retryable() {
        #expect(APIError.timeout.isRetryable)
        #expect(APIError.incomplete.isRetryable)
        #expect(APIError.network(.networkConnectionLost).isRetryable)
        #expect(APIError.http(HTTPFailure(status: 502, code: nil, message: "")).isRetryable)
        #expect(!APIError.http(HTTPFailure(status: 400, code: "invalid_request", message: "")).isRetryable)
        #expect(!APIError.notSignedIn.isRetryable)
    }
}
