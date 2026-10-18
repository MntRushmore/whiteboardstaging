import XCTest

/// The Blocks screens (ios/Agathon/Screens) driven end to end against the LOCAL stack only: sign
/// in, Home in both orientations, a board opened from its tile and closed, rename and delete through
/// their sheets, a new account's empty Home, and the family switch with the grown-up's PIN.
///
/// Skipped unless AGATHON_INTEGRATION=1, and refused unless every URL is on this machine. Same
/// variables as KitFlowUITests (see the top of that file), plus AGATHON_QA_SHOTS_DIR to write each
/// checkpoint's screenshot as docs-ready PNGs (`ipad-screens-<name>.png`):
///
///     TEST_RUNNER_AGATHON_INTEGRATION=1 TEST_RUNNER_AGATHON_API_URL=http://127.0.0.1:3501 \
///     TEST_RUNNER_SUPABASE_URL=http://127.0.0.1:54321 TEST_RUNNER_SUPABASE_ANON_KEY=<ANON_KEY> \
///     TEST_RUNNER_AGATHON_QA_SHOTS_DIR=<dir> \
///     xcodebuild test -project ios/Agathon.xcodeproj -scheme Agathon -parallel-testing-enabled NO \
///       -destination 'platform=iOS Simulator,name=iPad (A16)' -only-testing:AgathonUITests/ScreensUITests
final class ScreensUITests: XCTestCase {
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

    override func tearDown() {
        XCUIDevice.shared.orientation = .landscapeLeft
        super.tearDown()
    }

    // MARK: the flows

