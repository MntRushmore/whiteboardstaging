import XCTest

/// The App Store's iPad screenshots (docs/APP-STORE-LAUNCH.md, "Screenshots"), made on the LOCAL stack
/// by `scripts/ios-appstore-shots.sh` on "iPad Pro 13-inch (M5)" (2752 × 2064 in landscape, the 13-inch
/// size App Store Connect asks for). A demo family is made the way a family makes one: a fresh
/// install, the first run (the grown-up, Maya in 7th grade, her try ticked, the PIN), then the runner
/// fills four weeks of Maya's practice into the local database, and the tests go through what a family
/// sees: problem pages with ticks, a slip ringed with its hint, Ask drawing a picture, All done, Home,
/// Progress.
///
/// Debug build (the simulator has no Pencil: `-boardAutowrite` writes the lines in a kid's hand through
/// the canvas's own touch path; its button is gone once the script is written, before the shots).
/// `-noLabs`: no Labs button. The tests run in order and share the account the first one makes.
/// Skipped unless TEST_RUNNER_AGATHON_APPSTORE_SHOTS=1; refused unless every URL is this machine's.
final class AppStoreScreenshotUITests: XCTestCase {
    private var app: XCUIApplication!
    private let env = ProcessInfo.processInfo.environment
    private nonisolated(unsafe) static var autoFillOff = false

    /// Today's practice for the shots: page 1 a slip with its hint, page 2 solved, page 3 solved.
    private static let practice = "2x + 3 = 11|3x - 5 = 10|5x + 2 = 17"

    override func setUpWithError() throws {
        continueAfterFailure = false
        try XCTSkipUnless(env["AGATHON_APPSTORE_SHOTS"] == "1", "set TEST_RUNNER_AGATHON_APPSTORE_SHOTS=1 (scripts/ios-appstore-shots.sh)")
        for key in ["AGATHON_API_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"] {
            let value = try XCTUnwrap(env[key], "\(key) is needed")
            if key != "SUPABASE_ANON_KEY" {
                let host = URL(string: value)?.host ?? ""
                try XCTSkipUnless(["127.0.0.1", "localhost"].contains(host), "\(key) must be the local stack, never production")
            }
        }
        if !Self.autoFillOff {
            turnOffPasswordAutoFill()
            Self.autoFillOff = true
        }
        XCUIDevice.shared.orientation = .landscapeLeft
    }

    // MARK: - 1 · the demo family, made by the first run

