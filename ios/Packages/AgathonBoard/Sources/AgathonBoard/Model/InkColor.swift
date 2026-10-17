import Foundation

/// A colour token. The document stores the token, never a hex value, so the brand lane can tune
/// the palette without touching a saved board.
///
/// The rule: **the kid's colours are never the tutor's.** The tutor writes, ticks and rings in
/// `tutor`; the kid's palette (`kidPalette`) never offers it, and a kid stroke is never stored in
/// it (`Stroke.normalized`). The rest are tldraw's palette names, so a converted board keeps the
/// colour each stroke was drawn in.
public enum InkColor: String, Codable, Sendable, CaseIterable {
    // the kid's palette (KID_COLORS on the web: black, red, green, violet)
    case black, red, green, violet
    /// the tutor's ink (the web's TUTOR_INK_COLOR, tldraw "blue")
    case tutor
    // tldraw's other colours, for converted boards
    case blue, grey, orange, yellow, white
    case lightBlue = "light-blue"
    case lightGreen = "light-green"
    case lightRed = "light-red"
    case lightViolet = "light-violet"

    /// The colours a kid can pick, in the dock's order.
    public static let kidPalette: [InkColor] = [.black, .red, .green, .violet]

    /// sRGB components, 0…1 (tldraw's light theme values, so converted boards look the same).
    public var rgb: (r: Double, g: Double, b: Double) {
        switch self {
        case .black: return Self.hex(0x1D1D1D)
        case .red: return Self.hex(0xE03131)
        case .green: return Self.hex(0x099268)
        case .violet: return Self.hex(0xAE3EC9)
        case .tutor: return Self.hex(0x4465E9)
        // A kid's blue on an old board (the classic board offered it). Kept a different blue from
        // the tutor's so it never reads as the tutor's writing.
        case .blue: return Self.hex(0x1971C2)
        case .grey: return Self.hex(0x9FA8B2)
        case .orange: return Self.hex(0xE16919)
        case .yellow: return Self.hex(0xF1AC4B)
        case .white: return Self.hex(0xFFFFFF)
        case .lightBlue: return Self.hex(0x4BA1F1)
        case .lightGreen: return Self.hex(0x4CB05E)
        case .lightRed: return Self.hex(0xF87777)
        case .lightViolet: return Self.hex(0xE085F4)
        }
    }

    private static func hex(_ v: UInt32) -> (r: Double, g: Double, b: Double) {
        (Double((v >> 16) & 0xFF) / 255, Double((v >> 8) & 0xFF) / 255, Double(v & 0xFF) / 255)
    }

    /// A tldraw colour name for an author: tldraw "blue" is the tutor's only when the tutor drew it.
    public static func fromTldraw(_ name: String, author: Author) -> InkColor {
        if name == "blue" { return author == .tutor ? .tutor : .blue }
        return InkColor(rawValue: name) ?? .black
    }
}

/// Who made a record. The kid's work is undoable by the kid; the tutor's is not.
public enum Author: String, Codable, Sendable {
    case kid
    case tutor
}

/// How a stroke's width follows its points' pressure.
public enum PressureMode: String, Codable, Sendable {
    /// a Pencil's force (or the tutor's pen, which carries a pressure hint)
    case real
    /// a finger or a mouse: the width is made up from the speed, as tldraw does
    case simulated
}

/// How a closed outline is filled. (tldraw's names mean other things: its `solid` is our `semi`,
/// its `fill` our `solid`, its `semi` our `paper`; the importer maps them.)
public enum FillStyle: String, Codable, Sendable {
    case none
    /// a light tint of the stroke's colour
    case semi
    /// the stroke's colour
    case solid
    /// opaque paper white: hides what is under it
    case paper

    /// tldraw's fill style name → ours
    public static func fromTldraw(_ name: String) -> FillStyle {
        switch name {
        case "none": return .none
        case "semi": return .paper
        case "fill": return .solid
        default: return .semi // "solid", "pattern", "lined-fill": a tint
        }
    }
}
