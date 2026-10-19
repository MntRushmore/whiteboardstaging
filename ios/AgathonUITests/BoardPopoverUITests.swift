import XCTest

/// iPadOS passes the tap that closes a popover on to what is under it. On the board that tap must
/// never write: closing the help chooser by tapping the board leaves the board as it was (the
/// screen covers the board while a Live popover is open), and a tap with nothing open still draws.
/// Runs on the account the kid journey made (local stack), like the design pass.
final class BoardPopoverUITests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment

    override func setUpWithError() throws {
        continueAfterFailure = false
        try XCTSkipUnless(env["AGATHON_INTEGRATION"] == "1", "set TEST_RUNNER_AGATHON_INTEGRATION=1 and point it at the local stack")
        XCUIDevice.shared.orientation = .landscapeLeft
    }

    func testClosingTheHelpChooserNeverWritesOnTheBoard() throws {
        let app = XCUIApplication()
        for key in ["AGATHON_API_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"] {
            if let v = env[key] { app.launchEnvironment[key] = v }
        }
        app.launchArguments = ["-noLabs"]
        app.launch()
        func element(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }
        XCTAssertTrue(element("home.greeting").waitForExistence(timeout: 40), "not on Home (run the kid journey first)")
        element("boards.new").tap()
        XCTAssertTrue(element("board.canvas").waitForExistence(timeout: 40))
        // the save pill's value carries the saved version: a stroke is a new one
        let status = element("board.status")
        XCTAssertTrue(waitForValue(status, matching: "^saved v[0-9]+", timeout: 20), "the new board never saved: \(status.value ?? "nil")")
        let before = String(describing: status.value ?? "")

        element("live.helpChoice").tap()
        XCTAssertTrue(element("live.helpChoice.hint").waitForExistence(timeout: 5), "the help chooser didn't open")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(waitForValue(element("live.helpChoice.hint"), gone: true), "the tap off the chooser didn't close it")
        sleep(5)
        XCTAssertEqual(String(describing: status.value ?? ""), before, "the tap that closed the chooser wrote on the board")

        // with nothing open, the same tap draws (the check above means something)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.4)).tap()
        XCTAssertTrue(waitForValue(status, notEqual: before, timeout: 20), "a tap on the board didn't draw")
        element("board.back").tap()
    }

    private func waitForValue(_ e: XCUIElement, matching pattern: String, timeout: TimeInterval) -> Bool {
        let p = NSPredicate(format: "value MATCHES %@", pattern + ".*")
        return XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: p, object: e)], timeout: timeout) == .completed
    }

    private func waitForValue(_ e: XCUIElement, notEqual value: String, timeout: TimeInterval) -> Bool {
        let p = NSPredicate(format: "value != %@", value)
        return XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: p, object: e)], timeout: timeout) == .completed
    }

    private func waitForValue(_ e: XCUIElement, gone: Bool) -> Bool {
        let p = NSPredicate(format: "exists == false")
        return XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: p, object: e)], timeout: 5) == .completed
    }
}
