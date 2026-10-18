import AgathonDesign
import AgathonKit
import SwiftUI

/// The iPad app's first run (docs/ONBOARDING.md): hello → name → grade → tricky → hand to the kid →
/// the try → the beat → the plan → hand back → the gate → the account → Apple's trial → the PIN →
/// the kid's picture → the first board.
///
/// ```swift
/// // RootView, signed out on a fresh iPad:
/// if OnboardingState.needsOnboarding {
///     OnboardingFlow { outcome in … }      // trial: StoreTrialOffering(store) once AgathonStore lands
/// }
/// ```
///
/// Reads `AgathonBackend` from the environment, as every screen does. Seams: `trial` (StoreKit;
/// `StubTrialOffering` until AgathonStore is merged), `gate` (BILLING's parental gate when merged),
/// `tryChecker` (the pre-account route today; AgathonLive later).
public struct OnboardingFlow: View {
    let trial: any TrialOffering
    let gate: any ParentalGate
    let tryChecker: (any TryItChecking)?
    let backendOverride: (any OnboardingBackend)?
    let onFinish: (OnboardingOutcome) -> Void

    @Environment(AgathonBackend.self) private var backend

    public init(trial: any TrialOffering = StubTrialOffering(), gate: any ParentalGate = BirthYearGate(),
                tryChecker: (any TryItChecking)? = nil, onFinish: @escaping (OnboardingOutcome) -> Void) {
        self.trial = trial
        self.gate = gate
        self.tryChecker = tryChecker
        backendOverride = nil
        self.onFinish = onFinish
    }

    /// With a backend of the caller's (tests, previews).
    public init(backend: any OnboardingBackend, trial: any TrialOffering = StubTrialOffering(), gate: any ParentalGate = BirthYearGate(),
                onFinish: @escaping (OnboardingOutcome) -> Void) {
        self.trial = trial
        self.gate = gate
        tryChecker = nil
        backendOverride = backend
        self.onFinish = onFinish
    }

    public var body: some View {
        FlowHost(make: {
            let b = backendOverride ?? LiveOnboardingBackend(backend: backend, tryChecker: tryChecker)
            let state = OnboardingState(signedIn: b.isSignedIn)
            return FlowModel(state: state, backend: b, trial: trial, gate: gate, onFinish: onFinish)
        })
    }
}

/// Holds the model for the life of the flow.
struct FlowHost: View {
    @State private var model: FlowModel?
    let make: () -> FlowModel

    var body: some View {
        Group {
            if let model { FlowStage(model: model) } else { DS.Color.ground }
        }
        .onAppear { if model == nil { model = make() } }
    }
}

/// The stage every screen plays on: the ground, the screen, the speaker and its bubble, the bar.
struct FlowStage: View {
    @Bindable var model: FlowModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        GeometryReader { geo in
            let layout = StageLayout(size: geo.size, safe: geo.safeAreaInsets, compact: sizeClass == .compact)
            ZStack(alignment: .topLeading) {
                ground.ignoresSafeArea()
                    .animation(.easeInOut(duration: 0.22), value: model.shown)

                screen(layout)
                    .environment(\.revealed, model.revealed)
                    .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)

                speaker(layout)

                if showsBar {
                    TopBar(
                        onBack: model.canGoBack ? { model.back() } : nil,
                        trail: model.trail,
                        trailLabel: model.trailLabel,
                        onSkip: skip,
                        skipTitle: model.copy.skip,
                        onRead: readsAloud ? { model.readAloud(extra: screenWords) } : nil,
                        tint: DS.Color.ink,
                        fill: .paper
                    )
                    .padding(.horizontal, layout.margin)
                    .padding(.top, layout.barTop)
                    .animation(DS.Motion.fade, value: model.shown)
                }
            }
        }
        .onAppear {
            model.reduceMotion = reduceMotion
            model.start()
        }
        .onChange(of: reduceMotion) { _, now in model.reduceMotion = now }
    }

    // MARK: ground

    private var ground: Color {
        switch model.shown {
        case .handToKid: DS.Color.sunny
        case .handBack, .handOver, .gate: DS.Color.ink
        default: DS.Color.ground
        }
    }

    private var showsBar: Bool {
        switch model.shown {
        case .handToKid, .tryIt, .handBack, .handOver, .gate, .building, .firstBoard: false
        default: true
        }
    }

    private var readsAloud: Bool {
        switch model.shown {
        case .hello, .name, .grade, .tricky, .plan, .waiting, .kidProfile: true
        default: false
        }
    }

    private var skip: (() -> Void)? {
        switch model.shown {
        case .name: { model.skipName() }
        default: nil
        }
    }

    /// The screen's words for the speaker button, after the question.
    private var screenWords: [String] {
        let c = model.copy
        switch model.shown {
        case .hello: return [c.hello.lede, "\(c.hello.grownUpSmall) \(c.hello.grownUpBig).", "\(c.hello.kidSmall) \(c.hello.kidBig)."]
        case .name: return [c.nameLede]
        case .grade: return [c.gradeLede]
        case .tricky:
            let names = Plan.focusOptions(model.answers.choice).map { OnboardingCatalog.shared.words($0).name }
            return [c.trickyLede] + names + [c.notSure]
        case .plan: return [c.planLede]
        case .waiting: return [c.waitingLede]
        case .kidProfile: return [c.pictureLede]
        default: return []
        }
    }

    // MARK: the speaker

    @ViewBuilder private func speaker(_ layout: StageLayout) -> some View {
        let mode = model.speaker
        let centre = mode == .centre
        let width: CGFloat = centre ? layout.centreSpeakerWidth : layout.dockSpeakerWidth
        let height = width / TheShapes.aspectRatio
        let origin = centre ? layout.centreSpeakerOrigin(width: width, step: model.shown) : layout.dockOrigin
        let bubbleShown = model.typed > 0 && mode != .hidden

        ZStack(alignment: .topLeading) {
            TheShapes(model.pose)
                .frame(width: width, height: height)
                .offset(x: origin.x, y: origin.y)
                .opacity(mode == .hidden ? 0 : 1)
                .scaleEffect(mode == .hidden ? 0.8 : 1, anchor: .topLeading)

            if bubbleShown {
                SpeechBubble(lead: model.bubbleLead, text: model.bubbleText, shown: model.typed, tail: centre ? .bottom : .leading)
                    .frame(maxWidth: centre ? layout.centreBubbleMax : layout.dockBubbleMax, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .modifier(BubblePlacement(centre: centre, speakerOrigin: origin, speakerSize: CGSize(width: width, height: height), layout: layout))
                    .transition(.asymmetric(insertion: .scale(scale: 0.85, anchor: centre ? .bottom : .leading).combined(with: .opacity),
                                            removal: .opacity))
            }
        }
        .animation(reduceMotion ? nil : DS.Motion.pop, value: bubbleShown)
        .frame(width: layout.size.width, height: layout.size.height, alignment: .topLeading)
        .allowsHitTesting(false)
    }

    // MARK: the screens

    @ViewBuilder private func screen(_ layout: StageLayout) -> some View {
        switch model.shown {
        case .hello: HelloScreen(model: model, layout: layout)
        case .name: NameScreen(model: model, layout: layout)
        case .grade: GradeScreen(model: model, layout: layout)
        case .tricky: TrickyScreen(model: model, layout: layout)
        case .handToKid: HandToKidScreen(model: model, layout: layout)
        case .tryIt: TryItScreen(model: model, layout: layout)
        case .building: BuildingScreen(model: model, layout: layout)
        case .plan: PlanScreen(model: model, layout: layout)
        case .handBack: HandBackScreen(model: model, layout: layout)
        case .waiting: WaitingScreen(model: model, layout: layout)
        case .gate: GateScreen(model: model, layout: layout)
        case .account: AccountScreen(model: model, layout: layout)
        case .trial: TrialScreen(model: model, layout: layout)
        case .pin: PinScreen(model: model, layout: layout)
        case .handOver: HandOverScreen(model: model, layout: layout)
        case .kidProfile: KidProfileScreen(model: model, layout: layout)
        case .firstBoard: FirstBoardScreen(model: model, layout: layout)
        case .signIn: SignInScreen(model: model, layout: layout)
        case .addToFamily: AddToFamilyScreen(model: model, layout: layout)
        }
    }
}

