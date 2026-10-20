import AgathonAsk
import AgathonBoard
import AgathonBrain
import AgathonKit
import AgathonLive
import os
import SwiftUI
import UIKit

/// The Training Center's board: the real board (the Blocks editor, the canvas, problem pages) with the
/// real tutor on it (`BoardTutor`: the Live loop, the desk that writes problems on their own pages),
/// calling the real routes through `TrainingServices` (the training flag, the call budget, every read
/// recorded). Kept in memory: a training board is never one of the admin's boards and is never saved
/// as one (what matters is saved as training rows), and the loop's learning record is not connected
/// (training work never counts as anyone's practice).
@MainActor
final class TrainingBoard: ObservableObject {
    nonisolated static let log = Logger(subsystem: "app.agathon.Agathon", category: "training")

    let controller = BoardController()
    let services: TrainingServices
    let boardId: String
    @Published private(set) var tutor: BoardTutor?
    private(set) weak var canvas: BoardCanvasView?
    private weak var backend: AgathonBackend?
    private var settings: LiveSettings
    private var pageSeq = 0

    init(backend: AgathonBackend, budget: Int, settings: LiveSettings) {
        services = TrainingServices(backend: backend, budget: budget)
        boardId = "training-\(UUID().uuidString.lowercased().prefix(8))"
        self.backend = backend
        self.settings = settings
    }

    var loop: LiveLoop? { tutor?.loop }
    var liveBoard: CanvasLiveBoard? { tutor?.liveBoard }

    /// The canvas is up: the tutor joins.
    func attach(_ canvas: BoardCanvasView) {
        canvas.accessibilityIdentifier = "training.canvas"
        guard tutor == nil, let backend else { return }
        self.canvas = canvas
        let boardId = self.boardId
        let tutor = BoardTutor(controller: controller, canvas: canvas, boardId: boardId, services: services) { board, helper in
            AskParts.live(backend: backend, boardId: boardId, board: board, helper: helper, userId: backend.auth.userId, grade: nil)
        }
        tutor.loop.settings = settings
        tutor.start()
        self.tutor = tutor
    }

    func apply(_ settings: LiveSettings) {
        self.settings = settings
        loop?.settings = settings
    }

    func stop() {
        tutor?.stop()
        tutor = nil
    }

    /// The canvas laid out and the brain loaded: ready to write.
    func ready() async -> Bool {
        for _ in 0..<100 {
            if tutor != nil, (canvas?.bounds.width ?? 0) > 0 { break }
            try? await Task.sleep(for: .milliseconds(100))
        }
        _ = try? await Brain.shared.load()
        return tutor != nil && (canvas?.bounds.width ?? 0) > 0
    }

    // MARK: - pages

    var pagesLeft: Int { ScreenRecord.maxScreens - controller.store.screens.count }

    /// A fresh problem page with `problem` written at its top in the tutor's hand (the shipped
    /// problem pages: `ProblemPageWriter`, the desk checks it first). The board goes there. False when
    /// the desk refused it or the board is full.
    func problemPage(_ problem: [String], set: String) async -> Bool {
        guard let tutor else { return false }
        pageSeq += 1
        let report = await ProblemPageWriter(driver: tutor.driver)
            .write(.init(problems: [problem], setId: "\(set):\(pageSeq)", origin: "practice", allDone: false))
        tutor.loop.problemsChanged()
        if report.pages.isEmpty {
            Self.log.notice("training: the desk refused \(problem.joined(separator: " ; "), privacy: .public): \(report.notes.joined(separator: " "), privacy: .public)")
        }
        return !report.pages.isEmpty
    }

    /// A fresh page of the writer's own (the page template, no problem: the first line they write is
    /// the problem). The board goes there.
    @discardableResult
    func ownPage() -> RecordID? {
        let page = ProblemPage(kind: .problem, origin: "student", answer: ProblemPagesRollout.secondPart)
        let current = controller.currentScreenID
        let blank = controller.store.drawables(on: current).isEmpty && controller.store[current]?.screen?.problemPage == nil
        if blank {
            controller.setProblemPage(page, on: current, origin: .tutor)
            loop?.problemsChanged()
            return current
        }
        let id = controller.insertScreen(after: current, meta: [ProblemPage.metaKey: page.json], origin: .tutor, go: true)
        loop?.problemsChanged()
        return id
    }

    /// The page on show's own geometry (its rect; its work area's top).
    var page: (rect: Box, workTop: Double) {
        let s = controller.currentScreen
        return (s?.rect ?? .screen, s?.problemPage?.resolvedWorkTop ?? ProblemPageLayout.defaultWorkTop)
    }

    // MARK: - the pen

