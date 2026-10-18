import AgathonBoard
import AgathonDesign
import AgathonKit
import SwiftUI

// MARK: - 5 · hand to the kid

struct HandToKidScreen: View {
    let model: FlowModel
    let layout: StageLayout

    var body: some View {
        let c = model.copy
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            IconCircle(.pen, fill: .ink, diameter: 104)
                .reveal(0)
            Text(c.handToKidTitle)
                .dsFont(.display)
                .foregroundStyle(DS.Color.ink)
                .multilineTextAlignment(.center)
                .padding(.top, 32)
                .reveal(1)
                .accessibilityAddTraits(.isHeader)
            Text(c.handToKidLede)
                .dsFont(.body, size: 21)
                .foregroundStyle(DS.Color.ink)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 560)
                .padding(.top, 14)
                .reveal(2)
            Text(c.handToKidSmall)
                .dsFont(.callout)
                .foregroundStyle(DS.Color.ink)
                .padding(.top, 8)
                .reveal(3)
            HStack(spacing: 16) {
                Button(c.tryItFirst) { model.go(.tryIt) }
                    .buttonStyle(.pill(.quiet, size: .large))
                PillButton(c.kidHasIt, icon: .play, kind: .primary, size: .large) { model.go(.tryIt) }
            }
            .padding(.top, 36)
            .reveal(4)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, layout.margin)
        .frame(width: layout.size.width, height: layout.size.height)
        .task {
            // the problem's ink and the reader's first check, warmed while the iPad changes hands
            let problems = Plan.tryProblems(model.answers)
            if let p = problems.first { _ = await HandInkMaker.shared.latex([TryBoard.written(p)], size: TryBoard.handSize) }
            await model.backend.tryChecker.warmUp()
        }
    }
}

// MARK: - 6 · the try

struct TryItScreen: View {
    let model: FlowModel
    let layout: StageLayout
    @State private var board: TryBoard?
    @State private var typing = false
    @State private var canvasSize: CGSize = .zero
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver

    private var insets: CameraConstraints { CameraConstraints(top: 8, left: 8, bottom: 8, right: 8, maxZoom: 1) }

    var body: some View {
        let c = model.copy
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Text(c.tryTitle)
                    .dsFont(.headline, size: 30)
                    .foregroundStyle(DS.Color.ink)
                    .accessibilityAddTraits(.isHeader)
                if board?.phase == .checking {
                    StatusPill(c.checking, pulses: !reduceMotion)
                        .transition(.opacity.combined(with: .scale(scale: 0.9)))
                }
                Spacer()
                if voiceOver || board?.phase == .cantCheck {
                    Button(c.typeInstead) { typing = true }
                        .buttonStyle(.pill(.quiet))
                }
                RoundButton(.speaker, fill: .paper, diameter: 52, label: c.readAloud) { readProblem() }
                Button(c.skipForNow) { model.skipTry() }
                    .buttonStyle(.pill(.quiet))
            }
            .animation(DS.Motion.fade, value: board?.phase)
            .frame(height: 60)

