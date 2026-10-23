import XCTest

/// SAT v2 end to end against a LOCAL server with the REAL live services (no stubs): skipped unless
/// `AGATHON_E2E=1`. Run it in an integration step with a capped budget (it makes real recognize,
/// check and Help me calls), never against production:
///
///     TEST_RUNNER_AGATHON_E2E=1 TEST_RUNNER_AGATHON_API_URL=http://localhost:3217 TEST_RUNNER_SUPABASE_URL=… \
///     TEST_RUNNER_SUPABASE_ANON_KEY=… [TEST_RUNNER_AGATHON_TEST_EMAIL=… TEST_RUNNER_AGATHON_TEST_PASSWORD=…] \
///     [TEST_RUNNER_AGATHON_SAT_SHOTS=<dir>] xcodebuild test-without-building … \
///     -only-testing:AgathonUITests/SATLiveE2ETests -parallel-testing-enabled NO
///
/// Who practises: with `AGATHON_TEST_EMAIL` / `AGATHON_TEST_PASSWORD`, that free account (signed in by
/// the Debug build under `-satLive`, then Home's SAT card); without them, a student with no account
/// (the first run's "I'm studying for the SAT", `POST /api/sat/anon` with the simulator's debug
/// header — the server's anonymous sign-ins must be on).
///
/// 1. `testARealSATPageTicksHelpsAndReadsTheFigure`: on question 1 the question's own first solution
///    step in a student's hand (`StudentHand`, through the canvas's touch path): the first ink claims
///    the pass (`/api/sat/tutor`), the line is read (`/api/live/recognize`, `sat_question_id`) and
///    TICKED; Help me twice: the nudge, then ONE step through the live Help me (`step live`, "Your
///    turn"); then the first question with a plane: a loop round its first labelled point →
///    `sat_figure_marks` ("circled near (…)") rides on the live bodies, and a line is read with them.
/// 2. `testALongerRealSession`: the whole of a session, with captures (`AGATHON_SAT_SHOTS`): ink on
///    the figure, a right line ticked, Help me three times (nudge, the live step in cobalt, the
///    walk-through), a wrong choice and its why, the solution two ways, the set finished, and the
///    summary's deck. (SAT home's "1 to review" needs the review due today: the harness moves it.)
final class SATLiveE2ETests: XCTestCase {
    private var app: XCUIApplication!
    private let env = ProcessInfo.processInfo.environment
    /// seconds from a tap to what it brought, for the report
    private var timings: [String] = []

    override func setUpWithError() throws {
        try XCTSkipUnless(env["AGATHON_E2E"] == "1", "the end-to-end run needs AGATHON_E2E=1 and a local server (real live calls)")
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
    }

    override func tearDownWithError() throws {
        if !timings.isEmpty {
            let a = XCTAttachment(string: timings.joined(separator: "\n"))
            a.name = "timings"
            a.lifetime = .keepAlways
            add(a)
            print("SAT-E2E-TIMINGS\n" + timings.joined(separator: "\n"))
        }
        app?.terminate()
    }

    private var signedIn: Bool { env["AGATHON_TEST_EMAIL"] != nil && env["AGATHON_TEST_PASSWORD"] != nil }

    private func launch(autowrite: String) {
        app = XCUIApplication()
        app.launchArguments += ["-satLive", "-noLabs", "-satAutowrite", autowrite]
        if signedIn {
            app.launchArguments += ["-agathon.onboarding.finished", "YES", "-satOpen", "home"]
        } else {
            app.launchArguments += ["-onboardingFresh"]
        }
        for key in ["AGATHON_API_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY", "AGATHON_TEST_EMAIL", "AGATHON_TEST_PASSWORD"] {
            if let v = env[key] { app.launchEnvironment[key] = v }
        }
        app.launch()
        if !signedIn { tap("onboarding.who.sat", wait: 60) }
        XCTAssertTrue(element("sat.home").waitForExistence(timeout: 90), "SAT home")
    }

    func testARealSATPageTicksHelpsAndReadsTheFigure() throws {
        launch(autowrite: "step:0|step:1|circle:auto|step:0")
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
        try XCTSkipUnless(goToPlot(), "the set had no question with a plane")
        tap("sat.debug.write") // circle:auto
        probe("marks On the question's graph the student drew: circled near", timeout: 30)
        tap("sat.debug.write") // a line on the plane's page: read with the marks beside sat_question_id
        probe("read 1", timeout: 90)
    }

