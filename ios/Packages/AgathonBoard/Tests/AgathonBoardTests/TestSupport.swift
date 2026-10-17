import Foundation
@testable import AgathonBoard

enum Fixtures {
    static func url(_ name: String) -> URL {
        Bundle.module.url(forResource: name, withExtension: nil, subdirectory: "Fixtures")!
    }

    static func data(_ name: String) throws -> Data { try Data(contentsOf: url(name)) }
}

/// A kid stroke along `xy` (page units), pen pressure varying.
func makeStroke(
    _ id: String, screen: RecordID = "screen:a", order: OrderKey, xy: [(Double, Double)],
    author: Author = .kid, color: InkColor = .black, width: Double = 6
) -> StrokeRecord {
    let origin = xy.first.map { Vec2($0.0, $0.1) } ?? .zero
    let pts = xy.enumerated().map { i, p in
        InkPoint(x: Float(p.0 - origin.x), y: Float(p.1 - origin.y), pressure: 0.4 + 0.02 * Float(i % 10), t: Float(i * 4))
    }
    return StrokeRecord(
        id: RecordID(id), screen: screen, order: order, author: author, color: color, width: width, pressure: .real,
        x: origin.x, y: origin.y, points: pts, start: 1_760_000_000_000)
}

/// A horizontal stroke from (x0, y) to (x1, y).
func line(_ id: String, _ x0: Double, _ x1: Double, y: Double, order: OrderKey, screen: RecordID = "screen:a", author: Author = .kid) -> StrokeRecord {
    let n = max(2, Int((x1 - x0) / 2))
    return makeStroke(id, screen: screen, order: order, xy: (0...n).map { (x0 + (x1 - x0) * Double($0) / Double(n), y) }, author: author)
}

@MainActor
func storeWithScreen() -> BoardStore {
    BoardStore(document: BoardDocument([.screen(ScreenRecord(id: "screen:a", order: "a0"))]))
}

/// Milliseconds `body` takes (best of `runs`).
func measureMs(runs: Int = 1, _ body: () throws -> Void) rethrows -> Double {
    var best = Double.infinity
    for _ in 0..<runs {
        let t = CFAbsoluteTimeGetCurrent()
        try body()
        best = min(best, (CFAbsoluteTimeGetCurrent() - t) * 1000)
    }
    return best
}