            GeometryReader { geo in
                ZStack(alignment: .topLeading) {
                    if let board {
                        BoardCanvas(controller: board.controller, insets: insets) { canvas in
                            board.attach(canvas)
                        }
                        .accessibilityLabel(problemWords(board))
                        .accessibilityAction(named: Text(c.typeInstead)) { typing = true }
                        overlays(board, size: geo.size)
                    }
                }
                .onAppear { canvasSize = geo.size }
                .onChange(of: geo.size) { _, s in canvasSize = s }
            }
            .clipShape(RoundedRectangle(cornerRadius: DS.Radius.page, style: .continuous))
        }
        .padding(.horizontal, 24)
        .padding(.top, max(layout.safe.top, 12) + 6)
        .padding(.bottom, max(layout.safe.bottom, 12))
        .frame(width: layout.size.width, height: layout.size.height)
        .onAppear(perform: setUp)
        .onDisappear { board?.stop() }
        .sheet(isPresented: $typing) {
            TypeItSheet(copy: c) { answer in
                typing = false
                Task { await board?.checkTyped(answer) }
            }
            .presentationDetents([.height(560)])
        }
    }

    private func setUp() {
        guard board == nil else { return }
        let problems = Plan.tryProblems(model.answers)
        guard !problems.isEmpty else { model.skipTry(); return }
        let tried = Set(model.answers.tries.map(\.problemId))
        // a problem not tried yet first (the one a closed app left half done stays first)
        let kept = model.answers.tries.last.flatMap { $0.solved ? nil : $0 }
        let order = problems.filter { !tried.contains($0.id) || $0.id == kept?.problemId }
        let b = TryBoard(problems: order.isEmpty ? problems : order, checker: model.backend.tryChecker, kept: kept)
        b.onRecord = { [weak model] r in model?.keepTry(r) }
        b.onChecked = { [weak model] solved, ms in model?.triedChecked(solved: solved, ms: ms) }
        board = b
        Task {
            try? await Task.sleep(for: .milliseconds(350))
            b.begin()
            if let g = model.answers.choice?.grade, g <= 1 {
                try? await Task.sleep(for: .milliseconds(1500))
                ReadAloud.shared.say([model.copy.instruction])
            }
        }
    }

    private func problemWords(_ board: TryBoard) -> String {
        "The tutor wrote: \(LatexWords.say(board.problemLatex, blank: board.answersBeside))"
    }

    private func readProblem() {
        guard let board else { return }
        ReadAloud.shared.say([LatexWords.say(board.problemLatex, blank: board.answersBeside), model.copy.instruction])
    }

    // MARK: overlays on the page

    @ViewBuilder private func overlays(_ board: TryBoard, size: CGSize) -> some View {
        let cam = TryBoard.camera(for: size, insets: insets)
        let z = board.zone
        let zoneRect = CGRect(origin: cam.toView(Vec2(z.x, z.y)), size: CGSize(width: z.w * cam.scale, height: z.h * cam.scale))
        let page = CGRect(origin: cam.toView(Vec2(0, 0)), size: CGSize(width: Box.screen.w * cam.scale, height: Box.screen.h * cam.scale))

        // the zone itself is chalk on the page, under the ink (TryBoard draws it); its label and the
        // pencil's nod sit over the page
        ZStack(alignment: .topLeading) {
            if board.zoneShown && board.phase != .solved {
                Text(model.copy.writeHere)
                    .dsFont(.callout, size: 16)
                    .foregroundStyle(DS.Color.inkSecondary)
                    .offset(x: zoneRect.minX + 18, y: zoneRect.maxY + 8)
                    .allowsHitTesting(false)
                PencilNudge(nudging: board.nudging && !reduceMotion)
                    .offset(x: zoneRect.minX - 64, y: zoneRect.midY - 26)
                    .opacity(board.nudging ? 1 : 0)
                    .animation(DS.Motion.fade, value: board.nudging)
                    .allowsHitTesting(false)
            }
            if let typed = board.typedAnswer {
                Text(typed)
                    .font(DS.Font.fixed(.headline, size: 54))
                    .foregroundStyle(DS.Color.ink)
                    .offset(x: zoneRect.minX + 24, y: zoneRect.midY - 34)
            }
        }
        .animation(DS.Motion.fade, value: board.zoneShown)
        .animation(reduceMotion ? nil : DS.Motion.snap, value: board.zone)

        // the message, top centre of the page
        if let m = board.message {
            Banner(m.kind, m.title, message: m.detail)
                .frame(maxWidth: 520)
                .fixedSize(horizontal: false, vertical: true)
                .frame(width: page.width)
                .offset(y: page.minY + 18)
                .transition(.move(edge: .top).combined(with: .opacity))
                .id(m.title + (m.detail ?? ""))
                .allowsHitTesting(false)
        }

        // the first star lands on the page's corner
        if board.phase == .solved, board.starLanding > 0 {
            VStack(spacing: 6) {
                Sticker(.star, size: 104, face: true, landing: board.starLanding)
                    .rotationEffect(.degrees(reduceMotion ? 0 : -8))
                Text(model.copy.firstStar)
                    .dsFont(.button, size: 17)
                    .foregroundStyle(DS.Color.ink)
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .background(Capsule().fill(DS.Color.sunny))
            }
            .offset(x: page.maxX - 190, y: page.minY + 26)
            .transition(reduceMotion ? .opacity : .scale(scale: 0.3).combined(with: .opacity))
            .accessibilityElement(children: .combine)
            .accessibilityLabel(model.copy.firstStar)
        }

        // the dock: the black pen, the eraser, undo
        VStack {
            Spacer()
            HStack(alignment: .bottom) {
                Dock {
                    ToolButton(.pen, isOn: board.controller.tool == .pen, context: .dock) { board.controller.tool = .pen }
                    ToolButton(.eraser, isOn: board.controller.tool == .eraser, context: .dock) { board.controller.tool = .eraser }
                    DockSeparator()
                    ToolButton(.undo, context: .dock) { board.controller.undo() }
                        .disabled(!board.controller.canUndo)
                }
                Spacer()
                actions(board)
            }
            .padding(16)
        }
        .frame(width: size.width, height: size.height)
        .animation(reduceMotion ? nil : DS.Motion.snap, value: board.phase)
        .animation(reduceMotion ? nil : DS.Motion.pop, value: board.starLanding)
        .animation(DS.Motion.fade, value: board.message)
    }

    @ViewBuilder private func actions(_ board: TryBoard) -> some View {
        let c = model.copy
        let triesLeft = model.state.triesLeft
        switch board.phase {
        case .solved:
            HStack(spacing: 12) {
                if triesLeft > 0 && board.canTryAnother {
                    PillButton(c.oneMore, kind: .secondaryOnPaper, size: .large) { model.oneMore(board) }
                }
                PillButton(c.next, icon: .forward, kind: .sunny, size: .large) { model.finishTry() }
            }
            .transition(.scale(scale: 0.9).combined(with: .opacity))
        case .cantCheck:
            PillButton(c.next, icon: .forward, kind: .sunny, size: .large) { model.finishTry() }
        default:
            HelpMeButton(c.helpMe) { Task { await board.help() } }
                .disabled(board.phase != .waiting)
        }
    }
}

