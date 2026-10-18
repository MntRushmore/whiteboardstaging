import AgathonBoard
import AgathonBrain
import AgathonDesign
import Foundation
import Observation
import QuartzCore
import UIKit

/// The try's board (docs/ONBOARDING.md, `tryIt`): a real AgathonBoard page. The tutor writes the
/// problem at handwriting pace, the kid writes the answer in the chalk zone, and 650 ms after the pen
/// lifts the ink goes to the checker. A tick, or a ring and one hint in the tutor's hand; "Look
/// again." never says "wrong". Up to three problems before the account.
@MainActor
@Observable
final class TryBoard {
    enum Phase: Equatable {
        /// the tutor is writing the problem
        case writing
        /// the kid's turn
        case waiting
        case checking
        /// solved: the star, then "One more" / "Next"
        case solved
        /// the tutor can't check (offline, rate limited, an error): Next only
        case cantCheck
    }

    struct Message: Equatable {
        var kind: Banner.Kind
        var title: String
        var detail: String?
    }

    let controller: BoardController
    private(set) weak var canvas: BoardCanvasView?
    private var writer: TutorWriter?
    private var queue: [(lines: [TutorLine], done: (() -> Void)?)] = []
    private var subscription: StoreSubscription?

    let checker: any TryItChecking
    private(set) var problems: [OnboardingCatalog.Problem]
    private(set) var problem: OnboardingCatalog.Problem
    var phase: Phase = .writing {
        didSet { if phase == .solved || oldValue == .solved { drawZone() } }
    }
    var message: Message?
    /// page coordinates of the chalk zone the kid writes in
    private(set) var zone: Box = Box(x: 600, y: 400, w: 400, h: 220) {
        didSet { drawZone() }
    }
    private(set) var zoneShown = false {
        didSet { drawZone() }
    }
    /// the chalk zone, drawn on the page under the ink
    private let zoneLayer = CAShapeLayer()
    /// the pencil glyph nods toward the zone after 3 s without writing
    var nudging = false
    var starLanding = 0
    var typedAnswer: String?
    private(set) var record: TryRecord

    private var checked: Set<RecordID> = []
    private var work: [String] = []
    private var lastInk = Date.distantPast
    private var penLiftAt: Date?
    private var scriptIndex = 0
    private var hintTask: Task<Void, Never>?
    private var generation = 0
    private var waitTask: Task<Void, Never>?
    private var nudgeTask: Task<Void, Never>?
    /// a stroke the kid is drawing right now (no check while the pen is down)
    var penIsDown: () -> Bool = { false }

    /// Called when a verdict lands (the flow records it and keeps the strokes).
    var onRecord: (TryRecord) -> Void = { _ in }
    var onChecked: (_ solved: Bool, _ ms: Int?) -> Void = { _, _ in }

    static let handSize = 100.0
    static let hintSize = 40.0
    static let waitAfterLift: Duration = .milliseconds(650)

    init(problems: [OnboardingCatalog.Problem], checker: any TryItChecking, kept: TryRecord? = nil) {
        self.problems = problems
        problem = problems.first(where: { $0.id == kept?.problemId }) ?? problems[0]
        self.checker = checker
        record = kept ?? TryRecord(problemId: problems[0].id)
        let c = BoardController(document: .blank())
        c.tool = .pen
        c.color = .black
        controller = c
    }

    var screenID: RecordID { controller.currentScreenID }

    // MARK: - the canvas

    func attach(_ canvas: BoardCanvasView) {
        guard self.canvas !== canvas else { return }
        self.canvas = canvas
        BlocksBoardLook.apply(to: canvas)
        BlocksBoardLook.insertUnderInk(zoneLayer, in: canvas)
        zoneLayer.fillColor = UIColor(red: 0xF1 / 255.0, green: 0xF2 / 255.0, blue: 0xF6 / 255.0, alpha: 1).cgColor
        drawZone()
        writer = TutorWriter(controller: controller, canvas: canvas)
        penIsDown = { [weak canvas] in
            canvas?.gestureRecognizers?.contains { ($0.state == .began || $0.state == .changed) && !($0 is UIPinchGestureRecognizer) } ?? false
        }
        subscription = controller.store.observe { [weak self] change in self?.storeChanged(change) }
    }

