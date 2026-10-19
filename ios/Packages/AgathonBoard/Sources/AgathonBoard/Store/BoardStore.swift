import Foundation

/// The live board: a typed record store in the spirit of tldraw's, built around Agathon's records.
///
/// Every change goes through a transaction (`transact`), which produces one `ChangeSet` (added /
/// updated / removed, record by record). That one diff feeds everything else:
///  - observers (the renderer, the Live loop later),
///  - the kid's undo stack (`origin == .kid` only: the tutor's writing is never undone by the kid),
///  - the dirty sets the autosave takes (`takeDirty`),
///  - the change log, numbered (`seq`), for a later live sync.
///
/// Main thread only. A whole board travels between threads as a `BoardDocument` value.
@MainActor
public final class BoardStore {
    public private(set) var records: [RecordID: BoardRecord] = [:]
    /// document-level meta (saved with the board)
    public var documentMeta: Meta = [:]

    /// Sequence number of the last change committed.
    public private(set) var seq: UInt64 = 0

    public let history = History()

    /// Change log for sync: the last `logLimit` change sets, oldest first.
    public var logLimit = 2_000
    private var log: [ChangeSet] = []

    // indexes
    private var screenIndex: [(order: OrderKey, id: RecordID)] = []
    private var drawIndex: [RecordID: [(order: OrderKey, id: RecordID)]] = [:]

    // dirty sets (the web's DirtyTracker semantics)
    private var dirtyChanged = Set<RecordID>()
    private var dirtyRemoved = Set<RecordID>()

    private var observers: [Int: (ChangeSet) -> Void] = [:]
    private var nextObserver = 0
    private var open: Transaction?

    public init(document: BoardDocument = .blank()) {
        load(document)
    }

    public var document: BoardDocument { BoardDocument(records: records, meta: documentMeta) }

    // MARK: - Loading

    /// Replaces the whole board (a board opened, a fixture). Observers get one `.load` change with
    /// every record added (and the old ones removed); undo, redo and the dirty sets are cleared.
    public func load(_ document: BoardDocument) {
        precondition(open == nil, "load inside a transaction")
        var change = ChangeSet(origin: .load)
        change.removed = records
        for (id, r) in document.records {
            if let old = change.removed.removeValue(forKey: id) {
                change.updated[id] = RecordUpdate(before: old, after: r)
            } else {
                change.added[id] = r
            }
        }
        records = document.records
        documentMeta = document.meta
        rebuildIndexes()
        history.clear()
        dirtyChanged.removeAll()
        dirtyRemoved.removeAll()
        seq += 1
        change.seq = seq
        log.removeAll()
        notify(change)
    }

    // MARK: - Transactions

    /// Runs `body` as one change. Nested calls join the outer transaction (its origin wins).
    @discardableResult
    public func transact<T>(_ origin: ChangeOrigin, _ body: (Transaction) throws -> T) rethrows -> T {
        if let open { return try body(open) }
        let tx = Transaction(store: self, origin: origin)
        open = tx
        defer { open = nil }
        let result: T
        do {
            result = try body(tx)
        } catch {
            tx.rollback()
            throw error
        }
        open = nil
        commit(tx)
        return result
    }

    /// One record in, as one change.
    public func put(_ record: BoardRecord, origin: ChangeOrigin) {
        transact(origin) { $0.put(record) }
    }

    public func remove(_ ids: [RecordID], origin: ChangeOrigin) {
        transact(origin) { tx in ids.forEach { tx.remove($0) } }
    }

    fileprivate func rawSet(_ id: RecordID, _ record: BoardRecord?) {
        records[id] = record
    }

    private func commit(_ tx: Transaction) {
        var change = ChangeSet(origin: tx.origin)
        for (id, before) in tx.initial {
            change.set(id, before: before, after: records[id])
        }
        guard !change.isEmpty else { return }
        updateIndexes(change)
        seq += 1
        change.seq = seq

        if change.origin.marksDirty {
            for id in change.ids {
                if records[id] == nil {
                    dirtyRemoved.insert(id)
                    dirtyChanged.remove(id)
                } else {
                    dirtyChanged.insert(id)
                    dirtyRemoved.remove(id)
                }
            }
        }
        if change.origin.isUndoable { history.record(change) }

        log.append(change)
        if log.count > logLimit { log.removeFirst(log.count - logLimit) }
        notify(change)
    }

    // MARK: - Undo / redo (the kid's)

    public var canUndo: Bool { history.canUndo }
    public var canRedo: Bool { history.canRedo }

    /// Opens an undo group: every kid change until `endUndoGroup` is one undo step (an eraser drag).
    public func beginUndoGroup(_ label: String) { history.beginGroup(label) }
    public func endUndoGroup() { history.endGroup() }

