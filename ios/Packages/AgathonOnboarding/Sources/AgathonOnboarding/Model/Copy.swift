import Foundation

/// Every word the onboarding says, for whoever is there: the grown-up (with or without the kid's
/// name) or the kid alone (docs/ONBOARDING.md, screen by screen; the web's `flowCopy`). Short, sure,
/// full stops, few exclamation marks, US English. A kid never reads "wrong", a price or "free trial".
public struct OnboardingCopy: Sendable {
    let kid: Bool
    let name: String?
    let level: String?

    public init(_ a: OnboardingAnswers, catalog: OnboardingCatalog = .shared) {
        kid = a.role == .kid
        name = a.name
        level = a.choice?.label(catalog)
    }

    /// "Sam’s"
    static func possessive(_ name: String) -> String { "\(name)’s" }

    /// "Sam", or what stands in for the kid when there is no name.
    var them: String { name ?? "your kid" }
    var They: String { name ?? "They" }

    // MARK: hello

    public struct Hello: Sendable {
        public let hi = "Hi."
        public let question = "Who’s holding the iPad?"
        public let lede = "A few taps, then a problem to try."
        public let grownUpSmall = "I’m a"
        public let grownUpBig = "grown-up"
        public let grownUpHint = "Setting it up for a kid"
        public let kidSmall = "I’m a"
        public let kidBig = "kid"
        public let kidHint = "Here to practice"
        public let signIn = "I have an account. Sign in"
    }
    public var hello: Hello { Hello() }

    // MARK: name

    public var nameTitle: String { kid ? "What’s your first name?" : "What’s your kid’s first name?" }
    public let nameLede = "Write it with your Pencil, or type it."
    public var namePlaceholder: String { kid ? "Your first name" : "Their first name" }
    public let nameInvalid = "Use letters only, like Sam or Mary-Kate."
    /// What the tutor writes back.
    public static func reply(_ name: String?) -> String { name.map { "Hi, \($0)." } ?? "Hi there." }

    // MARK: grade

    public var gradeTitle: String {
        kid ? "What grade are you in?" : name.map { "What grade is \($0) in?" } ?? "What grade is your kid in?"
    }
    public var gradeLede: String { kid ? "So every problem is just right." : "The tutor picks problems for that grade." }
    public let highSchool = "High school"
    public let highSchoolHint = "Algebra, geometry and up"
    public var courseTitle: String {
        kid ? "Which class are you taking?" : name.map { "Which class is \($0) taking?" } ?? "Which class are they taking?"
    }
    public let courseLede = "Pick the one closest to it."
    public let backToGrades = "Back to grades"

    // MARK: tricky

    public var trickyTitle: String {
        kid ? "What feels tricky right now?" : name.map { "What’s tricky for \($0) right now?" } ?? "What’s tricky right now?"
    }
    public var trickyLede: String {
        kid ? "Pick up to 3. Your plan starts there."
            : name.map { "Pick up to 3. \(Self.possessive($0)) plan starts there." } ?? "Pick up to 3. Their plan starts there."
    }
    public func picked(_ n: Int) -> String { "\(n) of 3 picked" }
    public let trickyFull = "That’s 3. Tap one to swap it."
    public let notSure = "Not sure"
    public let notSureHint = "Start at the beginning"

    // MARK: hand to the kid

    public var handToKidTitle: String { "Hand the iPad to \(them)." }
    public var handToKidLede: String {
        name.map { "\($0) writes one answer. The tutor checks it in a few seconds." }
            ?? "They write one answer. The tutor checks it in a few seconds."
    }
    public let handToKidSmall = "No Pencil? A finger works too."
    public var kidHasIt: String { name.map { "\($0) has it" } ?? "They have it" }
    public let tryItFirst = "I’ll try it first"

    // MARK: the try

    public var tryTitle: String { name.map { "Your turn, \($0)." } ?? "Your turn." }
    public let skipForNow = "Skip for now"
    public let writeHere = "Write here"
    public let instruction = "Write the answer in the box."
    public let checking = "Checking…"
    public let gotIt = "You got it."
    public let firstStar = "Your first star."
    public let oneMore = "One more"
    public let next = "Next"
    public let lookAgain = "Look again."
    public let biggerPlease = "Write it a little bigger."
    public let wholeAnswer = "Write the whole answer."
    public let cantCheck = "The tutor can’t check right now. Tap Next to keep going."
    public let typeInstead = "Type it instead"
    public let typePrompt = "Type your answer"
    public let check = "Check"
    public let helpMe = "Help me"

    // MARK: the beat and the plan

    public var buildingTitle: String {
        kid ? "Making your plan." : name.map { "Making \(Self.possessive($0)) plan." } ?? "Making the plan."
    }
    public var buildingLevel: String { level.map { "\($0) problems" } ?? "Problems for every level" }
    public func buildingStart(_ skill: String?) -> String { skill.map { "Starting with \($0)" } ?? "Starting with the basics" }
    public let buildingBoard = "A first board, ready to write on"

    public var planTitle: String {
        kid ? "Your plan is ready." : name.map { "\(Self.possessive($0)) plan is ready." } ?? "The plan is ready."
    }
    public var planLede: String {
        kid ? "Built from your answers." : name.map { "Built from \(Self.possessive($0)) answers." } ?? "Built from your answers."
    }
    public let todayLabel = "Today’s practice"
    public let todayLine = "5 problems · About 10 minutes"
    public let startHere = "Start here"
    public let then = "Then"
    public let pathNext = "Next"
    public var firstBoard: String {
        kid ? "Your first board" : name.map { "\(Self.possessive($0)) first board" } ?? "The first board"
    }
    public let oneStar = "1 star"
    public func tried(solved: Bool) -> String { solved ? "Solved one already" : "Tried one already" }
    public var save: String {
        kid ? "Save my plan" : name.map { "Save \(Self.possessive($0)) plan" } ?? "Save the plan"
    }
    public let openPlan = "The tutor starts with a few problems to see where things are, then picks what comes next."

