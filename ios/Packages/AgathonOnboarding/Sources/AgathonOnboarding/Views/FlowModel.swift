import AgathonBoard
import AgathonDesign
import AgathonKit
import Observation
import SwiftUI

/// How the onboarding ended, for the app (RootView) to take over.
public enum OnboardingOutcome: Sendable {
    /// The kid's profile is made and signed in, with their first board: open it.
    case firstBoard(FirstBoardHandoff)
    /// A grown-up signed in to an existing account with nothing to add here: open Home.
    case signedIn
}

/// The first board, as the onboarding made it: the row's id (nil when it could not be made; the
/// app makes one), the document with the try on screen 1 and the next problems, and the one-time
/// welcome line. The SYNC lane's AgathonSync saves the document into the row.
public struct FirstBoardHandoff: Sendable {
    public let boardId: String?
    public let document: BoardDocument
    public let kidName: String?
    public let welcome: String
}

/// The flow's brain on screen: the state, the seams, and the choreography between screens (the
/// way out, the speaker's jump, the question typed into its bubble, the answers staggering in).
@MainActor
@Observable
final class FlowModel {
    let state: OnboardingState
    let backend: any OnboardingBackend
    let trial: any TrialOffering
    let gate: any ParentalGate
    let onFinish: (OnboardingOutcome) -> Void

    // what is on screen (lags `state.step` by the way out)
    private(set) var shown: OnboardingStep
    private(set) var speaker: SpeakerMode = .hidden
    private(set) var pose: TheShapes.Pose = .hello
    private(set) var bubbleLead: String?
    private(set) var bubbleText = ""
    private(set) var typed = 0
    private(set) var revealed = false
    /// a screen's own second question (the course list, the PIN's second entry), typed in place
    private var subSpeech: String?

    var reduceMotion = false
    /// the trial's offer, fetched when the account screen opens so the trial's title is ready
    var offer: TrialOffer?
    var offerFailed = false
    /// made by `kidProfile`, opened by `firstBoard`
    var firstBoard: FirstBoardHandoff?
    var firstBoardMade: FirstBoardMaker.Made?
    /// the practice set's seed, once per flow, so the board shown is the board handed over
    let boardSeed = Int.random(in: 1...99_999)
    var madeKid: MadeKid?
    private var transition: Task<Void, Never>?
    private var started = false

    init(state: OnboardingState, backend: any OnboardingBackend, trial: any TrialOffering, gate: any ParentalGate,
         onFinish: @escaping (OnboardingOutcome) -> Void) {
        self.state = state
        self.backend = backend
        self.trial = trial
        self.gate = gate
        self.onFinish = onFinish
        shown = state.step
    }

    var copy: OnboardingCopy { state.copy }
    var answers: OnboardingAnswers { state.answers }

    // MARK: - moving

    /// The first screen: the speaker steps in, the question types, the answers rise.
    func start() {
        guard !started else { return }
        started = true
        if shown == .hello { record("start_shown") }
        Task { await backend.tryChecker.warmUp() }
        present(shown, entering: true)
    }

    func go(_ step: OnboardingStep) {
        state.go(to: step)
        present(step, entering: false)
    }

    func advance() {
        guard let next = FlowRules.next(after: state.step, state.answers, hasPlan: state.hasPlan) else { return }
        go(next)
    }

    func back() {
        guard let p = state.previous else { return }
        go(p)
    }

    /// Types `text` in place of the current question (the course list, "Once more to be sure.").
    func retype(_ text: String) {
        subSpeech = text
        transition?.cancel()
        transition = Task { await type(lead: nil, text: text) }
    }

    private func present(_ step: OnboardingStep, entering: Bool) {
        transition?.cancel()
        subSpeech = nil
        transition = Task { [weak self] in
            guard let self else { return }
            // 1. the way out: a 120 ms fade of the answers and the bubble's words
            if !entering {
                withAnimation(OnboardingMotion.out) {
                    self.revealed = false
                    self.typed = 0
                }
                try? await Task.sleep(for: .milliseconds(130))
                if Task.isCancelled { return }
            }
            self.shown = step
            self.announce(step)
            // 2. the speaker moves (a jump to the top-left, or steps aside for the full-bleed screens)
            let mode = Self.speakerMode(step)
            let pose = Self.pose(step)
            let moved = mode != self.speaker
            if moved || pose != self.pose {
                withAnimation(self.reduceMotion ? .easeInOut(duration: 0.18) : OnboardingMotion.dock) {
                    self.speaker = mode
                    self.pose = pose
                }
                if moved, mode != .hidden {
                    try? await Task.sleep(for: .milliseconds(self.reduceMotion ? 60 : (entering ? 380 : 300)))
                }
                if Task.isCancelled { return }
            }
            // 3. the question types into the bubble
            if mode != .hidden, let speech = self.speech(step) {
                await self.type(lead: speech.lead, text: speech.text)
            } else {
                self.bubbleLead = nil
                self.bubbleText = ""
                self.typed = 0
            }
            if Task.isCancelled { return }
            // 4. the answers rise in, 40 ms apart
            withAnimation(DS.Motion.snap) { self.revealed = true }
            self.arrived(step)
        }
    }

