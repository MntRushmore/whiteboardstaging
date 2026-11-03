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

    /// A step to write now.
    public var writes: Bool { kind == .step || kind == .answer }
}

/// The next column of a stacked sum (`stackStep`).
public struct StackStep: Codable, Hashable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case step, answer, lastStep, fix, solved, hint, unsure, nothing
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
    }

    /// The next step of `work` under `problem`, checked by the engine; the final answer only with
    /// `answer` (asked for, and the grown-ups allow answers).
    public func tutorStep(problem: [String], work: [String], answer: Bool) throws -> TutorStep {
        try call("tutorStep", TutorStepArgs(problem: problem, work: work, answer: answer))
    }

    /// Is `step` a right next step after `from` (and not one of `written`)? What a model's step must pass.
    public func checkStep(from: String, step: String, written: [String] = []) throws -> StepCheck {
        try call("checkStep", CheckStepArgs(from: from, step: step, written: written))
    }

    /// The next column of the stacked sum `stack` (one of `clusterStrokes`' `stacks`) read as `latex`,
    /// after the parts the tutor has written into it (`tutor`), placed in the tutor's hand.
    public func stackStep(latex: String, confidence: Double, stack: JSONValue, tutor: [String], answer: Bool,
                          inkBottom: Double?, zoom: Double?, lineId: String) throws -> StackStep {
        try call("stackStep", StackStepArgs(latex: latex, confidence: confidence, stack: stack, tutor: tutor, answer: answer,
                                            inkBottom: inkBottom, zoom: zoom, lineId: lineId))
    }
}
