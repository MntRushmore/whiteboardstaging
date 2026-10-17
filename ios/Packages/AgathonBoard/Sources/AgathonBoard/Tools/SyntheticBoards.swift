import Foundation

/// Made-up boards for tests, measurements and the Lab: no real kid's work in them.
public enum SyntheticBoards {
    /// A screen of handwriting-like Pencil ink: `strokes` strokes in rows of digit-sized glyphs
    /// (1–3 strokes each, 1.2 page units between samples, a Pencil's pressure and 240 Hz times, its
    /// tilt when `tilt`), layered when there are more than a screen holds. Spread over `screens` screens.
    public static func handwriting(strokes: Int, screens: Int = 1, seed: UInt64 = 1, pencil: Bool = true, tilt: Bool = false) -> BoardDocument {
        var rng = SeededGenerator(seed: seed)
        func r(_ lo: Double, _ hi: Double) -> Double { lo + (hi - lo) * Double(rng.next() % 1_000_000) / 1_000_000 }
        var records: [BoardRecord] = []
        let screenKeys = (try? OrderKey.sequence(max(1, screens))) ?? [.first]
        let perScreen = Int((Double(strokes) / Double(max(1, screens))).rounded(.up))
        var made = 0
        var clock = 1_760_000_000_000.0 // a Tuesday afternoon in October 2025, ms
        for si in 0..<max(1, screens) {
            let screen = ScreenRecord(id: RecordID("screen:synthetic\(si)"), order: screenKeys[si])
            records.append(.screen(screen))
            let n = min(perScreen, strokes - made)
            guard n > 0 else { continue }
            let keys = (try? OrderKey.sequence(n)) ?? []
            var gx = 60.0, gy = 70.0
            var layer = 0
            var i = 0
            while i < n {
                // one glyph: 1–3 strokes in a 40 × 60 box
                let parts = min(n - i, 1 + Int(rng.next() % 3))
                let cx = gx + Double(layer) * 7
                let cy = gy + Double(layer) * 9
                for _ in 0..<parts {
                    let x0 = cx + r(-8, 30)
                    let y0 = cy + r(-20, 30)
                    let len = r(25, 110)
                    let a1 = r(0, 2 * .pi), a2 = r(0.5, 3.5)
                    let count = max(8, Int(len / 1.2))
                    var pts: [InkPoint] = []
                    pts.reserveCapacity(count)
                    var x = 0.0, y = 0.0
                    for k in 0..<count {
                        let t = Double(k) / Double(count - 1)
                        let ang = a1 + a2 * sin(t * 2.6) + t * 3
                        x += cos(ang) * 1.2
                        y += sin(ang) * 1.2 + 0.25
                        let p = pencil ? 0.35 + 0.45 * sin(t * .pi) + r(-0.03, 0.03) : 0.5
                        pts.append(InkPoint(
                            x: Float(x), y: Float(y), pressure: Float(p),
                            altitude: pencil && tilt ? Float(r(0.9, 1.2)) : -1, azimuth: pencil && tilt ? Float(r(0.4, 0.9)) : 0,
                            t: Float(Double(k) * 4.17)))
                    }
                    let stroke = StrokeRecord(
                        id: RecordID("stroke:syn\(si)_\(i)"), screen: screen.id, order: keys[i], author: .kid,
                        color: InkColor.kidPalette[Int(rng.next() % 7 == 0 ? 1 : 0)],
                        width: InkStyle.PenSize.regular.width, pressure: pencil ? .real : .simulated,
                        x: (x0 * 16).rounded() / 16, y: (y0 * 16).rounded() / 16, points: PointCodec.normalize(pts), start: clock)
                    records.append(.stroke(stroke))
                    clock += Double(count) * 4.17 + r(80, 400)
                    i += 1
                    made += 1
                    if i >= n { break }
                }
                gx += r(38, 52)
                if gx > 1520 {
                    gx = 60
                    gy += 78
                    if gy > 820 {
                        gy = 70
                        layer += 1
                    }
                }
            }
        }
        return BoardDocument(records)
    }
}