    /// Starts the problem: the tutor writes it, then the zone appears.
    func begin() {
        Task { await writeProblem() }
    }

    // MARK: - the tutor writing

    private func write(_ lines: [TutorLine], done: (() -> Void)? = nil) {
        guard let writer else { done?(); return }
        if writer.isWriting {
            queue.append((lines, done))
            return
        }
        writer.write(lines, meta: ["try": .bool(true)]) { [weak self] in
            done?()
            self?.drain()
        }
    }

    private func drain() {
        guard !queue.isEmpty, let writer, !writer.isWriting else { return }
        let next = queue.removeFirst()
        write(next.lines, done: next.done)
    }

    /// The problem as the tutor writes it: an arithmetic one-step problem gets its "=".
    var problemLatex: String {
        Self.written(problem)
    }

    /// The problem as the tutor writes it: an arithmetic one-step problem gets its "=".
    nonisolated static func written(_ problem: OnboardingCatalog.Problem) -> String {
        let line = problem.lines.joined(separator: " ")
        let bare = line.replacingOccurrences(of: #"\\[a-zA-Z]+"#, with: "", options: .regularExpression)
        let hasLetters = bare.range(of: "[a-zA-Z]", options: .regularExpression) != nil
        return problem.oneStep && !line.contains("=") && !hasLetters ? line + " =" : line
    }

    /// Answers beside the problem (a sum: the answer after its "="), or under it (algebra's steps).
    var answersBeside: Bool { problemLatex.hasSuffix("=") }

    private func writeProblem() async {
        phase = .writing
        message = nil
        zoneShown = false
        let latex = problemLatex
        guard let measured = try? await Brain.shared.layoutHandwriting(HandwritingRequest(steps: [latex], size: Self.handSize, seedKey: problem.id)),
              let plan = measured.plan
        else {
            // the hand can't write it: the zone still opens, the problem is read out
            placeZone(problemBox: Box(x: 400, y: 260, w: 800, h: 110))
            phase = .waiting
            return
        }
        let b = plan.bounds
        let zoneW = answersBeside ? 400.0 : 620.0
        let groupW = answersBeside ? b.w + 56 + zoneW : max(b.w, zoneW)
        let originX = (Box.screen.w - groupW) / 2 + (answersBeside ? 0 : (groupW - b.w) / 2)
        let originY = answersBeside ? 330.0 : 200.0
        let lines = Self.tutorLines(plan, dx: originX - b.x, dy: originY - b.y)
        let problemBox = Box(x: originX, y: originY, w: b.w, h: b.h)
        write(lines) { [weak self] in
            guard let self else { return }
            self.placeZone(problemBox: problemBox)
            self.phase = .waiting
            self.scheduleNudge()
            self.runScript()
        }
    }

    private func placeZone(problemBox p: Box) {
        if answersBeside {
            zone = Box(x: p.maxX + 56, y: p.y + p.h / 2 - 120, w: 400, h: 240)
        } else {
            zone = Box(x: Box.screen.w / 2 - 310, y: p.maxY + 56, w: 620, h: 200)
        }
        zoneShown = true
    }

    /// Moves the zone under what is already there, for the next line; false when the page is full.
    @discardableResult
    private func nextZone(below y: Double) -> Bool {
        let top = y + 40
        guard top + 170 <= Box.screen.h - 20 else { return false }
        zone = Box(x: zone.x, y: top, w: zone.w, h: min(220, Box.screen.h - 20 - top))
        return true
    }

    private func drawZone() {
        let path = zoneShown && phase != .solved
            ? CGPath(roundedRect: zone.cgRect, cornerWidth: 34, cornerHeight: 34, transform: nil) : nil
        CATransaction.begin()
        CATransaction.setAnimationDuration(UIAccessibility.isReduceMotionEnabled ? 0 : 0.22)
        zoneLayer.path = path
        zoneLayer.opacity = path == nil ? 0 : 1
        CATransaction.commit()
    }

    nonisolated static func tutorLines(_ plan: HandPlan, dx: Double, dy: Double) -> [TutorLine] {
        plan.lines.map { line in
            TutorLine(strokes: line.strokes.compactMap { s in
                guard s.points.count >= 2 else { return nil }
                return TutorStroke(points: s.points.map { FreehandInput(Vec2($0.x + line.x + dx, $0.y + line.y + dy), $0.z) }, weight: s.weight ?? 1)
            }, latex: line.latex)
        }
    }

    // MARK: - the kid's ink

    private var kidStrokes: [StrokeRecord] {
        controller.store.drawables(on: screenID).compactMap { r in
            if case .stroke(let s) = r, s.author == .kid { return s }
            return nil
        }
    }

    private var pending: [StrokeRecord] { kidStrokes.filter { !checked.contains($0.id) } }

    private func storeChanged(_ change: ChangeSet) {
        guard change.origin == .kid || change.origin == .history else { return }
        lastInk = Date()
        nudging = false
        nudgeTask?.cancel()
        generation += 1
        guard phase == .waiting || phase == .checking else { return }
        if message?.kind != .success { message = nil }
        if phase == .checking { phase = .waiting }
        waitTask?.cancel()
        guard !pending.isEmpty else { return }
        penLiftAt = Date()
        let gen = generation
        waitTask = Task { [weak self] in
            try? await Task.sleep(for: Self.waitAfterLift)
            guard let self, !Task.isCancelled, gen == self.generation else { return }
            await self.checkWhenPenIsUp(gen)
        }
    }

    private func checkWhenPenIsUp(_ gen: Int) async {
        // the pen is down again: the next lift restarts the wait
        while penIsDown() {
            try? await Task.sleep(for: .milliseconds(120))
            if gen != generation { return }
        }
        await check(gen)
    }

    private static func bounds(_ strokes: [StrokeRecord]) -> Box? {
        var minX = Double.infinity, minY = Double.infinity, maxX = -Double.infinity, maxY = -Double.infinity
        for s in strokes {
            for p in s.points {
                minX = min(minX, s.x + Double(p.x)); maxX = max(maxX, s.x + Double(p.x))
                minY = min(minY, s.y + Double(p.y)); maxY = max(maxY, s.y + Double(p.y))
            }
        }
        guard minX.isFinite else { return nil }
        let pad = 4.0
        return Box(x: minX - pad, y: minY - pad, w: max(8, maxX - minX + pad * 2), h: max(8, maxY - minY + pad * 2))
    }

    private func check(_ gen: Int) async {
        let batch = pending
        guard !batch.isEmpty, let box = Self.bounds(batch) else { return }
        phase = .checking
        let ink = TryInk(strokes: batch.map { s in
            TryInk.Stroke(x: s.points.map { s.x + Double($0.x) }, y: s.points.map { s.y + Double($0.y) })
        })
        let lift = penLiftAt
        do {
            let result = try await checker.check(ink, problem: problem, work: work)
            guard gen == generation else { return }
            apply(result, batch: batch, box: box, lift: lift)
        } catch {
            guard gen == generation else { return }
            cantCheck()
        }
    }

    /// "Type it instead": the typed answer goes to the same judge (engine only, no read).
    func checkTyped(_ answer: String) async {
        typedAnswer = answer
        phase = .checking
        record.typed = true
        let box = Box(x: zone.x + 24, y: zone.y + zone.h / 2 - 40, w: max(80, Double(answer.count) * 46), h: 80)
        do {
            let result = try await checker.checkTyped(answer, problem: problem, work: work)
            apply(result, batch: [], box: box, lift: Date())
        } catch {
            cantCheck()
        }
    }

    private func cantCheck() {
        phase = .cantCheck
        message = Message(kind: .paused, title: "The tutor can’t check right now.", detail: "Tap Next to keep going.")
        announce("The tutor can’t check right now. Tap Next to keep going.")
    }

    private func apply(_ result: TryCheck, batch: [StrokeRecord], box: Box, lift: Date?) {
        for s in batch { checked.insert(s.id) }
        record.latex = result.latex
        record.verdict = result.verdict.rawValue
        record.strokes = kidStrokes.map { s in s.points.map { [s.x + Double($0.x), s.y + Double($0.y), Double($0.pressure)] } }
        let ms = lift.map { Int(Date().timeIntervalSince($0) * 1000) }
        let seed = UInt32(truncatingIfNeeded: box.x.bitPattern ^ box.y.bitPattern)
        // the verdict comes first: a hint still being written is finished at once (whole lines,
        // never half a word) and nothing older waits in front of the tick
        hintTask?.cancel()
        queue.removeAll()
        writer?.cancel()
        switch result.verdict {
        case .solved, .check:
            let solved = result.verdict == .solved
            write([TutorLine(strokes: TutorMarks.strokes(.tick, line: box, seed: seed), latex: "\\checkmark")])
            OnboardingSound.shared.play(.tick)
            UIAccessibility.post(notification: .announcement, argument: solved ? "You got it." : "Right. Keep going.")
            if solved {
                record.ms = ms
                phase = .solved
                message = Message(kind: .success, title: "You got it.")
                Task {
                    try? await Task.sleep(for: .milliseconds(400))
                    starLanding += 1
                }
            } else {
                work.append(result.latex)
                message = Message(kind: .success, title: "Right. Keep going.")
                phase = .waiting
                if !nextZone(below: box.maxY) { phase = .solved }
            }
            onChecked(solved, ms)
        case .ring:
            record.rings += 1
            write([TutorLine(strokes: TutorMarks.strokes(.ring, line: box, seed: seed), latex: "")])
            let hint = result.note ?? problem.hint
            message = Message(kind: .lookAgain, title: "Look again.", detail: hint)
            OnboardingSound.shared.play(.woodblock)
            announce("Look again. \(hint)")
            phase = .waiting
            writeHint(hint, under: box)
        case .unread:
            write([TutorLine(strokes: TutorMarks.strokes(.question, line: box, seed: seed), latex: "?")])
            message = Message(kind: .lookAgain, title: "Write it a little bigger.")
            announce("Write it a little bigger.")
            phase = .waiting
            nextZone(below: box.maxY)
        case .unjudged:
            // nothing to check yet: the strokes stay in play with the next ones
            for s in batch { checked.remove(s.id) }
            message = Message(kind: .tutor, title: "Write the whole answer.")
            announce("Write the whole answer.")
            phase = .waiting
        }
        typedAnswer = nil
        onRecord(record)
        if phase == .waiting, result.verdict != .unjudged { runScript(after: .milliseconds(2600)) }
    }

    /// Debug: the next scripted answer (`-onboardingAutowrite`), a beat after the kid's turn opens.
    func runScript(after delay: Duration = .milliseconds(1400)) {
        #if DEBUG
        guard let script = Self.autowriteScript, scriptIndex < script.count else { return }
        let item = script[scriptIndex]
        scriptIndex += 1
        Task {
            try? await Task.sleep(for: delay)
            guard phase == .waiting else { return }
            await autowrite(autowriteText(item))
        }
        #endif
    }

    private func writeHint(_ hint: String, under box: Box) {
        hintTask = Task {
            let x = box.x
            let y = box.maxY + 26
            guard let ink = await HandInkMaker.shared.words(hint, size: Self.hintSize), !Task.isCancelled else {
                nextZone(below: box.maxY + 20)
                return
            }
            let maxW = Box.screen.w - x - 40
            let scale = min(1, maxW / max(1, ink.size.width))
            let line = TutorLine(strokes: ink.strokes.map { s in
                TutorStroke(points: zip(s.points, s.pressure).map { FreehandInput(Vec2(x + $0.0.x * scale, y + $0.0.y * scale), $0.1) }, weight: 0.8)
            }, latex: "")
            write([line])
            nextZone(below: y + ink.size.height * scale)
        }
    }

    // MARK: - Help me

    func help() async {
        guard phase == .waiting else { return }
        record.helped = true
        guard let step = try? await checker.help(problem: problem, work: work) else {
            message = Message(kind: .tutor, title: problem.hint)
            return
        }
        guard let plan = try? await Brain.shared.layoutHandwriting(HandwritingRequest(steps: [step], size: Self.handSize * 0.8, seedKey: step)).plan else {
            message = Message(kind: .tutor, title: problem.hint)
            return
        }
        let b = plan.bounds
        let x = zone.x + 20
        let y = zone.y + 20
        write(Self.tutorLines(plan, dx: x - b.x, dy: y - b.y))
        work.append(step)
        message = Message(kind: .tutor, title: "Here’s the next step.", detail: "Write the one after it.")
        nextZone(below: y + b.h)
    }

    // MARK: - one more

    var canTryAnother: Bool { problems.count > 1 }

    /// The next problem: the page is cleared, the tutor writes it.
    func oneMore() {
        guard let at = problems.firstIndex(of: problem) else { return }
        let next = problems[(at + 1) % problems.count]
        problem = next
        record = TryRecord(problemId: next.id)
        checked = []
        work = []
        message = nil
        typedAnswer = nil
        waitTask?.cancel()
        writer?.cancel()
        queue = []
        controller.store.remove(controller.store.drawableIDs(on: screenID), origin: .system)
        scriptIndex = 0
        begin()
    }

    // MARK: - nudge

    private func scheduleNudge() {
        nudgeTask?.cancel()
        nudgeTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            guard let self, !Task.isCancelled, self.phase == .waiting, self.pending.isEmpty else { return }
            self.nudging = true
        }
    }

