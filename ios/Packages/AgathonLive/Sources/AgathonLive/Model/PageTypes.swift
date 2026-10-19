import AgathonBrain
import Foundation

/// What the board shows for problem pages and "I read" (docs/PROBLEM-PAGES.md): the loop publishes
/// these, the overlay draws them. Page units unless said.

/// A line's "I read" chip: what the tutor read, where the chip goes, and whether to trust it
/// (docs/PROBLEM-PAGES.md, "Trust in reading": it always shows, quietly; it asks only with a reason).
public struct LineReading: Identifiable, Equatable, Sendable {
    public enum State: String, Sendable {
        /// read, and no reason to doubt it
        case read
        /// read, with a reason to ask (the readers disagree, Mathpix's confidence under 0.99, a
        /// look-alike of one of the page's letters): "Is this right?" — never ringed until trusted
        case asking
        /// the kid's (or a grown-up's) own reading
        case fixed
        /// nothing could be read: "I couldn't read this"
        case unread
    }

    /// the line's id
    public let id: String
    public let latex: String
    public let state: State
    /// the line's ink
    public let anchor: BrainRect
    /// the chip's left edge and middle (page units): in a problem page's margin lane, else after the
    /// line's mark
    public let at: AgathonBrain.Point

    public init(id: String, latex: String, state: State, anchor: BrainRect, at: AgathonBrain.Point) {
        self.id = id
        self.latex = latex
        self.state = state
        self.anchor = anchor
        self.at = at
    }
}

/// "Fix what I read" open on a line: its reading, and the readings it may have been (best first,
/// each one the engine reads as maths).
public struct ReadingFix: Identifiable, Equatable, Sendable {
    public let id: String
    public let latex: String
    public var alternatives: [String]
    /// nothing was read: no "Yes, that's right"
    public var unread: Bool

    public init(id: String, latex: String, alternatives: [String] = [], unread: Bool = false) {
        self.id = id
        self.latex = latex
        self.alternatives = alternatives
        self.unread = unread
    }
}

/// "New page for this one": a second problem started on a page, offered its own page.
public struct NewPageOffer: Identifiable, Equatable, Sendable {
    /// the new problem's first line
    public let id: String
    /// the lines that would move (the head first)
    public let lines: [String]
    /// under the head line (page units)
    public let anchor: BrainRect

    public init(id: String, lines: [String], anchor: BrainRect) {
        self.id = id
        self.lines = lines
        self.anchor = anchor
    }
}

/// The page's own controls in its action corner (view space, at the page's bottom right).
public enum PageAction: Equatable, Sendable {
    /// the kid's work is not checked yet
    case check
    /// the page's problem is solved: the next one ("Next problem"), or the set's end ("All done")
    case next(last: Bool)
}

/// One problem of a set as the All done page shows it.
public struct SetProblem: Identifiable, Equatable, Sendable {
    public enum Outcome: String, Sendable {
        /// first try or self corrected: a star
        case alone
        /// with a hint (the tutor helped, the kid finished): a ring
        case withHelp
        /// the tutor worked it out
        case together
        /// not finished
        case notYet
    }

    /// its page
    public let id: String
    /// 1-based, in the set
    public let number: Int
    public let outcome: Outcome

    public init(id: String, number: Int, outcome: Outcome) {
        self.id = id
        self.number = number
        self.outcome = outcome
    }
}
