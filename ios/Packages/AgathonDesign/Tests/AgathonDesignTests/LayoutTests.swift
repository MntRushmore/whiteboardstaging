import Foundation
import SwiftUI
import Testing
import UIKit
@testable import AgathonDesign

/// Kid targets are at least 52 pt (the brand page asks 56), measured from the real views.
@MainActor
struct TargetSizeTests {
    static let floor: CGFloat = 52

    func size<V: View>(_ view: V) -> CGSize {
        let host = UIHostingController(rootView: view)
        return host.sizeThatFits(in: CGSize(width: 2000, height: 2000))
    }

    @Test func tokensMeetTheFloor() {
        for (name, value) in [("minTarget", DS.Size.minTarget), ("tool", DS.Size.tool), ("button", DS.Size.button),
                              ("mainButton", DS.Size.mainButton), ("helpMe", DS.Size.helpMe), ("round", DS.Size.round),
                              ("field", DS.Size.field), ("pinKey", DS.Size.pinKey)] {
            #expect(value >= Self.floor, "\(name) is \(value)")
        }
        #expect(DS.Size.minTarget == 56)
        #expect(DS.Size.helpMe == 72)
        #expect(DS.Size.mainButton == 64)
    }

    @Test func toolButtonIsAtLeast56() {
        let s = size(ToolButton(.pen, title: "Pen") {})
        #expect(s.width >= 56 && s.height >= 56)
        let dock = size(ToolButton(.pen, context: .dock) {})
        #expect(dock.width >= 56 && dock.height >= 56)
    }

    @Test func penSwatchTargetIs56() {
        let s = size(PenSwatch(.red) {})
        #expect(s.width >= 56 && s.height >= 56)
    }

    @Test func smallRoundButtonsKeepA56Target() {
        let s = size(RoundButton(.close, diameter: 44) {})
        #expect(s.width >= 56 && s.height >= 56)
    }

    @Test func buttonsMeetTheirHeights() {
        #expect(size(PillButton("Go") {}).height >= 56)
        #expect(size(PillButton("Continue", icon: .play, kind: .sunny, size: .large) {}).height >= 64)
        #expect(size(HelpMeButton {}).height >= 72)
        #expect(size(Chip("3 more like these") {}).height >= 56)
        #expect(size(PinKey(.digit(1)) {}).height >= 76)
    }

    @Test func segmentsAreTallEnough() {
        let s = size(SegmentedPicker(selection: .constant(1), options: [(1, "Boards"), (2, "Practice")]))
        #expect(s.height >= 56)
    }

    @Test func helpMeIsTheBiggestThingOnTheDock() {
        let help = size(HelpMeButton {})
        let tool = size(ToolButton(.pen, context: .dock) {})
        #expect(help.height > tool.height)
        #expect(help.width > tool.width * 3)
    }
}

/// Cheap layout sanity: the vector art draws at every size it's used, and its maths holds.
@MainActor
struct ArtTests {
    func render<V: View>(_ view: V) -> UIImage? {
        let r = ImageRenderer(content: view)
        r.scale = 2
        return r.uiImage
    }

    @Test(arguments: TheShapes.Pose.allCases)
    func shapesRenderFrom24To200(_ pose: TheShapes.Pose) throws {
        for width in [24.0, 48, 96, 200] {
            let image = try #require(render(TheShapes(pose, animated: false).frame(width: width)))
            #expect(abs(image.size.width - width) < 1)
            #expect(abs(image.size.height - width / TheShapes.aspectRatio) < 1)
        }
    }

    @Test func markIsCentredInItsBox() {
        let b = MarkGeometry.inkBounds
        #expect(b.midX == MarkGeometry.box / 2 && b.midY == MarkGeometry.box / 2)
        #expect(MarkGeometry.ringCenter.x - MarkGeometry.ringRadius - MarkGeometry.ringStroke / 2 == b.minX)
        #expect(MarkGeometry.bar.maxX == b.maxX)
    }

    @Test func markAndAppIconRender() throws {
        let mark = try #require(render(AgathonMark().frame(width: 100, height: 100)))
        #expect(mark.size == CGSize(width: 100, height: 100))
        let icon = try #require(render(AppIconArt(cornerRadius: false).frame(width: 120, height: 120)))
        #expect(icon.size == CGSize(width: 120, height: 120))
    }

    @Test(arguments: Sticker.Kind.allCases)
    func stickerRenders(_ kind: Sticker.Kind) throws {
        let image = try #require(render(Sticker(kind, size: 70)))
        #expect(image.size.width >= 70)
    }

    @Test func stillShapesHoldStill() {
        let painter = ShapesPainter(pose: .hello, showsGround: true, t: 1234.5, still: true)
        #expect(painter.blink(0) == 1)
        #expect(painter.bob(0) == 0)
    }

    @Test func idleBobNeverGoesThroughTheGround() {
        for i in 0..<200 {
            let p = ShapesPainter(pose: .hello, showsGround: true, t: Double(i) * 0.037, still: false)
            #expect(p.bob(0) <= 0 && p.bob(0.35) <= 0)
        }
    }

    @Test func blinksAreShortAndClose() {
        var shut = 0
        let frames = 420
        for i in 0..<frames {
            let p = ShapesPainter(pose: .hello, showsGround: false, t: Double(i) * 0.01, still: false)
            let b = p.blink(0)
            #expect(b >= 0.1 && b <= 1)
            if b < 0.5 { shut += 1 }
        }
        // About 8 % of a 4.2 s cycle is a blink, and only the middle of it is mostly shut.
        #expect(shut > 0 && Double(shut) / Double(frames) < 0.06)
    }
}

/// Motion honours Reduce Motion.
struct MotionTests {
    @Test func reduceMotionDropsAnimations() {
        #expect(DS.Motion.animation(DS.Motion.snap, reduceMotion: true) == nil)
        #expect(DS.Motion.animation(DS.Motion.snap, reduceMotion: false) != nil)
    }

    @Test func pressShrinksToNinetySixPercent() {
        #expect(DS.Motion.pressScale == 0.96)
    }

    @Test func markAssemblesRingThenBarThenDot() {
        #expect(DS.Motion.assembleRingDelay < DS.Motion.assembleBarDelay)
        #expect(DS.Motion.assembleBarDelay < DS.Motion.assembleDotDelay)
        // Snap: the whole assembly lands in well under half a second.
        #expect(DS.Motion.assembleDotDelay + 0.3 < 0.6)
    }
}

/// Flat colour only: no gradient anywhere in the package's sources.
struct FlatColourTests {
    @Test func sourcesHaveNoGradients() throws {
        let sources = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Sources/AgathonDesign")
        let files = try #require(FileManager.default.enumerator(at: sources, includingPropertiesForKeys: nil))
            .compactMap { $0 as? URL }.filter { $0.pathExtension == "swift" }
        #expect(files.count > 5)
        let banned = ["LinearGradient", "RadialGradient", "AngularGradient", "EllipticalGradient", "Gradient(", ".gradient", "shadow("]
        for file in files {
            let text = try String(contentsOf: file, encoding: .utf8)
            for word in banned {
                #expect(!text.contains(word), "\(file.lastPathComponent) uses \(word)")
            }
        }
    }
}