    func test1DemoFamily() throws {
        // 7th grade's two-step try is 2x + 5 = 17 (the catalog's first): the first step, then the answer
        launch(["-onboardingFresh", "-onboardingMute", "-onboardingAutowrite", "right,x = 6", "-onboardingTrial", "started"])
        tap("onboarding.who.parent", wait: 30)
        let field = app.textFields["onboarding.name.field"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        sleep(1)
        field.tap()
        field.typeText("Maya")
        tap("onboarding.name.continue")
        tap("onboarding.grade.7", wait: 20)
        tap("onboarding.skill.two_step_equations", wait: 20)
        tap("onboarding.tricky.continue")
        tap("onboarding.handToKid.go", wait: 20)
        let next = element("onboarding.try.next")
        XCTAssertTrue(next.waitForExistence(timeout: 90), "the tutor never ticked the try")
        sleep(2)
        snap("first-run-try")
        next.tap()
        tap("onboarding.plan.save", wait: 30)
        tap("onboarding.handBack.grownUp", wait: 20)
        let words = element("onboarding.gate.words")
        XCTAssertTrue(words.waitForExistence(timeout: 20), "no gate")
        key(try KidJourneyUITests.digits(fromWords: words.label))
        let email = env["APPSTORE_EMAIL"] ?? "demo-family-\(UUID().uuidString.prefix(6).lowercased())@example.com"
        try account(email)
        if let state = env["APPSTORE_STATE"] { try? email.write(toFile: state, atomically: true, encoding: .utf8) }
        tap("onboarding.trial.start", wait: 30)
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Allow"]
        if allow.waitForExistence(timeout: 6) { allow.tap() }
        sleep(3)
        key("2468")
        sleep(1)
        key("2468")
        tap("onboarding.handOver.go", wait: 30)
        tap("onboarding.picture.tomato", wait: 20)
        tap("onboarding.picture.done")
        let go = element("onboarding.firstBoard.go")
        XCTAssertTrue(go.waitForExistence(timeout: 60), "no first board")
        sleep(2)
        go.tap()
        XCTAssertTrue(element("board.canvas").waitForExistence(timeout: 40), "the first board never opened")
        waitFor("board.status", value: "saved", timeout: 40)
        sleep(2)
        tap("board.back")
        XCTAssertTrue(element("home.greeting").waitForExistence(timeout: 30), "not on Home")
    }

    // MARK: - 2 · Today's practice: a slip ringed with its hint, a page solved, All done
    //
    // One launch per page, each with only that page's lines: Debug's autowrite button leaves the top bar
    // once its script is written, so every shot is taken with the script done (no debug UI in a shot).

    func test2aHintOnASlip() throws {
        openPractice(lines: "2x = 8|answer:x = 5", page: 1)
        write("2x = 8")
        write("answer:x = 5")
        waitFor("debug.live", matching: #"2 ?x ?= ?8=tick.*x ?= ?5=ring"#, timeout: 60)
        XCTAssertTrue(element("live.hint").waitForExistence(timeout: 30), "no hint on the slip")
        noDebugUI()
        sleep(4)
        snap("hint-on-a-slip")
        if element("live.hint.gotIt").exists { element("live.hint.gotIt").tap() }
        waitFor("board.status", value: "saved", timeout: 40)
        tap("board.back")
    }

    func test2bPageSolved() throws {
        openPractice(lines: "3x = 15|answer:x = 5", page: 2)
        write("3x = 15")
        write("answer:x = 5")
        waitFor("debug.live", matching: #"3 ?x ?= ?15=tick.*x ?= ?5=tick.*action next"#, timeout: 60)
        noDebugUI()
        sleep(3)
        snap("problem-page-ticked")
        waitFor("board.status", value: "saved", timeout: 40)
        tap("board.back")
    }

    func test2cAllDone() throws {
        openPractice(lines: "5x = 15|answer:x = 3", page: 3)
        write("5x = 15")
        write("answer:x = 3")
        waitFor("debug.live", matching: #"x ?= ?3=tick.*action alldone"#, timeout: 60)
        sleep(2)
        tap("live.next")
        XCTAssertTrue(element("live.allDone").waitForExistence(timeout: 20), "no All done")
        noDebugUI()
        sleep(3)
        snap("all-done")
        waitFor("board.status", value: "saved", timeout: 40)
        let home = app.buttons["Back to my boards"].firstMatch
        if home.exists { home.tap() } else { tap("board.back") }
        XCTAssertTrue(element("home.greeting").waitForExistence(timeout: 30))
    }

    /// Today's practice (written once, the first time), on problem `page` of 3, with `lines` to write.
    private func openPractice(lines: String, page: Int) {
        launch(["-practiceProblems", Self.practice, "-boardAutowrite", lines])
        tap("home.startPractice", wait: 40)
        XCTAssertTrue(element("board.canvas").waitForExistence(timeout: 40))
        waitFor("debug.live", matching: #"page [1-3]/3 .*screens 4"#, timeout: 90)
        for _ in 0..<6 {
            let label = element("debug.live").label
            guard let r = label.range(of: #"page (\d)/3"#, options: .regularExpression),
                  let now = Int(label[r].dropFirst(5).prefix(1)) else { break }
            if now == page { break }
            app.buttons[now < page ? "Next page" : "Page before"].firstMatch.tap()
            sleep(2)
        }
        waitFor("debug.live", matching: "page \(page)/3", timeout: 20)
        waitFor("board.title", matching: "Problem \(page) of 3", timeout: 10)
        sleep(2)
    }

    /// Nothing of Debug's on screen: the autowrite button is gone once its lines are written.
    private func noDebugUI() {
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element("debug.autowrite"))
        XCTAssertEqual(XCTWaiter().wait(for: [gone], timeout: 15), .completed, "Debug's autowrite button is still on screen")
    }

    // MARK: - 3 · Ask answers and draws a picture on the board

    func test3AskDraws() throws {
        launch([])
        tap("boards.new", wait: 30)
        XCTAssertTrue(element("board.canvas").waitForExistence(timeout: 40))
        waitFor("board.status", value: "saved", timeout: 40)
        sleep(2)
        tap("ask.open")
        let input = element("ask.input")
        XCTAssertTrue(input.waitForExistence(timeout: 15))
        sleep(1)
        input.tap()
        input.typeText(env["APPSTORE_ASK"] ?? "Why is 3/4 bigger than 5/8? Can you show me?")
        tap("ask.send")
        waitFor("debug.live", matching: #"chat [1-9]"#, timeout: 150)
        waitUntilWritten(timeout: 120)
        sleep(4)
        noDebugUI()
        snap("ask-draws")
        if element("ask.close").exists { element("ask.close").tap() }
        waitFor("board.status", value: "saved", timeout: 40)
        tap("board.back")
        XCTAssertTrue(element("home.greeting").waitForExistence(timeout: 30))
    }

    // MARK: - 4 · Home and Progress

    func test4HomeAndProgress() throws {
        launch([])
        XCTAssertTrue(element("home.greeting").waitForExistence(timeout: 30), "not on Home")
        // the boards' thumbnails drawn
        let tile = app.buttons.matching(identifier: "boards.row").firstMatch
        XCTAssertTrue(tile.waitForExistence(timeout: 30), "no boards on Home")
        sleep(6)
        snap("home")
        tap("home.path", wait: 20)
        XCTAssertTrue(element("progress.page").waitForExistence(timeout: 20))
        XCTAssertTrue(element("progress.chart").waitForExistence(timeout: 20), "Progress has no chart (no practice seeded?)")
        sleep(4)
        snap("progress")
        let skills = element("progress.skills")
        if skills.exists {
            app.swipeUp()
            sleep(2)
            snap("progress-skills")
        }
        tap("area.close")
    }

    // MARK: - helpers

    private func launch(_ arguments: [String]) {
        app = XCUIApplication()
        for key in ["AGATHON_API_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"] {
            if let v = env[key] { app.launchEnvironment[key] = v }
        }
        // -noLabs: the screens as a Release build shows them (Debug's Labs button off)
        app.launchArguments = ["-noLabs"] + arguments
        app.launch()
    }

    private func element(_ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func tap(_ id: String, wait: TimeInterval = 15, file: StaticString = #filePath, line: UInt = #line) {
        let e = element(id)
        XCTAssertTrue(e.waitForExistence(timeout: wait), "no \(id)", file: file, line: line)
        let end = Date().addingTimeInterval(wait)
        while !e.isHittable && Date() < end { usleep(100_000) }
        usleep(900_000)
        e.tap()
    }

    private func write(_ expected: String) {
        let button = element("debug.autowrite")
        XCTAssertTrue(button.waitForExistence(timeout: 30), "no autowrite button (Debug build with -boardAutowrite)")
        XCTAssertTrue(button.label.contains(expected.replacingOccurrences(of: "answer:", with: "")),
                      "the autowrite's next line is \(button.label), not \(expected)")
        button.tap()
        let idle = NSPredicate(format: "exists == false OR value != 'busy'")
        sleep(1)
        _ = XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: idle, object: button)], timeout: 30)
        sleep(1)
    }

    private func waitFor(_ id: String, value: String? = nil, matching regex: String? = nil, timeout: TimeInterval,
                         file: StaticString = #filePath, line: UInt = #line) {
        let e = element(id)
        XCTAssertTrue(e.waitForExistence(timeout: timeout), "no \(id)", file: file, line: line)
        let predicate = value.map { NSPredicate(format: "value CONTAINS %@", $0) }
            ?? NSPredicate(format: "label MATCHES %@", ".*\(regex ?? "").*")
        let result = XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: e)], timeout: timeout)
        XCTAssertEqual(result, .completed, "\(id) never matched \(value ?? regex ?? ""): label \(e.label), value \(e.value as? String ?? "nil")",
                       file: file, line: line)
    }

    /// Ask's reply finished: no tutor message thinking, streaming or writing.
    private func waitUntilWritten(timeout: TimeInterval) {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            let busy = ["thinking", "streaming", "writing"].contains { app.descendants(matching: .any).matching(identifier: "ask.message.tutor.\($0)").firstMatch.exists }
            if !busy { return }
            sleep(1)
        }
        XCTFail("Ask was still answering after \(Int(timeout)) s")
    }

