import Foundation

/// Why a family call didn't go through, read from what the server answered
/// (src/lib/family/server/service.ts `FAMILY_ERRORS` and its `reason`s), or from the network.
///
/// The app shows `FamilyWords` for these, never the server's message or a status code: the person
/// holding the iPad may be a kid, and a Cloudflare 502 has no words of ours in it at all.
public enum FamilyRefusal: Sendable, Equatable {
    /// 403 `kid`: a kid profile asked for a grown-up's thing (the PIN, adding or changing kids).
    case kid
    /// `pin_required`: switching to the grown-up without the PIN (400), or adding a kid before the
    /// PIN is set (409).
    case pinRequired
    /// 403 `no_pin`: switching to a grown-up who never set a PIN.
    case noPin
    /// 403 `wrong_pin`, with the tries left and whether that was the day's last.
    case wrongPin(triesLeft: Int?, locked: Bool)
    /// 429 `pin_locked`: too many wrong PINs today.
    case pinLocked
    /// 503 `pin_unavailable`: the server couldn't count the try, so it didn't check the PIN.
    case pinUnavailable
    /// 409 `plan_required`: a second kid without Agathon Unlimited.
    case planRequired
    /// 409 `too_many`: already six kids.
    case tooMany
    /// 429 `kid_add_limit`: too many kids added today.
    case kidAddLimit
    /// 400 `self`: switching to the profile already signed in.
    case alreadyThem
    /// 404: no such member (any more).
    case gone
    /// Any other 429: the family bucket's rate limit.
    case tooManyTries
    /// 401: the session is gone.
    case signedOut
    /// A 5xx (ours, Vercel's or Cloudflare's HTML page) or a body that wasn't ours.
    case server
    /// No answer: offline, a stall, a cut connection.
    case offline
    /// Anything else (a 400 the app shouldn't have sent).
    case other

    public init(_ error: Error) {
        // a FamilyError (a PIN that isn't 4 digits, an empty name) never left the iPad: its own words
        guard let api = error as? APIError else {
            self = error is URLError ? .offline : .other
            return
        }
        switch api {
        case .notSignedIn: self = .signedOut
        case .timeout, .incomplete, .network: self = .offline
        case .invalidResponse: self = .server
        case let .http(failure): self = Self.from(failure)
        }
    }

    static func from(_ failure: HTTPFailure) -> FamilyRefusal {
        switch failure.reason {
        case "kid": return .kid
        case "pin_required": return .pinRequired
        case "no_pin": return .noPin
        case "wrong_pin": return .wrongPin(triesLeft: failure.triesLeft, locked: failure.locked)
        case "pin_locked": return .pinLocked
        case "pin_unavailable": return .pinUnavailable
        case "plan_required": return .planRequired
        case "too_many": return .tooMany
        case "kid_add_limit": return .kidAddLimit
        case "self": return .alreadyThem
        default: break
        }
        if failure.isUnauthorized { return .signedOut }
        if failure.status == 429 { return .tooManyTries }
        if failure.status == 404 { return .gone }
        if failure.status >= 500 || failure.code == nil { return .server }
        return .other
    }
}

/// What the family's screens say when a call didn't go through: short, kind, and true for the
/// person holding the iPad (the web's words, src/lib/family/copy.ts and switchError.ts). One place,
/// so the Family page, the switcher and the first run's PIN and kid steps say the same thing.
public enum FamilyWords {
    /// What the person was doing.
    public enum Action: Sendable, Equatable {
        case setPin
        case switchProfile
        case addKid
        case editKid
        case removeKid(name: String)
        case load
    }

    /// The words for `error` while doing `action`.
    public static func message(_ error: Error, _ action: Action) -> String {
        if let family = error as? FamilyError { return family.errorDescription ?? tryAgain }
        return message(FamilyRefusal(error), action)
    }

    static let tryAgain = "Something went wrong on our side. Try again in a moment."
    static let offline = "Agathon can't connect. Check the Wi-Fi and try again."

    public static func message(_ refusal: FamilyRefusal, _ action: Action) -> String {
        switch refusal {
        case .kid:
            switch action {
            case .setPin: return "You're on a kid's profile. Switch to the grown-up's profile to set the PIN."
            case .addKid, .editKid, .removeKid: return "You're on a kid's profile. Switch to the grown-up's profile to change the family."
            default: return "A kid's profile can't do that. Ask your grown-up."
            }
        case .pinRequired:
            return action == .switchProfile ? "Enter the grown-up's PIN." : "Set your PIN first, then add kids."
        case .noPin:
            return "The grown-up hasn't set a PIN yet. They can sign in with their password."
        case let .wrongPin(triesLeft, locked):
            if locked { return "That PIN isn't right. Switching to the grown-up is locked until they sign in." }
            return "That PIN isn't right." + (triesLeft.map { " \($0) tr\($0 == 1 ? "y" : "ies") left." } ?? "")
        case .pinLocked:
            return "Too many PIN tries today. The grown-up can sign in with their password."
        case .pinUnavailable:
            return "Couldn't check the PIN just now. Try again in a moment."
        case .planRequired:
            return "Your first kid is free. More kids share Agathon Unlimited: start the free trial, then add them here."
        case .tooMany:
            return "A family has up to \(FamilyService.maxKids) kids."
        case .kidAddLimit:
            return "That's a lot of new profiles today. Try again tomorrow."
        case .alreadyThem:
            return "You're already on that profile."
        case .gone:
            return action == .switchProfile ? "That profile isn't there any more." : "That kid's profile isn't there any more."
        case .tooManyTries:
            return "Too many tries. Wait a few minutes, then try again."
        case .signedOut:
            return "You've been signed out. Sign in again, then try once more."
        case .offline:
            return offline
        case .server, .other:
            switch action {
            case .setPin: return "The PIN wasn't saved. Try again in a moment."
            case .switchProfile: return "Couldn't switch profiles. Try again in a moment."
            case .addKid, .editKid: return "That didn't save. Try again in a moment."
            case let .removeKid(name): return "\(name) is still here. Try again in a moment."
            case .load: return tryAgain
            }
        }
    }
}

// MARK: - who is signed in

extension FamilyState {
    /// Kid profiles' addresses (`KID_EMAIL_DOMAIN`, src/lib/family/kidEmail.ts): `kid-<uuid>@kids.agathon.app`.
    public static let kidEmailDomain = "kids.agathon.app"

    /// A kid profile's address (the server's `isKidEmail`): known from the session alone, before
    /// GET /api/family answers.
    public static func isKidEmail(_ email: String?) -> Bool {
        guard let email = email?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() else { return false }
        return email.hasSuffix("@\(kidEmailDomain)")
    }

    /// Who is signed in, as the grown-up-only places must decide it: a kid by their address or by
    /// the family's word; a grown-up only once the family has said so; unknown until then (a family
    /// that hasn't loaded, or failed to). Grown-up places open for `.grownUp` only.
    public static func who(_ family: FamilyState?, email: String?) -> SignedInAs {
        if isKidEmail(email) || family?.role == .kid { return .kid }
        guard let family else { return .unknown }
        return .grownUp(family)
    }
}

/// Who is on the iPad, for the grown-up-only places (`FamilyState.who`).
public enum SignedInAs: Sendable, Equatable {
    case kid
    /// A grown-up: a solo account, or a family's grown-up.
    case grownUp(FamilyState)
    /// Not known yet (the family hasn't loaded, or couldn't): grown-up places stay shut.
    case unknown

    public var isKid: Bool { self == .kid }
    public var isGrownUp: Bool { if case .grownUp = self { return true } else { return false } }
}
