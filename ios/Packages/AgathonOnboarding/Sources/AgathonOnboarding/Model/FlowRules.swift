import Foundation

/// The onboarding's screens (docs/ONBOARDING.md, "The flow at a glance"), in the order the usual
/// family meets them. The kid's part ends at `handBack`; the grown-up's begins at `gate`.
public enum OnboardingStep: String, Codable, Sendable, CaseIterable {
    // the kid's part (nobody sees a form or a price here)
    case hello, name, grade, tricky, handToKid, tryIt, building, plan, handBack
    /// the kid alone with no grown-up: the plan waits on the iPad
    case waiting
    // the grown-up's part
    case gate, account, trial, pin, handOver, kidProfile, firstBoard
    /// "I have an account. Sign in"
    case signIn
    /// signed in on an iPad holding an unsaved plan: "Add Sam to your family?"
    case addToFamily

    /// The screens a grown-up holds (ink grounds and the grown-up's trail).
    public var isGrownUps: Bool {
        switch self {
        case .gate, .account, .trial, .pin, .handOver, .signIn, .addToFamily: true
        default: false
        }
    }

    /// Screens that need the grown-up's session.
    public var needsSession: Bool {
        switch self {
        case .trial, .pin, .handOver, .kidProfile, .firstBoard, .addToFamily: true
        default: false
        }
    }
}

/// The flow's rules, ported from src/lib/start/flow.ts with the iPad's own steps. Pure.
public enum FlowRules {
    /// Problems a kid may try before the account.
    public static let maxTries = 3
    /// A flow kept longer than this starts over (`FLOW_TTL_MS`).
    public static let keptFor: TimeInterval = 7 * 24 * 60 * 60

    /// Whether the tricky screen is shown: a grown-up whenever the grade or course offers skills; a
    /// kid alone from 3rd grade up (younger kids go straight to the try: the cards are a lot to read).
    public static func showsTricky(_ a: OnboardingAnswers, catalog: OnboardingCatalog = .shared) -> Bool {
        guard let choice = a.choice else { return true } // not answered yet: count it, so the trail never jumps
        guard !Plan.focusOptions(choice, catalog: catalog).isEmpty else { return false }
        if a.role == .kid, let g = choice.grade, g < 3 { return false }
        return true
    }

    /// The screens this family meets, in order.
    public static func steps(_ a: OnboardingAnswers, hasPlan: Bool = false, catalog: OnboardingCatalog = .shared) -> [OnboardingStep] {
        var s: [OnboardingStep] = [.hello, .name, .grade]
        if showsTricky(a, catalog: catalog) { s.append(.tricky) }
        if a.role != .kid { s.append(.handToKid) }
        s += [.tryIt, .building, .plan, .handBack, .gate, .account]
        if !hasPlan { s.append(.trial) }
        s += [.pin, .handOver, .kidProfile, .firstBoard]
        return s
    }

    /// The screen after `step` (nil after the last). `waiting`, `signIn` and `addToFamily` are
    /// branches the flow leads into by itself.
    public static func next(after step: OnboardingStep, _ a: OnboardingAnswers, hasPlan: Bool = false) -> OnboardingStep? {
        switch step {
        case .waiting: return .gate
        case .addToFamily: return hasPlan ? .pin : .trial
        case .signIn: return nil
        default: break
        }
        let list = steps(a, hasPlan: hasPlan)
        guard let at = list.firstIndex(of: step), at + 1 < list.count else { return nil }
        return list[at + 1]
    }

    /// Where Back goes; nil when there is no Back. The beat is not a place: Back from the plan goes
    /// past it. Once the account exists nothing goes back before it.
    public static func previous(before step: OnboardingStep, _ a: OnboardingAnswers) -> OnboardingStep? {
        switch step {
        case .hello, .trial, .pin, .handOver, .firstBoard, .building, .addToFamily: return nil
        case .waiting, .gate, .account: return .handBack
        case .signIn: return .hello
        case .kidProfile: return .handOver
        default: break
        }
        let list = steps(a)
        guard var at = list.firstIndex(of: step) else { return nil }
        at -= 1
        while at >= 0, list[at] == .building { at -= 1 }
        return at >= 0 ? list[at] : nil
    }

    /// The kid's trail: who, name, grade, tricky (when shown), try.
    public static func kidTrail(_ a: OnboardingAnswers) -> [OnboardingStep] {
        steps(a).filter { [.hello, .name, .grade, .tricky, .tryIt].contains($0) }
    }

    /// The grown-up's trail: Account · Free trial · Sam's profile.
    public static func grownUpTrail(hasPlan: Bool) -> [OnboardingStep] {
        hasPlan ? [.account, .kidProfile] : [.account, .trial, .kidProfile]
    }

    /// The trail a screen shows and where it is on it; nil for the screens without one (the
    /// hand-offs, the beat, the plan, the board, the gate).
    public static func trail(for step: OnboardingStep, _ a: OnboardingAnswers, hasPlan: Bool = false) -> (count: Int, at: Int)? {
        let kid = kidTrail(a)
        if let at = kid.firstIndex(of: step) { return (kid.count, at) }
        let grown = grownUpTrail(hasPlan: hasPlan)
        let mapped: OnboardingStep = step == .pin ? .kidProfile : step
        if step == .account || step == .trial || step == .pin || step == .kidProfile, let at = grown.firstIndex(of: mapped) {
            return (grown.count, at)
        }
        return nil
    }

