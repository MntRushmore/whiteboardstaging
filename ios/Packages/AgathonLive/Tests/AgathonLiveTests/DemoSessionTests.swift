import AgathonBrain
import Foundation
import Testing
@testable import AgathonLive

/// The school demo's recordings (`DemoSessions`): every line one the hand can write, every word
/// problem shown as words (a dollar sign kept), the ids apart from the QA sessions'.
@MainActor
@Suite(.serialized)
struct DemoSessionTests {
    @Test func everyDemoLineIsOneTheHandCanWrite() async throws {
        try await TestBrain.shared.load()
        for s in DemoSessions.all {
            for l in KidSessions.lines(s) {
                let ink = try await StudentHand.ink(l.latex, hand: s.hand, brain: TestBrain.shared)
                #expect(ink?.isEmpty == false, "\(s.id): the hand can't write \(l.latex)")
            }
        }
    }

    @Test func theWordProblemsAreWords() {
        for s in DemoSessions.wordProblems {
            guard case .tutorProblem(let p)? = s.steps.first else { Issue.record("\(s.id) has no problem"); continue }
            #expect(WordProblem.sentences(p) != nil, "\(s.id)")
        }
        #expect(WordProblem.sentences(["\\text{Lunch costs \\$13.45. You pay with a \\$20 bill.}"]) == ["Lunch costs $13.45. You pay with a $20 bill."])
        #expect(WordProblem.sentences(["\\text{A jacket costs \\$48. It is 25\\% off.}"]) == ["A jacket costs $48. It is 25% off."])
    }

    @Test func demoIdsAreTheirOwn() {
        #expect(Set(DemoSessions.all.map(\.id)).count == 14)
        #expect(Set(DemoSessions.all.map(\.id)).isDisjoint(with: KidSessions.all.map(\.id)))
        #expect(KidSessions.named("d7-slip-fix")?.grade == 7)
    }
}
