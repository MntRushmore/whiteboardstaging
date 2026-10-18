import AgathonBoard
import AgathonBrain
import AgathonKit
import Foundation
import Testing
@testable import AgathonLive

/// Hint words on the iPad (`HintWording`): the rules a model's words must pass before a kid sees
/// them, and the loop's use of a writer (a fake here; Apple Intelligence on the owner's iPad).
@MainActor
@Suite(.serialized)
struct HintWordingTests {
    let facts = HintFacts(previous: "2x = 8", line: "x = 5", expected: "x = 4")

    @Test func wordsThatGiveAwayTheAnswerOrDoSumsAreThrownAway() {
        #expect(HintWording.accept("Look again at the right side: what is 8 divided by 2?", facts: facts) == "Look again at the right side: what is 8 divided by 2?")
        #expect(HintWording.accept("The right side should be 4.", facts: facts) == nil, "the answer")
        #expect(HintWording.accept("Check the right side, 8 minus 3 is not 5.", facts: facts) == nil, "a number the kid never wrote")
        #expect(HintWording.accept("This step is wrong, look at it.", facts: facts) == nil, "never wrong")
        #expect(HintWording.accept("Check it", facts: facts) == nil, "too short to help")
        #expect(HintWording.accept(String(repeating: "look again at this ", count: 8), facts: facts) == nil, "too long")
        #expect(HintWording.accept("Look at x = \\frac{8}{2} again.", facts: facts) == nil, "no LaTeX")
        #expect(HintWording.accept("\"Great try! Check how you got 5 from 8.\"", facts: facts) == "Great try. Check how you got 5 from 8.", "quotes off, no exclamation")
        #expect(HintWording.accept(nil, facts: facts) == nil)
    }

    @Test func theSideOfTheSlipComesFromTheEnginesStep() {
        #expect(facts.side == "right")
        #expect(HintFacts(previous: "3(x - 1) = 12", line: "3x - 1 = 12", expected: "3x - 3 = 12").side == "left")
        #expect(HintFacts(previous: nil, line: "x = 5", expected: nil).side == nil)
        let prompt = HintWording.prompt(facts)
        #expect(prompt.contains("2x = 8") && prompt.contains("x = 5") && prompt.contains("right side"))
        #expect(!prompt.contains("x = 4"), "the model is never told the answer")
    }

    func slip(_ h: Harness) async {
        await h.write("2x + 3 = 11", at: Vec2(200, 120))
        await h.write("2x = 8", at: Vec2(200, 220))
        await h.write("x = 5", at: Vec2(200, 320))
        await h.pass(700)
    }

    @Test func helpMeOnARingIsWordedOnTheIPadWithNoServerCheck() async throws {
        let h = Harness(mode: .feedback)
        let writer = FakeWriter(words: "Look again at the right side: what is 8 divided by 2?")
        h.loop.hintWriter = writer
        await h.start()
        await slip(h)
        #expect(writer.prewarmed >= 1, "loaded when the ring was drawn")
        h.loop.helpMe()
        await h.pass(100)
        #expect(h.services.checkRequests.isEmpty, "no server check: the engine found the slip")
        #expect(h.loop.hints.first?.message == "Look again at the right side: what is 8 divided by 2?")
        let asked = try #require(writer.asked.first)
        #expect(asked.line == "x = 5" && asked.previous == "2x = 8" && asked.expected == "x = 4")
        #expect(h.loop.metrics.deviceHint.count == 1)
    }

    @Test func wordsThatFailTheRulesGoToTheServer() async throws {
        let h = Harness(mode: .feedback)
        h.loop.hintWriter = FakeWriter(words: "It should be x = 4.")
        await h.start()
        await slip(h)
        h.services.checkEvents = [[.meta(requestId: "r", model: "m"), .done(count: 0, ms: 10)]]
        h.loop.helpMe()
        await h.pass(100)
        #expect(h.services.checkRequests.count == 1, "the server words it instead")
        #expect(h.loop.metrics.deviceHintRefused == 1)
        #expect(h.loop.hints.first.map { !$0.message.contains("4") } == true)
    }

    @Test func noWriterOrALineTheEngineCannotJudgeAsksTheServer() async throws {
        let h = Harness(mode: .feedback)
        await h.start()
        await slip(h)
        h.services.checkEvents = [[.meta(requestId: "r", model: "m"), .done(count: 0, ms: 10)]]
        h.loop.helpMe()
        await h.pass(100)
        #expect(h.services.checkRequests.count == 1, "the default: the server's words")
        #expect(HintWording.debugEnabled == false, "off unless the owner turns it on")
    }
}

@MainActor
final class FakeWriter: HintWriter {
    let words: String?
    var isReady = true
    private(set) var prewarmed = 0
    private(set) var asked: [HintFacts] = []

    init(words: String?) {
        self.words = words
    }

    func prewarm() {
        prewarmed += 1
    }

    func write(_ facts: HintFacts) async -> String? {
        asked.append(facts)
        return words
    }
}

/// The corpus the owner's iPad is measured on.
@MainActor
struct HintCorpusTests {
    @Test func theRulesNeverLetTheAnswerThrough() {
        for item in HintCorpus.cases {
            guard let expected = item.expected, let right = expected.components(separatedBy: "=").last else { continue }
            // a value the kid wrote themselves gives nothing away
            let kids = HintWording.numbers(in: item.lines.suffix(2).joined(separator: " "))
            guard !HintWording.numbers(in: right).isSubset(of: kids) else { continue }
            let leak = "Look again: the right side should be \(MathText.plain(right).trimmingCharacters(in: .whitespaces))."
            #expect(HintWording.accept(leak, facts: item.facts) == nil, "\(item.lines.last ?? "") / \(expected)")
        }
    }

    @Test func theCorpusRunsThroughAWriterAndIsSummed() async {
        let rows = await HintCorpus.run(FakeWriter(words: "Look again at the right side of this step."))
        #expect(rows.count == HintCorpus.cases.count)
        #expect(rows.allSatisfy { $0.accepted == "Look again at the right side of this step." })
        #expect(HintCorpus.summary(rows).hasPrefix("16/16 passed the rules"))
    }
}
