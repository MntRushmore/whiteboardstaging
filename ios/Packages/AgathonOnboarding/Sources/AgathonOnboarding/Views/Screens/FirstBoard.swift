import AgathonBoard
import AgathonBrain
import AgathonDesign
import AgathonSync
import SwiftUI

/// The kid's first board (docs/ONBOARDING.md, `firstBoard`), made on the iPad:
///  - screen 1: the problem the kid tried, in the tutor's hand, with the kid's own strokes and the
///    tutor's tick, carried from the try; the next problem goes under it (the board writes it live);
///  - screens 2…: the plan's practice problems from the brain's practice set (4 in all, the web's
///    `START_PROBLEMS`).
@MainActor
enum FirstBoardMaker {

    /// The document, and the first practice problem left for the tutor to write live on screen 1.
    /// `boardId`: the row it goes into, so the first screen's id is the one the board session uses.
    static func make(answers a: OnboardingAnswers, seed: Int, boardId: String? = nil) async -> Made {
        let store = BoardStore(document: boardId.map(BoardSession.blankDocument(boardId:)) ?? .blank())
        guard let first = store.screenIDs.first else { return Made(document: .blank(), liveProblem: nil, liveX: nil, liveY: 300) }
        var bottom = 140.0
        var left: Double?

        // the try, as it was
        if let t = a.tries.first(where: { $0.checked }) ?? a.tries.first, let p = OnboardingCatalog.shared.problem(t.problemId) {
            let latex = TryBoard.written(p)
            // exactly as the try wrote it (same hand, same seed, same place), so the kid's strokes sit
            // where they were written
            if let plan = try? await Brain.shared.layoutHandwriting(HandwritingRequest(steps: [latex], size: TryBoard.handSize, seedKey: p.id)).plan {
                let b = plan.bounds
                let o = TryBoard.problemOrigin(width: b.w, beside: latex.hasSuffix("="))
                let lines = TryBoard.tutorLines(plan, dx: o.x - b.x, dy: o.y - b.y)
                put(lines, on: first, in: store, meta: ["problem": .bool(true)])
                bottom = o.y + b.h
                left = o.x
            }
            var inkBox: Box?
            var kidIds: [RecordID] = []
            for pts in (t.answerStrokes ?? t.strokes) where pts.count >= 2 {
                guard let o = pts.first, o.count >= 2 else { continue }
                let s = StrokeRecord(screen: first, order: store.nextOrder(on: first), author: .kid, color: .black, width: 6,
                                     pressure: .real, x: o[0], y: o[1],
                                     points: pts.map { InkPoint(x: $0[0] - o[0], y: $0[1] - o[1], pressure: $0.count > 2 ? $0[2] : 0.5) })
                store.put(.stroke(s), origin: .system)
                kidIds.append(s.id)
                for q in pts {
                    let r = Box(x: q[0], y: q[1], w: 0, h: 0)
                    inkBox = inkBox.map { Box(x: min($0.x, r.x), y: min($0.y, r.y), w: max($0.maxX, r.x) - min($0.x, r.x), h: max($0.maxY, r.y) - min($0.y, r.y)) } ?? r
                }
            }
            if let box = inkBox {
                if t.checked {
                    carryTick(on: first, in: store, kid: kidIds, box: box, latex: t.latex ?? "")
                }
                bottom = max(bottom, box.maxY)
            }
        }

        // the practice problems: the plan's first skill the practice set has problems for (as the web's
        // finish.ts does), else the try's own starters at the kid's level
        var problems: [[String]] = []
        for skill in Plan.skills(a) {
            if let p = try? await Brain.shared.practice(skill: skill, count: Plan.firstBoardProblems, seed: seed), !p.isEmpty {
                problems = p
                break
            }
        }
        if problems.isEmpty {
            let tried = Set(a.tries.map(\.problemId))
            problems = Plan.tryProblems(a).filter { !tried.contains($0.id) }.prefix(Plan.firstBoardProblems).map { [TryBoard.written($0)] }
        }
        var live: String?
        for (i, problem) in problems.enumerated() {
            let latex = Self.asked(problem.joined(separator: " "))
            if i == 0 {
                live = latex
                continue
            }
            let s = ScreenRecord(order: OrderKey.after(store.screens.last?.order), name: "Screen \(store.screens.count + 1)")
            store.put(.screen(s), origin: .system)
            if let plan = try? await Brain.shared.layoutHandwriting(HandwritingRequest(steps: [latex], size: TryBoard.handSize, seedKey: latex)).plan {
                let o = TryBoard.problemOrigin(width: plan.bounds.w, beside: latex.hasSuffix("="))
                put(TryBoard.tutorLines(plan, dx: o.x - plan.bounds.x, dy: 200 - plan.bounds.y), on: s.id, in: store, meta: ["problem": .bool(true)])
            }
        }
        // the next problem goes under the try (or at the top when there was no try)
        return Made(document: store.document, liveProblem: live, liveX: left, liveY: a.tries.isEmpty ? 260 : max(580, bottom + 110))
    }

