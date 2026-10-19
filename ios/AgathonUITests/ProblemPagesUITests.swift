import XCTest

/// Problem pages end to end on the LOCAL stack (docs/PROBLEM-PAGES.md): a 3-problem practice set, a
/// page each, checked when the kid is done.
///
///  1. Page 1 (`2x + 3 = 11`): an intermediate step (`2x = 8`) gets no mark while the kid works; the
///     answer in the answer spot (`x = 4`) checks the page: both ticked, solved, Next.
///  2. Page 2 (`3x - 5 = 10`): `3x = 15` is misread on purpose (`-liveMisread`: Mathpix reads the clean
///     fixture hand right) as `3 × = 15`; "I read" asks ("Is this right?"). The slip in the answer
///     spot (`x = 3`) is ringed only after the check, with one hint. The misread is fixed by a tap
///     (its chip → "Did you mean 3x = 15"): checked again at once, ticked.
///  3. Page 3 (`5x + 2 = 17`): solved; Next says All done; the All done page shows the set.
///
/// Real reads: about 6–10 recognize calls and one check (the hint), against `next dev` on the local
/// stack. Skipped unless TEST_RUNNER_AGATHON_INTEGRATION=1; refused unless every URL is this machine's:
///
///     TEST_RUNNER_AGATHON_INTEGRATION=1 TEST_RUNNER_AGATHON_API_URL=http://localhost:3991 \
///     TEST_RUNNER_SUPABASE_URL=http://127.0.0.1:54321 TEST_RUNNER_SUPABASE_ANON_KEY=<ANON_KEY> \
///     [TEST_RUNNER_AGATHON_QA_SHOTS_DIR=<a folder>] \
///     xcodebuild test … -only-testing:AgathonUITests/ProblemPagesUITests -parallel-testing-enabled NO
final class ProblemPagesUITests: XCTestCase {
    private var app: XCUIApplication!
    private let env = ProcessInfo.processInfo.environment
    private nonisolated(unsafe) static var autoFillOff = false

