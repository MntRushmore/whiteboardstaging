import XCTest

/// The picture tutor end to end on the stub server (no network, no account): the Picture Tutor Lab
/// writes two lines in a kid's hand; after the pause the pen reads, scribbles, draws the picture on;
/// Suggest's ghost is accepted; Solve's is shot mid-reveal; Feedback shows at once; the admin page.
/// Shots go to PICTURE_SHOTS (TEST_RUNNER_PICTURE_SHOTS) as picture-tutor-*.png, and to the results.
final class PictureTutorUITests: XCTestCase {
    private var app: XCUIApplication!
    private let env = ProcessInfo.processInfo.environment

    override func setUpWithError() throws {
        continueAfterFailure = true
        XCUIDevice.shared.orientation = .landscapeLeft
    }

    private func launch(_ args: [String]) {
        app = XCUIApplication()
        app.launchArguments = ["-noLabs", "-lab"] + args
        app.launch()
    }

    func testSuggestGhostAccepted() throws {
        launch(["picture", "-pictureTutorLab.mode", "suggest", "-pictureTutor.stubOutcome", "done", "-pictureTutor.stubDelay", "6"])
        XCTAssertTrue(app.descendants(matching: .any)["picture.drawNow"].waitForExistence(timeout: 30))
        // the lines are written, the pause, then the pen reads
        waitFor("phase working-reading", timeout: 30)
        usleep(1_200_000)
        snap("01-reading")
        waitFor("phase working-drawing", timeout: 10)
        usleep(1_400_000)
        snap("02-scribbling")
        usleep(1_000_000)
        snap("03-scribbling-later")
        waitFor("shown revealing", timeout: 10)
        usleep(700_000)
        snap("04-reveal-mid")
        waitFor("shown ghost", timeout: 6)
        usleep(800_000)
        snap("05-ghost")
        let accept = app.buttons["picture.accept"]
        XCTAssertTrue(accept.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["picture.reject"].exists)
        accept.tap()
        waitFor("shown none", timeout: 10)
        usleep(1_000_000)
        snap("06-accepted")
        // the accepted picture is the board's now: the next pause doesn't send the same picture again
        XCTAssertFalse(probe.contains("working"))
    }

    func testSolveReveal() throws {
        launch(["picture", "-pictureTutorLab.mode", "answer", "-pictureTutor.stubDelay", "6"])
        waitFor("shown revealing", timeout: 45)
        usleep(500_000)
        snap("07-solve-reveal-early")
        usleep(500_000)
        snap("08-solve-reveal-late")
        waitFor("shown ghost", timeout: 6)
        usleep(600_000)
        snap("09-solve-ghost")
        app.buttons["picture.reject"].tap()
        waitFor("shown none", timeout: 6)
    }

    func testFeedbackShownAtOnce() throws {
        launch(["picture", "-pictureTutorLab.mode", "feedback", "-pictureTutor.stubDelay", "6"])
        waitFor("shown shown", timeout: 45)
        usleep(900_000)
        snap("10-feedback")
        XCTAssertFalse(app.buttons["picture.accept"].exists, "feedback has no Accept")
    }

    func testNothingToAddLeavesNothing() throws {
        launch(["picture", "-pictureTutorLab.mode", "suggest", "-pictureTutor.stubOutcome", "none", "-pictureTutor.stubDelay", "4"])
        waitFor("phase working-reading", timeout: 30)
        waitFor("phase idle", timeout: 10)
        usleep(800_000)
        XCTAssertTrue(probe.contains("shown none"))
        snap("11-none")
    }

    func testZoomedIn() throws {
        launch(["picture", "-pictureTutorLab.mode", "suggest", "-pictureTutorLab.zoom", "1.7", "-pictureTutor.stubDelay", "6"])
        waitFor("shown ghost", timeout: 45)
        usleep(600_000)
        snap("12-zoomed-ghost")
    }

    func testPortraitGhost() throws {
        XCUIDevice.shared.orientation = .portrait
        launch(["picture", "-pictureTutorLab.mode", "suggest", "-pictureTutor.stubDelay", "6"])
        waitFor("phase working-drawing", timeout: 45)
        usleep(1_800_000)
        snap("14-portrait-scribbling")
        waitFor("shown ghost", timeout: 10)
        usleep(600_000)
        snap("15-portrait-ghost")
    }

    func testZzAdminPageAfterTheRuns() throws {
        launch(["pictureSettings", "-pictureTutor.enabled", "YES"])
        XCTAssertTrue(app.descendants(matching: .any)["picture.page"].waitForExistence(timeout: 20))
        usleep(800_000)
        snap("13-admin-page")
    }

    // MARK: helpers

    private var probe: String { app.descendants(matching: .any)["debug.picture"].label }

    private func waitFor(_ text: String, timeout: TimeInterval) {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if probe.contains(text) { return }
            usleep(100_000)
        }
        XCTFail("never said \(text): \(probe)")
    }

    private func snap(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = env["PICTURE_SHOTS"], !dir.isEmpty {
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("picture-tutor-\(name).png"))
        }
    }
}
