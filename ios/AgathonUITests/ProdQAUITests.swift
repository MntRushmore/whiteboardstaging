import XCTest

// The app against PRODUCTION (www.agathon.app and the production Supabase), with one throwaway QA
// account that the run makes and deletes. Nothing here runs unless asked:
//
//     TEST_RUNNER_AGATHON_PROD_QA=1 TEST_RUNNER_PROD_QA_EMAIL=qa-ipad-<timestamp>@agathon.app \
//     TEST_RUNNER_PROD_QA_PASSWORD=<a password> [TEST_RUNNER_PROD_QA_SHOTS=<a folder>] \
//     xcodebuild test … -only-testing:AgathonUITests/ProdOnboardingUITests -parallel-testing-enabled NO
//
// - The email must be `qa-ipad-…@agathon.app` (the mailer confirms on its own; nobody real is ever
//   touched), and no local stack may be named (AGATHON_API_URL, SUPABASE_URL): the app's own default
//   is production.
// - `scripts/ios-device-onboarding.sh` runs `ProdOnboardingUITests` on the owner's iPad (real App
//   Attest: the try is read and ticked by the server); `scripts/ios-prod-qa.sh` runs it on the
//   simulator (no App Attest: the try is typed, "Type it instead") with TEST_RUNNER_PROD_QA_KEEP=1,
//   then `ProdQAUITests` in order on the same account, the last of which deletes it.

/// What the production runs share: the guard, launching, tapping, the PIN pad, the gate's words.
class ProdQATestCase: XCTestCase {
    var app: XCUIApplication!
    let env = ProcessInfo.processInfo.environment
    static let pin = "2468"
    nonisolated(unsafe) static var autoFillOff = false

    var email: String { env["PROD_QA_EMAIL"] ?? "" }
    var password: String { env["PROD_QA_PASSWORD"] ?? "" }

    override func setUpWithError() throws {
        continueAfterFailure = false
        try XCTSkipUnless(env["AGATHON_PROD_QA"] == "1", "set TEST_RUNNER_AGATHON_PROD_QA=1 (production, a throwaway QA account)")
        try XCTSkipUnless(email.range(of: #"^qa-ipad-[a-z0-9-]+@agathon\.app$"#, options: .regularExpression) != nil,
                          "TEST_RUNNER_PROD_QA_EMAIL must be qa-ipad-<…>@agathon.app, never a real person's")
        try XCTSkipUnless(password.count >= 10, "TEST_RUNNER_PROD_QA_PASSWORD: 10 or more characters")
        try XCTSkipIf(env["AGATHON_API_URL"] != nil || env["SUPABASE_URL"] != nil, "a production run names no local stack")
        #if targetEnvironment(simulator)
        // the Password AutoFill sheets cover the account form under automation (the simulator only:
        // never the owner's own iPad's Settings)
        if !Self.autoFillOff {
            turnOffPasswordAutoFill()
            Self.autoFillOff = true
        }
        #endif
        XCUIDevice.shared.orientation = .landscapeLeft
    }

    func launch(_ arguments: [String], lines: String = "newpage|2x + 3 = 11|2x = 8|x = 5") {
        app = XCUIApplication()
        // -noLabs: the screens as a Release build shows them (Debug's Labs button off)
        app.launchArguments = ["-noLabs", "-onboardingMute"] + arguments + (arguments.contains("-boardAutowrite") ? [] : ["-boardAutowrite", lines])
        app.launch()
    }

    func element(_ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    func text(containing words: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", words)).firstMatch
    }

    func tap(_ id: String, wait: TimeInterval = 20, file: StaticString = #filePath, line: UInt = #line) {
        let e = element(id)
        XCTAssertTrue(e.waitForExistence(timeout: wait), "no \(id)", file: file, line: line)
        let end = Date().addingTimeInterval(wait)
        while !e.isHittable && Date() < end { usleep(100_000) }
        // answers rise in after their question: one still fading in takes no taps, as for a person
        usleep(900_000)
        e.tap()
    }

    func key(_ digits: String) {
        for d in digits {
            let label = d == "-" ? "minus" : d == "/" ? "over" : d == "." ? "point" : String(d)
            let k = app.buttons[label].firstMatch
            XCTAssertTrue(k.waitForExistence(timeout: 10), "no key \(label)")
            k.tap()
            usleep(150_000)
        }
    }

    func waitFor(_ id: String, label: String? = nil, value: String? = nil, matching regex: String? = nil, timeout: TimeInterval,
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

    func waitGone(_ e: XCUIElement, timeout: TimeInterval) -> Bool {
        XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: e)], timeout: timeout) == .completed
    }

