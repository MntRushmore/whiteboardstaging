import Foundation
import Testing
@testable import AgathonKit

struct SSEParserTests {
    private func parse(_ chunks: [Data]) -> (frames: [SSEFrame], comments: Int) {
        var parser = SSEParser()
        var frames: [SSEFrame] = []
        for chunk in chunks { frames += parser.push(chunk) }
        frames += parser.finish()
        return (frames, parser.commentCount)
    }

    private func parse(_ text: String) -> [SSEFrame] {
        parse([Data(text.utf8)]).frames
    }

    @Test func readsOneFrame() {
        #expect(parse("event: delta\ndata: {\"text\":\"Hi\"}\n\n") == [SSEFrame(event: "delta", data: #"{"text":"Hi"}"#)])
    }

    @Test func readsFramesInOrder() {
        let frames = parse("event: model\ndata: {\"model\":\"a\"}\n\nevent: done\ndata: {\"ms\":1}\n\n")
        #expect(frames.map(\.event) == ["model", "done"])
    }

    @Test func aFrameSplitAnywhereReadsTheSame() {
        let text = "event: delta\ndata: {\"text\":\"one\"}\n\n: ping\n\nevent: done\ndata: {\"model\":\"m\",\"ms\":12}\n\n"
        let bytes = Array(text.utf8)
        let whole = parse([Data(bytes)])
        #expect(whole.frames.count == 2)
        for cut in 1 ..< bytes.count {
            let split = parse([Data(bytes[..<cut]), Data(bytes[cut...])])
            #expect(split.frames == whole.frames, "cut at \(cut)")
            #expect(split.comments == 1)
        }
    }

    @Test func byteByByteReadsTheSame() {
        let text = "event: reply\ndata: {\"text\":\"Done\"}\n\n"
        let frames = parse(Array(text.utf8).map { Data([$0]) }).frames
        #expect(frames == [SSEFrame(event: "reply", data: #"{"text":"Done"}"#)])
    }

    @Test func pingsAreCommentsNotFrames() {
        let result = parse([Data(": ping\n\n: ping\n\n".utf8)])
        #expect(result.frames.isEmpty)
        #expect(result.comments == 2)
    }

    @Test func aPingInsideAFrameDoesNotBreakIt() {
        let frames = parse("event: delta\n: ping\ndata: {\"text\":\"x\"}\n\n")
        #expect(frames == [SSEFrame(event: "delta", data: #"{"text":"x"}"#)])
    }

    @Test func multiLineDataIsJoinedWithNewlines() {
        let frames = parse("event: note\ndata: first\ndata: second\ndata:\ndata: fourth\n\n")
        #expect(frames == [SSEFrame(event: "note", data: "first\nsecond\n\nfourth")])
    }

    @Test func onlyOneSpaceAfterTheColonIsDropped() {
        #expect(parse("data:tight\n\n") == [SSEFrame(event: "message", data: "tight")])
        #expect(parse("data:  two\n\n") == [SSEFrame(event: "message", data: " two")])
    }

    @Test func crlfLineEndings() {
        let frames = parse("event: done\r\ndata: {\"ms\":5}\r\n\r\n")
        #expect(frames == [SSEFrame(event: "done", data: #"{"ms":5}"#)])
    }

    @Test func unicodeSplitInsideACharacterArrivesWhole() {
        let text = "½ × π − 🦊 你好 é"
        let payload = "event: delta\ndata: {\"text\":\"\(text)\"}\n\n"
        let bytes = Array(payload.utf8)
        // Every split point, including the middle of each multi-byte character.
        for cut in 1 ..< bytes.count {
            let frames = parse([Data(bytes[..<cut]), Data(bytes[cut...])]).frames
            #expect(frames.count == 1)
            #expect(AskEvent.decode(frames[0]) == .delta(text), "cut at \(cut)")
        }
    }

    @Test func finishHandsOverALastFrameWithoutItsBlankLine() {
        #expect(parse("event: done\ndata: {\"ms\":1}\n") == [SSEFrame(event: "done", data: #"{"ms":1}"#)])
        #expect(parse("event: done\ndata: {\"ms\":1}") == [SSEFrame(event: "done", data: #"{"ms":1}"#)])
    }

    @Test func idRetryAndUnknownFieldsAreIgnored() {
        let frames = parse("id: 7\nretry: 1000\nfoo: bar\nevent: x\ndata: y\n\n")
        #expect(frames == [SSEFrame(event: "x", data: "y")])
    }

    @Test func eventDefaultsToMessage() {
        #expect(parse("data: hello\n\n") == [SSEFrame(event: "message", data: "hello")])
    }

    @Test func emptyFramesAreNothing() {
        #expect(parse("\n\n\n").isEmpty)
        // A named event with no data still counts (the web keeps it).
        #expect(parse("event: done\n\n") == [SSEFrame(event: "done", data: "")])
    }
}
