#if DEBUG
import AgathonBoard
import AgathonDesign
import AgathonKit
import CoreGraphics
import CoreText
import Foundation

/// A stand-in for `/api/board/draw` with no network and no paid calls (Debug only): the whole flow
/// runs in Board Lab, the Picture Tutor Lab and the UI tests. Its timing is the real route's (reading
/// at once, drawing at ~3 s, the picture at ~6 s). Its picture is written for the picture it was sent:
/// in the clearest space of it, in the tutor's hand (Kalam, cobalt) — a tick and "Nice work!" for
/// Feedback, a next step and an arrow for Suggest, the working for Solve — with `strokes` that trace
/// that ink in writing order, as the server's do.
///
/// `pictureTutor.stubOutcome` (UserDefaults or `-pictureTutor.stubOutcome none`): `done` (default),
/// `none`, `error`. `pictureTutor.stubDelay`: seconds to the picture (default 6; drawing at half).
final class PictureTutorStub: HTTPTransport, @unchecked Sendable {
    static let baseURL = URL(string: "https://stub.picture-tutor.invalid")!

    /// A client on the stub.
    static func client() -> BoardDrawClient {
        BoardDrawClient(api: APIClient(baseURL: baseURL, transport: PictureTutorStub(), token: { "stub" }))
    }

    var outcome: String { UserDefaults.standard.string(forKey: "pictureTutor.stubOutcome") ?? "done" }
    var delay: Double {
        let d = UserDefaults.standard.double(forKey: "pictureTutor.stubDelay")
        return d > 0 ? d : 6
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        // the outcome report
        (Data(), HTTPURLResponse(url: request.url ?? Self.baseURL, statusCode: 204, httpVersion: "HTTP/1.1", headerFields: [:])!)
    }

