import Foundation

/// One Server-Sent Events frame: `event: <name>` and its `data:` lines joined with "\n".
public struct SSEFrame: Sendable, Equatable {
    public var event: String
    public var data: String

    public init(event: String, data: String) {
        self.event = event
        self.data = data
    }
}

/// Incremental SSE parser, the same rules as the web's `SseFrameParser` (src/lib/live/sseClient.ts):
///
/// - lines end in `\n` or `\r\n`; a blank line ends a frame
/// - `: ping` (any line starting with `:`) is a comment: counted, never a frame
/// - `event:` names the frame (default `message`), `data:` lines are joined with `\n`, one space
///   after the colon is dropped, `id:` and `retry:` are ignored
/// - a frame with no data and no name is nothing; at the end of the stream, `finish()` hands over a
///   last frame that had no blank line after it
///
/// Fed raw bytes: a line is decoded as UTF-8 only once it is whole, so a character split across two
/// chunks arrives intact (a newline byte never occurs inside a multi-byte character).
public struct SSEParser: Sendable {
    private var line: [UInt8] = []
    private var event = ""
    private var data: [String] = []
    /// Comment lines seen (the server's `: ping` keep-alives).
    public private(set) var commentCount = 0

    public init() {}

    /// Feeds a chunk; returns the frames it completed.
    public mutating func push(_ chunk: Data) -> [SSEFrame] {
        var frames: [SSEFrame] = []
        for byte in chunk {
            if byte == 0x0A {
                if line.last == 0x0D { line.removeLast() }
                if let frame = consume(String(decoding: line, as: UTF8.self)) { frames.append(frame) }
                line.removeAll(keepingCapacity: true)
            } else {
                line.append(byte)
            }
        }
        return frames
    }

    public mutating func push(_ text: String) -> [SSEFrame] {
        push(Data(text.utf8))
    }

    /// The end of the stream: a trailing line without its newline, and a frame without its blank line.
    public mutating func finish() -> [SSEFrame] {
        var frames: [SSEFrame] = []
        if !line.isEmpty {
            if line.last == 0x0D { line.removeLast() }
            if let frame = consume(String(decoding: line, as: UTF8.self)) { frames.append(frame) }
            line.removeAll()
        }
        if let frame = dispatch() { frames.append(frame) }
        return frames
    }

    private mutating func consume(_ line: String) -> SSEFrame? {
        if line.isEmpty { return dispatch() }
        if line.hasPrefix(":") {
            commentCount += 1
            return nil
        }
        let field: Substring
        var value: Substring
        if let colon = line.firstIndex(of: ":") {
            field = line[..<colon]
            value = line[line.index(after: colon)...]
            if value.hasPrefix(" ") { value = value.dropFirst() }
        } else {
            field = line[...]
            value = ""
        }
        switch field {
        case "event": event = String(value)
        case "data": data.append(String(value))
        default: break // id, retry, anything else
        }
        return nil
    }

    private mutating func dispatch() -> SSEFrame? {
        defer {
            event = ""
            data = []
        }
        if data.isEmpty && event.isEmpty { return nil }
        let frame = SSEFrame(event: event.isEmpty ? "message" : event, data: data.joined(separator: "\n"))
        return frame.data.isEmpty && frame.event == "message" ? nil : frame
    }
}