    func testALongerRealSession() throws {
        launch(autowrite: "circle:auto|calc:auto|step:0|step:1")
        snap("01-home")
        // "Pick a skill": linear functions (its questions have planes and tables)
        let skill = element("sat.home.skill.linear-functions")
        XCTAssertTrue(skill.waitForExistence(timeout: 20), "no linear functions skill row")
        for _ in 0..<6 where !skill.isHittable { app.swipeUp() }
        skill.tap()
        XCTAssertTrue(element("board.canvas").waitForExistence(timeout: 60))
        waitFor("sat.position", label: "Q1 of", timeout: 30)
        // the first question with a plane (the set is adaptive: go looking)
        let plot = goToPlot()
        snap("02-question")
        if plot {
            // ink on the figure: never read as a line, summarised in graph terms
            tap("sat.debug.write") // circle:auto
            probe("tutor on live on", timeout: 60)
            probe("marks On the question's graph the student drew: circled near", timeout: 30)
        } else {
            _ = advanceWriting() // circle:auto is skipped where there is no plane: write the step instead
        }
        // a right line in a student's hand: read, then ticked once the page is checked (the 9 s pause)
        let wrote = Date()
        tap("sat.debug.write") // calc:auto (the bank's arithmetic, else step:0 next)
        waitFor("sat.debug.write", value: "busy", timeout: 5, quiet: true)
        waitFor("sat.debug.write", notValue: "busy", timeout: 60)
        let penUp = Date()
        probe("tutor on live on", timeout: 60)
        probe("read 1", timeout: 60)
        timings.append(String(format: "pen-up → read: %.1f s", Date().timeIntervalSince(penUp)))
        // a bank step that is a given read off the figure (`b = 4`) is left alone, not ticked: then the next step
        waitFor("sat.debug", value: "ticks 1", timeout: 25, quiet: true)
        var tickFrom = penUp
        if !(element("sat.debug").value as? String ?? "").contains("ticks 1") {
            timings.append("step 0 left alone (no tick): \((element("sat.debug").value as? String ?? "").components(separatedBy: " tutorInk").first ?? "")")
            tap("sat.debug.write") // step:0
            waitFor("sat.debug.write", value: "busy", timeout: 5, quiet: true)
            waitFor("sat.debug.write", notValue: "busy", timeout: 60)
            tickFrom = Date()
        }
        probe("ticks 1", timeout: 90)
        timings.append(String(format: "pen-up → tick: %.1f s (the page is checked after a 9 s pause; writing took %.1f s)", Date().timeIntervalSince(tickFrom), penUp.timeIntervalSince(wrote)))
        snap("03-line-ticked\(plot ? "-marks-on-figure" : "")")

        // Help me ×3: the nudge, ONE live step in cobalt under the last line, the walk-through
        tap("sat.helpMe")
        probe("rung 1", timeout: 10)
        snap("04-help-1-nudge")
        let inkBefore = number("tutorInk")
        let asked = Date()
        tap("sat.helpMe")
        let end = Date().addingTimeInterval(60)
        while number("tutorInk") <= inkBefore && Date() < end { usleep(100_000) }
        XCTAssertGreaterThan(number("tutorInk"), inkBefore, "no tutor ink from Help me's step")
        probe("rung 2", timeout: 10)
        timings.append(String(format: "Help me tap → cobalt step on screen: %.1f s", Date().timeIntervalSince(asked)))
        probe("yourTurn yes", timeout: 90)
        timings.append(String(format: "Help me tap → Your turn: %.1f s (%@)", Date().timeIntervalSince(asked), (element("sat.debug").value as? String ?? "").contains("step live") ? "live step" : "bank step"))
        snap("05-help-2-one-step")
        tap("sat.helpMe")
        probe("rung 3", timeout: 10)
        // the walk picks up after the steps already on the page; with none left it says so
        waitFor("sat.debug", valueMatches: "walk [0-9]+/", timeout: 20, quiet: true)
        let walking = (element("sat.debug").value as? String ?? "").range(of: "walk [0-9]+/", options: .regularExpression) != nil
        XCTAssertTrue(walking || element("sat.notice").exists, "rung 3: neither a walk nor its note")
        timings.append(walking ? "rung 3: the walk-through" : "rung 3: no steps left to walk (\(element("sat.notice").label))")
        snap("06-help-3-walk-through")
        for _ in 0..<6 {
            guard element("sat.walk.next").exists, element("sat.walk.next").isHittable else { break }
            element("sat.walk.next").tap()
            sleep(2)
        }

        // a wrong choice and its why: this question or the next multiple-choice one with a note on a wrong choice
        var why = false
        for hop in 0..<10 where !why {
            if hop > 0 {
                if element("sat.next").isEnabled { tap("sat.next") } else { tap("sat.previous") }
                sleep(2)
            }
            guard element("sat.choice.A").waitForExistence(timeout: 3) else { continue }
            for key in ["A", "B", "C", "D"] {
                tap("sat.choice.\(key)")
                tap("sat.check")
                if element("sat.wrong").waitForExistence(timeout: 4) {
                    if element("sat.wrong.why").waitForExistence(timeout: 2) {
                        why = true
                        snap("07-wrong-choice-why")
                    }
                    break
                }
                // right at once: no miss here (its solution is open: back to the page), on to another question
                if element("sat.solution.back").exists { tap("sat.solution.back") }
                break
            }
        }
        XCTAssertTrue(why, "no wrong choice with a why in the set")
        // the solution, two ways: a second wrong try opens it (a miss stays in the deck)
        if element("sat.wrong.tryAgain").exists {
            for key in ["A", "B", "C", "D"] {
                if element("sat.solution").exists { break }
                if element("sat.wrong.tryAgain").exists { tap("sat.wrong.tryAgain") }
                tap("sat.choice.\(key)")
                tap("sat.check")
                _ = element("sat.solution").waitForExistence(timeout: 4)
            }
        }
        if element("sat.seeSolution").exists { tap("sat.seeSolution") }
        XCTAssertTrue(element("sat.solution").waitForExistence(timeout: 10), "the solution opens")
        snap(element("sat.solution.desmosWay").exists || element("sat.solution.desmos").exists || element("sat.solution.ways").exists ? "08-solution-two-ways" : "08-solution")
        if element("sat.solution.back").exists { tap("sat.solution.back") }

        // finish the set, from question 1: each question answered (a choice or a key), checked, and on
        for _ in 0..<10 {
            if (element("sat.position").label).contains("Q1 of") { break }
            tap("sat.previous")
            usleep(600_000)
        }
        for _ in 0..<14 {
            if element("sat.summary").exists { break }
            let pos = element("sat.position").label
            if element("sat.choice.A").exists, element("sat.choice.A").isHittable {
                tap("sat.choice.A")
            } else if element("sat.key.1").exists, element("sat.key.1").isHittable {
                tap("sat.key.1")
            }
            if element("sat.check").exists, element("sat.check").isHittable, element("sat.check").isEnabled { tap("sat.check") }
            sleep(1)
            if element("sat.wrong.tryAgain").exists {
                tap("sat.wrong.tryAgain")
                if element("sat.choice.B").exists { tap("sat.choice.B") } else if element("sat.key.2").exists { tap("sat.key.2") }
                tap("sat.check")
                sleep(1)
            }
            if element("sat.solution.next").waitForExistence(timeout: 3) { tap("sat.solution.next") }
            else if element("sat.nextQuestion").exists { tap("sat.nextQuestion") }
            sleep(1)
            if !element("sat.summary").exists, element("sat.position").label == pos {
                if element("sat.nextQuestion").exists { tap("sat.nextQuestion") } else if element("sat.next").exists, element("sat.next").isEnabled { tap("sat.next") }
                sleep(1)
            }
        }
        XCTAssertTrue(element("sat.summary").waitForExistence(timeout: 20), "the set ends in the summary")
        snap("09-summary")
        XCTAssertTrue(element("sat.summary.deck").waitForExistence(timeout: 5), "the misses go into the deck")
    }

