import Foundation
import Testing
@testable import AgathonBoard

@MainActor
struct StoreDiffTests {
    @Test func transactionProducesOneChangeSet() {
        let store = storeWithScreen()
        var seen: [ChangeSet] = []
        let sub = store.observe { seen.append($0) }
        let a = line("stroke:a", 0, 100, y: 10, order: "a1")
        let b = line("stroke:b", 0, 100, y: 30, order: "a2")
        store.transact(.kid) { tx in
            tx.put(.stroke(a))
            tx.put(.stroke(b))
        }
        #expect(seen.count == 1)
        #expect(Set(seen[0].added.keys) == ["stroke:a", "stroke:b"])
        #expect(seen[0].updated.isEmpty && seen[0].removed.isEmpty)
        #expect(seen[0].origin == .kid)
        #expect(seen[0].seq == store.seq)
        sub.cancel()
    }

    @Test func squashRulesWithinATransaction() {
        let store = storeWithScreen()
        store.put(.stroke(line("stroke:old", 0, 50, y: 0, order: "a1")), origin: .kid)
        var last: ChangeSet?
        let sub = store.observe { last = $0 }
        store.transact(.kid) { tx in
            // added then updated → added (as it ended)
            tx.put(.stroke(line("stroke:n", 0, 10, y: 0, order: "a2")))
            tx.updateStroke("stroke:n") { $0.color = .red }
            // added then removed → nothing
            tx.put(.stroke(line("stroke:tmp", 0, 10, y: 0, order: "a3")))
            tx.remove("stroke:tmp")
            // updated then removed → removed (as it was)
            tx.updateStroke("stroke:old") { $0.color = .green }
            tx.remove("stroke:old")
        }
        let c = try! #require(last)
        #expect(c.added.keys.sorted() == ["stroke:n"])
        #expect(c.added["stroke:n"]?.stroke?.color == .red)
        #expect(c.removed.keys.sorted() == ["stroke:old"])
        #expect(c.removed["stroke:old"]?.stroke?.color == .black)
        #expect(c.updated.isEmpty)
        _ = sub
    }

    @Test func removedThenAddedIsAnUpdate() {
        let store = storeWithScreen()
        store.put(.stroke(line("stroke:x", 0, 50, y: 0, order: "a1")), origin: .kid)
        var last: ChangeSet?
        let sub = store.observe { last = $0 }
        store.transact(.kid) { tx in
            tx.remove("stroke:x")
            var s = line("stroke:x", 0, 50, y: 0, order: "a1")
            s.color = .violet
            tx.put(.stroke(s))
        }
        #expect(last?.updated["stroke:x"]?.before.stroke?.color == .black)
        #expect(last?.updated["stroke:x"]?.after.stroke?.color == .violet)
        _ = sub
    }

    @Test func noOpTransactionNotifiesNobody() {
        let store = storeWithScreen()
        let s = line("stroke:x", 0, 50, y: 0, order: "a1")
        store.put(.stroke(s), origin: .kid)
        let seq = store.seq
        var calls = 0
        let sub = store.observe { _ in calls += 1 }
        store.put(.stroke(s), origin: .kid) // the same record again
        #expect(calls == 0)
        #expect(store.seq == seq)
        _ = sub
    }

    @Test func throwingTransactionRollsBack() {
        struct Boom: Error {}
        let store = storeWithScreen()
        #expect(throws: Boom.self) {
            try store.transact(.kid) { tx in
                tx.put(.stroke(line("stroke:x", 0, 50, y: 0, order: "a1")))
                throw Boom()
            }
        }
        #expect(store["stroke:x"] == nil)
        #expect(!store.canUndo)
    }

    @Test func drawIndexKeepsZOrder() {
        let store = storeWithScreen()
        store.put(.stroke(line("stroke:c", 0, 50, y: 0, order: "a3")), origin: .kid)
        store.put(.stroke(line("stroke:a", 0, 50, y: 0, order: "a1")), origin: .kid)
        store.put(.stroke(line("stroke:b", 0, 50, y: 0, order: "a2")), origin: .kid)
        #expect(store.drawableIDs(on: "screen:a") == ["stroke:a", "stroke:b", "stroke:c"])
        #expect(store.isTopmost("stroke:c"))
        #expect(store.nextOrder(on: "screen:a") > "a3")
        store.transact(.kid) { $0.updateStroke("stroke:a") { $0.order = "a4" } }
        #expect(store.drawableIDs(on: "screen:a") == ["stroke:b", "stroke:c", "stroke:a"])
        store.remove(["stroke:b"], origin: .kid)
        #expect(store.drawableIDs(on: "screen:a") == ["stroke:c", "stroke:a"])
    }

    @Test func strokesAreNormalizedOnTheWayIn() {
        let store = storeWithScreen()
        var s = line("stroke:x", 0, 50, y: 0, order: "a1")
        s.points[1].x = 2.0123456
        store.put(.stroke(s), origin: .kid)
        let stored = try! #require(store.stroke("stroke:x"))
        #expect(stored.points[1].x == 2.0) // 1/16 page unit grid
        #expect(stored == stored.normalized())
    }
}

@MainActor
struct UndoTests {
    @Test func kidStepsUndoAndRedo() {
        let store = storeWithScreen()
        store.put(.stroke(line("stroke:1", 0, 50, y: 0, order: "a1")), origin: .kid)
        store.put(.stroke(line("stroke:2", 0, 50, y: 20, order: "a2")), origin: .kid)
        #expect(store.canUndo)
        store.undo()
        #expect(store["stroke:2"] == nil && store["stroke:1"] != nil)
        store.undo()
        #expect(store["stroke:1"] == nil)
        #expect(!store.canUndo && store.canRedo)
        store.redo()
        store.redo()
        #expect(store["stroke:1"] != nil && store["stroke:2"] != nil)
        #expect(!store.canRedo)
    }

