import XCTest

/// The Mac screen panel (agathon.app/share's window, live beside the board) on a stand-in frame:
/// landscape and portrait. Shots go to MAC_SHOTS when it is set.
final class MacScreenUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    override func tearDown() {
        XCUIDevice.shared.orientation = .landscapeLeft
        super.tearDown()
    }

    func testThePanelBesideTheBoard() throws {
        XCUIDevice.shared.orientation = .landscapeLeft
        app = XCUIApplication()
        app.launchArguments = ["-noLabs", "-lab", "macScreen", "-macScreen.stub"]
        app.launch()
        let panel = app.descendants(matching: .any)["macScreen.panel"]
        XCTAssertTrue(panel.waitForExistence(timeout: 20))
        XCTAssertTrue(app.descendants(matching: .any)["macScreen.bring"].waitForExistence(timeout: 5))
        sleep(1)
        snap("mac-screen-landscape")
        XCUIDevice.shared.orientation = .portrait
        sleep(2)
        snap("mac-screen-portrait")
    }

    private func snap(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = ProcessInfo.processInfo.environment["MAC_SHOTS"], !dir.isEmpty {
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
    }
}
