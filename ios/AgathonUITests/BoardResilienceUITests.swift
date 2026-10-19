import XCTest

/// The board holding up (the integration's QA, against the LOCAL stack, on the account the kid
/// journey made: run after `KidJourneyUITests/test1Journey`):
///  - the network lost mid-board: the tutor's lines wait, saving pauses and says so, both resume when
///    it is back (`NETCUT_FLAG`: the runner's proxy cuts every connection while the file exists; the
///    app is pointed at the proxy);
///  - the app killed a moment after a line, before the save: the line comes back from the device
///    backup and is saved;
///  - the app sent to the background and brought back: saved at once, the tutor still on the board;
///  - the iPad turned while Ask's answer streams: the panel moves (docked ↔ sheet) and the answer
///    finishes.
/// Skipped unless TEST_RUNNER_AGATHON_INTEGRATION=1 (see KidJourneyUITests).
final class BoardResilienceUITests: XCTestCase {
    private var app: XCUIApplication!
    private let env = ProcessInfo.processInfo.environment

    override func setUpWithError() throws {
        continueAfterFailure = false
        try XCTSkipUnless(env["AGATHON_INTEGRATION"] == "1", "set TEST_RUNNER_AGATHON_INTEGRATION=1 and point it at the local stack")
        let host = URL(string: env["SUPABASE_URL"] ?? "")?.host ?? ""
        try XCTSkipUnless(["127.0.0.1", "localhost"].contains(host), "SUPABASE_URL must be the local stack, never production")
        XCUIDevice.shared.orientation = .landscapeLeft
    }

    override func tearDown() {
        if let flag = env["NETCUT_FLAG"] { try? FileManager.default.removeItem(atPath: flag) }
        super.tearDown()
    }

    // MARK: - the network lost and found

