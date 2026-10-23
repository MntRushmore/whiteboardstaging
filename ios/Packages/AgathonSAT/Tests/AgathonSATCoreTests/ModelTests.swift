import Foundation
import Testing
@testable import AgathonSATCore

/// The contract's JSON (docs/SAT-MODE.md; the web's src/lib/sat/contracts.ts) decodes field for field.
struct ModelTests {
    @Test func theFixturesDecodeAndCoverTheContract() throws {
        let qs = SATFixtures.questions
        #expect(qs.count >= 12)
        #expect(Set(qs.map(\.domain)) == Set(SATDomain.allCases))
        #expect(Set(qs.map(\.format)) == [.mcq, .spr])
        #expect(Set(qs.compactMap(\.figure).map(\.kind)) == ["table", "plot", "shape"])
        for q in qs {
            // ids as the bank's: <domain>-<skill slug>-<nnnn>, the skill one of the spec's, in that domain
            let skill = try #require(SATTaxonomy.skill(named: q.skill), "\(q.id): \(q.skill) is not one of the spec's skills")
            #expect(skill.domain == q.domain)
            #expect(q.id.hasPrefix("\(q.domain.rawValue)-\(skill.slug)-"))
            #expect(q.id.range(of: #"-[0-9]{4}$"#, options: .regularExpression) != nil)
            #expect((2...6).contains(q.solution.steps.count), "\(q.id) has \(q.solution.steps.count) steps")
            switch q.format {
            case .mcq:
                #expect(q.choices?.map(\.key) == ["A", "B", "C", "D"])
                #expect(["A", "B", "C", "D"].contains(q.answer.key ?? ""))
            case .spr:
                #expect(q.choices == nil)
                let accepted = try #require(q.answer.accepted)
                // every accepted form is itself a grid-in a student could type
                for a in accepted { #expect(SATGridIn.problem(a) == nil, "\(q.id): \(a) is no grid-in") }
            }
        }
    }

    @Test func aQuestionAsTheServerSendsIt() throws {
        let json = #"""
        {"questions":[{"id":"algebra-linear-functions-0042","domain":"algebra","skill":"linear functions","difficulty":3,
          "format":"mcq","stem":"If $f(x) = 3x - 2$, what is $f(5)$?","figure":null,
          "choices":[{"key":"A","text":"$13$"},{"key":"B","text":"$15$"},{"key":"C","text":"$17$"},{"key":"D","text":"$3$"}],
          "answer":{"key":"a"},"solution":{"steps":[{"text":"Put 5 in for x.","math":"3(5) - 2"},{"text":"So","math":null}],"desmos_tip":null},
          "status":"live","version":2,"created_at":"2026-10-22T10:00:00Z"},
         {"id":"psda-percentages-0001","domain":"psda","skill":"percentages","difficulty":1,"format":"spr","stem":"x",
          "figure":{"kind":"hologram"},"choices":null,"answer":{"accepted":["3/4",".75"]},
          "solution":{"steps":[{"text":"a","math":"1"},{"text":"b","math":null}],"desmos_tip":"Graph it."},"status":"live","version":1},
         {"id":"bad","domain":"chemistry","skill":"x","difficulty":1,"format":"mcq","stem":"x","figure":null,"choices":null,
          "answer":{"key":"A"},"solution":{"steps":[],"desmos_tip":null},"status":"live","version":1}]}
        """#
        let reply = try JSONDecoder().decode(SATNextReply.self, from: Data(json.utf8))
        // the unknown domain is left out, never the whole set
        #expect(reply.questions.map(\.id) == ["algebra-linear-functions-0042", "psda-percentages-0001"])
        let q = reply.questions[0]
        #expect(q.answer.key == "A")
        #expect(q.difficulty == 3)
        #expect(q.version == 2)
        #expect(q.solution.steps[1].math == nil)
        #expect(q.skillTitle == "Linear functions")
        // a figure of a kind this build does not draw is left out, not the question
        #expect(reply.questions[1].figure == nil)
        #expect(reply.questions[1].answer.accepted == ["3/4", ".75"])
        #expect(reply.questions[1].solution.desmosTip == "Graph it.")
    }

    @Test func figuresDecodeEveryItemTheContractNames() throws {
        let plot = #"""
        {"kind":"plot","x":{"min":-5,"max":5,"step":1,"label":"x"},"y":{"min":0,"max":10,"step":2},"note":"n",
         "items":[{"type":"function","expr":"2*x+1","label":"f","dashed":true,"domain":[0,3]},
                  {"type":"segment","from":[0,0],"to":[3,4],"label":"s","dashed":true},
                  {"type":"point","at":[2,5],"label":"(2, 5)","open":true},
                  {"type":"bar","x":1,"height":12,"label":"Mon","width":0.6},
                  {"type":"spiral"}]}
        """#
        guard case .plot(let p) = try JSONDecoder().decode(SATFigure.self, from: Data(plot.utf8)) else { Issue.record("not a plot"); return }
        #expect(p.grid)
        #expect(p.y.label == nil)
        #expect(p.note == "n")
        #expect(p.items[0] == .function(expr: "2*x+1", label: "f", dashed: true, domain: [0, 3]))
        #expect(p.items[1] == .segment(from: SATPoint(0, 0), to: SATPoint(3, 4), label: "s", dashed: true))
        #expect(p.items[2] == .point(at: SATPoint(2, 5), label: "(2, 5)", open: true))
        #expect(p.items[3] == .bar(x: 1, height: 12, label: "Mon", width: 0.6))
        #expect(p.items[4] == .unknown("spiral"))
        #expect(p.isBarChart)
        #expect(p.x.ticks == [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5])
        #expect(p.y.ticks == [0, 2, 4, 6, 8, 10])

        let shape = #"""
        {"kind":"shape","note":"Note: Figure not drawn to scale.","items":[
          {"type":"polygon","points":[[0,0],[4,0],[0,3]],"dashed":false},{"type":"circle","center":[0,0],"r":2,"dashed":true},
          {"type":"segment","from":[0,0],"to":[2,0],"dashed":true},{"type":"point","at":[1,1],"label":"P"},
          {"type":"label","at":[2,-0.3],"text":"4"},{"type":"right_angle","at":[0,0],"dirs":[[1,0],[0,1]]},
          {"type":"arc_angle","at":[4,0],"from":180,"to":143,"label":"$x^\\circ$"}]}
        """#
        guard case .shape(let s) = try JSONDecoder().decode(SATFigure.self, from: Data(shape.utf8)) else { Issue.record("not a shape"); return }
        #expect(s.items.count == 7)
        #expect(s.items[1] == .circle(center: SATPoint(0, 0), r: 2, dashed: true))
        #expect(s.items[5] == .rightAngle(at: SATPoint(0, 0), dirs: [SATPoint(1, 0), SATPoint(0, 1)]))
        #expect(s.items[6] == .arcAngle(at: SATPoint(4, 0), from: 180, to: 143, label: "$x^\\circ$"))
        let b = try #require(s.bounds)
        #expect(b.minX == -2 && b.maxX == 4 && b.minY == -2 && b.maxY == 3)

        let table = #"{"kind":"table","headers":["x","f(x)"],"rows":[["0","3"],["1","5"]]}"#
        #expect(try JSONDecoder().decode(SATFigure.self, from: Data(table.utf8)) == .table(SATTable(headers: ["x", "f(x)"], rows: [["0", "3"], ["1", "5"]])))
    }

    @Test func questionsRoundTrip() throws {
        for q in SATFixtures.questions {
            let data = try JSONEncoder().encode(q)
            #expect(try JSONDecoder().decode(SATQuestion.self, from: data) == q)
        }
    }

    @Test func theRepliesDecode() throws {
        let pass = try JSONDecoder().decode(SATTutorPass.self, from: Data(#"{"allowed":false,"used_today":5,"cap":5,"unlimited":false}"#.utf8))
        #expect(pass == SATTutorPass(allowed: false, usedToday: 5, cap: 5, unlimited: false))
        #expect(pass.left == 0)
        let progress = #"""
        {"answered":20,"correct":13,"by_domain":[{"domain":"algebra","answered":8,"correct":6},{"domain":"psda","answered":12,"correct":7}],
         "by_skill":[{"domain":"algebra","skill":"linear functions","answered":8,"correct":6}],"streak_days":4,
         "today":{"answered":3,"tutor_used":2,"cap":5,"unlimited":false},"estimate":{"low":500,"high":600,"note":"From 20 answers."}}
        """#
        let p = try JSONDecoder().decode(SATProgress.self, from: Data(progress.utf8))
        #expect(p.count(.algebra) == .init(answered: 8, correct: 6))
        #expect(p.count(.geometryTrig) == .init(answered: 0, correct: 0))
        #expect(p.count(skill: "linear functions").correct == 6)
        #expect(p.today.tutorLeft == 3)
        #expect(p.estimate == .init(low: 500, high: 600, note: "From 20 answers."))
        #expect(p.streakDays == 4)
        // under 15 answers: no estimate (null), and missing fields take their empty value
        let early = try JSONDecoder().decode(SATProgress.self, from: Data(#"{"answered":3,"correct":1,"estimate":null}"#.utf8))
        #expect(early.estimate == nil)
        #expect(early.byDomain.isEmpty)
        #expect(early.today.cap == 5)
    }

    @Test func theAttemptsReplyCarriesTheServersVerdict() throws {
        #expect(try JSONDecoder().decode(SATAttemptReply.self, from: Data(#"{"ok":true,"correct":false}"#.utf8)) == SATAttemptReply(ok: true, correct: false))
        #expect(try JSONDecoder().decode(SATAttemptReply.self, from: Data(#"{"ok":true}"#.utf8)).correct == nil)
    }

    @Test func anAttemptIsSentAsTheRouteReadsIt() throws {
        let a = SATAttempt(questionId: "algebra-linear-functions-0042", chosen: "B", correct: false, seconds: 74, usedTutor: true)
        let json = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(a)) as? [String: Any])
        #expect(json["question_id"] as? String == "algebra-linear-functions-0042")
        #expect(json["chosen"] as? String == "B")
        #expect(json["correct"] as? Bool == false)
        #expect(json["seconds"] as? Int == 74)
        #expect(json["used_tutor"] as? Bool == true)
        #expect(json.count == 5)
    }

    @Test func everySkillOfTheSpecIsKnown() {
        #expect(SATTaxonomy.skills.count == 19)
        #expect(SATTaxonomy.skills(in: .algebra).count == 5)
        #expect(SATTaxonomy.skills(in: .advancedMath).count == 3)
        #expect(SATTaxonomy.skills(in: .psda).count == 7)
        #expect(SATTaxonomy.skills(in: .geometryTrig).count == 4)
        #expect(SATTaxonomy.title(of: "a skill from the future") == "A skill from the future")
        #expect(SATFixtures.domain(ofId: "geometry_trig-circles-0001") == .geometryTrig)
        #expect(SATFixtures.domain(ofId: "advanced_math-equivalent-expressions-0001") == .advancedMath)
    }
}
