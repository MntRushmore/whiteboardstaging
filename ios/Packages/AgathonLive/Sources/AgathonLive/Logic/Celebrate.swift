import Foundation

/// What the board says when the tutor marks a line (src/lib/live/celebrate.ts): a cheer for a tick
/// (a streak from three in a row, a big burst on 5, 10, …), a kind word for a ring. A line cheers
/// once per verdict: a tick written again for the same line is no new right answer; a ring then a
/// tick on the same line (fixed) is.
public struct CelebrateState: Equatable, Sendable {
    public var verdicts: [String: LiveMarks.Kind] = [:]
    public var streak = 0
    public var wins = 0
    public var misses = 0

    public init() {}

    public enum Outcome: Equatable, Sendable {
        case win(text: String, streak: Int, big: Bool)
        case miss(text: String)
    }

    /// The tutor put `kind` on `lineId`: what to say, or nil (nothing new). Updates the state.
    public mutating func mark(_ lineId: String, _ kind: LiveMarks.Kind) -> Outcome? {
        guard kind != .question, verdicts[lineId] != kind else { return nil }
        verdicts[lineId] = kind
        if kind == .circle {
            let text = LiveCopy.Cheers.misses[misses % LiveCopy.Cheers.misses.count]
            streak = 0
            misses += 1
            return .miss(text: text)
        }
        streak += 1
        let text = LiveCopy.Cheers.wins[wins % LiveCopy.Cheers.wins.count]
        wins += 1
        return .win(text: text, streak: streak, big: LiveCopy.Cheers.milestones.contains(streak))
    }

    /// The line was rubbed out or rewritten: its verdict goes (a new mark on it is new).
    public mutating func forget(_ lineId: String) {
        verdicts[lineId] = nil
    }
}

/// When a mark counts for a cheer (`MarkSettler`): a tick after a moment, a ring only once the line
/// has stopped changing — a kid who lifts the pen mid-line has the half line read and ringed, and
/// finishing it ticks it a second later; a ring waiting for its moment is dropped when the tutor
/// takes it off or the kid writes on that line.
@MainActor
final class MarkSettler {
    private struct Pending {
        var timer: LiveTimer
        var kind: LiveMarks.Kind
        var line: BrainRect
    }

    private var pending: [String: Pending] = [:]
    private let scheduler: LiveScheduler
    private let onVerdict: (String, LiveMarks.Kind) -> Void

    init(scheduler: LiveScheduler, onVerdict: @escaping (String, LiveMarks.Kind) -> Void) {
        self.scheduler = scheduler
        self.onVerdict = onVerdict
    }

    func mark(_ lineId: String, _ kind: LiveMarks.Kind, line: BrainRect) {
        drop(lineId)
        guard kind != .question else { return }
        let timer = scheduler.after(kind == .circle ? LiveTiming.cheerMissSettleMs : LiveTiming.cheerSettleMs) { [weak self] in
            self?.pending[lineId] = nil
            self?.onVerdict(lineId, kind)
        }
        pending[lineId] = Pending(timer: timer, kind: kind, line: line)
    }

    /// The mark came off: a ring still waiting no longer counts.
    func removed(_ lineId: String) {
        if pending[lineId]?.kind == .circle { drop(lineId) }
    }

    /// The kid finished a stroke here: a waiting ring on the line it extends goes.
    func ink(_ box: BrainRect) {
        for (id, p) in pending where p.kind == .circle && Self.inkExtendsLine(box, p.line) { drop(id) }
    }

    func reset() {
        for p in pending.values { p.timer.cancel() }
        pending.removeAll()
    }

    private func drop(_ lineId: String) {
        pending[lineId]?.timer.cancel()
        pending[lineId] = nil
    }

    /// New ink that is more of this line: on its row, on it or just past its right end.
    static func inkExtendsLine(_ ink: BrainRect, _ line: BrainRect) -> Bool {
        let overlap = min(ink.maxY, line.maxY) - max(ink.y, line.y)
        if overlap < 0.3 * min(max(ink.h, 1), max(line.h, 1)) { return false }
        return ink.maxX >= line.x && ink.x <= line.maxX + 2 * line.h
    }
}
