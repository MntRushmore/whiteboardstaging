import AgathonAsk
import AgathonBoard
import AgathonBoardUI
import AgathonDesign
import AgathonKit
import AgathonLive
import AgathonStore
import AgathonSync
import SwiftUI

/// A board, full screen: the Blocks editor (AgathonBoardUI), saved as the kid works (AgathonSync),
/// the tutor on it (AgathonLive: ticks, rings, hints, Help me, Now you try) and Ask beside it
/// (AgathonAsk: docked held sideways, a sheet held upright). Top bar: back, the name and page, then
/// where the work is (saved, saving, offline), what the tutor is doing, the grown-ups' help settings
/// and Ask. Out of ink covers it with the out-of-ink screen (a kid is sent to a grown-up; a
/// grown-up is offered the plan behind the gate).
struct BoardScreen: View {
    let request: OpenBoard

    @Environment(AgathonBackend.self) private var backend
    @Environment(PlanStore.self) private var planStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var model = BoardScreenModel()

    var body: some View {
        ZStack {
            DS.Color.ground.ignoresSafeArea()
            switch model.phase {
            case .loading:
                BoardLoadingView()
                waitingBar
            case .failed(let failure):
                failed(failure)
                waitingBar
            case .ready(let session):
                BoardRoom(model: model, session: session, controller: session.controller, title: request.board.title, close: close)
            }
        }
        .task { await model.open(request, backend: backend) }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { model.leavingScreen() }
        }
        .onDisappear { model.close() }
        .fullScreenCover(item: $model.money) { screen in
            moneyScreen(screen)
                .environment(backend)
                .environment(planStore)
        }
    }

    /// Back and the name while the board opens (or didn't).
    private var waitingBar: some View {
        VStack {
            HStack(spacing: DS.Space.s) {
                RoundButton(.back, label: "Back to my boards", action: close)
                    .accessibilityIdentifier("board.back")
                BoardTitle(title: request.board.title, subtitle: nil)
                Spacer()
            }
            Spacer()
        }
        .padding(.horizontal, DS.Space.l)
        .padding(.top, DS.Space.s)
    }

    private func failed(_ failure: BoardPreviewModel.Failure) -> some View {
        EmptyState(.icon(failure.icon, .sunny), title: failure.title, message: failure.message,
                   actionTitle: failure.retry ? "Try again" : "Back to my boards", actionIcon: failure.retry ? .retry : .back) {
            if failure.retry {
                Task { await model.openSession() }
            } else {
                close()
            }
        }
        .accessibilityIdentifier("board.error")
    }

    @ViewBuilder private func moneyScreen(_ screen: BoardScreenModel.MoneyScreen) -> some View {
        switch screen {
        case .outOfInk:
            OutOfInkView(audience: model.audience?.isKid == false ? .grownUp : .kid,
                         onSeePlan: { model.money = .plan },
                         onClose: { model.money = nil })
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("board.outOfInk")
        case .plan:
            GrownUpPlanFlow { model.money = nil }
        }
    }

    private func close() {
        model.close()
        dismiss()
    }
}

// MARK: - The open board

private struct BoardRoom: View {
    @ObservedObject var model: BoardScreenModel
    @ObservedObject var session: BoardSession
    @ObservedObject var controller: BoardController
    let title: String
    let close: () -> Void

    var body: some View {
        AskPanelContainer(isOpen: $model.askOpen, ask: model.tutor?.ask) {
            BoardEditorView(
                controller: controller, title: title, onBack: close,
                onCanvas: { canvas in model.attach(canvas) },
                topTrailing: { BoardTopTrailing(model: model, session: session) },
                helpButton: {
                    if let loop = model.tutor?.loop { LiveHelpBar(loop: loop) }
                },
                overlay: { _ in overlay }
            )
            // the keyboard (typing to Ask) never squeezes the board; Ask's panel keeps its box above it
            .ignoresSafeArea(.keyboard)
            // the board's chrome (its bars, the dock, Help me, the tutor's cards) grows with the text
            // size up to the largest standard one: at the accessibility sizes the cards and buttons
            // would leave the screen. Ask's panel, where the reading is, keeps every size.
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        }
        .overlay(alignment: .top) { noticeBanner }
        #if DEBUG
        .overlay(alignment: .bottomLeading) { BoardDebugProbe(model: model) }
        #endif
    }

