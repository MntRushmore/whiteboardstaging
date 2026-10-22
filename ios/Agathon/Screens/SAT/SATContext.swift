import AgathonBoard
import AgathonKit
import AgathonLive
import AgathonSAT
import AgathonSync
import Foundation
import Observation

/// What every SAT screen shares (docs/SAT-MODE.md): the routes (`SATClient`, or the stub in a Debug run
/// with `-satStub`), who is practising (no account, a free account, Unlimited: the free tutor's cap
/// line words), and where a session's board is kept.
@MainActor
@Observable
final class SATContext {
    let service: SATService
    /// the latest progress (SAT home, the panel's "free tutor questions left")
    var progress: SATProgress?
    /// Debug `-satStub`: the routes, the board and the tutor are all played on the iPad (UI tests,
    /// screenshots); nothing reaches a server.
    let isStub: Bool
    /// Debug `-satStub`: the account the run pretends to be (`-satAccount none|free|unlimited`)
    private let stubAccount: SATAccount?

    init(service: SATService, isStub: Bool = false, stubAccount: SATAccount? = nil) {
        self.service = service
        self.isStub = isStub
        self.stubAccount = stubAccount
    }

    /// Who is practising: no account (an anonymous session), Unlimited (the server says so), or free.
    func account(_ backend: AgathonBackend) -> SATAccount {
        if let stubAccount { return stubAccount }
        if backend.auth.isAnonymous || backend.auth.phase != .signedIn { return .none }
        if progress?.today.unlimited == true { return .unlimited }
        return .free
    }

    // MARK: - making one

    /// The app's: the real routes; in a Debug run with `-satStub`, the stub (shared by every screen of
    /// the run, so the free tutor's count carries from one session to the next).
    static func make(_ backend: AgathonBackend) -> SATContext {
        #if DEBUG
        if let stub = SATDebug.stubContext { return stub }
        #endif
        return SATContext(service: SATClient(api: backend.api))
    }
}

/// A session's board: the signed-in student's row (saved by AgathonSync, the tutor's calls to the
/// API), or in a stub run a board kept in memory with a quiet tutor.
enum SATBoardHome {
    /// The board's title: "SAT practice · Thursday".
    static func title(_ day: Date = Date()) -> String {
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate("EEEE")
        return "SAT practice · \(f.string(from: day))"
    }
}

/// A board row that lives only in memory (a stub run): nothing is fetched or written anywhere.
struct MemoryBoardRemote: BoardRemote {
    func fetch(boardId: String) async throws -> RemoteBoard? { RemoteBoard(version: 0, body: .empty) }
    func persist(boardId: String, write: BoardWrite, expectedVersion: Int?) async -> PersistResult { .ok(version: (expectedVersion ?? 0) + 1) }
}

/// The Live routes in a stub run: a read of anything is "unknown" (no maths is judged, nothing is
/// called), check and solve finish at once. Every call is counted: a capped page must make none.
final class SATQuietLiveServices: LiveServices, @unchecked Sendable {
    private let lock = NSLock()
    private var _calls = 0
    var calls: Int { lock.withLock { _calls } }
    private func count() { lock.withLock { _calls += 1 } }

    // (the replies with no public initialiser fail as offline would: nothing the session needs)
    func capabilities() async throws -> LiveCapabilities {
        throw APIError.network(.notConnectedToInternet)
    }

    func recognize(_ request: RecognizeRequest) async throws -> RecognizeResponse {
        count()
        return RecognizeResponse(latex: "", text: "", kind: "unknown", confidence: 0.2, provider: "mathpix", ms: 5)
    }

    func reread(_ request: RereadRequest) async throws -> RereadResponse {
        count()
        throw APIError.network(.notConnectedToInternet)
    }

    func setup(_ request: SetupRequest) async throws -> SetupResponse {
        count()
        throw APIError.network(.notConnectedToInternet)
    }

    func check(_ request: CheckRequest) -> LiveEventStream {
        count()
        return LiveEventStream { $0.finish() }
    }

    func solve(_ request: SolveRequest) -> LiveEventStream {
        count()
        return LiveEventStream { $0.finish() }
    }
}

#if DEBUG
/// Debug launch arguments for SAT mode (the UI tests and the screenshots):
///  - `-satStub [cap=5,used=0,unlimited=0,answered=0]`: the stub routes, an in-memory board, a quiet
///    tutor; Home shows signed out too;
///  - `-satAccount none|free|unlimited`: who the stub run is;
///  - `-satOpen home|session|summary`: open SAT home (or a session, or a finished set) at launch.
enum SATDebug {
    static let args = ProcessInfo.processInfo.arguments

    static func value(_ flag: String) -> String? {
        guard let i = args.firstIndex(of: flag), i + 1 < args.count, !args[i + 1].hasPrefix("-") else { return nil }
        return args[i + 1]
    }

    static var isStub: Bool { args.contains("-satStub") }

    static var openAtLaunch: String? { value("-satOpen") }

    @MainActor static let stubContext: SATContext? = {
        guard isStub else { return nil }
        var opts: [String: String] = [:]
        for part in (value("-satStub") ?? "").split(separator: ",") {
            let kv = part.split(separator: "=", maxSplits: 1).map(String.init)
            if kv.count == 2 { opts[kv[0]] = kv[1] }
        }
        let cap = Int(opts["cap"] ?? "") ?? 5
        let stub = SATStubService(cap: cap, usedBefore: Int(opts["used"] ?? "") ?? 0, unlimited: opts["unlimited"] == "1")
        // a student with history: the progress card and the estimate band
        if let n = Int(opts["answered"] ?? ""), n > 0 {
            stub.history = (0..<n).map { i in
                let q = SATFixtures.questions[i % SATFixtures.questions.count]
                return SATAttempt(questionId: q.id + (i >= SATFixtures.questions.count ? "-\(i)" : ""), chosen: "A", correct: i % 3 != 0, seconds: 60, usedTutor: false)
            }
        }
        let account = SATAccount(rawValue: value("-satAccount") ?? "") ?? .free
        return SATContext(service: stub, isStub: true, stubAccount: account)
    }()
}
#endif
