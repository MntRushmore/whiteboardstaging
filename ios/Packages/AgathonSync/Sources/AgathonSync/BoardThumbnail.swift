import AgathonBoard
import CoreGraphics
import Foundation
import ImageIO

/// The boards list's thumbnail: the board's current screen, 16:9, as a data URL that fits
/// `whiteboards.preview` (a check constraint caps it at 20,000 characters), the web's rule
/// (src/lib/boards/thumbnail.ts). The web steps down WebP then JPEG; WebP cannot be encoded on iOS,
/// so this steps down JPEG: 640, 480, 320 px wide, quality 0.7 then 0.5 at each, the first that fits.
public enum BoardThumbnail {
    public static let maxChars = 20_000
    public static let widths: [Double] = [640, 480, 320]
    public static let qualities: [Double] = [0.7, 0.5]
    /// Every width and quality in the order tried.
    public static let rungs: [(width: Double, quality: Double)] = widths.flatMap { w in qualities.map { (w, $0) } }

    /// What the save writes for the thumbnail: clear it when no screen has anything on it, keep the
    /// stored one when the current screen is empty or nothing fits, else the new one.
    @MainActor
    public static func preview(store: BoardStore, screen: RecordID, memory: RungMemory? = nil, now: Date = Date()) async -> BoardWrite.Preview {
        if store.screenIDs.allSatisfy({ store.drawableCount(on: $0) == 0 }) { return .clear }
        guard let scene = scene(store: store, screen: screen) else { return .keep }
        let start = memory?.start(now) ?? 0
        // a problem page's guide lines and answer spot, faint, under the ink (docs/PROBLEM-PAGES.md)
        let template = store[screen]?.screen.flatMap { s in s.problemPage.flatMap { PageTemplate(page: $0, screen: s.rect) } }
        let fit = await Task.detached(priority: .utility) {
            fitted(scene.items, rect: scene.rect, maxChars: maxChars, startAt: start, template: template)
        }.value
        memory?.fitted(fit?.rung)
        return fit.map { .set($0.url) } ?? .keep
    }

    /// The current screen's drawn records (the typeset maths left out when there is ink beside it: at
    /// card size it is noise, as on the web), or nil when the screen is empty.
    @MainActor
    public static func scene(store: BoardStore, screen: RecordID) -> (items: [RenderItem], rect: Box)? {
        guard let rect = store[screen]?.screen?.rect else { return nil }
        let records = store.drawables(on: screen)
        guard !records.isEmpty else { return nil }
        let inked = records.filter { if case .math = $0 { return false }; return true }
        let items = (inked.isEmpty ? records : inked).compactMap { RenderGeometry.item(for: $0) }
        return items.isEmpty ? nil : (items, rect)
    }

    /// The first rung, from `startAt` down, whose data URL fits `maxChars`.
    public static func fitted(_ items: [RenderItem], rect: Box, maxChars: Int, startAt: Int = 0, template: PageTemplate? = nil) -> (url: String, rung: Int)? {
        var images: [Double: CGImage] = [:]
        for rung in max(0, startAt)..<rungs.count {
            let (width, quality) = rungs[rung]
            if images[width] == nil { images[width] = render(items, rect: rect, width: width, template: template) }
            guard let image = images[width], let jpeg = jpeg(image, quality: quality) else { continue }
            let length = "data:image/jpeg;base64,".count + 4 * ((jpeg.count + 2) / 3)
            if length <= maxChars { return ("data:image/jpeg;base64,\(jpeg.base64EncodedString())", rung) }
        }
        return nil
    }

    /// The screen at `width` px wide (16:9), on white (a problem page's template under the ink).
    public static func render(_ items: [RenderItem], rect: Box, width: Double, template: PageTemplate? = nil) -> CGImage? {
        let w = Int(width.rounded())
        let h = Int((width * 9 / 16).rounded())
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
        ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
        // the screen's rect fills the picture (a grown legacy screen is 16:9 too)
        let scale = Double(w) / max(1, rect.w)
        TileRasterizer.preparePageSpace(ctx, rect: rect, scale: scale, pixelHeight: h)
        template?.draw(in: ctx, colors: .blocks)
        for item in items where item.bounds.intersects(rect) { item.draw(in: ctx) }
        return ctx.makeImage()
    }

    public static func jpeg(_ image: CGImage, quality: Double) -> Data? {
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, "public.jpeg" as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { return nil }
        return out as Data
    }
}

/// Where the next thumbnail starts on the ladder: at the rung that fitted last time (a dense board is
/// not encoded six times on every save); every minute from the top again (ink may have been erased).
@MainActor
public final class RungMemory {
    public static let refit: TimeInterval = 60
    private var rung = 0
    private var walkedAt: Date?

    public init() {}

    public func start(_ now: Date) -> Int {
        if let walkedAt, now.timeIntervalSince(walkedAt) < Self.refit { return rung }
        walkedAt = now
        return 0
    }

    public func fitted(_ fit: Int?) {
        if let fit {
            rung = fit
        } else {
            rung = 0
            walkedAt = nil
        }
    }
}