    /// The seeded QA user: sign in, Home both ways round, open a board, back, rename and delete a
    /// new board through the sheets, sign out.
    func testSignInHomeAndBoards() {
        let app = launch()
        signOutIfSignedIn(app)
        snap("sign-in")
        signIn(app, email: env["AGATHON_TEST_EMAIL"] ?? "qa-student@example.com", password: env["AGATHON_TEST_PASSWORD"] ?? "password123")
        homeLoaded(app)
        snap("home-landscape")

        XCUIDevice.shared.orientation = .portrait
        Thread.sleep(forTimeInterval: 1.5)
        snap("home-portrait")
        XCUIDevice.shared.orientation = .landscapeLeft
        Thread.sleep(forTimeInterval: 1.5)

        // The board with the most on it opens converted.
        let tile = app.buttons.matching(identifier: "boards.row").element(boundBy: indexOfBoard(app, named: env["AGATHON_QA_BOARD"]))
        wait(tile)
        tile.tap()
        let canvas = app.descendants(matching: .any).matching(identifier: "board.canvas").firstMatch
        let failed = app.descendants(matching: .any).matching(identifier: "board.error").firstMatch
        XCTAssertTrue(waitForEither(canvas, failed, timeout: 30), "the board neither opened nor failed")
        XCTAssertTrue(canvas.exists, "the board didn't open")
        Thread.sleep(forTimeInterval: 1.5)
        snap("board-open")
        app.buttons["board.back"].firstMatch.tap()
        homeLoaded(app)

        // A new board opens straight away; back, then rename and delete it from its tile.
        let before = boardCount(app)
        app.buttons["boards.new"].tap()
        wait(app.descendants(matching: .any).matching(identifier: "board.canvas").firstMatch, timeout: 30)
        snap("board-new")
        app.buttons["board.back"].firstMatch.tap()
        homeLoaded(app)
        XCTAssertEqual(boardCount(app), before + 1)

        let first = app.buttons.matching(identifier: "boards.row").firstMatch
        wait(first, "Untitled Whiteboard")
        app.buttons.matching(identifier: "boards.more").firstMatch.tap()
        app.buttons["Rename"].tap()
        let field = app.textFields.matching(NSPredicate(format: "placeholderValue == %@", "Untitled board")).firstMatch
        wait(field)
        field.tap()
        field.typeText("Made on the iPad")
        snap("rename")
        app.buttons["boards.renameSave"].tap()
        wait(first, "Made on the iPad")

        app.buttons.matching(identifier: "boards.more").firstMatch.tap()
        app.buttons["Delete"].tap()
        let confirm = app.buttons["boards.confirmDelete"]
        wait(confirm)
        snap("delete")
        confirm.tap()
        let count = NSPredicate(format: "label == %@", "\(before) board\(before == 1 ? "" : "s")")
        XCTAssertEqual(XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: count, object: app.staticTexts["boards.count"])], timeout: 20),
                       .completed, "the board was not deleted")

        signOut(app)
    }

    /// A family (opt-in, see KitFlowUITests): the grown-up becomes the kid with a tap, then back with
    /// the PIN pad, one wrong try first.
    func testFamilySwitchWithThePinPad() throws {
        let parent = env["AGATHON_QA_PARENT_EMAIL"] ?? "ipad-kit-parent@example.com"
        let kid = env["AGATHON_QA_KID"] ?? "Maya"
        let pin = env["AGATHON_QA_PIN"] ?? "2468"
        let app = launch()
        signOutIfSignedIn(app)
        signIn(app, email: parent, password: env["AGATHON_QA_PARENT_PASSWORD"] ?? "password123")
        homeLoaded(app)
        snap("home-grown-up")

        app.buttons["boards.switchProfile"].tap()
        let kidButton = app.buttons["switcher.member.\(kid)"]
        wait(kidButton)
        snap("switcher")
        kidButton.tap()
        wait(app.staticTexts["home.greeting"], "Hi \(kid).")
        homeLoaded(app)
        snap("home-kid")

        app.buttons["home.grownUps"].tap()
        wait(app.buttons["1"])
        let wrong = pin == "1111" ? "2222" : "1111"
        for digit in wrong { app.buttons[String(digit)].tap() }
        wait(app.staticTexts["switcher.error"], "isn't right")
        snap("pin-look-again")
        for digit in pin { app.buttons[String(digit)].tap() }
        wait(app.staticTexts["home.greeting"])
        homeLoaded(app)
        XCTAssertFalse(app.staticTexts["home.greeting"].label.contains(kid))
        signOut(app)
    }

    /// A new account through the app's sign-up (terms_version sent): signed straight in, the empty
    /// Home with the shapes waving hello.
    func testSignUpLandsOnTheEmptyHome() {
        let app = launch()
        signOutIfSignedIn(app)
        app.buttons["Create account"].firstMatch.tap()
        fill(app, email: "ios-screens-\(Int(Date().timeIntervalSince1970))@example.com", password: "password123")
        let consent = app.buttons["signin.consent"]
        wait(consent)
        consent.tap()
        snap("sign-up")
        app.buttons["signin.submit"].tap()
        wait(app.descendants(matching: .any).matching(identifier: "boards.empty").firstMatch, timeout: 30)
        snap("home-empty")
        signOut(app)
    }

    // MARK: helpers

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        for key in ["AGATHON_API_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"] {
            app.launchEnvironment[key] = env[key]
        }
        app.launch()
        return app
    }

    private func signIn(_ app: XCUIApplication, email: String, password: String) {
        fill(app, email: email, password: password)
        app.buttons["signin.submit"].tap()
    }

    private func fill(_ app: XCUIApplication, email: String, password: String) {
        let emailField = app.textFields.firstMatch
        wait(emailField)
        emailField.tap()
        emailField.typeText(email)
        let passwordField = app.secureTextFields.firstMatch
        passwordField.tap()
        passwordField.typeText(password)
    }

    private func signOut(_ app: XCUIApplication) {
        app.buttons["boards.switchProfile"].tap()
        let signOut = app.buttons["boards.signOut"]
        wait(signOut)
        signOut.tap()
        wait(app.buttons["signin.submit"])
    }

    private func signOutIfSignedIn(_ app: XCUIApplication) {
        let submit = app.buttons["signin.submit"]
        let chip = app.buttons["boards.switchProfile"]
        let deadline = Date().addingTimeInterval(30)
        while Date() < deadline {
            if submit.exists { return }
            if chip.exists {
                signOut(app)
                return
            }
            Thread.sleep(forTimeInterval: 0.3)
        }
        XCTFail("neither sign-in nor Home appeared")
    }

    private func homeLoaded(_ app: XCUIApplication) {
        let count = app.staticTexts["boards.count"]
        wait(count)
        let loaded = NSPredicate(format: "label MATCHES %@", "^[0-9]+ boards?$")
        XCTAssertEqual(XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: loaded, object: count)], timeout: 30), .completed,
                       "the boards never loaded: \(count.label)")
        // The thumbnails and the ink settle.
        Thread.sleep(forTimeInterval: 1.0)
    }

    private func boardCount(_ app: XCUIApplication) -> Int {
        Int(app.staticTexts["boards.count"].label.split(separator: " ").first ?? "") ?? -1
    }

    /// The tile whose label starts with `name`, else the first.
    private func indexOfBoard(_ app: XCUIApplication, named name: String?) -> Int {
        guard let name, !name.isEmpty else { return 0 }
        let tiles = app.buttons.matching(identifier: "boards.row").allElementsBoundByIndex
        return tiles.firstIndex { $0.label.hasPrefix(name) } ?? 0
    }

    private func waitForEither(_ a: XCUIElement, _ b: XCUIElement, timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if a.exists || b.exists { return true }
            Thread.sleep(forTimeInterval: 0.3)
        }
        return false
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

    /// A checkpoint's screenshot: in the result bundle, and in AGATHON_QA_SHOTS_DIR when set.
    private func snap(_ name: String) {
        Thread.sleep(forTimeInterval: 1.0)
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = env["AGATHON_QA_SHOTS_DIR"], !dir.isEmpty {
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("ipad-screens-\(name).png"))
        }
    }

    /// Settings > General > AutoFill & Passwords > AutoFill Passwords and Passkeys: off (its sheets
    /// cover the form under automation; see KitFlowUITests).
    private func turnOffPasswordAutoFill() {
        let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
        settings.launch()
        defer { settings.terminate() }
        let general = settings.staticTexts["General"].firstMatch
        guard general.waitForExistence(timeout: 15) else { return XCTFail("Settings: no General") }
        general.tap()
        let autofill = settings.staticTexts["AutoFill & Passwords"].firstMatch
        guard autofill.waitForExistence(timeout: 10) else { return XCTFail("Settings: no AutoFill & Passwords") }
        autofill.tap()
        let toggle = settings.switches.matching(NSPredicate(format: "label BEGINSWITH 'AutoFill Passwords'")).firstMatch
        guard toggle.waitForExistence(timeout: 10) else { return XCTFail("Settings: no AutoFill Passwords switch") }
        if toggle.value as? String == "1" {
            toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        }
    }
}
