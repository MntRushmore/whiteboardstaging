import Foundation

/// Where a change came from. Decides whether the kid can undo it and whether it needs saving.
public enum ChangeOrigin: String, Sendable {
    /// the kid's hand: undoable, saved
    case kid
    /// the tutor (the Live loop's writing, marks, reads): saved, never in the kid's undo stack
    case tutor
    /// the board itself (a screen grown around old ink, a conversion): saved, not undoable
    case system
    /// the kid's undo or redo: saved; moves an entry between the stacks instead of adding one
    case history
    /// the server's copy merged in (another device saved first): already saved, not undoable
    case remote
    /// a board loaded: nothing to save, nothing to undo
    case load

    public var isUndoable: Bool { self == .kid }
    public var marksDirty: Bool { self != .remote && self != .load }
}

/// A record before and after an update.
public struct RecordUpdate: Equatable, Sendable {
    public var before: BoardRecord
    public var after: BoardRecord
}

/// What one transaction did, record by record: the diff that undo, saving, rendering and a later
/// live sync (phone as pen, a parent watching) all read.
///
/// Within one change set a record appears at most once: a record added then updated is `added` (as
/// it ended), added then removed is not there at all, updated then removed is `removed` (as it was
/// before), removed then added again is `updated`.
public struct ChangeSet: Sendable {
    public var added: [RecordID: BoardRecord] = [:]
    public var updated: [RecordID: RecordUpdate] = [:]
    public var removed: [RecordID: BoardRecord] = [:]
    public var origin: ChangeOrigin
    /// the store's sequence number for this change (the change log's key)
    public var seq: UInt64 = 0

    public init(origin: ChangeOrigin) {
        self.origin = origin
    }

    public var isEmpty: Bool { added.isEmpty && updated.isEmpty && removed.isEmpty }
    public var count: Int { added.count + updated.count + removed.count }

    /// Every id the change touches.
    public var ids: Set<RecordID> {
        var s = Set(added.keys)
        s.formUnion(updated.keys)
        s.formUnion(removed.keys)
        return s
    }

    /// The record as it was before the change (nil: it did not exist).
    public func before(_ id: RecordID) -> BoardRecord? {
        if added[id] != nil { return nil }
        if let u = updated[id] { return u.before }
        return removed[id]
    }

    /// The record after the change (nil: it does not exist).
    public func after(_ id: RecordID) -> BoardRecord? {
        if let a = added[id] { return a }
        if let u = updated[id] { return u.after }
        return nil
    }

    /// Sets the change of one record from its state before (nil: absent) and after (nil: absent).
    mutating func set(_ id: RecordID, before: BoardRecord?, after: BoardRecord?) {
        added[id] = nil
        updated[id] = nil
        removed[id] = nil
        switch (before, after) {
        case (nil, nil): break
        case (nil, let a?): added[id] = a
        case (let b?, nil): removed[id] = b
        case (let b?, let a?): if b != a { updated[id] = RecordUpdate(before: b, after: a) }
        }
    }

    /// This change followed by `next`, as one change.
    public func squashed(with next: ChangeSet) -> ChangeSet {
        var out = self
        for id in next.ids {
            let start = ids.contains(id) ? before(id) : next.before(id)
            out.set(id, before: start, after: next.after(id))
        }
        return out
    }

    /// The change that undoes this one.
    public func inverted(origin: ChangeOrigin) -> ChangeSet {
        var out = ChangeSet(origin: origin)
        for (id, r) in added { out.removed[id] = r }
        for (id, r) in removed { out.added[id] = r }
        for (id, u) in updated { out.updated[id] = RecordUpdate(before: u.after, after: u.before) }
        return out
    }
}
