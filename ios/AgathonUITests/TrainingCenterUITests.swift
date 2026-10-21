import XCTest

/// The Training Center end to end on the LOCAL stack only (docs/TRAINING-CENTER.md): signed in as a
/// local admin, My Pencil (a generated problem's page written by the tutor, the work written through
/// the canvas by Debug's autowrite — the simulator has no Pencil — a 👍 and a 👎 with what it should
/// have done, Next to a fresh page of the writer's own, the handwriting tag), the results by
/// handwriting style; then a small AUTO BENCH and its results. Real reads (Mathpix through the dev
/// server's training pass): about 30 calls in all, and none of them spends ink (the admin has none).
///
/// Skipped unless AGATHON_INTEGRATION=1; refused unless every URL is on this machine:
///
///     TEST_RUNNER_AGATHON_INTEGRATION=1 TEST_RUNNER_AGATHON_API_URL=http://localhost:3961 \
///     TEST_RUNNER_SUPABASE_URL=http://127.0.0.1:54321 TEST_RUNNER_SUPABASE_ANON_KEY=<ANON_KEY> \
///     TEST_RUNNER_AGATHON_TEST_EMAIL=training-admin@example.com TEST_RUNNER_AGATHON_QA_SHOTS_DIR=<dir> \
///     xcodebuild test … -only-testing:AgathonUITests/TrainingCenterUITests
final class TrainingCenterUITests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment

    override func setUpWithError() throws {
        continueAfterFailure = false
        try XCTSkipUnless(env["AGATHON_INTEGRATION"] == "1", "set TEST_RUNNER_AGATHON_INTEGRATION=1 and point it at the local stack")
        for key in ["AGATHON_API_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"] {
            let value = try XCTUnwrap(env[key], "\(key) is needed for the live flows")
            if key != "SUPABASE_ANON_KEY" {
                let host = URL(string: value)?.host ?? ""
                try XCTSkipUnless(["127.0.0.1", "localhost"].contains(host), "\(key) must be the local stack, never production")
            }
        }
        XCUIDevice.shared.orientation = .landscapeLeft
    }

    func test1MyPencil() throws {
        let app = launch([
            "-trainingOpen", "pencil", "-trainingSource", "5-6:two_step_equations", "-trainingSeed", "11", "-trainingStyle", "neat",
            "-trainingAutowrite", "steps|answer|problem:3x - 5 = 10|3x = 15|answer:x = 4", "-trainingHand", "clean",
        ])
        let write = app.buttons["pencil.autowrite"]
        wait(write, timeout: 60)
        // the tutor writes the page's problem first
        Thread.sleep(forTimeInterval: 6)
        snap("pencil-problem")
        // 1. the worked steps, then the answer in the answer spot: the check runs 1.5 s after it
        tapWhenIdle(write, app)
        tapWhenIdle(write, app)
        let review = app.descendants(matching: .any)["pencil.review"]
        wait(review, timeout: 40)
        snap("pencil-review")
        // 👍 the first line the tutor answered
        app.buttons["pencil.up"].firstMatch.tap()
        Thread.sleep(forTimeInterval: 1.5)
        // 👎 the next, with what it should have done
        if app.buttons["pencil.down"].firstMatch.waitForExistence(timeout: 8) {
            app.buttons["pencil.down"].firstMatch.tap()
            wait(app.buttons["review.ring"], timeout: 10)
            app.buttons["review.ring"].tap()
            let note = app.textFields["review.note"].firstMatch
            if note.waitForExistence(timeout: 3) {
                note.tap()
                note.typeText("bench check: a deliberate 👎")
            }
            snap("pencil-should")
            app.buttons["review.save"].tap()
        }
        Thread.sleep(forTimeInterval: 1)
        // 2. the handwriting tag, then a page of the writer's own
        app.buttons["pencil.style"].firstMatch.tap()
        let messy = app.buttons["Messy"].firstMatch
        if messy.waitForExistence(timeout: 5) { messy.tap() }
        app.buttons["pencil.source"].firstMatch.tap()
        wait(app.buttons["source.own"], timeout: 10)
        app.buttons["source.own"].tap()
        app.buttons["pencil.next"].firstMatch.tap()
        Thread.sleep(forTimeInterval: 3)
        tapWhenIdle(write, app)   // problem:3x - 5 = 10
        tapWhenIdle(write, app)   // 3x = 15
        tapWhenIdle(write, app)   // answer:x = 4 (a slip: 5)
        wait(review, timeout: 40)
        snap("pencil-own")
        // 👍 every line the tutor asks about now
        for _ in 0..<4 {
            let up = app.buttons["pencil.up"].firstMatch
            guard up.waitForExistence(timeout: 6) else { break }
            up.tap()
            Thread.sleep(forTimeInterval: 1.2)
        }
        // 3. back to the Training Center: the session is saved; its results by handwriting style
        app.buttons["board.back"].firstMatch.tap()
        let runs = app.staticTexts["Runs"].firstMatch
        wait(runs, timeout: 30)
        Thread.sleep(forTimeInterval: 2)
        snap("center")
        let pencilRun = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Pencil")).firstMatch
        wait(pencilRun, timeout: 10)
        pencilRun.tap()
        wait(app.buttons["results.close"], timeout: 15)
        XCTAssertTrue(app.staticTexts["By handwriting style"].waitForExistence(timeout: 10), "results cut by handwriting style")
        snap("pencil-results")
        app.terminate()
    }

    func test2Bench() throws {
        let app = launch([
            "-trainingOpen", "bench",
            // TEST_RUNNER_TRAINING_BENCH: another setup (e.g. the owner's kinds of writing only)
            "-trainingBench", env["TRAINING_BENCH"] ?? "count=6;budget=24;hands=clean,messy;pace=brisk;seed=5;grades=K-2,3-4,5-6;generated=0",
        ])
        let start = app.buttons["bench.start"]
        wait(start, timeout: 60)
        wait(app.descendants(matching: .any)["bench.status.on"], timeout: 30)
        snap("bench-setup")
        start.tap()
        let results = app.buttons["results.close"]
        // six cases at a brisk pace: a minute or two
        let deadline = Date().addingTimeInterval(420)
        var shotRunning = false
        while !results.exists && Date() < deadline {
            if !shotRunning, app.descendants(matching: .any)["bench.progress"].exists {
                Thread.sleep(forTimeInterval: 12)
                snap("bench-running")
                shotRunning = true
            }
            Thread.sleep(forTimeInterval: 2)
        }
        XCTAssertTrue(results.exists, "the bench never finished")
        Thread.sleep(forTimeInterval: 2)
        snap("bench-results")
        // a failure's detail (if any): the page, read vs expected, why
        let failure = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "results.case.")).firstMatch
        if failure.waitForExistence(timeout: 5) {
            failure.tap()
            Thread.sleep(forTimeInterval: 2)
            snap("bench-failure")
            let save = app.buttons["detail.regression"]
            if save.waitForExistence(timeout: 5) {
                save.tap()
                Thread.sleep(forTimeInterval: 2)
                snap("bench-regression")
            }
        }
        app.terminate()
    }

    // MARK: helpers

    private func launch(_ extra: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        for key in ["AGATHON_API_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"] {
            app.launchEnvironment[key] = env[key]
        }
        app.launchEnvironment["AGATHON_TEST_EMAIL"] = env["AGATHON_TEST_EMAIL"] ?? "training-admin@example.com"
        app.launchEnvironment["AGATHON_TEST_PASSWORD"] = env["AGATHON_TEST_PASSWORD"] ?? "password123"
        app.launchArguments += ["-lab", "training", "-noLabs"] + extra
        app.launch()
        return app
    }

    /// Taps the autowrite button and waits for its line to be written.
    private func tapWhenIdle(_ button: XCUIElement, _ app: XCUIApplication) {
        let idle = NSPredicate(format: "value != %@", "busy")
        _ = XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: idle, object: button)], timeout: 30)
        button.tap()
        Thread.sleep(forTimeInterval: 0.5)
        _ = XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: idle, object: button)], timeout: 60)
        Thread.sleep(forTimeInterval: 1.0)
    }

    private func wait(_ element: XCUIElement, timeout: TimeInterval = 20, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: timeout), "\(element) never appeared", file: file, line: line)
    }

    private func snap(_ name: String) {
        Thread.sleep(forTimeInterval: 1.0)
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = env["AGATHON_QA_SHOTS_DIR"], !dir.isEmpty {
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("ipad-training-\(name).png"))
        }
    }
}
