import CoreText
import SwiftUI
import UIKit

// MARK: - Fonts in the package

/// The three bundled families (SIL Open Font License 1.1; the licences ship next to the files in
/// Resources/Fonts). Registered for the process the first time any `DS.Font` is made, so screens
/// need no setup call.
public enum DSFonts {
    /// Bricolage Grotesque, variable (opsz 12–96, wdth 75–100, wght 200–800), for display.
    public static let displayFile = "BricolageGrotesque-Variable.ttf"
    /// Lexend, variable (wght 100–900), for UI and numerals.
    public static let uiFile = "Lexend-Variable.ttf"
    /// Kalam Bold, the tutor's hand: a neat marker print.
    public static let tutorHandFile = "Kalam-Bold.ttf"
    public static let files = [displayFile, uiFile, tutorHandFile]
    public static let licences = ["BricolageGrotesque-OFL.txt", "Lexend-OFL.txt", "Kalam-OFL.txt"]

    /// PostScript names. Bricolage's default instance is ExtraBold at optical size 96.
    public static let displayPostScriptName = "BricolageGrotesque-96ptExtraBold"
    public static let tutorHandPostScriptName = "Kalam-Bold"
    public static func uiPostScriptName(weight: Double) -> String {
        switch weight {
        case ..<450: "Lexend-Regular"
        case ..<550: "Lexend-Medium"
        case ..<650: "Lexend-SemiBold"
        case ..<750: "Lexend-Bold"
        default: "Lexend-ExtraBold"
        }
    }

    /// The folder in the package bundle that holds the fonts and their licences.
    public static var directory: URL? { Bundle.module.url(forResource: "Fonts", withExtension: nil) }

    /// Registers the bundled fonts once. True when all three are available.
    @discardableResult
    public static func register() -> Bool { registered }

    private static let registered: Bool = {
        guard let dir = directory else { return false }
        var ok = true
        for file in files {
            let url = dir.appendingPathComponent(file)
            var error: Unmanaged<CFError>?
            if !CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error) {
                // Already registered (a second bundle copy, a test host) counts as available.
                let code = (error?.takeRetainedValue()).map { CFErrorGetCode($0) } ?? 0
                if code != CTFontManagerError.alreadyRegistered.rawValue { ok = false }
            }
        }
        return ok
    }()

    /// Bricolage's descriptor straight from the file, so the variation axes can be set on it.
    static let displayDescriptor: CTFontDescriptor? = {
        register()
        guard let url = directory?.appendingPathComponent(displayFile),
              let all = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor]
        else { return nil }
        return all.first { desc in
            (CTFontDescriptorCopyAttribute(desc, kCTFontNameAttribute) as? String) == displayPostScriptName
        } ?? all.first
    }()

    static let axisWeight = NSNumber(value: 0x7767_6874) // 'wght'
    static let axisOpticalSize = NSNumber(value: 0x6F70_737A) // 'opsz'

    private static let cache = NSCache<NSString, CTFont>()

    /// Bricolage at a weight and size, with the optical size set to the point size (what CSS
    /// `font-optical-sizing: auto` does on the brand page; Core Text doesn't do it by itself).
    static func display(weight: Double, size: CGFloat) -> CTFont {
        let opsz = min(max(size, 12), 96)
        let key = "d-\(weight)-\(size)" as NSString
        if let hit = cache.object(forKey: key) { return hit }
        guard var desc = displayDescriptor else {
            return CTFontCreateWithName(displayPostScriptName as CFString, size, nil)
        }
        desc = CTFontDescriptorCreateCopyWithVariation(desc, axisWeight, CGFloat(weight))
        desc = CTFontDescriptorCreateCopyWithVariation(desc, axisOpticalSize, opsz)
        let font = CTFontCreateWithFontDescriptor(desc, size, nil)
        cache.setObject(font, forKey: key)
        return font
    }

    /// Natural line height (ascent + descent + leading) as a multiple of the point size.
    static func naturalLineHeight(_ family: DS.TextStyle.Family) -> CGFloat {
        register()
        let font: CTFont = switch family {
        case .display: display(weight: 800, size: 100)
        case .ui: CTFontCreateWithName(uiPostScriptName(weight: 400) as CFString, 100, nil)
        case .tutorHand: CTFontCreateWithName(tutorHandPostScriptName as CFString, 100, nil)
        }
        return (CTFontGetAscent(font) + CTFontGetDescent(font) + CTFontGetLeading(font)) / 100
    }
}

