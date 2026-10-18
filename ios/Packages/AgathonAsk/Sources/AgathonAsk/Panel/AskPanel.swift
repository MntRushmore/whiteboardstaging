import AgathonDesign
import SwiftUI

/// Ask (docs/ASK-V2.md): a tutor to talk to beside the board. The kid types, taps a chip, or holds
/// the mic and says it; the answer streams in with its maths typeset (read aloud when the speaker
/// is on), and when it needs the board the tutor writes there in its hand. One chat per screen; the
/// header says which. The panel is its content: `AskPanelContainer` docks it or makes it a sheet.
public struct AskPanel: View {
    @ObservedObject var session: AskSession
    @ObservedObject var speech: AskSpeech
    @ObservedObject var mic: AskMic
    let onClose: (() -> Void)?

    @State private var draft = ""
    @FocusState private var typing: Bool

    public init(session: AskSession, speech: AskSpeech, mic: AskMic, onClose: (() -> Void)? = nil) {
        self.session = session
        self.speech = speech
        self.mic = mic
        self.onClose = onClose
    }

    public var body: some View {
        VStack(spacing: 0) {
            header
                .padding(.horizontal, DS.Space.l)
                .padding(.top, DS.Space.l)
                .padding(.bottom, DS.Space.s)
            thread
            composer
        }
        .background(DS.Color.surface)
        .onAppear {
            session.appeared()
            mic.onText = { said in onSpoken(said) }
            mic.onListen = { speech.stop() }
        }
        .onDisappear {
            speech.stop()
            mic.cancel()
        }
        .accessibilityIdentifier("ask.panel")
    }

    // MARK: - header

    /// `SheetHeader`'s layout, with the speaker as a toggle: sunny while it reads answers out loud.
    private var header: some View {
        HStack(alignment: .top, spacing: DS.Space.xs) {
            VStack(alignment: .leading, spacing: DS.Space.xs) {
                Text(AskCopy.title).dsFont(.headline, size: 26).foregroundStyle(DS.Color.ink)
                    .accessibilityAddTraits(.isHeader)
                if let n = session.screen.index {
                    Tag(AskCopy.screen(n), style: .chalk)
                        .accessibilityLabel(AskCopy.screenHint(n))
                }
            }
            .padding(.top, 6)
            Spacer(minLength: DS.Space.xs)
            RoundButton(.speaker, fill: speech.on ? .sunny : .chalk, diameter: 52, label: speech.on ? AskCopy.speakerOff : AskCopy.speakerOn) {
                speech.toggle()
            }
            .accessibilityIdentifier("ask.speaker")
            if let onClose {
                RoundButton(.close, fill: .chalk, diameter: 52, label: AskCopy.close) {
                    speech.stop()
                    onClose()
                }
                .accessibilityIdentifier("ask.close")
            }
        }
    }

    // MARK: - the thread