    private func key(_ digits: String) {
        for d in digits {
            let k = app.buttons[String(d)].firstMatch
            XCTAssertTrue(k.waitForExistence(timeout: 10))
            k.tap()
            usleep(150_000)
        }
    }

    private func account(_ email: String) throws {
        let field = app.textFields["onboarding.account.email"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 20))
        sleep(1)
        field.tap()
        field.typeText(email)
        let password = app.secureTextFields["onboarding.account.password"].firstMatch
        password.tap()
        password.typeText(env["APPSTORE_PASSWORD"] ?? "demo-family-2026")
        tap("onboarding.account.consent")
        tap("onboarding.account.save")
        sleep(4)
    }

    /// The screen as the App Store shows it: the full-resolution PNG (2752 × 2064 on the 13-inch).
    private func snap(_ name: String) {
        sleep(1)
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = env["APPSTORE_SHOTS"], !dir.isEmpty {
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("raw-\(name).png"))
        }
    }

    private func turnOffPasswordAutoFill() {
        let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
        settings.launch()
        defer { settings.terminate() }
        let general = settings.staticTexts["General"].firstMatch
        guard general.waitForExistence(timeout: 15) else { return }
        general.tap()
        let autofill = settings.staticTexts["AutoFill & Passwords"].firstMatch
        guard autofill.waitForExistence(timeout: 10) else { return }
        autofill.tap()
        let toggle = settings.switches.matching(NSPredicate(format: "label BEGINSWITH 'AutoFill Passwords'")).firstMatch
        guard toggle.waitForExistence(timeout: 10) else { return }
        if toggle.value as? String == "1" { toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap() }
    }
}
