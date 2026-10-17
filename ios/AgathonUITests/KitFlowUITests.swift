import XCTest

/// AgathonKit's flows driven through the app's debug screens, against the LOCAL stack only
/// (`npm run db:start`, `npm run db:seed`, `npm run dev`): sign in, the boards, a board made,
/// renamed and deleted, profile switching with the grown-up's PIN, sign out, sign-up.
///
/// Skipped unless AGATHON_INTEGRATION=1, so a plain `xcodebuild test` passes with no backend. The
/// same variables as AgathonKit's integration test, passed to the runner with TEST_RUNNER_:
///
///     TEST_RUNNER_AGATHON_INTEGRATION=1 \
///     TEST_RUNNER_AGATHON_API_URL=http://127.0.0.1:3101 \
///     TEST_RUNNER_SUPABASE_URL=http://127.0.0.1:54321 \
///     TEST_RUNNER_SUPABASE_ANON_KEY=<ANON_KEY from `npx supabase status -o env`> \
///     xcodebuild test -project ios/Agathon.xcodeproj -scheme Agathon \
///       -destination 'platform=iOS Simulator,name=iPad Pro 11-inch (M5)' -only-testing:AgathonUITests
///
/// Optional:
/// - AGATHON_QA_SHOTS_DIR: also write each checkpoint's screenshot there as PNG (they are always in
///   the result bundle: `xcrun xcresulttool export attachments --path <.xcresult> --output-path <dir>`).
/// - The family flow needs a grown-up with a plan, a PIN and a kid, which the seed does not make. Opt
///   in with AGATHON_QA_PARENT_EMAIL (+ AGATHON_QA_PARENT_PASSWORD, default password123;
///   AGATHON_QA_PIN; AGATHON_QA_KID, the kid's name). On the local stack, as that grown-up:
///     1. sign up (POST /auth/v1/signup with `data.terms_version`, or the app's Create account)
///     2. a plan row: `insert into public.unlimited_subscriptions (stripe_subscription_id, user_id,
///        status, trial_end, current_period_end, livemode) values ('sub_local_qa', '<user id>',
///        'trialing', now() + interval '7 days', now() + interval '7 days', false);` (psql, local only)
///     3. POST /api/family/pin {"pin":"2468"}, then POST /api/family/kids
///        {"displayName":"Maya","grade":3,"avatar":"fox"}
///
/// Simulator note: iOS's Password AutoFill sheets ("Use Strong Password?", "Save Password?") cover
/// the forms under automation and are not in the app's accessibility tree, so typing and taps go
/// astray. The first live test turns AutoFill off in the simulator's Settings (General > AutoFill &
/// Passwords > AutoFill Passwords and Passkeys); that stays off on that simulator afterwards.
final class KitFlowUITests: XCTestCase {
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
    }

    // MARK: the flows

    /// The seeded QA user: their boards with thumbnails and the ink; a board made, renamed and
    /// deleted through BoardsRepository; sign out.
    func testSeededUserBoards() {
        let app = launch()
        signOutIfSignedIn(app)
        fill(app, email: env["AGATHON_TEST_EMAIL"] ?? "qa-student@example.com", password: env["AGATHON_TEST_PASSWORD"] ?? "password123")
        snap("01-sign-in")
        app.buttons["signin.submit"].tap()
        boardsLoaded(app)
        let before = boardCount(app)
        snap("02-boards")

        app.buttons["boards.new"].tap()
        let first = app.descendants(matching: .any).matching(identifier: "boards.row").firstMatch
        wait(first, "Untitled Whiteboard")
        XCTAssertEqual(boardCount(app), before + 1)
        snap("03-new-board")

        first.swipeLeft()
        app.buttons["Rename"].tap()
        let field = app.alerts["Rename board"].textFields.firstMatch
        wait(field)
        field.tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 30) + "Made on the iPad")
        app.alerts["Rename board"].buttons["Save"].firstMatch.tap()
        wait(first, "Made on the iPad")
        snap("04-renamed")

        first.swipeLeft()
        app.buttons["Delete"].tap()
        let confirm = app.buttons["Delete board"]
        wait(confirm)
        confirm.tap()
        let count = NSPredicate(format: "label == %@", "\(before) board\(before == 1 ? "" : "s")")
        XCTAssertEqual(XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: count, object: app.staticTexts["boards.count"])], timeout: 20),
                       .completed, "the board was not deleted")

        app.buttons["boards.signOut"].tap()
        wait(app.textFields["signin.email"])
    }

    /// A family (opt-in, see above): the grown-up becomes the kid, then back with the PIN, one wrong
    /// try first.
    func testFamilyProfiles() throws {
        guard let parent = env["AGATHON_QA_PARENT_EMAIL"], !parent.isEmpty else {
            throw XCTSkip("set TEST_RUNNER_AGATHON_QA_PARENT_EMAIL for the family flow (its setup is at the top of this file)")
        }
        let kid = env["AGATHON_QA_KID"] ?? "Maya"
        let pin = env["AGATHON_QA_PIN"] ?? "2468"
        let app = launch()
        signOutIfSignedIn(app)
        fill(app, email: parent, password: env["AGATHON_QA_PARENT_PASSWORD"] ?? "password123")
        app.buttons["signin.submit"].tap()
        boardsLoaded(app)
        wait(app.staticTexts["boards.signedInAs"], "Grown-up")

        app.buttons["boards.switchProfile"].tap()
        let kidButton = app.buttons["switcher.member.\(kid)"]
        wait(kidButton)
        snap("05-profiles")

        kidButton.tap()
        wait(app.staticTexts["boards.signedInAs"], kid)
        boardsLoaded(app)
        snap("06-kid-profile")

        app.buttons["boards.switchProfile"].tap()
        let grownUp = app.buttons["switcher.member.Grown-up"]
        wait(grownUp)
        grownUp.tap()
        let pinField = app.secureTextFields["switcher.pin"]
        wait(pinField)
        pinField.tap()
        pinField.typeText(pin == "1111" ? "2222" : "1111")
        app.buttons["switcher.pinSubmit"].tap()
        wait(app.staticTexts["switcher.error"], "isn't right")
        snap("07-wrong-pin")

        pinField.tap()
        pinField.typeText(pin)
        app.buttons["switcher.pinSubmit"].tap()
        wait(app.staticTexts["boards.signedInAs"], "Grown-up")
        boardsLoaded(app)
        snap("08-back-to-grown-up")

        app.buttons["boards.signOut"].tap()
        wait(app.textFields["signin.email"])
        snap("09-signed-out")
    }

    /// A new account through the app's sign-up (terms_version sent): signed straight in, no boards.
    /// (The local stack does not ask for email confirmation.)
    func testSignUp() {
        let app = launch()
        signOutIfSignedIn(app)
        app.segmentedControls.buttons["Create account"].tap()
        fill(app, email: "ios-qa-signup-\(Int(Date().timeIntervalSince1970))@example.com", password: "password123")
        let consent = app.switches["signin.consent"]
        wait(consent)
        consent.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.5)).tap()
        XCTAssertEqual(consent.value as? String, "1")
        snap("10-sign-up")
        app.buttons["signin.submit"].tap()
        wait(app.descendants(matching: .any).matching(identifier: "boards.empty").firstMatch)
        boardsLoaded(app)
        snap("11-new-account")
        app.buttons["boards.signOut"].tap()
        wait(app.textFields["signin.email"])
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

    /// Settings > General > AutoFill & Passwords > AutoFill Passwords and Passkeys: off (see above).
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
        let off = NSPredicate(format: "value == '0'")
        XCTAssertEqual(XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: off, object: toggle)], timeout: 10), .completed,
                       "AutoFill Passwords is still on")
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
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("ipad-kit-\(name).png"))
        }
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

    private func signOutIfSignedIn(_ app: XCUIApplication) {
        let email = app.textFields["signin.email"]
        let signOut = app.buttons["boards.signOut"]
        let deadline = Date().addingTimeInterval(20)
        while Date() < deadline {
            if email.exists { return }
            if signOut.exists {
                signOut.tap()
                wait(email)
                return
            }
            Thread.sleep(forTimeInterval: 0.2)
        }
        XCTFail("neither the sign-in form nor the boards appeared")
    }

    private func fill(_ app: XCUIApplication, email: String, password: String) {
        let emailField = app.textFields["signin.email"]
        emailField.tap()
        emailField.typeText(email)
        let passwordField = app.secureTextFields["signin.password"]
        passwordField.tap()
        passwordField.typeText(password)
    }

    private func boardsLoaded(_ app: XCUIApplication) {
        let count = app.staticTexts["boards.count"]
        wait(count)
        let loaded = NSPredicate(format: "label MATCHES %@", "^[0-9]+ boards?$")
        XCTAssertEqual(XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: loaded, object: count)], timeout: 20), .completed,
                       "the boards never loaded: \(count.label)")
        wait(app.staticTexts["boards.ink"], "ink")
    }

    private func boardCount(_ app: XCUIApplication) -> Int {
        Int(app.staticTexts["boards.count"].label.split(separator: " ").first ?? "") ?? -1
    }
}
