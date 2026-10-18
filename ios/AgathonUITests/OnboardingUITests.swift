import XCTest

/// The onboarding end to end (docs/ONBOARDING.md) against the LOCAL stack: both paths, the real
/// read and check (the Debug autowrite draws the answer through the canvas's own touch path; the
/// simulator has no Pencil), a real account, PIN, kid profile and first board. Skips unless
/// TEST_RUNNER_AGATHON_INTEGRATION=1 with the local stack's variables (see KitFlowUITests.swift):
///
///     TEST_RUNNER_AGATHON_INTEGRATION=1 TEST_RUNNER_AGATHON_API_URL=http://localhost:3601 \
///     TEST_RUNNER_SUPABASE_URL=http://127.0.0.1:54321 TEST_RUNNER_SUPABASE_ANON_KEY=<ANON_KEY> \
///     [TEST_RUNNER_ONBOARDING_SHOTS=<a folder for screenshots>] [TEST_RUNNER_ONBOARDING_PORTRAIT=1] \
///     xcodebuild test … -only-testing:AgathonUITests/OnboardingUITests -parallel-testing-enabled NO
final class OnboardingUITests: XCTestCase {
    private var app: XCUIApplication!
    private var shots: String?
    private var shot = 0
    private nonisolated(unsafe) static var autoFillOff = false

    override func setUpWithError() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard env["AGATHON_INTEGRATION"] == "1" else {
            throw XCTSkip("set TEST_RUNNER_AGATHON_INTEGRATION=1 and point it at the local stack")
        }
        shots = env["ONBOARDING_SHOTS"]
        if !Self.autoFillOff {
            turnOffPasswordAutoFill()
            Self.autoFillOff = true
        }
        XCUIDevice.shared.orientation = env["ONBOARDING_PORTRAIT"] == "1" ? .portrait : .landscapeLeft
    }

    private func launch(_ script: String, trial: String = "started") {
        let env = ProcessInfo.processInfo.environment
        app = XCUIApplication()
        for key in ["AGATHON_API_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"] {
            if let v = env[key] { app.launchEnvironment[key] = v }
        }
        app.launchArguments = ["-lab", "onboarding", "-onboardingFresh", "-onboardingMute",
                               "-onboardingAutowrite", script, "-onboardingTrial", trial]
        app.launch()
    }

    private func snap(_ name: String) {
        guard let shots else { return }
        shot += 1
        let data = XCUIScreen.main.screenshot().pngRepresentation
        let file = URL(fileURLWithPath: shots).appendingPathComponent(String(format: "%02d-%@.png", shot, name))
        try? data.write(to: file)
    }

    private func tap(_ id: String, wait: TimeInterval = 15, file: StaticString = #filePath, line: UInt = #line) {
        let e = app.descendants(matching: .any).matching(identifier: id).firstMatch
        XCTAssertTrue(e.waitForExistence(timeout: wait), "no \(id)", file: file, line: line)
        waitUntilHittable(e, wait)
        e.tap()
    }

    private func waitUntilHittable(_ e: XCUIElement, _ wait: TimeInterval) {
        let end = Date().addingTimeInterval(wait)
        while !e.isHittable && Date() < end { usleep(100_000) }
    }

    private func key(_ digits: String) {
        for d in digits {
            let k = app.buttons[String(d)].firstMatch
            XCTAssertTrue(k.waitForExistence(timeout: 10))
            k.tap()
            usleep(150_000)
        }
    }

    // MARK: - the grown-up holding the iPad, the trial started

    func testGrownUpPath() throws {
        launch("right")
        sleep(3)
        snap("hello")
        tap("onboarding.who.parent")
        let field = app.textFields["onboarding.name.field"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        sleep(1)
        field.tap()
        field.typeText("Sam")
        snap("name")
        tap("onboarding.name.continue")
        sleep(1)
        snap("name-reply")
        tap("onboarding.grade.3", wait: 20)
        sleep(1)
        snap("grade-chosen")
        tap("onboarding.skill.times_tables", wait: 20)
        tap("onboarding.skill.division_facts")
        sleep(1)
        snap("tricky")
        tap("onboarding.tricky.continue")
        sleep(2)
        snap("hand-to-kid")
        tap("onboarding.handToKid.go")
        sleep(3)
        snap("try-problem")
        // the autowrite writes the answer, the tutor reads and ticks it
        let next = app.descendants(matching: .any).matching(identifier: "onboarding.try.next").firstMatch
        XCTAssertTrue(next.waitForExistence(timeout: 60), "the tutor never ticked")
        sleep(1)
        snap("try-ticked")
        next.tap()
        sleep(1)
        snap("building")
        tap("onboarding.plan.save", wait: 20)
        sleep(1)
        snap("hand-back")
        tap("onboarding.handBack.grownUp")
        sleep(1)
        snap("gate")
        key("1985")
        try account()
        tap("onboarding.trial.start", wait: 30)
        try pinAndProfile()
    }

    // MARK: - a kid alone, a slip first, no grown-up at first, "Not now" on the trial

    func testKidAlonePathNotNow() throws {
        launch("wrong,right", trial: "started")
        sleep(3)
        tap("onboarding.who.kid")
        let field = app.textFields["onboarding.name.field"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        sleep(1)
        field.tap()
        field.typeText("Ava")
        tap("onboarding.name.continue")
        tap("onboarding.grade.1", wait: 20)
        sleep(4)
        snap("kid-try")
        let next = app.descendants(matching: .any).matching(identifier: "onboarding.try.next").firstMatch
        XCTAssertTrue(next.waitForExistence(timeout: 90), "the tutor never ticked")
        snap("kid-try-ticked")
        next.tap()
        tap("onboarding.plan.save", wait: 20)
        snap("kid-plan-saved")
        tap("onboarding.handBack.noGrownUp")
        sleep(2)
        snap("waiting")
        tap("onboarding.waiting.grownUp")
        key("1985")
        try account()
        tap("onboarding.trial.notNow", wait: 30)
        try pinAndProfile()
    }

    // MARK: - shared

    /// The Password AutoFill sheets cover the account form under automation (KitFlowUITests.swift):
    /// AutoFill off in the simulator's Settings.
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

    private func account() throws {
        let email = app.textFields["onboarding.account.email"].firstMatch
        XCTAssertTrue(email.waitForExistence(timeout: 20))
        sleep(1)
        snap("account")
        email.tap()
        email.typeText("qa+onboarding-\(UUID().uuidString.prefix(8).lowercased())@example.com")
        let password = app.secureTextFields["onboarding.account.password"].firstMatch
        password.tap()
        password.typeText("correct-horse-battery-9")
        tap("onboarding.account.consent")
        snap("account-filled")
        tap("onboarding.account.save")
        sleep(2)
        snap("trial")
    }

    private func pinAndProfile() throws {
        sleep(2)
        snap("pin")
        key("2468")
        sleep(1)
        key("2468")
        tap("onboarding.handOver.go", wait: 30)
        sleep(1)
        snap("picture")
        tap("onboarding.picture.tomato")
        tap("onboarding.picture.done")
        let go = app.descendants(matching: .any).matching(identifier: "onboarding.firstBoard.go").firstMatch
        XCTAssertTrue(go.waitForExistence(timeout: 60), "no first board")
        sleep(4)
        snap("first-board")
        go.tap()
    }
}
