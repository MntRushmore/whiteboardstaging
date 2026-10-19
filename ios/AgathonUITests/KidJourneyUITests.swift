import XCTest

/// The kid's journey through the whole app against the LOCAL stack (docs/IPAD-HANDOFF.md, the
/// integration's QA): a fresh install → the first run (the grown-up's path, the trial's stand-in) →
/// the kid's first board in the real board screen → a line written (Debug's autowrite, through the
/// canvas's own touch path: the simulator has no Pencil) → the tutor's tick → a slip ringed with its
/// hint (checked when done; Help me asks for it when checked as they go) → Ask a question → the tutor writes on the board → back Home with the board's thumbnail
/// → Progress shows the work. Then the family switch (the grown-up's PIN and back), and out of ink
/// for the kid (sent to a grown-up) and for the grown-up (the plan, behind the gate).
///
/// The tests run in order and share the account the first one makes (its email goes to
/// `JOURNEY_STATE`). The out-of-ink tests need the grown-up's ink at 0 first, which only the local
/// database can do (the runner does it between the runs: docs/IPAD-HANDOFF.md, "The integration's QA").
/// Skipped unless TEST_RUNNER_AGATHON_INTEGRATION=1 with the local stack's variables:
///
///     TEST_RUNNER_AGATHON_INTEGRATION=1 TEST_RUNNER_AGATHON_API_URL=http://localhost:3901 \
///     TEST_RUNNER_SUPABASE_URL=http://127.0.0.1:54321 TEST_RUNNER_SUPABASE_ANON_KEY=<ANON_KEY> \
///     TEST_RUNNER_JOURNEY_STATE=<a file> [TEST_RUNNER_JOURNEY_SHOTS=<a folder>] [TEST_RUNNER_JOURNEY_INK_EMPTY=1] \
///     xcodebuild test … -only-testing:AgathonUITests/KidJourneyUITests/test1Journey -parallel-testing-enabled NO
final class KidJourneyUITests: XCTestCase {
    private var app: XCUIApplication!
    private let env = ProcessInfo.processInfo.environment
    private nonisolated(unsafe) static var autoFillOff = false

    override func setUpWithError() throws {
        continueAfterFailure = false
        try XCTSkipUnless(env["AGATHON_INTEGRATION"] == "1", "set TEST_RUNNER_AGATHON_INTEGRATION=1 and point it at the local stack")
        let host = URL(string: env["SUPABASE_URL"] ?? "")?.host ?? ""
        try XCTSkipUnless(["127.0.0.1", "localhost"].contains(host), "SUPABASE_URL must be the local stack, never production")
        if !Self.autoFillOff {
            turnOffPasswordAutoFill()
            Self.autoFillOff = true
        }
        XCUIDevice.shared.orientation = env["JOURNEY_PORTRAIT"] == "1" ? .portrait : .landscapeLeft
    }

    // MARK: - 1 · fresh install → the first run → the first board → the tutor → Ask → Home → Progress

