import AgathonBoard
import AgathonBoardUI
import AgathonDesign
import AgathonKit
import AgathonLive
import AgathonSAT
import AgathonStore
import AgathonSync
import SwiftUI

/// SAT practice, v2 (docs/SAT-V2.md, "The question is the page"; docs/sat2/DESIGN-NOTES.md): the
/// board full screen, white edge to edge, one page a question with the question printed on it. The
/// top bar ("Q4 of 10 · skill", the capped line, Mark, ‹ 4/10 ›, close) and the bottom row (Help me
/// and Check at the bottom LEFT, the pens at the bottom right: the owner, 2026-10-23) float over the
/// paper; the solution, two ways, comes up over the lower half. The status bar is hidden in a set.
struct SATSessionScreen: View {
    @StateObject private var model: SATSessionModel
    let onClose: () -> Void

    @Environment(AgathonBackend.self) private var backend
    @Environment(PlanStore.self) private var planStore
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(context: SATContext, questions: [SATQuestion], onClose: @escaping () -> Void) {
        _model = StateObject(wrappedValue: SATSessionModel(context: context, questions: questions))
        self.onClose = onClose
    }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                DS.Color.paper.ignoresSafeArea()
                board(size: geo.size)
                if model.showingSummary {
                    SATSummaryView(summary: model.practice.summary(), busy: model.fetchingMore,
                                   review: { model.reviewMissed() },
                                   more: { Task { await model.more() } },
                                   home: close,
                                   open: { i in
                                       model.showingSummary = false
                                       model.show(i)
                                   })
                    .transition(.opacity)
                    .zIndex(3)
                }
            }
            .overlay(alignment: .top) { noticeBanner }
            .onAppear { model.windowChanged(geo.size) }
            .onChange(of: geo.size) { _, size in model.windowChanged(size) }
        }
        .ignoresSafeArea()
        .statusBarHidden(true)
        .animation(reduceMotion ? nil : DS.Motion.fade, value: model.showingSummary)
        .task { await model.open(backend: backend) }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { model.leavingScreen() } else if phase == .active { model.back() }
        }
        .onDisappear { model.close() }
        .fullScreenCover(item: $model.cover, onDismiss: { model.capLifted() }) { cover in
            coverView(cover)
                .environment(backend)
                .environment(planStore)
        }
    }

    private func close() {
        model.close()
        onClose()
    }

    @ViewBuilder private func board(size: CGSize) -> some View {
        switch model.phase {
        case .loading:
            ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let words):
            EmptyState(.icon(.offline, .sunny), title: "The board didn't open.", message: words, actionTitle: "Back", actionIcon: .back, action: close)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .ready(let session):
            SATBoardRoom(model: model, session: session, controller: session.controller, practice: model.practice, size: size, close: close,
                         capTapped: capTapped)
        }
    }

    // MARK: covers

    private func capTapped() {
        switch model.context.account(backend) {
        case .none: model.cover = .account
        case .free, .unlimited: model.cover = .plan
        }
    }

    @ViewBuilder private func coverView(_ cover: SATSessionModel.Cover) -> some View {
        switch cover {
        case .plan:
            GrownUpPlanFlow { model.cover = nil }
        case .outOfInk:
            OutOfInkView(audience: .kid, onClose: { model.cover = nil })
        case .account:
            SATAccountFlow(onDone: { model.cover = nil }, onUnder13: { model.cover = nil })
        }
    }

    @ViewBuilder private var noticeBanner: some View {
        if let words = model.notice {
            Banner(.tutor, words, surface: .ink)
                .frame(maxWidth: 560)
                .padding(.top, 84)
                .onTapGesture { model.notice = nil }
                .task(id: words) {
                    try? await Task.sleep(for: .seconds(5))
                    if model.notice == words { model.notice = nil }
                }
                .accessibilityIdentifier("sat.notice")
        }
    }
}

/// The board and everything over it.
private struct SATBoardRoom: View {
    @ObservedObject var model: SATSessionModel
    @ObservedObject var session: BoardSession
    @ObservedObject var controller: BoardController
    let practice: SATPractice
    let size: CGSize
    let close: () -> Void
    let capTapped: () -> Void
    @State private var popoverOpen = false
    @State private var graphOpen = false

    /// Upright, the page sits a little lower so the question never goes under the top bar.
    private var topInset: Double { SATSessionModel.topInset(width: size.width) }

