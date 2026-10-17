import SwiftUI

/// The Agathon design system, Blocks (docs/DESIGN-SYSTEM.md). Everything is a namespace under `DS`:
/// `DS.Color`, `DS.Font`, `DS.Space`, `DS.Radius`, `DS.Size`, `DS.Motion`, `DS.Icon`.
public enum DS {}

// MARK: - Palette

extension DS {
    /// The Blocks palette, named as on the brand page (docs/brand/directions.html, "A · Blocks").
    /// Prefer the semantic `DS.Color` names in screens; these are the raw values behind them.
    public enum Palette {
        public static let paper = RGB(0xFFFFFF)
        public static let chalk = RGB(0xF1F2F6)
        public static let ink = RGB(0x14151F)
        /// Secondary text.
        public static let ink2 = RGB(0x5B5E6E)
        /// The only hairline: the inside edge of a board thumbnail.
        public static let line = RGB(0xE2E4EB)
        public static let rule = RGB(0xDFE1E8)
        public static let sunny = RGB(0xFFD12E)
        public static let tomato = RGB(0xFF5A36)
        /// The tutor's ink.
        public static let cobalt = RGB(0x2D5BFF)
        /// The deco ring on a cobalt card, and cobalt pressed.
        public static let cobaltDeep = RGB(0x2148E3)
        public static let green = RGB(0x12A150)
        public static let red = RGB(0xE5302A)
        public static let orange = RGB(0xF58700)
        public static let pink = RGB(0xE9449A)
        public static let white = RGB(0xFFFFFF)
        public static let black = RGB(0x000000)
    }
}

// MARK: - Semantic tokens

extension DS {
    /// Every semantic colour as a `ColorToken` (a name, a light value, and room for a dark value),
    /// for the gallery, the docs and the contrast tests. Screens use `DS.Color`.
    public enum ColorTokens {
        typealias P = DS.Palette

        // Surfaces
        /// Behind everything: the screen's ground.
        public static let ground = ColorToken("ground", P.chalk)
        /// The writing page.
        public static let paper = ColorToken("paper", P.paper)
        /// Cards, tiles, round buttons and chips sitting on the ground.
        public static let surface = ColorToken("surface", P.paper)
        /// Inputs, chips and wells sitting on paper.
        public static let surfaceSunken = ColorToken("surfaceSunken", P.chalk)

        // Text and ink
        public static let ink = ColorToken("ink", P.ink)
        public static let inkSecondary = ColorToken("inkSecondary", P.ink2)
        /// Text and icons on ink (the dock, primary buttons).
        public static let onInk = ColorToken("onInk", P.white)
        /// Separators and resting parts on ink: white at 18 %, flattened.
        public static let onInkFaint = ColorToken("onInkFaint", P.ink.mixed(with: P.white, amount: 0.18))
        /// Quieter text on ink: white at 72 %, flattened.
        public static let onInkSecondary = ColorToken("onInkSecondary", P.ink.mixed(with: P.white, amount: 0.72))
        /// A tool that can't be used right now, on ink: white at 40 %, flattened.
        public static let onInkDisabled = ColorToken("onInkDisabled", P.ink.mixed(with: P.white, amount: 0.40))
        /// A thumbnail's inside edge. Blocks has no borders; this is the one functional line.
        public static let line = ColorToken("line", P.line)
        public static let divider = ColorToken("divider", P.rule)

        // Brand
        public static let sunny = ColorToken("sunny", P.sunny)
        public static let tomato = ColorToken("tomato", P.tomato)
        public static let cobalt = ColorToken("cobalt", P.cobalt)
        public static let cobaltDeep = ColorToken("cobaltDeep", P.cobaltDeep)
        /// Resting parts on cobalt (empty stars, the days still to come): white at 20 %, flattened.
        public static let onCobaltFaint = ColorToken("onCobaltFaint", P.cobalt.mixed(with: P.white, amount: 0.20))

        // The tutor
        /// The tutor's ink: ticks, rings, hints, the tutor's chat bubbles. Reserved: no kid pen is
        /// blue or purple, so a cobalt mark can only be the tutor's.
        public static let tutorInk = ColorToken("tutorInk", P.cobalt)
        /// The tutor's ink run dry: a flat, pale cobalt.
        public static let tutorInkEmpty = ColorToken("tutorInkEmpty", P.paper.mixed(with: P.cobalt, amount: 0.18))
        /// Help me: the one yellow thing on the board.
        public static let helpMe = ColorToken("helpMe", P.sunny)

