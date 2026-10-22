import CoreGraphics

/// Where "Now you try one" goes on the page (view points, its top-left). The owner's call (2026-10-22):
/// it never covers a problem page's answer or its tick — the kid sessions found it bottom-centre, over
/// both. In free space on the page: bottom-trailing first, then trailing above the answer spot, beside
/// the work, top-trailing, under the work, then anywhere a scan finds. A spot with no ink under it wins;
/// failing that, the one with least ink under it — the answer spot always kept clear.
public enum NowYouTryPlacement {
    /// - Parameters:
    ///   - card: the card's size
    ///   - page: the page on show
    ///   - answer: the answer spot (a problem page's), kept clear whatever happens
    ///   - ink: every stroke and typeset line on the page, the kid's and the tutor's
    public static func place(card: CGSize, page: CGRect, answer: CGRect?, ink: [CGRect], margin: CGFloat = 16) -> CGPoint {
        let inner = page.insetBy(dx: margin, dy: margin)
        let work = ink.reduce(CGRect.null) { $0.union($1) }
        let trailing = inner.maxX - card.width
        var spots: [CGPoint] = [
            CGPoint(x: trailing, y: inner.maxY - card.height),
            CGPoint(x: trailing, y: (answer?.minY ?? inner.maxY) - margin - card.height),
            CGPoint(x: trailing, y: work.isNull ? inner.midY - card.height / 2 : work.midY - card.height / 2),
            CGPoint(x: trailing, y: inner.minY),
            CGPoint(x: inner.minX, y: work.isNull ? inner.minY : work.maxY + margin),
        ]
        for fy in stride(from: 1.0, through: 0.0, by: -0.125) {
            for fx in [1.0, 0.75, 0.5, 0.25, 0.0] {
                spots.append(CGPoint(x: inner.minX + (inner.width - card.width) * fx, y: inner.minY + (inner.height - card.height) * fy))
            }
        }
        // inside the page
        spots = spots.map { p in
            CGPoint(x: min(max(p.x, inner.minX), max(inner.minX, inner.maxX - card.width)),
                    y: min(max(p.y, inner.minY), max(inner.minY, inner.maxY - card.height)))
        }
        func rect(_ p: CGPoint) -> CGRect { CGRect(origin: p, size: card) }
        func clearOfAnswer(_ r: CGRect) -> Bool { answer.map { !r.intersects($0.insetBy(dx: -8, dy: -8)) } ?? true }
        func inkUnder(_ r: CGRect) -> CGFloat {
            ink.reduce(0) { sum, i in
                let x = r.intersection(i.insetBy(dx: -12, dy: -12))
                return x.isNull ? sum : sum + x.width * x.height
            }
        }
        if let free = spots.first(where: { clearOfAnswer(rect($0)) && inkUnder(rect($0)) == 0 }) { return free }
        if let least = spots.filter({ clearOfAnswer(rect($0)) }).min(by: { inkUnder(rect($0)) < inkUnder(rect($1)) }) { return least }
        return spots[0]
    }
}
