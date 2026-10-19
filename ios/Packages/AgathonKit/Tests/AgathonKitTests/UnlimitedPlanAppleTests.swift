import Foundation
import Testing
@testable import AgathonKit

/// `ink_summary().unlimited`'s keys the iPad's Apple purchases need (the billing lane): the caller's
/// checkout reference (the purchase's appAccountToken), where the plan is billed, and a repeat trial.
struct UnlimitedPlanAppleTests {
    @Test func decodesTheCheckoutReferenceProviderAndRepeatTrial() throws {
        let json = #"""
        {"balance":12,"unlimited":{"status":"trialing","unlimited":true,"trial_end":"2026-10-24T12:00:00+00:00",
         "current_period_end":"2026-10-24T12:00:00+00:00","cancel_at_period_end":false,"cancel_at":null,
         "repeat_trial":false,"checkout_ref":"6F0D2B7E-9C3A-4E2F-8A51-1B2C3D4E5F60","provider":"apple"}}
        """#
        let plan = try #require(InkSummary.parse(Data(json.utf8))?.unlimited)
        #expect(plan.checkoutRef == UUID(uuidString: "6f0d2b7e-9c3a-4e2f-8a51-1b2c3d4e5f60"))
        #expect(plan.provider == "apple")
        #expect(plan.repeatTrial == false)
        #expect(plan.status == "trialing")
    }

    @Test func anOlderDatabaseWithoutThemStillDecodes() throws {
        let plan = try #require(InkSummary.parse(Data(#"{"balance":0,"unlimited":{"status":"none","unlimited":false}}"#.utf8))?.unlimited)
        #expect(plan.checkoutRef == nil)
        #expect(plan.provider == nil)
        #expect(plan.repeatTrial == nil)
        // a malformed ref is no ref, never a crash
        let bad = try #require(InkSummary.parse(Data(#"{"balance":0,"unlimited":{"status":"none","checkout_ref":"user-1"}}"#.utf8))?.unlimited)
        #expect(bad.checkoutRef == nil)
    }
}
