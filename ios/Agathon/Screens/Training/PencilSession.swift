import AgathonBoard
import AgathonBrain
import AgathonKit
import AgathonLive
import Foundation
import os

/// MY PENCIL: the owner writes on the training board with the Apple Pencil — a problem the tutor
/// writes at the top of a fresh page (a grade and topic from the brain's practice generators), or a
/// blank page of their own — and says 👍 or 👎 to what the tutor did with each line (and what it
/// should have done). Every page is saved as a training case: its strokes, the reads, the verdicts,
/// the marks and the reviews, tagged with the handwriting it was written in.
@MainActor
final class PencilSession: ObservableObject {
    /// Where the next page's problem comes from.
    enum Source: Hashable, Codable {
        case generated(grade: TrainingGrade, skill: String)
        case own

        var title: String {
            switch self {
            case .generated(let grade, let skill): return "\(PencilSession.skillName(skill)) · \(grade.rawValue)"
            case .own: return "My own problem"
            }
        }
    }

    /// The page being written.
    struct Page {
        var id = UUID()
        var number: Int
        var screen: RecordID
        var problem: [String]
        var source: Source
        var startedAt = Date()
        var callsBefore: [String: Int]
        var readsBefore: Int
    }

    let board: TrainingBoard
    @Published private(set) var run: TrainingRun
    @Published var style: HandwritingStyle {
        didSet { UserDefaults.standard.set(style.rawValue, forKey: Self.styleKey) }
    }
    @Published var otherStyle: String {
        didSet { UserDefaults.standard.set(otherStyle, forKey: Self.otherKey) }
    }
    @Published var source: Source {
        didSet { if let data = try? JSONEncoder().encode(source) { UserDefaults.standard.set(data, forKey: Self.sourceKey) } }
    }
    @Published private(set) var page: Page?
    /// the reviews on the page being written, by the tutor's line id
    @Published private(set) var reviews: [String: TrainingReview] = [:]
    /// lines the owner passed over without a review ("Not now")
    @Published private(set) var skipped = Set<String>()
    @Published private(set) var busy = false
    @Published var message: String?
    private weak var backend: AgathonBackend?
    private var seed = Int(Date().timeIntervalSince1970) % 100_000
    private var pageCount = 0

    static let styleKey = "agathon.training.style"
    static let otherKey = "agathon.training.styleOther"
    static let sourceKey = "agathon.training.source"

    init(backend: AgathonBackend) {
        self.backend = backend
        let settings = LiveSettings(enabled: true, mode: .feedback, auto: true, handwriting: true, celebrations: true,
                                    checking: .whenDone, showReadings: true)
        // My Pencil's budget is generous: the owner writes at a person's pace, and each call is one they made
        board = TrainingBoard(backend: backend, budget: 400, settings: settings)
        run = TrainingRun(kind: .pencil, target: TrainingSync.target(backend), appBuild: TrainingSync.appBuild)
        style = HandwritingStyle(rawValue: UserDefaults.standard.string(forKey: Self.styleKey) ?? "") ?? .neat
        otherStyle = UserDefaults.standard.string(forKey: Self.otherKey) ?? ""
        if let data = UserDefaults.standard.data(forKey: Self.sourceKey), let s = try? JSONDecoder().decode(Source.self, from: data) {
            source = s
        } else {
            source = .generated(grade: .g56, skill: "two_step_equations")
        }
    }

    var styleTag: String { HandwritingStyle.tag(style, other: otherStyle) }

    /// The board is up: the first page.
    func start() async {
        guard page == nil, await board.ready() else { return }
        TrainingStore.shared.save(run)
        await openPage()
    }

