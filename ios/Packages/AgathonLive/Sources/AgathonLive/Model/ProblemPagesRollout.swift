import Foundation

/// What of problem pages is on (docs/PROBLEM-PAGES.md). The pages shipped first (the owner on the iPad,
/// 2026-10-19: "we need 1 question per screen or some way to not leak one handwriting into another"):
/// every problem the tutor gives on its own page, "Problem 2 of 5", Next, All done, and the tutor judging
/// a page's ink against that page's problem only. The second part is on as well (the owner's calls):
/// check when done by default (the grown-ups can switch a board back to "As they go"), the answer spot,
/// "I read" and tap to fix, the page's judging rules (a true step, one answer of several, the kid's own
/// problem) and "New page for this one".
public enum ProblemPagesRollout {
    /// the second part: the defaults are check when done and "I read", the page's judging rules apply,
    /// the answer spot is drawn, the offer is made, the grown-ups see the switches.
    /// (Debug: `-pagesFirstPartOnly` turns it off for a run, to see the pages as they first shipped.)
    public static let secondPart: Bool = {
        #if DEBUG
        return !ProcessInfo.processInfo.arguments.contains("-pagesFirstPartOnly")
        #else
        return true
        #endif
    }()
}
