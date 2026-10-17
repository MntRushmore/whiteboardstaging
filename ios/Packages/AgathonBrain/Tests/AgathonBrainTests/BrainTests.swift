import CryptoKit
import Foundation
import Testing
@testable import AgathonBrain

/// The Swift side of the boundary: loading, errors, the polyfills, and the typed wrappers.
@Suite(.serialized)
struct BrainTests {
    let brain = Golden.brain

    // MARK: - loading and errors

    @Test func loadsTheBundledScriptOnce() async throws {
        let report = try await brain.load()
        #expect(report.api == Brain.apiVersion)
        #expect(report.mathjs.hasPrefix("15."))
        #expect(report.bytes > 1_000_000)
        let again = try await brain.load()
        #expect(again == report)
    }

    @Test func callsBeforeLoadingFail() async {
        let fresh = Brain()
        await #expect(throws: BrainError.notLoaded) { _ = try await fresh.callJSON("version") }
    }

    @Test func aMissingScriptIsAnError() async {
        let fresh = Brain(scriptURL: URL(fileURLWithPath: "/nonexistent/brain.js"))
        await #expect { try await fresh.load() } throws: { error in
            if case BrainError.loadFailed = error { return true }
            return false
        }
    }

    @Test func refusalsBecomeSwiftErrors() async throws {
        try await brain.load()
        await #expect(throws: BrainError.brain(code: "unknown_method", message: #"no brain method "nope""#)) { _ = try await brain.callJSON("nope") }
        await #expect { _ = try await brain.callJSON("analyzeLine", args: #"{"latex":4}"#) } throws: { error in
            if case BrainError.brain(code: "bad_args", _) = error { return true }
            return false
        }
    }

    @Test func aScriptThatThrowsBecomesASwiftError() async throws {
        let host = try JSHost()
        #expect { try host.load(script: "throw new TypeError('boom')", sourceURL: URL(fileURLWithPath: "/t.js")) } throws: { error in
            if case BrainError.javaScript(let message, _) = error { return message.contains("boom") }
            return false
        }
        #expect(throws: BrainError.notLoaded) { _ = try host.call("version", argsJSON: "{}") }
    }

    // MARK: - polyfills

    @Test func polyfillsWork() throws {
        let host = try JSHost()
        #expect(try host.evaluate("typeof console.log + typeof performance.now + typeof crypto.getRandomValues")?.toString() == "functionfunctionfunction")
        #expect(try host.evaluate("console.log('brain test', 1, {a: 2}); console.warn('w'); 'ok'")?.toString() == "ok")
        let roundTrip = try host.evaluate("new TextDecoder().decode(new TextEncoder().encode('π ≈ 3.14 😀 é'))")?.toString()
        #expect(roundTrip == "π ≈ 3.14 😀 é")
        #expect(try host.evaluate("new TextEncoder().encode('é😀').length")?.toInt32() == 6)
        let random = try host.evaluate("var a = new Uint32Array(64); crypto.getRandomValues(a); a.filter(function (x) { return x !== 0; }).length")?.toInt32() ?? 0
        #expect(random > 56)
        let monotonic = try host.evaluate("var t0 = performance.now(); for (var i = 0; i < 1e5; i++); performance.now() >= t0 && t0 >= 0")?.toBool()
        #expect(monotonic == true)
    }

    // MARK: - typed wrappers

    @Test func analyzeLineRoundTripsItsContext() async throws {
        try await brain.load()
        let first = try await brain.analyzeLine("2x + 3 = 11")
        #expect(first.kind == "equation")
        #expect(first.solutions == ["4"])
        let next = try await brain.analyzeLine("2x = 8", context: AnalyzeContext(mode: .feedback, previous: first, original: first))
        #expect(next.verdict == "ok")
        let wrong = try await brain.analyzeLine("2x = 14", context: AnalyzeContext(mode: .feedback, previous: first, original: first))
        #expect(wrong.verdict == "mismatch")
        // a domain with an open end crosses as Infinity both ways
        let domain = LineDomain(variable: "x", lo: 0, hi: .infinity, loIn: false, hiIn: false, unit: "plain", latex: "x > 0")
        var squared = try await brain.analyzeLine("x^{2} = 16")
        squared.domain = domain
        let root = try await brain.analyzeLine("x = 4", context: AnalyzeContext(previous: squared, original: squared))
        #expect(root.kind == "equation")
    }

    @Test func localSolveWritesTheSteps() async throws {
        try await brain.load()
        let solved = try await brain.localSolve(["x^{2} - 5x + 6 = 0"])
        #expect(solved.source == "solveLatex")
        #expect(solved.steps == ["(x - 2)(x - 3) = 0", "x = 2, \\ x = 3"])
        let column = try await brain.analyzeColumn(["2x + 3 = 11", "2x = 8"])
        #expect(column.count == 2)
        #expect(try await brain.calculate("5 km/h to m/s") == "1.389\\,\\mathrm{m/s}")
        #expect(try await brain.verifyExpected("4", latex: "x = 4") == .equal)
    }

    @Test func inkFromTheHandClustersAndHashesLikeTheWeb() async throws {
        try await brain.load()
        // the tutor's hand writing a line, used as a student's ink
        let written = try await brain.layoutHandwriting(HandwritingRequest(steps: ["2x + 3 = 11"], size: 40, seed: 7, origin: Point(x: 100, y: 200)))
        let line = try #require(written.plan?.lines.first)
        let strokes = line.strokes.enumerated().map { i, s in
            BrainStroke(id: "s\(i)", x: s.points.map { $0.x + line.x }, y: s.points.map { $0.y + line.y })
        }
        let clustered = try await brain.clusterStrokes(ClusterRequest(strokes: strokes, idSeed: 1))
        #expect(clustered.lines.count == 1)
        #expect(clustered.lines.first?.strokeIds.count == strokes.count)
        #expect(clustered.roles.count == strokes.count)
        let payload = try #require(try await brain.recognizerPayload(strokes))
        #expect(payload.strokes.x.count == payload.strokes.y.count)
        // the cache key is SHA-1 of JSON([x, y]): recompute it in Swift
        let xs = payload.strokes.x.map { "[" + $0.map(Self.jsNumber).joined(separator: ",") + "]" }.joined(separator: ",")
        let ys = payload.strokes.y.map { "[" + $0.map(Self.jsNumber).joined(separator: ",") + "]" }.joined(separator: ",")
        let digest = Insecure.SHA1.hash(data: Data("[[\(xs)],[\(ys)]]".utf8)).map { String(format: "%02x", $0) }.joined()
        #expect(payload.hash == digest)
    }

    @Test func marksAndPolicy() async throws {
        try await brain.load()
        let tick = try await brain.mark(.check, around: Rect(x: 100, y: 200, w: 180, h: 40), seedKey: "ln_1:check")
        #expect(tick.strokes.count == 1)
        #expect(tick.plan != nil)
        let ring = try await brain.mark(.circle, around: Rect(x: 100, y: 200, w: 180, h: 40), seedKey: "ln_1:circle")
        #expect(ring.ring.w > 180)
        let analysis = try await brain.analyzeLine("2x + 3 = 11")
        let decision = try await brain.policy(PolicyInput(mode: .feedback, analysis: analysis, confidence: 0.9, settled: true, auto: true, userAsked: false, latex: "2x + 3 = 11"))
        #expect(decision.echo)
    }

    @Test func learning() async throws {
        try await brain.load()
        let problems = try await brain.practice(skill: "two_step_equations", count: 4, seed: 3)
        #expect(problems.count == 4)
        let again = try await brain.practice(skill: "two_step_equations", count: 4, seed: 3)
        #expect(problems == again)
        let variant = try await brain.variantOf(["2x + 3 = 11"], seed: 5, stillClock: true)
        #expect(variant?.isEmpty == false)
        #expect(variant != ["2x + 3 = 11"])
        let graph = try await brain.sketchGraph(["y = 2x + 1"], explicit: true, seed: 7)
        #expect(graph?.plan != nil)
        #expect(graph?.intent["kind"]?.stringValue == "plane")
        #expect(try await brain.jitProbe(iterations: 1000).sum != 0)
    }

    /// Every golden result decodes into its Swift type and encodes back to the same JSON: no field
    /// is lost on the way round (a line's analysis goes back as the next line's context).
    @Test(arguments: ["analyzeLine", "analyzeColumn", "localSolve", "clusterStrokes", "recognizerPayload", "layoutHandwriting", "layoutMath", "marks", "policy", "practice", "variantOf", "nowYouTry", "weakSpotPractice", "progressSummary", "sketchGraph", "classify", "calculate", "verifyExpected"])
    func swiftTypesKeepEveryField(method: String) throws {
        let decoder = JSONDecoder()
        decoder.nonConformingFloatDecodingStrategy = .convertFromString(positiveInfinity: "Infinity", negativeInfinity: "-Infinity", nan: "NaN")
        let encoder = JSONEncoder()
        encoder.nonConformingFloatEncodingStrategy = .convertToString(positiveInfinity: "Infinity", negativeInfinity: "-Infinity", nan: "NaN")
        for c in Golden.method(method) where !c.name.hasPrefix("error/") {
            let prefix = #"{"ok":true,"result":"#
            let raw = String(c.result.dropFirst(prefix.count).dropLast())
            let data = Data(raw.utf8)
            let reencoded: Data
            switch method {
            case "analyzeLine": reencoded = try encoder.encode(decoder.decode(LineAnalysis.self, from: data))
            case "analyzeColumn": reencoded = try encoder.encode(decoder.decode([LineAnalysis?].self, from: data))
            case "localSolve": reencoded = try encoder.encode(decoder.decode(LocalSolveResult.self, from: data))
            case "clusterStrokes": reencoded = try encoder.encode(decoder.decode(ClusterResult.self, from: data))
            case "recognizerPayload": reencoded = try encoder.encode(decoder.decode(RecognizerPayload?.self, from: data))
            case "layoutHandwriting": reencoded = try encoder.encode(decoder.decode(HandwritingResult.self, from: data))
            case "layoutMath": reencoded = try encoder.encode(decoder.decode(JSONValue.self, from: data))
            case "marks": reencoded = try encoder.encode(decoder.decode(MarkResult.self, from: data))
            case "policy": reencoded = try encoder.encode(decoder.decode(PolicyDecision.self, from: data))
            case "practice": reencoded = try encoder.encode(decoder.decode([[String]].self, from: data))
            case "variantOf", "nowYouTry": reencoded = try encoder.encode(decoder.decode([String]?.self, from: data))
            case "weakSpotPractice": reencoded = try encoder.encode(decoder.decode(WeakSpotPractice?.self, from: data))
            case "progressSummary": reencoded = try encoder.encode(decoder.decode(ProgressSummary.self, from: data))
            case "sketchGraph": reencoded = try encoder.encode(decoder.decode(GraphSketch?.self, from: data))
            case "classify": reencoded = try encoder.encode(decoder.decode(String.self, from: data))
            case "verifyExpected": reencoded = try encoder.encode(decoder.decode(ExpectedVerdict.self, from: data))
            case "calculate": reencoded = try encoder.encode(decoder.decode(JSONValue.self, from: data))
            default: Issue.record("no Swift type for \(method)"); return
            }
            let difference = JSONCompare.firstDifference(JSONCompare.parse(String(decoding: reencoded, as: UTF8.self)), JSONCompare.parse(raw), tolerance: 0, nullIsMissing: true)
            #expect(difference == nil, "\(c.name): \(difference.map(String.init(describing:)) ?? "")")
        }
    }

    /// How JavaScript writes a number in JSON (integers without a fraction).
    static func jsNumber(_ value: Double) -> String {
        value == value.rounded() && abs(value) < 1e15 ? String(Int64(value)) : "\(value)"
    }
}
