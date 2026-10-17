import Foundation
import Testing
@testable import AgathonBrain

/// `brain.js` in JavaScriptCore answers exactly what the TypeScript brain answers in node, on
/// every golden case (real inputs from the scoreboards: `src/__eval__/brain/cases.ts`).
///
/// The maths, the clustering, the payloads, the policy and the learning are compared byte for
/// byte. The hand's geometry (strokes made with `Math.sin`, `Math.cos`, `Math.hypot`) may differ
/// in the last bit: V8 and JavaScriptCore use different libm implementations. Those are compared
/// to 1e-9. A graph sketch can go further: a last-bit difference can flip one point of a
/// resampled pen stroke, and the pen's random wobble then runs on from another place, so the
/// drawing is a different (equally good) sketch of the same graph. For those the maths (the
/// intent: curves, key points, asymptotes) must still match exactly, and the plan line for line.
@Suite(.serialized)
struct ParityTests {
    static let geometry: Set<String> = ["layoutHandwriting", "layoutMath", "writeText", "marks", "sketchGraph"]
    static let methods: [String] = Array(Set(Golden.cases.map(\.method))).sorted()

    @Test func goldenCasesArePresent() {
        #expect(Golden.cases.count > 3000, "golden.ndjson is missing or short: run `npm run brain:golden`")
    }

    @Test(arguments: methods)
    func parity(method: String) async throws {
        let brain = Golden.brain
        try await brain.load()
        var exact = 0
        var withinTolerance: [(String, Double)] = []
        var redrawn: [String] = []
        for c in Golden.method(method) {
            let got = try await brain.envelopeJSON(c.method, args: c.args)
            if got == c.result {
                exact += 1
                continue
            }
            let a = JSONCompare.parse(got)
            let b = JSONCompare.parse(c.result)
            if c.name.hasPrefix("error/") {
                // the stack is the engine's own; the code and the message are the brain's
                let ea = (a as? [String: Any])?["error"] as? [String: Any]
                let eb = (b as? [String: Any])?["error"] as? [String: Any]
                #expect(ea?["code"] as? String == eb?["code"] as? String, "\(c.name)")
                #expect(ea?["message"] as? String == eb?["message"] as? String, "\(c.name)")
                exact += 1
                continue
            }
            guard Self.geometry.contains(method) else {
                let difference = JSONCompare.firstDifference(a, b, tolerance: 0)
                Issue.record("\(c.name) differs from node: \(difference.map(String.init(describing:)) ?? "byte order only")")
                continue
            }
            if JSONCompare.firstDifference(a, b, tolerance: 1e-9) == nil {
                withinTolerance.append((c.name, JSONCompare.maxRelativeDifference(a, b)))
                continue
            }
            guard method == "sketchGraph" else {
                Issue.record("\(c.name): geometry differs beyond 1e-9: \(JSONCompare.firstDifference(a, b, tolerance: 1e-9).map(String.init(describing:)) ?? "")")
                continue
            }
            // a redrawn sketch: the same maths and the same plan, line for line
            let ra = ((a as? [String: Any])?["result"] as? [String: Any]) ?? [:]
            let rb = ((b as? [String: Any])?["result"] as? [String: Any]) ?? [:]
            let intent = JSONCompare.firstDifference(ra["intent"], rb["intent"], tolerance: 1e-9)
            #expect(intent == nil, "\(c.name): the graph's maths differs: \(intent.map(String.init(describing:)) ?? "")")
            let la = (((ra["plan"] as? [String: Any])?["lines"]) as? [[String: Any]])?.map { $0["latex"] as? String ?? "" }
            let lb = (((rb["plan"] as? [String: Any])?["lines"]) as? [[String: Any]])?.map { $0["latex"] as? String ?? "" }
            #expect(la == lb, "\(c.name): the sketch's lines differ")
            redrawn.append(c.name)
        }
        let total = Golden.method(method).count
        let worst = withinTolerance.map(\.1).max() ?? 0
        print("PARITY \(method): \(exact)/\(total) byte-identical, \(withinTolerance.count) within 1e-9 (worst \(worst)), \(redrawn.count) redrawn \(redrawn)")
    }
}
