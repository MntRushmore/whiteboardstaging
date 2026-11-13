import XCTest

/// "The tutor writes it out" on the real Blocks board (docs/TUTOR-WRITES.md), in the Tutor Writes Lab:
/// the kid's work in a synthetic hand, read back by a stand-in reader — no server, no sign-in, no ink
/// spent, no real kid's writing. Each scenario: the work is written, the kid taps Help me (Next step),
/// says Yes to "I read: … Is that right?", and the tutor's pen writes one step in cobalt while the frames are taken; then Next step on its
/// card, until the answer is all that is left (held back: "One step left").
///
///     xcodebuild test … -only-testing:AgathonUITests/TutorWritesUITests -parallel-testing-enabled NO \
///       [TEST_RUNNER_AGATHON_QA_SHOTS_DIR=<docs/tutor-writes>]
final class TutorWritesUITests: XCTestCase {
    private var app: XCUIApplication!
    private let env = ProcessInfo.processInfo.environment

    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
    }

    private func launch(_ demo: String, answers: Bool = false) {
        app = XCUIApplication()
        app.launchArguments += ["-agathon.onboarding.finished", "YES", "-noLabs", "-lab", "tutorWrites", "-tutorWritesDemo", demo]
        if answers { app.launchArguments.append("-tutorWritesAnswers") }
        app.launch()
    }

    func testAnEquationOneStepAtATime() throws {
        launch("equation")
        waitFor("tutorWrites.probe", matching: #"read 1 "#, timeout: 40)
        snap("equation-0-the-kids-work")
        tapHelpMeAndFilm("equation-1")
        waitFor("tutorWrites.probe", matching: #"steps 1 .*card Next step: Subtract 3 from both sides\."#, timeout: 20)
        tap("live.hint.more")
        waitFor("tutorWrites.probe", matching: #"card One step left: Divide both sides by 2"#, timeout: 20)
        snap("equation-2-one-step-left")
    }

    func testFractions() throws {
        launch("fractions")
        waitFor("tutorWrites.probe", matching: #"read 1 "#, timeout: 40)
        tapHelpMeAndFilm("fractions-1")
        waitFor("tutorWrites.probe", matching: #"steps 1 .*Make the denominators the same: 6\."#, timeout: 20)
        snap("fractions-1-done")
    }

    func testColumnAddition() throws {
        launch("column", answers: true)
        waitFor("tutorWrites.probe", matching: #"read 1 "#, timeout: 40)
        snap("column-0-the-kids-work")
        tapHelpMeAndFilm("column-1")
        waitFor("tutorWrites.probe", matching: #"steps 1 .*Ones: 6 \+ 0 = 6\."#, timeout: 20)
        tap("live.hint.more")
        waitFor("tutorWrites.probe", matching: #"steps 3 .*Tens: 8 \+ 8 = 16\. Write 6 and carry the 1\."#, timeout: 20)
        snap("column-2-tens-and-carry")
        tap("live.hint.more")
        waitFor("tutorWrites.probe", matching: #"One column left"#, timeout: 20)
        snap("column-3-one-column-left")
        tap("live.hint.more")
        waitFor("tutorWrites.probe", matching: #"steps 4 .*card The answer"#, timeout: 20)
        snap("column-4-the-answer-asked-for")
    }

    func testLongMultiplication() throws {
        launch("long")
        waitFor("tutorWrites.probe", matching: #"read 1 "#, timeout: 40)
        tapHelpMeAndFilm("long-1")
        waitFor("tutorWrites.probe", matching: #"Ones row: 46 × 3 = 138\."#, timeout: 20)
        tap("live.hint.more")
        waitFor("tutorWrites.probe", matching: #"Tens row: 46 × 20 = 920\."#, timeout: 20)
        sleep(2)
        tap("live.hint.more")
        waitFor("tutorWrites.probe", matching: #"Now add the rows\. Ones: 8 \+ 0 = 8\."#, timeout: 20)
        snap("long-3-rule-and-ones")
    }

    func testASlip() throws {
        launch("slip")
        waitFor("tutorWrites.probe", matching: #"read 2 "#, timeout: 40)
        tapHelpMeAndFilm("slip-1")
        waitFor("tutorWrites.probe", matching: #"steps 1 "#, timeout: 20)
        // one right step beside the ring: Next step's own correction and Help me's are never both written
        sleep(3)
        let probe = element("tutorWrites.probe").label
        XCTAssertTrue(probe.contains("steps 1 "), "the step was written twice: \(probe)")
        snap("slip-1-done")
    }

    /// The kid rubs the tutor's step out with the eraser (a finger on the simulator: no Pencil seen), then
    /// asks again: the step is written again, once.
    func testRubbingOutTheStep() throws {
        launch("equation")
        waitFor("tutorWrites.probe", matching: #"read 1 "#, timeout: 40)
        tapHelpMeAndFilm("erase-1")
        waitFor("tutorWrites.probe", matching: #"steps 1 .*writing no"#, timeout: 20)
        tap("live.hint.gotIt")
        let label = element("tutorWrites.probe").label
        let box = try XCTUnwrap(label.range(of: #"box (\d+),(\d+),(\d+),(\d+)"#, options: .regularExpression).map { String(label[$0]) },
                                "no step box: \(label)")
        let n = box.dropFirst(4).split(separator: ",").compactMap { Double($0) }
        app.buttons["Eraser"].firstMatch.tap()
        let origin = app.coordinate(withNormalizedOffset: .zero)
        // three passes across the step, top, middle and bottom
        for f in [0.25, 0.5, 0.75] {
            let y = n[1] + n[3] * f
            origin.withOffset(CGVector(dx: n[0] - 12, dy: y))
                .press(forDuration: 0.05, thenDragTo: origin.withOffset(CGVector(dx: n[0] + n[2] + 12, dy: y)))
        }
        waitFor("tutorWrites.probe", matching: #"steps 0 "#, timeout: 10)
        snap("erase-2-rubbed-out")
        app.buttons["Pen"].firstMatch.tap()
        tap("live.helpMe")
        waitFor("tutorWrites.probe", matching: #"steps 1 .*writing no"#, timeout: 20)
        sleep(2)
        XCTAssertTrue(element("tutorWrites.probe").label.contains("steps 1 "), "written more than once")
        snap("erase-3-written-again")
    }

    // MARK: - helpers

    /// Help me, then frames while the tutor's pen writes (the pen should start within a second).
    private func tapHelpMeAndFilm(_ name: String) {
        tap("live.helpMe")
        // the messy-handwriting guard: the kid's own problem (and a line that disagrees with it) is read
        // back first — "I read: … Is that right?" — and Yes lets the tutor write
        var n = 0
        while n < 3 {
            let probe = element("tutorWrites.probe")
            let deadline = Date().addingTimeInterval(n == 0 ? 4 : 0.5)
            while Date() < deadline && !probe.label.contains("card I read:") { Thread.sleep(forTimeInterval: 0.2) }
            guard probe.label.contains("card I read:") else { break }
            n += 1
            snap("\(name)-readback-\(n)")
            tap("live.hint.more")
        }
        for (i, wait) in [0.35, 0.45, 0.6, 0.9].enumerated() {
            Thread.sleep(forTimeInterval: wait)
            snap("\(name)-pen-\(i + 1)", settle: false)
        }
        sleep(2)
        snap("\(name)-written")
    }

    private func element(_ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func tap(_ id: String, wait: TimeInterval = 15) {
        let e = element(id)
        XCTAssertTrue(e.waitForExistence(timeout: wait), "no \(id)")
        e.tap()
    }

    private func waitFor(_ id: String, matching pattern: String, timeout: TimeInterval) {
        let e = element(id)
        XCTAssertTrue(e.waitForExistence(timeout: timeout), "no \(id)")
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if e.label.range(of: pattern, options: .regularExpression) != nil { return }
            Thread.sleep(forTimeInterval: 0.25)
        }
        XCTFail("\(id) never matched \(pattern): \(e.label)")
    }

    private func snap(_ name: String, settle: Bool = true) {
        if settle { sleep(1) }
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = env["AGATHON_QA_SHOTS_DIR"], !dir.isEmpty {
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("tutor-writes-\(name).png"))
        }
    }
}