        // Feedback
        /// "You got it."
        public static let success = ColorToken("success", P.green)
        /// "Look again." Yellow, the same as Help me: a nudge, not a stop sign. Never red.
        public static let tryAgain = ColorToken("tryAgain", P.sunny)
        public static let star = ColorToken("star", P.sunny)
        /// A star still to earn, on paper.
        public static let starEmpty = ColorToken("starEmpty", P.line)
        public static let streak = ColorToken("streak", P.tomato)
        /// Keyboard and switch-control focus, and a focused field.
        public static let focus = ColorToken("focus", P.cobalt)

        // Stickers (practice rewards)
        public static let stickerEdge = ColorToken("stickerEdge", P.white)
        /// The flat lift under a sticker: depth as a colour change, not a blur.
        public static let stickerLift = ColorToken("stickerLift", P.chalk.mixed(with: P.ink, amount: 0.12))
        /// The lift under a sticker on an ink page: a shade darker than ink.
        public static let stickerLiftOnInk = ColorToken("stickerLiftOnInk", P.ink.mixed(with: P.black, amount: 0.6))
        /// An empty slot in the sticker book.
        public static let stickerSlot = ColorToken("stickerSlot", P.line)

        public static let all: [ColorToken] = [
            ground, paper, surface, surfaceSunken,
            ink, inkSecondary, onInk, onInkSecondary, onInkFaint, onInkDisabled, line, divider,
            sunny, tomato, cobalt, cobaltDeep, onCobaltFaint,
            tutorInk, tutorInkEmpty, helpMe,
            success, tryAgain, star, starEmpty, streak, focus,
            stickerEdge, stickerLift, stickerLiftOnInk, stickerSlot,
        ]
    }

    /// The semantic colours, as SwiftUI colours. Flat fills only: no gradients, no shadows.
    public enum Color {
        typealias T = DS.ColorTokens
        public static let ground = T.ground.color
        public static let paper = T.paper.color
        public static let surface = T.surface.color
        public static let surfaceSunken = T.surfaceSunken.color
        public static let ink = T.ink.color
        public static let inkSecondary = T.inkSecondary.color
        public static let onInk = T.onInk.color
        public static let onInkSecondary = T.onInkSecondary.color
        public static let onInkFaint = T.onInkFaint.color
        public static let onInkDisabled = T.onInkDisabled.color
        public static let line = T.line.color
        public static let divider = T.divider.color
        public static let sunny = T.sunny.color
        public static let tomato = T.tomato.color
        public static let cobalt = T.cobalt.color
        public static let cobaltDeep = T.cobaltDeep.color
        public static let onCobaltFaint = T.onCobaltFaint.color
        public static let tutorInk = T.tutorInk.color
        public static let tutorInkEmpty = T.tutorInkEmpty.color
        public static let helpMe = T.helpMe.color
        public static let success = T.success.color
        public static let tryAgain = T.tryAgain.color
        public static let star = T.star.color
        public static let starEmpty = T.starEmpty.color
        public static let streak = T.streak.color
        public static let focus = T.focus.color
        public static let stickerEdge = T.stickerEdge.color
        public static let stickerLift = T.stickerLift.color
        public static let stickerLiftOnInk = T.stickerLiftOnInk.color
        public static let stickerSlot = T.stickerSlot.color

        /// The kid's pens, in dock order.
        public static var kidPens: [SwiftUI.Color] { DS.KidPen.all.map(\.color) }
    }
}

// MARK: - Kid pens

extension DS {
    /// A colour the kid can write in. None is blue or purple (tests: `PenDistanceTests`).
    public struct KidPen: Identifiable, Hashable, Sendable {
        public let id: String
        /// What VoiceOver says: "Black", "Red"…
        public let name: String
        public let rgb: RGB
        public var color: SwiftUI.Color { rgb.color }

        public static let black = KidPen(id: "black", name: "Black", rgb: DS.Palette.ink)
        public static let red = KidPen(id: "red", name: "Red", rgb: DS.Palette.red)
        public static let orange = KidPen(id: "orange", name: "Orange", rgb: DS.Palette.orange)
        public static let green = KidPen(id: "green", name: "Green", rgb: DS.Palette.green)
        public static let pink = KidPen(id: "pink", name: "Pink", rgb: DS.Palette.pink)

        public static let all: [KidPen] = [black, red, orange, green, pink]
    }
}

// MARK: - Fills (a background, what sits on it, and its pressed colour)

extension DS {
    /// A solid fill for a button, a tool, a card or a chip: its colour, the colour of what sits on
    /// it, and the darker colour it turns while pressed ("press = shrink to 96 % and darken").
    public struct Fill: Hashable, Sendable {
        public let background: RGB
        public let foreground: RGB
        public let pressed: RGB

        public init(background: RGB, foreground: RGB, pressed: RGB? = nil) {
            self.background = background
            self.foreground = foreground
            self.pressed = pressed ?? background.mixed(with: DS.Palette.black, amount: 0.08)
        }