    func testNetworkLostAndFound() throws {
        let flag = try XCTUnwrap(env["NETCUT_FLAG"], "needs the runner's proxy (NETCUT_FLAG, NETCUT_API_URL, NETCUT_SUPABASE_URL)")
        launch(["-boardAutowrite", "newpage|3x - 5 = 10|3x = 15"], proxied: true)
        openNewBoard()
        write("newpage")
        write("3x - 5 = 10")
        waitFor("debug.live", label: "10=", timeout: 40)
        waitFor("board.status", value: "saved", timeout: 40)
        // the network goes
        FileManager.default.createFile(atPath: flag, contents: Data())
        write("3x = 15")
        sleep(4)
        snap("resilience-01-offline")
        let status = element("board.status")
        XCTAssertFalse((status.value as? String ?? "").hasPrefix("saved"), "says saved with the network gone: \(status.value as? String ?? "")")
        XCTAssertNil(element("debug.live").label.range(of: #"3 ?x ?= ?15=tick"#, options: .regularExpression), "a line was read with the network gone")
        // …and comes back: the line is read and ticked, the board saved
        try FileManager.default.removeItem(atPath: flag)
        if element("board.retry").exists { element("board.retry").tap() }
        waitFor("debug.live", label: "15=tick", timeout: 90)
        waitFor("board.status", value: "saved", timeout: 90)
        snap("resilience-02-back-online")
        tap("board.back")
    }

    // MARK: - killed before the save: the backup puts it back

    func testKilledBeforeTheSaveComesBack() throws {
        launch(["-boardAutowrite", "newpage|5x + 2 = 17"])
        let title = openNewBoard()
        write("newpage")
        waitFor("board.status", value: "saved", timeout: 40)
        let button = element("debug.autowrite")
        button.tap()
        // the line is down and backed up (0.5 s after the last stroke); the save (2 s after it) hasn't run
        usleep(500_000)
        _ = XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false OR value != 'busy'"), object: button)], timeout: 30)
        usleep(1_000_000)
        app.terminate()
        launch([])
        let tile = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
        XCTAssertTrue(tile.waitForExistence(timeout: 30))
        tile.tap()
        XCTAssertTrue(element("board.canvas").waitForExistence(timeout: 40))
        waitFor("board.notice", label: "put back", timeout: 20)
        snap("resilience-03-put-back")
        waitFor("board.status", value: "saved", timeout: 40)
        tap("board.back")
    }

    // MARK: - background and back

    func testBackgroundSavesAndComesBack() throws {
        launch(["-boardAutowrite", "newpage|2x = 8"])
        openNewBoard()
        write("newpage")
        write("2x = 8")
        // home before the 2 s save: leaving saves at once
        XCUIDevice.shared.press(.home)
        sleep(4)
        app.activate()
        XCTAssertTrue(element("board.canvas").waitForExistence(timeout: 20), "the board isn't there after coming back")
        waitFor("board.status", value: "saved", timeout: 30)
        XCTAssertTrue((element("board.status").value as? String ?? "").contains("written"), "nothing was saved")
        XCTAssertTrue(element("live.helpMe").exists, "the tutor left the board")
        snap("resilience-04-back-from-background")
        tap("board.back")
    }

    // MARK: - turned while Ask streams

    func testRotationWhileAskStreams() throws {
        launch(["-boardAutowrite", "newpage"])
        openNewBoard()
        tap("ask.open")
        let input = element("ask.input")
        XCTAssertTrue(input.waitForExistence(timeout: 15))
        sleep(1)
        input.tap()
        input.typeText("Explain how to solve 2x + 3 = 11 step by step")
        tap("ask.send")
        // as the words start to stream, turn it upright: the panel becomes a sheet
        sleep(3)
        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(element("ask.grabber").waitForExistence(timeout: 10), "upright, Ask isn't a sheet")
        snap("resilience-05-portrait-streaming")
        sleep(3)
        XCUIDevice.shared.orientation = .landscapeLeft
        sleep(2)
        XCTAssertFalse(element("ask.grabber").exists, "sideways, Ask is still a sheet")
        // the answer finishes: the stop button goes back to send, and no error
        let send = element("ask.send")
        XCTAssertTrue(send.waitForExistence(timeout: 120), "the answer never finished")
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'went wrong' OR label CONTAINS 'Couldn'")).firstMatch.exists,
                       "the answer failed after turning")
        snap("resilience-06-landscape-done")
        XCUIDevice.shared.orientation = .landscapeLeft
        if element("ask.close").exists { element("ask.close").tap() }
        tap("board.back")
    }

    // MARK: - helpers

    private func launch(_ arguments: [String], proxied: Bool = false) {
        app = XCUIApplication()
        for key in ["AGATHON_API_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"] {
            if let v = env[key] { app.launchEnvironment[key] = v }
        }
        if proxied {
            if let api = env["NETCUT_API_URL"] { app.launchEnvironment["AGATHON_API_URL"] = api }
            if let supabase = env["NETCUT_SUPABASE_URL"] { app.launchEnvironment["SUPABASE_URL"] = supabase }
        }
        app.launchArguments = arguments
        app.launch()
    }

    /// Through the proxy the stored session may not be found (another address): sign in as the
    /// journey's grown-up (KidJourneyUITests writes its email to JOURNEY_STATE).
    private func signInIfNeeded() {
        let email = element("signin.email")
        let home = element("home.greeting")
        let end = Date().addingTimeInterval(30)
        while Date() < end, !email.exists, !home.exists { usleep(200_000) }
        guard email.exists, let state = env["JOURNEY_STATE"], let address = try? String(contentsOfFile: state, encoding: .utf8) else { return }
        email.tap()
        email.typeText(address.trimmingCharacters(in: .whitespacesAndNewlines))
        let password = app.secureTextFields["signin.password"]
        password.tap()
        password.typeText("correct-horse-battery-9")
        element("signin.submit").tap()
    }

    /// A new board from Home; its title.
    @discardableResult
    private func openNewBoard() -> String {
        signInIfNeeded()
        XCTAssertTrue(element("home.greeting").waitForExistence(timeout: 40), "not on Home (run the kid journey first)")
        tap("boards.new", wait: 20)
        XCTAssertTrue(element("board.canvas").waitForExistence(timeout: 40))
        waitFor("board.status", value: "saved", timeout: 40)
        sleep(2)
        let title = element("board.title").label
        return String(title.split(separator: ".").first ?? "Untitled Whiteboard")
    }

    private func element(_ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func tap(_ id: String, wait: TimeInterval = 15) {
        let e = element(id)
        XCTAssertTrue(e.waitForExistence(timeout: wait), "no \(id)")
        let end = Date().addingTimeInterval(wait)
        while !e.isHittable && Date() < end { usleep(100_000) }
        usleep(500_000)
        e.tap()
    }

    private func write(_ expected: String) {
        let button = element("debug.autowrite")
        XCTAssertTrue(button.waitForExistence(timeout: 30), "no autowrite button")
        XCTAssertTrue(button.label.contains(expected), "the autowrite's next line is \(button.label), not \(expected)")
        button.tap()
        sleep(1)
        _ = XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false OR value != 'busy'"), object: button)], timeout: 30)
        sleep(1)
    }

    private func waitFor(_ id: String, label: String? = nil, value: String? = nil, timeout: TimeInterval,
                         file: StaticString = #filePath, line: UInt = #line) {
        let e = element(id)
        XCTAssertTrue(e.waitForExistence(timeout: timeout), "no \(id)", file: file, line: line)
        let predicate = label.map { NSPredicate(format: "label CONTAINS %@", $0) } ?? NSPredicate(format: "value BEGINSWITH %@", value ?? "")
        let result = XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: e)], timeout: timeout)
        XCTAssertEqual(result, .completed, "\(id) never matched \(label ?? value ?? ""): label \(e.label), value \(e.value as? String ?? "nil")",
                       file: file, line: line)
    }

    private func snap(_ name: String) {
        sleep(1)
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = env["JOURNEY_SHOTS"], !dir.isEmpty {
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("ipad-integrate-\(name).png"))
        }
    }
}