    @Test func tutorWritesAreNotUndoableByTheKid() {
        let store = storeWithScreen()
        store.put(.stroke(line("stroke:kid", 0, 50, y: 0, order: "a1")), origin: .kid)
        store.put(.stroke(line("stroke:tutor", 0, 50, y: 40, order: "a2", author: .tutor)), origin: .tutor)
        store.put(.line(LineRecord(id: "line:1", screen: "screen:a", strokes: ["stroke:kid"], latex: "x=4", verdict: .ok)), origin: .tutor)
        #expect(store.history.undoCount == 1)
        store.undo() // undoes the kid's stroke only
        #expect(store["stroke:kid"] == nil)
        #expect(store["stroke:tutor"] != nil)
        #expect(store["line:1"] != nil)
        #expect(!store.canUndo)
    }

    @Test func groupMakesOneStep() {
        let store = storeWithScreen()
        for i in 0..<3 { store.put(.stroke(line("stroke:\(i)", 0, 50, y: Double(i) * 20, order: OrderKey("a\(i + 1)"))), origin: .kid) }
        store.beginUndoGroup("erase")
        store.remove(["stroke:0"], origin: .kid)
        store.remove(["stroke:1"], origin: .kid)
        store.remove(["stroke:2"], origin: .kid)
        store.endUndoGroup()
        #expect(store.strokeCount == 0)
        store.undo()
        #expect(store.strokeCount == 3) // the whole drag comes back at once
        store.undo()
        #expect(store.strokeCount == 2)
    }

    @Test func undoNeverOverwritesSomeoneElsesChange() {
        let store = storeWithScreen()
        // the kid erases a tutor stroke; the tutor then rewrites it
        let t = line("stroke:t", 0, 50, y: 0, order: "a1", author: .tutor)
        store.put(.stroke(t), origin: .tutor)
        store.transact(.kid) { $0.updateStroke("stroke:t") { $0.x += 100 } } // the kid moves it
        store.transact(.tutor) { $0.updateStroke("stroke:t") { $0.color = .tutor; $0.y += 7 } } // the tutor moves it again
        let now = store.stroke("stroke:t")
        store.undo() // conflict: left as the tutor made it
        #expect(store.stroke("stroke:t") == now)
    }

    @Test func newKidChangeClearsRedo() {
        let store = storeWithScreen()
        store.put(.stroke(line("stroke:1", 0, 50, y: 0, order: "a1")), origin: .kid)
        store.undo()
        #expect(store.canRedo)
        store.put(.stroke(line("stroke:2", 0, 50, y: 0, order: "a2")), origin: .kid)
        #expect(!store.canRedo)
    }

    @Test func undoOfANewScreenShowsItsNeighbour() {
        let c = BoardController(document: BoardDocument([.screen(ScreenRecord(id: "screen:a", order: "a0"))]),
                                defaults: UserDefaults(suiteName: "test.undo.\(UUID())")!)
        #expect(c.addScreen())
        #expect(c.screenCount == 2 && c.screenIndex == 2)
        c.undo()
        #expect(c.screenCount == 1)
        #expect(c.currentScreenID == "screen:a")
    }
}

@MainActor
struct DirtyAndLogTests {
    @Test func dirtySetsFollowTheWebSemantics() {
        let store = storeWithScreen()
        store.put(.stroke(line("stroke:1", 0, 50, y: 0, order: "a1")), origin: .kid)
        store.put(.stroke(line("stroke:2", 0, 50, y: 0, order: "a2")), origin: .tutor)
        store.remove(["stroke:2"], origin: .kid)
        let token = store.takeDirty()
        #expect(token.changed == ["stroke:1"])
        #expect(token.removed == ["stroke:2"])
        #expect(!store.hasUnsavedChanges)
        // edits during a save stay pending; a failed save's sets come back under them
        store.put(.stroke(line("stroke:2", 0, 50, y: 0, order: "a2")), origin: .kid) // re-added
        store.restoreDirty(token)
        let after = store.peekDirty()
        #expect(after.changed == ["stroke:1", "stroke:2"])
        #expect(after.removed.isEmpty)
    }

    @Test func remoteAndLoadAreNotDirty() {
        let store = storeWithScreen()
        store.put(.stroke(line("stroke:r", 0, 50, y: 0, order: "a1")), origin: .remote)
        #expect(!store.hasUnsavedChanges)
        #expect(!store.canUndo)
    }

    @Test func changeLogForSync() {
        let store = storeWithScreen()
        let base = store.seq
        store.put(.stroke(line("stroke:1", 0, 50, y: 0, order: "a1")), origin: .kid)
        store.put(.stroke(line("stroke:2", 0, 50, y: 0, order: "a2")), origin: .tutor)
        let since = try! #require(store.changes(since: base))
        #expect(since.count == 2)
        #expect(since.map(\.origin) == [.kid, .tutor])
        #expect(store.changes(since: store.seq)?.isEmpty == true)
        // past the log's reach: nil (send the whole board)
        store.logLimit = 1
        store.put(.stroke(line("stroke:3", 0, 50, y: 0, order: "a3")), origin: .kid)
        #expect(store.changes(since: base) == nil)
    }

    @Test func changeSetInvertsAndSquashes() {
        let s1 = BoardRecord.stroke(line("stroke:1", 0, 50, y: 0, order: "a1"))
        var a = ChangeSet(origin: .kid)
        a.added["stroke:1"] = s1
        var b = ChangeSet(origin: .kid)
        b.removed["stroke:1"] = s1
        #expect(a.squashed(with: b).isEmpty)
        let inv = a.inverted(origin: .history)
        #expect(inv.removed["stroke:1"] == s1)
    }
}
