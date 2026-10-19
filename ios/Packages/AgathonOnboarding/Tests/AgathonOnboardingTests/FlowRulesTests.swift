import Foundation
import Testing
@testable import AgathonOnboarding

@Suite("The flow's rules (src/lib/start/flow.ts, with the iPad's steps)")
struct FlowRulesTests {
    let grownUp3rd = OnboardingAnswers(role: .parent, name: "Sam", choice: .grade(3))
    let kid1st = OnboardingAnswers(role: .kid, name: "Ava", choice: .grade(1))

    @Test func theGrownUpsOrder() {
        #expect(FlowRules.steps(grownUp3rd) == [
            .hello, .name, .grade, .tricky, .handToKid, .tryIt, .building, .plan, .handBack,
            .gate, .account, .trial, .pin, .handOver, .kidProfile, .firstBoard,
        ])
    }

    @Test func aKidAloneUnder3rdSkipsTrickyAndTheHandOff() {
        let s = FlowRules.steps(kid1st)
        #expect(!s.contains(.tricky))
        #expect(!s.contains(.handToKid))
        #expect(FlowRules.next(after: .grade, kid1st) == .tryIt)
    }

    @Test func aKidAloneFrom3rdUpSeesTricky() {
        var a = kid1st
        a.choice = .grade(3)
        #expect(FlowRules.steps(a).contains(.tricky))
    }

    @Test func somethingElseOffersNoSkills() {
        var a = grownUp3rd
        a.choice = .course("other")
        #expect(!FlowRules.steps(a).contains(.tricky))
        #expect(Plan.focusOptions(a.choice).isEmpty)
    }

    @Test func aPlanSkipsTheTrial() {
        #expect(!FlowRules.steps(grownUp3rd, hasPlan: true).contains(.trial))
        #expect(FlowRules.next(after: .account, grownUp3rd, hasPlan: true) == .pin)
    }

    @Test func backNeverGoesIntoTheBeatNorBeforeTheAccount() {
        #expect(FlowRules.previous(before: .plan, grownUp3rd) == .tryIt)
        #expect(FlowRules.previous(before: .tryIt, grownUp3rd) == .handToKid)
        #expect(FlowRules.previous(before: .tryIt, kid1st) == .grade)
        #expect(FlowRules.previous(before: .hello, grownUp3rd) == nil)
        #expect(FlowRules.previous(before: .trial, grownUp3rd) == nil)
        #expect(FlowRules.previous(before: .pin, grownUp3rd) == nil)
        #expect(FlowRules.previous(before: .gate, grownUp3rd) == .handBack)
    }

    @Test func theTrails() {
        // who, name, grade, tricky, try
        #expect(FlowRules.trail(for: .grade, grownUp3rd)?.count == 5)
        #expect(FlowRules.trail(for: .grade, grownUp3rd)?.at == 2)
        // a young kid alone: no tricky node
        #expect(FlowRules.trail(for: .tryIt, kid1st)?.count == 4)
        // the grown-up's: Account · Free trial · the kid's profile
        #expect(FlowRules.trail(for: .trial, grownUp3rd)?.at == 1)
        #expect(FlowRules.trail(for: .pin, grownUp3rd)?.at == 2)
        #expect(FlowRules.trail(for: .account, grownUp3rd, hasPlan: true)?.count == 2)
        #expect(FlowRules.trail(for: .handToKid, grownUp3rd) == nil)
        #expect(FlowRules.trail(for: .plan, grownUp3rd) == nil)
    }

    @Test func resumeReopensWhereItWas() {
        #expect(FlowRules.resume(.tricky, grownUp3rd, signedIn: false) == .tricky)
        // the beat and the account reopen on the plan
        #expect(FlowRules.resume(.building, grownUp3rd, signedIn: false) == .plan)
        #expect(FlowRules.resume(.account, grownUp3rd, signedIn: false) == .plan)
        // the gate reopens on the hand-back
        #expect(FlowRules.resume(.gate, grownUp3rd, signedIn: false) == .handBack)
        // the grown-up's screens after the account need the session
        #expect(FlowRules.resume(.pin, grownUp3rd, signedIn: true) == .pin)
        #expect(FlowRules.resume(.pin, grownUp3rd, signedIn: false) == .plan)
        #expect(FlowRules.resume(.waiting, kid1st, signedIn: false) == .waiting)
        // missing answers: the first screen that needs them
        let noGrade = OnboardingAnswers(role: .parent, name: "Sam")
        #expect(FlowRules.resume(.tryIt, noGrade, signedIn: false) == .grade)
    }
}