    /// The board's autowrite: its next line, written through the canvas's touch path.
    func write(_ expected: String) {
        let button = element("debug.autowrite")
        XCTAssertTrue(button.waitForExistence(timeout: 30), "no autowrite button (Debug build with -boardAutowrite)")
        XCTAssertTrue(button.label.contains(expected), "the autowrite's next line is \(button.label), not \(expected)")
        button.tap()
        sleep(1)
        let idle = NSPredicate(format: "exists == false OR value != 'busy'")
        _ = XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: idle, object: button)], timeout: 30)
        sleep(1)
    }

    func snap(_ name: String) {
        sleep(1)
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = env["PROD_QA_SHOTS"], !dir.isEmpty {
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("ipad-prodqa-\(name).png"))
        }
    }

    /// The app's one parental gate: the number in words, typed on the pad.
    func passGate(_ id: String = "onboarding.gate.words") throws {
        let words = element(id)
        XCTAssertTrue(words.waitForExistence(timeout: 20), "no gate")
        key(try KidJourneyUITests.digits(fromWords: words.label))
    }

    /// The account form: the QA email and password, the consent, Save.
    func makeAccount() {
        let field = app.textFields["onboarding.account.email"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 30))
        sleep(1)
        field.tap()
        field.typeText(email)
        let secure = app.secureTextFields["onboarding.account.password"].firstMatch
        secure.tap()
        dismissStrongPassword()
        secure.typeText(password)
        tap("onboarding.account.consent")
        snap("05-account")
        tap("onboarding.account.save")
    }

    /// On a real iPad, iOS offers a strong password for a new-password field: our own instead.
    func dismissStrongPassword() {
        for title in ["Choose My Own Password", "Other Options…", "Not Now"] {
            let b = app.buttons[title].firstMatch
            if b.waitForExistence(timeout: 1.5) { b.tap() }
        }
    }

    /// From a kid's Home: the Grown-ups door asks the PIN, which opens the grown-ups' account area.
    func becomeTheGrownUp() {
        tap("home.grownUps", wait: 40)
        XCTAssertTrue(element("switcher.pin").waitForExistence(timeout: 20), "the Grown-ups door didn't ask a kid for the PIN")
        key(Self.pin)
        XCTAssertTrue(element("area.account").waitForExistence(timeout: 40), "no grown-ups' area after the PIN")
    }

    /// Account → Delete my account → DELETE → signed out.
    func deleteTheAccount() {
        tap("area.account", wait: 20)
        tap("account.delete", wait: 30)
        let field = element("delete.field")
        XCTAssertTrue(field.waitForExistence(timeout: 20))
        field.tap()
        field.typeText("DELETE")
        snap("90-delete-asked")
        let confirm = element("delete.confirm")
        let enabled = XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "isEnabled == true"), object: confirm)], timeout: 30)
        XCTAssertEqual(enabled, .completed, "Delete stayed disabled (the plan check never answered)")
        confirm.tap()
        // signed out: the sign-in screen (the first run is finished on this iPad)
        XCTAssertTrue(element("signin.title").waitForExistence(timeout: 60), "not signed out after deleting the account")
        snap("91-deleted-signed-out")
    }

    #if targetEnvironment(simulator)
    func turnOffPasswordAutoFill() {
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
    #endif
}

// MARK: - the first run, end to end (the owner's iPad, or the simulator)