    override func setUpWithError() throws {
        continueAfterFailure = false
        try XCTSkipUnless(env["AGATHON_INTEGRATION"] == "1", "set TEST_RUNNER_AGATHON_INTEGRATION=1 and point it at the local stack")
        for key in ["AGATHON_API_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"] {
            let value = try XCTUnwrap(env[key], "\(key) is needed")
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

    func testAThreeProblemSetChecksWhenDone() throws {
        app = XCUIApplication()
        for key in ["AGATHON_API_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"] { app.launchEnvironment[key] = env[key] }
        app.launchArguments += [
            // this iPad finished its first run (the argument domain): sign-in, not the onboarding
            "-agathon.onboarding.finished", "YES",
            "-practiceProblems", "2x + 3 = 11|3x - 5 = 10|5x + 2 = 17",
            "-boardAutowrite", "2x = 8|answer:x = 4|3x = 15|answer:x = 3|5x = 15|answer:x = 3",
            "-liveMisread", "3x = 15=>3 \\times = 15",
        ]
        app.launch()
        signInIfNeeded(email: env["AGATHON_TEST_EMAIL"] ?? "qa-student@example.com", password: env["AGATHON_TEST_PASSWORD"] ?? "password123")
        tap("home.startPractice", wait: 40)
        XCTAssertTrue(element("board.canvas").waitForExistence(timeout: 40))
        // the set: a page a problem, then All done; the board on the first
        waitFor("debug.live", matching: #"page 1/3 .*screens 4"#, timeout: 90)
        waitFor("board.title", matching: "Problem 1 of 3", timeout: 10)
        snap("01-page")

        // 1 · an intermediate step: read, never marked while the kid works
        write("2x = 8")
        waitFor("debug.live", matching: #"read 2x = 8=read"#, timeout: 30)
        sleep(3)
        waitFor("debug.live", matching: #"2x = 8=none.*action check"#, timeout: 5)
        snap("02-working-quiet")
        // the answer, in the answer spot: the page is checked
        write("answer:x = 4")
        waitFor("debug.live", matching: #"2x = 8=tick.*x = 4=tick.*action next"#, timeout: 40)
        snap("03-solved-next")
        tap("live.next")

        // 2 · a misread and a slip
        waitFor("debug.live", matching: #"page 2/3"#, timeout: 20)
        write("3x = 15")
        waitFor("debug.live", matching: #"read 3 \\times = 15=asking"#, timeout: 30)
        write("answer:x = 3")
        // ringed only after the check (the answer spot's), with the one hint; the doubtful read is asked about, not ringed
        waitFor("debug.live", matching: #"x = 3=ring"#, timeout: 40)
        let probe = element("debug.live").label
        XCTAssertTrue(probe.contains("3 \\times = 15=none"), "a read in doubt is never ringed: \(probe)")
        XCTAssertTrue(element("live.hint").waitForExistence(timeout: 20), "no hint on the slip")
        snap("04-slip-ringed-after-check")
        if element("live.hint.gotIt").exists { element("live.hint.gotIt").tap() }
        // tap to fix: the chip, then "Did you mean 3x = 15"
        let chip = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "I read 3 × = 15")).firstMatch
        XCTAssertTrue(chip.waitForExistence(timeout: 10), "no I read chip for the misread")
        chip.tap()
        XCTAssertTrue(element("live.fix").waitForExistence(timeout: 10), "Fix what I read didn't open")
        let alt = element("live.fix.alt0")
        XCTAssertTrue(alt.waitForExistence(timeout: 15), "no reading offered")
        XCTAssertTrue(alt.label.contains("3x = 15"), "the first reading offered is \(alt.label)")
        snap("05-fix-sheet")
        alt.tap()
        waitFor("debug.live", matching: #"3x = 15=tick"#, timeout: 30)
        waitFor("debug.live", matching: #"read 3x = 15=fixed"#, timeout: 10)
        snap("06-fixed-rechecked")
        // on to the last (the slip is the kid's to work on; the dock's page arrow moves on)
        app.buttons["Next page"].firstMatch.tap()

        // 3 · solved, then All done
        waitFor("debug.live", matching: #"page 3/3"#, timeout: 20)
        write("5x = 15")
        write("answer:x = 3")
        waitFor("debug.live", matching: #"x = 3=tick.*action alldone"#, timeout: 40)
        snap("07-last-solved")
        tap("live.next")
        XCTAssertTrue(element("live.allDone").waitForExistence(timeout: 20), "no All done")
        waitFor("board.title", matching: "All done", timeout: 10)
        sleep(2)
        snap("08-all-done")
    }

    // MARK: helpers

    private func element(_ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func tap(_ id: String, wait: TimeInterval = 15, file: StaticString = #filePath, line: UInt = #line) {
        let e = element(id)
        XCTAssertTrue(e.waitForExistence(timeout: wait), "no \(id)", file: file, line: line)
        let end = Date().addingTimeInterval(wait)
        while !e.isHittable && Date() < end { usleep(100_000) }
        usleep(600_000)
        e.tap()
    }

    /// The autowrite's next line, written and finished.
    private func write(_ expected: String, file: StaticString = #filePath, line: UInt = #line) {
        let button = element("debug.autowrite")
        XCTAssertTrue(button.waitForExistence(timeout: 30), "no autowrite button", file: file, line: line)
        XCTAssertTrue(button.label.contains(expected), "the autowrite's next line is \(button.label), not \(expected)", file: file, line: line)
        button.tap()
        sleep(1)
        let idle = NSPredicate(format: "value != 'busy'")
        _ = XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: idle, object: button)], timeout: 30)
        sleep(1)
    }

    private func waitFor(_ id: String, matching regex: String, timeout: TimeInterval, file: StaticString = #filePath, line: UInt = #line) {
        let e = element(id)
        XCTAssertTrue(e.waitForExistence(timeout: timeout), "no \(id)", file: file, line: line)
        let predicate = NSPredicate(format: "label MATCHES %@", ".*\(regex).*")
        let result = XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: e)], timeout: timeout)
        XCTAssertEqual(result, .completed, "\(id) never matched \(regex): \(e.label)", file: file, line: line)
    }

    private func signInIfNeeded(email: String, password: String) {
        let submit = app.buttons["signin.submit"]
        let home = element("home.startPractice")
        let deadline = Date().addingTimeInterval(40)
        while Date() < deadline {
            if home.exists { return }
            if submit.exists {
                let field = app.textFields.firstMatch
                field.tap()
                field.typeText(email)
                let secure = app.secureTextFields.firstMatch
                secure.tap()
                secure.typeText(password)
                submit.tap()
                return
            }
            usleep(300_000)
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

    private func snap(_ name: String) {
        sleep(1)
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = env["AGATHON_QA_SHOTS_DIR"], !dir.isEmpty {
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("ipad-pages-\(name).png"))
        }
    }
}