@Suite("The answers")
struct AnswersTests {
    @Test func namesAsAKidTypesThem() {
        #expect(OnboardingAnswers.cleanName("  sam ") == "sam")
        #expect(OnboardingAnswers.cleanName("Mary-Kate") == "Mary-Kate")
        #expect(OnboardingAnswers.cleanName("D’Angelo") == "D'Angelo")
        #expect(OnboardingAnswers.cleanName("José  Luis") == "José Luis")
        #expect(OnboardingAnswers.cleanName("") == "")
        #expect(OnboardingAnswers.cleanName("R2D2") == nil)
        #expect(OnboardingAnswers.cleanName("-Sam") == nil)
        #expect(OnboardingAnswers.cleanName(String(repeating: "a", count: 25)) == nil)
    }

    @Test func atMostThreeSkillsInTheOrderPicked() {
        var a = OnboardingAnswers(role: .parent, choice: .grade(4))
        for s in ["long_division", "equivalent_fractions", "multiply_multi_digit", "add_fractions_like"] { a = a.toggling(skill: s, max: 3) }
        #expect(a.focus == ["long_division", "equivalent_fractions", "multiply_multi_digit"])
        a = a.toggling(skill: "equivalent_fractions", max: 3)
        #expect(a.focus == ["long_division", "multiply_multi_digit"])
    }

    @Test func aNewGradeKeepsOnlyWhatItOffers() {
        var a = OnboardingAnswers(role: .parent, choice: .grade(3), focus: ["times_tables"])
        a = a.choosing(level: .grade(4))
        #expect(a.focus.isEmpty)
    }

    @Test func aSolvedTryStaysSolved() {
        let a = OnboardingAnswers().trying(checked: true, solved: true).trying(checked: true, solved: false)
        #expect(a.tried == .init(checked: true, solved: true))
    }

    @Test func gradesAreSavedAsTheWebSavesThem() {
        #expect(LevelChoice.grade(3).saved.course == "other")
        #expect(LevelChoice.grade(3).saved.grade == 3)
        #expect(LevelChoice.course("geometry").saved.grade == nil)
    }

    @Test func picturesAreFamilyPictures() {
        let ids = Set(OnboardingCatalog.shared.avatars)
        for p in KidPicture.allCases { #expect(ids.contains(p.avatarId)) }
    }
}

@Suite("The plan (src/lib/start/plan.ts)")
struct PlanTests {
    @Test func pickedFirstInTeachingOrderThenTheRest() {
        let a = OnboardingAnswers(role: .parent, choice: .grade(3), focus: ["multiply_by_tens", "times_tables"])
        #expect(Plan.skills(a) == ["times_tables", "multiply_by_tens", "add_subtract_within_1000", "division_facts"])
        #expect(Plan.shown(a).skills.map(\.id) == ["times_tables", "multiply_by_tens", "add_subtract_within_1000"])
    }

    @Test func notSureStartsAtTheBeginning() {
        let a = OnboardingAnswers(role: .parent, choice: .grade(2))
        #expect(Plan.shown(a).skills.first?.id == "add_within_100")
    }

    @Test func theTryIsTheFirstSkillsStarterAtTheGrade() {
        // tryProblemFor: the band's starter for the plan's first skill at the kid's grade
        let a = OnboardingAnswers(role: .parent, choice: .grade(4), focus: ["long_division"])
        #expect(Plan.tryProblems(a).first?.id == "g35-5")
        let b = OnboardingAnswers(role: .kid, choice: .grade(0))
        #expect(Plan.tryProblems(b).first?.band == "k2")
        #expect(Plan.tryProblems(b).first?.grade == 0)
        let hs = OnboardingAnswers(role: .kid, choice: .course("algebra2"))
        #expect(Plan.tryProblems(hs).first?.band == "hs")
    }

