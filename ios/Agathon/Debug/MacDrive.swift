#if DEBUG
import AgathonBoard
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
///  - `closeAsk`; `wait:<seconds>`.
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
    static var played = false

    static func play(_ model: BoardScreenModel) async {
        guard let steps, !played, let tutor = model.tutor, let canvas = tutor.liveBoard.canvas else { return }
        played = true
        try? await Task.sleep(for: .seconds(2))
        for step in steps {
            let (verb, arg) = split(step)
            BoardScreenModel.log.notice("macDrive: \(step, privacy: .public)")
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
            case "wait": try? await Task.sleep(for: .seconds(Double(arg) ?? 1))
            default: BoardScreenModel.log.error("macDrive: unknown step \(step, privacy: .public)")
            }
        }
        BoardScreenModel.log.notice("macDrive: done")
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
    @ObservedObject var model: BoardScreenModel

    var body: some View {
        Color.clear.frame(width: 0, height: 0)
            .task(id: model.tutor != nil) { await MacDrive.play(model) }
    }
}
#endif
