import XCTest

// Messy kid sessions on the real board, against PRODUCTION with the training flag (docs/KID-SESSIONS.md):
// each test opens a new board as qa-bench@agathon.app (an admin: training calls spend no ink) and lets
// Debug's session player write a whole homework session in a synthetic hand — tilted, drifting,
// carries, scribbles, side-by-side problems, long thinks — tapping the board's real buttons when the
// kid would (Check, Help me, Got it, New page for this one, Keep it here, Now you try one). The player
// checks what the kid sees and writes its result to the app's Documents/kid-sessions/<run>/.
// `scripts/ios-kid-sessions.sh` runs them one by one (a screen recording each) and writes the report.
//
//     TEST_RUNNER_AGATHON_KID_SESSIONS=1 TEST_RUNNER_KID_EMAIL=qa-bench@agathon.app \
//     TEST_RUNNER_KID_PASSWORD=<Keychain "Agathon QA bench"> TEST_RUNNER_KID_RUN=<label> \
//     [TEST_RUNNER_KID_SHOTS=<dir>] xcodebuild test … -only-testing:AgathonUITests/KidSessionUITests/testS04
final class KidSessionUITests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment
    private var app: XCUIApplication!

    /// each session's call budget (its `KidSession.budget`)
    private static let budgets: [String: Int] = ["s04-slip-help": 30]

    override func setUpWithError() throws {
        continueAfterFailure = false
        try XCTSkipUnless(env["AGATHON_KID_SESSIONS"] == "1", "set TEST_RUNNER_AGATHON_KID_SESSIONS=1 (production, the QA bench account)")
        try XCTSkipUnless(env["KID_EMAIL"] == "qa-bench@agathon.app", "TEST_RUNNER_KID_EMAIL must be the QA bench account, never a real person's")
        try XCTSkipUnless((env["KID_PASSWORD"] ?? "").count >= 8, "TEST_RUNNER_KID_PASSWORD (Keychain \"Agathon QA bench\")")
        try XCTSkipIf(env["AGATHON_API_URL"] != nil || env["SUPABASE_URL"] != nil, "a production run names no local stack")
        XCUIDevice.shared.orientation = .landscapeLeft
    }

    /// Signs the QA bench account in (the Training Center's Debug sign-in), once per simulator.
    func test00SignIn() throws {
        app = XCUIApplication()
        app.launchEnvironment["AGATHON_TEST_EMAIL"] = env["KID_EMAIL"]
        app.launchEnvironment["AGATHON_TEST_PASSWORD"] = env["KID_PASSWORD"]
        app.launchArguments += ["-lab", "training", "-noLabs", "-onboardingMute"]
        app.launch()
        sleep(12)
        app.terminate()
        app = XCUIApplication()
        app.launchArguments += ["-noLabs", "-onboardingMute"]
        app.launch()
        XCTAssertTrue(element("boards.new").waitForExistence(timeout: 60), "not signed in to Home")
        snap("00-home")
    }

    func testS01() throws { try play("s01-carry") }
    func testS02() throws { try play("s02-borrow") }
    func testS03() throws { try play("s03-wander") }
    func testS04() throws { try play("s04-slip-help", reopen: true) }
    func testS05() throws { try play("s05-long-division") }
    func testS06() throws { try play("s06-side-by-side") }
    func testS07() throws { try play("s07-fractions") }
    func testS08() throws { try play("s08-decimals-scratch") }
    func testS09() throws { try play("s09-long-think") }
    func testS10() throws { try play("s10-staircase-keep") }
    func testS11() throws { try play("s11-negatives-erase", reopen: true) }
    func testS12() throws { try play("s12-word-edge") }

    // MARK: - one session

    private func play(_ id: String, reopen: Bool = false) throws {
        app = XCUIApplication()
        let budget = Self.budgets[id] ?? 20
        app.launchArguments += ["-noLabs", "-onboardingMute", "-kidSession", id, "-kidRun", env["KID_RUN"] ?? "run", "-liveTraining", "\(budget)"]
        app.launch()
        tap("boards.new", wait: 60)
        XCTAssertTrue(element("board.canvas").waitForExistence(timeout: 60), "the board never opened")
        let probe = element("debug.session")
        XCTAssertTrue(probe.waitForExistence(timeout: 60), "no session player (a Debug build with -kidSession)")
        var handled = 0
        let deadline = Date().addingTimeInterval(14 * 60)
        while Date() < deadline {
            let label = probe.label
            if label.hasPrefix("done") { break }
            let parts = label.split(separator: " ", maxSplits: 2).map(String.init)
            if parts.count == 3, parts[0] == "await", let seq = Int(parts[1]), seq > handled {
                handled = seq
                press(parts[2], id: id, seq: seq)
            }
            usleep(400_000)
        }
        let done = probe.label
        XCTAssertTrue(done.hasPrefix("done"), "\(id) never finished: \(done)")
        snap("\(id)-zz-final")
        // saved: the board's own status, then (when asked) closed and opened again with every stroke
        let status = element("board.status")
        if status.waitForExistence(timeout: 10) {
            _ = XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "value CONTAINS 'saved'"), object: status)], timeout: 60)
        }
        guard reopen, let ink = done.components(separatedBy: "ink ").last.flatMap({ Int($0.trimmingCharacters(in: .whitespaces)) }) else { return }
        sleep(4)
        app.terminate()
        app = XCUIApplication()
        app.launchArguments += ["-noLabs", "-onboardingMute"]
        app.launch()
        tap("boards.row", wait: 60)
        XCTAssertTrue(element("board.canvas").waitForExistence(timeout: 60), "the board never opened again")
        let live = element("debug.live")
        XCTAssertTrue(live.waitForExistence(timeout: 30))
        let same = XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", "| ink \(ink) |"), object: live)],
                                    timeout: 60)
        snap("\(id)-zz-reopened")
        XCTAssertEqual(same, .completed, "opened again with different ink: \(live.label) (wanted ink \(ink))")
    }

    /// The kid taps the board's button `buttonId`, then tells the player (`ack`), or says it was not there.
    private func press(_ buttonId: String, id: String, seq: Int) {
        let button = element(buttonId)
        var found = button.waitForExistence(timeout: 12)
        if found {
            let end = Date().addingTimeInterval(6)
            while !button.isHittable && Date() < end { usleep(150_000) }
            found = button.isHittable
        }
        if found {
            usleep(700_000)
            button.tap()
            snap("\(id)-tap\(seq)-\(buttonId)")
        }
        let reply = element(found ? "debug.session.ack" : "debug.session.missing")
        if reply.waitForExistence(timeout: 10) { reply.tap() }
    }

    // MARK: - helpers

    private func element(_ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func tap(_ id: String, wait: TimeInterval, file: StaticString = #filePath, line: UInt = #line) {
        let e = element(id)
        XCTAssertTrue(e.waitForExistence(timeout: wait), "no \(id)", file: file, line: line)
        let end = Date().addingTimeInterval(wait)
        while !e.isHittable && Date() < end { usleep(100_000) }
        usleep(900_000)
        e.tap()
    }

    private func snap(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = env["KID_SHOTS"], !dir.isEmpty {
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
    }
}