    /// The solution two ways (the paper way and the Desmos way) on a real question: nonlinear equations,
    /// where most of the bank's questions have a Desmos way. Choices only, no ink (no tutor calls).
    func testYSolutionTwoWays() throws {
        launch(autowrite: "")
        let skill = element("sat.home.skill.nonlinear-equations")
        XCTAssertTrue(skill.waitForExistence(timeout: 20), "no nonlinear equations skill row")
        for _ in 0..<6 where !skill.isHittable { app.swipeUp() }
        skill.tap()
        waitFor("sat.position", label: "Q1 of", timeout: 60)
        var shown = false
        for _ in 0..<10 where !shown {
            for key in ["A", "B", "C", "D", "A"] {
                if element("sat.solution").exists { break }
                if element("sat.wrong.tryAgain").exists { tap("sat.wrong.tryAgain") }
                if element("sat.choice.\(key)").exists {
                    tap("sat.choice.\(key)")
                } else if element("sat.key.1").exists {
                    tap("sat.key.\(key == "A" ? 1 : 2)")
                }
                tap("sat.check")
                _ = element("sat.solution").waitForExistence(timeout: 4)
            }
            if element("sat.solution").exists, element("sat.solution.desmosWay").exists || element("sat.solution.ways").exists {
                shown = true
                snap("08b-solution-two-ways")
            } else if element("sat.solution.next").exists {
                tap("sat.solution.next")
                sleep(2)
            } else if element("sat.next").exists {
                tap("sat.next")
                sleep(2)
            }
        }
        XCTAssertTrue(shown, "no solution with a Desmos way in the set")
    }