    /// Next: this page is saved, and a fresh one opens (a new problem, or a blank page of their own).
    func next() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        await saveCurrent()
        if board.pagesLeft < 2 {
            message = "This training board is full (50 pages). Close it and start a new session."
            return
        }
        await openPage()
    }

    /// Leaving: the page is saved, the board let go.
    func close() async {
        await saveCurrent()
        run.status = .done
        run.finishedAt = Date()
        if let backend { run = await TrainingSync.save(run, backend: backend) }
        board.stop()
    }

    private func openPage() async {
        busy = true
        defer { busy = false }
        pageCount += 1
        reviews = [:]
        skipped = []
        let calls = board.services.calls
        let reads = board.services.reads.count
        switch source {
        case .own:
            guard let screen = board.ownPage() else { return }
            page = Page(number: pageCount, screen: screen, problem: [], source: .own, callsBefore: calls, readsBefore: reads)
        case .generated(_, let skill):
            var problem: [String]?
            for attempt in 0..<4 {
                seed += 1
                if let p = (try? await Brain.shared.practice(skill: skill, count: 1, seed: seed))?.first, !p.isEmpty,
                   await board.problemPage(p, set: "pencil") {
                    problem = p
                    break
                }
                if attempt == 3 { message = "The brain has no problem for that topic right now: try another." }
            }
            guard let problem else { return }
            page = Page(number: pageCount, screen: board.controller.currentScreenID, problem: problem, source: source, callsBefore: calls, readsBefore: reads)
        }
    }

    // MARK: - reviews

    /// The page's lines as the tutor holds them (top to bottom, column by column).
    var lines: [LiveLine] {
        guard let loop = board.loop else { return [] }
        return loop.lines.values.sorted { ($0.column, $0.row) < ($1.column, $1.row) }
    }

    /// The tutor has had its say on this line: read, and marked (or checked and left be).
    func answered(_ line: LiveLine) -> Bool {
        guard let loop = board.loop, !line.latex.isEmpty else { return false }
        return loop.trainingMark(on: line.id) != .none || loop.trainingObserve(strokes: line.ink.strokeIds.map { RecordID($0) }, others: []).released
    }

    /// The next line to ask about: answered, and neither reviewed nor passed over.
    var asking: LiveLine? {
        lines.first { answered($0) && reviews[$0.id] == nil && !skipped.contains($0.id) }
    }

    func review(_ lineId: String, _ review: TrainingReview) {
        reviews[lineId] = review
        Task { await saveCurrent() }
    }

    func skip(_ lineId: String) {
        skipped.insert(lineId)
    }

    // MARK: - saving

    /// The page as a training case (its lines, strokes, reads, marks and reviews), saved on this iPad
    /// and to Supabase. A page with no ink is not saved.
    func saveCurrent() async {
        guard let page, let loop = board.loop, board.controller.currentScreenID == page.screen else { return }
        let lines = self.lines.filter { !$0.ink.strokeIds.isEmpty }
        guard !lines.isEmpty else { return }
        var results: [TrainingLineResult] = []
        var strokes: [[TrainingStroke]] = []
        for (i, st) in lines.enumerated() {
            let ids = st.ink.strokeIds.map { RecordID($0) }
            let obs = loop.trainingObserve(strokes: ids, others: [])
            let review = reviews[st.id]
            var r = TrainingLineResult(index: i, written: review?.latex ?? st.latex, meaning: review?.latex ?? st.latex, expect: nil, value: nil,
                                       place: Self.place(of: st, on: board), read: st.latex.isEmpty ? nil : st.latex, provider: obs.provider,
                                       confidence: obs.confidence, reading: obs.reading, verdict: obs.verdict, kind: obs.kind, result: obs.result,
                                       mark: obs.mark, released: obs.released, pieces: 1, readMs: obs.readMs, markMs: obs.markMs,
                                       review: review, lineId: st.id)
            if let review {
                r.pass = review.thumbsUp
                r.readRight = review.should == .misread ? false : true
                if !review.thumbsUp { r.why = Self.why(review, mark: obs.mark, read: st.latex) }
            }
            results.append(r)
            strokes.append(board.points(ids))
        }
        let judged = results.compactMap(\.pass)
        let grade: TrainingGrade?
        let topic: String
        if case .generated(let g, let skill) = page.source {
            grade = g
            topic = skill
        } else {
            grade = nil
            topic = "own"
        }
        let result = TrainingCaseResult(
            id: page.id, kind: .pencil, caseKey: "pencil:\(topic):\(page.number)", category: page.source == .own ? .ownProblem : .generated,
            grade: grade, topic: topic, hand: styleTag, problem: page.problem, spec: nil, lines: results, strokes: strokes,
            reads: Array(board.services.reads.dropFirst(page.readsBefore)), solvedExpected: nil, solvedGot: loop.trainingSolved,
            pass: judged.isEmpty ? nil : judged.allSatisfy { $0 }, calls: Self.diff(board.services.calls, page.callsBefore),
            ms: Date().timeIntervalSince(page.startedAt) * 1000,
            snapshot: judged.contains(false) ? board.snapshot() : nil,
            regression: run.cases.first { $0.id == page.id }?.regression ?? false, createdAt: page.startedAt)
        if let i = run.cases.firstIndex(where: { $0.id == page.id }) {
            run.cases[i] = result
        } else {
            run.cases.append(result)
        }
        guard let backend else {
            TrainingStore.shared.save(run)
            return
        }
        let saved = await TrainingSync.save(run, backend: backend, cases: [page.id])
        run.synced = saved.synced
        run.syncNote = saved.syncNote
    }

    /// Marks the page (or a saved one) as a regression test.
    func markRegression(_ id: UUID) {
        guard let i = run.cases.firstIndex(where: { $0.id == id }) else { return }
        run.cases[i].regression = true
        guard let backend else { return }
        Task { @MainActor in run = await TrainingSync.save(run, backend: backend, cases: [id]) }
    }

    static func why(_ review: TrainingReview, mark: TrainingMark, read: String) -> TrainingWhy {
        let note = review.note.map { " \($0)" } ?? ""
        switch review.should {
        case .misread?:
            return TrainingWhy(.misread, "Misread: read \(read), it says \(review.latex ?? "?").\(note)")
        case .ring?:
            return TrainingWhy(.missedRing, "Should have ringed it; it got \(mark.words).\(note)")
        case .tick?:
            return TrainingWhy(mark == .ring ? .wrongRing : .wrongMark, "Should have ticked it; it got \(mark.words).\(note)")
        case .quiet?:
            return TrainingWhy(mark == .ring ? .wrongRing : .wrongMark, "Should have left it; it got \(mark.words).\(note)")
        case nil:
            return TrainingWhy(.wrongMark, "Not right: \(mark.words).\(note)")
        }
    }

    static func place(of st: LiveLine, on board: TrainingBoard) -> TrainingPlace {
        let rect = board.page.rect
        let b = ProblemPageLayout.unplace(Box(x: st.bounds.x, y: st.bounds.y, w: st.bounds.w, h: st.bounds.h), from: rect)
        if ProblemPageLayout.isInAnswer(b) { return .answer }
        if b.maxY < board.page.workTop { return .problem }
        return .work
    }

    static func diff(_ now: [String: Int], _ before: [String: Int]) -> [String: Int] {
        var out: [String: Int] = [:]
        for (k, v) in now where v - (before[k] ?? 0) > 0 { out[k] = v - (before[k] ?? 0) }
        return out
    }

    // MARK: - topics

    /// The practice topics My Pencil offers, by grade band (the bench's own list).
    nonisolated static func skills(_ grade: TrainingGrade) -> [String] { TrainingGenerator.skills[grade] ?? [] }

    nonisolated static func skillName(_ id: String) -> String {
        id.replacingOccurrences(of: "_", with: " ").capitalizedFirstLetter
    }
}

private extension String {
    var capitalizedFirstLetter: String { prefix(1).uppercased() + dropFirst() }
}
