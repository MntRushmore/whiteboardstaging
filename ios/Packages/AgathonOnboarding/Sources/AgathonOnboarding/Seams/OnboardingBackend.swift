import AgathonKit
import Foundation
import Supabase

/// A kid profile made by the onboarding.
public struct MadeKid: Sendable, Equatable {
    public let userId: String
    public let displayName: String
}

/// Everything the onboarding asks of the backend, as one seam so the flow can be driven by a fake
/// in tests and previews. `LiveOnboardingBackend` is AgathonKit's.
@MainActor
public protocol OnboardingBackend: AnyObject {
    var isSignedIn: Bool { get }
    /// The steps before the account (and the grown-up's, by the same journey): fire and forget.
    func step(_ event: String, journey: UUID, meta: [String: AgathonKit.JSONValue]) async
    /// The try's checker (the pre-account route).
    var tryChecker: any TryItChecking { get }

    /// The grown-up's account: `signUp` with the Terms version in its metadata (AgathonKit). True
    /// when it came back with a session; false when the project asks for email confirmation.
    func signUp(email: String, password: String) async throws -> Bool
    func signIn(email: String, password: String) async throws
    func sendPasswordReset(email: String) async throws
    /// After the sign-up, as the grown-up: `save_onboarding(p_complete: true, p_heard_from)`,
    /// `link_start_journey`, then the welcome email (once; fire and forget).
    func finishGrownUp(heardFrom: String?, journey: UUID) async

    /// The grown-up's plan is on (`ink_summary().unlimited`).
    func hasPlan() async -> Bool
    /// `profiles.checkout_ref`, Apple's `appAccountToken`.
    func checkoutRef() async -> UUID?
    func family() async throws -> FamilyState
    func setPin(_ pin: String) async throws
    /// `POST /api/family/kids`.
    func addKid(name: String, grade: Int?, avatar: String) async throws -> MadeKid
    /// Becomes the kid (no PIN: the grown-up is switching to their own kid).
    func switchTo(_ userId: String) async throws
    /// As the kid: `save_onboarding(p_course, p_grade, p_complete: true)`.
    func saveKid(choice: LevelChoice?) async throws
    /// As the kid: a new board row; its id.
    func createBoard(title: String) async throws -> String
    /// As the kid: the try as the first learning attempt (`learning_attempts`).
    func recordAttempt(_ attempt: FirstAttempt) async
}

/// The try, filed as the kid's first learning attempt so the star is real.
public struct FirstAttempt: Sendable, Equatable {
    public var boardId: String?
    public var problemLatex: String
    public var skill: String
    public var course: String?
    public var solvedAlone: Bool
    public var helped: Bool
    public var rings: Int
    public var startedAt: Date
    public var finishedAt: Date
}

/// The onboarding on AgathonKit: Supabase auth and RPCs as the signed-in user, the family routes,
/// the pre-account routes with App Attest.
@MainActor
public final class LiveOnboardingBackend: OnboardingBackend {
    let backend: AgathonBackend
    let preAccount: PreAccountAPI
    public let tryChecker: any TryItChecking

    public init(backend: AgathonBackend, tryChecker: (any TryItChecking)? = nil) {
        self.backend = backend
        let pre = PreAccountAPI(api: backend.api)
        preAccount = pre
        self.tryChecker = tryChecker ?? PreAccountTryChecker(api: pre)
    }

    public var isSignedIn: Bool { backend.auth.phase == .signedIn }

    public func step(_ event: String, journey: UUID, meta: [String: AgathonKit.JSONValue]) async {
        await preAccount.step(journeyId: journey, event: event, meta: meta)
    }

    public func signUp(email: String, password: String) async throws -> Bool {
        try await backend.auth.signUp(email: email, password: password) == .signedIn
    }

    public func signIn(email: String, password: String) async throws {
        try await backend.auth.signIn(email: email, password: password)
    }

    public func sendPasswordReset(email: String) async throws {
        try await backend.auth.sendPasswordReset(email: email)
    }

    public func finishGrownUp(heardFrom: String?, journey: UUID) async {
        var args: [String: AnyJSON] = ["p_complete": .bool(true)]
        if let heardFrom { args["p_heard_from"] = .string(heardFrom) }
        _ = try? await backend.supabase.rpc("save_onboarding", params: args).execute()
        _ = try? await backend.supabase.rpc("link_start_journey", params: ["p_journey": AnyJSON.string(journey.uuidString.lowercased())]).execute()
        _ = try? await backend.api.perform(.post, "/api/email/welcome")
    }

    public func hasPlan() async -> Bool {
        (try? await backend.profiles.inkSummary().hasUnlimited) ?? false
    }

    public func checkoutRef() async -> UUID? {
        struct Row: Decodable { let checkout_ref: String? }
        guard let id = backend.supabase.auth.currentUser?.id.uuidString.lowercased(),
              let response = try? await backend.supabase.from("profiles").select("checkout_ref").eq("user_id", value: id).limit(1).execute(),
              let rows = try? JSONDecoder().decode([Row].self, from: response.data),
              let ref = rows.first?.checkout_ref
        else { return nil }
        return UUID(uuidString: ref)
    }

    public func family() async throws -> FamilyState {
        try await backend.family.load()
    }

    public func setPin(_ pin: String) async throws {
        try await backend.family.setPin(pin)
    }

    struct AddKidBody: Encodable {
        let displayName: String
        let grade: Int?
        let avatar: String

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(displayName, forKey: .displayName)
            // the schema wants the key, null for a course
            try c.encode(grade, forKey: .grade)
            try c.encode(avatar, forKey: .avatar)
        }

        enum CodingKeys: String, CodingKey { case displayName, grade, avatar }
    }

    public func addKid(name: String, grade: Int?, avatar: String) async throws -> MadeKid {
        let member: FamilyMember = try await backend.api.post("/api/family/kids", body: AddKidBody(displayName: name, grade: grade, avatar: avatar))
        return MadeKid(userId: member.userId, displayName: member.displayName)
    }

    public func switchTo(_ userId: String) async throws {
        try await backend.family.switchProfile(to: userId)
    }

    public func saveKid(choice: LevelChoice?) async throws {
        var args: [String: AnyJSON] = ["p_complete": .bool(true)]
        if let saved = choice?.saved {
            args["p_course"] = .string(saved.course)
            if let g = saved.grade { args["p_grade"] = .integer(g) }
        }
        try await backend.supabase.rpc("save_onboarding", params: args).execute()
    }

    public func createBoard(title: String) async throws -> String {
        try await backend.boards.create(title: title).id
    }

    public func recordAttempt(_ a: FirstAttempt) async {
        struct Row: Encodable {
            let id: String
            let board_id: String?
            let problem_latex: String
            let skill: String
            let course: String?
            let origin: String
            let outcome: String
            let lines_written: Int
            let lines_right: Int
            let lines_ringed: Int
            let hints: Int
            let started_at: String
            let finished_at: String
        }
        let iso = ISO8601DateFormatter()
        let row = Row(
            id: UUID().uuidString.lowercased(), board_id: a.boardId, problem_latex: String(a.problemLatex.prefix(500)),
            skill: a.skill, course: a.course, origin: "starter",
            outcome: a.solvedAlone ? (a.rings > 0 ? "self_corrected" : "first_try") : "with_help",
            lines_written: 1 + a.rings, lines_right: 1, lines_ringed: a.rings, hints: a.helped ? 1 : 0,
            started_at: iso.string(from: a.startedAt), finished_at: iso.string(from: a.finishedAt))
        _ = try? await backend.supabase.from("learning_attempts").insert(row).execute()
    }
}
