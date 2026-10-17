import SwiftUI

extension DS {
    /// Spacing, in points. The brand page's screens sit 40 from the edge with 20 between cards.
    public enum Space {
        public static let xxs: CGFloat = 4
        public static let xs: CGFloat = 8
        public static let s: CGFloat = 12
        public static let m: CGFloat = 16
        public static let l: CGFloat = 20
        /// Inside a card.
        public static let xl: CGFloat = 28
        /// A screen's margin on iPad.
        public static let xxl: CGFloat = 40
        public static let xxxl: CGFloat = 64

        public static let all: [(String, CGFloat)] = [
            ("xxs", xxs), ("xs", xs), ("s", s), ("m", m), ("l", l), ("xl", xl), ("xxl", xxl), ("xxxl", xxxl),
        ]
    }

    /// Corner radii. Buttons and chips are capsules and tools are circles; these are the rest.
    public enum Radius {
        /// The board thumbnail inside a tile.
        public static let thumb: CGFloat = 16
        /// The writing page.
        public static let page: CGFloat = 18
        /// A pen swatch's square, a small well.
        public static let swatch: CGFloat = 14
        /// A chat bubble; its tail corner is `bubbleTail`.
        public static let bubble: CGFloat = 22
        public static let bubbleTail: CGFloat = 6
        /// A board tile on Home.
        public static let tile: CGFloat = 24
        /// Cards: "Cards 28".
        public static let card: CGFloat = 28
        /// The big cards on Home (Today, the path).
        public static let cardLarge: CGFloat = 32

        public static let all: [(String, CGFloat)] = [
            ("thumb", thumb), ("page", page), ("swatch", swatch), ("bubble", bubble), ("tile", tile),
            ("card", card), ("cardLarge", cardLarge),
        ]
    }

    /// Sizes and tap targets, in points.
    public enum Size {
        /// Every kid control is at least this big (the brand page's rule; the app-wide floor is 52).
        public static let minTarget: CGFloat = 56
        /// A tool: a circle.
        public static let tool: CGFloat = 56
        /// A main button's height.
        public static let mainButton: CGFloat = 64
        /// A smaller pill (New board, chips that act).
        public static let button: CGFloat = 56
        /// Help me: the biggest thing on the board.
        public static let helpMe: CGFloat = 72
        /// A round icon button in a top bar.
        public static let round: CGFloat = 56
        /// The badge circle at the front of a pill button.
        public static let badge: CGFloat = 44
        /// A pen swatch: the ring you see; its tap target is `minTarget`.
        public static let swatch: CGFloat = 42
        public static let swatchDot: CGFloat = 28
        public static let avatar: CGFloat = 40
        /// A text field and the Ask input.
        public static let field: CGFloat = 60
        /// A PIN key.
        public static let pinKey: CGFloat = 76
        /// The dock on the board.
        public static let dock: CGFloat = 72
        /// An icon inside a tool or round button.
        public static let icon: CGFloat = 24
    }

    /// Line weights. Blocks has no borders: these are icon strokes, the mark's ring, and focus.
    public enum Stroke {
        /// Line icons: 2.6 pt.
        public static let icon: CGFloat = 2.6
        /// The ring round the selected pen.
        public static let selected: CGFloat = 3
        /// A focus ring.
        public static let focus: CGFloat = 3
        /// The mark's ring is 10 % of the mark's box.
        public static let markRingRatio: CGFloat = 0.10
    }
}
