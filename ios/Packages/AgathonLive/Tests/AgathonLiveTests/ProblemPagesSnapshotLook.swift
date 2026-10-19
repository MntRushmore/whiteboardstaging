import AgathonBoard
import AgathonBrain
import AgathonDesign
import Foundation
import SwiftUI
import Testing
@testable import AgathonLive

/// Problem pages' pieces as pictures, for a person to look at (not compared): the "I read" chips in
/// each state, Fix what I read, Check / Next / New page for this one, All done, the grown-ups' new
/// settings. Off by default; with TEST_RUNNER_LIVE_SNAPSHOTS=<dir> the PNGs are written there.
@MainActor
@Suite(.enabled(if: ProcessInfo.processInfo.environment["LIVE_SNAPSHOTS"] != nil))
struct ProblemPagesSnapshotLook {
    @Test func theProblemPagesPieces() throws {
        let dir = URL(fileURLWithPath: ProcessInfo.processInfo.environment["LIVE_SNAPSHOTS"] ?? NSTemporaryDirectory())
        func save<V: View>(_ view: V, _ name: String) throws {
            let r = ImageRenderer(content: view.environment(\.colorScheme, .light))
            r.scale = 2
            let data = try #require(r.uiImage?.pngData())
            try data.write(to: dir.appendingPathComponent(name))
        }
        let box = BrainRect(x: 0, y: 0, w: 100, h: 40)
        let at = AgathonBrain.Point(x: 0, y: 0)
        try save(VStack(alignment: .leading, spacing: 16) {
            ReadbackChip(reading: LineReading(id: "a", latex: "2x + 3 = 11", state: .read, anchor: box, at: at)) {}
            ReadbackChip(reading: LineReading(id: "b", latex: "4 \\times = 12", state: .asking, anchor: box, at: at)) {}
            ReadbackChip(reading: LineReading(id: "c", latex: "", state: .unread, anchor: box, at: at)) {}
            ReadbackChip(reading: LineReading(id: "d", latex: "4x = 12", state: .fixed, anchor: box, at: at)) {}
        }.padding(32).background(DS.Color.paper), "pages-readings.png")
        try save(FixReadingSheet(fix: ReadingFix(id: "b", latex: "4 \\times = 12", alternatives: ["4x = 12", "4 + 12"]),
                                 onUse: { _ in }, onConfirm: {}, onCancel: {}), "pages-fix.png")
        try save(VStack(alignment: .leading, spacing: 20) {
            CheckButton {}
            NextButton(last: false) {}
            NextButton(last: true) {}
            NewPageOfferBar(take: {}, keep: {})
        }.padding(32).background(DS.Color.paper), "pages-actions.png")
        try save(AllDoneCard(problems: [SetProblem(id: "1", number: 1, outcome: .alone), SetProblem(id: "2", number: 2, outcome: .alone),
                                        SetProblem(id: "3", number: 3, outcome: .withHelp), SetProblem(id: "4", number: 4, outcome: .alone),
                                        SetProblem(id: "5", number: 5, outcome: .notYet)],
                             onProblem: { _ in }, onBack: {}, onMore: {})
            .padding(40).frame(width: 900).background(DS.Color.paper), "pages-all-done.png")
        let h = Harness(checking: .whenDone)
        try save(GrownUpLiveSettings(loop: h.loop) {}.frame(height: 1000), "pages-grown-ups.png")
    }
}
