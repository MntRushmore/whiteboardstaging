import Foundation
import Testing
@testable import AgathonBoard

/// The Swift encoder's output for the web's TypeScript reader (src/lib/boards/agathonDoc.ts): each
/// tldraw fixture converted here and written as Agathon JSON to src/lib/boards/__fixtures__/agathon/,
/// plus compact-point vectors. The vitest suite decodes them and turns them back into tldraw
/// (Swift → JSON → TS). This test fails when the encoder's output drifts from the committed files;
/// regenerate them with
///
///     WRITE_AGATHON_FIXTURES=1 swift test --filter AgathonFixtureExport   (in ios/Packages/AgathonBoard)
struct AgathonFixtureExportTests {
    static let repoRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    static let outDir = repoRoot.appendingPathComponent("src/lib/boards/__fixtures__/agathon", isDirectory: true)
    static let fixtures = ["kid-algebra", "legacy-noscreen", "legacy-small", "all-shapes", "synthetic-2000"]

    static var writing: Bool { ProcessInfo.processInfo.environment["WRITE_AGATHON_FIXTURES"] == "1" }

    /// Compact-point vectors: points in, the string the encoder writes, the points a reader gets back.
    static func pointVectors() -> Data {
        let pinned: [InkPoint] = [
            InkPoint(x: 0, y: 0, pressure: 0.5, t: 0), InkPoint(x: 1.5, y: -2, pressure: 1, t: 4.2),
            InkPoint(x: 3.0625, y: -2, pressure: 0.25, t: 9),
        ]
        var finger: [InkPoint] = []
        for i in 0..<40 { finger.append(InkPoint(x: Float(i) * 3.3, y: Float(sin(Double(i) / 4) * 20), pressure: 0.5)) }
        var pencil: [InkPoint] = []
        for i in 0..<60 {
            let x = Float(i) * 1.7 - 40
            let y = -Float(i) * 0.9
            pencil.append(InkPoint(x: x, y: y, pressure: 0.3 + Float(i % 7) * 0.08, t: Float(i * 8)))
        }
        var tilt: [InkPoint] = []
        for i in 0..<12 {
            tilt.append(InkPoint(x: Float(i), y: Float(i * i) / 10, pressure: 0.6, altitude: 0.9, azimuth: Float(i) * 0.4, t: Float(i * 4)))
        }
        let dot: [InkPoint] = [InkPoint(x: 0, y: 0, pressure: 0.5, t: 120)]
        let far: [InkPoint] = [InkPoint(x: -5000.03, y: 9000.97), InkPoint(x: 12000.5, y: -3000.25)]
        let cases: [(String, [InkPoint])] = [("pinned", pinned), ("finger", finger), ("pencil-timed", pencil), ("tilt", tilt), ("dot", dot), ("far", far)]
        var out: [JSONValue] = []
        for (name, pts) in cases {
            let encoded = PointCodec.encode(pts)
            let back = (try? PointCodec.decode(encoded)) ?? []
            out.append([
                "name": .string(name), "encoded": .string(encoded),
                "points": .array(back.map { p in
                    var o: [String: JSONValue] = ["x": .number(Double(p.x)), "y": .number(Double(p.y)), "pressure": .number(Double(p.pressure)), "t": .number(Double(p.t))]
                    if p.hasTilt { o["altitude"] = .number(Double(p.altitude)); o["azimuth"] = .number(Double(p.azimuth)) }
                    return .object(o)
                }),
            ])
        }
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys, .prettyPrinted, .withoutEscapingSlashes]
        return (try? enc.encode(JSONValue.array(out))) ?? Data()
    }

    @Test func committedFixturesMatchTheEncoder() throws {
        var files: [(String, Data)] = []
        for name in Self.fixtures {
            let doc = try TldrawImporter.importSnapshot(Fixtures.data("\(name).tldraw.json")).document
            files.append(("\(name).agathon.json", try doc.encoded(sortedKeys: true) + Data("\n".utf8)))
        }
        files.append(("points.vectors.json", Self.pointVectors() + Data("\n".utf8)))
        if Self.writing {
            try FileManager.default.createDirectory(at: Self.outDir, withIntermediateDirectories: true)
            for (name, data) in files { try data.write(to: Self.outDir.appendingPathComponent(name)) }
            print("WROTE \(files.count) Agathon fixtures to \(Self.outDir.path)")
            return
        }
        guard FileManager.default.fileExists(atPath: Self.outDir.path) else { return } // not in a checkout
        for (name, data) in files {
            let committed = try Data(contentsOf: Self.outDir.appendingPathComponent(name))
            #expect(committed == data, "\(name) drifted from the encoder: rerun with WRITE_AGATHON_FIXTURES=1")
        }
    }
}
