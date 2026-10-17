import CoreText
import Foundation
import SwiftUI
import Testing
import UIKit
@testable import AgathonDesign

/// The bundled fonts register, resolve by name, and carry their licences.
struct FontTests {
    @Test func fontsRegisterFromThePackageBundle() {
        #expect(DSFonts.register())
        #expect(DSFonts.register()) // idempotent
    }

    @Test(arguments: DSFonts.files + DSFonts.licences)
    func fileShipsInTheBundle(_ name: String) throws {
        let dir = try #require(DSFonts.directory)
        #expect(FileManager.default.fileExists(atPath: dir.appendingPathComponent(name).path))
    }

    @Test(arguments: DSFonts.licences)
    func licenceIsTheOFL(_ name: String) throws {
        let dir = try #require(DSFonts.directory)
        let text = try String(contentsOf: dir.appendingPathComponent(name), encoding: .utf8)
        #expect(text.contains("SIL Open Font License, Version 1.1"))
    }

    @Test(arguments: ["Lexend-Regular", "Lexend-Medium", "Lexend-SemiBold", "Lexend-Bold",
                      "BricolageGrotesque-96ptExtraBold", "Kalam-Bold"])
    func postScriptNameResolves(_ name: String) throws {
        DSFonts.register()
        let font = try #require(UIFont(name: name, size: 20), "\(name) didn't resolve")
        #expect(font.fontName == name)
    }

    @Test func lexendWeightsAreRealInstances() {
        DSFonts.register()
        let semibold = CTFontCreateWithName("Lexend-SemiBold" as CFString, 20, nil)
        let variation = CTFontCopyVariation(semibold) as? [NSNumber: NSNumber]
        #expect(variation?[DSFonts.axisWeight]?.doubleValue == 600)
    }

    @Test(arguments: [12.0, 24.0, 32.0, 64.0, 120.0])
    func displaySetsWeightAndOpticalSize(_ size: Double) throws {
        let font = DSFonts.display(weight: 800, size: CGFloat(size))
        #expect(CTFontCopyFamilyName(font) as String == "Bricolage Grotesque")
        let variation = CTFontCopyVariation(font) as? [NSNumber: NSNumber] ?? [:]
        // 800 and 96 are the font's defaults, which Core Text leaves out of the variation.
        let opsz = variation[DSFonts.axisOpticalSize]?.doubleValue ?? 96
        let wght = variation[DSFonts.axisWeight]?.doubleValue ?? 800
        #expect(wght == 800)
        #expect(opsz == min(max(size, 12), 96))
    }

    @Test func smallerOpticalSizesSetWider() {
        let text = NSAttributedString(string: "Today's practice", attributes: [.font: DSFonts.display(weight: 800, size: 24)])
        let at24 = CTLineGetTypographicBounds(CTLineCreateWithAttributedString(text), nil, nil, nil)
        let big = CTFontCreateWithName(DSFonts.displayPostScriptName as CFString, 24, nil)
        let text96 = NSAttributedString(string: "Today's practice", attributes: [.font: big])
        let at96 = CTLineGetTypographicBounds(CTLineCreateWithAttributedString(text96), nil, nil, nil)
        #expect(at24 > at96 * 1.04)
    }
}

/// The type scale is the brand page's.
struct TypeScaleTests {
    @Test func scaleMatchesTheBrandPage() {
        #expect(DS.TextStyle.display.size == 64 && DS.TextStyle.display.family == .display && DS.TextStyle.display.weight == 800)
        #expect(DS.TextStyle.title.size == 32 && DS.TextStyle.title.family == .display)
        #expect(DS.TextStyle.heading.size == 22 && DS.TextStyle.heading.family == .ui && DS.TextStyle.heading.weight == 600)
        #expect(DS.TextStyle.body.size == 19 && DS.TextStyle.body.weight == 400 && DS.TextStyle.body.lineHeight == 1.4)
        #expect(DS.TextStyle.label.size == 14 && DS.TextStyle.label.uppercase && DS.TextStyle.label.tracking == 0.1)
        #expect(DS.TextStyle.numeral.size == 30 && DS.TextStyle.numeral.tabularNumbers)
        #expect(abs(DS.TextStyle.display.tracking - (-0.045)) < 0.0001)
    }

    @Test(arguments: DS.TextStyle.all)
    func lineSpacingIsNeverNegative(_ style: DS.TextStyle) {
        #expect(style.lineSpacing(at: style.size) >= 0)
    }

    @Test func bodyGetsItsLooseLineHeight() {
        // Lexend's natural line is 1.25 em; body asks for 1.4, so about 0.15 em goes between lines.
        let extra = DS.TextStyle.body.lineSpacing(at: 19)
        #expect(extra > 2 && extra < 4)
    }

    @Test(arguments: DS.TextStyle.all)
    func everyStyleMakesAFont(_ style: DS.TextStyle) {
        _ = DS.Font.fixed(style)
        _ = SwiftUI.Font.ds(style)
    }
}