    var body: some View {
        ZStack {
            BoardEditorView(
                controller: controller, title: "SAT practice", onBack: nil,
                onCanvas: { canvas in model.attach(canvas) },
                chrome: false,
                bareInsets: CameraConstraints(top: topInset, left: 0, bottom: 0, right: 0, fitsWidth: true),
                appearance: .printedPage,
                topTrailing: { EmptyView() },
                helpButton: { EmptyView() },
                overlay: { viewport in
                    ZStack {
                        if let tutor = model.tutor {
                            // (on an SAT page the tutor's own Check / Next corner never shows: LivePages)
                            LiveOverlay(loop: tutor.loop, geometry: tutor.liveBoard, onGrownUp: { model.cover = .plan },
                                        onSpeak: nil, showsOutOfInk: false)
                        }
                        SATPageLayer(model: model, practice: practice, viewport: viewport)
                    }
                }
            )
            .ignoresSafeArea(.keyboard)
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            .onPreferenceChange(LivePopoverOpenKey.self) { popoverOpen = $0 }
            chrome
            if model.solutionOpen, let q = practice.current {
                VStack(spacing: 0) {
                    Spacer(minLength: 0)
                    SATSolutionSheet(question: q, right: { if case .right = practice.item.verdict { return true } else { return false } }(),
                                     sideBySide: size.width > size.height,
                                     nextTitle: practice.isLastInSet || practice.setDone ? SATCopy.seeResults : SATCopy.nextQuestion,
                                     back: { model.solutionOpen = false }, next: { model.afterCheck() })
                        .frame(height: max(420, size.height - (size.width > size.height ? 504 : size.height * 0.5)))
                }
                .ignoresSafeArea(edges: .bottom)
                .transition(.move(edge: .bottom))
                .zIndex(2)
            }
        }
        .overlay {
            if popoverOpen {
                Color.clear.contentShape(Rectangle()).ignoresSafeArea().onTapGesture {}.accessibilityHidden(true)
            }
        }
        #if DEBUG
        .overlay(alignment: .bottomLeading) { SATDebugProbe(model: model) }
        #endif
    }

    // MARK: chrome

    private var chrome: some View {
        VStack(spacing: 0) {
            SATTopBar(model: topModel, close: close, mark: { practice.toggleMarked(); model.objectWillChange.send() },
                      previous: { model.previous() }, next: { model.next() }, capTapped: capTapped)
            Spacer(minLength: 0)
            HStack(alignment: .center, spacing: SATChromeSize.gap) {
                SATHelpButton(used: practice.item.ladder.reached?.rawValue) { model.helpMe() }
                checkOrWalk
                Spacer(minLength: 12)
                SATDock(controller: controller, compact: size.width < 1100) { graphOpen = true }
                    .popover(isPresented: $graphOpen, arrowEdge: .bottom) {
                        SATGraphField { typed in await model.graph(typed) }
                            .presentationCompactAdaptation(.popover)
                    }
            }
            .padding(.horizontal, SATChromeSize.edge)
            .padding(.bottom, 19)
        }
        // the chrome never widens the board (a row too wide for the window squeezes, it doesn't push)
        .frame(width: size.width, height: size.height)
    }

    @ViewBuilder private var checkOrWalk: some View {
        let item = practice.item
        if let w = model.walk, w.question == practice.index {
            SATWalkPill(step: w.shown, count: w.count) { model.goOnWalk() }
        } else if item.verdict.isLocked {
            if practice.reviewing != nil {
                SATCheckButton(title: SATCopy.endReview, enabled: true, icon: .forward, id: "sat.endReview") { model.endReview() }
            } else {
                SATCheckButton(title: practice.isLastInSet || practice.setDone ? SATCopy.seeResults : SATCopy.nextShort, enabled: true, icon: .forward,
                               id: practice.isLastInSet || practice.setDone ? "sat.results" : "sat.nextQuestion") { model.afterCheck() }
            }
        } else {
            SATCheckButton(title: SATCopy.checkShort, enabled: practice.answerNow != nil && !practice.answerAlreadyTried) { model.check() }
        }
    }

    private var topModel: SATTopBar.Model {
        let item = practice.item
        let title: String
        if let list = practice.reviewing, let k = list.firstIndex(of: practice.index) {
            title = SATCopy.reviewing(k + 1, list.count)
        } else {
            title = SATCopy.questionShort(item.number, item.count)
        }
        return SATTopBar.Model(title: title, skill: practice.current.map(\.skillTitle) ?? "",
                               review: practice.current?.review ?? false, marked: item.marked,
                               position: "\(item.number)/\(item.count)", hasPrevious: practice.hasPrevious, hasNext: practice.hasNext,
                               capped: model.cappedLine)
    }
}

