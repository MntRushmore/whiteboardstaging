import Foundation

/// Every word the Live layer shows a kid, in one place so the voice stays one voice: a quiet lab
/// partner, short and kind, US English, full stops, never the word "wrong", never a price. (The
/// web's src/components/live/copy.ts, kidmode/kidStatusView.ts and learning/nowYouTry.ts, in the
/// Blocks voice: "like a coach", few exclamation marks.)
public enum LiveCopy {
    public enum Help {
        public static let helpMe = "Help me"
        public static let chooseTitle = "How much help?"
        public static let chooseLabel = "Choose how much help you get"
        public static let hint = "Hint"
        public static let hintLine = "Ticks, and a hint when you ask"
        public static let step = "Next step"
        public static let stepLine = "The next step when you're stuck"
        public static let solve = "Solve it"
        public static let solveLine = "Works out the rest of the problem"
        /// Help me with nothing written yet, or every problem here answered
        public static let nothingYet = "Write a step first, then tap Help me."
        /// Solve on a line already as simple as it goes
        public static let simplest = "That's as simple as it gets. Add = something to solve."
        /// Solve could not make anything of it
        public static let solveFailed = "Couldn't solve this one. Try writing it a bit clearer."
    }

    public enum Status {
        public static let reading = "Reading…"
        public static let checking = "Checking…"
        public static let solving = "Solving…"
        public static let offline = "Offline"
        public static func offlineWaiting(_ n: Int) -> String { n == 1 ? "Offline · 1 line waiting" : "Offline · \(n) lines waiting" }
        public static let paused = "Paused"
        public static let trouble = "Oops. Let's try that again."
        public static let retry = "Try again"
        public static let pause = "Let's take a little break."
        public static func tryAgainIn(_ seconds: Int) -> String { "Try again in \(seconds)" }
        public static let later = "Lots of help today. Try again later."
        public static let signIn = "Ask a grown-up to sign in again."
        public static let ok = "OK"
    }

    public enum OutOfInk {
        public static let title = "Help is paused for now."
        public static let message = "Ask a grown-up to switch it back on."
        public static let grownUp = "For grown-ups"
        public static let pill = "Help is paused"
    }

    public enum Hint {
        public static let gotIt = "Got it"
        public static let moreHelp = "More help"
        public static let readAloud = "Read it out"
        public static func level(_ n: Int) -> String { n <= 1 ? "Hint" : n == 2 ? "Closer look" : "One step" }
        /// the engine's own words when the model has none: where, never what
        public static let lookAgain = "Look again at this step."
        public static let unread = "I couldn't read this line. Try writing it a bit bigger."