    @Test func theCatalogueIsWhole() {
        let cat = OnboardingCatalog.shared
        #expect(cat.grades.count == 9)
        #expect(cat.maxFocus == 3)
        for g in cat.grades { for s in g.path { #expect(cat.skills[s] != nil, "no words for \(s)") } }
        for p in cat.problems { #expect(!p.lines.isEmpty && !p.firstStep.isEmpty) }
    }
}

@Suite("The copy")
struct CopyTests {
    @Test func twoVoices() {
        let g = OnboardingCopy(OnboardingAnswers(role: .parent, name: "Sam", choice: .grade(3)))
        let k = OnboardingCopy(OnboardingAnswers(role: .kid, name: "Sam", choice: .grade(3)))
        #expect(g.gradeTitle == "What grade is Sam in?")
        #expect(k.gradeTitle == "What grade are you in?")
        #expect(g.planTitle == "Sam’s plan is ready.")
        #expect(k.planTitle == "Your plan is ready.")
        #expect(g.save == "Save Sam’s plan")
        #expect(k.save == "Save my plan")
        #expect(OnboardingCopy.reply("Sam") == "Hi, Sam.")
        #expect(OnboardingCopy.reply(nil) == "Hi there.")
    }

    @Test func noNameReadsYourKid() {
        let g = OnboardingCopy(OnboardingAnswers(role: .parent))
        #expect(g.gradeTitle == "What grade is your kid in?")
        #expect(g.handToKidTitle == "Hand the iPad to your kid.")
    }

    @Test func aKidNeverReadsWrongPriceOrTrial() {
        let k = OnboardingCopy(OnboardingAnswers(role: .kid, name: "Sam", choice: .grade(3)))
        let kidWords = [k.nameTitle, k.gradeTitle, k.gradeLede, k.trickyTitle, k.trickyLede, k.tryTitle, k.lookAgain, k.biggerPlease,
                        k.wholeAnswer, k.cantCheck, k.buildingTitle, k.planTitle, k.planLede, k.save, k.handBackTitle, k.handBackLede,
                        k.waitingTitle, k.waitingLede, k.todayLabel, k.todayLine]
        for w in kidWords {
            let lower = w.lowercased()
            #expect(!lower.contains("wrong"), "\(w)")
            #expect(!lower.contains("trial"), "\(w)")
            #expect(!lower.contains("$"), "\(w)")
            #expect(!lower.contains("free"), "\(w)")
        }
    }

    @Test func latexInWords() {
        #expect(LatexWords.say("48 + 27 =", blank: true) == "48 plus 27 equals, blank.")
        #expect(LatexWords.say("\\frac{2}{7} + \\frac{3}{7}") == "2 over 7 plus 3 over 7")
        #expect(LatexWords.say("6 \\times 7") == "6 times 7")
    }
}

@Suite("The gate")
@MainActor
struct GateTests {
    let now = ISO8601DateFormatter().date(from: "2026-10-17T12:00:00Z")!

    @Test func grownUpsPassWithoutTheRuleBeingSaid() {
        let g = BirthYearGate()
        #expect(g.check("1985", now: now) == .open)
        #expect(g.check("2008", now: now) == .open)
    }

    @Test func twoMissesPauseForAMinute() {
        let g = BirthYearGate()
        #expect(g.check("2015", now: now) == .miss)
        if case .paused(let until) = g.check("2016", now: now) {
            #expect(until.timeIntervalSince(now) == 60)
        } else {
            Issue.record("expected a pause")
        }
        // a right answer while paused is still paused
        if case .paused = g.check("1985", now: now.addingTimeInterval(30)) {} else { Issue.record("expected still paused") }
        #expect(g.check("1985", now: now.addingTimeInterval(61)) == .open)
    }

    @Test func nonsenseIsAMiss() {
        let g = BirthYearGate()
        #expect(g.check("0000", now: now) == .miss)
    }
}

@Suite("Typed answers (\"Type it instead\")")
struct TypedAnswerTests {
    @Test func numbersAsKidsTypeThem() {
        #expect(LocalAnswerJudge.number("42") == 42)
        #expect(LocalAnswerJudge.number("x = 8") == 8)
        #expect(LocalAnswerJudge.number("3/4") == 0.75)
        #expect(LocalAnswerJudge.number("\\frac{5}{7}") == 5.0 / 7.0)
        #expect(LocalAnswerJudge.number("= 70") == 70)
        #expect(LocalAnswerJudge.number("\u{2212}3") == -3)
        #expect(LocalAnswerJudge.number("abc") == nil)
    }
}

@Suite("Kept on the iPad")
@MainActor
struct StoreTests {
    func temp() -> OnboardingStore {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return OnboardingStore(file: dir.appendingPathComponent("flow.json"), defaults: UserDefaults(suiteName: UUID().uuidString)!)
    }

    @Test func reopensWhereItWasForAWeek() {
        let store = temp()
        let now = Date()
        let s = OnboardingState(store: store, now: now)
        s.answers = OnboardingAnswers(role: .parent, name: "Sam", choice: .grade(3))
        s.go(to: .tricky, now: now)
        #expect(OnboardingState(store: store, now: now.addingTimeInterval(3600)).step == .tricky)
        #expect(OnboardingState(store: store, now: now.addingTimeInterval(8 * 86_400)).step == .hello)
    }

    @Test func theJourneyOutlivesTheFlow() {
        let store = temp()
        let s = OnboardingState(store: store)
        let journey = s.journeyId
        s.answers = OnboardingAnswers(role: .kid)
        s.go(to: .name)
        s.finish()
        #expect(store.read(now: Date()) == nil)
        #expect(OnboardingState(store: store).journeyId == journey)
        #expect(store.isFinished)
        #expect(!store.needsOnboarding)
    }

    @Test func noAnswerNoFlow() {
        let store = temp()
        let s = OnboardingState(store: store)
        s.go(to: .hello)
        #expect(store.read(now: Date()) == nil)
        #expect(store.needsOnboarding)
    }
}