    private var thread: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: DS.Space.m) {
                    if session.messages.isEmpty {
                        helloView
                    } else {
                        ForEach(session.messages) { m in
                            AskMessageView(message: m, busy: session.busy, onRetry: { session.retry(m.id) },
                                           onReplay: m.role == .tutor ? { speech.speak(text: m.text) } : nil)
                                .id(m.id)
                        }
                    }
                }
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, DS.Space.l)
                .padding(.vertical, DS.Space.s)
            }
            .scrollDismissesKeyboard(.interactively)
            .defaultScrollAnchor(.bottom)
            // a new question and the words under it: the question stays at the top, so a long
            // answer is read from its start and never jumps to its last lines
            .onChange(of: lastQuestion) { _, id in
                guard let id else { return }
                withAnimation(DS.Motion.fade) { proxy.scrollTo(id, anchor: .top) }
            }
            .onChange(of: session.screen) { _, _ in
                if let last = session.messages.last?.id { proxy.scrollTo(last, anchor: .bottom) }
            }
        }
    }

    private var lastQuestion: String? { session.messages.last { $0.role == .user }?.id }

    @ViewBuilder
    private var helloView: some View {
        if let hello = session.hello {
            VStack(alignment: .leading, spacing: DS.Space.m) {
                RichBubble(text: hello.greeting, streaming: false)
                    .padding(.trailing, DS.Space.l)
                    .accessibilityIdentifier("ask.hello")
                FlowStack(spacing: DS.Space.xs, lineSpacing: DS.Space.xs) {
                    ForEach(hello.chips, id: \.self) { chip in
                        Chip(chip) { submit(chip) }
                            .disabled(session.busy)
                    }
                }
            }
        } else {
            // the saved chat is being read: a quiet bubble the size of a hello
            BubbleShape(from: .tutor).fill(DS.Color.surfaceSunken)
                .frame(width: 240, height: 52)
                .accessibilityHidden(true)
        }
    }

    // MARK: - the composer

    private var composer: some View {
        VStack(alignment: .leading, spacing: DS.Space.xs) {
            if let line = micLine {
                VStack(alignment: .leading, spacing: 2) {
                    Text(line.kid).dsFont(.caption).fontWeight(.medium).foregroundStyle(DS.Color.ink)
                    if let g = line.grownUp { Text(g).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary) }
                }
                .padding(.horizontal, DS.Space.s)
                .accessibilityIdentifier("ask.mic.status")
            }
            HStack(alignment: .bottom, spacing: DS.Space.xs) {
                TextField(AskCopy.placeholder, text: $draft, axis: .vertical)
                    .font(.ds(.callout))
                    .lineLimit(1...5)
                    .focused($typing)
                    .submitLabel(.send)
                    .onSubmit { submit(draft) }
                    .padding(.horizontal, DS.Space.m + 4)
                    .padding(.vertical, 15)
                    .frame(minHeight: DS.Size.round)
                    .background(RoundedRectangle(cornerRadius: DS.Size.round / 2, style: .continuous).fill(DS.Color.surfaceSunken))
                    .accessibilityLabel(AskCopy.title)
                    .accessibilityIdentifier("ask.input")
                MicButton(mic: mic, disabled: session.busy && !mic.isListening)
                if session.canStop {
                    RoundAction(systemImage: "stop.fill", fill: .ink, label: AskCopy.stop) { speech.stop(); session.stop() }
                        .accessibilityIdentifier("ask.stop")
                } else {
                    RoundAction(icon: .send, fill: canSend ? .ink : .chalk, label: AskCopy.send) { submit(draft) }
                        .disabled(!canSend)
                        .accessibilityIdentifier("ask.send")
                }
            }
        }
        .frame(maxWidth: 640)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, DS.Space.m)
        .padding(.top, DS.Space.s)
        .padding(.bottom, DS.Space.m)
        .background(DS.Color.surface)
    }

    private var canSend: Bool { !session.busy && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private var micLine: (kid: String, grownUp: String?)? {
        switch mic.phase {
        case .listening(let press):
            if let s = mic.secondsLeft { return (AskMicCopy.secondsLeft(s), nil) }
            return (press == .hold ? AskMicCopy.listeningHold : AskMicCopy.listeningTap, nil)
        case .sending: return (AskMicCopy.sending, nil)
        case .problem(let kid, let grownUp): return (kid, grownUp)
        case .idle: return nil
        }
    }

    private func submit(_ text: String) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, !session.busy else { return }
        draft = ""
        session.send(t)
    }

    /// Words said into the mic: sent as said, or — the tutor still answering — waiting in the box.
    private func onSpoken(_ said: String) {
        let next = ChatView.spokenWords(busy: session.busy, draft: draft, said: said)
        if let send = next.send {
            session.send(send, voice: true)
        } else {
            draft = next.draft
        }
    }
}

/// A round action in the composer (send, stop): 52 pt in a 56 pt target, ink when it can act.
struct RoundAction: View {
    var icon: DS.Icon?
    var systemImage: String?
    let fill: DS.Fill
    let label: String
    let action: () -> Void
    @Environment(\.isEnabled) private var enabled

    init(icon: DS.Icon? = nil, systemImage: String? = nil, fill: DS.Fill, label: String, action: @escaping () -> Void) {
        self.icon = icon
        self.systemImage = systemImage
        self.fill = fill
        self.label = label
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Group {
                if let icon { DSIcon(icon, size: 22) } else if let systemImage { Image(systemName: systemImage).font(.system(size: 17, weight: .bold)) }
            }
            .foregroundStyle(enabled ? fill.foreground.color : DS.Color.inkSecondary)
            .frame(width: 52, height: 52)
            .background(Circle().fill(fill.background.color))
            .frame(width: DS.Size.minTarget, height: DS.Size.minTarget)
            .contentShape(Circle())
        }
        .buttonStyle(PressStyle())
        .accessibilityLabel(label)
    }
}

