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

    /// The pages with the grown-ups' switch back to "As they go" (the owner, 2026-10-19: "1 question per
    /// screen"; check when done is the default, and a grown-up can switch a board back): a 3-problem set
    /// is three pages and All done; "Problem n of 3"; each line ticked as soon as it is read; each page's
    /// lines judged against its own problem (`3x = 15` is right under `3x - 5 = 10`, and would be a slip
    /// under page 1's `2x + 3 = 11`); Next once solved; All done at the end. About 6 recognize calls.
    func testAThreeProblemSetIsAPageAProblem() throws {
        app = XCUIApplication()
        for key in ["AGATHON_API_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"] { app.launchEnvironment[key] = env[key] }
        app.launchArguments += [
            "-agathon.onboarding.finished", "YES",
            "-practiceProblems", "2x + 3 = 11|3x - 5 = 10|5x + 2 = 17",
            "-boardAutowrite", "2x = 8|x = 4|3x = 15|x = 5|5x = 15|x = 3",
        ]
        app.launch()
        signInIfNeeded(email: env["AGATHON_TEST_EMAIL"] ?? "qa-student@example.com", password: env["AGATHON_TEST_PASSWORD"] ?? "password123")
        tap("home.startPractice", wait: 40)
        XCTAssertTrue(element("board.canvas").waitForExistence(timeout: 40))
        waitFor("debug.live", matching: #"page 1/3 .*screens 4"#, timeout: 90)
        waitFor("board.title", matching: "Problem 1 of 3", timeout: 10)
        // the grown-ups' switch: this board checks as they go
        waitFor("debug.live", matching: "checking whenDone", timeout: 10)
        tap("live.grownUps")
        let asTheyGo = app.buttons["As they go"].firstMatch
        XCTAssertTrue(asTheyGo.waitForExistence(timeout: 10), "no As they go in the grown-ups' settings")
        asTheyGo.tap()
        waitFor("debug.live", matching: "checking asIGo", timeout: 10)
        let close = app.popovers.buttons["Close"].firstMatch
        (close.exists ? close : app.buttons["Close"].firstMatch).tap()
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: asTheyGo)
        XCTAssertEqual(XCTWaiter().wait(for: [gone], timeout: 10), .completed, "the grown-ups' settings stayed open")
        snap("L1-page-1")
        // page 1: a step and the answer, ticked as they go; solved: Next
        write("2x = 8")
        waitFor("debug.live", matching: #"2 ?x ?= ?8=tick"#, timeout: 40)
        write("x = 4")
        waitFor("debug.live", matching: #"x ?= ?4=tick.*action next"#, timeout: 40)
        snap("L2-page-1-solved-next")
        tap("live.next")
        // page 2: its own problem; page 1's lines are not here
        waitFor("debug.live", matching: #"page 2/3"#, timeout: 20)
        waitFor("board.title", matching: "Problem 2 of 3", timeout: 10)
        let fresh = element("debug.live").label
        XCTAssertFalse(fresh.contains("=tick"), "page 1's work came along to page 2: \(fresh)")
        write("3x = 15")
        waitFor("debug.live", matching: #"3 ?x ?= ?15=tick"#, timeout: 40)
        write("x = 5")
        waitFor("debug.live", matching: #"x ?= ?5=tick.*action next"#, timeout: 40)
        snap("L3-page-2-solved")
        tap("live.next")
        // page 3, then All done
        waitFor("debug.live", matching: #"page 3/3"#, timeout: 20)
        write("5x = 15")
        waitFor("debug.live", matching: #"5 ?x ?= ?15=tick"#, timeout: 40)
        write("x = 3")
        waitFor("debug.live", matching: #"x ?= ?3=tick.*action alldone"#, timeout: 40)
        snap("L4-page-3-solved")
        tap("live.next")
        XCTAssertTrue(element("live.allDone").waitForExistence(timeout: 20), "no All done")
        waitFor("board.title", matching: "All done", timeout: 10)
        sleep(2)
        snap("L5-all-done")
        XCTAssertFalse(element("live.helpMe").exists, "nothing to help with on All done")
        XCTAssertTrue(app.buttons["Back to my boards"].firstMatch.exists, "All done has its way home")
        // back to page 1: its ticks are still there, on its own page
        app.buttons["Page before"].firstMatch.tap()
        app.buttons["Page before"].firstMatch.tap()
        app.buttons["Page before"].firstMatch.tap()
        waitFor("debug.live", matching: #"page 1/3"#, timeout: 20)
        waitFor("debug.live", matching: #"2 ?x ?= ?8=tick.*x ?= ?4=tick"#, timeout: 20)
    }

    /// Check when done (the default), the answer spot, "I read" and tap to fix: problem pages' second
    /// part (`ProblemPagesRollout.secondPart`). About 6 recognize calls and one check (the hint).
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
        waitFor("debug.live", matching: #"read 2 ?x ?= ?8=read"#, timeout: 30)
        // well inside the 9 s pause that would check the page
        sleep(2)
        waitFor("debug.live", matching: #"2 ?x ?= ?8=none.*action check"#, timeout: 5)
        snap("02-working-quiet")
        // the answer, in the answer spot: the page is checked
        write("answer:x = 4")
        waitFor("debug.live", matching: #"2 ?x ?= ?8=tick.*x ?= ?4=tick.*action next"#, timeout: 40)
        snap("03-solved-next")
        tap("live.next")

        // 2 · a misread and a slip
        waitFor("debug.live", matching: #"page 2/3"#, timeout: 20)
        write("3x = 15")
        waitFor("debug.live", matching: #"read 3 \\times = 15=asking"#, timeout: 30)
        write("answer:x = 3")
        // ringed only after the check (the answer spot's), with the one hint; the doubtful read is asked about, not ringed
        waitFor("debug.live", matching: #"x ?= ?3=ring"#, timeout: 40)
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
        waitFor("debug.live", matching: #"x ?= ?3=tick.*action alldone"#, timeout: 40)
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

    /// The autowrite's next line, written and finished. A tap that did not start it fails here (once a
    /// missed tap went through to the board as a finger's dot, read as a line of its own).
    private func write(_ expected: String, file: StaticString = #filePath, line: UInt = #line) {
        let button = element("debug.autowrite")
        XCTAssertTrue(button.waitForExistence(timeout: 30), "no autowrite button", file: file, line: line)
        XCTAssertTrue(button.label.contains(expected), "the autowrite's next line is \(button.label), not \(expected)", file: file, line: line)
        let end = Date().addingTimeInterval(10)
        while !button.isHittable && Date() < end { usleep(100_000) }
        let before = button.value as? String
        button.tap()
        let started = NSPredicate(format: "value == 'busy' OR value != %@", before ?? "")
        XCTAssertEqual(XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: started, object: button)], timeout: 5), .completed,
                       "the tap on the autowrite did not start \(expected)", file: file, line: line)
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
