import AgathonBoard
import AgathonDesign
import Foundation
import SwiftUI
import Testing
@testable import AgathonLive

/// The new pieces as pictures, for a person to look at (not compared): the "Graph it" chip and the
/// grown-ups' settings with "Show the answer when I write =". Off by default; with
/// TEST_RUNNER_LIVE_SNAPSHOTS=<dir> the PNGs are written there.
@MainActor
@Suite(.enabled(if: ProcessInfo.processInfo.environment["LIVE_SNAPSHOTS"] != nil))
struct SnapshotLook {
    @Test func theNewPieces() throws {
        let dir = URL(fileURLWithPath: ProcessInfo.processInfo.environment["LIVE_SNAPSHOTS"] ?? NSTemporaryDirectory())
        let h = Harness()
        func save<V: View>(_ view: V, _ name: String) throws {
            let r = ImageRenderer(content: view.environment(\.colorScheme, .light))
            r.scale = 2
            let data = try #require(r.uiImage?.pngData())
            try data.write(to: dir.appendingPathComponent(name))
        }
        try save(HStack(spacing: 24) {
            Text("y = 2x + 1").font(.system(size: 34, design: .serif))
            GraphChip(label: "Graph y = 2x + 1") {}
        }.padding(32).background(DS.Color.paper), "graph-chip.png")
        try save(GrownUpLiveSettings(loop: h.loop) {}, "grown-ups.png")
    }
}