    func test1Journey() throws {
        launch(["-onboardingFresh", "-onboardingMute", "-onboardingAutowrite", "right", "-onboardingTrial", "started"])
        // the first run, the grown-up holding the iPad
        tap("onboarding.who.parent", wait: 30)
        let field = app.textFields["onboarding.name.field"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        sleep(1)
        field.tap()
        field.typeText("Sam")
        tap("onboarding.name.continue")
        tap("onboarding.grade.3", wait: 20)
        tap("onboarding.skill.times_tables", wait: 20)
        tap("onboarding.tricky.continue")
        tap("onboarding.handToKid.go", wait: 20)
        // the autowrite answers; the tutor reads and ticks it
        let next = element("onboarding.try.next")
        XCTAssertTrue(next.waitForExistence(timeout: 90), "the tutor never ticked the try")
        snap("01-try-ticked")
        next.tap()
        tap("onboarding.plan.save", wait: 30)
        tap("onboarding.handBack.grownUp", wait: 20)
        // the app's one gate: the number in words
        let words = element("onboarding.gate.words")
        XCTAssertTrue(words.waitForExistence(timeout: 20), "no gate")
        snap("02-gate")
        key(try Self.digits(fromWords: words.label))
        let email = "qa+journey-\(UUID().uuidString.prefix(8).lowercased())@example.com"
        try account(email)
        if let state = env["JOURNEY_STATE"] { try? email.write(toFile: state, atomically: true, encoding: .utf8) }
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
        sleep(3)
        snap("03-first-board-in-onboarding")
        go.tap()

        // the real board: the first board, saved, the tutor on it
        XCTAssertTrue(element("board.canvas").waitForExistence(timeout: 40), "the first board never opened in the board screen")
        waitFor("board.status", value: "saved", timeout: 40)
        sleep(2)
        snap("04-board-opened")

        // a clean page, then a kid's lines: a right step ticked, then a slip ringed
        write("newpage")
        write("2x + 3 = 11")
        write("2x = 8")
        waitFor("debug.live", matching: #"2 ?x ?= ?8=tick"#, timeout: 40)
        snap("05-ticked")
        write("x = 5")
        waitFor("debug.live", matching: #"x ?= ?5=ring"#, timeout: 40)
        snap("06-ringed")

        // a hint beside the slip: checked when done (the default since 2026-10-19), the check brings
        // the first slip's hint with its ring; checked as they go, Help me asks for it
        let hint = element("live.hint")
        if !hint.waitForExistence(timeout: 10) { tap("live.helpMe") }
        XCTAssertTrue(hint.waitForExistence(timeout: 45), "no hint card")
        sleep(1)
        snap("07-hint")
        tap("live.hint.gotIt")

        // Ask: a question, and the tutor writes on the board
        tap("ask.open")
        let input = element("ask.input")
        XCTAssertTrue(input.waitForExistence(timeout: 15))
        sleep(1)
        input.tap()
        input.typeText("Write 2 more problems like 2x + 3 = 11 on my board")
        tap("ask.send")
        waitFor("debug.live", matching: #"chat [1-9]"#, timeout: 120)
        sleep(4)
        snap("08-ask-wrote")
        if element("ask.close").exists { element("ask.close").tap() }

        // the work is saved; back Home, where the board's thumbnail shows it
        waitFor("board.status", value: "saved", timeout: 40)
        tap("board.back")
        let tile = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Sam")).matching(identifier: "boards.row").firstMatch
        XCTAssertTrue(tile.waitForExistence(timeout: 30), "the first board isn't on Home")
        let thumbed = NSPredicate(format: "value CONTAINS 'thumbnail'")
        XCTAssertEqual(XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: thumbed, object: tile)], timeout: 20), .completed,
                       "the board's tile has no thumbnail (\(tile.value as? String ?? "nil"))")
        snap("09-home-thumbnail")

        // Progress shows the work (the try, filed as Sam's first attempt)
        tap("home.path", wait: 20)
        XCTAssertTrue(element("progress.page").waitForExistence(timeout: 20))
        sleep(3)
        XCTAssertFalse(element("progress.empty").exists, "Progress is empty after the first board")
        snap("10-progress")
        tap("area.close")
    }

    // MARK: - 2 · the family switch: the grown-up's PIN, and back to the kid

    func test2FamilySwitch() throws {
        launch([])
        XCTAssertTrue(element("home.greeting").waitForExistence(timeout: 30), "not on Home")
        XCTAssertTrue(element("home.greeting").label.contains("Sam"), "Home isn't Sam's: \(element("home.greeting").label)")
        tap("boards.switchProfile")
        let grownUp = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'switcher.member.' AND NOT (identifier CONTAINS 'Sam')")).firstMatch
        XCTAssertTrue(grownUp.waitForExistence(timeout: 20), "no grown-up in the switcher")
        grownUp.tap()
        XCTAssertTrue(element("switcher.pin").waitForExistence(timeout: 10), "no PIN pad")
        snap("11-switch-pin")
        key("2468")
        XCTAssertTrue(element("home.greeting").waitForExistence(timeout: 30))
        waitFor("home.greeting", label: "Hi", timeout: 20)
        sleep(2)
        XCTAssertFalse(element("home.greeting").label.contains("Sam"), "still Sam after switching to the grown-up")
        snap("12-grown-up-home")
        // and back to the kid (no PIN for a grown-up going to their kid)
        tap("boards.switchProfile")
        tap("switcher.member.Sam", wait: 20)
        waitFor("home.greeting", label: "Sam", timeout: 30)
        snap("13-back-to-sam")
    }

    // MARK: - 2b · Today's practice: the tutor writes the problems on the board, once

    func test2bTodaysPractice() throws {
        launch([])
        XCTAssertTrue(element("home.greeting").waitForExistence(timeout: 30), "not on Home")
        tap("home.startPractice", wait: 30)
        XCTAssertTrue(element("board.canvas").waitForExistence(timeout: 40))
        // written in the tutor's hand, each heading the column under it
        waitFor("debug.live", matching: #"problems [1-9]"#, timeout: 90)
        // the day's count and stars on the board
        XCTAssertTrue(element("board.daily").waitForExistence(timeout: 10), "no Today's practice count on the board")
        sleep(6)
        snap("13b-todays-practice")
        let first = element("debug.live").label
        waitFor("board.status", value: "saved", timeout: 40)
        tap("board.back")
        // opened again: the same problems, not written twice
        tap("home.startPractice", wait: 30)
        XCTAssertTrue(element("board.canvas").waitForExistence(timeout: 40))
        sleep(8)
        let again = element("debug.live").label
        let count = { (s: String) in s.range(of: #"problems \d+"#, options: .regularExpression).map { String(s[$0]) } ?? "" }
        XCTAssertEqual(count(again), count(first), "the practice was written again: \(first) → \(again)")
        tap("board.back")
    }

    // MARK: - 3 · out of ink: the kid is sent to a grown-up (no price)

    func test3OutOfInkKid() throws {
        try XCTSkipUnless(env["JOURNEY_INK_EMPTY"] == "1", "the runner empties the grown-up's ink first (JOURNEY_INK_EMPTY=1)")
        launch(["-boardAutowrite", "3x - 5 = 10"])
        XCTAssertTrue(element("home.greeting").waitForExistence(timeout: 30))
        tap("boards.new", wait: 20)
        XCTAssertTrue(element("board.canvas").waitForExistence(timeout: 40))
        sleep(2)
        write("3x - 5 = 10")
        let ok = element("outOfInk.ok")
        XCTAssertTrue(ok.waitForExistence(timeout: 40), "no out-of-ink screen for the kid")
        XCTAssertFalse(element("outOfInk.seePlan").exists, "a kid was offered the plan")
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS '$'")).firstMatch.exists, "a kid saw a price")
        snap("14-out-of-ink-kid")
        ok.tap()
        // the status pill keeps saying help is paused
        XCTAssertTrue(element("live.status").waitForExistence(timeout: 10))
        tap("board.back")
    }

    // MARK: - 4 · out of ink: the grown-up is offered the plan, behind the gate

    func test4OutOfInkGrownUp() throws {
        try XCTSkipUnless(env["JOURNEY_INK_EMPTY"] == "1", "the runner empties the grown-up's ink first (JOURNEY_INK_EMPTY=1)")
        launch(["-boardAutowrite", "5x + 2 = 17"])
        XCTAssertTrue(element("home.greeting").waitForExistence(timeout: 30))
        tap("boards.switchProfile")
        let grownUp = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'switcher.member.' AND NOT (identifier CONTAINS 'Sam')")).firstMatch
        XCTAssertTrue(grownUp.waitForExistence(timeout: 20))
        grownUp.tap()
        XCTAssertTrue(element("switcher.pin").waitForExistence(timeout: 10))
        key("2468")
        sleep(3)
        tap("boards.new", wait: 30)
        XCTAssertTrue(element("board.canvas").waitForExistence(timeout: 40))
        sleep(2)
        write("5x + 2 = 17")
        let seePlan = element("outOfInk.seePlan")
        XCTAssertTrue(seePlan.waitForExistence(timeout: 40), "no out-of-ink screen for the grown-up")
        snap("15-out-of-ink-grown-up")
        seePlan.tap()
        let words = element("gate.words")
        XCTAssertTrue(words.waitForExistence(timeout: 10), "the plan isn't behind the gate")
        snap("16-gate")
        // a wrong answer first: a new number, never red
        key("100")
        sleep(1)
        key(try Self.digits(fromWords: words.label))
        XCTAssertTrue(element("plan.close").waitForExistence(timeout: 20), "no plan screen after the gate")
        sleep(3)
        snap("17-plan")
        tap("plan.close")
        // the iPad back to Sam (the design pass and the next runs start on the kid's Home)
        if element("board.back").waitForExistence(timeout: 10) { tap("board.back") }
        tap("boards.switchProfile", wait: 30)
        tap("switcher.member.Sam", wait: 20)
        waitFor("home.greeting", label: "Sam", timeout: 30)
    }

    // MARK: - helpers

    private func launch(_ arguments: [String]) {
        app = XCUIApplication()
        for key in ["AGATHON_API_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"] {
            if let v = env[key] { app.launchEnvironment[key] = v }
        }
        let lines = arguments.contains("-boardAutowrite") ? [] : ["-boardAutowrite", "newpage|2x + 3 = 11|2x = 8|x = 5"]
        // a variant's extra arguments (the design pass: the largest text, a narrow window)
        let extra = (env["JOURNEY_ARGS"] ?? "").split(separator: " ").map(String.init)
        // -noLabs: the screens as a Release build shows them (Debug's Labs button off)
        app.launchArguments = ["-noLabs"] + arguments + lines + extra
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
        // answers rise in after their question: one still fading in takes no taps, as for a person
        usleep(900_000)
        e.tap()
    }

    /// Writes the autowrite's next line and waits for it to finish (`debug.autowrite`'s value).
    private func write(_ expected: String) {
        let button = element("debug.autowrite")
        XCTAssertTrue(button.waitForExistence(timeout: 30), "no autowrite button (Debug build with -boardAutowrite)")
        XCTAssertTrue(button.label.contains(expected), "the autowrite's next line is \(button.label), not \(expected)")
        button.tap()
        let idle = NSPredicate(format: "exists == false OR value != 'busy'")
        sleep(1)
        _ = XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: idle, object: button)], timeout: 30)
        sleep(1)
    }

    private func waitFor(_ id: String, label: String? = nil, value: String? = nil, matching regex: String? = nil, timeout: TimeInterval,
                         file: StaticString = #filePath, line: UInt = #line) {
        let e = element(id)
        XCTAssertTrue(e.waitForExistence(timeout: timeout), "no \(id)", file: file, line: line)
        let predicate: NSPredicate
        if let label {
            predicate = NSPredicate(format: "label CONTAINS %@", label)
        } else if let value {
            predicate = NSPredicate(format: "value CONTAINS %@", value)
        } else {
            predicate = NSPredicate(format: "label MATCHES %@", ".*\(regex ?? "").*")
        }
        let result = XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: e)], timeout: timeout)
        XCTAssertEqual(result, .completed, "\(id) never matched \(label ?? value ?? regex ?? ""): label \(e.label), value \(e.value as? String ?? "nil")",
                       file: file, line: line)
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
        password.typeText("correct-horse-battery-9")
        tap("onboarding.account.consent")
        tap("onboarding.account.save")
        sleep(4)
    }

    private func snap(_ name: String) {
        sleep(1)
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = env["JOURNEY_SHOTS"], !dir.isEmpty {
            let variant = env["JOURNEY_VARIANT"].map { "-\($0)" } ?? ""
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("ipad-integrate-journey\(variant)-\(name).png"))
        }
    }

    /// iOS's Password AutoFill sheets cover the account form under automation: AutoFill off.
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

    /// "Type this number: six hundred twenty-eight" → "628".
    static func digits(fromWords spoken: String) throws -> String {
        let ones = ["zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
                    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
                    "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90]
        let words = spoken.lowercased().replacingOccurrences(of: "type this number:", with: "")
            .replacingOccurrences(of: "-", with: " ").split(whereSeparator: { $0 == " " }).map(String.init)
        var total = 0
        var current = 0
        for w in words {
            if w == "hundred" {
                current *= 100
            } else if let n = ones[w] {
                current += n
            } else {
                continue
            }
        }
        total += current
        guard (100 ... 999).contains(total) else { throw NSError(domain: "gate", code: 1, userInfo: [NSLocalizedDescriptionKey: "can't read \(spoken)"]) }
        return String(total)
    }
}
