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
        public static let clearMarks = "Clear the tutor's marks"
    }
}
