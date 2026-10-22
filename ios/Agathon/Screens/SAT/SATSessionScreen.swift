import AgathonBoard
import AgathonBoardUI
import AgathonDesign
import AgathonKit
import AgathonLive
import AgathonSAT
import AgathonStore
import AgathonSync
import SwiftUI

/// SAT practice (docs/SAT-MODE.md, "The session"): the question panel beside the real board.
///
///  - **Held sideways:** the panel on the left (about 38 %, a draggable divider, folded to a tab),
///    the board on the right.
///  - **Upright:** the panel on top (resizable the same way), the board below.
///  - The board is `BoardEditorView` with the tutor on it (Help me, the status pill, hint cards); the
///    panel and the board follow each other page for page. The end of a set covers both.
struct SATSessionScreen: View {
    @StateObject private var model: SATSessionModel
    let onClose: () -> Void

    @Environment(AgathonBackend.self) private var backend
    @Environment(PlanStore.self) private var planStore
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// the panel's share of the width (sideways) or height (upright)
    @State private var share: CGFloat = 0.38
    @State private var dragStart: CGFloat?
    @State private var collapsed = false

    init(context: SATContext, questions: [SATQuestion], onClose: @escaping () -> Void) {
        _model = StateObject(wrappedValue: SATSessionModel(context: context, questions: questions))
        self.onClose = onClose
    }

    static let shares: ClosedRange<CGFloat> = 0.28...0.6

