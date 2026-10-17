import Foundation
import Testing
@testable import AgathonDesign

/// The palette is the brand page's, to the hex.
struct PaletteTests {
    @Test func paletteMatchesTheBrandPage() {
        #expect(DS.Palette.paper.hex == "#FFFFFF")
        #expect(DS.Palette.chalk.hex == "#F1F2F6")
        #expect(DS.Palette.ink.hex == "#14151F")
        #expect(DS.Palette.ink2.hex == "#5B5E6E")
        #expect(DS.Palette.sunny.hex == "#FFD12E")
        #expect(DS.Palette.tomato.hex == "#FF5A36")
        #expect(DS.Palette.cobalt.hex == "#2D5BFF")
        #expect(DS.Palette.cobaltDeep.hex == "#2148E3")
        #expect(DS.ColorTokens.tutorInk.light == DS.Palette.cobalt)
        #expect(DS.ColorTokens.success.light.hex == "#12A150")
        #expect(DS.ColorTokens.tryAgain.light.hex == "#FFD12E")
        #expect(DS.KidPen.all.map(\.rgb.hex) == ["#14151F", "#E5302A", "#F58700", "#12A150", "#E9449A"])
    }

    @Test func tokenNamesAreUnique() {
        let names = DS.ColorTokens.all.map(\.name)
        #expect(Set(names).count == names.count)
    }

    @Test func flatMixesAreOpaqueColoursBetweenTheTwo() {
        let mixed = DS.Palette.ink.mixed(with: DS.Palette.white, amount: 0.18)
        #expect(mixed.r > DS.Palette.ink.r && mixed.r < 1)
        #expect(DS.Palette.ink.mixed(with: DS.Palette.white, amount: 0) == DS.Palette.ink)
        #expect(DS.Palette.ink.mixed(with: DS.Palette.white, amount: 1) == DS.Palette.white)
    }

    @Test func darkModeFallsBackToLightUntilDesigned() {
        #expect(DS.ColorTokens.all.allSatisfy { $0.dark == nil })
        let token = ColorToken("test", RGB(0x112233), dark: RGB(0xDDEEFF))
        let dark = token.uiColor.resolvedColor(with: .init(userInterfaceStyle: .dark))
        var r: CGFloat = 0
        dark.getRed(&r, green: nil, blue: nil, alpha: nil)
        #expect(abs(r - 0xDD / 255.0) < 0.01)
    }
}

/// WCAG AA for every pairing the system uses.
struct ContrastTests {
    @Test func wcagMathMatchesKnownValues() {
        #expect(abs(RGB(0x000000).contrast(with: RGB(0xFFFFFF)) - 21) < 0.01)
        #expect(abs(RGB(0x777777).contrast(with: RGB(0xFFFFFF)) - 4.48) < 0.01)
        #expect(RGB(0xFFFFFF).contrast(with: RGB(0xFFFFFF)) == 1)
    }

    @Test(arguments: DS.ContrastPair.all)
    func pairMeetsWCAGAA(_ pair: DS.ContrastPair) {
        #expect(pair.passes, "\(pair.foreground.name) on \(pair.background.name): \(String(format: "%.2f", pair.ratio)):1, needs \(pair.minimum) (\(pair.note))")
    }

    @Test func everyTextPairIsAtLeastAA() {
        let text = DS.ContrastPair.all.filter { $0.use == .text }
        #expect(text.count >= 12)
        #expect(text.allSatisfy { $0.ratio >= 4.5 })
    }

    /// Pairings that fail for small text stay out of the text list.
    @Test func knownWeakPairsAreNotUsedForSmallText() {
        let text = Set(DS.ContrastPair.all.filter { $0.use == .text }.map { "\($0.foreground.name)/\($0.background.name)" })
        #expect(!text.contains("inkSecondary/sunny"))   // 4.41
        #expect(!text.contains("onInk/tomato"))         // 3.10
        #expect(!text.contains("sunny/cobalt"))         // 3.56
        #expect(!text.contains("onInk/success"))        // 3.37
    }
}

/// The tutor's ink is reserved: no kid pen comes close to cobalt.
struct PenDistanceTests {
    /// Reference pairs from Sharma, Wu and Dalal (2005), "The CIEDE2000 color-difference formula".
    @Test func ciede2000MatchesPublishedValues() {
        let cases: [((Double, Double, Double), (Double, Double, Double), Double)] = [
            ((50, 2.6772, -79.7751), (50, 0, -82.7485), 2.0425),
            ((50, 0, 0), (50, -1, 2), 2.3669),
            ((50, 2.5, 0), (73, 25, -18), 27.1492),
            ((50, 2.5, 0), (61, -5, 29), 22.8977),
            ((60.2574, -34.0099, 36.2677), (60.4626, -34.1751, 39.4387), 1.2644),
        ]
        for (a, b, expected) in cases {
            #expect(abs(RGB.deltaE2000(a, b) - expected) < 0.0005, "\(a) vs \(b)")
        }
    }

    @Test func labOfWhiteAndBlack() {
        let w = RGB(0xFFFFFF).lab, k = RGB(0x000000).lab
        #expect(abs(w.l - 100) < 0.01 && abs(w.a) < 0.01 && abs(w.b) < 0.01)
        #expect(abs(k.l) < 0.01)
    }

    /// Over 25 reads as a different colour at a glance; blues and purples near cobalt are 8 to 18.
    static let threshold = 25.0

    @Test(arguments: DS.KidPen.all)
    func penIsFarFromTutorInk(_ pen: DS.KidPen) {
        let d = pen.rgb.deltaE2000(DS.ColorTokens.tutorInk.light)
        #expect(d >= Self.threshold, "\(pen.name) is ΔE00 \(String(format: "%.1f", d)) from tutor ink")
    }

    /// No kid pen is blue or purple: a chromatic pen's hue stays out of 250°–330° (CIELAB). Black
    /// is near-neutral (chroma under 12), so its hue doesn't count.
    @Test(arguments: DS.KidPen.all)
    func penIsNotBlueOrPurple(_ pen: DS.KidPen) {
        let lch = pen.rgb.lch
        #expect(lch.c < 12 || !(250...330).contains(lch.h), "\(pen.name): hue \(Int(lch.h))°, chroma \(Int(lch.c))")
    }

    @Test func theThresholdCatchesBluesAndPurples() {
        for hex: UInt32 in [0x7A5CF5, 0x1E3A8A, 0x3B82F6, 0x6B3BF2, 0x2148E3] {
            #expect(RGB(hex).deltaE2000(DS.Palette.cobalt) < Self.threshold, "\(RGB(hex).hex) should count as too close")
        }
    }

    @Test func pensAreDistinctFromEachOther() {
        let pens = DS.KidPen.all
        for i in pens.indices {
            for j in pens.indices where j > i {
                #expect(pens[i].rgb.deltaE2000(pens[j].rgb) >= 20, "\(pens[i].name) vs \(pens[j].name)")
            }
        }
    }

    @Test func tryAgainIsNeverRed() {
        let tryAgain = DS.ColorTokens.tryAgain.light
        #expect(tryAgain.deltaE2000(DS.KidPen.red.rgb) > 25)
        #expect(tryAgain.deltaE2000(DS.Palette.tomato) > 25)
    }
}