    /// Writes strokes (page units, already placed) through the canvas's own touch path at `pace`
    /// (nil: a quick pen), the pen down for each stroke. Returns the kid strokes it made.
    func write(_ strokes: [[Vec2]], pace: KidPace?, rng: inout SplitMix) async -> [RecordID] {
        guard let canvas, let liveBoard else { return [] }
        controller.tool = .pen
        let before = Set(kidStrokeIds())
        let steps = pace?.steps(strokes, rng: &rng)
        for (k, pts) in strokes.enumerated() where pts.count >= 2 {
            if let step = steps?[k], step.pauseMs > 0 { try? await Task.sleep(for: .milliseconds(Int(step.pauseMs))) }
            let view = Self.densify(pts).map { canvas.camera.toView($0) }
            let length = zip(pts, pts.dropFirst()).reduce(0) { $0 + $1.0.dist($1.1) }
            let seconds = steps.map { $0[k].drawMs / 1_000 } ?? max(0.06, length / 900)
            liveBoard.notePen(true)
            await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
                canvas.simulateStroke(view, duration: seconds) { done.resume() }
            }
            liveBoard.notePen(false)
            if steps == nil { try? await Task.sleep(for: .milliseconds(40)) }
        }
        let after = kidStrokeIds()
        return after.filter { !before.contains($0) }
    }

    /// Rubs strokes out with the eraser (the canvas's touch path), back and forth over their box;
    /// whatever it missed goes too, as the kid's own change.
    func erase(_ ids: [RecordID]) async {
        guard let canvas, let liveBoard, let box = box(of: ids) else { return }
        controller.tool = .eraser
        var path: [Vec2] = []
        let rows = max(2, Int(box.h / 14))
        for r in 0...rows {
            let y = box.y + box.h * Double(r) / Double(rows)
            path.append(Vec2(r % 2 == 0 ? box.x - 8 : box.maxX + 8, y))
            path.append(Vec2(r % 2 == 0 ? box.maxX + 8 : box.x - 8, y))
        }
        liveBoard.notePen(true)
        await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
            canvas.simulateStroke(Self.densify(path).map { canvas.camera.toView($0) }, duration: 0.6) { done.resume() }
        }
        liveBoard.notePen(false)
        controller.tool = .pen
        let left = ids.filter { controller.store[$0] != nil }
        if !left.isEmpty { controller.store.remove(left, origin: .kid) }
    }

    /// A line crossed out: one stroke through its middle, end to end. Returns the stroke.
    func strike(_ ids: [RecordID]) async -> [RecordID] {
        guard let box = box(of: ids) else { return [] }
        var rng = SplitMix(seed: 3)
        let y = box.y + box.h * 0.5
        return await write([[Vec2(box.x - 10, y + 4), Vec2(box.maxX + 10, y - 4)]], pace: nil, rng: &rng)
    }

    func kidStrokeIds() -> [RecordID] {
        controller.store.drawables(on: controller.currentScreenID).compactMap { r -> RecordID? in
            guard case .stroke(let s) = r, s.author == .kid else { return nil }
            return s.id
        }
    }

    /// The strokes' page points (page units).
    func points(_ ids: [RecordID]) -> [TrainingStroke] {
        ids.compactMap { controller.store.stroke($0) }.map { s in
            let pts = s.points.map { s.pagePoint($0) }
            return TrainingStroke(x: pts.map { ($0.x * 100).rounded() / 100 }, y: pts.map { ($0.y * 100).rounded() / 100 })
        }
    }

    func box(of ids: [RecordID]) -> Box? {
        let pts = ids.compactMap { controller.store.stroke($0) }.flatMap { s in s.points.map { s.pagePoint($0) } }
        return Box.around(pts)
    }

    // MARK: - the page as it looks

    /// The board as it looks now (JPEG, at most 1200 points wide).
    func snapshot() -> Data? {
        guard let canvas, canvas.bounds.width > 0 else { return nil }
        let scale = min(1, 1200 / canvas.bounds.width)
        let format = UIGraphicsImageRendererFormat()
        format.scale = scale
        let image = UIGraphicsImageRenderer(bounds: canvas.bounds, format: format).image { _ in
            canvas.drawHierarchy(in: canvas.bounds, afterScreenUpdates: false)
        }
        return image.jpegData(compressionQuality: 0.6)
    }

    // MARK: - waiting

    /// Waits until the loop has nothing in flight for the page (reads, checks), at most `timeout`.
    func settle(_ timeout: Duration = .seconds(12)) async {
        let deadline = ContinuousClock.now + timeout
        while ContinuousClock.now < deadline {
            if let loop, loop.trainingQuiet, !loop.busy { return }
            try? await Task.sleep(for: .milliseconds(150))
        }
    }

    static func densify(_ p: [Vec2]) -> [Vec2] {
        guard p.count >= 2 else { return p }
        var out: [Vec2] = [p[0]]
        for (a, b) in zip(p, p.dropFirst()) {
            let n = max(1, Int(a.dist(b) / 2))
            for k in 1...n { out.append(a.lerp(b, Double(k) / Double(n))) }
        }
        return out
    }
}
