import AgathonBoard
import Foundation
import PDFKit
import UIKit

/// Made-up boards that exercise the board's objects: pictures, a PDF page, typeset maths, graphs,
/// shapes (dashed too), a highlighter. For Board Lab, previews, screenshots and tests. Their
/// pictures live in a `MemoryBoardAssetStore` (no network); nothing here is a real kid's work.
public enum BoardFixtures {
    /// A board of three pages — Objects (a photo, maths, a graph, shapes), PDF (a worksheet page)
    /// and Maths (the tutor's LaTeX: fractions, powers, roots, words, aligned steps, a sum in columns)
    /// — and the store that holds its pictures.
    public static func objects() async -> (BoardDocument, MemoryBoardAssetStore) {
        let store = MemoryBoardAssetStore()
        let keys = (try? OrderKey.sequence(3)) ?? ["a0", "a1", "a2"]
        let s1 = ScreenRecord(id: "screen:objects", order: keys[0], name: "Objects")
        let s2 = ScreenRecord(id: "screen:pdf", order: keys[1], name: "PDF")
        let s3 = ScreenRecord(id: "screen:maths", order: keys[2], name: "Maths")
        var records: [BoardRecord] = [.screen(s1), .screen(s2), .screen(s3)]

        // 1. Objects
        var z = OrderKey.first
        func next() -> OrderKey {
            defer { z = OrderKey.after(z) }
            return z
        }
        let photoURL = URL(string: "memory://board-assets/fixture/photo.jpg")!
        if let photo = PictureImport.photoLike() {
            await store.put(photo, at: photoURL)
        }
        records.append(.image(ImageRecord(id: "image:photo", screen: s1.id, order: next(), x: 60, y: 60, w: 520, h: 390,
                                          asset: AssetRef(src: photoURL.absoluteString, mime: "image/jpeg", w: 1040, h: 780))))
        records.append(.math(MathRecord(id: "math:q", screen: s1.id, order: next(), role: .answer, latex: "\\frac{3}{4} + \\frac{1}{8} = \\frac{7}{8}",
                                        x: 640, y: 70, w: 0, h: 0, fontSize: 40)))
        records.append(.math(MathRecord(id: "math:rb1", screen: s1.id, order: next(), role: .readback, latex: "2x+3=11", x: 640, y: 190, w: 0, h: 0, fontSize: 24)))
        records.append(.math(MathRecord(id: "math:rb2", screen: s1.id, order: next(), role: .readback, latex: "x=\\sqrt{16}", x: 840, y: 190, w: 0, h: 0, fontSize: 24)))
        records.append(.graph(GraphRecord(id: "graph:parabola", screen: s1.id, order: next(), author: .tutor, x: 1040, y: 60, w: 500, h: 400,
                                          functions: [GraphFunction(id: "f", expr: "x ^ 2 - 4", latex: "y = x^2 - 4")],
                                          points: [GraphPoint(x: -2, y: 0, label: "(-2, 0)"), GraphPoint(x: 2, y: 0, label: "(2, 0)"), GraphPoint(x: 0, y: -4, label: "(0, -4)")],
                                          window: GraphWindow(xMin: -5, xMax: 5, yMin: -6, yMax: 10))))
        records.append(.graph(GraphRecord(id: "graph:hyperbola", screen: s1.id, order: next(), author: .tutor, x: 640, y: 280, w: 360, h: 280,
                                          functions: [GraphFunction(id: "g", expr: "((1) / (x))", latex: "y = \\frac{1}{x}")],
                                          window: GraphWindow(xMin: -5, xMax: 5, yMin: -5, yMax: 5))))
        records.append(.shape(ShapeRecord(id: "shape:box", screen: s1.id, order: next(), kind: .rect, x: 80, y: 520, w: 260, h: 160, color: .red, width: 5)))
        records.append(.shape(ShapeRecord(id: "shape:dashed", screen: s1.id, order: next(), kind: .ellipse, x: 380, y: 530, w: 220, h: 150, color: .green, width: 3.5, meta: ["dash": "dashed"])))
        records.append(.shape(ShapeRecord(id: "shape:arrow", screen: s1.id, order: next(), kind: .arrow, x: 660, y: 620, points: [.zero, Vec2(240, -40)], color: .black, width: 5)))
        records.append(.shape(ShapeRecord(id: "shape:line", screen: s1.id, order: next(), kind: .line, x: 660, y: 700, points: [.zero, Vec2(240, 0)], color: .orange, width: 5, meta: ["dash": "dotted"])))
        let hl = StrokeRecord(id: "stroke:highlight", screen: s1.id, order: next(), author: .kid, color: .black, width: InkStyle.highlighterWidth,
                              pressure: .simulated, x: 1060, y: 520, points: (0..<40).map { InkPoint(x: Double($0) * 10, y: sin(Double($0) / 8) * 3) },
                              meta: ["highlight": true])
        records.append(.stroke(hl))
        records.append(.math(MathRecord(id: "math:hl", screen: s1.id, order: next(), author: .kid, role: .note, latex: "\\text{area} = 12 \\times 3", x: 1070, y: 500, w: 0, h: 0, fontSize: 32)))

        // 2. a PDF page, as the picker puts it: fitted, locked, kept from the tutor
        let worksheet = worksheetPDF() // kept alive while its page draws
        if let page = worksheet.page(at: 0) {
            let rect = fit(PictureImport.pageSize(page), in: s2.rect)
            if let img = PictureImport.render(page, width: Int(rect.w * 2.4)), let png = try? PictureImport.encodePNG(img) {
                let url = URL(string: "memory://board-assets/fixture/worksheet-p1.png")!
                await store.put(png.data, at: url)
                records.append(.image(ImageRecord(id: "image:pdf", screen: s2.id, order: "a0", x: rect.x, y: rect.y, w: rect.w, h: rect.h,
                                                  asset: AssetRef(src: url.absoluteString, mime: "image/png", w: Double(img.width), h: Double(img.height)),
                                                  meta: PictureImport.pdfMeta(fileName: "Fractions worksheet.pdf", page: 1))))
            }
        }

        // 3. the tutor's maths
        let lines: [(String, MathRole, Double)] = [
            ("\\frac{2}{3} \\times \\frac{3}{4} = \\frac{1}{2}", .answer, 36),
            ("x^{2} + 5x + 6 = (x + 2)(x + 3)", .answer, 32),
            ("x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}", .answer, 32),
            ("\\begin{aligned} 2x + 3 &= 11 \\\\ 2x &= 8 \\\\ x &= 4 \\end{aligned}", .answer, 30),
            ("\\text{Perimeter} = 2(l + w) = 2(5 + 3) = 16\\text{ cm}", .answer, 28),
            ("f(x) = \\begin{cases} x^{2} & x < 0 \\\\ 2x + 1 & x \\geq 0 \\end{cases}", .answer, 28),
            ("\\begin{array}{r} 286 \\\\ +680 \\\\ \\hline 966 \\end{array}", .answer, 32),
            ("\\sqrt[3]{27} = 3", .readback, 30),
            ("\\int_{0}^{2} 3x^{2} \\, dx = 8", .readback, 30),
            ("\\lim_{x \\to 3} \\frac{x^{2} - 9}{x - 3} = 6", .readback, 30),
        ]
        var y = 50.0
        for (i, l) in lines.enumerated() {
            let x = i < 7 ? 60.0 : 900.0
            if i == 7 { y = 60 }
            records.append(.math(MathRecord(id: RecordID("math:m\(i)"), screen: s3.id, order: OrderKey("a\(i)"), role: l.1, latex: l.0, x: x, y: y, w: 0, h: 0, fontSize: l.2)))
            y += l.0.contains("aligned") || l.0.contains("cases") || l.0.contains("array") ? 170 : 90
        }
        return (BoardDocument(records), store)
    }

