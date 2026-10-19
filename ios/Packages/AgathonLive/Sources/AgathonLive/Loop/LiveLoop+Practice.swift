import AgathonBoard
import AgathonBrain
import Foundation

/// What the loop remembers about each problem worked on this board, enough to know when to offer
/// "Now you try one" (the web's attempt tracker, `src/lib/learning/tracker.ts`, decides the same
/// from its outcomes: `tutor_solved`, or `with_help` — the kid finished after the tutor helped).
/// The learning record itself (`learning_attempts`) is not written from here yet.
struct ProblemTracker {
    struct Attempt {
        var lines = 0
        var rights = 0
        var rings = 0
        var helps = 0
        var tutorSolved = false
        var kidSolved = false
    }

    private(set) var attempts: [String: Attempt] = [:]

    mutating func wrote(problem: String) {
        attempts[problem, default: Attempt()].lines += 1
    }

    mutating func marked(problem: String, right: Bool) {
        if right { attempts[problem, default: Attempt()].rights += 1 } else { attempts[problem, default: Attempt()].rings += 1 }
    }

    mutating func helped(problem: String, solved: Bool) {
        attempts[problem, default: Attempt()].helps += 1
        if solved { attempts[problem, default: Attempt()].tutorSolved = true }
    }

    mutating func tutorSolved(problem: String) {
        attempts[problem, default: Attempt()].tutorSolved = true
    }

    /// The kid's line solved the problem: true when they had help on the way (an offer is due).
    mutating func solvedByKid(problem: String) -> Bool {
        var a = attempts[problem, default: Attempt()]
        let first = !a.kidSolved
        a.kidSolved = true
        attempts[problem] = a
        return first && a.helps > 0
    }

    /// `first_try`, `self_corrected`, `with_help`, `tutor_solved`, `in_progress` (the web's outcomes).
    func outcome(problem: String) -> String {
        guard let a = attempts[problem] else { return "in_progress" }
        if a.tutorSolved { return "tutor_solved" }
        if a.kidSolved { return a.helps > 0 ? "with_help" : (a.rings > 0 ? "self_corrected" : "first_try") }
        return "in_progress"
    }
}

extension LiveLoop {
    // MARK: - Now you try

    /// After the tutor solved a problem, or helped the kid finish it: one more like it, made on the
    /// device by the background brain (`variantOf`: same form, new numbers, checked by the engine).
    /// Once per problem; never two offers at once.
    func offerNowYouTry(problem key: String, lines problem: [String]) {
        guard !problem.isEmpty, offer == nil, !offeredFor.contains(key), engineReady else { return }
        offeredFor.insert(key)
        let seed = Int(LiveSeeds.handSeed(key) & 0x7fff_ffff)
        // the learning record's name for the problem it follows (its attempt is the new one's parent)
        let parentKey = learn.loopKeys[key]
        let background = self.background
        let screen = board.currentScreenID
        track { [weak self] in
            // the slow search runs on the other brain: reads and marks on this one never wait for it
            let variant: [String]?
            do {
                try await background.load()
                variant = try await background.variantOf(problem, seed: seed)
            } catch {
                variant = nil
            }
            guard let self, let variant, !variant.isEmpty, self.board.currentScreenID == screen, self.offer == nil else { return }
            self.offer = NowYouTryOffer(id: "\(seed)", problem: variant, parent: problem)
            self.learn.offerParents["\(seed)"] = parentKey
            Self.log.notice("live: now you try offered (\(variant.joined(separator: " ; "), privacy: .public))")
        }
    }

    /// "Not now".
    public func dismissOffer() {
        offer = nil
    }

    /// "Now you try one": the tutor writes the new problem in its hand — under the work when there is
    /// room, else on a new screen — as a `problem` record (origin `nowYouTry`), so the kid's lines
    /// under it are checked against it.
    public func takeOffer() {
        guard let offer else { return }
        self.offer = nil
        let parentKey = learn.offerParents.removeValue(forKey: offer.id)
        track { [weak self] in
            guard let self else { return }
            // the attempt it follows (`parentId`), once what the board said before has landed
            var parentAttempt: String?
            if let parentKey { parentAttempt = await self.learning.attemptId(forProblemKey: parentKey) }
            if !(await self.writeProblem(offer.problem, origin: "nowYouTry", parent: offer.parent.joined(separator: "\n"), parentAttempt: parentAttempt)) {
                self.say(LiveCopy.NowYouTry.failed)
            }
        }
    }

    /// Writes a problem for the kid: placed under the work (or on a fresh screen), in the tutor's
    /// hand at the kid's size.
    func writeProblem(_ problem: [String], origin: String, parent: String?, parentAttempt: String? = nil) async -> Bool {
        let kidHeight = lines.values.map(\.bounds.h).sorted().dropFirst(lines.count / 2).first ?? 48
        guard let plan = await plan(problem, lineHeight: max(40, kidHeight), seedKey: "problem:\(problem.joined())") else { return false }
        let screenRect = board.screenRect
        let margin = 80.0
        let used = BrainRect.around(avoidRects())
        var at = AgathonBrain.Point(x: screenRect.x + margin, y: screenRect.y + margin)
        if let used {
            let below = used.maxY + 70
            // room for the problem and three lines of work under it
            if below + plan.bounds.h + 3 * 70 < screenRect.maxY {
                at = AgathonBrain.Point(x: max(screenRect.x + margin, used.x), y: below)
            } else if board.addScreen() != nil {
                // a new screen: the loop takes it in now (not when the board's notice arrives), then
                // the problem is written on it
                switchScreen()
                let fresh = board.screenRect
                at = AgathonBrain.Point(x: fresh.x + margin, y: fresh.y + margin)
            }
        }
        let placed = Self.moved(plan, to: at)
        let id = RecordID.make(.problem)
        var meta: Meta = [LiveMeta.rect: placed.bounds.meta]
        if let parent { meta[LiveMeta.parent] = .string(parent) }
        if let parentAttempt { meta[Self.parentAttemptMeta] = .string(parentAttempt) }
        let record = ProblemRecord(id: id, screen: board.currentScreenID, lines: [], latex: problem.joined(separator: "\n"), origin: origin, meta: meta)
        board.store.put(.problem(record), origin: .tutor)
        refreshHeads()
        reanchorLines()
        startHandwriting(placed, lineId: "problem:\(id.key)")
        return true
    }
}