    func stream(for request: URLRequest) async throws -> (HTTPURLResponse, AsyncThrowingStream<Data, Error>) {
        let response = HTTPURLResponse(url: request.url ?? Self.baseURL, statusCode: 200, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "application/x-ndjson"])!
        let body = request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        let mode = (body["mode"] as? String).flatMap(BoardDrawMode.init(rawValue:)) ?? .suggest
        let image = (body["image"] as? String).flatMap(BoardDrawDecoding.dataURLBytes).flatMap(PictureTutorCapture.decode)
        let outcome = self.outcome, delay = self.delay
        let runId = "stub-" + UUID().uuidString.prefix(8).lowercased()
        let stream = AsyncThrowingStream<Data, Error> { continuation in
            let task = Task {
                do {
                    continuation.yield(Self.line(["type": "status", "stage": "reading", "runId": runId]))
                    try await Task.sleep(for: .milliseconds(Int(delay * 500)))
                    if outcome == "none" {
                        continuation.yield(Self.line(["type": "none", "reason": "The work looks right; nothing to add."]))
                        continuation.finish()
                        return
                    }
                    continuation.yield(Self.line(["type": "status", "stage": "drawing", "instructions": StubDrawing.instructions(mode)]))
                    try await Task.sleep(for: .milliseconds(Int(delay * 500)))
                    if outcome == "error" {
                        continuation.yield(Self.line(["type": "error", "message": "The stub was told to fail.", "retryable": true]))
                        continuation.finish()
                        return
                    }
                    guard let image, let drawn = StubDrawing.make(mode: mode, for: image) else {
                        continuation.yield(Self.line(["type": "error", "message": "The stub couldn't read the picture.", "retryable": false]))
                        continuation.finish()
                        return
                    }
                    let data = "data:image/png;base64,\(drawn.png.base64EncodedString())"
                    continuation.yield(Self.line([
                        "type": "done", "overlay": data, "picture": data, "width": image.width, "height": image.height,
                        "instructions": StubDrawing.instructions(mode),
                        "strokes": drawn.strokes.map { ["points": $0.points.map { ($0 * 10).rounded() / 10 }, "width": $0.width] },
                        "timings": ["tutorMs": delay * 400, "paintMs": delay * 550, "diffMs": 35, "traceMs": 20, "totalMs": delay * 1000],
                        "costUsd": 0,
                    ]))
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
        return (response, stream)
    }

    static func line(_ object: [String: Any]) -> Data {
        var data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data()
        data.append(0x0A)
        return data
    }
}

/// The stub's picture: words in the tutor's hand and a few marks, rendered on a transparent picture the
/// size of the capture, with the strokes that trace them.
enum StubDrawing {
    static func instructions(_ mode: BoardDrawMode) -> String {
        switch mode {
        case .feedback: return "Tick the last line; write Nice work! beside it."
        case .suggest: return "Write the next step's hint beside the work, with an arrow to the last line."
        case .answer: return "Write the rest of the working beside it."
        }
    }

    private static func lines(_ mode: BoardDrawMode) -> [String] {
        switch mode {
        case .feedback: return ["Nice work!"]
        case .suggest: return ["Next: take 3", "from both sides"]
        case .answer: return ["2x = 8", "x = 4"]
        }
    }

    static func make(mode: BoardDrawMode, for capture: CGImage) -> (png: Data, strokes: [BoardDrawStroke])? {
        _ = DSFonts.register()
        let w = capture.width, h = capture.height
        let areas = BlankArea.find(in: capture)
        let blank = areas.blank ?? CGRect(x: Double(w) * 0.55, y: Double(h) * 0.15, width: Double(w) * 0.4, height: Double(h) * 0.5)
        let ink = areas.ink
        let words = lines(mode)
        // the tutor's hand at about the kid's size, fitted to the space
        var size = min(Double(h) * 0.07, blank.height / (Double(words.count) * 1.5 + 0.4))
        let font0 = CTFontCreateWithName(DSFonts.tutorHandPostScriptName as CFString, 100, nil)
        let widest = words.map { width(of: $0, font: font0) / 100 }.max() ?? 1
        size = max(18, min(size, (blank.width - 40) / max(1, widest)))
        let font = CTFontCreateWithName(DSFonts.tutorHandPostScriptName as CFString, size, nil)
        let pen = max(2.5, size * 0.07)
        let left = blank.minX + min(40, blank.width * 0.08)
        let top = blank.minY + min(36, blank.height * 0.12)

        var fills: [CGPath] = []
        var marks: [[CGPoint]] = []
        var strokes: [BoardDrawStroke] = []
        func mark(_ pts: [CGPoint]) {
            marks.append(pts)
            strokes.append(BoardDrawStroke(points: pts.flatMap { [Double($0.x), Double($0.y)] }, width: pen))
        }

        // a tick at the end of the kid's work comes first (Feedback)
        if mode == .feedback, let ink {
            let a = CGPoint(x: ink.maxX + size * 0.35, y: ink.maxY - size * 0.55)
            mark(wobbly([a, CGPoint(x: a.x + size * 0.25, y: a.y + size * 0.3), CGPoint(x: a.x + size * 0.75, y: a.y - size * 0.45)]))
        }
        var lastLineEnd = CGPoint(x: left, y: top)
        for (i, text) in words.enumerated() {
            let baseline = top + size * (1.0 + 1.35 * Double(i))
            let (paths, traced) = glyphs(text, font: font, at: CGPoint(x: left, y: baseline))
            fills += paths
            for t in traced { strokes.append(BoardDrawStroke(points: t.flatMap { [Double($0.x), Double($0.y)] }, width: max(2, size * 0.06))) }
            lastLineEnd = CGPoint(x: left + width(of: text, font: font), y: baseline)
        }
        switch mode {
        case .suggest:
            // an arrow from the hint to the kid's last line
            if let ink {
                let from = CGPoint(x: left - size * 0.3, y: top + size * 0.6)
                let to = CGPoint(x: min(ink.maxX + size * 0.4, from.x - size * 0.8), y: ink.maxY - size * 0.3)
                mark(wobbly([from, CGPoint(x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 + size * 0.25), to]))
                let ang = atan2(to.y - from.y, to.x - from.x)
                let head = size * 0.35
                mark([CGPoint(x: to.x - head * cos(ang - 0.5), y: to.y - head * sin(ang - 0.5)), to,
                      CGPoint(x: to.x - head * cos(ang + 0.5), y: to.y - head * sin(ang + 0.5))])
            }
        case .answer:
            // the answer underlined twice
            let y = lastLineEnd.y + size * 0.25
            mark(wobbly([CGPoint(x: left - size * 0.1, y: y), CGPoint(x: lastLineEnd.x + size * 0.1, y: y + size * 0.03)]))
            mark(wobbly([CGPoint(x: left - size * 0.05, y: y + size * 0.18), CGPoint(x: lastLineEnd.x + size * 0.15, y: y + size * 0.2)]))
        case .feedback:
            break
        }

        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.clear(CGRect(x: 0, y: 0, width: w, height: h))
        // y down, as the strokes are
        ctx.translateBy(x: 0, y: CGFloat(h))
        ctx.scaleBy(x: 1, y: -1)
        let cobalt = CGColor(red: 0x2D / 255.0, green: 0x5B / 255.0, blue: 1, alpha: 1)
        ctx.setFillColor(cobalt)
        for p in fills {
            ctx.addPath(p)
            ctx.fillPath()
        }
        ctx.setStrokeColor(cobalt)
        ctx.setLineWidth(pen)
        ctx.setLineCap(.round)
        ctx.setLineJoin(.round)
        for m in marks {
            ctx.addLines(between: m)
            ctx.strokePath()
        }
        guard let image = ctx.makeImage(), let png = PictureTutorCapture.png(image) else { return nil }
        return (png, strokes)
    }

    private static func width(of text: String, font: CTFont) -> Double {
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: [.init(kCTFontAttributeName as String): font]))
        return CTLineGetTypographicBounds(line, nil, nil, nil)
    }

