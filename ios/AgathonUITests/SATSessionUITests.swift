import XCTest

/// SAT practice v2 end to end with every service stubbed on the iPad (Debug `-satStub`: the fixture
/// questions, or the bank lane's sample-20 with `bank=sample`; a free tutor that runs out after its
/// cap; an in-memory board; a quiet tutor whose reads are `-satStubRead`'s, so no model is ever
/// called), so it needs no server (docs/SAT-V2.md):
///
///  - the question is the page: "Q1 of 10" in the top bar, the cards printed at the bottom; browsing
///    takes no pass; the first ink takes one;
///  - choose, the eliminator, a wrong check (its "why" note), Try again, the right check, the
///    solution's two ways;
///  - Help me's three rungs with the live tutor on (the nudge, the live step and "Your turn", the
///    walk-through a tap a step), and capped (the bank's step in the tutor's ink, no live call);
///  - the figure's marks in graph terms, Graph an equation onto the question's plane;
///  - the grid-in's keypad, a common wrong answer's note;
///  - the mistake deck: SAT home's "to review today", a review's chip, the summary's "Into the deck".
///
/// Screenshots (landscape and portrait) go to `TEST_RUNNER_AGATHON_SAT_SHOTS` when it is set
/// (docs/sat2/screens/). Run alone:
///
///     xcodebuild test-without-building … -only-testing:AgathonUITests/SATSessionUITests -parallel-testing-enabled NO
final class SATSessionUITests: XCTestCase {
    private var app: XCUIApplication!
    private let env = ProcessInfo.processInfo.environment

    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
    }

    override func tearDownWithError() throws {
        app?.terminate()
    }

    private func launch(stub: String = "cap=20,used=0", account: String = "free", extra: [String] = []) {
        app = XCUIApplication()
        app.launchArguments += ["-satStub", stub, "-satAccount", account, "-satShots", "-noLabs"]
            + (extra.contains("-onboardingFresh") ? [] : ["-agathon.onboarding.finished", "YES"]) + extra
        app.launch()
    }

    // MARK: - the question is the page

    func test1ChooseEliminateCheckAndTheTwoWays() throws {
        launch()
        tap("home.sat", wait: 40)
        XCTAssertTrue(element("sat.home").waitForExistence(timeout: 20))
        tap("sat.home.practice10")
        XCTAssertTrue(element("board.canvas").waitForExistence(timeout: 30))
        waitFor("sat.position", label: "Q1 of 10", timeout: 15)
        probe("q 1 tutor ready live off passes 0")
        // the cards are on the page, the pens at the bottom right, Help me and Check at the left
        XCTAssertTrue(element("sat.choice.A").waitForExistence(timeout: 10))
        XCTAssertTrue(element("sat.tool.pen").exists && element("sat.helpMe").exists && element("sat.check").exists)
        XCTAssertLessThan(element("sat.helpMe").frame.minX, element("sat.check").frame.minX)
        XCTAssertLessThan(element("sat.check").frame.maxX, element("sat.tool.select").frame.minX)
        XCTAssertFalse(element("sat.check").isEnabled, "Check waits for an answer")
        snap("landscape-01-question")

        // browsing takes no pass; the board follows
        for n in 2...5 {
            tap("sat.next")
            waitFor("sat.position", label: "Q\(n) of 10", timeout: 10)
        }
        probe("q 5 tutor ready live off passes 0")
        for _ in 2...5 { tap("sat.previous") }
        waitFor("sat.position", label: "Q1 of 10", timeout: 10)

        // the eliminator, then a wrong choice: its why, Try again
        tap("sat.strike.B")
        waitFor("sat.choice.B", value: "Crossed out", timeout: 5)
        tap("sat.choice.A")
        waitFor("sat.choice.A", value: "Chosen", timeout: 5)
        tap("sat.check")
        XCTAssertTrue(element("sat.wrong").waitForExistence(timeout: 5))
        waitFor("sat.wrong.why", label: "Subtracted 5 from 9", timeout: 5)
        waitFor("sat.choice.A", value: "Not this one", timeout: 5)
        snap("landscape-06-wrong-answer")
        tap("sat.wrong.tryAgain")
        XCTAssertFalse(element("sat.wrong").exists)
        tap("sat.choice.C")
        tap("sat.check")
        // right: the solution, the paper way and the Desmos way side by side
        XCTAssertTrue(element("sat.solution").waitForExistence(timeout: 5))
        XCTAssertTrue(element("sat.verdict.right").exists)
        XCTAssertTrue(element("sat.solution.paper").exists)
        XCTAssertTrue(element("sat.solution.desmosWay").exists, "question 1 has a Desmos way")
        snap("landscape-07-solution-two-ways")
        probe("passes 0 attempts 2")
        tap("sat.solution.back")
        XCTAssertFalse(element("sat.solution").exists)
        waitFor("sat.choice.C", value: "Right", timeout: 5)

        // the first ink on the page claims its pass, the tutor on, the question's id on every call
        drawOnBoard()
        probe("q 1 tutor on live on passes 1")
        probe("tag algebra-linear-one-var-9001")
        tap("sat.nextQuestion")
        waitFor("sat.position", label: "Q2 of 10", timeout: 10)
    }

    // MARK: - Help me's ladder

    /// With the day's pass: the nudge, ONE step through the live Help me (the engine's step from the
    /// stubbed read: no model), "Your turn", then the walk-through a tap a step.
    func test2TheLadderWithTheTutorOn() throws {
        launch(stub: "cap=20,used=0", extra: ["-satStubRead", "4x - 12 + 7 = 2x + 9"])
        openSet()
        drawOnBoard()
        probe("tutor on live on passes 1")
        sleep(2)
        tap("sat.helpMe")
        XCTAssertTrue(element("sat.nudge").waitForExistence(timeout: 5))
        waitFor("sat.nudge.text", label: "distribute the 4", timeout: 5)
        waitFor("sat.helpMe", value: "1 of 3", timeout: 5)
        snap("landscape-03-rung1-nudge")
        tap("sat.helpMe")
        // rung 2: one step written by the tutor, "Your turn" beside it
        probe("rung 2", timeout: 10)
        probe("yourTurn yes", timeout: 20)
        XCTAssertTrue(element("sat.yourTurn").waitForExistence(timeout: 5))
        XCTAssertFalse(element("sat.nudge").exists)
        snap("landscape-04-rung2-one-step")
        tap("sat.helpMe")
        // rung 3: the walk-through, the Check replaced by its pill
        XCTAssertTrue(element("sat.walk.next").waitForExistence(timeout: 5))
        probe("rung 3", timeout: 5)
        probe("walk 1/3", timeout: 10)
        snap("landscape-05-rung3-walk")
        tap("sat.walk.next")
        probe("walk 2/3", timeout: 10)
        tap("sat.walk.next")
        probe("walk 3/3", timeout: 10)
        tap("sat.walk.next")
        XCTAssertTrue(element("sat.check").waitForExistence(timeout: 10), "the last step turns the pill back into Check")
        XCTAssertTrue(element("sat.walk.caption.3").exists)
    }

    /// Capped: the top bar's line and the ladder laid out once; Help me still climbs, rung 2 is the
    /// bank's next step in the tutor's ink, and nothing is called.
    func test3TheLadderCapped() throws {
        launch(stub: "cap=20,used=20", account: "free")
        openSet()
        drawOnBoard()
        probe("tutor capped live off passes 0")
        waitFor("sat.tutor.capped", label: "Tutor checks used up today: 20 of 20. Help me still works.", timeout: 10)
        XCTAssertTrue(element("sat.ladderCard").waitForExistence(timeout: 5))
        snap("landscape-10-capped")
        tap("sat.helpMe")
        XCTAssertFalse(element("sat.ladderCard").exists, "the card goes on the next tap")
        XCTAssertTrue(element("sat.nudge").waitForExistence(timeout: 5))
        tap("sat.helpMe")
        probe("yourTurn yes", timeout: 15)
        probe("calls 0")
        XCTAssertTrue(element("sat.yourTurn").exists)
        snap("landscape-10b-capped-bank-step")
        // the capped line's button: the plan (a free account)
        tap("sat.tutor.capped")
    }

    // MARK: - the figure

    /// Ink on the plane is read in its terms (for the tutor's context); Graph an equation draws onto it.
    func test4WriteOnTheFigure() throws {
        launch()
        openSet()
        for _ in 2...4 { tap("sat.next") }
        waitFor("sat.position", label: "Q4 of 10", timeout: 10)
        tap("sat.debug.circle")
        probe("marks On the question's graph the student drew: circled near (0, 4).", timeout: 10)
        tap("sat.tool.graph")
        let field = element("sat.graph.field")
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.typeText("y = -2x + 4\n")
        waitFor("sat.graph.note", label: "Graphed on your board.", timeout: 20)
        probe("tutorInk", timeout: 5)
        snap("landscape-02-figure-marks-graph")
    }

    // MARK: - the grid-in

    func test5TheGridInsKeypadAndACommonWrongAnswer() throws {
        launch()
        openSet()
        tap("sat.next")
        tap("sat.next")
        waitFor("sat.position", label: "Q3 of 10", timeout: 10)
        XCTAssertTrue(element("sat.gridin").waitForExistence(timeout: 5))
        tap("sat.key.2")
        waitFor("sat.gridin", value: "2", timeout: 5)
        snap("landscape-08-gridin")
        tap("sat.check")
        // "2" is y: the bank's common wrong answer says so
        waitFor("sat.wrong.why", label: "That's y", timeout: 5)
        tap("sat.wrong.tryAgain")
        tap("sat.key.4")
        tap("sat.check")
        XCTAssertTrue(element("sat.verdict.right").waitForExistence(timeout: 5))
    }

    // MARK: - the deck, the summary, portrait

    /// The bank lane's sample with two reviews due: SAT home's line, the review chip, the end of the
    /// set's deck; then portrait: the page scaled to the width, the solution's ways as tabs.
    func test6TheDeckAndPortrait() throws {
        launch(stub: "cap=20,used=0,bank=sample,reviews=2")
        tap("home.sat", wait: 40)
        waitFor("sat.home.reviews", label: "2 to review today", timeout: 20)
        snap("landscape-12-home")
        tap("sat.home.practice10")
        waitFor("sat.position", label: "Q1 of 10", timeout: 30)
        XCTAssertTrue(element("sat.review").waitForExistence(timeout: 5), "a review carries its chip")
        // miss question 1 twice: into the deck
        let wrong = ["A", "B", "C", "D"].first { key in
            element("sat.choice.\(key)").waitForExistence(timeout: 5)
            tap("sat.choice.\(key)")
            tap("sat.check")
            return element("sat.wrong").waitForExistence(timeout: 2)
        }
        XCTAssertNotNil(wrong)
        // (the second miss: another wrong choice)
        for key in ["A", "B", "C", "D"] where key != wrong {
            tap("sat.choice.\(key)")
            tap("sat.check")
            if element("sat.solution").waitForExistence(timeout: 2) { break }
            tap("sat.wrong.tryAgain")
        }
        if element("sat.solution.back").exists { tap("sat.solution.back") }
        XCUIDevice.shared.orientation = .portrait
        sleep(2)
        snap("portrait-13-question")
        // the plotted line question of the sample, in portrait
        for _ in 2...4 { tap("sat.next") }
        snap("portrait-13b-plot")
        XCUIDevice.shared.orientation = .landscapeLeft
        sleep(1)
        // the rest unanswered: the results
        for _ in 5...10 { tap("sat.next") }
        if element("sat.key.5").exists {
            tap("sat.key.5")
        } else {
            tap("sat.choice.A")
        }
        tap("sat.check")
        if element("sat.solution").waitForExistence(timeout: 3) {
            tap("sat.solution.next")
        } else {
            tap("sat.wrong.tryAgain")
            tap(element("sat.key.1").exists ? "sat.key.1" : "sat.choice.B")
            tap("sat.check")
            tap("sat.solution.next")
        }
        XCTAssertTrue(element("sat.summary").waitForExistence(timeout: 10))
        XCTAssertTrue(element("sat.summary.deck").waitForExistence(timeout: 5))
        XCTAssertTrue(element("sat.summary.deck.1").exists, "question 1 went into the deck")
        snap("landscape-11-summary")
    }

    /// Portrait: the solution's two ways as tabs.
    func test7PortraitSolutionTabs() throws {
        XCUIDevice.shared.orientation = .portrait
        launch(stub: "cap=20,used=0")
        openSet()
        snap("portrait-01-question")
        tap("sat.choice.C")
        tap("sat.check")
        XCTAssertTrue(element("sat.solution").waitForExistence(timeout: 5))
        XCTAssertTrue(element("sat.solution.ways").waitForExistence(timeout: 5), "upright: the ways are tabs")
        snap("portrait-07-solution-tabs")
    }

    /// The first run's "I'm studying for the SAT": straight into SAT home with no account; the account
    /// asks the age first (13+ the form, under 13 the grown-up's first run).
    func test8TheFirstRunsSATPath() throws {
        launch(stub: "cap=5,used=0", account: "none", extra: ["-onboardingFresh"])
        tap("onboarding.who.sat", wait: 40)
        XCTAssertTrue(element("sat.home").waitForExistence(timeout: 20))
        waitFor("sat.home.tutorLeft", label: "5 of 5 free tutor questions left", timeout: 15)
        tap("sat.home.signUp")
        waitFor("sat.account.title", label: "How old are you?", timeout: 10)
        tap("sat.account.13plus")
        XCTAssertTrue(element("sat.account.email").waitForExistence(timeout: 10))
        tap("sat.account.back")
        tap("sat.account.under13")
        tap("sat.account.grownUp")
        XCTAssertTrue(element("onboarding.who.parent").waitForExistence(timeout: 20))
    }

    // MARK: - helpers

    private func openSet() {
        tap("home.sat", wait: 40)
        tap("sat.home.practice10", wait: 20)
        XCTAssertTrue(element("board.canvas").waitForExistence(timeout: 30))
        waitFor("sat.position", label: "Q1 of 10", timeout: 15)
        probe("tutor ready live off passes 0")
    }

    /// A stroke in the work area with a finger (the simulator has no Pencil: a finger draws).
    private func drawOnBoard() {
        let canvas = element("board.canvas")
        XCTAssertTrue(canvas.waitForExistence(timeout: 20))
        let start = canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.12, dy: 0.42))
        let end = canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.44))
        start.press(forDuration: 0.05, thenDragTo: end)
        sleep(1)
    }

    /// The session's probe (`sat.debug`) says `text`.
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

    private func waitFor(_ id: String, label: String? = nil, value: String? = nil, timeout: TimeInterval,
                         file: StaticString = #filePath, line: UInt = #line) {
        let e = element(id)
        XCTAssertTrue(e.waitForExistence(timeout: timeout), "no \(id)", file: file, line: line)
        let predicate = value.map { NSPredicate(format: "value CONTAINS %@", $0) } ?? NSPredicate(format: "label CONTAINS %@", label ?? "")
        let result = XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: e)], timeout: timeout)
        XCTAssertEqual(result, .completed, "\(id) never said \(value ?? label ?? ""): label \(e.label), value \(e.value as? String ?? "nil")",
                       file: file, line: line)
    }

    private func snap(_ name: String) {
        sleep(1)
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = env["AGATHON_SAT_SHOTS"], !dir.isEmpty {
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("sat2-\(name).png"))
        }
    }
}
