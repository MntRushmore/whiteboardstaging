import XCTest

/// SAT practice end to end with the SAT routes stubbed on the iPad (Debug `-satStub`: the lane's
/// fixture questions, a free tutor that runs out after its cap, an in-memory board and a quiet tutor),
/// so it needs no server (docs/SAT-MODE.md):
///
///  - open SAT from Home, Practice 10; browse six questions and choose and check: no tutor pass
///    (the owner: the pass is taken on the first ink); write on one page: one pass, the tutor on;
///  - an mcq with Bluebook's eliminator: look again, then right, then the solution;
///  - a grid-in through the keypad; a figure; the end of the set and Practice 10 more;
///  - the cap: a free account's 20 of 20 ("Unlimited lifts it"), no account's 5 of 5 ("Make a free
///    account for 20 a day", its button opening the account's age question); no live call is made;
///  - the first run's "I'm studying for the SAT": SAT home with no account, then the account's age
///    question (13+: the form; under 13: the grown-up's first run).
///
/// Screenshots (landscape and portrait) go to `TEST_RUNNER_AGATHON_SAT_SHOTS` when it is set
/// (docs/sat/screens/). Run alone:
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

    // MARK: - the session

    func test1ASetFromHomeToTheSummary() throws {
        launch()
        tap("home.sat", wait: 40)
        XCTAssertTrue(element("sat.home").waitForExistence(timeout: 20))
        waitFor("sat.home.tutorLeft", label: "20 of 20 free tutor questions left", timeout: 15)
        snap("landscape-1-home")
        tap("sat.home.practice10")
        XCTAssertTrue(element("sat.panel").waitForExistence(timeout: 30))
        XCTAssertTrue(element("board.canvas").waitForExistence(timeout: 30))
        waitFor("sat.position", label: "Question 1 of 10", timeout: 10)
        probe("q 1 tutor ready live off passes 0")
        XCTAssertTrue(element("sat.tutor.ready").exists, "the tutor is ready, not on, before any ink")

        // browsing six questions takes no pass
        for n in 2...6 {
            tap("sat.next")
            waitFor("sat.position", label: "Question \(n) of 10", timeout: 10)
        }
        probe("q 6 tutor ready live off passes 0")
        // (the board followed the panel: question 6's page)
        waitFor("board.title", label: "Question 6 of 10", timeout: 10)
        for _ in 2...6 { tap("sat.previous") }
        waitFor("sat.position", label: "Question 1 of 10", timeout: 10)

        // the eliminator, then a wrong answer (look again), then the right one, then the solution
        tap("sat.strike.A")
        waitFor("sat.choice.A", value: "Crossed out", timeout: 5)
        tap("sat.choice.B")
        snap("landscape-2-session-mcq")
        tap("sat.check")
        XCTAssertTrue(element("sat.verdict.lookAgain").waitForExistence(timeout: 5))
        waitFor("sat.choice.B", value: "Not this one", timeout: 5)
        tap("sat.choice.C")
        tap("sat.check")
        XCTAssertTrue(element("sat.verdict.right").waitForExistence(timeout: 5))
        tap("sat.seeSolution")
        XCTAssertTrue(element("sat.solution").waitForExistence(timeout: 5))
        XCTAssertTrue(element("sat.solution.desmos").waitForExistence(timeout: 5))
        snap("landscape-3-solution")
        // choosing and checking took no pass either; two attempts were sent
        probe("passes 0 attempts 2")

        // the first ink on question 1's page claims its pass: the tutor goes on, with the question's id
        drawOnBoard()
        probe("q 1 tutor on live on passes 1")
        probe("tag algebra-linear-one-var-9001")
        XCTAssertTrue(element("sat.tutor.on").waitForExistence(timeout: 5))
        drawOnBoard()
        probe("passes 1")

        // question 2: a table; question 3: a grid-in through the keypad
        tap("sat.nextQuestion")
        waitFor("sat.position", label: "Question 2 of 10", timeout: 10)
        XCTAssertTrue(element("sat.figure.table").waitForExistence(timeout: 5))
        snap("landscape-4-session-table")
        tap("sat.next")
        XCTAssertTrue(element("sat.gridin").waitForExistence(timeout: 5))
        tap("sat.key.slash")
        waitFor("sat.gridin", value: "Empty", timeout: 5)
        tap("sat.key.4")
        waitFor("sat.gridin", value: "4", timeout: 5)
        snap("landscape-5-session-gridin")
        tap("sat.check")
        XCTAssertTrue(element("sat.verdict.right").waitForExistence(timeout: 5))
        // question 4: a plotted line
        tap("sat.nextQuestion")
        XCTAssertTrue(element("sat.figure.plot").waitForExistence(timeout: 5))
        snap("landscape-6-session-plot")
        tap("sat.next")
        XCTAssertTrue(element("sat.figure.shape").waitForExistence(timeout: 5))
        snap("landscape-7-session-shape")

        // the last question: a grid-in, right; then the set's results
        for _ in 6...10 { tap("sat.next") }
        waitFor("sat.position", label: "Question 10 of 10", timeout: 10)
        tap("sat.key.5")
        tap("sat.check")
        tap("sat.results")
        XCTAssertTrue(element("sat.summary").waitForExistence(timeout: 10))
        // right first time on 3 and 10; 1 was right on the second try
        waitFor("sat.summary.score", label: "2/10", timeout: 5)
        XCTAssertTrue(element("sat.summary.review").exists)
        snap("landscape-8-summary")
        tap("sat.summary.review")
        waitFor("sat.position", label: "Reviewing 1 of", timeout: 10)
        tap("sat.endReview")
        XCTAssertTrue(element("sat.summary").waitForExistence(timeout: 10))
        tap("sat.summary.more")
        waitFor("sat.position", label: "Question 1 of 10", timeout: 20)
        XCTAssertFalse(element("sat.summary").exists)
    }

    /// A free account's cap (20 a day, all used): the cap line, the board plain ink, no live call.
    func test2TheCapWithAFreeAccount() throws {
        launch(stub: "cap=20,used=20", account: "free")
        openSet()
        drawOnBoard()
        probe("tutor capped live off passes 0")
        waitFor("sat.tutor.words", label: "Free tutor used up for today: 20 of 20. Unlimited lifts it.", timeout: 10)
        XCTAssertTrue(element("sat.tutor.capAction").exists)
        probe("calls 0")
        // the board keeps working: more ink, still nothing called
        drawOnBoard()
        probe("calls 0")
        snap("landscape-9-cap-free")
        // Graph an equation works with the tutor off
        let field = element("sat.graph.field")
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("y = 2x + 1\n")
        waitFor("sat.graph.note", label: "Graphed on your board.", timeout: 20)
    }

    /// No account: 5 a day; the cap line offers a free account (20 a day), its button the age question.
    func test3TheCapWithNoAccount() throws {
        launch(stub: "cap=5,used=5", account: "none")
        openSet()
        drawOnBoard()
        waitFor("sat.tutor.words", label: "Free tutor used up for today: 5 of 5. Make a free account for 20 a day.", timeout: 10)
        snap("landscape-10-cap-no-account")
        tap("sat.tutor.capAction")
        waitFor("sat.account.title", label: "How old are you?", timeout: 10)
    }

    /// Portrait: the panel on top, the board below; SAT home, a figure, a grid-in, the cap line, the summary.
    func test4PortraitShots() throws {
        XCUIDevice.shared.orientation = .portrait
        launch(stub: "cap=20,used=20,answered=32", account: "free")
        tap("home.sat", wait: 40)
        XCTAssertTrue(element("sat.home.estimate").waitForExistence(timeout: 20), "32 answers: the rough estimate shows")
        snap("portrait-1-home")
        tap("sat.home.practice10")
        XCTAssertTrue(element("sat.panel").waitForExistence(timeout: 30))
        tap("sat.next")
        XCTAssertTrue(element("sat.figure.table").waitForExistence(timeout: 5))
        snap("portrait-2-session-table")
        tap("sat.next")
        tap("sat.key.4")
        drawOnBoard()
        probe("tutor capped")
        snap("portrait-3-gridin-cap")
        tap("sat.check")
        tap("sat.seeSolution")
        snap("portrait-4-solution")
        tap("sat.collapse")
        XCTAssertTrue(element("sat.expand").waitForExistence(timeout: 5))
        snap("portrait-5-collapsed")
        tap("sat.expand")
        for _ in 3...10 { tap("sat.next") }
        tap("sat.key.5")
        tap("sat.check")
        tap("sat.results")
        XCTAssertTrue(element("sat.summary").waitForExistence(timeout: 10))
        snap("portrait-6-summary")
    }

    /// The first run's "I'm studying for the SAT": straight into SAT home with no account; the account
    /// asks the age first (13+ the form, under 13 the grown-up's first run).
    func test5TheFirstRunsSATPath() throws {
        launch(stub: "cap=5,used=0", account: "none", extra: ["-onboardingFresh"])
        tap("onboarding.who.sat", wait: 40)
        XCTAssertTrue(element("sat.home").waitForExistence(timeout: 20))
        waitFor("sat.home.tutorLeft", label: "5 of 5 free tutor questions left", timeout: 15)
        snap("landscape-11-first-run-sat-home")
        tap("sat.home.signUp")
        waitFor("sat.account.title", label: "How old are you?", timeout: 10)
        snap("landscape-12-account-age")
        tap("sat.account.13plus")
        XCTAssertTrue(element("sat.account.email").waitForExistence(timeout: 10))
        XCTAssertTrue(element("sat.account.password").exists)
        tap("sat.account.back")
        tap("sat.account.under13")
        tap("sat.account.grownUp")
        // the grown-up's first run, from its start
        XCTAssertTrue(element("onboarding.who.parent").waitForExistence(timeout: 20))
    }

    // MARK: - helpers

    private func openSet() {
        tap("home.sat", wait: 40)
        tap("sat.home.practice10", wait: 20)
        XCTAssertTrue(element("sat.panel").waitForExistence(timeout: 30))
        XCTAssertTrue(element("board.canvas").waitForExistence(timeout: 30))
        probe("tutor ready live off passes 0")
    }

    /// A stroke on the board with a finger (the simulator has no Pencil: a finger draws).
    private func drawOnBoard() {
        let canvas = element("board.canvas")
        XCTAssertTrue(canvas.waitForExistence(timeout: 20))
        let start = canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.45))
        let end = canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.45, dy: 0.47))
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
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("sat-\(name).png"))
        }
    }
}