    /// True when the screen's earlier answers are all there (`answered`).
    static func answered(_ step: OnboardingStep, _ a: OnboardingAnswers) -> Bool {
        switch step {
        case .hello: true
        case .name, .grade: a.role != nil
        default: a.role != nil && a.choice != nil
        }
    }

    /// Where a flow kept on the iPad reopens (`resumeStep`): its screen, or the first one whose
    /// earlier answers are missing. The beat and the account reopen on the plan (the family sees
    /// what it is saving); the gate on the hand-back; the grown-up's screens after the account only
    /// with the grown-up's session, else on the plan.
    public static func resume(_ step: OnboardingStep, _ a: OnboardingAnswers, signedIn: Bool) -> OnboardingStep {
        var wanted: OnboardingStep
        switch step {
        case .building, .account: wanted = .plan
        case .gate: wanted = .handBack
        case .signIn: wanted = .hello
        case .firstBoard: wanted = .kidProfile
        default: wanted = step
        }
        if wanted.needsSession && !signedIn { wanted = .plan }
        if wanted == .waiting || wanted.needsSession { return answered(.plan, a) ? wanted : .hello }
        let list = steps(a)
        guard let at = list.firstIndex(of: wanted) else { return .hello }
        for i in 0...at where !answered(list[i], a) { return list[max(0, i - 1)] }
        return wanted
    }

    /// Single choices move on by themselves after this long (the tick has drawn).
    public static let autoAdvance: Duration = .milliseconds(360)
}

// MARK: - the grown-up's session

/// Who the iPad is signed in as, for the grown-up's part of the flow (the trial, the PIN, adding the
/// kid). The PIN and the kids are the grown-up's: the server refuses them from a kid's profile
/// (403 `kid`), as on the owner's iPad (2026-10-20), which was left on a demo family's kid.
public enum OnboardingSession: Sendable, Equatable {
    case signedOut
    /// A grown-up's account (solo or a family's): whether its PIN is set, and its kids.
    case grownUp(hasPin: Bool, kids: [MadeKid])
    /// A kid's profile: an iPad left on a kid, or the flow's own kid after the switch.
    case kid(MadeKid)
    /// Signed in, but who it is couldn't be read (the family didn't load).
    case unknown
}

extension FlowRules {
    /// Where the gate leads: the account when signed out; for a grown-up, the trial without the plan,
    /// else the PIN (or the hand-over when it's set); for a kid's profile, the grown-up's sign-in
    /// (the grown-up's own session is what makes the PIN and the kid's profile); nil when it can't be
    /// told who is signed in (stay at the gate and say so).
    public static func afterGate(_ session: OnboardingSession, hasPlan: Bool) -> OnboardingStep? {
        switch session {
        case .signedOut: return .account
        case .kid: return .signIn
        case .unknown: return nil
        case let .grownUp(hasPin, _): return hasPlan ? (hasPin ? .handOver : .pin) : .trial
        }
    }

    /// A screen of the grown-up's part, reopened with the session the iPad has now: itself for a
    /// grown-up (or one not known yet: its own call says what's wrong); the plan for anyone else, so
    /// the grown-up comes back through the gate and signs in. Other screens are themselves.
    public static func grownUpScreen(_ step: OnboardingStep, _ session: OnboardingSession) -> OnboardingStep {
        guard [.trial, .pin, .handOver, .addToFamily].contains(step) else { return step }
        switch session {
        case .grownUp, .unknown: return step
        case .signedOut, .kid: return .plan
        }
    }

    /// How the kid's profile is reached on `kidProfile`.
    public enum KidPlan: Sendable, Equatable {
        /// add the kid, then become them
        case add
        /// become this member (made a moment ago, or already in the family by that name: an add that
        /// went through before the switch didn't, so a second add never meets `plan_required`)
        case become(String)
        /// the iPad is already on this kid (the app closed after the switch)
        case already(String)
        /// not the grown-up's session (signed out, or another kid's profile): the grown-up signs in
        case needsGrownUp
    }

    public static func kidPlan(made: MadeKid?, name: String?, _ session: OnboardingSession) -> KidPlan {
        let wanted = Self.nameKey(name)
        switch session {
        case let .kid(me):
            if me.userId == made?.userId { return .already(me.userId) }
            if made == nil, Self.nameKey(me.displayName) == wanted { return .already(me.userId) }
            return .needsGrownUp
        case let .grownUp(_, kids):
            if let made { return .become(made.userId) }
            if let same = kids.first(where: { Self.nameKey($0.displayName) == wanted }) { return .become(same.userId) }
            return .add
        case .signedOut:
            return .needsGrownUp
        case .unknown:
            return made.map { .become($0.userId) } ?? .add
        }
    }

    /// A kid's name as the flow adds it ("Me" without one), for matching.
    static func nameKey(_ name: String?) -> String {
        let n = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return (n.isEmpty ? "Me" : n).lowercased()
    }
}