/// Over the page, following the camera: the answer row's targets (the cards, the eliminators, the
/// grid-in's field and keys), the tutor's words, the nudge, the wrong-answer note, and the
/// walk-through's tap to go on.
private struct SATPageLayer: View {
    @ObservedObject var model: SATSessionModel
    let practice: SATPractice
    @ObservedObject var viewport: BoardViewport

    private var k: CGFloat { CGFloat(viewport.camera.scale) }

    private func rect(_ r: SATRect) -> CGRect { viewport.toView(Box(x: r.x, y: r.y, w: r.w, h: r.h)) }

    var body: some View {
        let screen = model.phase.session?.controller.currentScreenID
        // over a flexible clear base: what is placed past the edge never sizes the layer (nor, with
        // it, the board's ZStack, the canvas and the camera's fit)
        Color.clear.allowsHitTesting(false).overlay(alignment: .topLeading) { ZStack(alignment: .topLeading) {
            if let layout = model.layoutHere, let q = practice.current {
                ForEach(model.words.filter { $0.screen == screen }) { w in
                    let at = viewport.toView(w.at)
                    SATPageWords(w.kind, text: w.text, k: k)
                        .alignmentGuide(.leading) { _ in -at.x }
                        .alignmentGuide(.top) { _ in -at.y }
                        .allowsHitTesting(false)
                }
                if let n = model.nudge, n.screen == screen {
                    let at = viewport.toView(n.at)
                    SATNudgeNote(text: n.text, k: k)
                        .alignmentGuide(.leading) { _ in -at.x }
                        .alignmentGuide(.top) { _ in -at.y }
                        .onTapGesture { model.dismissNudge() }
                }
                answerTargets(layout, q)
                if model.showsWrongNote { wrongNote(layout, q) }
                if model.ladderCard {
                    // over Help me (bottom left), clear of the answer row
                    let rowTop = viewport.toView(Vec2(0, layout.rowTop)).y
                    SATLadderCard { model.ladderCard = false }
                        .alignmentGuide(.leading) { _ in -SATChromeSize.edge }
                        .alignmentGuide(.top) { d in -(rowTop - 20 - d.height) }
                        .transition(.opacity)
                }
            }
        } }
        .clipped()
        .id(model.layoutTick)
    }

    // MARK: the answer row

    @ViewBuilder private func answerTargets(_ layout: SATPageLayout, _ q: SATQuestion) -> some View {
        let item = practice.item
        ForEach(layout.cards, id: \.key) { card in
            let look = SATCardLook.of(card.key, q, item)
            let f = rect(card.frame), s = rect(card.strike)
            target(CGRect(x: f.minX, y: f.minY, width: s.minX - f.minX, height: f.height), id: "sat.choice.\(card.key)",
                   label: "\(card.key). \(SATRichText.plain(q.choices?.first { $0.key == card.key }?.text ?? ""))", value: look.spoken,
                   enabled: !item.verdict.isLocked) { model.tapCard(card.key, strike: false) }
            if !item.verdict.isLocked && look != .tried {
                target(s, id: "sat.strike.\(card.key)", label: look == .struck ? "\(SATCopy.restore) \(card.key)" : "\(SATCopy.strike) \(card.key)",
                       value: "", enabled: true) { model.tapCard(card.key, strike: true) }
            }
        }
        if let field = layout.gridIn {
            target(rect(field), id: "sat.gridin", label: SATCopy.gridInLabel, value: item.typed.isEmpty ? "Empty" : item.typed,
                   enabled: !item.verdict.isLocked) { model.focusGridIn() }
            if !item.verdict.isLocked {
                ForEach(layout.keys, id: \.key) { key in
                    target(rect(key.frame), id: "sat.key.\(Self.keyId(key.key))", label: Self.keySpoken(key.key), value: "", enabled: true) {
                        model.press(key.key)
                    }
                }
            }
        }
    }

    private func target(_ r: CGRect, id: String, label: String, value: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Color.clear.frame(width: max(1, r.width), height: max(1, r.height)).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityLabel(label)
        .accessibilityValue(value)
        .accessibilityIdentifier(id)
        .alignmentGuide(.leading) { _ in -r.minX }
        .alignmentGuide(.top) { _ in -r.minY }
    }

    static func keyId(_ key: SATGridIn.Key) -> String {
        switch key {
        case .digit(let d): "\(d)"
        case .point: "point"
        case .slash: "slash"
        case .minus: "minus"
        case .delete: "delete"
        case .clear: "clear"
        }
    }

    static func keySpoken(_ key: SATGridIn.Key) -> String {
        switch key {
        case .digit(let d): "\(d)"
        case .point: "Decimal point"
        case .slash: "Fraction bar"
        case .minus: "Minus"
        case .delete: "Delete"
        case .clear: "Clear"
        }
    }