    /// Undoes the kid's last step. A record someone else (the tutor, another device) changed since is
    /// left as it is now: undo never overwrites work that is not the kid's step.
    @discardableResult
    public func undo() -> Bool {
        history.endGroup()
        guard let entry = history.popUndo() else { return false }
        apply(entry.changes, reverse: true)
        history.pushRedo(entry)
        return true
    }

    @discardableResult
    public func redo() -> Bool {
        history.endGroup()
        guard let entry = history.popRedo() else { return false }
        apply(entry.changes, reverse: false)
        history.pushUndo(entry)
        return true
    }

    private func apply(_ change: ChangeSet, reverse: Bool) {
        transact(.history) { tx in
            for id in change.ids {
                let from = reverse ? change.after(id) : change.before(id)
                let to = reverse ? change.before(id) : change.after(id)
                guard records[id] == from else { continue } // changed since by someone else: leave it
                if let to { tx.put(to) } else { tx.remove(id) }
            }
        }
    }

    // MARK: - Observers

    /// Calls `handler` after every committed change, on the main thread. Keep the subscription.
    public func observe(_ handler: @escaping (ChangeSet) -> Void) -> StoreSubscription {
        let key = nextObserver
        nextObserver += 1
        observers[key] = handler
        return StoreSubscription { [weak self] in
            if Thread.isMainThread {
                MainActor.assumeIsolated { _ = self?.observers.removeValue(forKey: key) }
            } else {
                Task { @MainActor [weak self] in _ = self?.observers.removeValue(forKey: key) }
            }
        }
    }

    private func notify(_ change: ChangeSet) {
        for key in observers.keys.sorted() { observers[key]?(change) }
    }

    // MARK: - Change log (sync)

    /// The changes committed after `seq`, oldest first; nil when the log no longer reaches back that
    /// far (the caller must send the whole document instead).
    public func changes(since seq: UInt64) -> [ChangeSet]? {
        if seq >= self.seq { return [] }
        guard let first = log.first, first.seq <= seq + 1 else { return nil }
        return log.filter { $0.seq > seq }
    }

    // MARK: - Dirty sets (autosave)

    public struct DirtyToken: Equatable, Sendable {
        public var changed: Set<RecordID>
        public var removed: Set<RecordID>
        public var isEmpty: Bool { changed.isEmpty && removed.isEmpty }
    }

    public var hasUnsavedChanges: Bool { !dirtyChanged.isEmpty || !dirtyRemoved.isEmpty }

    /// Hands the pending sets to a save and starts fresh ones (edits during the save stay pending).
    public func takeDirty() -> DirtyToken {
        defer {
            dirtyChanged.removeAll()
            dirtyRemoved.removeAll()
        }
        return DirtyToken(changed: dirtyChanged, removed: dirtyRemoved)
    }

    /// A save failed: its sets go back, under anything newer.
    public func restoreDirty(_ token: DirtyToken) {
        for id in token.changed where !dirtyRemoved.contains(id) { dirtyChanged.insert(id) }
        for id in token.removed where !dirtyChanged.contains(id) { dirtyRemoved.insert(id) }
    }

    public func peekDirty() -> DirtyToken { DirtyToken(changed: dirtyChanged, removed: dirtyRemoved) }

    // MARK: - Reading

    public subscript(id: RecordID) -> BoardRecord? { records[id] }

    public func stroke(_ id: RecordID) -> StrokeRecord? { records[id]?.stroke }

    /// The screens in order.
    public var screens: [ScreenRecord] { screenIndex.compactMap { records[$0.id]?.screen } }

    public var screenIDs: [RecordID] { screenIndex.map(\.id) }

    /// Drawn records of a screen, bottom to top.
    public func drawables(on screen: RecordID) -> [BoardRecord] {
        (drawIndex[screen] ?? []).compactMap { records[$0.id] }
    }

    public func drawableIDs(on screen: RecordID) -> [RecordID] { (drawIndex[screen] ?? []).map(\.id) }

    public func drawableCount(on screen: RecordID) -> Int { drawIndex[screen]?.count ?? 0 }

    /// The `count` topmost drawn records of `screen`, bottom to top.
    public func topDrawableIDs(on screen: RecordID, count: Int) -> [RecordID] {
        guard let list = drawIndex[screen] else { return [] }
        return list.suffix(count).map(\.id)
    }

    /// The order key for a record put on top of everything on `screen`.
    public func nextOrder(on screen: RecordID) -> OrderKey {
        OrderKey.after(drawIndex[screen]?.last?.order)
    }

    /// The order key of the topmost drawn record of `screen` (nil when it is empty).
    public func topOrder(on screen: RecordID) -> OrderKey? { drawIndex[screen]?.last?.order }

