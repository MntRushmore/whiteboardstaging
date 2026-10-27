import Foundation
import Testing
@testable import Agathon

/// The Mac screen panel's frames (agathon.app/share → the board, 2026-10-27): chunks put back
/// together, newest frame only.
struct MacScreenFramesTests {
    func chunks(_ frame: Int, _ data: Data, size: Int) -> [MacScreenChunk] {
        let b64 = data.base64EncodedString()
        let n = max(1, Int((Double(b64.count) / Double(size)).rounded(.up)))
        return (0..<n).map { i in
            let a = b64.index(b64.startIndex, offsetBy: i * size)
            let b = b64.index(a, offsetBy: min(size, b64.count - i * size))
            return MacScreenChunk(f: frame, i: i, n: n, w: 10, h: 10, d: String(b64[a..<b]))
        }
    }

    @Test func aFrameComesBackWholeInAnyOrder() {
        let data = Data((0..<500).map { UInt8($0 % 251) })
        var a = MacScreenAssembler()
        let parts = chunks(1, data, size: 100)
        #expect(parts.count > 3)
        var out: Data?
        for c in parts.reversed() { out = a.add(c) ?? out }
        #expect(out == data)
    }

    @Test func aNewerFrameDropsAPartDoneOneAndOlderChunksAreIgnored() {
        let old = Data(repeating: 1, count: 300), new = Data(repeating: 2, count: 300)
        var a = MacScreenAssembler()
        let o = chunks(1, old, size: 100), n = chunks(2, new, size: 100)
        #expect(a.add(o[0]) == nil)
        // frame 2 starts: frame 1's half is gone
        var got: Data?
        for c in n { got = a.add(c) ?? got }
        #expect(got == new)
        // the rest of frame 1 arriving late shows nothing
        for c in o.dropFirst() { #expect(a.add(c) == nil) }
        #expect(a.lastDone == 2)
    }

    @Test func aMissingChunkMeansNoFrameAndBadChunksAreRefused() {
        var a = MacScreenAssembler()
        let parts = chunks(1, Data(repeating: 7, count: 300), size: 100)
        for c in parts.dropLast() { #expect(a.add(c) == nil) }
        #expect(a.add(MacScreenChunk(f: 3, i: 5, n: 2, w: 1, h: 1, d: "AA==")) == nil)
        #expect(a.add(MacScreenChunk(f: 3, i: 0, n: 0, w: 1, h: 1, d: "AA==")) == nil)
        #expect(a.add(MacScreenChunk(f: 4, i: 0, n: 1, w: 1, h: 1, d: "AA==")) == Data([0]))
    }
}