// MARK: - The type scale

extension DS {
    /// A step on the Blocks type scale. Display and titles set in Bricolage Grotesque ExtraBold,
    /// tight; UI, body and numerals in Lexend.
    public struct TextStyle: Hashable, Sendable, Identifiable {
        public enum Family: String, Sendable { case display, ui, tutorHand }

        public let id: String
        public let family: Family
        /// Points at the default text size.
        public let size: CGFloat
        /// The `wght` axis value.
        public let weight: Double
        /// Letter-spacing in em (CSS `letter-spacing`), applied as tracking.
        public let tracking: CGFloat
        /// Line height as a multiple of the size (CSS `line-height`).
        public let lineHeight: CGFloat
        /// The Dynamic Type style it scales with.
        public let relativeTo: SwiftUI.Font.TextStyle
        /// The largest it may grow to under Dynamic Type, as a multiple of `size`.
        public let maxScale: CGFloat
        public let uppercase: Bool
        public let tabularNumbers: Bool

        public init(_ id: String, _ family: Family, size: CGFloat, weight: Double, tracking: CGFloat = 0,
                    lineHeight: CGFloat = 1.25, relativeTo: SwiftUI.Font.TextStyle, maxScale: CGFloat = 3,
                    uppercase: Bool = false, tabularNumbers: Bool = false) {
            self.id = id
            self.family = family
            self.size = size
            self.weight = weight
            self.tracking = tracking
            self.lineHeight = lineHeight
            self.relativeTo = relativeTo
            self.maxScale = maxScale
            self.uppercase = uppercase
            self.tabularNumbers = tabularNumbers
        }

        /// "Hi Maya." Bricolage ExtraBold 64, −0.045 em.
        public static let display = TextStyle("display", .display, size: 64, weight: 800, tracking: -0.045,
                                              lineHeight: 0.95, relativeTo: .largeTitle, maxScale: 1.6)
        /// "Today's practice." Bricolage ExtraBold 32, −0.035 em.
        public static let title = TextStyle("title", .display, size: 32, weight: 800, tracking: -0.035,
                                            lineHeight: 1.0, relativeTo: .title, maxScale: 1.9)
        /// Card heads, the board's title, a sheet's title. Bricolage ExtraBold 24, −0.03 em.
        public static let headline = TextStyle("headline", .display, size: 24, weight: 800, tracking: -0.03,
                                               lineHeight: 1.05, relativeTo: .title2, maxScale: 2.2)
        /// A streak or a count. Bricolage ExtraBold 46, −0.03 em.
        public static let bigNumber = TextStyle("bigNumber", .display, size: 46, weight: 800, tracking: -0.03,
                                                lineHeight: 1.0, relativeTo: .largeTitle, maxScale: 1.6)
        /// "Your 3rd grade path." Lexend SemiBold 22.
        public static let heading = TextStyle("heading", .ui, size: 22, weight: 600, lineHeight: 1.2,
                                              relativeTo: .title3)
        /// "A fourth is the same as 2 eighths." Lexend Regular 19, line height 1.4.
        public static let body = TextStyle("body", .ui, size: 19, weight: 400, lineHeight: 1.4,
                                           relativeTo: .body)
        /// Chat bubbles and dense text. Lexend Regular 17, line height 1.45.
        public static let callout = TextStyle("callout", .ui, size: 17, weight: 400, lineHeight: 1.45,
                                              relativeTo: .callout)
        /// Buttons, chips and tools. Lexend SemiBold 19.
        public static let button = TextStyle("button", .ui, size: 19, weight: 600, lineHeight: 1.0,
                                             relativeTo: .headline)
        /// Small print under a tile. Lexend Regular 14.
        public static let caption = TextStyle("caption", .ui, size: 14, weight: 400, lineHeight: 1.3,
                                              relativeTo: .footnote)
        /// "NEXT UP." Lexend SemiBold 14, +0.1 em, capitals.
        public static let label = TextStyle("label", .ui, size: 14, weight: 600, tracking: 0.1,
                                            lineHeight: 1.0, relativeTo: .caption, uppercase: true)
        /// Digits a kid can match to their own. Lexend SemiBold 30, tabular.
        public static let numeral = TextStyle("numeral", .ui, size: 30, weight: 600, lineHeight: 1.0,
                                              relativeTo: .title2, tabularNumbers: true)
        /// The tutor's hand on the board: Kalam Bold, in tutor ink only.
        public static let tutorHand = TextStyle("tutorHand", .tutorHand, size: 30, weight: 700,
                                                lineHeight: 1.2, relativeTo: .title2)