    /// Whether `id` is on top of every other drawn record of its screen.
    public func isTopmost(_ id: RecordID) -> Bool {
        guard let r = records[id], let s = r.screenID else { return false }
        return drawIndex[s]?.last?.id == id
    }

    /// Strokes on the board (kept as records come and go).
    public private(set) var strokeCount = 0

    // MARK: - Indexes

    private func rebuildIndexes() {
        screenIndex = []
        drawIndex = [:]
        strokeCount = 0
        for r in records.values {
            if case .stroke = r { strokeCount += 1 }
            if case .screen(let s) = r {
                screenIndex.append((s.order, s.id))
            } else if r.isDrawable, let s = r.screenID, let o = r.order {
                drawIndex[s, default: []].append((o, r.id))
            }
        }
        screenIndex.sort(by: Self.less)
        for k in drawIndex.keys { drawIndex[k]!.sort(by: Self.less) }
    }

    private static func less(_ a: (order: OrderKey, id: RecordID), _ b: (order: OrderKey, id: RecordID)) -> Bool {
        a.order != b.order ? a.order < b.order : a.id < b.id
    }

    private func updateIndexes(_ change: ChangeSet) {
        for id in change.ids {
            let before = change.before(id)
            let after = change.after(id)
            if before?.type == .stroke { strokeCount -= 1 }
            if after?.type == .stroke { strokeCount += 1 }
            if before?.type == .screen || after?.type == .screen {
                if let b = before, let o = b.order { removeEntry(&screenIndex, (o, id)) }
                if let a = after, let o = a.order { insertEntry(&screenIndex, (o, id)) }
                continue
            }
            if let b = before, b.isDrawable, let s = b.screenID, let o = b.order {
                if after?.screenID == s && after?.order == o && after?.isDrawable == true { continue }
                removeEntry(&drawIndex[s, default: []], (o, id))
            }
            if let a = after, a.isDrawable, let s = a.screenID, let o = a.order {
                insertEntry(&drawIndex[s, default: []], (o, id))
            }
        }
    }

    private func position(_ list: [(order: OrderKey, id: RecordID)], _ e: (order: OrderKey, id: RecordID)) -> Int {
        var lo = 0
        var hi = list.count
        while lo < hi {
            let mid = (lo + hi) / 2
            if Self.less(list[mid], e) { lo = mid + 1 } else { hi = mid }
        }
        return lo
    }

    private func insertEntry(_ list: inout [(order: OrderKey, id: RecordID)], _ e: (order: OrderKey, id: RecordID)) {
        // the common case: on top
        if let last = list.last, Self.less(last, e) {
            list.append(e)
            return
        }
        list.insert(e, at: position(list, e))
    }

    private func removeEntry(_ list: inout [(order: OrderKey, id: RecordID)], _ e: (order: OrderKey, id: RecordID)) {
        let i = position(list, e)
        if i < list.count && list[i].id == e.id { list.remove(at: i) }
    }
}

/// One transaction's handle: reads see its own writes.
@MainActor
public final class Transaction {
    unowned let store: BoardStore
    public let origin: ChangeOrigin
    /// each touched record as it was before the transaction (nil: absent)
    fileprivate(set) var initial: [RecordID: BoardRecord?] = [:]

    fileprivate init(store: BoardStore, origin: ChangeOrigin) {
        self.store = store
        self.origin = origin
    }

    public subscript(id: RecordID) -> BoardRecord? { store.records[id] }

    private func touch(_ id: RecordID) {
        if initial.index(forKey: id) == nil { initial[id] = .some(store.records[id]) }
    }

    /// Adds or replaces a record. A stroke from the kid or the tutor is normalized first (points
    /// quantized as saved, the kid's ink never in the tutor's colour).
    public func put(_ record: BoardRecord) {
        touch(record.id)
        var r = record
        if case .stroke(let s) = record, origin != .load, origin != .remote, origin != .history {
            r = .stroke(s.normalized())
        }
        store.rawSet(record.id, r)
    }

    public func remove(_ id: RecordID) {
        guard store.records[id] != nil else { return }
        touch(id)
        store.rawSet(id, nil)
    }

    /// Updates a stroke in place (no-op when it is missing).
    public func updateStroke(_ id: RecordID, _ body: (inout StrokeRecord) -> Void) {
        guard case .stroke(var s) = store.records[id] else { return }
        body(&s)
        put(.stroke(s))
    }

    fileprivate func rollback() {
        for (id, before) in initial { store.rawSet(id, before) }
        initial.removeAll()
    }
}

/// Keeps an observer registered until cancelled or released.
public final class StoreSubscription {
    private var onCancel: (() -> Void)?
    init(_ onCancel: @escaping () -> Void) { self.onCancel = onCancel }
    public func cancel() {
        onCancel?()
        onCancel = nil
    }

    deinit { onCancel?() }
}
