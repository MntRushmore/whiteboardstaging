import AgathonBoard
import Foundation

/// The tutor's writing put straight into the store, every stroke at once and stamped as
/// `TutorWriter` stamps them (`live`, `source`, `createdAt`, `handBlock`, `handLine`): a board with no
/// canvas, and the tests. `hold` keeps the block back until `finish()` (a test of the kid writing
/// while the tutor is mid-block); `cancel()` then writes the lines begun — here, the first.
@MainActor
public final class InstantPen: TutorPen {
    private let store: BoardStore
    private let screen: RecordID
    private var pending: (lines: [TutorLine], meta: Meta, onDone: (() -> Void)?)?
    public private(set) var isWriting = false
    public let wallMs: Double = 0
    /// lines written so far (for tests)
    public private(set) var written: [TutorLine] = []

    public init(store: BoardStore, screen: RecordID) {
        self.store = store
        self.screen = screen
    }

    /// Writes now.
    public func write(_ lines: [TutorLine], meta: Meta, onDone: (() -> Void)? = nil) {
        commit(lines, meta: meta)
        onDone?()
    }

    /// Holds the block until `finish()` or `cancel()`.
    public func hold(_ lines: [TutorLine], meta: Meta, onDone: (() -> Void)?) {
        pending = (lines, meta, onDone)
        isWriting = true
    }

    /// Writes a held block whole.
    public func finish() {
        guard let p = pending else { return }
        pending = nil
        isWriting = false
        commit(p.lines, meta: p.meta)
        p.onDone?()
    }

    /// A held block: its first line (the one "begun") is finished, the rest dropped.
    public func cancel() {
        guard let p = pending else { return }
        pending = nil
        isWriting = false
        commit(Array(p.lines.prefix(1)), meta: p.meta)
        p.onDone?()
    }

    private func commit(_ lines: [TutorLine], meta: Meta) {
        let plan = HandPace.plan(lines)
        guard !plan.lines.isEmpty else { return }
        let now = (Date().timeIntervalSince1970 * 1000).rounded()
        var m = meta
        m["live"] = true
        m["source"] = m["source"] ?? "ai"
        m["createdAt"] = .number(now)
        let block = "hb_\(RecordID.make(.stroke).key)"
        store.transact(.tutor) { tx in
            var order = store.nextOrder(on: screen)
            for (i, line) in plan.lines.enumerated() {
                for j in line.strokes.indices {
                    tx.put(.stroke(HandPace.strokeRecord(plan, line: i, stroke: j, screen: screen, order: order, blockStart: now, block: block, meta: m)))
                    order = OrderKey.after(order)
                }
            }
        }
        written.append(contentsOf: lines)
    }
}
