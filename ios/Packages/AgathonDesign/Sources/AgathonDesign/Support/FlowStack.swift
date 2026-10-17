import SwiftUI

/// Lays views out left to right and wraps to a new line when the row is full, like the brand
/// page's chip rows (`flex-wrap`). For chips, tags and rows of buttons that must fit an iPad mini
/// held upright as well as a 13-inch iPad on its side.
public struct FlowStack: Layout {
    let spacing: CGFloat
    let lineSpacing: CGFloat
    let alignment: VerticalAlignment

    public init(spacing: CGFloat = DS.Space.s, lineSpacing: CGFloat = DS.Space.s, alignment: VerticalAlignment = .center) {
        self.spacing = spacing
        self.lineSpacing = lineSpacing
        self.alignment = alignment
    }

    private struct Line {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func lines(_ sizes: [CGSize], maxWidth: CGFloat) -> [Line] {
        var lines: [Line] = [Line()]
        for (i, size) in sizes.enumerated() {
            let extra = lines[lines.count - 1].indices.isEmpty ? size.width : spacing + size.width
            if !lines[lines.count - 1].indices.isEmpty && lines[lines.count - 1].width + extra > maxWidth {
                lines.append(Line())
            }
            var line = lines[lines.count - 1]
            line.width += line.indices.isEmpty ? size.width : spacing + size.width
            line.height = max(line.height, size.height)
            line.indices.append(i)
            lines[lines.count - 1] = line
        }
        return lines
    }

    public func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        let maxWidth = proposal.width ?? .infinity
        let ls = lines(sizes, maxWidth: maxWidth)
        let width = ls.map(\.width).max() ?? 0
        let height = ls.map(\.height).reduce(0, +) + lineSpacing * CGFloat(max(ls.count - 1, 0))
        return CGSize(width: proposal.width.map { min($0, width) } ?? width, height: height)
    }

    public func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        var y = bounds.minY
        for line in lines(sizes, maxWidth: bounds.width) {
            var x = bounds.minX
            for i in line.indices {
                let size = sizes[i]
                let dy: CGFloat = switch alignment {
                case .top: 0
                case .bottom: line.height - size.height
                default: (line.height - size.height) / 2
                }
                subviews[i].place(at: CGPoint(x: x, y: y + dy), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += line.height + lineSpacing
        }
    }
}
