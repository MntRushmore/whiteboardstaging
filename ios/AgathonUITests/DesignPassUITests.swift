import XCTest

/// The integration's design pass: every screen of the real flow, shot for review on the account the
/// kid journey made (local stack), in one variant per run:
///
///     TEST_RUNNER_JOURNEY_VARIANT=portrait TEST_RUNNER_JOURNEY_PORTRAIT=1 …
///     TEST_RUNNER_JOURNEY_VARIANT=split TEST_RUNNER_JOURNEY_ARGS="-windowWidth 507" …
///     TEST_RUNNER_JOURNEY_VARIANT=ax TEST_RUNNER_JOURNEY_ARGS="-UIPreferredContentSizeCategoryName UICTContentSizeCategoryAccessibilityXXXL" …
///
/// Screens: Home; the board with a line, its tick, a slip, a hint; Ask open; the grown-ups' help
/// settings; Progress; the board's pages. Shots go to JOURNEY_SHOTS as ipad-integrate-<variant>-*.png.
final class DesignPassUITests: XCTestCase {
    private var app: XCUIApplication!
    private let env = ProcessInfo.processInfo.environment

    override func setUpWithError() throws {
        continueAfterFailure = true
        try XCTSkipUnless(env["AGATHON_INTEGRATION"] == "1", "set TEST_RUNNER_AGATHON_INTEGRATION=1 and point it at the local stack")
        XCUIDevice.shared.orientation = env["JOURNEY_PORTRAIT"] == "1" ? .portrait : .landscapeLeft
    }

    func testEveryScreen() throws {
        app = XCUIApplication()
        for key in ["AGATHON_API_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"] {
            if let v = env[key] { app.launchEnvironment[key] = v }
        }
        let extra = (env["JOURNEY_ARGS"] ?? "").split(separator: " ").map(String.init)
        // -noLabs: Debug's Labs button off (it sat over Ask's Send in the corner)
        app.launchArguments = ["-noLabs", "-boardAutowrite", "newpage|2x + 3 = 11|2x = 8|x = 5"] + extra
        app.launch()
        XCTAssertTrue(element("home.greeting").waitForExistence(timeout: 40), "not on Home (run the kid journey first)")
        sleep(4)
        snap("01-home")
        app.swipeUp()
        sleep(1)
        snap("02-home-boards")
        app.swipeDown()

        // a new board: a line, its tick, a slip, Help me's hint
        tap("boards.new")
        XCTAssertTrue(element("board.canvas").waitForExistence(timeout: 40))
        sleep(3)
        snap("03-board-new")
        for line in ["newpage", "2x + 3 = 11", "2x = 8", "x = 5"] { write(line) }
        waitFor("debug.live", "=ring", timeout: 45)
        sleep(2)
        snap("04-board-ticked-ringed")
        tap("live.helpMe")
        if element("live.hint").waitForExistence(timeout: 45) {
            sleep(2)
            snap("05-board-hint")
            tap("live.hint.gotIt")
        }
        // the help level chooser
        if element("live.helpChoice").exists {
            tap("live.helpChoice")
            sleep(1)
            snap("06-help-choice")
            // close it by choosing what was chosen (a tap on the board would write a dot there)
            if element("live.helpChoice.hint").exists { tap("live.helpChoice.hint") }
        }
        // the grown-ups' help settings
        if element("live.grownUps").exists {
            tap("live.grownUps")
            sleep(1)
            snap("07-grown-ups-settings")
            let close = app.buttons["Close"].firstMatch
            if close.exists { close.tap() } else { app.tap() }
            sleep(1)
        }
        // Ask
        tap("ask.open")
        sleep(3)
        snap("08-ask-open")
        let input = element("ask.input")
        if input.waitForExistence(timeout: 10) {
            input.tap()
            sleep(2)
            snap("09-ask-keyboard")
            input.typeText("What does 2x mean?")
            tap("ask.send")
            let send = element("ask.send")
            _ = send.waitForExistence(timeout: 90)
            sleep(3)
            snap("10-ask-answered")
        }
        if element("ask.close").exists { tap("ask.close") }
        // the pages
        tap("board.title")
        sleep(2)
        snap("11-pages")
        // the pages sheet's own Close
        let closePages = app.buttons["Close"].firstMatch
        if closePages.waitForExistence(timeout: 5) { closePages.tap() }
        sleep(1)
        tap("board.back")

        // Progress
        if element("home.path").waitForExistence(timeout: 20) {
            tap("home.path")
            sleep(4)
            snap("12-progress")
            tap("area.close")
        }
    }

    // MARK: helpers

    private func element(_ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func tap(_ id: String, wait: TimeInterval = 20) {
        let e = element(id)
        XCTAssertTrue(e.waitForExistence(timeout: wait), "no \(id)")
        let end = Date().addingTimeInterval(wait)
        while !e.isHittable && Date() < end { usleep(100_000) }
        usleep(500_000)
        if e.isHittable { e.tap() }
    }

    private func write(_ expected: String) {
        let button = element("debug.autowrite")
        guard button.waitForExistence(timeout: 30), button.label.contains(expected) else {
            XCTFail("the autowrite isn't at \(expected): \(button.label)")
            return
        }
        button.tap()
        sleep(1)
        _ = XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false OR value != 'busy'"), object: button)], timeout: 30)
        sleep(1)
    }

    private func waitFor(_ id: String, _ label: String, timeout: TimeInterval) {
        let e = element(id)
        _ = e.waitForExistence(timeout: timeout)
        let ok = XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", label), object: e)], timeout: timeout)
        XCTAssertEqual(ok, .completed, "\(id) never said \(label): \(e.label)")
    }

    private func snap(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = env["JOURNEY_SHOTS"], !dir.isEmpty {
            let variant = env["JOURNEY_VARIANT"] ?? "landscape"
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("ipad-integrate-\(variant)-\(name).png"))
        }
    }
}