    @ViewBuilder private var overlay: some View {
        if let tutor = model.tutor {
            LiveOverlay(loop: tutor.loop, geometry: tutor.liveBoard,
                        onGrownUp: { model.money = model.audience?.isKid == false ? .plan : .outOfInk },
                        onSpeak: { [weak speech = tutor.ask.speech] words in speech?.speak(text: words) },
                        showsOutOfInk: false)
        }
    }

    /// Work put back from this iPad's backup, a board nearly full: a word under the top bar.
    @ViewBuilder private var noticeBanner: some View {
        if let words = model.notice {
            Banner(.tutor, words, surface: .ink)
                .frame(maxWidth: 560)
                .padding(.top, 84)
                .padding(.horizontal, DS.Space.l)
                .transition(.opacity)
                .onTapGesture { model.dismissNotice() }
                .accessibilityIdentifier("board.notice")
        }
    }
}

/// The top bar's right side: where the work is, what the tutor is doing, the grown-ups' help settings
/// and Ask. Narrower windows (Split View, the Ask panel docked) keep the icons and drop the words.
private struct BoardTopTrailing: View {
    @ObservedObject var model: BoardScreenModel
    @ObservedObject var session: BoardSession

    var body: some View {
        HStack(spacing: DS.Space.xs) {
            #if DEBUG
            // in the editor's own bar (an overlay over the board took no XCUITest taps: see the report)
            BoardAutowriteButton(model: model)
            #endif
            ViewThatFits(in: .horizontal) {
                row(words: true)
                row(words: false)
                compact
                // the narrowest windows: where the work is, and Ask (the grown-ups' settings wait for a wider one)
                HStack(spacing: DS.Space.xs) {
                    BoardSaveStatus(session: session, showsWords: false)
                    askButton(words: false)
                }
            }
        }
    }

    private func row(words: Bool) -> some View {
        HStack(spacing: DS.Space.xs) {
            if let daily = model.daily {
                DailyPracticePill(daily: daily) { model.say(DailyPracticePill.reachedWords) }
            }
            BoardSaveStatus(session: session, showsWords: words)
            if let loop = model.tutor?.loop {
                LiveStatusView(loop: loop).fixedSize()
                GrownUpLiveButton(loop: loop)
            }
            askButton(words: words)
        }
    }

    /// The narrowest: the save dot, the tutor's status and Ask.
    private var compact: some View {
        HStack(spacing: DS.Space.xs) {
            BoardSaveStatus(session: session, showsWords: false)
            if let loop = model.tutor?.loop { GrownUpLiveButton(loop: loop) }
            askButton(words: false)
        }
    }

    @ViewBuilder private func askButton(words: Bool) -> some View {
        if model.tutor != nil && !model.askOpen {
            Group {
                if words {
                    PillButton(AskCopy.button, icon: .chat, kind: .primary) { model.askOpen = true }
                        .fixedSize()
                } else {
                    RoundButton(.chat, fill: .ink, label: AskCopy.title) { model.askOpen = true }
                }
            }
            .accessibilityLabel(AskCopy.title)
            .accessibilityIdentifier("ask.open")
        }
    }
}

// MARK: - Today's practice

/// Today's practice on its board: how many of the day's problems are finished, with a star for each
/// solved alone (AgathonLive's `DailyPractice`, saved to the day's row as it goes). Reaching the goal
/// says so once.
struct DailyPracticePill: View {
    @ObservedObject var daily: DailyPractice
    let onReached: () -> Void

    static let reachedWords = "That's today's practice done. Nice work."

    var body: some View {
        let done = min(daily.done, daily.goal)
        HStack(spacing: 6) {
            DSIcon(.star, size: 16)
                .foregroundStyle(daily.stars > 0 ? DS.Color.sunny : DS.Color.inkSecondary)
            Text("\(done) of \(daily.goal)")
                .dsFont(.button, size: 15)
                .foregroundStyle(DS.Color.ink)
                .monospacedDigit()
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 40)
        .background(Capsule().fill(DS.Color.surface))
        .fixedSize()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Today's practice: \(done) of \(daily.goal) done, \(daily.stars) \(daily.stars == 1 ? "star" : "stars")")
        .accessibilityValue("\(done)/\(daily.goal) stars \(daily.stars)")
        .accessibilityIdentifier("board.daily")
        .onChange(of: daily.reachedNow) { _, now in
            guard now else { return }
            onReached()
            daily.celebrated()
        }
    }
}

