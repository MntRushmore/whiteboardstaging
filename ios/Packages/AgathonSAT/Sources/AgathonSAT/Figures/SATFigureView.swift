#if os(iOS)
import AgathonDesign
import SwiftUI
import UIKit

/// A question's figure, drawn natively (docs/SAT-MODE.md, "Figures": never an image): a table, a
/// coordinate plane, or a geometry figure, with its note ("Note: Figure not drawn to scale.") under
/// it. Flat colour; the lines in ink (cobalt is the tutor's alone); labels in Lexend, maths in Latin
/// Modern.
public struct SATFigureView: View {
    let figure: SATFigure

    public init(_ figure: SATFigure) {
        self.figure = figure
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.xs) {
            switch figure {
            case .table(let t): SATTableView(table: t)
            case .plot(let p): SATPlotView(plot: p)
            case .shape(let s): SATShapeView(shape: s)
            }
            if let note = figure.note, !note.isEmpty {
                Text(note)
                    .dsFont(.caption)
                    .italic()
                    .foregroundStyle(DS.Color.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("sat.figure.\(figure.kind)")
    }
}

// MARK: - table

/// A table: a chalk header row, hairline rules between rows (the one functional hairline), cells
/// that may hold maths.
struct SATTableView: View {
    let table: SATTable

    var body: some View {
        let columns = max(table.headers.count, table.rows.map(\.count).max() ?? 0)
        Grid(horizontalSpacing: 0, verticalSpacing: 0) {
            GridRow {
                ForEach(0..<columns, id: \.self) { c in
                    cell(c < table.headers.count ? table.headers[c] : "", header: true)
                }
            }
            .background(DS.Color.surfaceSunken)
            ForEach(Array(table.rows.enumerated()), id: \.offset) { _, row in
                Rectangle().fill(DS.Color.line).frame(height: 1).gridCellUnsizedAxes(.horizontal)
                GridRow {
                    ForEach(0..<columns, id: \.self) { c in
                        cell(c < row.count ? row[c] : "", header: false)
                    }
                }
            }
        }
        .background(DS.Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(DS.Color.line, lineWidth: 1))
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
    }

    private func cell(_ text: String, header: Bool) -> some View {
        SATText(text.isEmpty ? " " : text, size: 17, weight: header ? .semibold : .regular, alignment: .center)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, minHeight: 44)
    }

    private var spoken: String {
        let head = "A table. Columns: " + table.headers.map(SATRichText.plain).joined(separator: ", ") + "."
        let rows = table.rows.enumerated().map { i, r in "Row \(i + 1): " + r.map(SATRichText.plain).joined(separator: ", ") + "." }
        return ([head] + rows).joined(separator: " ")
    }
}

// MARK: - labels in a Canvas

/// A label for a figure: maths (`$…$`) as an image, else words in Lexend.
enum SATFigureLabel {
    static func resolve(_ text: String, size: CGFloat, color: Color, in context: GraphicsContext) -> (draw: (inout GraphicsContext, CGPoint, UnitPoint) -> Void, size: CGSize) {
        let blocks = SATRichText.parse(text)
        if case .paragraph(let nodes)? = blocks.first, blocks.count == 1, nodes.count == 1, case .math(let latex) = nodes[0],
           let r = SATMathImage.render(latex, size: size * 1.12, color: UIColor(color)) {
            let image = context.resolve(Image(uiImage: r.image))
            return ({ ctx, p, anchor in ctx.draw(image, at: p, anchor: anchor) }, r.size)
        }
        let plain = SATRichText.plain(text)
        let resolved = context.resolve(Text(plain).font(.custom(DSFonts.uiPostScriptName(weight: 500), fixedSize: size)).foregroundColor(color))
        let measured = resolved.measure(in: CGSize(width: 400, height: 100))
        return ({ ctx, p, anchor in ctx.draw(resolved, at: p, anchor: anchor) }, measured)
    }
}

/// A tick value as the test writes it: whole numbers plainly, others to 2 places, a real minus.
func satTick(_ v: Double) -> String {
    let r = (v * 100).rounded() / 100
    let s = r == r.rounded() ? String(Int(r)) : String(format: "%g", r)
    return s.replacingOccurrences(of: "-", with: "−")
}
#endif
