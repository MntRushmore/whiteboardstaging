#if DEBUG
import AgathonBoard
import AgathonKit
import AgathonLive
import SwiftUI

/// Debug only: drives the board from inside the app, for checking the iPad app on a Mac without
/// touching the Mac's own mouse and keyboard (someone may be using it).
///
/// `-macDrive "stroke:300,300 300,380|check|wait:6|help|wait:8|ask:What is 2 + 2?|wait:15"` opens the
/// first board on Home (a new one if there is none) and plays the steps once, in order:
///  - `stroke:x,y x,y …` a stroke in page units through the canvas's touch path, as a mouse would
///    (`pencil: false`, the pointer's even pressure);
///  - `check` / `help`: the page's Check and Help me; `ask:…` opens Ask and sends it as typed;
///  - `closeAsk`; `wait:<seconds>`;
///  - the picture tutor (with `-pictureTutor.enabled YES`, an admin): `drawNow`, then `accept` or `reject`.
/// `-macSignIn <email>` signs in first, with the password in the MACDRIVE_PASSWORD environment variable
/// (never an argument: arguments show in `ps`).
/// Never in a Release build.
@MainActor
enum MacDrive {
    static var steps: [String]? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-macDrive"), i + 1 < args.count else { return nil }
        let steps = args[i + 1].split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return steps.isEmpty ? nil : steps
    }

    static var openedBoard = false

    /// `-macSignIn <email>` with MACDRIVE_PASSWORD: signs in when signed out.
    static func signInIfAsked(_ backend: AgathonBackend) async {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-macSignIn"), i + 1 < args.count,
              let password = ProcessInfo.processInfo.environment["MACDRIVE_PASSWORD"], !password.isEmpty else { return }
        // the stored session first; another account's is signed out (a shared Mac or simulator)
        while backend.auth.phase == .restoring { try? await Task.sleep(for: .milliseconds(100)) }
        if backend.auth.phase == .signedIn {
            if backend.auth.email?.lowercased() == args[i + 1].lowercased() { return }
            try? await backend.auth.signOut(scope: .local)
            note("signed out the other account")
        }
        do {
            try await backend.auth.signIn(email: args[i + 1], password: password)
            note("signed in")
        } catch {
            note("sign-in failed")
        }
    }
    static var played = false

    /// `-macDriveNewBoard`: a new board ("Mac check") rather than the first one (a shared QA account's
    /// boards stay as they are); `deleteBoard` as the last step removes it.
    static var newBoard: Bool { ProcessInfo.processInfo.arguments.contains("-macDriveNewBoard") }

    /// Each step and what came of it, in the app's tmp folder (`macdrive.log`): the Mac's unified log
    /// isn't always readable from a terminal.
    static func note(_ line: String) {
        BoardScreenModel.log.notice("macDrive: \(line, privacy: .public)")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("macdrive.log")
        let text = "\(Date().formatted(.iso8601)) \(line)\n"
        if let h = try? FileHandle(forWritingTo: url) {
            h.seekToEndOfFile(); h.write(Data(text.utf8)); try? h.close()
        } else {
            try? Data(text.utf8).write(to: url)
        }
    }

    /// `-macDriveCleanup`: Home deletes this account's boards called "Mac check" (an earlier run's).
    static func cleanUp(_ boards: [BoardSummary], backend: AgathonBackend) async -> Set<String> {
        guard ProcessInfo.processInfo.arguments.contains("-macDriveCleanup") else { return [] }
        var gone: Set<String> = []
        for b in boards where b.title == "Mac check" {
            if (try? await backend.boards.delete(id: b.id)) != nil { gone.insert(b.id) }
        }
        note("cleanup: deleted \(gone.count) Mac check board(s)")
        return gone
    }

    static func play(_ model: BoardScreenModel, backend: AgathonBackend) async {
        guard let steps, !played, let tutor = model.tutor, let canvas = tutor.liveBoard.canvas else { return }
        played = true
        try? await Task.sleep(for: .seconds(2))
        for step in steps {
            let (verb, arg) = split(step)
            note("step \(step) (picture: \(model.picture.map { "\($0.phase)" } ?? "none"), shown: \(model.picture?.shown.map { "\($0.state)" } ?? "none"))")
            switch verb {
            case "stroke":
                let pts: [CGPoint] = arg.split(separator: " ").compactMap { pair in
                    let xy = pair.split(separator: ",").compactMap { Double($0) }
                    return xy.count == 2 ? canvas.camera.toView(Vec2(xy[0], xy[1])) : nil
                }
                tutor.liveBoard.controller.tool = .pen
                tutor.liveBoard.notePen(true)
                await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
                    canvas.simulateStroke(densify(pts), duration: 0.35, pencil: false) { done.resume() }
                }
                tutor.liveBoard.notePen(false)
                try? await Task.sleep(for: .milliseconds(120))
            case "check": tutor.loop.checkPage()
            case "help": tutor.loop.helpMe()
            case "ask":
                model.askOpen = true
                try? await Task.sleep(for: .milliseconds(600))
                tutor.ask.session.send(arg)
            case "closeAsk": model.askOpen = false
            case "drawNow": model.picture?.drawNow()
            case "accept": model.picture?.accept()
            case "reject": model.picture?.reject()
            case "deleteBoard":
                guard let id = model.request?.board.id else { break }
                do {
                    _ = try await backend.boards.delete(id: id)
                    note("board deleted")
                } catch {
                    note("board delete failed")
                }
            case "wait": try? await Task.sleep(for: .seconds(Double(arg) ?? 1))
            default: BoardScreenModel.log.error("macDrive: unknown step \(step, privacy: .public)")
            }
        }
        note("done (shown: \(model.picture?.shown.map { "\($0.state)" } ?? "none"), images: \(tutor.liveBoard.controller.store.drawables(on: tutor.liveBoard.controller.currentScreenID).filter { if case .image = $0 { return true } else { return false } }.count))")
    }

    private static func split(_ step: String) -> (String, String) {
        guard let i = step.firstIndex(of: ":") else { return (step, "") }
        return (String(step[..<i]), String(step[step.index(after: i)...]))
    }

    private static func densify(_ p: [CGPoint]) -> [CGPoint] {
        guard p.count >= 2 else { return p }
        var out = [p[0]]
        for (a, b) in zip(p, p.dropFirst()) {
            let n = max(1, Int(hypot(b.x - a.x, b.y - a.y) / 3))
            for k in 1...n { let f = CGFloat(k) / CGFloat(n); out.append(CGPoint(x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f)) }
        }
        return out
    }
}

/// Plays `-macDrive` once the board's tutor is up.
struct MacDriveRunner: View {
    @Environment(AgathonBackend.self) private var backend
    @ObservedObject var model: BoardScreenModel

    var body: some View {
        // not `.task`: the bar this sits in is laid out again as the picture tutor's chrome comes and
        // goes, which would cancel the script's waits
        Color.clear.frame(width: 0, height: 0)
            .onAppear { start() }
            .onChange(of: model.tutor != nil) { _, _ in start() }
    }

    private func start() {
        guard model.tutor != nil, !MacDrive.played else { return }
        let model = model, backend = backend
        Task { @MainActor in await MacDrive.play(model, backend: backend) }
    }
}
#endif