    private func announce(_ text: String) {
        if UIAccessibility.isVoiceOverRunning { UIAccessibility.post(notification: .announcement, argument: text) }
    }

    func stop() {
        waitTask?.cancel()
        nudgeTask?.cancel()
        writer?.cancel()
        subscription?.cancel()
    }

    /// The page in view points for a view of this size (the camera is fixed: no zoom on the try).
    static func camera(for size: CGSize, insets: CameraConstraints) -> Camera {
        insets.fit(Box.screen, in: size)
    }
}

/// The board in Blocks: the chalk ground around the page, the page flat with 18 pt corners
/// (AgathonBoard's `CanvasAppearance.blocks`), and a layer of the onboarding's own under the ink.
enum BlocksBoardLook {
    @MainActor
    static func apply(to canvas: BoardCanvasView) {
        canvas.appearance = .blocks
    }

    /// Puts `layer` in page space between the paper and the ink.
    @MainActor
    static func insertUnderInk(_ layer: CALayer, in canvas: BoardCanvasView) {
        guard let content = canvas.layer.sublayers?.first, (content.sublayers?.count ?? 0) >= 2, layer.superlayer == nil else { return }
        layer.actions = ["path": NSNull(), "position": NSNull(), "bounds": NSNull()]
        content.insertSublayer(layer, at: 1)
    }
}