    static func fit(_ size: CGSize, in screen: Box, margin: Double = 40) -> Box {
        let s = min(1, (screen.w - 2 * margin) / size.width, (screen.h - 2 * margin) / size.height)
        let w = size.width * s, h = size.height * s
        return Box(x: screen.x + (screen.w - w) / 2, y: screen.y + (screen.h - h) / 2, w: w, h: h)
    }

    /// A one-page worksheet PDF, made on the spot.
    public static func worksheetPDF() -> PDFDocument {
        let bounds = CGRect(x: 0, y: 0, width: 612, height: 792)
        let data = UIGraphicsPDFRenderer(bounds: bounds).pdfData { ctx in
            ctx.beginPage()
            let title: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 26, weight: .bold), .foregroundColor: UIColor.black]
            let body: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 20), .foregroundColor: UIColor.black]
            ("Adding fractions" as NSString).draw(at: CGPoint(x: 60, y: 60), withAttributes: title)
            ("Name ______________________" as NSString).draw(at: CGPoint(x: 330, y: 66), withAttributes: body)
            let problems = ["1.   1/4 + 2/4 =", "2.   3/8 + 1/8 =", "3.   1/2 + 1/4 =", "4.   2/3 + 1/6 =", "5.   3/5 + 1/10 ="]
            for (i, p) in problems.enumerated() {
                (p as NSString).draw(at: CGPoint(x: 70, y: 150 + Double(i) * 110), withAttributes: body)
            }
            UIColor(white: 0.85, alpha: 1).setStroke()
            let path = UIBezierPath(rect: CGRect(x: 40, y: 120, width: 532, height: 600))
            path.lineWidth = 1.5
            path.stroke()
        }
        return PDFDocument(data: data) ?? PDFDocument()
    }
}

extension PictureImport {
    /// A made-up photo of homework on a desk (flat shapes; no real picture), JPEG.
    static func photoLike() -> Data? {
        let size = CGSize(width: 1040, height: 780)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let img = UIGraphicsImageRenderer(size: size, format: format).image { ctx in
            UIColor(red: 0.86, green: 0.74, blue: 0.58, alpha: 1).setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
            let paper = UIBezierPath(roundedRect: CGRect(x: 160, y: 70, width: 720, height: 640), cornerRadius: 6)
            UIColor(white: 0.98, alpha: 1).setFill()
            paper.fill()
            UIColor(red: 0.55, green: 0.7, blue: 0.9, alpha: 1).setStroke()
            for i in 0..<14 {
                let l = UIBezierPath()
                l.move(to: CGPoint(x: 180, y: 140 + Double(i) * 40))
                l.addLine(to: CGPoint(x: 860, y: 140 + Double(i) * 40))
                l.lineWidth = 2
                l.stroke()
            }
            // the system's rounded face (a named font can send a test host looking for it for minutes)
            let base = UIFont.systemFont(ofSize: 44, weight: .medium)
            let font = base.fontDescriptor.withDesign(.rounded).map { UIFont(descriptor: $0, size: 44) } ?? base
            let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: UIColor(white: 0.15, alpha: 1)]
            ("24 + 18 = 42" as NSString).draw(at: CGPoint(x: 220, y: 150), withAttributes: attrs)
            ("3/4 + 1/8 = ?" as NSString).draw(at: CGPoint(x: 220, y: 270), withAttributes: attrs)
            UIColor(red: 0.95, green: 0.55, blue: 0.2, alpha: 1).setFill()
            UIBezierPath(roundedRect: CGRect(x: 900, y: 420, width: 40, height: 300), cornerRadius: 10).fill()
        }
        return img.jpegData(compressionQuality: 0.85)
    }
}