    /// SAT home after the harness moved the deck's review to today: "1 to review".
    func testZReviewDueOnHome() throws {
        launch(autowrite: "")
        waitFor("sat.home.reviews", label: "to review", timeout: 30)
        snap("10-home-review-due")
    }

    // MARK: - helpers

    /// › until a question with a plane (the probe's `plot yes`), at most nine times.
    private func goToPlot() -> Bool {
        if (element("sat.debug").value as? String ?? "").contains("plot yes") { return true }
        for _ in 0..<9 {
            tap("sat.next")
            sleep(2)
            if (element("sat.debug").value as? String ?? "").contains("plot yes") { return true }
        }
        return false
    }

    /// The autowriter's next token on a page without a plane (a circle there does nothing).
    private func advanceWriting() -> Bool {
        tap("sat.debug.write")
        sleep(1)
        return true
    }

    /// A number the probe carries (`tutorInk 3`), -1 when it is not there.
    private func number(_ key: String) -> Int {
        let v = element("sat.debug").value as? String ?? ""
        guard let r = v.range(of: "\(key) -?[0-9]+", options: .regularExpression) else { return -1 }
        return Int(v[r].split(separator: " ").last ?? "") ?? -1
    }

    private func snap(_ name: String) {
        sleep(1)
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = env["AGATHON_SAT_SHOTS"], !dir.isEmpty {
            try? Self.upright(shot.image).pngData()?.write(to: URL(fileURLWithPath: dir).appendingPathComponent("sat2-live-\(name).png"))
        }
    }

    /// The capture as the iPad stands (landscape): the simulator hands it over upright-portrait.
    static func upright(_ image: UIImage) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = image.scale
        let drawn = UIGraphicsImageRenderer(size: image.size, format: format).image { _ in image.draw(at: .zero) }
        guard drawn.size.height > drawn.size.width else { return drawn }
        let size = CGSize(width: drawn.size.height, height: drawn.size.width)
        return UIGraphicsImageRenderer(size: size, format: format).image { ctx in
            let c = ctx.cgContext
            c.translateBy(x: size.width / 2, y: size.height / 2)
            c.rotate(by: -.pi / 2)
            drawn.draw(in: CGRect(x: -drawn.size.width / 2, y: -drawn.size.height / 2, width: drawn.size.width, height: drawn.size.height))
        }
    }

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

    private func waitFor(_ id: String, label: String? = nil, value: String? = nil, notValue: String? = nil, valueMatches: String? = nil,
                         timeout: TimeInterval, quiet: Bool = false, file: StaticString = #filePath, line: UInt = #line) {
        let e = element(id)
        XCTAssertTrue(e.waitForExistence(timeout: timeout), "no \(id)", file: file, line: line)
        let predicate: NSPredicate
        if let value { predicate = NSPredicate(format: "value CONTAINS %@", value) }
        else if let notValue { predicate = NSPredicate(format: "NOT (value CONTAINS %@)", notValue) }
        else if let valueMatches { predicate = NSPredicate(format: "value MATCHES %@", ".*\(valueMatches).*") }
        else { predicate = NSPredicate(format: "label CONTAINS %@", label ?? "") }
        let result = XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: e)], timeout: timeout)
        if quiet { return }
        XCTAssertEqual(result, .completed, "\(id) never said \(value ?? notValue ?? valueMatches ?? label ?? ""): \(e.value as? String ?? "nil")", file: file, line: line)
    }
}
