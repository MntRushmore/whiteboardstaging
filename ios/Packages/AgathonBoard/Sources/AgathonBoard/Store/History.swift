import Foundation

/// The kid's undo and redo stacks. Only `.kid` changes land here: the tutor's writing, the board's
/// own changes and changes merged from the server are never undone by the kid.
@MainActor
public final class History {
    public struct Entry: Sendable {
        public var label: String
        public var changes: ChangeSet
    }

    /// Steps kept (the oldest drop off).
    public var limit = 200

    private(set) var undos: [Entry] = []
    private(set) var redos: [Entry] = []
    private var group: (label: String, entry: Entry?)?

    public var canUndo: Bool { !undos.isEmpty || group?.entry != nil }
    public var canRedo: Bool { !redos.isEmpty }
    public var undoCount: Int { undos.count + (group?.entry == nil ? 0 : 1) }

    func clear() {
        undos.removeAll()
        redos.removeAll()
        group = nil
    }

    func beginGroup(_ label: String) {
        endGroup()
        group = (label, nil)
    }

    func endGroup() {
        guard let g = group else { return }
        group = nil
        if let e = g.entry { push(e) }
    }

    func record(_ change: ChangeSet) {
        redos.removeAll()
        if var g = group {
            if var e = g.entry {
                e.changes = e.changes.squashed(with: change)
                g.entry = e
            } else {
                g.entry = Entry(label: g.label, changes: change)
            }
            group = g
            return
        }
        push(Entry(label: "", changes: change))
    }

    private func push(_ e: Entry) {
        guard !e.changes.isEmpty else { return }
        undos.append(e)
        if undos.count > limit { undos.removeFirst(undos.count - limit) }
    }

    func popUndo() -> Entry? { undos.popLast() }
    func popRedo() -> Entry? { redos.popLast() }
    func pushRedo(_ e: Entry) { redos.append(e) }
    func pushUndo(_ e: Entry) { undos.append(e) }
}
