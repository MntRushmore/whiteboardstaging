import XCTest

/// A board end to end against the LOCAL stack (AgathonSync, docs/IPAD-NATIVE.md Phase 1): an old web
/// board opens converted, a stroke drawn on it autosaves (the row's doc and version), it reopens from
/// the doc, and a stroke left unsaved when the app is killed comes back from the device backup.
///
/// Skipped unless AGATHON_INTEGRATION=1, like KitFlowUITests (same TEST_RUNNER_ variables). Needs a
/// board titled "iPad sync QA: kid algebra" for the QA user (seeded from the board lane's fixtures:
/// docs/qa-screenshots/ipad-sync-*.png and the lane's report say how), on a database with
/// 20261017000000_agathon_doc.sql applied.
final class BoardSyncUITests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment
    private let boardTitle = "iPad sync QA: kid algebra"

    override func setUpWithError() throws {
        continueAfterFailure = false
        try XCTSkipUnless(env["AGATHON_INTEGRATION"] == "1", "set TEST_RUNNER_AGATHON_INTEGRATION=1 and point it at the local stack")
        for key in ["SUPABASE_URL"] {
            let host = URL(string: env[key] ?? "")?.host ?? ""
            try XCTSkipUnless(["127.0.0.1", "localhost"].contains(host), "\(key) must be the local stack, never production")
        }
    }

    func testOpenConvertDrawSaveReopenAndRestore() throws {
        turnOffPasswordAutoFill()
        var app = launch()
        signIn(app)
        openBoard(app)
        // the board screen's save pill (BoardScreen.swift): its words say "Saved", its value the detail
        // ("saved v3 converted written")
        var status = app.descendants(matching: .any).matching(identifier: "board.status").firstMatch
        waitValue(status, "saved")
        snap("01-opened")

        draw(app, y: 0.66)
        waitValue(status, "written", timeout: 30)
        snap("02-saved")

        app.buttons["board.back"].firstMatch.tap()
        openBoard(app)
        status = app.descendants(matching: .any).matching(identifier: "board.status").firstMatch
        wait(status, "saved")
        snap("03-reopened")

        // a stroke, then the app killed half a second after the backup and before the 2 s save
        draw(app, y: 0.70)
        Thread.sleep(forTimeInterval: 1.0)
        app.terminate()

        app = launch()
        openBoard(app)
        wait(app.descendants(matching: .any).matching(identifier: "board.notice").firstMatch, "put back")
        status = app.descendants(matching: .any).matching(identifier: "board.status").firstMatch
        waitValue(status, "written", timeout: 30)
        snap("04-restored")
    }

    // MARK: helpers

    /// iOS's Password AutoFill sheets cover the sign-in form under automation (KitFlowUITests does the same).
    private func turnOffPasswordAutoFill() {
        let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
        settings.launch()
        defer { settings.terminate() }
        let general = settings.staticTexts["General"].firstMatch
        guard general.waitForExistence(timeout: 15) else { return }
        general.tap()
        let autofill = settings.staticTexts["AutoFill & Passwords"].firstMatch
        guard autofill.waitForExistence(timeout: 10) else { return }
        autofill.tap()
        let toggle = settings.switches.matching(NSPredicate(format: "label BEGINSWITH 'AutoFill Passwords'")).firstMatch
        guard toggle.waitForExistence(timeout: 10) else { return }
        if toggle.value as? String == "1" { toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap() }
    }

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        for key in ["AGATHON_API_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"] {
            app.launchEnvironment[key] = env[key]
        }
        app.launch()
        return app
    }

    private func signIn(_ app: XCUIApplication) {
        let email = app.textFields["signin.email"]
        let boards = app.staticTexts["boards.count"]
        let deadline = Date().addingTimeInterval(20)
        while Date() < deadline, !email.exists, !boards.exists { Thread.sleep(forTimeInterval: 0.2) }
        guard email.exists else { return } // signed in already
        email.tap()
        email.typeText(env["AGATHON_TEST_EMAIL"] ?? "qa-student@example.com")
        let password = app.secureTextFields["signin.password"]
        password.tap()
        password.typeText(env["AGATHON_TEST_PASSWORD"] ?? "password123")
        app.buttons["signin.submit"].tap()
    }

    private func openBoard(_ app: XCUIApplication) {
        let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", boardTitle)).firstMatch
        wait(row, timeout: 30)
        row.tap()
        wait(app.descendants(matching: .any).matching(identifier: "board.canvas").firstMatch, timeout: 30)
    }

    /// A finger stroke across the screen (the simulator draws with a finger).
    private func draw(_ app: XCUIApplication, y: CGFloat) {
        let canvas = app.descendants(matching: .any).matching(identifier: "board.canvas").firstMatch
        let from = canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.30, dy: y))
        let to = canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.62, dy: y - 0.05))
        from.press(forDuration: 0.05, thenDragTo: to)
    }

    private func snap(_ name: String) {
        Thread.sleep(forTimeInterval: 1.0)
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = env["AGATHON_QA_SHOTS_DIR"], !dir.isEmpty {
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("ipad-sync-\(name).png"))
        }
    }

    private func waitValue(_ element: XCUIElement, _ value: String, timeout: TimeInterval = 20,
                           file: StaticString = #filePath, line: UInt = #line) {
        let predicate = NSPredicate(format: "value CONTAINS %@", value)
        XCTAssertEqual(XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: element)], timeout: timeout), .completed,
                       "\(element) never had \(value); it has \(element.value as? String ?? "nothing")", file: file, line: line)
    }

    private func wait(_ element: XCUIElement, _ label: String? = nil, timeout: TimeInterval = 20,
                      file: StaticString = #filePath, line: UInt = #line) {
        if let label {
            let predicate = NSPredicate(format: "label CONTAINS %@", label)
            XCTAssertEqual(XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: element)], timeout: timeout), .completed,
                           "\(element) never said \(label); it says \(element.exists ? element.label : "nothing")", file: file, line: line)
        } else {
            XCTAssertTrue(element.waitForExistence(timeout: timeout), "\(element) never appeared", file: file, line: line)
        }
    }
}