final class ProdOnboardingUITests: ProdQATestCase {
    /// A fresh first run against production: hello → name → grade → the try (the autowrite writes
    /// the answer; a real iPad's App Attest lets the server read and tick it; the simulator can't
    /// attest, so it types it) → the plan → hand back → the gate → the account (the QA email) → the
    /// trial's "Not now" (no App Store product yet) → the PIN → the kid's profile (the first kid
    /// without a plan) → the first board. Then, unless TEST_RUNNER_PROD_QA_KEEP=1, the grown-up's PIN
    /// and the account deleted.
    func testFirstRunThenDelete() throws {
        launch(["-onboardingFresh", "-onboardingAutowrite", "right"])
        tap("onboarding.who.parent", wait: 40)
        snap("01-hello")
        let name = app.textFields["onboarding.name.field"].firstMatch
        XCTAssertTrue(name.waitForExistence(timeout: 15))
        sleep(1)
        name.tap()
        name.typeText("Sam")
        tap("onboarding.name.continue")
        tap("onboarding.grade.3", wait: 25)
        tap("onboarding.skill.times_tables", wait: 25)
        tap("onboarding.tricky.continue")
        tap("onboarding.handToKid.go", wait: 25)

        // the try: the autowrite answers; the server reads and ticks it (App Attest), or this iPad
        // can't prove itself (the simulator) and the answer is typed
        let next = element("onboarding.try.next")
        let typeIt = element("onboarding.try.typeIt")
        let deadline = Date().addingTimeInterval(120)
        while Date() < deadline && !typeIt.exists && !next.exists { usleep(250_000) }
        if typeIt.exists {
            snap("02-try-cant-read-here")
            XCTAssertTrue(text(containing: "can’t read writing on this iPad").exists || text(containing: "can’t check").exists,
                          "the try's refusal has no words")
            let answer = (typeIt.value as? String) ?? ""
            XCTAssertFalse(answer.isEmpty, "no answer to type (Debug build?)")
            typeIt.tap()
            XCTAssertTrue(element("onboarding.typeIt.check").waitForExistence(timeout: 10))
            key(answer)
            tap("onboarding.typeIt.check")
            XCTAssertTrue(waitGone(typeIt, timeout: 30), "the typed answer wasn't ticked")
        }
        XCTAssertTrue(next.waitForExistence(timeout: 90), "the tutor never ticked the try")
        sleep(2)
        snap("03-try-ticked")
        tap("onboarding.try.next")
        tap("onboarding.plan.save", wait: 40)
        snap("04-plan")
        tap("onboarding.handBack.grownUp", wait: 25)
        try passGate()
        makeAccount()

        // the trial: Apple's offer if the App Store has it; "Not now" either way (the first kid
        // without a plan, the owner's rule)
        let notNow = element("onboarding.trial.notNow")
        XCTAssertTrue(notNow.waitForExistence(timeout: 60), "no trial screen after the account (sign-up refused?)")
        sleep(4)
        snap("06-trial")
        let note = element("onboarding.trial.note")
        if !element("onboarding.trial.start").exists {
            XCTAssertTrue(note.exists, "no buy button and no words why")
        }
        notNow.tap()

        // the PIN, as the grown-up (the step that failed on the owner's iPad from a kid's profile)
        XCTAssertTrue(app.buttons["2"].waitForExistence(timeout: 30), "no PIN pad")
        sleep(3)
        snap("07-pin")
        key(Self.pin)
        sleep(1)
        key(Self.pin)
        let handOver = element("onboarding.handOver.go")
        if !handOver.waitForExistence(timeout: 40) {
            snap("07b-pin-refused")
            XCTFail("the PIN wasn't saved: \(element("onboarding.pin.note").label)")
        }
        tap("onboarding.handOver.go")
        tap("onboarding.picture.tomato", wait: 25)
        tap("onboarding.picture.done")
        let go = element("onboarding.firstBoard.go")
        XCTAssertTrue(go.waitForExistence(timeout: 90), "no first board (the kid's profile wasn't made)")
        sleep(3)
        snap("08-first-board")
        go.tap()
        XCTAssertTrue(element("board.canvas").waitForExistence(timeout: 60), "the first board never opened")
        waitFor("board.status", value: "saved", timeout: 60)
        snap("09-first-board-saved")
        tap("board.back")
        waitFor("home.greeting", label: "Sam", timeout: 40)
        snap("10-home-sam")

        guard env["PROD_QA_KEEP"] != "1" else { return }
        becomeTheGrownUp()
        deleteTheAccount()
    }
}

