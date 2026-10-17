import Foundation

/// The board's TypeScript logic — the maths engine, stroke clustering, the recognizer payload, the
/// tutor's handwriting, marks, the help policy, practice and progress — running in JavaScriptCore.
///
/// `brain.js` is built from `src/lib/brain` by `npm run brain:build` and ships in this package.
/// An actor: it owns its own JavaScriptCore virtual machine, so calls are serialized and never run
/// on the main thread's behalf. Every call is synchronous inside the actor; the slow ones (a hard
/// Solve, a "Now you try" search) take tens to hundreds of milliseconds without a JIT, so keep them
/// off any per-frame path.
///
/// ```swift
/// let brain = Brain()
/// try await brain.load()
/// let analysis = try await brain.analyzeLine("2x + 3 = 11")
/// ```
public actor Brain {
    /// The API version these wrappers speak (`API_VERSION` in src/lib/brain/index.ts).
    public static let apiVersion = 0

    /// One brain for the app: the context costs a few megabytes and ~0.1–0.3 s to load.
    public static let shared = Brain()

    private var host: JSHost?
    private var report: BrainLoadReport?
    private let scriptURL: URL?

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.nonConformingFloatEncodingStrategy = .convertToString(positiveInfinity: "Infinity", negativeInfinity: "-Infinity", nan: "NaN")
        return e
    }()

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.nonConformingFloatDecodingStrategy = .convertFromString(positiveInfinity: "Infinity", negativeInfinity: "-Infinity", nan: "NaN")
        return d
    }()

    /// `scriptURL`: another build of `brain.js` (tests); default the one in this package.
    public init(scriptURL: URL? = nil) {
        self.scriptURL = scriptURL
    }

    /// The bundled `brain.js`.
    public static var bundledScriptURL: URL? {
        Bundle.module.url(forResource: "brain", withExtension: "js")
    }

    public var isLoaded: Bool { host != nil }

    /// Loads `brain.js` and builds the engine. Idempotent: a second call returns the first report.
    @discardableResult
    public func load() throws -> BrainLoadReport {
        if let report { return report }
        guard let url = scriptURL ?? Self.bundledScriptURL else { throw BrainError.scriptMissing }
        let t0 = DispatchTime.now()
        let script: String
        do {
            script = try String(contentsOf: url, encoding: .utf8)
        } catch {
            throw BrainError.loadFailed("cannot read \(url.lastPathComponent): \(error.localizedDescription)")
        }
        let t1 = DispatchTime.now()
        let host = try JSHost()
        try host.load(script: script, sourceURL: URL(fileURLWithPath: "/brain.js"))
        let t2 = DispatchTime.now()
        self.host = host
        let version: BrainVersion = try call("version", Empty())
        guard version.api == Self.apiVersion else {
            self.host = nil
            throw BrainError.apiMismatch(expected: Self.apiVersion, found: version.api)
        }
        let t3 = DispatchTime.now()
        let _: InitResult = try call("init", Empty())
        let t4 = DispatchTime.now()
        let report = BrainLoadReport(
            readMs: Self.ms(t0, t1),
            evaluateMs: Self.ms(t1, t2),
            engineMs: Self.ms(t3, t4),
            bytes: script.utf8.count,
            api: version.api,
            mathjs: version.mathjs
        )
        self.report = report
        return report
    }

    // MARK: - the boundary

    /// The raw call: `args` as JSON in, the result as JSON out (`AgathonBrain.call` in
    /// src/lib/brain/index.ts). The typed methods below are built on it.
    public func callJSON(_ method: String, args: String = "{}") throws -> String {
        let envelope = try envelopeJSON(method, args: args)
        return try Self.unwrap(method, envelope: envelope)
    }

    /// The envelope exactly as `brain.js` returned it (parity tests compare it byte for byte).
    public func envelopeJSON(_ method: String, args: String = "{}") throws -> String {
        guard let host else { throw BrainError.notLoaded }
        return try host.call(method, argsJSON: args)
    }

    /// Typed call: `args` encoded to JSON, the result decoded.
    public func call<Args: Encodable, Result: Decodable>(_ method: String, _ args: Args, as: Result.Type = Result.self) throws -> Result {
        let json: String
        do {
            json = String(decoding: try Self.encoder.encode(args), as: UTF8.self)
        } catch {
            throw BrainError.encoding(method: method, message: String(describing: error))
        }
        let result = try callJSON(method, args: json)
        do {
            return try Self.decoder.decode(Result.self, from: Data(result.utf8))
        } catch {
            throw BrainError.decoding(method: method, message: String(describing: error))
        }
    }

    // MARK: - the engine

    /// One line against its column (`engine.analyzeLine`): kind, verdict, result, note.
    public func analyzeLine(_ latex: String, context: AnalyzeContext = AnalyzeContext()) throws -> LineAnalysis {
        try call("analyzeLine", AnalyzeLineArgs(latex: latex, context: context))
    }

    /// Every line of a column analysed as the board holds them (each against the lines above it).
    public func analyzeColumn(_ lines: [String], mode: HelpMode = .answer) throws -> [LineAnalysis?] {
        try call("analyzeColumn", ColumnArgs(lines: lines, mode: mode))
    }

    /// What Solve writes without a model; `source == nil` means the board would ask the model.
    public func localSolve(_ lines: [String], options: LocalSolveOptions = LocalSolveOptions()) throws -> LocalSolveResult {
        try call("localSolve", LocalSolveArgs(lines: lines, options: options))
    }

    /// The calculator: `3.2*4.5`, `5 km/h to m/s`, `d/dx x^3`, `balance Fe+O2->Fe2O3`.
    public func calculate(_ input: String) throws -> String? {
        let result: Calculated? = try call("calculate", ["input": input])
        return result?.latex
    }

    /// A model's `expected` claim (mathjs) against the student's line.
    public func verifyExpected(_ expected: String, latex: String) throws -> ExpectedVerdict {
        try call("verifyExpected", ["expected": expected, "latex": latex])
    }

    /// What a problem is practice of: the skill an attempt is filed under.
    public func classify(_ lines: [String], course: String? = nil) throws -> String {
        try call("classify", ClassifyArgs(lines: lines, course: course))
    }

    // MARK: - ink

    /// The board's flush minus its editor state: drawings set apart, then lines and columns.
    public func clusterStrokes(_ request: ClusterRequest) throws -> ClusterResult {
        try call("clusterStrokes", request)
    }

    /// `/api/live/recognize`'s strokes and bounds for one line, and its cache key; nil over the caps.
    public func recognizerPayload(_ strokes: [BrainStroke], line: PayloadLine? = nil) throws -> RecognizerPayload? {
        try call("recognizerPayload", PayloadArgs(strokes: strokes, line: line))
    }

    // MARK: - the hand

    /// The tutor's handwriting for LaTeX steps, laid out and timed.
    public func layoutHandwriting(_ request: HandwritingRequest) throws -> HandwritingResult {
        try call("layoutHandwriting", request)
    }

    /// A tick, ring or question mark for a line, and the plan that reveals it.
    public func mark(_ kind: MarkKind, around bbox: Rect, seedKey: String) throws -> MarkResult {
        try call("marks", MarkArgs(kind: kind, bbox: bbox, seedKey: seedKey))
    }

    /// The help ladder and silence rules for one line.
    public func policy(_ input: PolicyInput) throws -> PolicyDecision {
        try call("policy", input)
    }

    /// What the tutor graphs for a column, and the hand-drawn sketch of it; nil: nothing to graph.
    public func sketchGraph(_ lines: [String], explicit: Bool = false, seed: Int? = nil) throws -> GraphSketch? {
        try call("sketchGraph", GraphArgs(lines: lines, explicit: explicit, seed: seed))
    }

    // MARK: - learning

    /// "Now you try": a new problem like this one, checked by the engine; nil when none is found.
    public func variantOf(_ problem: [String], seed: Int, stillClock: Bool = false) throws -> [String]? {
        try call("variantOf", VariantArgs(problem: problem, seed: seed, stillClock: stillClock))
    }

    /// "Now you try" for an attempt record: its problem, seeded by its id, as the web board does.
    public func nowYouTry(problemLatex: String, attemptId: String) throws -> [String]? {
        try call("nowYouTry", ["problemLatex": problemLatex, "attemptId": attemptId])
    }

    /// `count` practice problems for a skill: same seed, same problems.
    public func practice(skill: String, count: Int, seed: Int) throws -> [[String]] {
        try call("practice", PracticeArgs(skill: skill, count: count, seed: seed))
    }

    /// "Practice my weak spots" from the tutor's learner hint; nil: nothing to practise.
    public func weakSpotPractice(hint: JSONValue?, seed: Int, count: Int = 4) throws -> WeakSpotPractice? {
        try call("weakSpotPractice", WeakSpotArgs(hint: hint, seed: seed, count: count))
    }

    /// The Progress page's numbers from the student's attempts (`learning_attempts` rows).
    public func progressSummary(attempts: [JSONValue], now: Date, tzOffsetMinutes: Int = 0, course: String? = nil, grade: Int? = nil) throws -> ProgressSummary {
        try call("progressSummary", ProgressArgs(attempts: attempts, now: now.timeIntervalSince1970 * 1000, tzOffsetMinutes: tzOffsetMinutes, course: course, grade: grade))
    }

    // MARK: - diagnostics

    /// A tight loop in JavaScript: ~5 ms with a JIT, ~100+ ms without (on an M-class chip).
    public func jitProbe(iterations: Int = 5_000_000) throws -> JITProbe {
        try call("jitProbe", ["n": iterations])
    }

    public var loadReport: BrainLoadReport? { report }

    /// Asks JavaScriptCore to collect garbage now (benchmarks; the VM collects on its own).
    public func collectGarbageForTesting() {
        host?.collectGarbage()
    }

    // MARK: - private

    private static func unwrap(_ method: String, envelope: String) throws -> String {
        // `{"ok":true,"result":…}`: the result is everything after the prefix, minus the closing brace
        let okPrefix = #"{"ok":true,"result":"#
        if envelope.hasPrefix(okPrefix), envelope.hasSuffix("}") {
            return String(envelope.dropFirst(okPrefix.count).dropLast())
        }
        guard let failure = try? decoder.decode(Failure.self, from: Data(envelope.utf8)) else {
            throw BrainError.decoding(method: method, message: "not a brain envelope: \(envelope.prefix(200))")
        }
        throw BrainError.brain(code: failure.error.code, message: failure.error.message)
    }

    private static func ms(_ a: DispatchTime, _ b: DispatchTime) -> Double {
        Double(b.uptimeNanoseconds - a.uptimeNanoseconds) / 1_000_000
    }

    private struct Empty: Codable {}
    private struct InitResult: Codable { var api: Int; var engineMs: Double }
    private struct Calculated: Codable { var latex: String }
    private struct Failure: Codable {
        struct Detail: Codable { var code: String; var message: String }
        var ok: Bool
        var error: Detail
    }
    private struct AnalyzeLineArgs: Encodable { var latex: String; var context: AnalyzeContext }
    private struct ColumnArgs: Encodable { var lines: [String]; var mode: HelpMode }
    private struct ClassifyArgs: Encodable { var lines: [String]; var course: String? }
    private struct LocalSolveArgs: Encodable {
        var lines: [String]
        var options: LocalSolveOptions
        func encode(to encoder: Encoder) throws {
            enum K: String, CodingKey { case lines, targetIndex, handwriting, mode, complexRoots, domain }
            var c = encoder.container(keyedBy: K.self)
            try c.encode(lines, forKey: .lines)
            try c.encodeIfPresent(options.targetIndex, forKey: .targetIndex)
            try c.encodeIfPresent(options.handwriting, forKey: .handwriting)
            try c.encodeIfPresent(options.mode, forKey: .mode)
            try c.encodeIfPresent(options.complexRoots, forKey: .complexRoots)
            try c.encodeIfPresent(options.domain, forKey: .domain)
        }
    }
    private struct PayloadArgs: Encodable { var strokes: [BrainStroke]; var line: PayloadLine? }
    private struct MarkArgs: Encodable { var kind: MarkKind; var bbox: Rect; var seedKey: String }
    private struct GraphArgs: Encodable { var lines: [String]; var explicit: Bool; var seed: Int? }
    private struct VariantArgs: Encodable { var problem: [String]; var seed: Int; var stillClock: Bool }
    private struct PracticeArgs: Encodable { var skill: String; var count: Int; var seed: Int }
    private struct WeakSpotArgs: Encodable { var hint: JSONValue?; var seed: Int; var count: Int }
    private struct ProgressArgs: Encodable { var attempts: [JSONValue]; var now: Double; var tzOffsetMinutes: Int; var course: String?; var grade: Int? }
}

/// The line `recognizerPayload` sends: its strokes (default all given) and its box.
public struct PayloadLine: Codable, Hashable, Sendable {
    public var id: String?
    public var strokeIds: [String]
    public var bounds: Rect?
    public init(id: String? = nil, strokeIds: [String], bounds: Rect? = nil) {
        self.id = id
        self.strokeIds = strokeIds
        self.bounds = bounds
    }
}