    private func type(lead: String?, text: String) async {
        bubbleLead = lead
        bubbleText = text
        let total = (lead?.count ?? 0) + text.count
        if reduceMotion {
            typed = total
            return
        }
        typed = 0
        let per = OnboardingMotion.perCharacter(total)
        // a beat between the lead ("Hi.") and the question
        for i in 1...max(total, 1) {
            if Task.isCancelled { return }
            typed = i
            if let lead, i == lead.count { try? await Task.sleep(for: .milliseconds(260)) }
            try? await Task.sleep(for: per)
        }
        try? await Task.sleep(for: .milliseconds(90))
    }

    private func announce(_ step: OnboardingStep) {
        guard UIAccessibility.isVoiceOverRunning else { return }
        let words = speech(step).map { [$0.lead, $0.text].compactMap { $0 }.joined(separator: " ") } ?? ""
        UIAccessibility.post(notification: .screenChanged, argument: words.isEmpty ? nil : words)
    }

    /// Things a screen does once it has arrived: its step count, a sound, a prefetch.
    private func arrived(_ step: OnboardingStep) {
        switch step {
        case .handToKid: record("start_handoff_kid")
        case .tryIt: record("start_try_shown")
        case .plan:
            record("start_plan")
            OnboardingSound.shared.play(.run)
        case .handBack: record("start_handoff_grownup")
        case .account:
            record("start_account_shown")
            prefetchOffer()
        case .trial:
            record("start_trial_shown")
        default: break
        }
    }

    // MARK: - what each screen says and where the speaker stands

    static func speakerMode(_ step: OnboardingStep) -> SpeakerMode {
        switch step {
        case .hello, .building: .centre
        case .name, .grade, .tricky, .plan, .waiting, .account, .trial, .pin, .kidProfile, .signIn, .addToFamily: .dock
        case .handToKid, .tryIt, .handBack, .handOver, .gate, .firstBoard: .hidden
        }
    }

    static func pose(_ step: OnboardingStep) -> TheShapes.Pose {
        switch step {
        case .building: .thinking
        case .plan: .celebrate
        default: .hello
        }
    }

    func speech(_ step: OnboardingStep) -> (lead: String?, text: String)? {
        if let subSpeech, step == shown { return (nil, subSpeech) }
        let c = copy
        switch step {
        case .hello: return (c.hello.hi, c.hello.question)
        case .name: return (nil, c.nameTitle)
        case .grade: return (nil, c.gradeTitle)
        case .tricky: return (nil, c.trickyTitle)
        case .building: return (nil, c.buildingTitle)
        case .plan: return (nil, c.planTitle)
        case .waiting: return (nil, c.waitingTitle)
        case .account: return (nil, c.accountTitle)
        case .trial:
            if let days = offer?.trialDays, days > 0 { return (nil, c.trialTitle(days: days)) }
            return (nil, offer.map { _ in "Agathon Unlimited." } ?? "Agathon Unlimited.")
        case .pin: return (nil, c.pinTitle)
        case .kidProfile: return (nil, c.pictureTitle)
        case .signIn: return (nil, c.welcomeBack)
        case .addToFamily: return (nil, c.addTitle)
        case .handToKid, .tryIt, .handBack, .handOver, .gate, .firstBoard: return nil
        }
    }

    /// What the speaker button reads: the question, then the screen's own words.
    func readAloud(extra: [String]) {
        let s = speech(shown)
        ReadAloud.shared.say([s?.lead, s?.text].compactMap { $0 } + extra)
    }

    // MARK: - the trail and the bar

    /// The trail appears with the first answer, as the speaker docks (Aristotle's bar does the same).
    var trail: (count: Int, at: Int)? {
        shown == .hello ? nil : FlowRules.trail(for: shown, state.answers, hasPlan: state.hasPlan)
    }

    var trailLabel: String {
        guard let t = trail else { return "" }
        return copy.step(t.at, of: t.count)
    }

    var canGoBack: Bool { state.previous != nil && shown == state.step }

    // MARK: - counting the steps

    func record(_ event: String, _ meta: [String: AgathonKit.JSONValue] = [:]) {
        let journey = state.journeyId
        let backend = backend
        Task { await backend.step(event, journey: journey, meta: meta) }
    }

    // MARK: - the trial's offer

    func prefetchOffer() {
        guard offer == nil else { return }
        offerFailed = false
        Task {
            do {
                offer = try await trial.offer()
            } catch {
                offerFailed = true
            }
        }
    }
}