// MARK: - the rest of the app on that account (the simulator, after the first run with KEEP)

final class ProdQAUITests: ProdQATestCase {
    /// Sam's Home: a new board, lines written, the tutor's tick and ring (real recognize and check),
    /// Help me's hint, one Ask question, Today's practice written once, Progress.
    func test1KidJourney() throws {
        launch([])
        waitFor("home.greeting", label: "Sam", timeout: 60)
        tap("boards.new", wait: 30)
        XCTAssertTrue(element("board.canvas").waitForExistence(timeout: 60))
        sleep(2)
        write("newpage")
        write("2x + 3 = 11")
        write("2x = 8")
        waitFor("debug.live", matching: #"2 ?x ?= ?8=tick"#, timeout: 90)
        snap("20-ticked")
        write("x = 5")
        waitFor("debug.live", matching: #"x ?= ?5=ring"#, timeout: 90)
        snap("21-ringed")
        let hint = element("live.hint")
        if !hint.waitForExistence(timeout: 15) { tap("live.helpMe") }
        XCTAssertTrue(hint.waitForExistence(timeout: 60), "no hint card")
        snap("22-hint")
        tap("live.hint.gotIt")

        tap("ask.open")
        let input = element("ask.input")
        XCTAssertTrue(input.waitForExistence(timeout: 20))
        sleep(1)
        input.tap()
        input.typeText("Write 2 more problems like 2x + 3 = 11 on my board")
        tap("ask.send")
        waitFor("debug.live", matching: #"chat [1-9]"#, timeout: 150)
        sleep(4)
        snap("23-ask-wrote")
        if element("ask.close").exists { element("ask.close").tap() }
        waitFor("board.status", value: "saved", timeout: 60)
        tap("board.back")

        tap("home.startPractice", wait: 40)
        XCTAssertTrue(element("board.canvas").waitForExistence(timeout: 60))
        waitFor("debug.live", matching: #"problems [1-9]"#, timeout: 120)
        XCTAssertTrue(element("board.daily").waitForExistence(timeout: 15), "no Today's practice count on the board")
        sleep(4)
        snap("24-todays-practice")
        waitFor("board.status", value: "saved", timeout: 60)
        tap("board.back")

        tap("home.path", wait: 30)
        XCTAssertTrue(element("progress.page").waitForExistence(timeout: 30))
        sleep(3)
        snap("25-progress")
        tap("area.close")
    }

    /// On Sam's profile the grown-up places are shut: the ink meter is only a meter, Sam's own area
    /// has no Family or report, the Grown-ups door asks the PIN; a wrong PIN says so, the right one
    /// opens the grown-up's area.
    func test2KidMeetsTheGrownUpDoors() throws {
        launch([])
        waitFor("home.greeting", label: "Sam", timeout: 60)
        sleep(3)
        XCTAssertEqual(app.buttons.matching(identifier: "boards.ink").count, 0, "a kid's ink meter opens the plan")
        // Sam's own places
        tap("boards.switchProfile")
        tap("switcher.mine", wait: 20)
        XCTAssertTrue(element("area.progress").waitForExistence(timeout: 20))
        XCTAssertFalse(element("area.family").exists, "a kid sees the Family page")
        XCTAssertFalse(element("area.report").exists, "a kid sees the weekly report")
        tap("area.account")
        sleep(2)
        XCTAssertFalse(element("account.delete").exists, "a kid can delete the account")
        XCTAssertFalse(element("family.pin").exists, "a kid is offered Set PIN")
        snap("30-kid-own-area")
        tap("area.close")
        // the Grown-ups door: the PIN pad, never the area
        tap("home.grownUps", wait: 20)
        XCTAssertTrue(element("switcher.pin").waitForExistence(timeout: 20), "the Grown-ups door didn't ask the PIN")
        XCTAssertFalse(element("area.family").exists)
        key("1357")
        waitFor("switcher.error", label: "That PIN isn't right", timeout: 30)
        XCTAssertTrue(element("switcher.error").label.contains("left"), "no tries left in \(element("switcher.error").label)")
        snap("31-wrong-pin")
        key(Self.pin)
        XCTAssertTrue(element("area.account").waitForExistence(timeout: 40), "the right PIN didn't open the grown-ups' area")
        XCTAssertTrue(element("area.family").waitForExistence(timeout: 10), "a grown-up has no Family page")
        snap("32-grown-up-area")
        tap("area.close")
    }

    /// The grown-up's Family page: Change PIN (as the grown-up: saved), Sam listed, a second kid
    /// without the plan refused in words.
    func test3GrownUpFamily() throws {
        launch([])
        XCTAssertTrue(element("home.greeting").waitForExistence(timeout: 60))
        sleep(3)
        XCTAssertFalse(element("home.greeting").label.contains("Sam"), "still on Sam's profile")
        tap("home.grownUps", wait: 30)
        tap("area.family", wait: 30)
        waitFor("family.pin", label: "Change PIN", timeout: 40)
        XCTAssertTrue(element("family.kid.Sam").exists, "Sam isn't in the family")
        tap("family.pin")
        XCTAssertTrue(app.buttons["2"].waitForExistence(timeout: 15))
        key(Self.pin)
        sleep(1)
        key(Self.pin)
        XCTAssertTrue(text(containing: "PIN saved").waitForExistence(timeout: 30), "Change PIN as the grown-up wasn't saved")
        snap("40-pin-saved")
        tap("family.add")
        let name = element("kid.name")
        XCTAssertTrue(name.waitForExistence(timeout: 15))
        name.tap()
        // Return puts the keyboard away: up, it covers the sheet's Add (not hittable)
        name.typeText("Leo\n")
        let keyboardGone = XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "count == 0"), object: app.keyboards)], timeout: 5)
        if keyboardGone != .completed, app.keyboards.buttons["Hide keyboard"].exists { app.keyboards.buttons["Hide keyboard"].tap() }
        tap("kid.save")
        XCTAssertTrue(text(containing: "first kid is free").waitForExistence(timeout: 30), "a second kid without the plan wasn't explained")
        snap("41-second-kid-needs-the-plan")
        app.buttons["Cancel"].firstMatch.tap()
        tap("area.close", wait: 10)
    }