    /// An arithmetic problem as the tutor asks it on a board: with its "=" (algebra keeps its own).
    static func asked(_ latex: String) -> String {
        let bare = latex.replacingOccurrences(of: #"\\[a-zA-Z]+"#, with: "", options: .regularExpression)
        let letters = bare.range(of: "[a-zA-Z]", options: .regularExpression) != nil
        return !latex.contains("=") && !letters ? latex + " =" : latex
    }

    struct Made {
        var document: BoardDocument
        /// written live on screen 1 by the first board (then saved with it)
        var liveProblem: String?
        /// the try problem's left edge, so the next problem lines up under it; nil: centred
        var liveX: Double?
        var liveY: Double
    }

    /// The ticked answer carried from the try as the board's tutor keeps its work: the kid's ink as a
    /// read `line` (no second read when the board opens), the tick as its `mark`, and the tick's
    /// strokes stamped as the Live loop stamps its own (`lineId`, `mark` key: the web's
    /// `check:x,y,w,h` in quarters), so the loop finds the tick already on the page and never writes a
    /// second one.
    static func carryTick(on screen: RecordID, in store: BoardStore, kid: [RecordID], box: Box, latex: String) {
        let lineId = RecordID.make(.line)
        let key = String(lineId.key)
        func r(_ n: Double) -> Int { Int(floor(n / 4 + 0.5)) }
        let markKey = "check:\(r(box.x)),\(r(box.y)),\(r(box.w)),\(r(box.h))"
        let ticks = put([TutorLine(strokes: TutorMarks.strokes(.tick, line: box, seed: 11), latex: "\\checkmark")], on: screen, in: store,
                        meta: ["live": .bool(true), "source": .string("ai"), "lineId": .string(key), "mark": .string(markKey)])
        guard !latex.isEmpty, !kid.isEmpty else { return }
        store.put(.line(LineRecord(id: lineId, screen: screen, strokes: kid, latex: latex, verdict: .ok,
                                   meta: ["confidence": .number(1), "provider": .string("mathpix")])), origin: .system)
        store.put(.mark(MarkRecord(screen: screen, kind: .tick, target: lineId, strokes: ticks,
                                   meta: ["mark": .string(markKey), "lineId": .string(key)])), origin: .system)
    }

    @discardableResult
    static func put(_ lines: [TutorLine], on screen: RecordID, in store: BoardStore, meta: Meta) -> [RecordID] {
        var ids: [RecordID] = []
        for line in lines {
            for s in line.strokes where s.points.count >= 2 {
                let o = s.points[0].p
                var m = meta
                if !line.latex.isEmpty { m[HandPace.lineMeta] = .string(line.latex) }
                let r = StrokeRecord(screen: screen, order: store.nextOrder(on: screen), author: .tutor, color: line.color,
                                     width: InkStyle.tutorWidth(weight: s.weight), pressure: .real, x: o.x, y: o.y,
                                     points: s.points.map { InkPoint(x: $0.p.x - o.x, y: $0.p.y - o.y, pressure: $0.pressure) },
                                     meta: m)
                store.put(.stroke(r), origin: .system)
                ids.append(r.id)
            }
        }
        return ids
    }
}

// MARK: - 15 · the first board

/// The first board as the onboarding shows it before handing over: the board with the try on it,
/// the tutor writing the next problem under it, and the one-time welcome with the shapes beside it
/// for 2 s. The app opens its own board editor on `onFinish(.firstBoard(…))`.
struct FirstBoardScreen: View {
    let model: FlowModel
    let layout: StageLayout
    @State private var controller: BoardController?
    @State private var live: String?
    @State private var shapes = true
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let c = model.copy
        VStack(alignment: .leading, spacing: 12) {
            // the largest text sizes: the welcome wraps over the full width and Let's go sits under it
            // (side by side they would not fit, and Let's go was pushed off: the onboarding's AX failure)
            Group {
                if typeSize.isAccessibilitySize {
                    VStack(alignment: .leading, spacing: 12) {
                        welcome(c)
                        HStack {
                            Spacer()
                            letsGo(c)
                        }
                    }
                } else {
                    HStack(spacing: 14) {
                        if shapes {
                            TheShapes(.hello).frame(width: 84).transition(.scale(scale: 0.6).combined(with: .opacity))
                                .accessibilityHidden(true)
                        }
                        welcome(c)
                        Spacer(minLength: 12)
                        letsGo(c)
                    }
                    .frame(minHeight: 76)
                }
            }
            .reveal(0)
            ZStack {
                if let controller {
                    BoardCanvas(controller: controller, insets: CameraConstraints(top: 8, left: 8, bottom: 8, right: 8, maxZoom: 4), appearance: .blocks) { canvas in
                        BlocksBoardLook.apply(to: canvas)
                        if model.liveWriter == nil {
                            let w = TutorWriter(controller: controller, canvas: canvas)
                            model.liveWriter = w
                            writeLive(w)
                        }
                    }
                } else {
                    DS.Color.ground
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: DS.Radius.page, style: .continuous))
            .reveal(1)
        }
        .padding(.horizontal, 24)
        .padding(.top, max(layout.safe.top, 12) + 6)
        .padding(.bottom, max(layout.safe.bottom, 12))
        .frame(width: layout.size.width, height: layout.size.height)
        .task {
            if model.firstBoardMade == nil {
                model.firstBoardMade = await FirstBoardMaker.make(answers: model.answers, seed: model.boardSeed)
            }
            live = model.firstBoardMade?.liveProblem
            controller = BoardController(document: model.firstBoardMade?.document ?? .blank())
            try? await Task.sleep(for: .seconds(2))
            withAnimation(DS.Motion.fade) { shapes = false }
        }
    }

