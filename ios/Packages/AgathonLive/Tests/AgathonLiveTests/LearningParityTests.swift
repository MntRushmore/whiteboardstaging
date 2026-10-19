import AgathonBrain
import AgathonKit
import Foundation
import Testing
@testable import AgathonLive

/// The iPad's attempt tracker against the web's: every scenario of `src/__eval__/learning`
/// (`Fixtures/learning-golden.ndjson`, written by the web's tracker with its real classifiers) run
/// step for step through the Swift tracker — the brain's `classify` and `classifyMistake` in
/// JavaScriptCore — comparing every record published, every batch saved, every save's failure, what
/// is kept for the board's next visit, and the final records, pending records and attempt ids.
@MainActor
@Suite(.serialized)
struct LearningParityTests {
    struct Golden: Decodable {
        var name: String
        var course: String?
        var steps: [Step]
        var events: [Event]
        var final: Final
    }

    enum Step: Decodable {
        case signal(LearningSignal)
        case tick(Double)
        case flush(String)
        case reopen

        enum K: String, CodingKey { case kind, signal, at, result }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            switch try c.decode(String.self, forKey: .kind) {
            case "signal": self = .signal(try c.decode(LearningSignal.self, forKey: .signal))
            case "tick": self = .tick(try c.decode(Double.self, forKey: .at))
            case "flush": self = .flush(try c.decode(String.self, forKey: .result))
            default: self = .reopen
            }
        }
    }

    enum Event: Decodable, Equatable {
        case publish(LearningRecord)
        case save([LearningRecord])
        case flush(String?)
        case snapshot([SavedAttempt])

        enum K: String, CodingKey { case t, record, records, error, attempts }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: K.self)
            switch try c.decode(String.self, forKey: .t) {
            case "publish": self = .publish(try c.decode(LearningRecord.self, forKey: .record))
            case "save": self = .save(try c.decode([LearningRecord].self, forKey: .records))
            case "flush": self = .flush(try c.decodeIfPresent(String.self, forKey: .error))
            default: self = .snapshot(try c.decode([SavedAttempt].self, forKey: .attempts))
            }
        }
    }

    struct Final: Decodable {
        var records: [LearningRecord]
        var pending: [LearningRecord]
        var snapshot: [SavedAttempt]
        var attemptIds: [String: String?]
    }

    static let board = "5d0c6f1a-2b3c-4d5e-8f60-0123456789ab"

    static func golden() throws -> [Golden] {
        let url = try #require(Bundle.module.url(forResource: "learning-golden", withExtension: "ndjson", subdirectory: "Fixtures"))
        let text = try String(contentsOf: url, encoding: .utf8)
        return try text.split(separator: "\n").map { try JSONDecoder().decode(Golden.self, from: Data($0.utf8)) }
    }

    static func attemptId(_ n: Int) -> String {
        let s = String(n)
        return "00000000-0000-4000-8000-" + String(repeating: "0", count: 12 - s.count) + s
    }

    struct Failure: Error, LearningStoreErrorConvertible {
        var learningStoreCode: String
    }

    /// One scenario through the Swift tracker: its events, and the final state.
    static func run(_ g: Golden, brain: Brain) async throws -> (events: [Event], final: Final) {
        var events: [Event] = []
        var now = 0.0
        var ids = 0
        var saveResult = "ok"
        let classifier = LearningClassifier(brain: brain, course: g.course)
        func make() -> AttemptTracker {
            AttemptTracker(deps: .init(
                now: { now },
                newId: {
                    ids += 1
                    return attemptId(ids)
                },
                course: g.course,
                classify: { classifier.skill($0) },
                save: { records in
                    events.append(.save(records))
                    if saveResult != "ok" { throw Failure(learningStoreCode: saveResult) }
                },
                publish: { events.append(.publish($0)) },
                classifyMistake: { await classifier.mistake(previous: $0, latex: $1) }))
        }
        var tracker = make()
        var keys = Set<String>()
        for step in g.steps {
            switch step {
            case .signal(let s):
                now = s.at
                if let k = s.problemKey { keys.insert(k) }
                await classifier.prepare(s)
                tracker.handle(s)
            case .tick(let at):
                now = at
                tracker.tick(at)
            case .flush(let result):
                saveResult = result
                do {
                    try await tracker.flush()
                    events.append(.flush(nil))
                } catch {
                    events.append(.flush(LearningStoreErrorCode.of(error)))
                }
            case .reopen:
                // through JSON, as the device keeps it
                let saved = try JSONDecoder().decode([SavedAttempt].self, from: JSONEncoder().encode(tracker.snapshot(boardId: board)))
                events.append(.snapshot(saved))
                tracker = make()
                tracker.restore(saved)
            }
            await tracker.settled()
        }
        var attemptIds: [String: String?] = [:]
        for k in keys { attemptIds[k] = .some(tracker.attemptId(for: k)) }
        return (events, Final(records: tracker.records(), pending: tracker.pending(), snapshot: tracker.snapshot(boardId: board), attemptIds: attemptIds))
    }

    @Test func everyScenarioMatchesTheWeb() async throws {
        let all = try Self.golden()
        #expect(all.count >= 32)
        try await TestBrain.shared.load()
        var checkedRecords = 0
        for g in all {
            let (events, final) = try await Self.run(g, brain: TestBrain.shared)
            #expect(events.count == g.events.count, "\(g.name): \(events.count) events, the web had \(g.events.count)")
            for (i, (mine, web)) in zip(events, g.events).enumerated() where mine != web {
                Issue.record("\(g.name): event \(i) differs\n  iPad: \(mine)\n  web:  \(web)")
                break
            }
            #expect(final.records == g.final.records, "\(g.name): final records")
            #expect(final.pending == g.final.pending, "\(g.name): pending records")
            #expect(final.snapshot == g.final.snapshot, "\(g.name): the board's snapshot")
            #expect(final.attemptIds == g.final.attemptIds, "\(g.name): attempt ids")
            checkedRecords += events.filter { if case .publish = $0 { return true } else { return false } }.count
        }
        #expect(checkedRecords > 100, "the scenarios publish \(checkedRecords) records")
    }

    @Test func theWebsJSONRoundTrips() throws {
        // a snapshot written by the web reads, and writes back the same
        for g in try Self.golden() {
            let encoded = try JSONEncoder().encode(g.final.snapshot)
            #expect(try JSONDecoder().decode([SavedAttempt].self, from: encoded) == g.final.snapshot, "\(g.name)")
            for case .signal(let s) in g.steps {
                #expect(try JSONDecoder().decode(LearningSignal.self, from: JSONEncoder().encode(s)) == s)
            }
        }
    }
}
