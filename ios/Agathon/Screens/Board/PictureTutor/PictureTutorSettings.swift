import AgathonKit
import Foundation
import os

/// The picture tutor's modes, by Reed's names ("Solve" is the API's `answer`).
enum PictureTutorMode: String, CaseIterable, Identifiable, Codable, Sendable {
    case off, feedback, suggest, answer

    var id: String { rawValue }

    var title: String {
        switch self {
        case .off: return "Off"
        case .feedback: return "Feedback"
        case .suggest: return "Suggest"
        case .answer: return "Solve"
        }
    }

    /// What it asks the server for (nil: Off asks nothing).
    var api: BoardDrawMode? {
        switch self {
        case .off: return nil
        case .feedback: return .feedback
        case .suggest: return .suggest
        case .answer: return .answer
        }
    }

    /// Suggest and Solve come as a ghost to accept or reject; Feedback is shown as it is.
    var isGhost: Bool { self == .suggest || self == .answer }
}

/// The admin's switch for the picture tutor, per iPad (Account → Picture tutor (test)). Off is the
/// app exactly as it was. On, an admin's boards run the picture tutor instead of the Live loop's marks.
///
/// UserDefaults keys (a launch argument sets them too: `-pictureTutor.enabled YES -pictureTutor.mode suggest`):
///  - `pictureTutor.enabled`: on or off (default off)
///  - `pictureTutor.mode`: the mode a board starts in (default Suggest)
///  - `pictureTutor.stub` (Debug only): the stub server, no network (`PictureTutorStub`)
enum PictureTutorSettings {
    static let enabledKey = "pictureTutor.enabled"
    static let modeKey = "pictureTutor.mode"
    static let stubKey = "pictureTutor.stub"

    nonisolated(unsafe) static var defaults = UserDefaults.standard

    static var enabled: Bool {
        get { defaults.bool(forKey: enabledKey) }
        set { defaults.set(newValue, forKey: enabledKey) }
    }

    static var defaultMode: PictureTutorMode {
        get { defaults.string(forKey: modeKey).flatMap(PictureTutorMode.init(rawValue:)) ?? .suggest }
        set { defaults.set(newValue.rawValue, forKey: modeKey) }
    }

    /// The stub server instead of the network (Debug builds only).
    static var usesStub: Bool {
        #if DEBUG
        return defaults.bool(forKey: stubKey)
        #else
        return false
        #endif
    }

    // MARK: constants (the eval's knobs)

    /// The quiet after the pen lifts before the board is sent (Reed used 2 s).
    static let quietDelay: Double = 0.8
    /// Grows the captured region R by this fraction of its size on each side (0: exactly what is
    /// visible). An eval is testing whether blank space around the work fixes crowded drawings.
    static let captureMarginFraction: Double = 0
    /// The captured picture's longest side, in pixels.
    static let maxLongSide: Double = 1440
}

/// Who may run the picture tutor: an admin (`is_admin()`, the Training Center's check), asked once per
/// signed-in user. A kid profile is its own user and never an admin.
@MainActor
enum PictureTutorAccess {
    private static var known: [String: Bool] = [:]

    static func isAdmin(_ backend: AgathonBackend) async -> Bool {
        let user = backend.auth.userId ?? ""
        if let k = known[user] { return k }
        let yes = await TrainingSync.isAdmin(backend)
        known[user] = yes
        return yes
    }

    /// What a board opens with: the picture tutor when the switch is on and the user is an admin.
    static func boardUsesPictureTutor(_ backend: AgathonBackend) async -> Bool {
        guard PictureTutorSettings.enabled else { return false }
        return await isAdmin(backend)
    }
}

/// The last runs, for the admin page (mode, when each stage came, the server's timings, what became
/// of the picture). Kept on this iPad only.
struct PictureTutorRun: Codable, Equatable, Identifiable, Sendable {
    enum Outcome: String, Codable, Sendable {
        case running, none, shown, ghost, accepted, rejected, cancelled, replaced, error
    }

    var id: String
    var at: Date
    var mode: PictureTutorMode
    var source: String
    var runId: String?
    /// ms after sending: the reading event, the drawing event, the end (done / none / error)
    var readingMs: Double?
    var drawingMs: Double?
    var endMs: Double?
    var timings: BoardDrawTimings?
    var costUsd: Double?
    var outcome: Outcome
    var note: String?
}

@MainActor
final class PictureTutorLog: ObservableObject {
    static let shared = PictureTutorLog()
    static let key = "pictureTutor.runs"
    static let keep = 10
    static let os = Logger(subsystem: "app.agathon.Agathon", category: "picture-tutor")

    @Published private(set) var runs: [PictureTutorRun]
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        runs = defaults.data(forKey: Self.key).flatMap { try? JSONDecoder().decode([PictureTutorRun].self, from: $0) } ?? []
    }

    func add(_ run: PictureTutorRun) {
        runs.insert(run, at: 0)
        if runs.count > Self.keep { runs.removeLast(runs.count - Self.keep) }
        save()
    }

    func update(_ id: String, _ change: (inout PictureTutorRun) -> Void) {
        guard let i = runs.firstIndex(where: { $0.id == id }) else { return }
        change(&runs[i])
        save()
    }

    func clear() {
        runs = []
        save()
    }

    private func save() {
        if let data = try? JSONEncoder().encode(runs) { defaults.set(data, forKey: Self.key) }
    }
}
