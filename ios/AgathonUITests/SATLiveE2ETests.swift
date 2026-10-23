import XCTest

/// SAT v2 end to end against a LOCAL server with the REAL live services (no stubs): skipped unless
/// `AGATHON_E2E=1`. Run it in an integration step with a capped budget (it makes real recognize,
/// check and Help me calls), never against production:
///
///     AGATHON_E2E=1 AGATHON_API_URL=http://localhost:3901 SUPABASE_URL=… SUPABASE_ANON_KEY=… \
///     xcodebuild test-without-building … -only-testing:AgathonUITests/SATLiveE2ETests -parallel-testing-enabled NO
///
/// (the TEST_RUNNER_ prefix passes them to the app: `TEST_RUNNER_AGATHON_E2E`, `TEST_RUNNER_AGATHON_API_URL`, …).
///
/// The flow, as a student with no account (`POST /api/sat/anon`, the simulator's debug header):
///  1. the first run's "I'm studying for the SAT" → SAT home → Practice 10 (`/api/sat/next`, the bank's v2
///     notes, `tz`);
///  2. on question 1 the student writes the question's own first solution step in a student's hand
///     (`StudentHand`, through the canvas's touch path): the first ink claims the pass
///     (`/api/sat/tutor`), the line is read (`/api/live/recognize`, `sat_question_id`) and TICKED;
///  3. Help me twice: the nudge, then ONE step through the live Help me (`step live`, "Your turn");
///  4. the first question with a plane: a loop round its first labelled point → `sat_figure_marks`
///     ("circled near (…)") rides on the live bodies; the student writes a line, and the tutor reads it
///     with the marks in its context.
final class SATLiveE2ETests: XCTestCase {
    private var app: XCUIApplication!
    private let env = ProcessInfo.processInfo.environment

    override func setUpWithError() throws {
        try XCTSkipUnless(env["AGATHON_E2E"] == "1", "the end-to-end run needs AGATHON_E2E=1 and a local server (real live calls)")
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
    }

    override func tearDownWithError() throws {
        app?.terminate()
    }

    func testARealSATPageTicksHelpsAndReadsTheFigure() throws {
        app = XCUIApplication()
        app.launchArguments += ["-satLive", "-noLabs", "-onboardingFresh",
                                "-satAutowrite", "step:0|step:1|circle:auto|step:0"]
        for key in ["AGATHON_API_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"] {
            if let v = env[key] { app.launchEnvironment[key] = v }
        }
        app.launch()
        tap("onboarding.who.sat", wait: 60)
        XCTAssertTrue(element("sat.home").waitForExistence(timeout: 60), "SAT home with an anonymous session")
        tap("sat.home.practice10", wait: 30)
        XCTAssertTrue(element("board.canvas").waitForExistence(timeout: 60))
        waitFor("sat.position", label: "Q1 of", timeout: 30)
        probe("tutor ready live off")

        // 2. a right step in a student's hand: the pass, the read, the tick
        tap("sat.debug.write")
        probe("tutor on live on", timeout: 60)
        probe("read 1", timeout: 60)
        probe("ticks 1", timeout: 90)

        // 3. Help me: the nudge, then one step through the live tutor
        tap("sat.helpMe")
        probe("rung ", timeout: 10)
        tap("sat.helpMe")
        probe("rung 2", timeout: 10)
        probe("yourTurn yes", timeout: 90)
        probe("step live", timeout: 5)
        XCTAssertTrue(element("sat.yourTurn").exists)

        // 4. the first question with a plane: marks on it, read in its terms
        tap("sat.debug.write") // step:1 (more work on question 1: the next step)
        var found = false
        for _ in 0..<9 {
            tap("sat.next")
            sleep(2)
            if (element("sat.debug").value as? String ?? "").contains("plot yes") {
                found = true
                break
            }
        }
        try XCTSkipUnless(found, "the set had no question with a plane")
        tap("sat.debug.write") // circle:auto
        probe("marks On the question's graph the student drew: circled near", timeout: 30)
        tap("sat.debug.write") // a line on the plane's page: read with the marks beside sat_question_id
        probe("read 1", timeout: 90)
    }

    // MARK: - helpers

    private func probe(_ text: String, timeout: TimeInterval = 15, file: StaticString = #filePath, line: UInt = #line) {
        waitFor("sat.debug", value: text, timeout: timeout, file: file, line: line)
    }

    private func element(_ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func tap(_ id: String, wait: TimeInterval = 15, file: StaticString = #filePath, line: UInt = #line) {
        let e = element(id)
        XCTAssertTrue(e.waitForExistence(timeout: wait), "no \(id)", file: file, line: line)
        let end = Date().addingTimeInterval(wait)
        while !e.isHittable && Date() < end { usleep(100_000) }
        usleep(400_000)
        e.tap()
    }

    private func waitFor(_ id: String, label: String? = nil, value: String? = nil, timeout: TimeInterval,
                         file: StaticString = #filePath, line: UInt = #line) {
        let e = element(id)
        XCTAssertTrue(e.waitForExistence(timeout: timeout), "no \(id)", file: file, line: line)
        let predicate = value.map { NSPredicate(format: "value CONTAINS %@", $0) } ?? NSPredicate(format: "label CONTAINS %@", label ?? "")
        let result = XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: e)], timeout: timeout)
        XCTAssertEqual(result, .completed, "\(id) never said \(value ?? label ?? ""): \(e.value as? String ?? "nil")", file: file, line: line)
    }
}
