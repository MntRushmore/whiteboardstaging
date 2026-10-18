import AgathonBoard
import AgathonBrain
import Foundation
import Testing
@testable import AgathonLive

/// The pure pieces: the policy (against the brain's own), marks, placement, the readback text, the
/// second reader's rules, the crop.
struct LogicTests {
    static func analysis(kind: String, verdict: String, result: String = "", solved: Bool? = nil, math: String = "x") -> LineAnalysis {
        var json = #"{"kind":"\#(kind)","math":"\#(math)","resultLatex":"\#(result)","verdict":"\#(verdict)","note":""}"#
        if let solved { json = json.replacingOccurrences(of: "}", with: #","solved":\#(solved)}"#) }
        return try! JSONDecoder().decode(LineAnalysis.self, from: Data(json.utf8))
    }

    @Test func thePolicyIsTheBrains() async throws {
        let brain = TestBrain.shared
        try await brain.load()
        let analyses: [LineAnalysis?] = [
            nil,
            Self.analysis(kind: "equation", verdict: "ok"),
            Self.analysis(kind: "equation", verdict: "mismatch"),
            Self.analysis(kind: "equation", verdict: "ok", solved: true),
            Self.analysis(kind: "expression", verdict: "none", result: "38", math: "36 + 2"),
            Self.analysis(kind: "equation", verdict: "unknown"),
            Self.analysis(kind: "label", verdict: "none"),
            Self.analysis(kind: "text", verdict: "none"),
        ]
        var n = 0
        for mode in LiveMode.allCases {
            for a in analyses {
                for (settled, auto, asked) in [(false, true, false), (true, true, false), (true, false, false), (false, false, true), (true, true, true)] {
                    for (conf, latex) in [(0.98, "36 + 2 ="), (0.4, "2x = 8"), (0.98, "x")] {
                        for (hints, open, shapes) in [(0, 0, 0), (1, 0, 0), (0, 1, 61)] {
                            let mine = LivePolicy.decide(LivePolicy.Input(mode: mode, analysis: a, confidence: conf, settled: settled, auto: auto, userAsked: asked,
                                                                          hintsShownForLine: hints, openHintCount: open, liveShapeCount: shapes, latex: latex))
                            let theirs = try await brain.policy(PolicyInput(mode: mode, analysis: a, confidence: conf, settled: settled, auto: auto, userAsked: asked,
                                                                           hintsShownForLine: hints, openHintCount: open, liveShapeCount: shapes, latex: latex))
                            #expect(mine.echo == theirs.echo && mine.badge == theirs.badge && mine.showResult == theirs.showResult
                                     && mine.runLlmCheck == theirs.runLlmCheck && mine.allowHint == theirs.allowHint && mine.allowSteps == theirs.allowSteps
                                     && mine.capped == theirs.capped && mine.offerHintPrompt == theirs.offerHintPrompt,
                                     "mode \(mode) \(a?.kind ?? "nil")/\(a?.verdict ?? "") settled \(settled) auto \(auto) asked \(asked) \(latex) \(conf)")
                            n += 1
                        }
                    }
                }
            }
        }
        #expect(n == 4 * 8 * 5 * 3 * 3)
    }

    @Test func markKeysAndSpotsMatchTheWeb() {
        let line = BrainRect(x: 100, y: 200, w: 300, h: 60)
        // marks.ts markKey: kind, then the rect in 4 px units (Math.round: halves up)
        #expect(LiveMarks.key(.check, line) == "check:25,50,75,15")
        #expect(LiveMarks.key(.circle, BrainRect(x: 2, y: 6, w: 10, h: 14)) == "circle:1,2,3,4")
        #expect(LiveMarks.kind(ofKey: "question:1,2,3,4") == .question)
        // a tick sits 18 px after the ink, centred on it, 0.8 of its height (18…44)
        let tick = LiveMarks.markRect(.check, line)
        #expect(tick.x == 418 && tick.h == 44 && abs((tick.y + tick.h / 2) - 230) < 1e-9)
        // a ring is an ellipse through the ink box's corners, padded
        let ring = LiveMarks.ringRect(line)
        #expect(abs(ring.w - (150 * 2.0.squareRoot() + 7) * 2) < 1e-9)
        #expect(ring.x < line.x && ring.maxX > line.maxX && ring.y < line.y && ring.maxY > line.maxY)
        // the strokes are AgathonBoard's TutorMarks with the web's seed
        let strokes = LiveMarks.strokes(.check, line: line, lineId: "ln_1")
        #expect(strokes.count == 1 && strokes[0].points.count == 6)
        #expect(LiveSeeds.handSeed("ln_1:check:25,50,75,15") == LiveSeeds.handSeed("ln_1:check:25,50,75,15"))
        // handSeedFor (FNV-1a): "a" → 0xE40C292C
        #expect(LiveSeeds.handSeed("a") == 0xE40C_292C)
    }

    @Test func placementSlidesPastWhatIsInTheWay() {
        let line = BrainRect(x: 100, y: 100, w: 200, h: 50)
        let candidate = BrainRect(x: 340, y: 100, w: 120, h: 50)
        // free: where it was asked
        #expect(LivePlacement.findFreeSlot(candidate, avoid: [], line: line) == candidate)
        // blocked: slides right in 40 px steps
        let block = BrainRect(x: 330, y: 90, w: 60, h: 70)
        let slid = LivePlacement.findFreeSlot(candidate, avoid: [block], line: line)
        #expect(slid.y == candidate.y && slid.x > block.maxX)
        // a block under the work that would run off the bottom moves beside it
        let screen = BrainRect(x: 0, y: 0, w: 1600, h: 900)
        let low = BrainRect(x: 100, y: 820, w: 200, h: 200)
        let moved = LivePlacement.keepOnScreen(low, screen: screen, column: BrainRect(x: 100, y: 500, w: 300, h: 300))
        #expect(moved.x == 448 && moved.y == 500)
        // kept inside the screen on the right
        #expect(LivePlacement.keepInsideX(BrainRect(x: 1550, y: 0, w: 100, h: 10), bounds: screen).maxX == 1584)
        // the hand is bigger on a board shown below zoom 1
        #expect(LivePlacement.inkScale(0.5) == 2 && LivePlacement.inkScale(1.5) == 1 && LivePlacement.inkScale(nil) == 1)
    }

    @Test func readbacksReadAsAKidWouldWriteThem() {
        #expect(MathText.plain("2x + 3 = 11") == "2x + 3 = 11")
        #expect(MathText.plain("\\frac{3}{4} + \\frac{1}{8} = \\frac{7}{8}") == "3/4 + 1/8 = 7/8")
        #expect(MathText.plain("x^{2} - 5x + 6 = 0") == "x² - 5x + 6 = 0")
        #expect(MathText.plain("3 \\cdot 4 \\le 2\\pi") == "3 · 4 ≤ 2π")
        #expect(MathText.plain("\\sqrt{16} = 4") == "√16 = 4")
        #expect(MathText.plain("\\text{Look again at } x = 5") == "Look again at x = 5")
        #expect(MathText.plain("x_{1} = 2") == "x₁ = 2")
        // Mathpix's spacing, as a kid writes it
        #expect(MathText.plain("2 x+3=11") == "2x + 3 = 11")
        #expect(MathText.plain("x=-4") == "x = -4")
        #expect(MathText.plain("3x-5=10") == "3x - 5 = 10")
        #expect(MathText.plain("Check the division on the right side of line 3.") == "Check the division on the right side of line 3.")
    }

    @Test func theSecondReaderIsAskedOnASignalOnly() {
        let ok = Self.analysis(kind: "equation", verdict: "ok")
        let unknown = Self.analysis(kind: "unknown", verdict: "unknown")
        #expect(ReadCheck.trigger(latex: "2x = 8", confidence: 0.97, analysis: ok, strokeCount: 7, others: ["2x + 3 = 11"]) == nil)
        #expect(ReadCheck.trigger(latex: "2x = 8", confidence: 0.4, analysis: ok, strokeCount: 7, others: []) == "low-confidence")
        #expect(ReadCheck.trigger(latex: "2x \\# 8", confidence: 0.9, analysis: unknown, strokeCount: 6, others: []) == "unreadable")
        #expect(ReadCheck.trigger(latex: "\\sigma = 5", confidence: 0.99, analysis: ok, strokeCount: 4, others: ["x + 2 = 7"]) == "odd-symbol")
        #expect(ReadCheck.trigger(latex: "0 = 5", confidence: 0.99, analysis: ok, strokeCount: 4, others: []) == "false-number")
        #expect(ReadCheck.trigger(latex: "x", confidence: 0.2, analysis: nil, strokeCount: 1, others: []) == nil, "a mark, not a line")
        // and its answer is believed only when it is a transcription
        #expect(ReadCheck.candidate(mathpix: "\\sigma = 5", reread: "a = 5", others: []) == "a = 5")
        #expect(ReadCheck.candidate(mathpix: "x = 5", reread: "x = 5", others: []) == nil, "the same read")
        #expect(ReadCheck.candidate(mathpix: "x = 5", reread: "The answer is x = 5 because", others: []) == nil, "words")
        #expect(ReadCheck.candidate(mathpix: "x = 5", reread: "x = 5 + 3 + 2 + 7 + 1 - 2", others: []) == nil, "not the same line")
    }

    @Test func stepsAreUnboxedAndKeyed() {
        #expect(SolveSteps.unwrapBoxed("\\boxed{x = 4}") == "x = 4")
        #expect(SolveSteps.unwrapBoxed("x = \\boxed{\\frac{1}{2}}") == "x = \\frac{1}{2}")
        #expect(SolveSteps.key("2 \\cdot x = 8") == SolveSteps.key("2x=8"))
        #expect(SolveSteps.isBareAnswer("= 38") && SolveSteps.isBareAnswer("4x") && !SolveSteps.isBareAnswer("x + 1"))
        #expect(SolveSteps.block(["n + d = 25"], ["n + d = 25", "n = 10"]) == ["n + d = 25", "n = 10"])
    }

    @Test @MainActor func aCropIsAJPEGOfTheLinesInk() throws {
        let strokes = KidHands.strokes("2x = 8", at: Vec2(100, 100)).map { pts -> StrokeRecord in
            StrokeRecord(screen: "screen:a", order: "a1", author: .kid, color: .red, width: 6, pressure: .simulated, x: pts[0].x, y: pts[0].y,
                         points: pts.map { InkPoint(x: $0.x - pts[0].x, y: $0.y - pts[0].y) })
        }
        let bounds = try #require(BrainRect.around(strokes.map(StrokeBounds.of)))
        let url = try #require(InkCrop.dataURL(strokes: strokes, bounds: bounds))
        #expect(url.hasPrefix("data:image/jpeg;base64,"))
        let data = try #require(Data(base64Encoded: String(url.dropFirst("data:image/jpeg;base64,".count))))
        #expect(data.count < LiveLimits.maxCropBytes)
        #expect(data.starts(with: [0xFF, 0xD8]), "a JPEG")
    }

    @Test func settingsAreRememberedPerBoard() {
        let defaults = UserDefaults(suiteName: "live-tests-\(UUID().uuidString)")!
        #expect(LiveSettings.load(boardId: "b1", defaults: defaults) == .default)
        #expect(LiveSettings.default.mode == .feedback && LiveSettings.default.auto)
        var s = LiveSettings.default
        s.mode = .answer
        s.auto = false
        s.save(boardId: "b1", defaults: defaults)
        #expect(LiveSettings.load(boardId: "b1", defaults: defaults) == s)
        #expect(LiveSettings.load(boardId: "b2", defaults: defaults) == .default)
    }

    @Test func failuresAreClassifiedAsTheWebDoes() {
        func http(_ status: Int, _ body: String) -> Error {
            AgathonKit_http(status, body)
        }
        #expect(LiveFailure.from(http(402, #"{"error":"ink_empty","message":"x"}"#)) == .outOfInk)
        #expect(LiveFailure.from(http(429, #"{"error":"rate_limited","message":"x","retryAfterMs":1200}"#)) == .rateLimited(retryAfterMs: 1200, fairUse: false))
        #expect(LiveFailure.from(http(429, #"{"error":"rate_limited","reason":"fair_use","message":"x","retryAfterMs":9}"#)) == .rateLimited(retryAfterMs: 9, fairUse: true))
        #expect(LiveFailure.from(http(401, #"{"error":"unauthorized","message":"x"}"#)) == .signedOut)
        #expect(LiveFailure.from(http(503, #"{"error":"recognizer_failed","message":"x","details":{"needsCrop":true,"recognizerDown":true}}"#)) == .needsCrop(recognizerDown: true))
        #expect(LiveFailure.from(http(503, #"{"error":"recognizer_failed","message":"x","unreadable":true}"#)) == .unreadable)
        #expect(LiveFailure.from(http(502, "<html>Bad gateway</html>")) == .transient)
        #expect(LiveFailure.from(StreamFailure(code: "ink_empty", message: "x")) == .outOfInk)
    }
}

import AgathonKit

func AgathonKit_http(_ status: Int, _ body: String) -> Error {
    APIError.http(HTTPFailure(status: status, header: { _ in nil }, body: Data(body.utf8)))
}

extension StreamFailure {
    init(code: String, message: String) {
        self.init(StreamError(code: code, message: message))
    }
}
