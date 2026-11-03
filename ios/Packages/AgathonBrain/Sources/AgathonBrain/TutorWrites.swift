import Foundation

// "The tutor writes it out" (docs/TUTOR-WRITES.md): the next step of a kid's work, checked by the
// engine before it is offered (src/lib/live/tutorStep.ts), and the next column of a stacked sum
// placed in the tutor's hand (src/lib/live/stackStep.ts). No model: the brain's exact maths only.

/// The next step of the work under a problem (`tutorStep`).
public struct TutorStep: Codable, Hashable, Sendable {
    public enum Kind: String, Codable, Sendable {
        /// one step to write
        case step
        /// the final answer, asked for and allowed
        case answer
        /// the next step is the final answer, held back (`step` holds it: never written)
        case lastStep
        /// the work is finished
        case solved
        /// the engine could not vouch for any next step: write nothing, say so
        case unsure
        /// nothing to go on
        case nothing
        /// a line must be confirmed as read first ("I read: … Is that right?"): `readback` says which
        case readback
    }

    /// How far a line of the work is trusted as read (the messy-handwriting guard).
    public enum Trust: String, Codable, Sendable {
        /// read with no doubt
        case sure
        /// a low-confidence or "?" read, the second opinion disagreeing, a look-alike letter
        case unsure
        /// the kid said it is right, or typed it
        case confirmed
        /// the tutor's own step
        case tutor
    }

    public var kind: Kind
    /// LaTeX: a relation, or `= …` going on from an expression
    public var step: String
    /// written after the `=` that ends the line it follows, not under it
    public var inline: Bool
    /// index into problem + work of the line it follows (the last right line); -1 for none
    public var from: Int
    /// index into problem + work of a slip after `from` it stands in for; -1 for none
    public var slip: Int
    /// what it does, in a kid's words
    public var why: String
    /// the engine checked it
    public var checked: Bool
    /// `readback`: the index into problem + work of the line to read back
    public var readback: Int?

    /// A step to write now.
    public var writes: Bool { kind == .step || kind == .answer }
}

/// The next column of a stacked sum (`stackStep`).
public struct StackStep: Codable, Hashable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case step, answer, lastStep, fix, solved, hint, unsure, nothing, readback
    }

    public struct Part: Codable, Hashable, Sendable {
        /// `a2` (the answer's hundreds), `c3` (a carry over them), `f1` (a right digit under a wrong
        /// one), `r1` (long multiplication's second row), `rule`, `s0` (the rows' sum)
        public var part: String
        public var text: String
        /// in the tutor's hand, placed (page units)
        public var plan: HandPlan
    }

    public var kind: Kind
    public var parts: [Part]
    public var why: String
    /// the sum the parts belong to (`+ 286 680`)
    public var key: String
    /// the sum as read, in a kid's words (`286 + 680`): what a readback says
    public var reading: String?

    public var writes: Bool { !parts.isEmpty && (kind == .step || kind == .answer || kind == .fix) }
}

/// A step checked against the line it follows (`checkStep`).
public struct StepCheck: Codable, Hashable, Sendable {
    public var ok: Bool
    public var why: String
    /// the step is a solution (`x = 4`): the final answer
    public var solved: Bool
}

extension Brain {
    private struct TutorStepArgs: Encodable {
        var problem: [String]
        var work: [String]
        var answer: Bool
        var trust: [TutorStep.Trust]?
        var known: Bool
    }

    private struct CheckStepArgs: Encodable {
        var from: String
        var step: String
        var written: [String]
    }

    private struct StackStepArgs: Encodable {
        var latex: String
        var confidence: Double
        var stack: JSONValue
        var tutor: [String]
        var answer: Bool
        var inkBottom: Double?
        var zoom: Double?
        var lineId: String
        var trust: TutorStep.Trust?
        var problem: [String]
        var known: Bool
    }

    /// The next step of `work` under `problem`, checked by the engine; the final answer only with
    /// `answer` (asked for, and the grown-ups allow answers).
    /// `trust`: how far each line of `work` is trusted as read (nil: all `sure`); `known`: the problem
    /// is known though not in `problem` (a SAT question). A misread line is read back, never written from.
    public func tutorStep(problem: [String], work: [String], answer: Bool, trust: [TutorStep.Trust]? = nil, known: Bool = false) throws -> TutorStep {
        try call("tutorStep", TutorStepArgs(problem: problem, work: work, answer: answer, trust: trust, known: known))
    }

    /// Is `step` a right next step after `from` (and not one of `written`)? What a model's step must pass.
    public func checkStep(from: String, step: String, written: [String] = []) throws -> StepCheck {
        try call("checkStep", CheckStepArgs(from: from, step: step, written: written))
    }

    /// The next column of the stacked sum `stack` (one of `clusterStrokes`' `stacks`) read as `latex`,
    /// after the parts the tutor has written into it (`tutor`), placed in the tutor's hand.
    public func stackStep(latex: String, confidence: Double, stack: JSONValue, tutor: [String], answer: Bool,
                          inkBottom: Double?, zoom: Double?, lineId: String, trust: TutorStep.Trust? = nil,
                          problem: [String] = [], known: Bool = false) throws -> StackStep {
        try call("stackStep", StackStepArgs(latex: latex, confidence: confidence, stack: stack, tutor: tutor, answer: answer,
                                            inkBottom: inkBottom, zoom: zoom, lineId: lineId, trust: trust, problem: problem, known: known))
    }
}