        public static let all: [TextStyle] = [
            display, title, headline, bigNumber, heading, body, callout, button, caption, label, numeral, tutorHand,
        ]

        /// Extra space SwiftUI should add between lines to reach `lineHeight` at `size` points.
        public func lineSpacing(at size: CGFloat) -> CGFloat {
            max(0, size * lineHeight - size * DSFonts.naturalLineHeight(family))
        }
    }
}

// MARK: - Fonts

extension DS {
    public enum Font {
        /// The style at an exact size, without Dynamic Type (for type that must keep its size, such
        /// as a label inside a fixed-size tool). Text should normally use `.dsFont(_:)`.
        public static func fixed(_ style: DS.TextStyle, size: CGFloat? = nil) -> SwiftUI.Font {
            DSFonts.register()
            let s = size ?? style.size
            let font: SwiftUI.Font = switch style.family {
            case .display: SwiftUI.Font(DSFonts.display(weight: style.weight, size: s))
            case .ui: .custom(DSFonts.uiPostScriptName(weight: style.weight), fixedSize: s)
            case .tutorHand: .custom(DSFonts.tutorHandPostScriptName, fixedSize: s)
            }
            return style.tabularNumbers ? font.monospacedDigit() : font
        }
    }
}

extension SwiftUI.Font {
    /// A Blocks style as a `Font` that scales with Dynamic Type by itself. Use it where only a
    /// `Font` fits (a `TextField`, an attributed string). Bricolage here uses its optical size 96
    /// cut; `.dsFont(_:)` sets the optical size, tracking and line height too, so prefer that.
    public static func ds(_ style: DS.TextStyle) -> SwiftUI.Font {
        DSFonts.register()
        let name: String = switch style.family {
        case .display: DSFonts.displayPostScriptName
        case .ui: DSFonts.uiPostScriptName(weight: style.weight)
        case .tutorHand: DSFonts.tutorHandPostScriptName
        }
        let font = SwiftUI.Font.custom(name, size: style.size, relativeTo: style.relativeTo)
        return style.tabularNumbers ? font.monospacedDigit() : font
    }
}

/// Sets a Blocks text style: the font at its Dynamic Type size (capped at `maxScale`), its
/// optical size, tracking, line height and case.
struct DSTextModifier: ViewModifier {
    let style: DS.TextStyle
    @ScaledMetric private var scaled: CGFloat
    private let base: CGFloat

    init(style: DS.TextStyle, size: CGFloat?) {
        self.style = style
        base = size ?? style.size
        _scaled = ScaledMetric(wrappedValue: size ?? style.size, relativeTo: style.relativeTo)
    }

    func body(content: Content) -> some View {
        let s = min(scaled, base * style.maxScale)
        content
            .font(DS.Font.fixed(style, size: s))
            .tracking(style.tracking * s)
            .lineSpacing(style.lineSpacing(at: s))
            .textCase(style.uppercase ? .uppercase : nil)
    }
}

extension View {
    /// Sets a Blocks text style that follows Dynamic Type. `size` overrides the style's default
    /// size (it still scales).
    public func dsFont(_ style: DS.TextStyle, size: CGFloat? = nil) -> some View {
        modifier(DSTextModifier(style: style, size: size))
    }
}
