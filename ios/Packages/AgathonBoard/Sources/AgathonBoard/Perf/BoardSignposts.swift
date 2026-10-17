import Foundation
import os

/// os_signpost instrumentation (Instruments → Points of Interest, or `log stream` on the subsystem):
///
///  - interval `LiveStroke`  pen down → the stroke committed and baked (the kid's stroke)
///  - interval `Commit`      pen up → committed and baked (touch-to-commit)
///  - interval `LivePath`    one touch event's live outline rebuilt (per event while drawing)
///  - interval `TileRender`  a batch of tiles rasterized
///  - interval `BoardLoad`   JSON → store → scene → first tiles on screen
///  - event    `Frame`       a display frame while drawing (its duration in the message)
public enum BoardSignposts {
    public static let subsystem = "app.agathon.board"
    public static let signposter = OSSignposter(subsystem: subsystem, category: .pointsOfInterest)
    public static let log = Logger(subsystem: subsystem, category: "perf")
}

/// Running numbers for the stats overlay and the spike report (all in ms).
public struct BoardStats: Sendable {
    public var strokeCount = 0
    public var recordCount = 0
    public var docBytes = 0
    /// pen-up (the touch's hardware time) → stroke in the store and baked into the tiles
    public var lastTouchToCommitMs: Double = 0
    /// the commit's own work (store + outline + tiles), without event delivery
    public var lastCommitWorkMs: Double = 0
    /// the last change's scene work (outlines + grid) and tile painting, ms
    public var lastSceneMs: Double = 0
    public var lastTilesMs: Double = 0
    /// inside the tile paint: drawing the ink, and making the tiles' images
    public var lastPaintMs: (draw: Double, image: Double) = (0, 0)
    /// the layer transaction's commit at pen-up (layer changes handed to the render server)
    public var lastFlushMs: Double = 0
    /// the slowest live-outline rebuild of the last stroke
    public var lastLivePathMaxMs: Double = 0
    /// mean and worst display-frame interval while the last stroke was drawn
    public var drawingFrameMeanMs: Double = 0
    public var drawingFrameMaxMs: Double = 0
    public var drawingFramesDropped = 0
    public var displayHz: Double = 0
    /// open → first tiles on screen
    public var lastLoadMs: Double = 0
    public var lastLoadBreakdown = ""
    public var lastEraseMs: Double = 0
    public var commits: [Double] = []

    public init() {}

    public var commitP50: Double { Self.percentile(commits, 0.5) }
    public var commitP95: Double { Self.percentile(commits, 0.95) }

    public static func percentile(_ xs: [Double], _ p: Double) -> Double {
        guard !xs.isEmpty else { return 0 }
        let s = xs.sorted()
        return s[min(s.count - 1, Int((Double(s.count - 1) * p).rounded()))]
    }
}
