import Foundation
import Testing
@testable import AgathonBoard

struct OrderKeyTests {
    @Test func firstKeysAndAppends() throws {
        #expect(try OrderKey.between(nil, nil) == "a0")
        #expect(OrderKey.after("a0") == "a1")
        #expect(OrderKey.after("az") == "b00")
        #expect(OrderKey.before("a0") == "Zz")
        #expect(try OrderKey.between("a0", "a1") == "a0V")
        #expect(try OrderKey.between("a0", "a0V") == "a0G")
    }

    @Test func betweenIsStrictlyBetween() throws {
        var keys: [OrderKey] = ["a0", "a1"]
        // keep inserting at the front of the gap: keys stay ordered and valid
        for _ in 0..<200 {
            let k = try OrderKey.between(keys[0], keys[1])
            #expect(keys[0] < k && k < keys[1])
            #expect(k.isValid)
            keys.insert(k, at: 1)
        }
        #expect(keys == keys.sorted())
    }

    @Test func sequenceIsOrderedAndValid() throws {
        let keys = try OrderKey.sequence(5000)
        #expect(keys.count == 5000)
        #expect(Set(keys).count == 5000)
        #expect(keys == keys.sorted())
        #expect(keys.allSatisfy { $0.isValid })
        let mid = try OrderKey.sequence(50, after: "a1", before: "a2")
        #expect(mid == mid.sorted() && mid.first! > "a1" && mid.last! < "a2")
    }

    @Test func tldrawKeysAreValidAndSortByBytes() {
        // tldraw 4.2 writes jittered keys; old boards "a1"; the web's synthetic board "c000"
        for k in ["a1", "a1swBWOV", "a2", "c000", "c00Z", "b0Mz"] { #expect(OrderKey(k).isValid, "\(k)") }
        #expect(!OrderKey("a10").isValid) // trailing zero
        #expect(!OrderKey("").isValid)
        // byte order, not Unicode collation: uppercase sorts before lowercase
        #expect(OrderKey("a1Z") < OrderKey("a1a"))
    }

    @Test func outOfOrderThrows() {
        #expect(throws: OrderKey.KeyError.self) { try OrderKey.between("a2", "a1") }
    }
}

struct RecordIDTests {
    @Test func freshAndConverted() {
        let a = RecordID.make(.stroke)
        #expect(a.prefix == "stroke")
        #expect(a.key.count == 12)
        #expect(RecordID.make(.stroke) != a)
        #expect(RecordID.converted(.stroke, from: "shape:abc") == "stroke:abc")
        #expect(RecordID.converted(.screen, from: "page:xyz") == "screen:xyz")
    }

    @Test func seededIDsRepeat() {
        var g1 = SeededGenerator(seed: 9)
        var g2 = SeededGenerator(seed: 9)
        #expect(RecordID.make(.line, using: &g1) == RecordID.make(.line, using: &g2))
    }
}

struct ColorRuleTests {
    @Test func kidPaletteNeverHasTheTutorsColour() {
        #expect(!InkColor.kidPalette.contains(.tutor))
        // the Blocks pens (DS.KidPen.all): no blue or purple, so nothing the kid writes reads as the tutor's
        #expect(InkColor.kidPalette == [.black, .red, .orange, .green, .pink])
        #expect(!InkColor.kidPalette.contains(.violet) && !InkColor.kidPalette.contains(.blue))
    }

    @Test func kidStrokeInTutorColourIsCorrected() {
        let s = makeStroke("stroke:k", order: "a0", xy: [(0, 0), (10, 10)], color: .tutor).normalized()
        #expect(s.color != .tutor)
        let t = makeStroke("stroke:t", order: "a0", xy: [(0, 0), (10, 10)], author: .tutor, color: .tutor).normalized()
        #expect(t.color == .tutor)
    }

    @Test func tldrawBlueIsTheTutorsOnlyWhenTheTutorDrewIt() {
        #expect(InkColor.fromTldraw("blue", author: .tutor) == .tutor)
        #expect(InkColor.fromTldraw("blue", author: .kid) == .blue)
        #expect(InkColor.fromTldraw("light-violet", author: .kid) == .lightViolet)
        #expect(InkColor.fromTldraw("nonsense", author: .kid) == .black)
    }

    @Test @MainActor func controllerRefusesTheTutorsColour() {
        let c = BoardController(defaults: UserDefaults(suiteName: "test.colour.\(UUID())")!)
        c.color = .tutor
        #expect(c.color == .black)
        c.color = .pink
        #expect(c.color == .pink)
        // an old board's violet stays drawable, but it is not a pen any more
        c.color = .violet
        #expect(c.color == .black)
    }
}
