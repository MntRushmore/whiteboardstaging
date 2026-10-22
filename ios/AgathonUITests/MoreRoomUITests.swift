import XCTest

/// "More room" end to end on the LOCAL stack (docs/PROBLEM-PAGES.md, "More room"): a 2-problem
/// practice set; a kid with big handwriting fills problem 1's page with two lines, taps More room,
/// and finishes on the new page.
///
///  1. Problem 1 (`2x + 3 = 11`): `2x + 3 = 11` and `2x = 8` in a big hand reach the last row: More
///     room shows in the page's corner (nothing is marked: the tutor checks when they're done).
///  2. More room: "Problem 1 · page 2 of 2", the problem again at the top, the answer spot there. The
///     answer in it (`x = 4`) checks both pages: ticked on page 2, page 1's steps ticked on page 1;
///     solved, Next.
///  3. Back to page 1: its ticks are there, and Next too (the problem is solved). Next goes past page
///     2 to problem 2; solved; All done.
///
/// Real calls: 5 recognize, no check (every step right). Skipped unless TEST_RUNNER_AGATHON_INTEGRATION=1;
/// refused unless every URL is this machine's:
///
///     TEST_RUNNER_AGATHON_INTEGRATION=1 TEST_RUNNER_AGATHON_API_URL=http://localhost:3981 \
///     TEST_RUNNER_SUPABASE_URL=http://127.0.0.1:54321 TEST_RUNNER_SUPABASE_ANON_KEY=<ANON_KEY> \
///     [TEST_RUNNER_AGATHON_QA_SHOTS_DIR=<a folder>] \
///     xcodebuild test … -only-testing:AgathonUITests/MoreRoomUITests -parallel-testing-enabled NO
final class MoreRoomUITests: XCTestCase {
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

    func testALongProblemGetsMoreRoomAndIsSolvedAcrossTwoPages() throws {
        app = XCUIApplication()
        for key in ["AGATHON_API_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"] { app.launchEnvironment[key] = env[key] }
        app.launchArguments += [
            "-agathon.onboarding.finished", "YES",
            "-noLabs",
            "-practiceProblems", "2x + 3 = 11|5x + 2 = 17",
            "-boardAutowrite", "big:2x + 3 = 11|big:2x = 8|answer:x = 4|5x = 15|answer:x = 3",
        ]
        app.launch()
        signInIfNeeded(email: env["AGATHON_TEST_EMAIL"] ?? "qa-student@example.com", password: env["AGATHON_TEST_PASSWORD"] ?? "password123")
        tap("home.startPractice", wait: 40)
        XCTAssertTrue(element("board.canvas").waitForExistence(timeout: 40))
        // the set: a page a problem, then All done
        waitFor("debug.live", matching: #"page 1/2 part 1/1 .*screens 3"#, timeout: 90)
        waitFor("board.title", matching: "Problem 1 of 2", timeout: 10)
        waitFor("debug.live", matching: "checking whenDone", timeout: 10)

        // 1 · big handwriting: two lines fill the page
        write("big:2x + 3 = 11")
        waitFor("debug.live", matching: #"room no"#, timeout: 10)
        write("big:2x = 8")
        waitFor("debug.live", matching: #"2 ?x ?= ?8=(read|asking|fixed)"#, timeout: 30)
        waitFor("debug.live", matching: #"room yes"#, timeout: 10)
        let quiet = element("debug.live").label
        XCTAssertFalse(quiet.contains("=tick") || quiet.contains("=ring"), "nothing is marked while the kid works: \(quiet)")
        XCTAssertTrue(element("live.moreRoom").waitForExistence(timeout: 10), "no More room")
        snap("1-page-full-more-room")

        // 2 · More room: the problem's second page
        tap("live.moreRoom")
        waitFor("debug.live", matching: #"page 1/2 part 2/2 .*screens 4"#, timeout: 20)
        waitFor("board.title", matching: "Problem 1, page 2 of 2", timeout: 10)
        waitFor("debug.live", matching: #"lines:  \|"#, timeout: 20)
        XCTAssertFalse(element("live.moreRoom").exists, "a fresh page has room")
        snap("2-page-2-continued")
        // the answer in page 2's answer spot checks both pages
        write("answer:x = 4")
        waitFor("debug.live", matching: #"x ?= ?4=tick.*action next"#, timeout: 40)
        snap("3-page-2-solved-next")

        // 3 · page 1: its steps were checked there; Next shows there too
        app.buttons["Page before"].firstMatch.tap()
        waitFor("debug.live", matching: #"part 1/2"#, timeout: 20)
        waitFor("board.title", matching: "Problem 1, page 1 of 2", timeout: 10)
        waitFor("debug.live", matching: #"2 ?x ?= ?8=tick.*action next"#, timeout: 20)
        let page1 = element("debug.live").label
        XCTAssertFalse(page1.contains("=ring"), "page 1's steps are right: \(page1)")
        snap("4-page-1-checked-next")
        // Next goes past page 2 to problem 2
        tap("live.next")
        waitFor("debug.live", matching: #"page 2/2 part 1/1"#, timeout: 20)
        waitFor("board.title", matching: "Problem 2 of 2", timeout: 10)
        write("5x = 15")
        write("answer:x = 3")
        waitFor("debug.live", matching: #"x ?= ?3=tick.*action alldone"#, timeout: 40)
        tap("live.next")
        XCTAssertTrue(element("live.allDone").waitForExistence(timeout: 20), "no All done")
        waitFor("board.title", matching: "All done", timeout: 10)
        sleep(2)
        snap("5-all-done")
        // the set is two problems, not three pages
        let stickers = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Problem '"))
        XCTAssertEqual(stickers.count, 2, "one sticker a problem: \(stickers.allElementsBoundByIndex.map(\.label))")
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
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("ipad-room-\(name).png"))
        }
    }
}
