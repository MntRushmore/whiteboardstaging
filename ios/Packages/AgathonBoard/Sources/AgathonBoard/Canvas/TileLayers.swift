#if canImport(UIKit)
import QuartzCore
import UIKit

/// The settled ink of a screen, cached as bitmap tiles under one layer in page space.
///
/// - **Base level**: the whole screen at its fit resolution (device pixels per page unit when the
///   screen fills the view), about 512 px tiles. Rasterized in parallel off the main thread when a
///   screen opens; afterwards a new stroke is painted onto the tiles it touches (no redraw of the
///   rest), and an erase redraws only the erased stroke's area, clipped.
/// - **Detail level**: when zoomed in past the base resolution, the visible part again at a
///   power-of-two finer resolution, rendered off the main thread after the gesture, kept in step
///   with edits the same way. The base level shows through until a detail tile is ready.
///
/// Pan and zoom never redraw ink: the camera is one transform on the parent layer.
@MainActor
final class TileLayers {
    final class Tile {
        let key: Int64
        let rect: Box
        let layer = CALayer()
        var context: CGContext?
        /// changed while its render was in flight: render it again
        var stale = false
        var pending = false

        init(key: Int64, rect: Box) {
            self.key = key
            self.rect = rect
            layer.frame = rect.cgRect
            layer.contentsGravity = .resize
            layer.minificationFilter = .linear
            layer.magnificationFilter = .linear
            layer.isOpaque = false
            layer.actions = ["contents": NSNull(), "position": NSNull(), "bounds": NSNull(), "hidden": NSNull()]
        }
    }

    final class Level {
        let px: CGFloat
        let tileSize: Double
        let root = CALayer()
        var tiles: [Int64: Tile] = [:]
        var generation = 0

        init(px: CGFloat, tileSize: Double) {
            self.px = px
            self.tileSize = tileSize
            root.actions = ["sublayers": NSNull()]
        }
    }

    let root = CALayer()
    private(set) var screenRect = Box.screen
    private(set) var base: Level?
    private(set) var detail: Level?
    private var index = SceneIndex()
    private let queue = DispatchQueue(label: "app.agathon.board.tiles", qos: .userInitiated, attributes: .concurrent)
    static let tilePixels: CGFloat = 512

    /// tiles rasterized so far, and their total time (for the stats)
    private(set) var renderedTiles = 0
    private(set) var renderMs: Double = 0

    init() {
        root.actions = ["sublayers": NSNull()]
    }

    @inline(__always) static func key(_ ix: Int, _ iy: Int) -> Int64 { (Int64(ix) << 32) | Int64(UInt32(bitPattern: Int32(iy))) }

    // MARK: - Base

    /// A new screen (or scene): rasterize the whole screen at `px` pixels per page unit, off the main
    /// thread, and call `done` once every base tile is on screen.
    func reset(index: SceneIndex, screen: Box, px: CGFloat, done: @escaping () -> Void) {
        self.index = index
        screenRect = screen
        base?.root.removeFromSuperlayer()
        detail?.root.removeFromSuperlayer()
        detail = nil
        let level = Level(px: px, tileSize: Double(Self.tilePixels / px))
        base = level
        root.addSublayer(level.root)
        var tiles: [Tile] = []
        let nx = max(1, Int((screen.w / level.tileSize).rounded(.up)))
        let ny = max(1, Int((screen.h / level.tileSize).rounded(.up)))
        for iy in 0..<ny {
            for ix in 0..<nx {
                let r = Box(x: screen.x + Double(ix) * level.tileSize, y: screen.y + Double(iy) * level.tileSize,
                            w: level.tileSize, h: level.tileSize)
                let t = Tile(key: Self.key(ix, iy), rect: r)
                level.tiles[t.key] = t
                level.root.addSublayer(t.layer)
                tiles.append(t)
            }
        }
        render(tiles, level: level, done: done)
    }

    /// The base resolution changed a lot (the view rotated): rasterize the base again.
    func rebase(px: CGFloat) {
        guard let base, abs(base.px - px) / px > 0.1 else { return }
        reset(index: index, screen: screenRect, px: px, done: {})
    }

    // MARK: - Rendering

    private struct Job: @unchecked Sendable {
        let tile: Tile
        let items: [RenderItem]
        let rect: Box
        let px: CGFloat
        var context: CGContext?
        var image: CGImage?
    }

    /// Rasterizes `tiles` of `level` in parallel off the main thread, then installs them.
    private func render(_ tiles: [Tile], level: Level, done: (() -> Void)? = nil) {
        let generation = level.generation
        let jobs = tiles.map { t -> Job in
            t.pending = true
            t.stale = false
            return Job(tile: t, items: index.items(in: t.rect), rect: t.rect, px: level.px)
        }
        let started = CACurrentMediaTime()
        let signpost = BoardSignposts.signposter.beginInterval("TileRender", "\(jobs.count) tiles")
        queue.async { [jobs] in
            var out = jobs
            out.withUnsafeMutableBufferPointer { buf in
                let base = buf.baseAddress!
                DispatchQueue.concurrentPerform(iterations: buf.count) { i in
                    let job = (base + i).pointee
                    let ctx = TileRasterizer.render(job.items, rect: job.rect, scale: job.px)
                    (base + i).pointee.context = ctx
                    (base + i).pointee.image = ctx?.makeImage()
                }
            }
            DispatchQueue.main.async { [out] in
                MainActor.assumeIsolated {
                    BoardSignposts.signposter.endInterval("TileRender", signpost)
                    self.renderedTiles += out.count
                    self.renderMs += (CACurrentMediaTime() - started) * 1000
                    guard generation == level.generation else { return }
                    CATransaction.begin()
                    CATransaction.setDisableActions(true)
                    for job in out {
                        let t = job.tile
                        t.pending = false
                        t.context = job.context
                        t.layer.contents = job.image
                        if t.stale { self.redraw(t, level: level, rect: t.rect) }
                    }
                    CATransaction.commit()
                    done?()
                }
            }
        }
    }

