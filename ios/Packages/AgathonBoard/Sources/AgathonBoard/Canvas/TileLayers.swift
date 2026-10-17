#if canImport(UIKit)
import IOSurface
import QuartzCore
import UIKit

/// One tile's pixels, and how they reach the screen.
///  - `.image`: a bitmap context; each change hands Core Animation a new CGImage, which it copies
///    to the render server at the next transaction (≈1 MB a 512 px tile).
///  - `.surface`: the context draws straight into an IOSurface, which the layer shows without a
///    copy; a change is published by swapping between two surfaces (the next is brought up to
///    date with a local memcpy, then drawn on), so the render server never sees a half-drawn tile.
final class TileBitmap: @unchecked Sendable {
    enum Kind: String, Sendable { case image, surface }

    let kind: Kind
    let rect: Box
    let scale: CGFloat
    private var surfaces: [IOSurface] = []
    private var contexts: [CGContext] = []
    private var front = 0
    private let single: CGContext?

    private init?(kind: Kind, rect: Box, scale: CGFloat) {
        self.kind = kind
        self.rect = rect
        self.scale = scale
        if kind == .image {
            guard let ctx = TileRasterizer.makeContext(rect: rect, scale: scale) else { return nil }
            single = ctx
            return
        }
        single = nil
        let w = max(1, Int((rect.w * scale).rounded(.up)))
        let h = max(1, Int((rect.h * scale).rounded(.up)))
        for _ in 0..<2 {
            let props: [IOSurfacePropertyKey: Any] = [
                .width: w, .height: h, .bytesPerElement: 4,
                .bytesPerRow: IOSurfaceAlignProperty(kIOSurfaceBytesPerRow, w * 4),
                .pixelFormat: 0x4247_5241, // 'BGRA'
            ]
            guard let surface = IOSurface(properties: props) else { return nil }
            surface.lock(options: [], seed: nil)
            let ctx = CGContext(
                data: surface.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: surface.bytesPerRow,
                space: RenderGeometry.colorSpace,
                bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
            surface.unlock(options: [], seed: nil)
            guard let ctx else { return nil }
            TileRasterizer.preparePageSpace(ctx, rect: rect, scale: scale, pixelHeight: h)
            surfaces.append(surface)
            contexts.append(ctx)
        }
    }

    static func make(_ kind: Kind, rect: Box, scale: CGFloat) -> TileBitmap? {
        TileBitmap(kind: kind, rect: rect, scale: scale) ?? (kind == .surface ? TileBitmap(kind: .image, rect: rect, scale: scale) : nil)
    }

    /// Draws on the tile (in page space). For a surface tile, on the back buffer, brought up to date
    /// first; `publish` then shows it.
    func draw(_ body: (CGContext) -> Void) {
        if let single {
            body(single)
            return
        }
        let back = 1 - front
        let a = surfaces[front], b = surfaces[back]
        a.lock(options: .readOnly, seed: nil)
        b.lock(options: [], seed: nil)
        memcpy(b.baseAddress, a.baseAddress, a.allocationSize)
        a.unlock(options: .readOnly, seed: nil)
        body(contexts[back])
        b.unlock(options: [], seed: nil)
        front = back
    }

    /// Shows the tile's current pixels on `layer`.
    func publish(to layer: CALayer) {
        if let single {
            layer.contents = single.makeImage()
        } else {
            layer.contents = surfaces[front]
        }
    }
}

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
    // main-thread objects; a background render only carries them back to the main thread
    final class Tile: @unchecked Sendable {
        let key: Int64
        let rect: Box
        let layer = CALayer()
        var bitmap: TileBitmap?
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

    final class Level: @unchecked Sendable {
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
    /// The current screen's index, read when needed and never kept: a kept copy would make the
    /// controller's next change copy the whole index (copy-on-write).
    var index: () -> SceneIndex = { SceneIndex() }
    /// the last paint's draw and image times (ms), for the stats
    private(set) var lastPaintDrawMs = 0.0
    private(set) var lastPaintImageMs = 0.0
    /// how tiles reach the screen (the Lab compares the two)
    /// (measured on the simulator: CGImage tiles 0.7 ms touch-to-commit, IOSurface 1.6 ms; try both on a device)
    nonisolated(unsafe) static var kind: TileBitmap.Kind = .image
    private let queue = DispatchQueue(label: "app.agathon.board.tiles", qos: .userInitiated, attributes: .concurrent)
    static let tilePixels: CGFloat = 512

    /// tiles rasterized so far, and their total time (for the stats)
    private(set) var renderedTiles = 0
    private(set) var renderMs: Double = 0
    /// the last batch's time from asking to on screen
    private(set) var lastRenderMs: Double = 0

    init() {
        root.actions = ["sublayers": NSNull()]
    }

    @inline(__always) static func key(_ ix: Int, _ iy: Int) -> Int64 { (Int64(ix) << 32) | Int64(UInt32(bitPattern: Int32(iy))) }

    // MARK: - Base

    /// A new screen (or scene): rasterize the whole screen at `px` pixels per page unit, off the main
    /// thread, and call `done` once every base tile is on screen.
    func reset(screen: Box, px: CGFloat, done: @escaping () -> Void) {
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
        reset(screen: screenRect, px: px, done: {})
    }

