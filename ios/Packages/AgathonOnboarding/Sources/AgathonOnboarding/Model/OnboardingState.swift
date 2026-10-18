import Foundation
import Observation

/// The onboarding as it stands: the screen, the answers and the journey id, kept on the iPad so a
/// closed app reopens where it was (7 days; docs/ONBOARDING.md "Resume"). The kid's name stays in
/// this file on the iPad until the grown-up's account exists; after the kid's profile is made the
/// flow is forgotten but the journey id is kept (the web's `forgetFlow`).
@MainActor
@Observable
public final class OnboardingState {
    /// The screen on show.
    public private(set) var step: OnboardingStep
    public var answers: OnboardingAnswers
    /// The anonymous journey the steps before the account are counted under (`start_steps`).
    public let journeyId: UUID
    /// The grown-up's account already has the plan (a Stripe or Apple subscriber who signed in):
    /// the trial is skipped.
    public var hasPlan = false
    /// The id of the first board once it is made.
    public var firstBoardId: String?
    /// Where "Sign in" came from, so Back returns there.
    public var signInFrom: OnboardingStep = .hello

    let store: OnboardingStore

    /// A fresh flow, or the one kept on this iPad (reopened per `FlowRules.resume`).
    public init(store: OnboardingStore = .standard, signedIn: Bool = false, now: Date = Date()) {
        self.store = store
        journeyId = store.journeyId()
        if let kept = store.read(now: now) {
            answers = kept.answers
            step = FlowRules.resume(kept.step, kept.answers, signedIn: signedIn)
            hasPlan = kept.hasPlan
            firstBoardId = kept.firstBoardId
        } else {
            answers = .empty
            step = .hello
        }
    }

    // MARK: moving

    /// Shows `step` and keeps the flow.
    public func go(to step: OnboardingStep, now: Date = Date()) {
        self.step = step
        keep(now: now)
    }

    /// The next screen of the usual order (no-op after the last).
    public func advance(now: Date = Date()) {
        if let next = FlowRules.next(after: step, answers, hasPlan: hasPlan) { go(to: next, now: now) }
    }

    public var previous: OnboardingStep? {
        step == .signIn ? signInFrom : FlowRules.previous(before: step, answers)
    }

    public func back(now: Date = Date()) {
        if let p = previous { go(to: p, now: now) }
    }

    /// Saves the answers without moving.
    public func keep(now: Date = Date()) {
        store.write(.init(step: step, answers: answers, savedAt: now, hasPlan: hasPlan, firstBoardId: firstBoardId))
    }

    public var copy: OnboardingCopy { OnboardingCopy(answers) }

    /// Tries left before the account.
    public var triesLeft: Int { max(0, FlowRules.maxTries - answers.tries.count) }

    // MARK: finishing

    /// The kid's profile exists: forget the flow (the journey id stays), and never show onboarding
    /// on this iPad again.
    public func finish() {
        store.forget()
        store.markFinished()
    }

    /// Whether the app should open on the onboarding: this iPad has never finished it, or a flow is
    /// waiting (a plan not yet saved, a grown-up's part not yet done). The screens lane calls this
    /// from RootView while signed out; while signed in only a kept flow brings it back.
    public static var needsOnboarding: Bool { OnboardingStore.standard.needsOnboarding }

    /// A flow is kept on this iPad (any step), e.g. a signed-in grown-up who closed the app on the PIN.
    public static var hasKeptFlow: Bool { OnboardingStore.standard.read(now: Date()) != nil }

    /// Starts over (Labs).
    public static func reset() {
        OnboardingStore.standard.forget()
        OnboardingStore.standard.clearFinished()
    }
}

/// Where the flow is kept: a small JSON file in Application Support (excluded from backups) and
/// two flags in UserDefaults. Injectable for tests.
public final class OnboardingStore: @unchecked Sendable {
    public struct Kept: Codable, Equatable {
        public var step: OnboardingStep
        public var answers: OnboardingAnswers
        public var savedAt: Date
        public var hasPlan: Bool
        public var firstBoardId: String?
    }

    let file: URL
    let defaults: UserDefaults
    static let journeyKey = "agathon.onboarding.journey"
    static let finishedKey = "agathon.onboarding.finished"

    public init(file: URL, defaults: UserDefaults) {
        self.file = file
        self.defaults = defaults
    }

    public static let standard: OnboardingStore = {
        let dir = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? FileManager.default.temporaryDirectory
        return OnboardingStore(file: dir.appendingPathComponent("agathon-onboarding.json"), defaults: .standard)
    }()

    public func journeyId() -> UUID {
        if let s = defaults.string(forKey: Self.journeyKey), let id = UUID(uuidString: s) { return id }
        let id = UUID()
        defaults.set(id.uuidString.lowercased(), forKey: Self.journeyKey)
        return id
    }

    public func read(now: Date) -> Kept? {
        guard let data = try? Data(contentsOf: file),
              let kept = try? Self.decoder.decode(Kept.self, from: data)
        else { return nil }
        let age = now.timeIntervalSince(kept.savedAt)
        guard abs(age) <= FlowRules.keptFor else { return nil }
        // a flow with no answer yet is no flow (the web's `readKeptFlow`)
        guard kept.answers.role != nil else { return nil }
        return kept
    }

    public func write(_ kept: Kept) {
        guard let data = try? Self.encoder.encode(kept) else { return }
        var url = file
        do {
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? url.setResourceValues(values)
        } catch {
            // a full disk: the flow lasts this launch
        }
    }

    public func forget() {
        try? FileManager.default.removeItem(at: file)
    }

    public var isFinished: Bool { defaults.bool(forKey: Self.finishedKey) }
    public func markFinished() { defaults.set(true, forKey: Self.finishedKey) }
    public func clearFinished() { defaults.removeObject(forKey: Self.finishedKey) }

    public var needsOnboarding: Bool { !isFinished || read(now: Date()) != nil }

    static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .millisecondsSince1970
        return e
    }()

    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .millisecondsSince1970
        return d
    }()
}
