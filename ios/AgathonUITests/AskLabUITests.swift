import XCTest

/// The Ask Lab on the simulator: the panel docked beside the board held sideways, a sheet held
/// upright, a streamed answer with typeset fractions, and the tutor's drawing on the board. The
/// scripted tutor (no network, nothing spent) unless ASK_LAB_LIVE=1, when the Lab asks the local
/// stack's real one (see AskLabView).
///
/// Skipped unless ASK_LAB_SHOTS names a folder on this Mac for the screenshots:
///
///     TEST_RUNNER_ASK_LAB_SHOTS=$PWD/docs/qa-screenshots xcodebuild test … -only-testing:AgathonUITests/AskLabUITests
final class AskLabUITests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment
    private var shots: String { env["ASK_LAB_SHOTS"] ?? "" }

    override func setUpWithError() throws {
        continueAfterFailure = true
        try XCTSkipIf(shots.isEmpty, "set TEST_RUNNER_ASK_LAB_SHOTS to a folder for the screenshots")
    }

    func testDockedLandscapeWithAStreamedAnswerAndADrawing() throws {
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = openLab(ask: "How do I add 1/2 and 1/4?|3 more like these")
        XCTAssertTrue(app.buttons["Read answers out loud"].waitForExistence(timeout: 20))
        // mid-stream, then the answer done and the tutor's drawing written, then a problem set
        Thread.sleep(forTimeInterval: 3.8)
        snap("ipad-ask-2-streaming-landscape")
        // the first ask's words and drawing done, before the next one goes
        Thread.sleep(forTimeInterval: 2)
        waitUntilWritten(app, timeout: 25)
        Thread.sleep(forTimeInterval: 1)
        snap("ipad-ask-3-fraction-answer-and-drawing")
        // the next ask goes 5 s after (the Lab's pause), on a screen with work: a new screen
        Thread.sleep(forTimeInterval: 8)
        waitUntilWritten(app, timeout: 40)
        Thread.sleep(forTimeInterval: 1)
        snap("ipad-ask-4-problems-new-screen")
    }

    func testHelloDockedAndSheetPortrait() throws {
        XCUIDevice.shared.orientation = .landscapeLeft
        var app = openLab(ask: nil)
        XCTAssertTrue(app.buttons["Read answers out loud"].waitForExistence(timeout: 20))
        Thread.sleep(forTimeInterval: 1.5)
        snap("ipad-ask-1-hello-docked-landscape")
        XCUIDevice.shared.orientation = .portrait
        Thread.sleep(forTimeInterval: 2.5)
        snap("ipad-ask-5-hello-sheet-portrait")
        app.terminate()
        // a streamed answer in the sheet, held upright
        app = openLab(ask: "Show me 4 × 6 as an array")
        XCTAssertTrue(app.buttons["Read answers out loud"].waitForExistence(timeout: 20))
        Thread.sleep(forTimeInterval: 4)
        waitUntilWritten(app, timeout: 30)
        Thread.sleep(forTimeInterval: 1)
        snap("ipad-ask-6-sheet-portrait-answer")
        XCUIDevice.shared.orientation = .landscapeLeft
    }

    /// The real tutor on the local stack (ASK_LAB_LIVE=1): one ask, streamed, and its drawing.
    func testLiveAskLandscape() throws {
        try XCTSkipUnless(env["ASK_LAB_LIVE"] == "1", "the live tutor only when asked: each run costs a real ask")
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = openLab(ask: "What is 1/2 + 1/4? Show me with fraction bars on my board.")
        XCTAssertTrue(app.buttons["Read answers out loud"].waitForExistence(timeout: 30))
        Thread.sleep(forTimeInterval: 6)
        snap("ipad-ask-7-live-streaming")
        // the answer done and the drawing written (at most a minute)
        waitUntilWritten(app, timeout: 60)
        Thread.sleep(forTimeInterval: 1)
        snap("ipad-ask-8-live-answer-and-drawing")
    }

    // MARK: helpers

    /// Until no message is thinking, streaming or being written on the board.
    private func waitUntilWritten(_ app: XCUIApplication, timeout: TimeInterval) {
        let end = Date().addingTimeInterval(timeout)
        let busy = ["thinking", "streaming", "writing"].map { app.descendants(matching: .any).matching(identifier: "ask.message.tutor.\($0)") }
        Thread.sleep(forTimeInterval: 1)
        while Date() < end, busy.contains(where: { $0.count > 0 }) { Thread.sleep(forTimeInterval: 0.5) }
    }

    private func openLab(ask: String?) -> XCUIApplication {
        let app = XCUIApplication()
        var args = ["-askLabOpen", "YES"]
        if let ask { args += ["-askLabAsk", ask] }
        if env["ASK_LAB_LIVE"] == "1" { args += ["-askLabLive", "YES"] }
        app.launchArguments = args
        for key in ["AGATHON_API_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY", "AGATHON_TEST_EMAIL", "AGATHON_TEST_PASSWORD"] {
            if let v = env[key] { app.launchEnvironment[key] = v }
        }
        app.launch()
        let labs = app.buttons["Labs"].firstMatch
        XCTAssertTrue(labs.waitForExistence(timeout: 20))
        labs.tap()
        let item = app.buttons["Ask Lab (the chat beside the board)"].firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 5))
        item.tap()
        return app
    }

    private func snap(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        // ASK_LAB_SHOT_SUFFIX: another run of the same shots (`-large-type`)
        let url = URL(fileURLWithPath: shots).appendingPathComponent("\(name)\(env["ASK_LAB_SHOT_SUFFIX"] ?? "").png")
        do {
            try png.write(to: url)
        } catch {
            XCTFail("could not write \(url.path): \(error)")
        }
        let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
