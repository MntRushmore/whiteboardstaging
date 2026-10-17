import Foundation
import SwiftUI
import UIKit

/// An opaque sRGB colour with the maths the design system checks itself with: WCAG contrast and
/// CIEDE2000 distance. Every Blocks colour is a flat, opaque fill, so there is no alpha here; a
/// "faint white on cobalt" is a real colour made with `mixed(with:amount:)`, not a transparency.
public struct RGB: Hashable, Sendable, CustomStringConvertible {
    /// Channels in 0...1, gamma-encoded sRGB.
    public let r: Double
    public let g: Double
    public let b: Double

    public init(r: Double, g: Double, b: Double) {
        self.r = min(max(r, 0), 1)
        self.g = min(max(g, 0), 1)
        self.b = min(max(b, 0), 1)
    }

    /// `RGB(0x2D5BFF)`.
    public init(_ hex: UInt32) {
        self.init(
            r: Double((hex >> 16) & 0xFF) / 255,
            g: Double((hex >> 8) & 0xFF) / 255,
            b: Double(hex & 0xFF) / 255
        )
    }

    /// `#2D5BFF`.
    public var hex: String {
        String(format: "#%02X%02X%02X", Int((r * 255).rounded()), Int((g * 255).rounded()), Int((b * 255).rounded()))
    }

    public var description: String { hex }

    public var color: Color { Color(.sRGB, red: r, green: g, blue: b, opacity: 1) }
    public var uiColor: UIColor { UIColor(red: r, green: g, blue: b, alpha: 1) }

    /// A flat blend: `amount` of `other` laid over this colour (what `other` at that opacity would
    /// look like on top of it), returned as an opaque colour.
    public func mixed(with other: RGB, amount: Double) -> RGB {
        let t = min(max(amount, 0), 1)
        return RGB(r: r + (other.r - r) * t, g: g + (other.g - g) * t, b: b + (other.b - b) * t)
    }

    // MARK: WCAG 2.x

    /// Relative luminance (WCAG 2.x).
    public var luminance: Double {
        func lin(_ c: Double) -> Double { c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    }

    /// Contrast ratio, 1...21.
    public func contrast(with other: RGB) -> Double {
        let a = luminance, b = other.luminance
        return (max(a, b) + 0.05) / (min(a, b) + 0.05)
    }

    // MARK: CIELAB and CIEDE2000

    /// CIELAB (D65).
    public var lab: (l: Double, a: Double, b: Double) {
        func lin(_ c: Double) -> Double { c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
        let rl = lin(r), gl = lin(g), bl = lin(b)
        let x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047
        let y = (rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750) / 1.0
        let z = (rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041) / 1.08883
        func f(_ t: Double) -> Double { t > 216.0 / 24389.0 ? cbrt(t) : (24389.0 / 27.0 * t + 16) / 116 }
        let fx = f(x), fy = f(y), fz = f(z)
        return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))
    }

    /// Chroma and hue angle (degrees) in CIELAB.
    public var lch: (l: Double, c: Double, h: Double) {
        let v = lab
        var h = atan2(v.b, v.a) * 180 / .pi
        if h < 0 { h += 360 }
        return (v.l, hypot(v.a, v.b), h)
    }

    /// CIEDE2000 colour difference. Around 2 is just noticeable; over 25 reads as a different colour.
    public func deltaE2000(_ other: RGB) -> Double {
        let p = lab, q = other.lab
        return RGB.deltaE2000((p.l, p.a, p.b), (q.l, q.a, q.b))
    }

    /// CIEDE2000 between two CIELAB colours (Sharma, Wu and Dalal, 2005).
    public static func deltaE2000(_ c1: (Double, Double, Double), _ c2: (Double, Double, Double)) -> Double {
        let (l1, a1, b1) = c1
        let (l2, a2, b2) = c2
        let rad = Double.pi / 180
        let c1 = hypot(a1, b1), c2 = hypot(a2, b2)
        let cBar = (c1 + c2) / 2
        let g = 0.5 * (1 - sqrt(pow(cBar, 7) / (pow(cBar, 7) + pow(25, 7))))
        let a1p = (1 + g) * a1, a2p = (1 + g) * a2
        let c1p = hypot(a1p, b1), c2p = hypot(a2p, b2)
        func hue(_ b: Double, _ a: Double) -> Double {
            if a == 0 && b == 0 { return 0 }
            let h = atan2(b, a) / rad
            return h < 0 ? h + 360 : h
        }
        let h1p = hue(b1, a1p), h2p = hue(b2, a2p)
        let dLp = l2 - l1
        let dCp = c2p - c1p
        var dhp = 0.0
        if c1p * c2p != 0 {
            dhp = h2p - h1p
            if dhp > 180 { dhp -= 360 } else if dhp < -180 { dhp += 360 }
        }
        let dHp = 2 * sqrt(c1p * c2p) * sin(dhp / 2 * rad)
        let lBarP = (l1 + l2) / 2
        let cBarP = (c1p + c2p) / 2
        var hBarP = h1p + h2p
        if c1p * c2p != 0 {
            if abs(h1p - h2p) <= 180 { hBarP = (h1p + h2p) / 2 }
            else if h1p + h2p < 360 { hBarP = (h1p + h2p + 360) / 2 }
            else { hBarP = (h1p + h2p - 360) / 2 }
        }
        let t = 1 - 0.17 * cos((hBarP - 30) * rad) + 0.24 * cos(2 * hBarP * rad)
            + 0.32 * cos((3 * hBarP + 6) * rad) - 0.20 * cos((4 * hBarP - 63) * rad)
        let dTheta = 30 * exp(-pow((hBarP - 275) / 25, 2))
        let rc = 2 * sqrt(pow(cBarP, 7) / (pow(cBarP, 7) + pow(25, 7)))
        let sl = 1 + 0.015 * pow(lBarP - 50, 2) / sqrt(20 + pow(lBarP - 50, 2))
        let sc = 1 + 0.045 * cBarP
        let sh = 1 + 0.015 * cBarP * t
        let rt = -sin(2 * dTheta * rad) * rc
        let x = dLp / sl, y = dCp / sc, z = dHp / sh
        return sqrt(x * x + y * y + z * z + rt * y * z)
    }
}

/// A named colour with a light value now and room for a dark one. `dark == nil` means the dark
/// theme isn't designed yet and the light value is used in both (the app runs light for now).
public struct ColorToken: Hashable, Sendable, Identifiable {
    public let name: String
    public let light: RGB
    public let dark: RGB?

    public var id: String { name }

    public init(_ name: String, _ light: RGB, dark: RGB? = nil) {
        self.name = name
        self.light = light
        self.dark = dark
    }

    /// The SwiftUI colour, resolving light or dark from the trait collection.
    public var color: Color {
        guard let dark else { return light.color }
        let l = light.uiColor, d = dark.uiColor
        return Color(UIColor { $0.userInterfaceStyle == .dark ? d : l })
    }

    public var uiColor: UIColor {
        guard let dark else { return light.uiColor }
        let l = light.uiColor, d = dark.uiColor
        return UIColor { $0.userInterfaceStyle == .dark ? d : l }
    }
}
