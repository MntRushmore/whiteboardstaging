import Foundation

/// SAT mode's words (docs/SAT-MODE.md). Grown-up Blocks: short, calm and test-like, for 15–18 year
/// olds. US English, full stops, no exclamation marks, never "wrong".
public enum SATCopy {
    public static let title = "SAT math practice"
    public static let homeCard = "SAT practice"
    public static let homeCardLine = "Real SAT-style math beside your board. Free."

    public static func questionOf(_ n: Int, _ count: Int) -> String { "Question \(n) of \(count)" }
    public static let mark = "Mark for review"
    public static let marked = "Marked for review"
    public static let check = "Check answer"
    public static let next = "Next"
    public static let previous = "Back"
    public static let results = "See results"
    public static let endSet = "End set"
    public static let seeSolution = "See the solution"
    public static let hideSolution = "Hide the solution"
    public static let right = "Right."
    public static let rightSecond = "Right, on the second try."
    public static let lookAgain = "Not quite. Look again: one more try."
    public static let missed = "Not this time."
    public static func answerWas(_ a: String) -> String { "The answer is \(a)." }
    public static let chooseFirst = "Choose an answer first."
    public static let strike = "Cross out"
    public static let restore = "Bring back"
    public static let gridInLabel = "Your answer"
    public static let gridInTap = "Tap to type your answer"
    public static let gridInRules = "Fractions or decimals. Up to 5 characters, 6 with a minus. No mixed numbers."
    public static let solution = "Solution"
    public static let desmos = "On the graphing calculator"
    public static let hidePanel = "Hide the question"
    public static let showPanel = "Show the question"

    // the free tutor (caps by tier, the owner 2026-10-22: no account 5, a free account 20, Unlimited
    // none; always the server's `cap`)
    public static func tutorReady(left: Int?, cap: Int) -> String {
        guard let left else { return "The tutor checks your work once you write on the board." }
        return "The tutor starts once you write on the board. \(left) of \(cap) free tutor questions left today."
    }
    public static func tutorOn(left: Int?, cap: Int) -> String {
        guard let left else { return "The tutor is on for this question." }
        return "The tutor is on for this question. \(left) of \(cap) free left today."
    }
    public static let tutorAsking = "Starting the tutor…"
    /// The cap line: without an account it points at a free account (20 a day); with one, at Unlimited.
    public static func capped(cap: Int, hasAccount: Bool) -> String {
        hasAccount
            ? "Free tutor used up for today: \(cap) of \(cap). Unlimited lifts it."
            : "Free tutor used up for today: \(cap) of \(cap). Make a free account for 20 a day."
    }
    public static func cappedAction(hasAccount: Bool) -> String { hasAccount ? "See Unlimited" : "Make a free account" }
    public static let boardStillWorks = "The board still works."
    public static let tutorUnavailable = "The tutor couldn't be reached. The board still works."
    public static let tryAgain = "Try again"

    // Graph an equation
    public static let graphTitle = "Graph an equation"
    public static let graphPlaceholder = "y = 2x + 1"
    public static let graphButton = "Graph"
    public static let graphNotAFunction = "That isn't a function of x I can graph. Try y = 2x + 1."
    public static let graphNoRoom = "No room left on this page for a graph."
    public static let graphDone = "Graphed on your board."

    // the end of a set
    public static let setDone = "Set complete"
    public static func score(_ right: Int, _ count: Int) -> String { "\(right)/\(count)" }
    public static let scoreLine = "right on the first try"
    public static func secondTries(_ n: Int) -> String { n == 1 ? "1 more right on the second try." : "\(n) more right on the second try." }
    public static let reviewMissed = "Review the missed ones"
    public static let practiceMore = "Practice 10 more"
    public static let backToSAT = "Back to SAT home"
    public static let resultRight = "Right"
    public static let resultRightSecond = "Right · 2nd try"
    public static let resultMissed = "Missed"
    public static let resultSkipped = "Skipped"
    public static func reviewing(_ n: Int, _ count: Int) -> String { "Reviewing \(n) of \(count)" }
    public static let endReview = "Done reviewing"

