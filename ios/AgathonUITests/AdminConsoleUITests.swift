import XCTest

/// The iPad admin console on its Debug fixtures (`-lab admin`): every section opens, and a shot of
/// each goes to ADMIN_SHOTS when set (synthetic data only).
final class AdminConsoleUITests: XCTestCase {
    private var app: XCUIApplication!
    private let env = ProcessInfo.processInfo.environment

    override func setUp() {
        continueAfterFailure = true
        XCUIDevice.shared.orientation = .landscapeLeft
        app = XCUIApplication()
        app.launchArguments = ["-noLabs", "-lab", "admin"]
        app.launch()
    }

    func testEverySectionOpens() throws {
        XCTAssertTrue(app.staticTexts["Admin"].waitForExistence(timeout: 20) || app.navigationBars["Admin"].waitForExistence(timeout: 5))
        snap("01-overview")
        for (id, title, name) in [("users", "Users", "02-users"), ("boards", "Boards", "03-boards"), ("bugs", "Bug reports", "05-bugs"), ("issues", "Issues", "07-issues"), ("runs", "Picture tutor runs", "08-runs")] {
            let cell = app.staticTexts[title].firstMatch
            XCTAssertTrue(cell.waitForExistence(timeout: 5), id)
            cell.tap()
            sleep(2)
            snap(name)
            if id == "boards" {
                app.buttons.matching(NSPredicate(format: "label CONTAINS 'Fractions'")).firstMatch.tap()
                sleep(3)
                snap("04-board")
                app.navigationBars.buttons.element(boundBy: 0).tap()
            }
            if id == "bugs" {
                app.buttons.matching(NSPredicate(format: "label CONTAINS 'wrote over'")).firstMatch.tap()
                sleep(2)
                snap("06-bug")
                app.navigationBars.buttons.element(boundBy: 0).tap()
            }
        }
    }

    private func snap(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        let a = XCTAttachment(screenshot: shot)
        a.name = name
        a.lifetime = .keepAlways
        add(a)
        if let dir = env["ADMIN_SHOTS"], !dir.isEmpty {
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("admin-\(name).png"))
        }
    }
}
