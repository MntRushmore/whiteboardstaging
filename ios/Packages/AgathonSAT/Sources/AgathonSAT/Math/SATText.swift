#if os(iOS)
import AgathonBoard
import AgathonDesign
import SwiftUI
import UIKit

/// A formula typeset by the board's own typesetter (AgathonBoard's `MathRendering`: SwiftMath with
/// Latin Modern once the app has installed it, `BoardEditorSetup.install()`), drawn into an image
/// that sits in a line of text on its baseline. Cached by size, colour and LaTeX.
enum SATMathImage {
    struct Rendered {
        let image: UIImage
        /// how far the image hangs below the text's baseline
        let descent: CGFloat
        let size: CGSize
    }

    nonisolated(unsafe) private static let cache: NSCache<NSString, Box> = {
        let c = NSCache<NSString, Box>()
        c.countLimit = 600
        return c
    }()

    final class Box {
        let value: Rendered?
        init(_ v: Rendered?) { value = v }
    }

    /// nil when the typesetter could not read it (the maths shows as plain text instead).
    static func render(_ latex: String, size: CGFloat, color: UIColor) -> Rendered? {
        let key = "\(size)|\(color.description)|\(latex)" as NSString
        if let hit = cache.object(forKey: key) { return hit.value }
        let out = make(latex, size: size, color: color)
        cache.setObject(Box(out), forKey: key)
        return out
    }

    private static func make(_ latex: String, size: CGFloat, color: UIColor) -> Rendered? {
        let math = MathRendering.typeset(latex, fontSize: Double(size), color: color.cgColor)
        guard !math.isFallback, math.width > 0 else { return nil }
        let pad: CGFloat = 1
        let w = ceil(CGFloat(math.width) + pad * 2)
        let h = ceil(CGFloat(math.ascent + math.descent) + pad * 2)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 3
        format.opaque = false
        let image = UIGraphicsImageRenderer(size: CGSize(width: w, height: h), format: format).image { ctx in
            math.draw(ctx.cgContext, CGPoint(x: pad, y: pad + CGFloat(math.ascent)))
        }
        return Rendered(image: image, descent: CGFloat(math.descent) + pad, size: CGSize(width: w, height: h))
    }
}

/// A stem, a choice or a step: Markdown-lite with typeset maths (`SATRichText`), in Lexend with the
/// maths in Latin Modern on the text's baseline. Display maths sits on its own line, centred.
public struct SATText: View {
    let source: String
    let size: CGFloat
    let color: Color
    let weight: Font.Weight
    let alignment: HorizontalAlignment

    @Environment(\.dynamicTypeSize) private var typeSize

    public init(_ source: String, size: CGFloat = 19, color: Color = DS.Color.ink, weight: Font.Weight = .regular, alignment: HorizontalAlignment = .leading) {
        self.source = source
        self.size = size
        self.color = color
        self.weight = weight
        self.alignment = alignment
        _ = DSFonts.register()
    }

    /// The text size after Dynamic Type (capped where the panel still reads well).
    private var scaled: CGFloat { (size * SATText.scale(typeSize)).rounded() }

    public var body: some View {
        let blocks = SATRichText.parse(source)
        VStack(alignment: alignment, spacing: scaled * 0.6) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                switch block {
                case .paragraph(let nodes):
                    line(nodes)
                case .math(let latex):
                    display(latex)
                case .bullets(let items):
                    VStack(alignment: .leading, spacing: scaled * 0.35) {
                        ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                            HStack(alignment: .firstTextBaseline, spacing: 10) {
                                Text("•").font(font)
                                line(item)
                            }
                        }
                    }
                }
            }
        }
        .foregroundStyle(color)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(SATRichText.plain(source))
    }

    private var font: Font { .custom(DSFonts.uiPostScriptName(weight: weight == .regular ? 400 : 600), fixedSize: scaled) }

    private func line(_ nodes: [SATInline]) -> some View {
        inline(nodes, bold: weight != .regular)
            .font(font)
            .lineSpacing(scaled * 0.32)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: alignment == .center ? .center : .leading)
    }

    private func inline(_ nodes: [SATInline], bold: Bool) -> Text {
        nodes.reduce(Text("")) { acc, n in
            switch n {
            case .text(let v):
                return acc + (bold ? Text(v).fontWeight(.semibold) : Text(v))
            case .bold(let c):
                return acc + inline(c, bold: true)
            case .math(let latex):
                // Latin Modern runs small beside Lexend: a little bigger, a fraction bigger still
                let k: CGFloat = latex.contains("frac") ? 1.32 : 1.14
                if let r = SATMathImage.render(latex, size: scaled * k, color: UIColor(color)) {
                    return acc + Text(Image(uiImage: r.image)).baselineOffset(-r.descent)
                }
                return acc + Text(SATMathWords.plain(latex)).italic()
            }
        }
    }

    @ViewBuilder private func display(_ latex: String) -> some View {
        if let r = SATMathImage.render(latex, size: scaled * 1.3, color: UIColor(color)) {
            Image(uiImage: r.image)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.vertical, 2)
        } else {
            Text(SATMathWords.plain(latex)).font(font).italic().frame(maxWidth: .infinity)
        }
    }

    /// Roughly how much bigger than the default the text is (capped at 1.5×).
    static func scale(_ t: DynamicTypeSize) -> CGFloat {
        switch t {
        case .xSmall: 0.86
        case .small: 0.9
        case .medium: 0.95
        case .large: 1
        case .xLarge: 1.08
        case .xxLarge: 1.16
        case .xxxLarge: 1.24
        default: 1.5
        }
    }
}

/// One formula on its own (a solution step's maths, a table cell, a figure's label).
public struct SATMath: View {
    let latex: String
    let size: CGFloat
    let color: Color

    public init(_ latex: String, size: CGFloat = 22, color: Color = DS.Color.ink) {
        self.latex = latex
        self.size = size
        self.color = color
        _ = DSFonts.register()
    }

    public var body: some View {
        Group {
            if let r = SATMathImage.render(latex, size: size, color: UIColor(color)) {
                Image(uiImage: r.image)
            } else {
                Text(SATMathWords.plain(latex)).font(.custom(DSFonts.uiPostScriptName(weight: 400), fixedSize: size)).italic()
                    .foregroundStyle(color)
            }
        }
        .accessibilityLabel(SATMathWords.spoken(latex))
    }
}
#endif