    // MARK: - Rendering

    private struct Job: @unchecked Sendable {
        let tile: Tile
        let rect: Box
        let px: CGFloat
        var bitmap: TileBitmap?
    }

    /// Rasterizes `tiles` of `level` in parallel off the main thread (finding each tile's items there
    /// too, from a snapshot of the index), then installs them on the main thread.
    private func render(_ tiles: [Tile], level: Level, done: (() -> Void)? = nil) {
        let generation = level.generation
        let index = self.index()
        let kind = Self.kind
        let jobs = tiles.map { t -> Job in
            t.pending = true
            t.stale = false
            return Job(tile: t, rect: t.rect, px: level.px)
        }
        let started = CACurrentMediaTime()
        let signpost = BoardSignposts.signposter.beginInterval("TileRender", "\(jobs.count) tiles")
        queue.async { [jobs] in
            var out = jobs
            out.withUnsafeMutableBufferPointer { buf in
                let base = buf.baseAddress!
                DispatchQueue.concurrentPerform(iterations: buf.count) { i in
                    let job = (base + i).pointee
                    let items = index.items(in: job.rect)
                    let bitmap = TileBitmap.make(kind, rect: job.rect, scale: job.px)
                    bitmap?.draw { ctx in for item in items { item.draw(in: ctx) } }
                    (base + i).pointee.bitmap = bitmap
                }
            }
            DispatchQueue.main.async { [out] in
                MainActor.assumeIsolated {
                    BoardSignposts.signposter.endInterval("TileRender", signpost)
                    self.renderedTiles += out.count
                    self.renderMs += (CACurrentMediaTime() - started) * 1000
                    self.lastRenderMs = (CACurrentMediaTime() - started) * 1000
                    guard generation == level.generation else { return }
                    CATransaction.begin()
                    CATransaction.setDisableActions(true)
                    for job in out {
                        let t = job.tile
                        t.pending = false
                        t.bitmap = job.bitmap
                        job.bitmap?.publish(to: t.layer)
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
        guard let bitmap = t.bitmap else {
            t.stale = true
            return
        }
        let clip = rect.expanded(by: 1)
        let items = index().items(in: clip)
        bitmap.draw { ctx in
            ctx.saveGState()
            ctx.clip(to: clip.cgRect)
            ctx.clear(clip.cgRect)
            for item in items { item.draw(in: ctx) }
            ctx.restoreGState()
        }
        bitmap.publish(to: t.layer)
        t.stale = false
    }

    // MARK: - Edits

    /// New items on top of everything: paint them over the tiles they touch.
    func paintOnTop(_ items: [RenderItem]) {
        var drawMs = 0.0
        var imageMs = 0.0
        for level in [base, detail].compactMap({ $0 }) {
            var byTile: [Int64: (Tile, [RenderItem])] = [:]
            for item in items {
                for t in tiles(of: level, in: item.bounds) {
                    guard t.bitmap != nil else {
                        t.stale = true
                        continue
                    }
                    byTile[t.key, default: (t, [])].1.append(item)
                }
            }
            for (t, list) in byTile.values {
                let t0 = CACurrentMediaTime()
                t.bitmap?.draw { ctx in for item in list { item.draw(in: ctx) } }
                let t1 = CACurrentMediaTime()
                t.bitmap?.publish(to: t.layer)
                drawMs += (t1 - t0) * 1000
                imageMs += (CACurrentMediaTime() - t1) * 1000
            }
        }
        lastPaintDrawMs = drawMs
        lastPaintImageMs = imageMs
    }

    /// Items removed, changed or put under others: redraw those areas.
    func invalidate(_ rects: [Box]) {
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
    func updateDetail(visible: Box, effectivePx: CGFloat, done: (() -> Void)? = nil) {
        guard let base else { return }
        let ratio = effectivePx / base.px
        if ratio <= 1.2 {
            if let detail {
                detail.generation += 1
                detail.root.removeFromSuperlayer()
                self.detail = nil
            }
            done?()
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
        guard let level = detail else {
            done?()
            return
        }
        let want = visible.expanded(by: level.tileSize * 0.5)
        let x0 = max(0, Int(((want.minX - screenRect.x) / level.tileSize).rounded(.down)))
        let y0 = max(0, Int(((want.minY - screenRect.y) / level.tileSize).rounded(.down)))
        let x1 = min(Int((screenRect.w / level.tileSize).rounded(.up)) - 1, Int(((want.maxX - screenRect.x) / level.tileSize).rounded(.down)))
        let y1 = min(Int((screenRect.h / level.tileSize).rounded(.up)) - 1, Int(((want.maxY - screenRect.y) / level.tileSize).rounded(.down)))
        guard x1 >= x0, y1 >= y0 else {
            done?()
            return
        }
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
        if !fresh.isEmpty { render(fresh, level: level, done: done) } else { done?() }
    }

    var detailTileCount: Int { detail?.tiles.count ?? 0 }
    var baseTileCount: Int { base?.tiles.count ?? 0 }
}
#endif
