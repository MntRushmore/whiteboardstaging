import CoreGraphics
import Foundation

/// One screen's drawn records, ready to draw: each record's `RenderItem` (outline paths built once)
/// and a spatial grid over their bounds. A value, so it can be built off the main thread for a big
/// board and handed over whole.
public struct SceneIndex: Sendable {
    public private(set) var items: [RecordID: RenderItem] = [:]
    public private(set) var grid = SpatialGrid(cell: 128)

    public init() {}

    public var count: Int { items.count }

    /// Builds the index for `records` (any order), computing outlines in parallel.
    public static func build(_ records: [BoardRecord], images: BoardImageCache = .shared) -> SceneIndex {
        let n = records.count
        var built = [RenderItem?](repeating: nil, count: n)
        if n > 64 {
            let chunks = max(1, min(ProcessInfo.processInfo.activeProcessorCount * 2, n / 32))
            built.withUnsafeMutableBufferPointer { buf in
                let base = buf.baseAddress!
                DispatchQueue.concurrentPerform(iterations: chunks) { c in
                    let lo = n * c / chunks
                    let hi = n * (c + 1) / chunks
                    for i in lo..<hi { (base + i).pointee = RenderGeometry.item(for: records[i], images: images) }
                }
            }
        } else {
            for i in 0..<n { built[i] = RenderGeometry.item(for: records[i], images: images) }
        }
        var index = SceneIndex()
        index.items.reserveCapacity(n)
        for item in built {
            guard let item else { continue }
            index.items[item.id] = item
            index.grid.insert(item.id, item.bounds)
        }
        return index
    }

    public mutating func upsert(_ item: RenderItem) {
        items[item.id] = item
        grid.insert(item.id, item.bounds)
    }

    @discardableResult
    public mutating func remove(_ id: RecordID) -> RenderItem? {
        grid.remove(id)
        return items.removeValue(forKey: id)
    }

    /// Items whose bounds touch `box`, bottom to top (leaving out `hidden`: a selection being moved).
    public func items(in box: Box, hiding hidden: Set<RecordID> = []) -> [RenderItem] {
        var ids = grid.query(box)
        if !hidden.isEmpty { ids.subtract(hidden) }
        return ids.compactMap { items[$0] }.sorted { $0.order != $1.order ? $0.order < $1.order : $0.id < $1.id }
    }

    /// Items whose bounds touch any of `boxes`, bottom to top.
    public func items(in boxes: [Box], hiding hidden: Set<RecordID> = []) -> [RenderItem] {
        var ids = Set<RecordID>()
        for b in boxes { ids.formUnion(grid.query(b)) }
        if !hidden.isEmpty { ids.subtract(hidden) }
        return ids.compactMap { items[$0] }.sorted { $0.order != $1.order ? $0.order < $1.order : $0.id < $1.id }
    }

    public func ids(in box: Box) -> Set<RecordID> { grid.query(box) }
}

/// Rasterizes items into bitmap tiles (CoreGraphics, any thread).
public enum TileRasterizer {
    /// A transparent bitmap of `rect` (page units) at `scale` pixels per unit, with `items` drawn.
    public static func render(_ items: [RenderItem], rect: Box, scale: CGFloat) -> CGContext? {
        guard let ctx = makeContext(rect: rect, scale: scale) else { return nil }
        draw(items, in: ctx)
        return ctx
    }

    /// Draws `items` (bottom to top) in two passes: the highlighters' underlays first, under
    /// everything, then every item in order.
    public static func draw(_ items: [RenderItem], in ctx: CGContext) {
        for item in items where item.underlay != nil { item.drawUnderlay(in: ctx) }
        for item in items { item.draw(in: ctx) }
    }

    public static func makeContext(rect: Box, scale: CGFloat) -> CGContext? {
        let w = max(1, Int((rect.w * scale).rounded(.up)))
        let h = max(1, Int((rect.h * scale).rounded(.up)))
        guard let ctx = CGContext(
            data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
            space: RenderGeometry.colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        ) else { return nil }
        preparePageSpace(ctx, rect: rect, scale: scale, pixelHeight: h)
        return ctx
    }

    /// Sets a bitmap context of `pixelHeight` rows up to draw `rect` of page space (y down) at `scale`.
    public static func preparePageSpace(_ ctx: CGContext, rect: Box, scale: CGFloat, pixelHeight h: Int) {
        // page space, y down: flip the bitmap's y-up space
        ctx.translateBy(x: 0, y: CGFloat(h))
        ctx.scaleBy(x: scale, y: -scale)
        ctx.translateBy(x: -rect.x, y: -rect.y)
        ctx.setShouldAntialias(true)
        ctx.setAllowsAntialiasing(true)
        ctx.interpolationQuality = .high
    }

    /// Clears `rect` (page units) of a tile context made by `makeContext`.
    public static func clear(_ ctx: CGContext, _ rect: Box) {
        ctx.clear(rect.cgRect)
    }
}