    // MARK: hand back, waiting

    public var handBackTitle: String { kid ? "Hand the iPad to a grown-up." : "Hand it back to your grown-up." }
    public let handBackLede = "They save your plan. It takes a minute."
    public let imGrownUp = "I’m a grown-up"
    public let noGrownUp = "No grown-up right now"
    public var waitingTitle: String { name.map { "\(Self.possessive($0)) plan is waiting." } ?? "Your plan is waiting." }
    public var waitingLede: String {
        name.map { "A grown-up saves it. Then \(Self.possessive($0)) board opens." } ?? "A grown-up saves it. Then your board opens."
    }
    public let tryAnother = "Try another problem"

    // MARK: the grown-up's part

    public let gateHeader = "Grown-ups only"
    public let gateQuestion = "What year were you born?"
    public let gateMiss = "This part is for grown-ups."
    public let gatePaused = "Try again in a minute."

    public var accountTitle: String { name.map { "Save \(Self.possessive($0)) plan." } ?? "Save the plan." }
    public var accountLede: String {
        "Make your grown-up account. \(name ?? "Your kid") gets a profile next."
    }
    public let email = "Email"
    public let password = "Password"
    public let consent = "I agree to the Terms and Privacy Policy. I’m 13 or older, or I’m a parent or guardian setting this up for my child."
    public let terms = "Terms"
    public let privacy = "Privacy Policy"
    public let heardFromPrompt = "How did you hear about Agathon?"
    public var accountSave: String { name.map { "Save \(Self.possessive($0)) plan" } ?? "Save the plan" }
    public let haveAccount = "I have an account. Sign in"
    public let emailTaken = "That email has an account already."
    public let signInInstead = "Sign in instead"
    public let offline = "Check your connection and try again."
    public let confirmEmail = "Check your email to confirm the account, then sign in here."

    public func trialTitle(days: Int) -> String { "Try Agathon free for \(days) days." }
    public var trialLede: String { "Everything \(name ?? "your kid") just did, every day." }
    public var trialRows: [(icon: String, text: String)] {
        let n = name
        return [
            ("check", "The tutor checks every line \(n ?? "they") write\(n == nil ? "" : "s")."),
            ("hand", "Help me gives the next step, not the answer."),
            ("path", "Practice that follows \(n.map(Self.possessive) ?? "their") path, with stars and a sticker book."),
            ("chart", "A report for you every week."),
            ("person", "Up to 6 kids on one plan."),
        ]
    }
    public var trialToday: (String, String) { ("Today", "\(name ?? "Your kid") starts") }
    public func trialReminder(day: Int) -> (String, String) { ("Day \(day)", "We remind you") }
    public func trialEnd(day: Int) -> (String, String) { ("Day \(day)", "Your plan starts. Cancel before then and you pay nothing.") }
    public let planStarts = "Your plan starts"
    public let cancelBefore = "Cancel before then and you pay nothing."
    public func remindMe(daysBefore: Int) -> String { "Remind me \(daysBefore) days before it ends" }
    public func trialPrice(days: Int, price: String) -> String {
        "Free for \(days) days, then \(price) a month. It renews until you cancel in Settings."
    }
    public func subscribePrice(_ price: String) -> String { "\(price) a month. It renews until you cancel in Settings." }
    public let startTrial = "Start free trial"
    public func subscribe(_ price: String) -> String { "Subscribe for \(price) a month" }
    public let notNow = "Not now"
    public let restore = "Restore purchase"
    public var pending: String { "Waiting for approval. \(name ?? "Your kid") can start now." }
    public let storeError = "Couldn’t reach the App Store. Try again."
    public let restoreNothing = "No purchase to restore on this Apple ID."

    public let pinTitle = "Pick a 4-digit PIN."
    public var pinLede: String {
        "\(name ?? "Your kid") switches profiles with a tap. Getting back to yours takes this PIN."
    }
    public let pinAgain = "Once more to be sure."
    public let pinMismatch = "Those didn’t match. Try again."

    public var handOverTitle: String { "All set. Hand it back to \(them)." }

    public var pictureTitle: String { name.map { "Pick your picture, \($0)." } ?? "Pick your picture." }
    public let pictureLede = "It goes on your profile and your boards."
    public let thatsMe = "That’s me"
    public var making: String {
        guard !kid, let name else { return "Making your board…" }
        return "Making \(Self.possessive(name)) board…"
    }

    public var welcome: String { name.map { "Your board, \($0). Write under each problem." } ?? "Your board. Write under each problem." }
    public let letsGo = "Let’s go"

    public let welcomeBack = "Welcome back."
    public let welcomeBackLede = "Sign in to your grown-up account."
    public let forgotPassword = "Forgot password?"
    public let resetSent = "Check your email for a link to reset it."
    public let signIn = "Sign in"
    public var addTitle: String { name.map { "Add \($0) to your family?" } ?? "Add this plan to your family?" }
    public var addLede: String {
        name.map { "\(Self.possessive($0)) plan is on this iPad. Save it as \($0)’s own profile." }
            ?? "A plan is waiting on this iPad. Save it as a kid’s own profile."
    }
    public var addYes: String { name.map { "Add \($0)" } ?? "Add a kid" }

    // MARK: the bar

    public let back = "Back"
    public let skip = "Skip"
    public let continueTitle = "Continue"
    public let readAloud = "Read it out"
    public func step(_ at: Int, of count: Int) -> String { "Step \(at + 1) of \(count)" }
}