#if DEBUG
// MARK: - Autowrite (Debug: the simulator has no Pencil)

/// `-onboardingAutowrite right` (or `wrong,right`, `messy`…) writes answers into the zone through the
/// canvas's own touch path, in a kid's black ink drawn from the hand engine's glyphs, so the QA
/// videos and UI tests run the real read and check. One item per attempt, in order.
extension TryBoard {
    static var autowriteScript: [String]? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-onboardingAutowrite"), i + 1 < args.count else { return nil }
        return args[i + 1].split(separator: ",").map(String.init)
    }

    /// What a kid would write for `item` under this problem.
    func autowriteText(_ item: String) -> String {
        let right = Self.plainAnswer(problem.firstStep)
        switch item {
        case "wrong":
            if let n = Int(right) { return String(n + 1) }
            return right + "1"
        case "right": return right
        default: return item
        }
    }

    static func plainAnswer(_ latex: String) -> String {
        var s = latex
        while let r = s.range(of: #"\\frac\{([^{}]*)\}\{([^{}]*)\}"#, options: .regularExpression) {
            let parts = String(s[r]).dropFirst(6).split(separator: "}", maxSplits: 1).map { $0.replacingOccurrences(of: "{", with: "") }
            s.replaceSubrange(r, with: parts.count == 2 ? "\(parts[0])/\(parts[1])" : "")
        }
        return s.replacingOccurrences(of: "\\times", with: "x").replacingOccurrences(of: "\\", with: "")
    }

    func autowrite(_ text: String) async {
        guard let canvas, let ink = await HandInkMaker.shared.words(text, size: min(110, zone.h * 0.48), seed: 31) else { return }
        let origin = Vec2(zone.x + 34, zone.y + (zone.h - ink.size.height) / 2)
        for stroke in ink.strokes {
            let pts = stroke.points.map { canvas.camera.toView(Vec2(origin.x + $0.x, origin.y + $0.y)) }
            let duration = max(0.12, min(0.6, stroke.length / 700))
            await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
                canvas.simulateStroke(pts, duration: duration, pencil: false) { done.resume() }
            }
            try? await Task.sleep(for: .milliseconds(90))
        }
    }
}
#endif