/// Places the bubble beside the docked speaker, or above it at centre stage.
private struct BubblePlacement: ViewModifier {
    let centre: Bool
    let speakerOrigin: CGPoint
    let speakerSize: CGSize
    let layout: StageLayout

    func body(content: Content) -> some View {
        if centre {
            content
                .alignmentGuide(.top) { d in d.height + 18 - speakerOrigin.y }
                .alignmentGuide(.leading) { d in d.width / 2 - (speakerOrigin.x + speakerSize.width / 2) }
        } else {
            content
                .alignmentGuide(.top) { d in min(d.height, 120) / 2 - (speakerOrigin.y + speakerSize.height / 2) }
                .alignmentGuide(.leading) { _ in -(speakerOrigin.x + speakerSize.width + 20) }
        }
    }
}

/// The stage's measurements for this size: margins, the bar, where the speaker stands and where a
/// screen's content starts.
struct StageLayout {
    let size: CGSize
    let safe: EdgeInsets
    let compact: Bool

    var landscape: Bool { size.width > size.height }
    var margin: CGFloat { compact ? 24 : DS.Space.xxl }
    var barTop: CGFloat { max(safe.top, 12) + 4 }
    var barBottom: CGFloat { barTop + 64 }
    /// the content column, at most 960 wide
    var columnWidth: CGFloat { min(960, size.width - margin * 2) }
    var columnX: CGFloat { (size.width - columnWidth) / 2 }

    var dockSpeakerWidth: CGFloat { compact ? 76 : 100 }
    var dockOrigin: CGPoint { CGPoint(x: margin, y: barBottom + 14) }
    var dockBubbleMax: CGFloat { size.width - margin * 2 - dockSpeakerWidth - 24 }
    /// where a docked screen's own content starts (under the speaker and its bubble)
    var contentTop: CGFloat { dockOrigin.y + dockSpeakerWidth / TheShapes.aspectRatio + 26 }
    var bottomInset: CGFloat { max(safe.bottom, 16) }

    var centreSpeakerWidth: CGFloat { compact ? 140 : (landscape && size.height < 800 ? 150 : 180) }
    var centreBubbleMax: CGFloat { min(620, size.width - margin * 2) }

    /// At centre stage the speaker stands a little above the middle, leaving room for the bubble
    /// above and the answers below.
    func centreSpeakerOrigin(width: CGFloat, step: OnboardingStep) -> CGPoint {
        let h = width / TheShapes.aspectRatio
        let y: CGFloat
        switch step {
        case .building: y = size.height * 0.36 - h / 2
        default: y = max(barBottom + 150, size.height * (landscape ? 0.31 : 0.30)) - h / 2
        }
        return CGPoint(x: (size.width - width) / 2, y: y)
    }
}
