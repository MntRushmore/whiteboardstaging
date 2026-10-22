import Foundation
import Testing
@testable import AgathonSATCore

/// The bank lane's own 20 hand-checked questions (docs/sat/sample-20.json on feat/sat-bank): every one
/// decodes, its figure draws (each plot function parses), its grid-ins are grid-ins, and its right
/// answer checks right through the app's own rules.
struct BankSampleTests {
    static let questions: [SATQuestion] = {
        guard let url = Bundle.module.url(forResource: "bank-sample-20", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let lossy = try? JSONDecoder().decode([Lossy<SATQuestion>].self, from: data) else { return [] }
        return lossy.compactMap(\.value)
    }()

    @Test func allTwentyDecode() {
        #expect(Self.questions.count == 20)
        #expect(Set(Self.questions.map(\.domain)) == Set(SATDomain.allCases))
        for q in Self.questions { #expect(SATTaxonomy.skill(named: q.skill)?.domain == q.domain, "\(q.id)") }
    }

    @Test func everyFigureDraws() {
        for q in Self.questions {
            guard let figure = q.figure else { continue }
            switch figure {
            case .plot(let p):
                for item in p.items {
                    if case .function(let expr, _, _, _) = item { #expect(SATExpression(expr) != nil, "\(q.id): \(expr)") }
                    if case .unknown(let t) = item { Issue.record("\(q.id): an item this build can't draw: \(t)") }
                }
            case .shape(let s):
                for item in s.items { if case .unknown(let t) = item { Issue.record("\(q.id): \(t)") } }
                #expect(s.bounds != nil)
            case .table(let t):
                #expect(!t.headers.isEmpty)
            }
        }
    }

    @Test func theRightAnswerChecksRight() {
        for q in Self.questions {
            switch q.format {
            case .mcq:
                #expect(q.choices?.contains { $0.key == q.answer.key } == true, "\(q.id)")
            case .spr:
                let accepted = q.answer.accepted ?? []
                #expect(!accepted.isEmpty)
                for a in accepted {
                    #expect(SATGridIn.problem(a) == nil, "\(q.id): \(a) isn't a grid-in")
                    #expect(SATGridIn.isCorrect(a, accepted: accepted), "\(q.id): \(a)")
                }
            }
        }
    }

    @Test func everyStemAndChoiceParses() {
        for q in Self.questions {
            #expect(!SATRichText.parse(q.stem).isEmpty)
            for c in q.choices ?? [] { #expect(!SATRichText.parse(c.text).isEmpty, "\(q.id) \(c.key)") }
        }
    }
}
