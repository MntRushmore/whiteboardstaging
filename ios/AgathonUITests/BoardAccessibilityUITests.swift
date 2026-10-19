import XCTest

/// VoiceOver on the board (the integration's design pass): every control on the board screen, the
/// tutor's and Ask's included, has a name a person can understand: no unnamed buttons, no raw
/// identifiers or symbol names read out. Runs on the account the kid journey made (local stack).
final class BoardAccessibilityUITests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment

    override func setUpWithError() throws {
        continueAfterFailure = true
        try XCTSkipUnless(env["AGATHON_INTEGRATION"] == "1", "set TEST_RUNNER_AGATHON_INTEGRATION=1 and point it at the local stack")
        XCUIDevice.shared.orientation = .landscapeLeft
    }

    func testEveryControlOnTheBoardHasAName() throws {
        let app = XCUIApplication()
        for key in ["AGATHON_API_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"] {
            if let v = env[key] { app.launchEnvironment[key] = v }
        }
        // the controls a Release build has (Debug's Labs button off)
        app.launchArguments = ["-noLabs"]
        app.launch()
        let greeting = app.descendants(matching: .any).matching(identifier: "home.greeting").firstMatch
        XCTAssertTrue(greeting.waitForExistence(timeout: 40), "not on Home (run the kid journey first)")
        let first = app.buttons.matching(identifier: "boards.row").firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 20))
        first.tap()
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "board.canvas").firstMatch.waitForExistence(timeout: 40))
        sleep(4)
        var report = ["Board:"]
        audit(app, into: &report)
        // Ask's panel
        let ask = app.descendants(matching: .any).matching(identifier: "ask.open").firstMatch
        if ask.waitForExistence(timeout: 10) {
            ask.tap()
            sleep(3)
            report.append("Ask open:")
            audit(app, into: &report)
            let close = app.descendants(matching: .any).matching(identifier: "ask.close").firstMatch
            if close.exists { close.tap() }
        }
        // the grown-ups' help settings
        let grownUps = app.descendants(matching: .any).matching(identifier: "live.grownUps").firstMatch
        if grownUps.waitForExistence(timeout: 5) {
            grownUps.tap()
            sleep(2)
            report.append("Grown-ups' help settings:")
            audit(app, into: &report)
        }
        let text = report.joined(separator: "\n")
        let attachment = XCTAttachment(string: text)
        attachment.name = "board-voiceover-labels"
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = env["JOURNEY_SHOTS"], !dir.isEmpty {
            try? text.write(toFile: (dir as NSString).appendingPathComponent("ipad-integrate-voiceover-labels.txt"), atomically: true, encoding: .utf8)
        }
    }

    /// Every hittable button and switch: a label, never empty, never a raw identifier or an SF Symbol name.
    private func audit(_ app: XCUIApplication, into report: inout [String]) {
        let controls = app.buttons.allElementsBoundByIndex + app.switches.allElementsBoundByIndex
        for c in controls where c.exists && c.isHittable {
            let label = c.label.trimmingCharacters(in: .whitespaces)
            report.append("  [\(c.identifier)] \(label)\((c.value as? String).map { $0.isEmpty ? "" : " = \($0)" } ?? "")")
            if c.identifier == "debug.autowrite" || label == "Labs" { continue }
            XCTAssertFalse(label.isEmpty, "a control with no name: \(c.identifier) at \(c.frame)")
            XCTAssertNil(label.range(of: #"^[a-z0-9]+(\.[a-zA-Z0-9]+)+$"#, options: .regularExpression),
                         "a symbol name or identifier read out: \(label)") // e.g. "chevron.left"
            XCTAssertNotEqual(label, c.identifier, "the identifier is read out: \(label)")
        }
    }
}
