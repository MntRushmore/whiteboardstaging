import AgathonBoard
import AgathonBrain
import AgathonDesign
import SwiftUI

/// The kid's first board (docs/ONBOARDING.md, `firstBoard`), made on the iPad:
///  - screen 1: the problem the kid tried, in the tutor's hand, with the kid's own strokes and the
///    tutor's tick, carried from the try; the next problem goes under it (the board writes it live);
///  - screens 2…: the plan's practice problems from the brain's practice set (4 in all, the web's
///    `START_PROBLEMS`).
@MainActor
enum FirstBoardMaker {
    static let handSize = 72.0

    /// The document, and the first practice problem left for the tutor to write live on screen 1.
    static func make(answers a: OnboardingAnswers, seed: Int) async -> (document: BoardDocument, liveProblem: String?) {
        let store = BoardStore(document: .blank())
        guard let first = store.screenIDs.first else { return (.blank(), nil) }
        var bottom = 140.0

        // the try, as it was
        if let t = a.tries.first(where: { $0.checked }) ?? a.tries.first, let p = OnboardingCatalog.shared.problem(t.problemId) {
            let latex = TryBoard.written(p)
            if let plan = try? await Brain.shared.layoutHandwriting(HandwritingRequest(steps: [latex], size: handSize, seedKey: p.id)).plan {
                let b = plan.bounds
                let lines = TryBoard.tutorLines(plan, dx: 160 - b.x, dy: 120 - b.y)
                put(lines, on: first, in: store, meta: ["problem": .bool(true)])
                bottom = 120 + b.h
            }
            var inkBox: Box?
            for pts in t.strokes where pts.count >= 2 {
                guard let o = pts.first, o.count >= 2 else { continue }
                let s = StrokeRecord(screen: first, order: store.nextOrder(on: first), author: .kid, color: .black, width: 6,
                                     pressure: .real, x: o[0], y: o[1],
                                     points: pts.map { InkPoint(x: $0[0] - o[0], y: $0[1] - o[1], pressure: $0.count > 2 ? $0[2] : 0.5) })
                store.put(.stroke(s), origin: .system)
                for q in pts {
                    let r = Box(x: q[0], y: q[1], w: 0, h: 0)
                    inkBox = inkBox.map { Box(x: min($0.x, r.x), y: min($0.y, r.y), w: max($0.maxX, r.x) - min($0.x, r.x), h: max($0.maxY, r.y) - min($0.y, r.y)) } ?? r
                }
            }
            if let box = inkBox, t.checked {
                put([TutorLine(strokes: TutorMarks.strokes(.tick, line: box, seed: 11), latex: "\\checkmark")], on: first, in: store, meta: [:])
                bottom = max(bottom, box.maxY)
            }
        }

        // the practice problems
        let skill = Plan.firstSkill(a) ?? "add_within_10"
        let problems = (try? await Brain.shared.practice(skill: skill, count: Plan.firstBoardProblems, seed: seed)) ?? []
        var live: String?
        for (i, problem) in problems.enumerated() {
            let latex = problem.joined(separator: " ")
            if i == 0 {
                live = latex
                continue
            }
            let s = ScreenRecord(order: OrderKey.after(store.screens.last?.order), name: "Screen \(store.screens.count + 1)")
            store.put(.screen(s), origin: .system)
            if let plan = try? await Brain.shared.layoutHandwriting(HandwritingRequest(steps: problem, size: handSize, seedKey: latex)).plan {
                put(TryBoard.tutorLines(plan, dx: 160 - plan.bounds.x, dy: 120 - plan.bounds.y), on: s.id, in: store, meta: ["problem": .bool(true)])
            }
        }
        _ = bottom
        return (store.document, live)
    }

    static func put(_ lines: [TutorLine], on screen: RecordID, in store: BoardStore, meta: Meta) {
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
            }
        }
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
    @State private var writer: TutorWriter?
    @State private var live: String?
    @State private var shapes = true

    var body: some View {
        let c = model.copy
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 14) {
                if shapes {
                    TheShapes(.hello).frame(width: 84).transition(.scale(scale: 0.6).combined(with: .opacity))
                        .accessibilityHidden(true)
                }
                Text(c.welcome)
                    .dsFont(.headline, size: 26)
                    .foregroundStyle(DS.Color.onInk)
                    .padding(.horizontal, 22).padding(.vertical, 14)
                    .background(BubbleShape(tail: .leading).fill(DS.Color.tutorInk))
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                PillButton(c.letsGo, icon: .forward, kind: .sunny, size: .large) { finish() }
            }
            .frame(height: 76)
            .reveal(0)
            ZStack {
                if let controller {
                    BoardCanvas(controller: controller, insets: CameraConstraints(top: 8, left: 8, bottom: 8, right: 8, maxZoom: 4)) { canvas in
                        BlocksBoardLook.apply(to: canvas)
                        if writer == nil {
                            let w = TutorWriter(controller: controller, canvas: canvas)
                            writer = w
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

    private func writeLive(_ w: TutorWriter) {
        guard let live else { return }
        Task {
            try? await Task.sleep(for: .milliseconds(700))
            guard let plan = try? await Brain.shared.layoutHandwriting(HandwritingRequest(steps: [live], size: FirstBoardMaker.handSize, seedKey: live)).plan else { return }
            let y = 470.0
            w.write(TryBoard.tutorLines(plan, dx: 160 - plan.bounds.x, dy: y - plan.bounds.y), meta: ["problem": .bool(true)])
        }
    }

    private func finish() {
        let handoff = model.firstBoard ?? FirstBoardHandoff(boardId: nil, document: controller?.store.document ?? .blank(),
                                                             kidName: model.answers.name, welcome: model.copy.welcome)
        // what the tutor wrote live is in the controller's document: hand that over
        let doc = controller?.store.document ?? handoff.document
        model.state.finish()
        model.onFinish(.firstBoard(FirstBoardHandoff(boardId: handoff.boardId, document: doc, kidName: handoff.kidName, welcome: handoff.welcome)))
    }
}