/// A pencil in an ink circle that nods toward the zone: "write here".
private struct PencilNudge: View {
    let nudging: Bool
    @State private var tilt = false

    var body: some View {
        IconCircle(.pen, fill: .ink, diameter: 52)
            .rotationEffect(.degrees(tilt ? 18 : -6), anchor: .bottomLeading)
            .offset(x: tilt ? 6 : 0)
            .onChange(of: nudging) { _, on in
                if on {
                    withAnimation(.easeInOut(duration: 0.45).repeatForever(autoreverses: true)) { tilt = true }
                } else {
                    withAnimation(.easeOut(duration: 0.2)) { tilt = false }
                }
            }
    }
}

/// "Type it instead": a number pad whose answer goes to the same judge (engine only, no read).
struct TypeItSheet: View {
    let copy: OnboardingCopy
    let submit: (String) -> Void
    @State private var entry = ""

    var body: some View {
        VStack(spacing: 20) {
            SheetHeader(copy.typePrompt)
            Text(entry.isEmpty ? " " : entry)
                .font(DS.Font.fixed(.headline, size: 48))
                .foregroundStyle(DS.Color.ink)
                .frame(maxWidth: .infinity, minHeight: 72)
                .background(Capsule().fill(DS.Color.surfaceSunken))
                .accessibilityLabel(entry.isEmpty ? "Empty" : entry)
            Grid(horizontalSpacing: 14, verticalSpacing: 12) {
                ForEach([["1", "2", "3", "/"], ["4", "5", "6", "."], ["7", "8", "9", "-"]], id: \.self) { row in
                    GridRow { ForEach(row, id: \.self) { key($0) } }
                }
                GridRow {
                    key("x")
                    key("0")
                    key("=")
                    Button { if !entry.isEmpty { entry.removeLast() } } label: {
                        DSIcon(.delete, size: 26).frame(width: 76, height: 64)
                    }
                    .buttonStyle(.pill(.secondaryOnPaper))
                    .accessibilityLabel("Delete")
                }
            }
            PillButton(copy.check, icon: .check, kind: .sunny, size: .large) { submit(entry) }
                .disabled(entry.isEmpty)
        }
        .padding(28)
        .background(DS.Color.paper)
    }

    private func key(_ k: String) -> some View {
        Button { if entry.count < 12 { entry.append(k) } } label: {
            Text(k).font(DS.Font.fixed(.numeral, size: 28)).frame(width: 76, height: 64)
        }
        .buttonStyle(.pill(.secondaryOnPaper))
        .accessibilityLabel(k == "-" ? "minus" : k == "/" ? "over" : k == "." ? "point" : k)
    }
}

extension FlowModel {
    func keepTry(_ r: TryRecord) {
        var tries = state.answers.tries
        if let at = tries.firstIndex(where: { $0.problemId == r.problemId }) {
            tries[at] = r
        } else if tries.count < FlowRules.maxTries {
            tries.append(r)
        }
        state.answers.tries = tries
        state.keep()
    }

    func triedChecked(solved: Bool, ms: Int?) {
        state.answers = state.answers.trying(checked: true, solved: solved)
        state.keep()
        var meta: [String: AgathonKit.JSONValue] = ["solved": .bool(solved)]
        if let ms { meta["ms"] = .number(Double(min(ms, 600_000))) }
        record("start_try_checked", meta)
    }

    func oneMore(_ board: TryBoard) {
        guard state.triesLeft > 0 else { return }
        board.oneMore()
    }

    func finishTry() {
        go(.building)
    }

    func skipTry() {
        go(.building)
    }
}