    // home
    public static let today = "Today"
    public static func answeredToday(_ n: Int) -> String { n == 1 ? "1 question answered" : "\(n) questions answered" }
    public static func tutorLeftToday(_ left: Int, _ cap: Int) -> String { "\(left) of \(cap) free tutor questions left" }
    public static let tutorUnlimited = "Unlimited tutor"
    public static let practice10 = "Practice 10"
    public static let practice10Line = "A mixed set that adapts to you."
    public static let pickSkill = "Pick a skill"
    public static let progress = "Your progress"
    public static func streak(_ days: Int) -> String { days == 1 ? "1 day in a row" : "\(days) days in a row" }
    public static let estimateTitle = "Rough estimate from practice"
    public static let estimateFallbackNote = "A rough estimate from practice questions, not an SAT score."
    public static func estimateLater(_ left: Int) -> String {
        left == 1 ? "Answer 1 more question to see a rough estimate." : "Answer \(left) more questions to see a rough estimate."
    }
    public static let noProgress = "Nothing answered yet. Your progress shows here as you practice."
    public static let loadFailed = "Couldn't load your SAT progress."
    public static let setFailed = "Couldn't get questions. Check the Wi-Fi, then try again."
    public static let noQuestions = "No questions for that yet. Try another skill."
    public static func correctOf(_ c: Int, _ a: Int) -> String { "\(c) of \(a)" }

    // v2: the question is the page (docs/SAT-V2.md, docs/sat2/DESIGN-NOTES.md)
    public static func questionShort(_ n: Int, _ count: Int) -> String { "Q\(n) of \(count)" }
    public static let reviewChip = "REVIEW"
    public static let helpMe = "Help me"
    public static let checkShort = "Check"
    public static let nextShort = "Next"
    public static func walkStep(_ k: Int, _ n: Int) -> String { "Step \(k) of \(n) · Tap to go on" }
    public static func walkDone(_ n: Int) -> String { "All \(n) steps · Tap to check" }
    public static let nudgeLabel = "NUDGE"
    public static let nudgeFooter = "Stuck still? Tap Help me again for one step."
    public static let stepFooter = "Still stuck? Help me walks you through it."
    public static let yourTurn = "Your turn: the next line."
    public static func youPicked(_ key: String) -> String { "YOU PICKED \(key)" }
    public static func youTyped(_ answer: String) -> String { "YOU TYPED \(answer)" }
    public static let notQuite = "Not quite."
    public static let walkMeThrough = "Walk me through it"
    public static func cappedLine(cap: Int) -> String { "Tutor checks used up today: \(cap) of \(cap). Help me still works." }
    public static let ladderTitle = "HELP ME, THREE TAPS"
    public static let ladderNudge = "Nudge"
    public static let ladderNudgeLine = "A question to get you going."
    public static let ladderStep = "One step"
    public static let ladderStepLine = "The next line of the solution."
    public static let ladderWalk = "Walk me through it"
    public static let ladderWalkLine = "The whole solution, step by step."
    public static let free = "Free"
    public static let fromSolutionToday = "From the solution today"
    public static let ladderFooter = "The board, Graph it and the answer check all still work."
    public static func isRight(_ a: String) -> String { "\(a) is right." }
    public static func answerIsShort(_ a: String) -> String { "The answer is \(a)." }
    public static let backToWork = "Back to my work"
    public static let nextQuestion = "Next question"
    public static let seeResults = "See results"
    public static let paperWay = "THE PAPER WAY"
    public static let desmosWay = "THE DESMOS WAY"
    public static let desmosWayLine = "the graphing calculator in the SAT app"
    public static let intoTheDeck = "Into the deck"
    public static let backInADay = "Back in 1 day"
    public static func comeBackTomorrow(_ n: Int) -> String { n == 1 ? "1 comes back tomorrow." : "\(n) come back tomorrow." }
    public static let deckRule = "Each missed question returns in 1 day, then in 3 days. Get it right on a review and it's cleared."
    public static let deckTitle = "YOUR MISTAKE DECK"
    public static func toReviewToday(_ n: Int) -> String { "\(n) to review today" }
    public static func reviewsThenNew(_ r: Int, _ count: Int) -> String {
        "\(r) review\(r == 1 ? "" : "s"), then \(max(0, count - r)) new picked for you."
    }
    public static func seeMissed(_ n: Int) -> String { "See the \(n) missed" }
    public static let graphField = "Graph an equation"
    public static let noMoreSteps = "That's the whole solution."
}
