import AgathonBoard
import AgathonBoardUI
import AgathonDesign
import SwiftUI
import UIKit

/// A formula typeset with the board's own SwiftMath (Latin Modern, as the board's maths), drawn
/// into an image for a line of text. Cached: a streaming reply repaints the same formulas.
enum MathImage {
    struct Rendered {
        let image: UIImage
        /// how far the image hangs below the text's baseline
        let descent: CGFloat
    }

    nonisolated(unsafe) private static let cache: NSCache<NSString, Box> = {
        let c = NSCache<NSString, Box>()
        c.countLimit = 400
        return c
    }()

    final class Box {
        let value: Rendered?
        init(_ v: Rendered?) { value = v }
    }

    /// nil when SwiftMath could not read it (the panel shows the maths as text instead).
    static func render(_ latex: String, size: CGFloat, color: UIColor) -> Rendered? {
        let key = "\(size)|\(color.description)|\(latex)" as NSString
        if let hit = cache.object(forKey: key) { return hit.value }
        let out = make(latex, size: size, color: color)
        cache.setObject(Box(out), forKey: key)
        return out
    }

    private static func make(_ latex: String, size: CGFloat, color: UIColor) -> Rendered? {
        let math = SwiftMathTypesetter.make(latex, fontSize: Double(size), color: color.cgColor)
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
        return Rendered(image: image, descent: CGFloat(math.descent) + pad)
    }
}

/// A tutor's message: Markdown-lite with typeset maths, white on cobalt (the tutor's colour, as its
/// ink on the board), in the bubble's own shape (`ChatBubble`'s geometry: the tail at the bottom left).
struct RichBubble: View {
    let text: String
    let streaming: Bool
    @Environment(\.dynamicTypeSize) private var typeSize

    private var size: CGFloat { 17 * min(1.6, typeSize.scale) }

    var body: some View {
        let blocks = RichText.parse(text, streaming: streaming)
        VStack(alignment: .leading, spacing: DS.Space.s) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                blockView(block)
            }
        }
        .foregroundStyle(DS.Color.onInk)
        .padding(.horizontal, DS.Space.m)
        .padding(.vertical, 14)
        .background(BubbleShape(from: .tutor).fill(DS.Color.tutorInk))
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Tutor: \(RichText.plainText(blocks, readable: true))")
    }

    @ViewBuilder
    private func blockView(_ block: RichBlock) -> some View {
        switch block {
        case .paragraph(let nodes):
            line(nodes)
        case .math(let latex):
            display(latex)
        case .bullets(let items):
            VStack(alignment: .leading, spacing: DS.Space.xs) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .firstTextBaseline, spacing: DS.Space.xs) {
                        Text("•").dsFont(.callout)
                        line(item)
                    }
                }
            }
        case .numbered(let start, let items):
            VStack(alignment: .leading, spacing: DS.Space.xs) {
                ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                    HStack(alignment: .firstTextBaseline, spacing: DS.Space.xs) {
                        Text("\(start + i).").dsFont(.callout).fontWeight(.semibold).monospacedDigit()
                        line(item)
                    }
                }
            }
        }
    }

    private func line(_ nodes: [RichInline]) -> some View {
        inline(nodes, bold: false)
            .dsFont(.callout)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func inline(_ nodes: [RichInline], bold: Bool) -> Text {
        nodes.reduce(Text("")) { acc, n in
            switch n {
            case .text(let v):
                return acc + (bold ? Text(v).fontWeight(.semibold) : Text(v))
            case .bold(let c):
                return acc + inline(c, bold: true)
            case .br:
                return acc + Text("\n")
            case .math(let latex, _):
                if let r = MathImage.render(latex, size: size * 1.12, color: .white) {
                    return acc + Text(Image(uiImage: r.image)).baselineOffset(-r.descent)
                }
                return acc + Text(RichText.mathAsText(latex)).italic()
            }
        }
    }

    @ViewBuilder
    private func display(_ latex: String) -> some View {
        if let r = MathImage.render(latex, size: size * 1.35, color: .white) {
            Image(uiImage: r.image)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.vertical, DS.Space.xxs)
        } else {
            Text(RichText.mathAsText(latex)).dsFont(.callout).italic()
        }
    }
}

/// ChatBubble's shape: round corners, a small one at the speaker's side, bottom.
struct BubbleShape: Shape {
    let from: ChatBubble.From