    private func welcome(_ c: OnboardingCopy) -> some View {
        Text(c.welcome)
            .dsFont(.headline, size: 26)
            .foregroundStyle(DS.Color.onInk)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 22).padding(.vertical, 14)
            .background(BubbleShape(tail: .leading).fill(DS.Color.tutorInk))
            .accessibilityAddTraits(.isHeader)
    }

    private func letsGo(_ c: OnboardingCopy) -> some View {
        PillButton(c.letsGo, icon: .forward, kind: .sunny, size: .large) { finish() }
            .fixedSize()
            .accessibilityIdentifier("onboarding.firstBoard.go")
    }

    private func writeLive(_ w: TutorWriter) {
        guard let live else { return }
        Task {
            try? await Task.sleep(for: .milliseconds(700))
            guard let plan = try? await Brain.shared.layoutHandwriting(HandwritingRequest(steps: [live], size: TryBoard.handSize, seedKey: live)).plan else { return }
            let y = model.firstBoardMade?.liveY ?? 600
            let x = model.firstBoardMade?.liveX ?? (Box.screen.w - plan.bounds.w) / 2
            w.write(TryBoard.tutorLines(plan, dx: x - plan.bounds.x, dy: y - plan.bounds.y), meta: ["problem": .bool(true)])
        }
    }

    private func finish() {
        let handoff = model.firstBoard ?? FirstBoardHandoff(boardId: nil, document: controller?.store.document ?? .blank(),
                                                             kidName: model.answers.name, welcome: model.copy.welcome)
        // what the tutor wrote live is in the controller's document: save that, and hand it over
        let doc = controller?.store.document ?? handoff.document
        model.liveWriter?.cancel()
        Task {
            if let id = handoff.boardId { _ = await model.backend.saveBoard(id: id, document: doc) }
            model.state.finish()
            model.onFinish(.firstBoard(FirstBoardHandoff(boardId: handoff.boardId, document: doc, kidName: handoff.kidName, welcome: handoff.welcome)))
        }
    }
}
