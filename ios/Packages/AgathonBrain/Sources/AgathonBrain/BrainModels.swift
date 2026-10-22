import Foundation

// The brain's records as Swift sees them: the TypeScript types in src/lib/live/contracts.ts,
// src/lib/brain/index.ts and src/lib/hand, field for field. Records the board hands back to the
// brain later (a line's analysis as the next line's context, the last flush's lines) keep every
// field, so nothing is lost on the way round. Larger records the app does not read yet (the
// Progress summary, a graph's intent) are `JSONValue` until a screen needs them typed.

// MARK: - geometry and ink

public struct Rect: Codable, Hashable, Sendable {
    public var x: Double
    public var y: Double
    public var w: Double
    public var h: Double
    public init(x: Double, y: Double, w: Double, h: Double) {
        self.x = x
        self.y = y
        self.w = w
        self.h = h
    }
}

public struct Point: Codable, Hashable, Sendable {
    public var x: Double
    public var y: Double
    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

/// One pen-down of the student's ink, page coordinates. `bounds` defaults to the points' box.
public struct BrainStroke: Codable, Hashable, Sendable {
    public var id: String
    public var x: [Double]
    public var y: [Double]
    /// pressure 0...1, carried for the board; the logic does not use it
    public var p: [Double]?
    public var bounds: Rect?
    public init(id: String, x: [Double], y: [Double], p: [Double]? = nil, bounds: Rect? = nil) {
        self.id = id
        self.x = x
        self.y = y
        self.p = p
        self.bounds = bounds
    }
}

/// A line of handwriting: its strokes, box, column and row. `hash` is the recognition cache key.
public struct InkLine: Codable, Hashable, Sendable {
    public var id: String
    public var strokeIds: [String]
    public var bounds: Rect
    public var column: Int
    public var row: Int
    public var hash: String
}

public struct Diagram: Codable, Hashable, Sendable {
    public var id: String
    public var strokeIds: [String]
    public var labels: [[String]]
    public var bounds: Rect
    public var kinds: [String]
}

public struct StrokeVerdict: Codable, Hashable, Sendable {
    /// writing, drawing, mark, label, table, operation, stack, carry
    public var role: String
    public var reason: String
    public var diagram: Int?
}

public struct DivisionBar: Codable, Hashable, Sendable {
    public var bar: String
    public var divisor: [String]
}

/// One of the chat's problems on the screen (`ProblemCell` in src/lib/live/chat/cells.ts): its lines,
/// where its ink is (`head`) and its grid cell — on a problem page, the whole page.
public struct ProblemCell: Codable, Hashable, Sendable {
    public var key: String
    public var n: Int
    public var lines: [String]
    public var head: Rect
    public var cell: Rect
    public init(key: String, n: Int = 1, lines: [String], head: Rect, cell: Rect) {
        self.key = key
        self.n = n
        self.lines = lines
        self.head = head
        self.cell = cell
    }
}

public struct ClusterRequest: Codable, Sendable {
    public var strokes: [BrainStroke]
    public var previousLines: [InkLine]?
    public var previousDiagrams: [Diagram]?
    public var zoom: Double?
    public var equations: [Rect]?
    public var split: Bool?
    public var idSeed: Int?
    /// the chat's problems on the screen: given (even empty), the flush is the board's — a cell's work
    /// one problem gap or no gap, ink under two problems never one line, strays no line (`strays.ts`)
    public var cells: [ProblemCell]?
    /// lines that were one problem at the last flush, each group's ids
    public var mates: [[String]]?
    public init(strokes: [BrainStroke], previousLines: [InkLine]? = nil, previousDiagrams: [Diagram]? = nil, zoom: Double? = nil, equations: [Rect]? = nil, split: Bool? = nil, idSeed: Int? = nil,
                cells: [ProblemCell]? = nil, mates: [[String]]? = nil) {
        self.strokes = strokes
        self.previousLines = previousLines
        self.previousDiagrams = previousDiagrams
        self.zoom = zoom
        self.equations = equations
        self.split = split
        self.idSeed = idSeed
        self.cells = cells
        self.mates = mates
    }
}

public struct ClusterResult: Codable, Sendable {
    public var lines: [InkLine]
    public var diagrams: [Diagram]
    public var bars: [DivisionBar]
    /// stacked sums (`StackedSum` in src/lib/live/stackedSums.ts)
    public var stacks: [JSONValue]
    public var glyph: Double
    public var roles: [String: StrokeVerdict]
}

public struct RecognizerPayload: Codable, Hashable, Sendable {
    public struct Strokes: Codable, Hashable, Sendable {
        public var x: [[Double]]
        public var y: [[Double]]
    }
    public struct Size: Codable, Hashable, Sendable {
        public var w: Double
        public var h: Double
    }
    /// `/api/live/recognize`'s `strokes` and `bounds`
    public var strokes: Strokes
    public var bounds: Size
    /// sha-1 hex of the payload: the same cache key as the web board's
    public var hash: String
    public var points: Int
}

// MARK: - the engine

public enum HelpMode: String, Codable, Sendable, CaseIterable {
    case off, feedback, suggest, answer
}

public struct LineDomain: Codable, Hashable, Sendable {
    public var variable: String
    public var lo: Double
    public var hi: Double
    public var loIn: Bool
    public var hiIn: Bool
    /// deg, rad or plain
    public var unit: String
    public var latex: String
    public var solutions: [Double]?
}

/// What the engine makes of one line (`LineAnalysis` in src/lib/live/contracts.ts).
/// A stacked sum's line (`stackedLine`): its analysis, and where its tick and ring go (nil: round the
/// line, as any line's).
public struct StackedLine: Codable, Hashable, Sendable {
    public var stacked: Bool
    public var analysis: LineAnalysis?
    public var tick: Rect?
    public var ring: Rect?
}

public struct LineAnalysis: Codable, Hashable, Sendable {
    public struct Plot: Codable, Hashable, Sendable { public var expr: String; public var latex: String }
    public struct Chem: Codable, Hashable, Sendable { public var balanced: Bool; public var balancedLatex: String }
    public struct Units: Codable, Hashable, Sendable { public var ok: Bool }
    public struct Operation: Codable, Hashable, Sendable {
        public var op: String
        public var operand: String
        public var operandMath: String
        public var result: String
    }
    public struct Branch: Codable, Hashable, Sendable {
        public var of: String
        public var variable: String
        public var covers: [Double]
    }