        public static let ink = Fill(background: DS.Palette.ink, foreground: DS.Palette.white,
                                     pressed: DS.Palette.ink.mixed(with: DS.Palette.black, amount: 0.45))
        public static let sunny = Fill(background: DS.Palette.sunny, foreground: DS.Palette.ink)
        public static let paper = Fill(background: DS.Palette.paper, foreground: DS.Palette.ink,
                                       pressed: DS.Palette.paper.mixed(with: DS.Palette.ink, amount: 0.06))
        public static let chalk = Fill(background: DS.Palette.chalk, foreground: DS.Palette.ink,
                                       pressed: DS.Palette.chalk.mixed(with: DS.Palette.ink, amount: 0.07))
        public static let cobalt = Fill(background: DS.Palette.cobalt, foreground: DS.Palette.white,
                                        pressed: DS.Palette.cobaltDeep)
        public static let tomato = Fill(background: DS.Palette.tomato, foreground: DS.Palette.ink)
        public static let success = Fill(background: DS.Palette.green, foreground: DS.Palette.ink)
    }
}

// MARK: - Contrast pairs (checked by ContrastTests)

extension DS {
    /// A text or graphic colour on a background, and how big it is allowed to be there.
    public struct ContrastPair: Hashable, Sendable, Identifiable {
        public enum Use: String, Sendable {
            /// Any text: WCAG AA 4.5:1.
            case text
            /// Only at 18 pt and up, or 14 pt bold and up: WCAG AA large 3:1.
            case largeText
            /// Icons, stars, marks and the parts of a control: WCAG 1.4.11 3:1.
            case graphic
        }

        public let foreground: ColorToken
        public let background: ColorToken
        public let use: Use
        public let note: String

        public var id: String { "\(foreground.name)/\(background.name)/\(use.rawValue)" }
        public var ratio: Double { foreground.light.contrast(with: background.light) }
        public var minimum: Double { use == .text ? 4.5 : 3.0 }
        public var passes: Bool { ratio >= minimum }

        public init(_ foreground: ColorToken, on background: ColorToken, _ use: Use, _ note: String) {
            self.foreground = foreground
            self.background = background
            self.use = use
            self.note = note
        }

        typealias T = DS.ColorTokens

        /// Every pairing the system uses. A pairing not in this list isn't allowed for text (for
        /// example ink secondary on sunny: 4.4:1, so text on sunny is always ink).
        public static let all: [ContrastPair] = [
            .init(T.ink, on: T.paper, .text, "Body text on the page and cards"),
            .init(T.ink, on: T.ground, .text, "Text on the ground"),
            .init(T.inkSecondary, on: T.paper, .text, "Secondary text on cards"),
            .init(T.inkSecondary, on: T.ground, .text, "Secondary text on the ground"),
            .init(T.onInk, on: T.ink, .text, "Primary buttons, the dock"),
            .init(T.onInkSecondary, on: T.ink, .text, "Quieter text on ink"),
            .init(T.onInkSecondary, on: T.onInkFaint, .text, "A sticker book place still to earn"),
            .init(T.sunny, on: T.ink, .text, "A sunny tag on ink (Next up)"),
            .init(T.ink, on: T.sunny, .text, "Help me, sunny buttons, Nailed it."),
            .init(T.onInk, on: T.cobalt, .text, "The tutor's chat bubbles, the Today card"),
            .init(T.onInk, on: T.cobaltDeep, .text, "A pressed cobalt button"),
            .init(T.tutorInk, on: T.paper, .text, "The tutor's handwriting and links on paper"),
            .init(T.tutorInk, on: T.ground, .text, "Read it again, on the ground"),
            .init(T.ink, on: T.tomato, .text, "Text on tomato"),
            .init(T.ink, on: T.success, .text, "Text on green"),
            .init(T.ink, on: T.surfaceSunken, .text, "Inputs and chips"),
            .init(T.inkSecondary, on: T.surfaceSunken, .text, "Placeholders in inputs"),
            .init(T.onInk, on: T.tomato, .largeText, "An avatar's initial (19 pt heavy)"),
            .init(T.sunny, on: T.cobalt, .largeText, "Big numbers on the Today card"),
            .init(T.sunny, on: T.cobalt, .graphic, "Stars and the streak flame on cobalt"),
            .init(T.onInk, on: T.success, .graphic, "The tick in a success badge"),
            .init(T.tutorInk, on: T.paper, .graphic, "The tutor's marks on the page"),
            .init(T.ink, on: T.sunny, .graphic, "The active tool on the dock"),
            .init(T.focus, on: T.ground, .graphic, "A focus ring on the ground"),
            .init(T.focus, on: T.paper, .graphic, "A focus ring on paper"),
            .init(T.onInk, on: T.ink, .graphic, "Tool icons on the dock"),
        ]
    }
}