    /// Signed out from the grown-ups' area, then signed in again on the sign-in screen.
    func test4SignOutAndIn() throws {
        launch([])
        XCTAssertTrue(element("home.greeting").waitForExistence(timeout: 60))
        tap("home.grownUps", wait: 30)
        tap("area.signOut", wait: 20)
        XCTAssertTrue(element("signin.email").waitForExistence(timeout: 30), "not signed out")
        // the Blocks fields carry their id on the pill around the text field
        let field = app.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText(email)
        let secure = app.secureTextFields.firstMatch
        XCTAssertTrue(secure.waitForExistence(timeout: 10))
        secure.tap()
        secure.typeText(password)
        tap("signin.submit")
        XCTAssertTrue(element("home.greeting").waitForExistence(timeout: 60), "signing in again didn't reach Home")
        snap("50-signed-in-again")
    }

    /// The grown-up deletes the account (DeletionAdvice: no plan, nothing about money).
    func test5DeleteAccount() throws {
        launch([])
        XCTAssertTrue(element("home.greeting").waitForExistence(timeout: 60))
        sleep(2)
        tap("home.grownUps", wait: 30)
        // on Sam's profile the door asks the grown-up's PIN first
        if element("switcher.pin").waitForExistence(timeout: 8) { key(Self.pin) }
        XCTAssertTrue(element("area.account").waitForExistence(timeout: 40), "no grown-ups' area")
        deleteTheAccount()
    }
}