    /// expression, equation, assignment, function, inequality, chem, point, label, incomplete, text, unknown, operation
    public var kind: String
    public var math: String
    public var resultLatex: String
    /// ok, mismatch, unknown, none
    public var verdict: String
    public var note: String
    public var variable: String?
    public var solutions: [String]?
    public var plot: Plot?
    public var chem: Chem?
    public var units: Units?
    public var solved: Bool?
    public var error: String?
    public var derived: Bool?
    public var operation: Operation?
    public var carried: Bool?
    public var bareAnswer: Bool?
    public var domain: LineDomain?
    public var substituted: String?
    public var nextStep: String?
    public var branch: Branch?
    /// a slip in arithmetic that looks more like a misread (a letter in the answer, a digit dropped): asked about, never ringed
    public var misreadLikely: Bool?
}

/// The column around a line (`AnalyzeContext`): the line above it, the column's first relation.
public struct AnalyzeContext: Codable, Hashable, Sendable {
    public var mode: HelpMode
    public var previous: LineAnalysis?
    public var original: LineAnalysis?
    public var givens: [String: String]?
    public var beside: [LineAnalysis]?
    public init(mode: HelpMode = .feedback, previous: LineAnalysis? = nil, original: LineAnalysis? = nil, givens: [String: String]? = nil, beside: [LineAnalysis]? = nil) {
        self.mode = mode
        self.previous = previous
        self.original = original
        self.givens = givens
        self.beside = beside
    }
}

public struct LocalSolveResult: Codable, Hashable, Sendable {
    /// solveLatex, solveFromLines, simplifySteps, localAnswer; nil: the board would ask the model
    public var source: String?
    public var steps: [String]
    public var answer: String?
    public var line: Int?
}

public struct LocalSolveOptions: Codable, Hashable, Sendable {
    public var targetIndex: Int?
    public var handwriting: Bool?
    public var mode: HelpMode?
    /// never, when-column-uses-i, always
    public var complexRoots: String?
    public var domain: String?
    public init(targetIndex: Int? = nil, handwriting: Bool? = nil, mode: HelpMode? = nil, complexRoots: String? = nil, domain: String? = nil) {
        self.targetIndex = targetIndex
        self.handwriting = handwriting
        self.mode = mode
        self.complexRoots = complexRoots
        self.domain = domain
    }
}

public enum ExpectedVerdict: String, Codable, Sendable {
    case equal, unequal, unknown
}

// MARK: - the hand

public struct InkPoint: Codable, Hashable, Sendable {
    public var x: Double
    public var y: Double
    /// pen pressure hint
    public var z: Double
}

/// One stroke of the tutor's hand: kind glyph, rule, radical, delimiter or box.
public struct HandStroke: Codable, Hashable, Sendable {
    public var points: [InkPoint]
    public var order: Int
    public var kind: String
    public var weight: Double?
}

public struct HandLinePlan: Codable, Hashable, Sendable {
    public struct Style: Codable, Hashable, Sendable {
        public var color: String?
        public var fill: String?
        public var closed: Bool?
    }
    public var latex: String
    public var x: Double
    public var y: Double
    public var strokes: [HandStroke]
    public var baseline: Double
    public var startMs: Double
    public var durationMs: Double
    public var style: Style?
    public var part: String?
}

/// The tutor's writing, laid out and timed (`HandPlan` in src/lib/live/handwriting.ts).
public struct HandPlan: Codable, Hashable, Sendable {
    public var lines: [HandLinePlan]
    public var bounds: Rect
    public var size: Double
    /// at a natural writing pace; wall time is totalMs / pace
    public var totalMs: Double
    public var pace: Double?
}

public struct HandwritingRequest: Codable, Hashable, Sendable {
    public struct Baseline: Codable, Hashable, Sendable {
        public var x: Double
        public var baselineY: Double
        public init(x: Double, baselineY: Double) {
            self.x = x
            self.baselineY = baselineY
        }
    }
    public var steps: [String]
    public var size: Double?
    public var lineHeight: Double?
    public var inline: Bool?
    public var zoom: Double?
    public var seed: Int?
    public var seedKey: String?
    public var origin: Point?
    public var baseline: Baseline?
    public init(steps: [String], size: Double? = nil, lineHeight: Double? = nil, inline: Bool? = nil, zoom: Double? = nil, seed: Int? = nil, seedKey: String? = nil, origin: Point? = nil, baseline: Baseline? = nil) {
        self.steps = steps
        self.size = size
        self.lineHeight = lineHeight
        self.inline = inline
        self.zoom = zoom
        self.seed = seed
        self.seedKey = seedKey
        self.origin = origin
        self.baseline = baseline
    }
}

/// Sentences in the tutor's hand (`layoutWords`): each wrapped at `maxWidth`, under the one before.
public struct WordsRequest: Codable, Hashable, Sendable {
    public var sentences: [String]
    public var maxWidth: Double
    public var size: Double
    public var seedKey: String?
    public var origin: Point?
    public init(sentences: [String], maxWidth: Double, size: Double, seedKey: String? = nil, origin: Point? = nil) {
        self.sentences = sentences
        self.maxWidth = maxWidth
        self.size = size
        self.seedKey = seedKey
        self.origin = origin
    }
}

public struct WordsResult: Codable, Hashable, Sendable {
    /// nil when nothing could be drawn
    public var plan: HandPlan?
    public var size: Double
    public var seed: Int
}

public struct HandwritingResult: Codable, Hashable, Sendable {
    /// nil when nothing can be drawn
    public var plan: HandPlan?
    /// non-empty: do not draw, show the typeset maths
    public var unsupported: [String]
    public var size: Double
    public var seed: Int
}

public enum MarkKind: String, Codable, Sendable, CaseIterable {
    case check, circle, question
}

public struct MarkResult: Codable, Hashable, Sendable {
    public struct Anchor: Codable, Hashable, Sendable { public var x: Double; public var y: Double; public var h: Double }
    public var strokes: [HandStroke]
    public var plan: HandPlan?
    /// a mark is redrawn only when its key changes
    public var key: String
    public var anchor: Anchor
    public var ring: Rect
}

// MARK: - the help policy

/// `PolicyInput` in src/lib/live/policy.ts.
public struct PolicyInput: Codable, Hashable, Sendable {
    public var mode: HelpMode
    public var analysis: LineAnalysis?
    public var confidence: Double
    public var settled: Bool
    public var auto: Bool
    public var userAsked: Bool
    public var hintsShownForLine: Int
    public var openHintCount: Int
    public var rewritesWithWarn: Int
    public var liveShapeCount: Int
    public var latex: String?
    public init(mode: HelpMode, analysis: LineAnalysis?, confidence: Double, settled: Bool, auto: Bool, userAsked: Bool, hintsShownForLine: Int = 0, openHintCount: Int = 0, rewritesWithWarn: Int = 0, liveShapeCount: Int = 0, latex: String? = nil) {
        self.mode = mode
        self.analysis = analysis
        self.confidence = confidence
        self.settled = settled
        self.auto = auto
        self.userAsked = userAsked
        self.hintsShownForLine = hintsShownForLine
        self.openHintCount = openHintCount
        self.rewritesWithWarn = rewritesWithWarn
        self.liveShapeCount = liveShapeCount
        self.latex = latex
    }
}

public struct PolicyDecision: Codable, Hashable, Sendable {
    public var echo: Bool
    /// none, pending, ok, warn, unknown, solved
    public var badge: String
    public var showResult: Bool
    public var runLlmCheck: Bool
    public var allowHint: Bool
    public var allowSteps: Bool
    public var revealChemBalance: Bool
    public var offerHintPrompt: Bool
    public var capped: Bool
}

// MARK: - learning, graphs, diagnostics

public struct WeakSpotPractice: Codable, Hashable, Sendable {
    public struct Skill: Codable, Hashable, Sendable { public var id: String; public var name: String }
    public var skill: Skill
    public var problems: [[String]]
}

public struct ProgressSummary: Codable, Hashable, Sendable {
    /// `LearningSummary` (src/lib/learning/contracts.ts)
    public var summary: JSONValue
    /// `LearnerHint`, the tutor's view of the student; nil with nothing to say
    public var hint: JSONValue?
}

public struct GraphSketch: Codable, Hashable, Sendable {
    /// `GraphIntent` without its samplers (src/lib/live/contracts.ts)
    public var intent: JSONValue
    public var plan: HandPlan?
    public var box: Rect?
    public var window: JSONValue?
}

public struct JITProbe: Codable, Hashable, Sendable {
    public var ms: Double
    public var sum: Int
}

public struct BrainVersion: Codable, Hashable, Sendable {
    public var api: Int
    public var mathjs: String
}

/// How long `load()` took, and what it loaded.
public struct BrainLoadReport: Codable, Hashable, Sendable {
    /// reading brain.js from the bundle
    public var readMs: Double
    /// evaluating it (parse + top-level code)
    public var evaluateMs: Double
    /// building the engine: mathjs `create(all)` (`init`)
    public var engineMs: Double
    public var bytes: Int
    public var api: Int
    public var mathjs: String
    public var totalMs: Double { readMs + evaluateMs + engineMs }
}
