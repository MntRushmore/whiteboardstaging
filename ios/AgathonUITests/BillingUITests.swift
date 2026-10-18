import StoreKitTest
import XCTest

/// Agathon Unlimited through StoreKit's local test environment, driven through the app's screens
/// (Billing Lab, the parental gate, the plan), against the LOCAL stack only. Skipped unless
/// AGATHON_INTEGRATION=1 (see KitFlowUITests for the variables).
final class BillingUITests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment

    override func setUpWithError() throws {
        continueAfterFailure = false
        try XCTSkipUnless(env["AGATHON_INTEGRATION"] == "1", "set TEST_RUNNER_AGATHON_INTEGRATION=1 and point it at the local stack")
    }

    func testTheProductLoadsFromTheStoreKitConfiguration() throws {
        let session = try SKTestSession(configurationFileNamed: "Agathon")
        session.resetToDefaultState()
        session.disableDialogs = true
        session.clearTransactions()
        let app = XCUIApplication()
        for key in ["AGATHON_API_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"] { app.launchEnvironment[key] = env[key] }
        app.launchArguments = ["-billingScreen", "lab"]
        app.launch()
        let price = app.staticTexts["$24.99 a month"]
        XCTAssertTrue(price.waitForExistence(timeout: 30), "the product never loaded from Agathon.storekit")
    }
}
