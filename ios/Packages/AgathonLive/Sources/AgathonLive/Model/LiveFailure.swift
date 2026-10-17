import AgathonKit
import Foundation

/// Why a Live call failed, as the loop acts on it (the web's `classifyLiveFailure`).
public enum LiveFailure: Error, Equatable, Sendable {
    /// no network, or the request never got an answer: the line waits and is read again later
    case offline
    /// 402 `ink_empty`: help is paused; kids see "Ask a grown-up", never prices
    case outOfInk
    /// 429: wait `retryAfterMs`; `fairUse` is Agathon Unlimited's daily cap (hours, not seconds)
    case rateLimited(retryAfterMs: Double, fairUse: Bool)
    /// 401: the session was refused
    case signedOut
    /// the recognizer could not make sense of this ink (Mathpix's own "unreadable"): the line's "?"
    case unreadable
    /// the recognizer had nothing to fall back on: send the line again with a crop (once)
    case needsCrop(recognizerDown: Bool)
    /// a blip worth one more try on its own (a timeout, a 5xx, a cut-off stream)
    case transient
    /// anything else: shown, with Retry
    case other(String)

    public static func from(_ error: Error) -> LiveFailure {
        if let f = error as? LiveFailure { return f }
        if let s = error as? StreamFailure { return .from(stream: s) }
        if error is CancellationError { return .other("cancelled") }
        if let urlError = error as? URLError { return urlError.code == .timedOut ? .transient : .offline }
        guard let api = error as? APIError else { return .other(String(describing: error)) }
        switch api {
        case .network: return .offline
        case .timeout, .incomplete: return .transient
        case .notSignedIn: return .signedOut
        case .invalidResponse(let m): return .other(m)
        case .http(let f):
            if f.isOutOfInk { return .outOfInk }
            if f.isRateLimited { return .rateLimited(retryAfterMs: Double(f.retryAfterMs ?? 30_000), fairUse: f.isFairUse) }
            if f.isUnauthorized { return .signedOut }
            if f.code == "recognizer_failed" {
                let hints = RecognizerHints(f.body)
                if hints.unreadable { return .unreadable }
                if hints.needsCrop { return .needsCrop(recognizerDown: hints.recognizerDown) }
                if hints.transient { return .transient }
                // a 5xx with nothing to say: the crop is still the read that can work
                return .needsCrop(recognizerDown: hints.recognizerDown)
            }
            // a 5xx no route of ours wrote (Cloudflare's page): the hints were lost on the way
            if f.isBareServerError { return .transient }
            if f.status >= 500 { return .transient }
            return .other(f.message)
        }
    }

    /// The read itself never reached the server: the line waits for the network.
    public var isOffline: Bool { self == .offline }
}

/// The recognize route's extra flags on `recognizer_failed` (src/lib/server/recognizeHints.ts), read
/// from the body and its `details`, however the server nested them.
struct RecognizerHints {
    var needsCrop = false
    var recognizerDown = false
    var unreadable = false
    var transient = false

    init(_ body: AgathonKit.JSONValue?) {
        func flag(_ key: String) -> Bool {
            body?[key]?.boolValue == true || body?["details"]?[key]?.boolValue == true
        }
        needsCrop = flag("needsCrop")
        recognizerDown = flag("recognizerDown")
        unreadable = flag("unreadable")
        transient = flag("transient")
    }
}