    // MARK: the wrong-answer note

    /// Above the chosen card (left edge on its left, 24 above the row), or over the grid-in's field.
    @ViewBuilder private func wrongNote(_ layout: SATPageLayout, _ q: SATQuestion) -> some View {
        let item = practice.item
        let anchor: SATRect? = layout.cards.first { $0.key == item.chosen }?.frame ?? layout.gridIn
        if let a = anchor {
            let width = SATWrongNote.width * k
            let left = min(rect(a).minX, max(16, viewport.viewSize.width - width - 16))
            let bottom = rect(SATRect(a.x, layout.rowTop, a.w, 0)).minY - 24 * k - (layout.gridIn != nil ? 16 * k : 0)
            SATWrongNote(label: q.format == .mcq ? SATCopy.youPicked(item.chosen ?? "") : SATCopy.youTyped(SATGridIn.display(item.typed)),
                         why: item.wrongNote?.why, k: k,
                         tryAgain: { model.tryAgain() }, walk: { model.startWalk(practice.index) })
                .alignmentGuide(.leading) { _ in -left }
                .alignmentGuide(.top) { d in -(bottom - d.height) }
        }
    }
}

/// "Graph an equation" from the dock: typed, onto the question's plane when it has one.
private struct SATGraphField: View {
    let run: (String) async -> String?
    @State private var text = ""
    @State private var note: String?
    @State private var busy = false
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.xs) {
            Text(SATCopy.graphTitle).dsFont(.label).foregroundStyle(DS.Color.inkSecondary)
            HStack(spacing: DS.Space.xs) {
                TextField(SATCopy.graphPlaceholder, text: $text)
                    .font(DS.Font.fixed(.callout, size: 17))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.numbersAndPunctuation)
                    .focused($focused)
                    .submitLabel(.go)
                    .onSubmit(go)
                    .padding(.horizontal, 16)
                    .frame(height: 48)
                    .background(Capsule().fill(DS.Color.surfaceSunken))
                    .accessibilityIdentifier("sat.graph.field")
                PillButton(busy ? "…" : SATCopy.graphButton, kind: .primary, action: go)
                    .fixedSize()
                    .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty || busy)
                    .accessibilityIdentifier("sat.graph.go")
            }
            if let note {
                Text(note).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary).accessibilityIdentifier("sat.graph.note")
            }
        }
        .padding(DS.Space.m)
        .frame(width: 420)
        .onAppear { focused = true }
    }

    private func go() {
        let typed = text.trimmingCharacters(in: .whitespaces)
        guard !typed.isEmpty, !busy else { return }
        busy = true
        Task { @MainActor in
            let why = await run(typed)
            busy = false
            note = why ?? SATCopy.graphDone
            if why == nil { text = "" }
        }
    }
}

#if DEBUG
/// The UI tests' probe and their ink (a stub or live run only).
private struct SATDebugProbe: View {
    @ObservedObject var model: SATSessionModel
    @State private var writing = false

    /// White on the white page in the screenshots (a faded button stops taking taps, and the tap
    /// lands on the board as a dot of ink); grey otherwise.
    private func button(_ title: String, id: String, action: @escaping () -> Void) -> some View {
        let shots = SATDebug.args.contains("-satShots")
        return Button(action: action) {
            Text(title).font(.system(size: 11)).foregroundStyle(shots ? Color.white : Color.gray)
                .frame(width: 28, height: 22).background(Color.white).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }

    var body: some View {
        if model.context.isStub || SATDebug.isLive {
            TimelineView(.periodic(from: .now, by: 0.5)) { _ in
                HStack(spacing: 4) {
                    button("ink", id: "sat.debug.ink") { model.debugInk() }
                    button("o", id: "sat.debug.circle") { model.debugCircle(x: SATDebug.circleAt.x, y: SATDebug.circleAt.y) }
                    button("w", id: "sat.debug.write") {
                        guard !writing else { return }
                        writing = true
                        Task { @MainActor in
                            await SATAutowriter.writeNext(model)
                            writing = false
                        }
                    }
                    .accessibilityValue(writing ? "busy" : "\(SATAutowriter.progress.next)")
                    Text(model.debugValue)
                        .font(.system(size: 1))
                        .opacity(0.01)
                        .accessibilityIdentifier("sat.debug")
                        .accessibilityValue(model.debugValue)
                }
            }
            .padding(.leading, 240)
            .padding(.bottom, 2)
        }
    }
}
#endif
