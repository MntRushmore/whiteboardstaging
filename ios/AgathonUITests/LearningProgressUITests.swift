import XCTest

/// The learning record end to end on the LOCAL stack only: the Progress page's numbers before, a
/// Live Lab session (the kid's handwriting replayed through the real canvas, read by the real
/// recognizer, judged by the brain, the attempts saved by AgathonLive as the signed-in student),
/// and the Progress page's numbers after. About 3–4 recognizer reads (and one check): a few cents.
///
/// Skipped unless AGATHON_INTEGRATION=1; refused unless every URL is on this machine. Same
/// variables as ScreensUITests (AGATHON_API_URL is the dev server: the Lab reads the ink through
/// it), plus AGATHON_QA_SHOTS_DIR for the screenshots (`ipad-learning-<name>.png`):
///
///     TEST_RUNNER_AGATHON_INTEGRATION=1 TEST_RUNNER_AGATHON_API_URL=http://localhost:3951 \
///     TEST_RUNNER_SUPABASE_URL=http://127.0.0.1:54321 TEST_RUNNER_SUPABASE_ANON_KEY=<ANON_KEY> \
///     xcodebuild test … -only-testing:AgathonUITests/LearningProgressUITests
final class LearningProgressUITests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment
    private nonisolated(unsafe) static var autoFillOff = false

    override func setUpWithError() throws {
        continueAfterFailure = false
        try XCTSkipUnless(env["AGATHON_INTEGRATION"] == "1",
                          "set TEST_RUNNER_AGATHON_INTEGRATION=1 and point it at the local stack")
        for key in ["AGATHON_API_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"] {
            let value = try XCTUnwrap(env[key], "\(key) is needed for the live flows")
            if key != "SUPABASE_ANON_KEY" {
                let host = URL(string: value)?.host ?? ""
                try XCTSkipUnless(["127.0.0.1", "localhost"].contains(host), "\(key) must be the local stack, never production")
            }
        }
        if !Self.autoFillOff {
            turnOffPasswordAutoFill()
            Self.autoFillOff = true
        }
        XCUIDevice.shared.orientation = .landscapeLeft
    }

    func testTheProgressPagesNumbersMoveAfterALiveLabSession() throws {
        let email = env["AGATHON_TEST_EMAIL"] ?? "qa-student@example.com"
        let password = env["AGATHON_TEST_PASSWORD"] ?? "password123"

        // 1. Progress before
        var app = launch()
        signOutIfSignedIn(app)
        signIn(app, email: email, password: password)
        homeLoaded(app)
        let before = progress(app, snapAs: "progress-before")
        app.terminate()

        // 2. a Live Lab session: the slip (2x + 3 = 11, 2x = 8 ticked, x = 5 ringed), then the fix
        app = launch(extra: ["-liveLab", "-liveLabDemo", "slip"])
        // the demo writes for ~15 s and waits for the tutor; the record saves 5 s after its last change
        // the recognizer's spacing varies ("x = 5" or "x=5"): match either
        let read = app.staticTexts.matching(NSPredicate(format: "label MATCHES %@", #".*x ?= ?5 \[.*"#)).firstMatch
        XCTAssertTrue(read.waitForExistence(timeout: 90), "the Lab never read the kid's last line")
        Thread.sleep(forTimeInterval: 12)
        snap("live-lab")
        // closing the Lab closes its board: what is left is saved now
        let close = app.buttons["Close"].firstMatch
        if close.waitForExistence(timeout: 5) { close.tap() }
        Thread.sleep(forTimeInterval: 4)
        app.terminate()

        // 3. Progress after
        app = launch()
        homeLoaded(app)
        let after = progress(app, snapAs: "progress-after")
        XCTAssertGreaterThan(after, before, "the Progress page's problems worked on this week moved: \(before) → \(after)")
        app.terminate()
    }

    // MARK: helpers

    /// Opens Progress (the profile chip's "My progress"), returns "problems worked on" this week.
    private func progress(_ app: XCUIApplication, snapAs name: String) -> Int {
        app.buttons["boards.switchProfile"].tap()
        let mine = app.buttons["switcher.mine"]
        wait(mine)
        mine.tap()
        let page = app.descendants(matching: .any).matching(identifier: "progress.page").firstMatch
        wait(page, timeout: 30)
        Thread.sleep(forTimeInterval: 3)
        let tile = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "problems worked on")).firstMatch
        let value: Int
        if tile.waitForExistence(timeout: 10) {
            value = Int(tile.label.prefix { $0.isNumber }) ?? -1
        } else {
            // a student with nothing yet: the empty state
            value = 0
        }
        snap(name)
        app.buttons["area.close"].firstMatch.tap()
        homeLoaded(app)
        return value
    }

    private func launch(extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        for key in ["AGATHON_API_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"] {
            app.launchEnvironment[key] = env[key]
        }
        // the Lab signs the QA user in when signed out
        app.launchEnvironment["AGATHON_TEST_EMAIL"] = env["AGATHON_TEST_EMAIL"] ?? "qa-student@example.com"
        app.launchEnvironment["AGATHON_TEST_PASSWORD"] = env["AGATHON_TEST_PASSWORD"] ?? "password123"
        app.launchArguments += extra
        app.launch()
        return app
    }

    private func signIn(_ app: XCUIApplication, email: String, password: String) {
        let emailField = app.textFields.firstMatch
        wait(emailField)
        emailField.tap()
        emailField.typeText(email)
        let passwordField = app.secureTextFields.firstMatch
        passwordField.tap()
        passwordField.typeText(password)
        app.buttons["signin.submit"].tap()
    }

    private func signOutIfSignedIn(_ app: XCUIApplication) {
        let submit = app.buttons["signin.submit"]
        let chip = app.buttons["boards.switchProfile"]
        let deadline = Date().addingTimeInterval(30)
        while Date() < deadline {
            if submit.exists { return }
            if chip.exists {
                chip.tap()
                let signOut = app.buttons["boards.signOut"]
                wait(signOut)
                signOut.tap()
                wait(submit)
                return
            }
            Thread.sleep(forTimeInterval: 0.3)
        }
        XCTFail("neither sign-in nor Home appeared")
    }

    private func homeLoaded(_ app: XCUIApplication) {
        let count = app.staticTexts["boards.count"]
        wait(count, timeout: 30)
        let loaded = NSPredicate(format: "label MATCHES %@", "^[0-9]+ boards?$")
        XCTAssertEqual(XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: loaded, object: count)], timeout: 30), .completed,
                       "the boards never loaded: \(count.label)")
        Thread.sleep(forTimeInterval: 1.0)
    }

    private func wait(_ element: XCUIElement, timeout: TimeInterval = 20, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: timeout), "\(element) never appeared", file: file, line: line)
    }

    private func snap(_ name: String) {
        Thread.sleep(forTimeInterval: 1.0)
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = env["AGATHON_QA_SHOTS_DIR"], !dir.isEmpty {
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("ipad-learning-\(name).png"))
        }
    }

    /// Settings > General > AutoFill & Passwords > AutoFill Passwords and Passkeys: off (see KitFlowUITests).
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
        if toggle.value as? String == "1" {
            toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        }
    }
}