/// Hold to talk, or tap to start and tap to send. Chalk at rest; ink while it listens, with a
/// ring that breathes (still under Reduce Motion).
struct MicButton: View {
    @ObservedObject var mic: AskMic
    let disabled: Bool
    @State private var down = false
    @State private var pulse = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let listening = mic.isListening
        ZStack {
            if listening {
                Circle().fill(DS.Color.surfaceSunken)
                    .frame(width: 52, height: 52)
                    .scaleEffect(pulse && !reduceMotion ? 1.18 : 1.05)
            }
            Circle().fill(listening ? DS.Color.ink : DS.Color.surfaceSunken)
                .frame(width: 52, height: 52)
            DSIcon(.mic, size: 22).foregroundStyle(listening ? DS.Color.onInk : (disabled ? DS.Color.inkSecondary : DS.Color.ink))
        }
        .scaleEffect(down && !reduceMotion ? DS.Motion.pressScale : 1)
        .frame(width: DS.Size.minTarget, height: DS.Size.minTarget)
        .contentShape(Circle())
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    guard !down, !disabled else { return }
                    down = true
                    mic.pressBegan()
                }
                .onEnded { _ in
                    guard down else { return }
                    down = false
                    mic.pressEnded()
                }
        )
        .onChange(of: listening) { _, on in
            pulse = false
            guard on, !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true)) { pulse = true }
        }
        .accessibilityElement()
        .accessibilityLabel(listening ? AskMicCopy.micStop : AskMicCopy.mic)
        .accessibilityHint(AskMicCopy.micHint)
        .accessibilityAddTraits(.isButton)
        .accessibilityAction {
            mic.pressBegan()
            mic.pressEnded()
        }
        .accessibilityIdentifier("ask.mic")
    }
}

/// Ask's three parts for one board: the chat, read aloud, and the mic.
@MainActor
public struct AskParts {
    public let session: AskSession
    public let speech: AskSpeech
    public let mic: AskMic

    public init(session: AskSession, speech: AskSpeech, mic: AskMic) {
        self.session = session
        self.speech = speech
        self.mic = mic
    }
}

/// The board and Ask together (`chatSheet.ts`): docked on the right when the iPad is held sideways
/// (and wide enough), a bottom sheet held upright — docked there it would leave the 16:9 board a
/// postcard. The sheet rests at 46 % and pulls up to 88 %; the board above it stays live. Without
/// Ask's parts yet (the board's canvas not up), the board alone, in the same place.
public struct AskPanelContainer<Board: View>: View {
    @Binding var isOpen: Bool
    let ask: AskParts?
    let board: Board
    @State private var tall = false

    /// The docked panel's width (the web's 360 px, grown for 17 pt type and 56 pt targets).
    public static var dockedWidth: CGFloat { 420 }

    public init(isOpen: Binding<Bool>, ask: AskParts?, @ViewBuilder board: () -> Board) {
        _isOpen = isOpen
        self.ask = ask
        self.board = board()
    }

    /// Docked when the space is wider than tall and the board keeps a sensible width beside the panel.
    public static func docks(_ size: CGSize) -> Bool {
        size.width > size.height && size.width >= 960
    }

    public var body: some View {
        GeometryReader { geo in
            let docked = Self.docks(geo.size)
            HStack(spacing: 0) {
                board
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                if docked && isOpen, let ask {
                    AskPanel(session: ask.session, speech: ask.speech, mic: ask.mic) { isOpen = false }
                        .clipShape(RoundedRectangle(cornerRadius: DS.Radius.card, style: .continuous))
                        .padding(.vertical, DS.Space.m)
                        .padding(.trailing, DS.Space.m)
                        .frame(width: Self.dockedWidth + DS.Space.m)
                        .transition(.move(edge: .trailing))
                }
            }
            .background(DS.Color.ground)
            .dsAnimation(DS.Motion.snap, value: isOpen)
            .sheet(isPresented: Binding(get: { isOpen && !docked && ask != nil }, set: { if !$0 { isOpen = false } })) {
                if let ask {
                    AskPanel(session: ask.session, speech: ask.speech, mic: ask.mic) { isOpen = false }
                        .presentationDetents([.fraction(0.46), .fraction(0.88)], selection: Binding(
                            get: { tall ? .fraction(0.88) : .fraction(0.46) },
                            set: { tall = $0 == .fraction(0.88) }))
                        .presentationBackgroundInteraction(.enabled(upThrough: .fraction(0.46)))
                        .presentationCornerRadius(DS.Radius.card)
                        .presentationDragIndicator(.visible)
                        .presentationBackground(DS.Color.surface)
                }
            }
        }
    }
}
