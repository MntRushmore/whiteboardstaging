import Foundation
import Testing
@testable import AgathonOnboarding

/// The grown-up's part never runs on a kid's profile (the owner's iPad, 2026-10-20: "I'm unable to
/// set my PIN" was the PIN step posted from a demo family's kid, refused 403 `kid`). The order is
/// account → trial → PIN → the kid's profile → the switch, and each needs the grown-up's session.
@Suite("Who is signed in, for the grown-up's part")
struct GrownUpSessionTests {
    let sam = MadeKid(userId: "k-sam", displayName: "Sam")
    let leo = MadeKid(userId: "k-leo", displayName: "Leo")

    @Test func theGateLeadsToTheAccountWhenSignedOut() {
        #expect(FlowRules.afterGate(.signedOut, hasPlan: false) == .account)
    }

    @Test func theGateLeadsAGrownUpOnInOrder() {
        // a new account: the trial first, then the PIN
        #expect(FlowRules.afterGate(.grownUp(hasPin: false, kids: []), hasPlan: false) == .trial)
        // the plan already: the PIN, or past it when it's set
        #expect(FlowRules.afterGate(.grownUp(hasPin: false, kids: []), hasPlan: true) == .pin)
        #expect(FlowRules.afterGate(.grownUp(hasPin: true, kids: [leo]), hasPlan: true) == .handOver)
    }

    @Test func aKidsProfileAtTheGateSignsTheGrownUpIn() {
        // never the trial or the PIN on a kid's session: the grown-up signs in over it
        #expect(FlowRules.afterGate(.kid(leo), hasPlan: false) == .signIn)
        #expect(FlowRules.afterGate(.kid(leo), hasPlan: true) == .signIn)
    }

    @Test func notKnowingWhoStaysAtTheGate() {
        #expect(FlowRules.afterGate(.unknown, hasPlan: false) == nil)
    }

    @Test func aFlowReopenedOnAKidsProfileGoesBackToThePlan() {
        for step in [OnboardingStep.trial, .pin, .handOver, .addToFamily] {
            #expect(FlowRules.grownUpScreen(step, .kid(leo)) == .plan, "\(step)")
            #expect(FlowRules.grownUpScreen(step, .signedOut) == .plan, "\(step)")
            #expect(FlowRules.grownUpScreen(step, .grownUp(hasPin: false, kids: [])) == step, "\(step)")
        }
        // the kid's own screens are the kid's
        #expect(FlowRules.grownUpScreen(.kidProfile, .kid(sam)) == .kidProfile)
        #expect(FlowRules.grownUpScreen(.firstBoard, .kid(sam)) == .firstBoard)
    }

    @Test func theKidIsAddedOnceAndSwitchedTo() {
        // the usual case: a grown-up with no kids adds Sam, then becomes Sam
        #expect(FlowRules.kidPlan(made: nil, name: "Sam", .grownUp(hasPin: true, kids: [])) == .add)
        // the add went through, the switch didn't (offline): switch, never add again (a second add
        // without the plan is `plan_required`)
        #expect(FlowRules.kidPlan(made: sam, name: "Sam", .grownUp(hasPin: true, kids: [sam])) == .become("k-sam"))
        // the app closed between the add and the switch: Sam is in the family already
        #expect(FlowRules.kidPlan(made: nil, name: "sam ", .grownUp(hasPin: true, kids: [leo, sam])) == .become("k-sam"))
    }

    @Test func anIPadAlreadyOnTheKidCarriesOn() {
        // the app closed after the switch: the iPad is Sam's now
        #expect(FlowRules.kidPlan(made: nil, name: "Sam", .kid(sam)) == .already("k-sam"))
        #expect(FlowRules.kidPlan(made: sam, name: "Sam", .kid(sam)) == .already("k-sam"))
        // no name typed: the flow's kid is "Me"
        #expect(FlowRules.kidPlan(made: nil, name: nil, .kid(MadeKid(userId: "k-me", displayName: "Me"))) == .already("k-me"))
    }

    @Test func anotherKidsProfileNeedsTheGrownUp() {
        #expect(FlowRules.kidPlan(made: nil, name: "Sam", .kid(leo)) == .needsGrownUp)
        #expect(FlowRules.kidPlan(made: sam, name: "Sam", .kid(leo)) == .needsGrownUp)
        #expect(FlowRules.kidPlan(made: nil, name: "Sam", .signedOut) == .needsGrownUp)
    }
}