    func path(in rect: CGRect) -> Path {
        UnevenRoundedRectangle(
            topLeadingRadius: DS.Radius.bubble,
            bottomLeadingRadius: from == .tutor ? DS.Radius.bubbleTail : DS.Radius.bubble,
            bottomTrailingRadius: from == .kid ? DS.Radius.bubbleTail : DS.Radius.bubble,
            topTrailingRadius: DS.Radius.bubble, style: .continuous
        ).path(in: rect)
    }
}

/// The tutor thinking: three dots in a small cobalt bubble, breathing (still under Reduce Motion).
struct ThinkingBubble: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase = false

    var body: some View {
        HStack(spacing: 7) {
            ForEach(0..<3, id: \.self) { i in
                Circle().fill(DS.Color.onInk)
                    .frame(width: 9, height: 9)
                    .opacity(reduceMotion ? 0.9 : (phase ? (i == 1 ? 1 : 0.45) : (i == 1 ? 0.45 : 1)))
            }
        }
        .padding(.horizontal, 20)
        .frame(height: 48)
        .background(BubbleShape(from: .tutor).fill(DS.Color.tutorInk))
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 0.55).repeatForever(autoreverses: true)) { phase = true }
        }
        .accessibilityElement()
        .accessibilityLabel(AskCopy.thinking)
    }
}

/// One message of the thread: the kid's words in chalk (`ChatBubble`), the tutor's in cobalt with
/// its maths typeset, its notes, what it is doing, and Try again after a failure.
struct AskMessageView: View {
    let message: ChatMessage
    let busy: Bool
    let onRetry: () -> Void
    let onReplay: (() -> Void)?

    var body: some View {
        switch message.role {
        case .user:
            ChatBubble(message.text, from: .kid, icon: message.voice ? .mic : nil)
                .padding(.leading, DS.Space.xxl)
                .accessibilityIdentifier("ask.message.user")
        case .tutor:
            tutor
        }
    }

    @ViewBuilder
    private var tutor: some View {
        VStack(alignment: .leading, spacing: DS.Space.xs) {
            if message.state == .thinking {
                ThinkingBubble()
            } else {
                HStack(alignment: .bottom, spacing: DS.Space.xs) {
                    RichBubble(text: message.text, streaming: message.state == .streaming)
                    if let onReplay, message.state == .done, !message.text.isEmpty, message.error == nil {
                        ReplayButton(action: onReplay)
                    }
                }
            }
            if message.state == .writing {
                StatusPill(AskCopy.writing)
                    .accessibilityIdentifier("ask.writing")
            }
            ForEach(message.notes, id: \.self) { note in
                HStack(alignment: .firstTextBaseline, spacing: DS.Space.xs) {
                    DSIcon(.lookAgain, size: 15).foregroundStyle(DS.Color.inkSecondary)
                    Text(note).dsFont(.caption).foregroundStyle(DS.Color.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.leading, DS.Space.xxs)
            }
            if message.state == .error, message.error?.retry == true {
                PillButton(AskCopy.retry, icon: .retry, kind: .secondaryOnPaper) { onRetry() }
                    .disabled(busy)
                    .accessibilityIdentifier("ask.retry")
            }
        }
        .padding(.trailing, DS.Space.l)
        .accessibilityIdentifier("ask.message.tutor")
    }
}

/// "Read it again": a small chalk speaker beside a finished answer (a 56 pt target).
struct ReplayButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            DSIcon(.speaker, size: 18)
                .foregroundStyle(DS.Color.ink)
                .frame(width: 40, height: 40)
                .background(Circle().fill(DS.Color.surfaceSunken))
                .frame(width: DS.Size.minTarget, height: DS.Size.minTarget)
                .contentShape(Circle())
        }
        .buttonStyle(PressStyle())
        .accessibilityLabel(AskCopy.replay)
    }
}

/// Press: shrink to 96 % (the system's own press).
struct PressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? DS.Motion.pressScale : 1)
            .animation(DS.Motion.press, value: configuration.isPressed)
    }
}

extension DynamicTypeSize {
    /// Roughly how much bigger than the default the text is.
    var scale: CGFloat {
        switch self {
        case .xSmall: 0.82
        case .small: 0.88
        case .medium: 0.94
        case .large: 1
        case .xLarge: 1.12
        case .xxLarge: 1.23
        case .xxxLarge: 1.35
        case .accessibility1: 1.6
        case .accessibility2: 1.9
        case .accessibility3: 2.3
        case .accessibility4: 2.75
        case .accessibility5: 3.1
        @unknown default: 1
        }
    }
}