        /// A hint points with the ink, never by counting: the card sits beside the line, and a kid
        /// does not number their lines (the kid sessions, 2026-10-22: "…the right side of line 4", where
        /// line 4 counted the tutor's problem). "line 4" → "this line", "lines 2 and 3" → "these lines",
        /// "step 3" → "this step"; the web's `pointWithInk` (src/lib/server/live-rules.ts) does the same.
        public static func pointing(_ text: String) -> String {
            var s = text
            let rules: [(String, String)] = [
                (#"\b([Ll])ines\s+\d+(?:\s*(?:,|and|&|-|–|to)\s*\d+)+\b"#, "these lines"),
                (#"\b([Ss])teps\s+\d+(?:\s*(?:,|and|&|-|–|to)\s*\d+)+\b"#, "these steps"),
                (#"\b([Ll])ine\s*(?:#|no\.?\s*)?\d+\b"#, "this line"),
                (#"\b([Ss])tep\s*(?:#|no\.?\s*)?\d+\b"#, "this step"),
                (#"(?i)\b(?:the\s+)?(?:first|second|third|fourth|fifth|sixth|last)\s+line\b"#, "this line"),
            ]
            for (pattern, words) in rules {
                guard let re = try? NSRegularExpression(pattern: pattern) else { continue }
                let ns = s as NSString
                var out = ""
                var last = 0
                for m in re.matches(in: s, range: NSRange(location: 0, length: ns.length)) {
                    out += ns.substring(with: NSRange(location: last, length: m.range.location - last))
                    // a sentence's first word keeps its capital
                    let before = out.trimmingCharacters(in: .whitespaces)
                    let starts = before.isEmpty || before.hasSuffix(".") || before.hasSuffix("?") || before.hasSuffix(":")
                    out += starts ? words.prefix(1).uppercased() + words.dropFirst() : words
                    last = m.range.location + m.range.length
                }
                out += ns.substring(from: last)
                s = out
            }
            return s
        }
    }

    public enum Cheers {
        public static let wins = ["Nice.", "You got it.", "Nailed it.", "Great step.", "Spot on.", "That's it.", "Smart move.", "Brilliant."]
        public static let misses = ["Almost. Look again.", "So close. Try that step again.", "Look again. You've got this."]
        public static let solved = "You solved it."
        public static func streak(_ n: Int) -> String { "\(n) in a row" }
        /// from this many ticks in a row the cheer counts them
        public static let streakFrom = 3
        /// streaks with the big burst
        public static let milestones: Set<Int> = [5, 10, 15, 20, 25, 50]
    }

    public enum NowYouTry {
        public static let go = "Now you try one"
        public static let goLabel = "Now you try one: the tutor writes a new problem like this one"
        public static let notNow = "Not now"
        public static let title = "Want to try one like it?"
        public static let failed = "Couldn't write a new problem just now."
    }

    public enum Graph {
        public static let graphIt = "Graph it"
        public static func label(_ line: String) -> String { "Graph \(line)" }
        public static let noRoom = "No room for a graph here. Try a new screen."
    }

    /// Problem pages and checking when done (docs/PROBLEM-PAGES.md).
    public enum Pages {
        public static let check = "Check"
        public static let checkLabel = "Check my work"
        /// Check with nothing written yet
        public static let nothingToCheck = "Write your work first, then tap Check."
        /// a check that found every step right, the problem not finished yet
        public static let keepGoing = "Looks right so far. Keep going."
        /// …on a page with an answer spot
        public static let keepGoingAnswer = "Looks right so far. Write your answer in the box."
        /// one root of two (a partial answer)
        public static let oneAnswer = "That's one answer. Is there another one?"
        /// Check offline, lines waiting to be read
        public static let checkOffline = "I'll check when the Wi-Fi is back."
        public static let next = "Next problem"
        public static let allDone = "All done"
        public static let nextLabel = "Go to the next problem"
        public static let newPage = "New page for this one"
        public static let newPageLabel = "Move this problem to a new page"
        public static let keepHere = "Keep it here"
        public static let allDoneTitle = "All done."
        public static func allDoneLine(_ count: Int, alone: Int) -> String {
            let problems = count == 1 ? "1 problem" : "\(count) problems"
            if alone == count { return "\(problems). All on your own." }
            if alone == 0 { return "\(problems). You worked them all out." }
            return "\(problems). \(alone) on your own."
        }
        public static let notYet = "Not yet"
        public static let backToBoards = "Back to my boards"
        public static let moreLikeThese = "More like these"
        /// what "More like these" asks Ask for (it writes them on pages of their own)
        public static let moreLikeTheseAsk = "Give me 3 more problems like these."
        public static func stickerLabel(_ n: Int, _ outcome: String) -> String { "Problem \(n): \(outcome)" }
        public static let onYourOwn = "done on your own"
        public static let withAHint = "done with a hint"
        public static let withHelp = "worked out together"
    }

    /// "I read" and "Fix what I read" (docs/PROBLEM-PAGES.md, "Trust in reading").
    public enum Reading {
        public static let iRead = "I read"
        public static let tapToFix = "Tap to fix"
        public static let isThisRight = "Is this right?"
        public static let yesRight = "Yes, that's right"
        /// a check found a slip on a line the tutor is not sure it read right
        public static let didIReadThis = "Did I read this right? Tap what I read to check."
        public static let fixed = "Fixed"
        public static let unread = "I couldn't read this"
        public static func spoken(_ plain: String) -> String { "I read \(plain). Tap to fix it." }
        public static func asking(_ plain: String) -> String { "I read \(plain). Is this right? Tap to check." }
        public static let sheetTitle = "Fix what I read"
        public static let didYouMean = "Did you mean"
        public static let typeIt = "Or type it"
        public static let use = "Use this"
        public static let cancel = "Cancel"
        public static let clear = "Clear"
        public static let delete = "Delete"
    }

    public enum GrownUps {
        public static let button = "For grown-ups"
        public static let title = "For grown-ups"
        public static let help = "How much help"
        public static let off = "Off"
        public static let auto = "Auto"
        public static let autoOn = "Checks and helps when they stop writing"
        public static let autoOff = "Waits until they tap Help me"
        public static let handwriting = "Tutor writes by hand"
        public static let celebrations = "Celebrations"
        public static let live = "Check work as it's written"
        public static let answerOnEquals = "Show the answer when I write ="
        public static let answerOnEqualsDetail = "For checking homework. Leave it off while they practise."
        public static let clearMarks = "Clear the tutor's marks"
        public static let checking = "Check the work"
        public static let whenDone = "When they're done"
        public static let asTheyGo = "As they go"
        public static let whenDoneDetail = "Quiet while they work. Checks when they write the answer, tap Check, or stop for a bit."
        public static let asTheyGoDetail = "Ticks and rings each line as soon as it's read."
        public static let showReadings = "Show what the tutor read"
        public static let showReadingsDetail = "\"I read\" beside each line. Tap one to fix it."
    }
}