    var body: some View {
        GeometryReader { geo in
            let sideways = geo.size.width > geo.size.height
            ZStack {
                DS.Color.ground.ignoresSafeArea()
                if sideways {
                    HStack(spacing: 0) {
                        panelArea(sideways: true, total: geo.size.width)
                        board
                    }
                } else {
                    VStack(spacing: 0) {
                        panelArea(sideways: false, total: geo.size.height)
                        board
                    }
                }
                if model.showingSummary {
                    SATSummaryView(summary: model.practice.summary(), busy: model.fetchingMore,
                                   review: { model.reviewMissed() },
                                   more: { Task { await model.more() } },
                                   home: close,
                                   open: { i in
                                       model.showingSummary = false
                                       model.practice.show(i)
                                       model.show(i)
                                   })
                    .transition(.opacity)
                    .zIndex(2)
                }
            }
            .overlay(alignment: .top) { noticeBanner }
            #if DEBUG
            .overlay(alignment: .bottomLeading) { debugProbe }
            #endif
        }
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

    // MARK: the panel

    @ViewBuilder private func panelArea(sideways: Bool, total: CGFloat) -> some View {
        if collapsed {
            collapsedTab(sideways: sideways)
        } else {
            let size = max(sideways ? 340 : 260, min(total * Self.shares.upperBound, total * share))
            Group {
                if sideways {
                    HStack(spacing: 0) {
                        panel(sideways: true).frame(width: size)
                        divider(sideways: true, total: total)
                    }
                } else {
                    VStack(spacing: 0) {
                        panel(sideways: false).frame(height: size)
                        divider(sideways: false, total: total)
                    }
                }
            }
        }
    }

    private func panel(sideways: Bool) -> some View {
        var actions = SATPanelActions()
        actions.moved = { model.show(model.practice.index) }
        actions.results = { model.showingSummary = true }
        actions.capTapped = { capTapped() }
        actions.retryTutor = { model.retryTutor() }
        actions.collapse = { withAnimation(reduceMotion ? nil : DS.Motion.snap) { collapsed = true } }
        actions.graph = { typed in await model.graph(typed) }
        actions.endReview = { model.endReview() }
        actions.close = close
        actions.beforeCheck = { model.beforeCheck() }
        return SATQuestionPanel(practice: model.practice, account: model.context.account(backend), actions: actions, collapsesUp: !sideways)
            .background(DS.Color.paper.ignoresSafeArea())
    }

    /// The draggable divider: a hairline with a grip, the whole strip a 24 pt target.
    private func divider(sideways: Bool, total: CGFloat) -> some View {
        ZStack {
            Rectangle().fill(DS.Color.line).frame(width: sideways ? 1 : nil, height: sideways ? nil : 1)
            Capsule().fill(DS.Color.inkSecondary)
                .frame(width: sideways ? 5 : 44, height: sideways ? 44 : 5)
        }
        .frame(width: sideways ? 20 : nil, height: sideways ? nil : 20)
        .frame(maxWidth: sideways ? 20 : .infinity, maxHeight: sideways ? .infinity : 20)
        .background(DS.Color.ground)
        .contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 2, coordinateSpace: .global).onChanged { g in
            let start = dragStart ?? share
            if dragStart == nil { dragStart = share }
            let moved = (sideways ? g.translation.width : g.translation.height) / max(1, total)
            share = min(Self.shares.upperBound, max(Self.shares.lowerBound, start + moved))
        }.onEnded { _ in dragStart = nil })
        .accessibilityElement()
        .accessibilityLabel("Resize the question")
        .accessibilityValue("\(Int((share * 100).rounded())) percent")
        .accessibilityAdjustableAction { dir in
            share = min(Self.shares.upperBound, max(Self.shares.lowerBound, share + (dir == .increment ? 0.05 : -0.05)))
        }
        .accessibilityIdentifier("sat.divider")
    }

    /// The panel folded: a tab at the board's edge with the question's number.
    private func collapsedTab(sideways: Bool) -> some View {
        Button {
            withAnimation(reduceMotion ? nil : DS.Motion.snap) { collapsed = false }
        } label: {
            Group {
                if sideways {
                    VStack(spacing: 10) {
                        DSIcon(.forward, size: 16)
                        Text("Q\(model.practice.item.number)").dsFont(.button, size: 16)
                    }
                    .frame(width: 56)
                    .frame(maxHeight: .infinity)
                } else {
                    HStack(spacing: 10) {
                        Text("Q\(model.practice.item.number) · \(SATCopy.showPanel)").dsFont(.button, size: 16)
                        DSIcon(.forward, size: 14).rotationEffect(.degrees(90))
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                }
            }
            .foregroundStyle(DS.Color.ink)
            .background(DS.Color.paper)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(SATCopy.showPanel)
        .accessibilityIdentifier("sat.expand")
    }

    // MARK: the board

    @ViewBuilder private var board: some View {
        switch model.phase {
        case .loading:
            ZStack {
                DS.Color.ground
                ProgressView().controlSize(.large)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let words):
            EmptyState(.icon(.offline, .sunny), title: "The board didn't open.", message: words, actionTitle: "Back", actionIcon: .back, action: close)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .ready(let session):
            SATBoardRoom(model: model, session: session, controller: session.controller)
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
                .padding(.top, DS.Space.l)
                .onTapGesture { model.notice = nil }
                .task(id: words) {
                    try? await Task.sleep(for: .seconds(5))
                    if model.notice == words { model.notice = nil }
                }
                .accessibilityIdentifier("sat.notice")
        }
    }

    #if DEBUG
    /// The UI tests' probe and their ink (a stub run only).
    @ViewBuilder private var debugProbe: some View {
        if model.context.isStub {
            HStack(spacing: 4) {
                Button("ink") { model.debugInk() }
                    .font(.system(size: 11))
                    .frame(width: 30, height: 22)
                    .accessibilityIdentifier("sat.debug.ink")
                Text(model.debugValue)
                    .font(.system(size: 1))
                    .opacity(0.01)
                    .accessibilityIdentifier("sat.debug")
                    .accessibilityValue(model.debugValue)
            }
            .opacity(SATDebug.args.contains("-satShots") ? 0.01 : 0.6)
            .padding(4)
        }
    }
    #endif
}

/// The board beside the panel: the Blocks editor with the tutor's pieces in its slots.
private struct SATBoardRoom: View {
    @ObservedObject var model: SATSessionModel
    @ObservedObject var session: BoardSession
    @ObservedObject var controller: BoardController
    @State private var popoverOpen = false

    var body: some View {
        BoardEditorView(
            controller: controller, title: "SAT practice", onBack: nil,
            onCanvas: { canvas in model.attach(canvas) },
            topTrailing: {
                HStack(spacing: DS.Space.xs) {
                    if !model.context.isStub { BoardSaveStatus(session: session, showsWords: false) }
                    // the tutor's status only while it is on for this page (off, the panel's line says why)
                    if let loop = model.tutor?.loop, model.tutorOnHere { LiveStatusView(loop: loop).fixedSize() }
                }
            },
            helpButton: {
                if let loop = model.tutor?.loop { LiveHelpBar(loop: loop) }
            },
            overlay: { _ in
                if let tutor = model.tutor {
                    LiveOverlay(loop: tutor.loop, geometry: tutor.liveBoard, onGrownUp: { model.cover = .plan },
                                onSpeak: { [weak speech = tutor.ask.speech] words in speech?.speak(text: words) }, showsOutOfInk: false)
                }
            }
        )
        .ignoresSafeArea(.keyboard)
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .onPreferenceChange(LivePopoverOpenKey.self) { popoverOpen = $0 }
        .overlay {
            if popoverOpen {
                Color.clear.contentShape(Rectangle()).ignoresSafeArea().onTapGesture {}.accessibilityHidden(true)
            }
        }
    }
}
