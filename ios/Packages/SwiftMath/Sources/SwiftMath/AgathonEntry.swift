// Agathon: the one addition to the vendored SwiftMath (see Package.swift). MIT, like the rest.
import CoreGraphics
import Foundation

/// LaTeX → a typeset display list that draws itself into any `CGContext`, on any thread.
public enum MTTypesetting {
    /// The bundled Latin Modern Math font at `size` points.
    public static func latinModern(size: CGFloat) -> MTFont? {
        MTFontManager.fontManager.latinModernFont(withSize: size)
    }

    /// Parses and lays out `latex` in `color`. The display's baseline is at y = 0 in a y-up space (as
    /// CoreText draws): flip the context to draw it into a y-down one. Nil, with the parser's error,
    /// when it cannot be typeset.
    public static func display(latex: String, font: MTFont, style: MTLineStyle = .text, color: MTColor) -> (display: MTMathListDisplay?, error: NSError?) {
        var error: NSError?
        guard let list = MTMathListBuilder.build(fromString: latex, error: &error), error == nil else { return (nil, error) }
        guard let display = MTTypesetter.createLineForMathList(list, font: font, style: style) else { return (nil, nil) }
        display.textColor = color
        display.position = .zero
        return (display, nil)
    }
}