// MARK: - Saving

/// Where the kid's work is, in a small pill: saved; saving (only once it takes a moment, so a stroke
/// never makes it flicker); offline (kept on this iPad, saved when the Wi-Fi is back); couldn't save
/// (trying again, with Try now); the board is full; "Not saved yet" only when this server can't hold
/// the board at all.
struct BoardSaveStatus: View {
    @ObservedObject var session: BoardSession
    var showsWords = true
    /// what shows: a save in progress is shown only after `busyDelay`
    @State private var shown: SyncState.Status = .saved
    @State private var pendingBusy: Task<Void, Never>?

    static let busyDelay: Duration = .milliseconds(1200)

    var body: some View {
        let look = Self.look(shown, message: session.sync.message)
        HStack(spacing: 8) {
            HStack(spacing: 8) {
                Group {
                    if let icon = look.icon {
                        DSIcon(icon, size: 15)
                    } else {
                        Circle().frame(width: 9, height: 9)
                    }
                }
                .foregroundStyle(look.tint)
                .frame(width: 18, height: 18)
                if showsWords || look.alwaysWords {
                    Text(look.words)
                        .dsFont(.button, size: 15)
                        .foregroundStyle(DS.Color.ink)
                        .lineLimit(1)
                        .fixedSize()
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(look.spoken)
            .accessibilityValue(Self.detail(session))
            .accessibilityIdentifier("board.status")
            if look.retry {
                Button { Task { await session.retry() } } label: {
                    Text("Try now")
                        .dsFont(.button, size: 15)
                        .foregroundStyle(DS.Color.onInk)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 32)
                        .background(Capsule().fill(DS.Color.ink))
                        .frame(minHeight: DS.Size.minTarget)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Try saving now")
                .accessibilityIdentifier("board.retry")
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, look.retry ? 4 : 14)
        .frame(minHeight: 40)
        .background(Capsule().fill(DS.Color.surface))
        .fixedSize()
        .onAppear { shown = session.sync.status }
        .onChange(of: session.sync.status) { _, now in update(now) }
    }

    private func update(_ now: SyncState.Status) {
        pendingBusy?.cancel()
        switch now {
        case .dirty, .saving, .merging:
            // a save that lands quickly is never shown: no flicker on every stroke
            guard shown == .saved else { shown = .saving; return }
            pendingBusy = Task { @MainActor in
                try? await Task.sleep(for: Self.busyDelay)
                guard !Task.isCancelled else { return }
                shown = .saving
            }
        default:
            shown = now
        }
    }

    struct Look: Equatable {
        var words: String
        var spoken: String
        var icon: DS.Icon?
        var tint: Color
        var retry = false
        var alwaysWords = false
    }

    static func look(_ status: SyncState.Status, message: String?) -> Look {
        switch status {
        case .saved:
            return Look(words: "Saved", spoken: "Your work is saved", icon: .check, tint: DS.Color.success)
        case .dirty, .saving, .merging:
            return Look(words: "Saving…", spoken: "Saving your work", icon: nil, tint: DS.Color.inkSecondary)
        case .offline:
            return Look(words: "Offline · kept on this iPad", spoken: SaveCopy.offline, icon: .offline, tint: DS.Color.inkSecondary)
        case .error:
            return Look(words: "Couldn't save", spoken: message ?? SaveCopy.saveFailed, icon: .lookAgain, tint: DS.Color.ink, retry: true)
        case .refused:
            return Look(words: "Board full", spoken: message ?? SaveCopy.boardFull, icon: .pause, tint: DS.Color.ink, alwaysWords: true)
        case .localOnly:
            return Look(words: "Not saved yet", spoken: SaveCopy.notSavedYet, icon: .notSaved, tint: DS.Color.inkSecondary, alwaysWords: true)
        }
    }

    /// For tests and VoiceOver's detail: the status, the version, where the board came from.
    static func detail(_ session: BoardSession) -> String {
        let s = session.sync
        var parts = [s.status.rawValue]
        if let v = s.version { parts.append("v\(v)") }
        if session.source == .converted { parts.append("converted") }
        if s.lastSavedAt != nil { parts.append("written") }
        return parts.joined(separator: " ")
    }
}
