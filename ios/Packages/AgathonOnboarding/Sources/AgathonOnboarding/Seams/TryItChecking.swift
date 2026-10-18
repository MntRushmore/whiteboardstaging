import AgathonBrain
import Foundation

/// What the tutor does with the kid's answer (the try contract's `TRY_VERDICTS`).
public enum TryVerdict: String, Codable, Sendable, CaseIterable {
    /// a right step (a tick)
    case check
    /// right, and the problem is done (a tick, then the star)
    case solved
    /// a slip (a ring and one hint)
    case ring
    /// the reader could not make it out ("Write it a little bigger.")
    case unread
    /// read, but nothing to check yet (half a step)
    case unjudged
}

/// The tutor's answer to one line.
public struct TryCheck: Sendable, Equatable {
    public var verdict: TryVerdict
    /// what the reader saw ("" when nothing)
    public var latex: String
    /// the engine's note on a ring, in words a kid can read
    public var note: String?

    public init(verdict: TryVerdict, latex: String, note: String? = nil) {
        self.verdict = verdict
        self.latex = latex
        self.note = note
    }
}

/// The kid's ink for one answer: strokes in page coordinates.
public struct TryInk: Sendable, Equatable {
    public struct Stroke: Sendable, Equatable {
        public var x: [Double]
        public var y: [Double]
        public init(x: [Double], y: [Double]) {
            self.x = x
            self.y = y
        }
    }
    public var strokes: [Stroke]
    public init(strokes: [Stroke]) { self.strokes = strokes }
}

/// Why a check could not happen. The flow never stops here: "The tutor can't check right now."
public enum TryCheckError: Error, Sendable, Equatable {
    case offline
    case rateLimited(retryAfterMs: Int?)
    case unavailable
    /// the app could not prove itself (App Attest) or the server refused the request
    case refused(String)
}

/// The seam for the tutor's read and verdict on the try (docs/ONBOARDING.md, `tryIt`).
///
/// Today: `PreAccountTryChecker`, the brain's recognizer payload sent to the pre-account route
/// (`POST /api/try/check`, App Attest) and judged on the server by the board's own engine. The lead
/// may swap in AgathonLive's loop once it lands; anything that answers these three works.
public protocol TryItChecking: Sendable {
    /// Reads the kid's strokes for `problem` (after `work`, the lines already checked) and judges them.
    func check(_ ink: TryInk, problem: OnboardingCatalog.Problem, work: [String]) async throws -> TryCheck
    /// "Type it instead" (VoiceOver, or no hand): the typed answer judged with no read.
    func checkTyped(_ answer: String, problem: OnboardingCatalog.Problem, work: [String]) async throws -> TryCheck
    /// "Help me": the next step after `work`, as LaTeX; nil when there is none.
    func help(problem: OnboardingCatalog.Problem, work: [String]) async throws -> String?
    /// Warm whatever the first check pays for (the brain, the attested key, the connection).
    func warmUp() async
}
