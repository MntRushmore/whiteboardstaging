import AgathonBoard
import Foundation

/// The record-by-record merge of the web's `mergeDocumentRecords` (src/lib/sync/mergeDocumentRecords.ts):
/// another device saved first, so start from its document (`remote`) and lay this device's unsaved
/// edits over it. Local edits win.
///
/// - an id in `changed`: the local record (or, gone locally, a removal)
/// - an id in `removed`: removed, wherever it still is
/// - an id only here, untouched: the other device removed it
/// - an id only there, not removed here: the other device added it
/// - an id in both, untouched here, different: the other device's version
public enum RecordMerge {
    public struct Result: Equatable, Sendable {
        /// the merged document's records
        public var merged: [RecordID: BoardRecord]
        /// what turns the local store into `merged`: records to put, ids to remove
        public var put: [BoardRecord]
        public var remove: [RecordID]
    }

    public static func merge(
        local: [RecordID: BoardRecord], remote: [RecordID: BoardRecord], changed: Set<RecordID>, removed: Set<RecordID>
    ) -> Result {
        var merged: [RecordID: BoardRecord] = [:]
        merged.reserveCapacity(remote.count)
        var put: [BoardRecord] = []
        var remove: [RecordID] = []
        for (id, r) in remote {
            if removed.contains(id) {
                remove.append(id)
                continue
            }
            let mine = local[id]
            if changed.contains(id) {
                if let mine { merged[id] = mine } else { remove.append(id) }
                continue
            }
            merged[id] = r
            if mine != r { put.append(r) }
        }
        for (id, r) in local where remote[id] == nil {
            if removed.contains(id) { continue }
            if changed.contains(id) { merged[id] = r } else { remove.append(id) }
        }
        return Result(merged: merged, put: put.sorted { $0.id < $1.id }, remove: remove.sorted())
    }

    /// Applies a merge's plan to the store as the server's change (`.remote`: not unsaved, not undoable).
    @MainActor
    public static func apply(_ result: Result, to store: BoardStore) {
        guard !result.put.isEmpty || !result.remove.isEmpty else { return }
        store.transact(.remote) { tx in
            for r in result.put { tx.put(r) }
            for id in result.remove { tx.remove(id) }
        }
    }
}
