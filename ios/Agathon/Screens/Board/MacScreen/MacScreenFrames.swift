import Foundation

/// One piece of a frame from agathon.app/share (src/lib/screenShare/frames.ts): frame number `f`,
/// piece `i` of `n`, the frame's size, and its base64 JPEG slice.
struct MacScreenChunk: Codable, Equatable, Sendable {
    var f: Int
    var i: Int
    var n: Int
    var w: Int
    var h: Int
    var d: String
}

/// Puts a frame's chunks back together. Only the newest frame counts: a chunk of an older frame than
/// the one being gathered (or than the last one shown) is dropped, and so is a frame left part-done
/// when a newer one starts. A finished frame is its JPEG bytes.
struct MacScreenAssembler {
    private(set) var gathering: Int?
    private var parts: [Int: String] = [:]
    private var count = 0
    /// the last frame put back together
    private(set) var lastDone: Int?

    /// Most pieces a frame may have (a 1280 px JPEG is far fewer): a bad count is never waited on.
    static let maxPieces = 32

    mutating func add(_ c: MacScreenChunk) -> Data? {
        guard c.n >= 1, c.n <= Self.maxPieces, c.i >= 0, c.i < c.n else { return nil }
        if let done = lastDone, c.f <= done { return nil }
        if let g = gathering {
            if c.f < g { return nil }
            if c.f > g { start(c) }
        } else {
            start(c)
        }
        guard c.n == count else { return nil }
        parts[c.i] = c.d
        guard parts.count == count else { return nil }
        let joined = (0..<count).compactMap { parts[$0] }.joined()
        let frame = c.f
        gathering = nil
        parts = [:]
        lastDone = frame
        return Data(base64Encoded: joined)
    }

    private mutating func start(_ c: MacScreenChunk) {
        gathering = c.f
        parts = [:]
        count = c.n
    }
}

/// The topic and events shared with the web page (src/lib/screenShare/frames.ts).
enum MacScreenChannel {
    static func topic(userId: String) -> String { "screen:\(userId)" }
    static let frameEvent = "frame"
    static let viewerEvent = "viewer"
    /// how often the iPad says it's watching (the Mac shows "Live on your iPad")
    static let pingSeconds: Double = 4
}
