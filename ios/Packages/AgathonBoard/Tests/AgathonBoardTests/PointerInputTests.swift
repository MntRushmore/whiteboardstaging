#if canImport(UIKit)
import Foundation
import Testing
import UIKit
@testable import AgathonBoard

/// The iPad app on a Mac (and an iPad with a trackpad or mouse): the pointer arrives as an
/// `indirectPointer` touch. It always draws — it is never a palm — even after a Pencil has been seen
/// and fingers stopped drawing; a trackpad's pinch zooms and its two-finger scroll moves the board.
@MainActor
struct PointerInputTests {
    private let pencil = UITouch.TouchType.pencil.rawValue
    private let direct = UITouch.TouchType.direct.rawValue
    private let pointer = UITouch.TouchType.indirectPointer.rawValue

    private func canvas(pencilSeen: Bool) -> BoardCanvasView {
        let defaults = UserDefaults(suiteName: "test.pointer.\(UUID())")!
        defaults.set(false, forKey: BoardController.fingerKey)
        defaults.set(pencilSeen, forKey: BoardController.pencilKey)
        let c = BoardController(document: BoardDocument([.screen(ScreenRecord(id: "screen:a", order: "a0"))]), defaults: defaults)
        let v = BoardCanvasView(controller: c)
        v.frame = CGRect(x: 0, y: 0, width: 1024, height: 768)
        v.layoutIfNeeded()
        return v
    }

    @Test func thePointerDrawsOnAMacWhereNoPencilIsEverSeen() {
        let ink = canvas(pencilSeen: false).inputTypes.ink
        #expect(ink.contains(pointer))
        #expect(ink.contains(pencil))
        #expect(ink.contains(direct))
    }

    @Test func thePointerStillDrawsOnceAPencilHasBeenSeen() {
        let ink = canvas(pencilSeen: true).inputTypes.ink
        #expect(ink.contains(pointer))
        #expect(ink.contains(pencil))
        #expect(!ink.contains(direct), "a finger (a palm) doesn't draw once a Pencil has")
    }

    @Test func aTrackpadZoomsAndScrolls() {
        let types = canvas(pencilSeen: false).inputTypes
        #expect(types.pinch.contains(pointer))
        #expect(types.pinch.contains(direct))
        #expect(types.scroll == .all)
    }
}
#endif