    /// Redraws `rect` of a tile now (main thread), clipped to it.
    private func redraw(_ t: Tile, level: Level, rect: Box) {
        guard let ctx = t.context else {
            t.stale = true
            return
        }
        let clip = rect.expanded(by: 1)
        ctx.saveGState()
        ctx.clip(to: clip.cgRect)
        ctx.clear(clip.cgRect)
        for item in index.items(in: clip) { item.draw(in: ctx) }
        ctx.restoreGState()
        t.layer.contents = ctx.makeImage()
        t.stale = false
    }

    // MARK: - Edits

    /// New items on top of everything: paint them over the tiles they touch.
    func paintOnTop(_ items: [RenderItem], index: SceneIndex) {
        self.index = index
        for level in [base, detail].compactMap({ $0 }) {
            var touched: [Int64: Tile] = [:]
            for item in items {
                for t in tiles(of: level, in: item.bounds) {
                    guard let ctx = t.context else {
                        t.stale = true
                        continue
                    }
                    item.draw(in: ctx)
                    touched[t.key] = t
                }
            }
            for t in touched.values { t.layer.contents = t.context?.makeImage() }
        }
    }

    /// Items removed, changed or put under others: redraw those areas.
    func invalidate(_ rects: [Box], index: SceneIndex) {
        self.index = index
        for level in [base, detail].compactMap({ $0 }) {
            for r in rects {
                for t in tiles(of: level, in: r) {
                    if t.pending {
                        t.stale = true
                    } else {
                        redraw(t, level: level, rect: intersection(t.rect, r))
                    }
                }
            }
        }
    }

    private func intersection(_ a: Box, _ b: Box) -> Box {
        let x0 = max(a.minX, b.minX), y0 = max(a.minY, b.minY)
        let x1 = min(a.maxX, b.maxX), y1 = min(a.maxY, b.maxY)
        return Box(x: x0, y: y0, w: max(0, x1 - x0), h: max(0, y1 - y0))
    }

    private func tiles(of level: Level, in r: Box) -> [Tile] {
        let x0 = Int(((r.minX - screenRect.x) / level.tileSize).rounded(.down))
        let x1 = Int(((r.maxX - screenRect.x) / level.tileSize).rounded(.down))
        let y0 = Int(((r.minY - screenRect.y) / level.tileSize).rounded(.down))
        let y1 = Int(((r.maxY - screenRect.y) / level.tileSize).rounded(.down))
        guard x1 >= x0, y1 >= y0 else { return [] }
        var out: [Tile] = []
        for iy in y0...y1 {
            for ix in x0...x1 {
                if let t = level.tiles[Self.key(ix, iy)] { out.append(t) }
            }
        }
        return out
    }

    // MARK: - Detail

    /// Keeps the detail level in step with the camera: none at (or near) the base resolution;
    /// otherwise the visible tiles at the next power of two, rendered off the main thread.
    func updateDetail(visible: Box, effectivePx: CGFloat) {
        guard let base else { return }
        let ratio = effectivePx / base.px
        if ratio <= 1.2 {
            if let detail {
                detail.generation += 1
                detail.root.removeFromSuperlayer()
                self.detail = nil
            }
            return
        }
        let k = min(3, Int(ceil(log2(Double(ratio)))))
        let px = base.px * CGFloat(1 << k)
        if detail == nil || detail!.px != px {
            detail?.generation += 1
            detail?.root.removeFromSuperlayer()
            let level = Level(px: px, tileSize: Double(Self.tilePixels / px))
            detail = level
            root.addSublayer(level.root)
        }
        guard let level = detail else { return }
        let want = visible.expanded(by: level.tileSize * 0.5)
        let x0 = max(0, Int(((want.minX - screenRect.x) / level.tileSize).rounded(.down)))
        let y0 = max(0, Int(((want.minY - screenRect.y) / level.tileSize).rounded(.down)))
        let x1 = min(Int((screenRect.w / level.tileSize).rounded(.up)) - 1, Int(((want.maxX - screenRect.x) / level.tileSize).rounded(.down)))
        let y1 = min(Int((screenRect.h / level.tileSize).rounded(.up)) - 1, Int(((want.maxY - screenRect.y) / level.tileSize).rounded(.down)))
        guard x1 >= x0, y1 >= y0 else { return }
        var keep = Set<Int64>()
        var fresh: [Tile] = []
        for iy in y0...y1 {
            for ix in x0...x1 {
                let k = Self.key(ix, iy)
                keep.insert(k)
                if level.tiles[k] == nil {
                    let r = Box(x: screenRect.x + Double(ix) * level.tileSize, y: screenRect.y + Double(iy) * level.tileSize,
                                w: level.tileSize, h: level.tileSize)
                    let t = Tile(key: k, rect: r)
                    level.tiles[k] = t
                    level.root.addSublayer(t.layer)
                    fresh.append(t)
                }
            }
        }
        // drop tiles well out of view
        for (k, t) in level.tiles where !keep.contains(k) {
            t.layer.removeFromSuperlayer()
            level.tiles[k] = nil
        }
        if !fresh.isEmpty { render(fresh, level: level) }
    }

    var detailTileCount: Int { detail?.tiles.count ?? 0 }
    var baseTileCount: Int { base?.tiles.count ?? 0 }
}
#endif