    /// The text's glyphs as filled outlines (y down, baseline at `origin`), and their outlines traced
    /// as strokes: wide enough, at 2.5×, to uncover the letters as the reveal follows them.
    private static func glyphs(_ text: String, font: CTFont, at origin: CGPoint) -> ([CGPath], [[CGPoint]]) {
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: [.init(kCTFontAttributeName as String): font]))
        var fills: [CGPath] = []
        var traced: [[CGPoint]] = []
        for run in (CTLineGetGlyphRuns(line) as? [CTRun]) ?? [] {
            let n = CTRunGetGlyphCount(run)
            var glyphs = [CGGlyph](repeating: 0, count: n)
            var positions = [CGPoint](repeating: .zero, count: n)
            CTRunGetGlyphs(run, CFRange(location: 0, length: n), &glyphs)
            CTRunGetPositions(run, CFRange(location: 0, length: n), &positions)
            for (g, p) in zip(glyphs, positions) {
                var t = CGAffineTransform(translationX: origin.x + p.x, y: origin.y).scaledBy(x: 1, y: -1)
                guard let path = CTFontCreatePathForGlyph(font, g, &t) else { continue }
                fills.append(path)
                traced += flatten(path)
            }
        }
        return (fills, traced)
    }

    /// A path's subpaths as polylines (curves sampled).
    static func flatten(_ path: CGPath) -> [[CGPoint]] {
        var out: [[CGPoint]] = []
        var cur: [CGPoint] = []
        var start = CGPoint.zero
        path.applyWithBlock { el in
            let e = el.pointee
            switch e.type {
            case .moveToPoint:
                if cur.count > 1 { out.append(cur) }
                start = e.points[0]
                cur = [start]
            case .addLineToPoint:
                cur.append(e.points[0])
            case .addQuadCurveToPoint:
                let p0 = cur.last ?? start, c = e.points[0], p1 = e.points[1]
                for k in 1...5 {
                    let t = CGFloat(k) / 5, u = 1 - t
                    cur.append(CGPoint(x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y))
                }
            case .addCurveToPoint:
                let p0 = cur.last ?? start, c1 = e.points[0], c2 = e.points[1], p1 = e.points[2]
                for k in 1...6 {
                    let t = CGFloat(k) / 6, u = 1 - t
                    cur.append(CGPoint(x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
                                       y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y))
                }
            case .closeSubpath:
                cur.append(start)
                if cur.count > 1 { out.append(cur) }
                cur = []
            @unknown default:
                break
            }
        }
        if cur.count > 1 { out.append(cur) }
        return out
    }

    /// A line through `pts`, sampled, with a hand's small wobble (and a soft bend for an arrow).
    private static func wobbly(_ pts: [CGPoint]) -> [CGPoint] {
        var out: [CGPoint] = []
        for (a, b) in zip(pts, pts.dropFirst()) {
            let n = 8
            for k in 0..<n {
                let t = CGFloat(k) / CGFloat(n)
                let wob = sin(t * 7 + a.x * 0.01) * 1.2
                out.append(CGPoint(x: a.x + (b.x - a.x) * t + wob, y: a.y + (b.y - a.y) * t - wob))
            }
        }
        if let last = pts.last { out.append(last) }
        return out
    }
}
#endif
