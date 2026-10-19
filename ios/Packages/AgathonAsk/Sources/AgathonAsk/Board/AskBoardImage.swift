import AgathonBoard
import CoreGraphics
import Foundation
import ImageIO

/// The current screen as a picture for Ask (src/lib/live/ask/boardImage.ts): what the read LaTeX
/// cannot say — a drawing, a photo, a PDF page, a line the reader got wrong.
///
/// What is in it: the screen's records as the kid sees them, cropped to what is on the screen
/// (16 page units of white around it), at most 1024 px on its long side and never blown up more
/// than 2×, on white; stickers left out. Encoded as JPEG, the quality stepped down, then the size,
/// until the data URL fits `ASK_LIMITS.imageChars`. Nil when the screen holds only what the maths
/// already says (the tutor's own problems and lines), or nothing.
public enum AskBoardImage {
    public static let longSide = 1024.0
    public static let maxScale = 2.0
    public static let pad = 16.0
    /// Quality first, then size (`ASK_IMAGE_LADDER`).
    public static let ladder: [(scale: Double, quality: Double)] = [(1, 0.82), (1, 0.66), (1, 0.5), (0.75, 0.5), (0.5, 0.5)]

    /// - `hidden`: not in the picture (a sticker);
    /// - `said`: the request's LaTeX already says it (the tutor's problems and lines, a readback, a mark);
    /// - `unsaid`: only a picture says it (the kid's ink and shapes, a photo, the tutor's drawings).
    public enum Role: Equatable, Sendable { case hidden, said, unsaid }

    /// `askShapeRole`, on the iPad's records.
    public static func role(of record: BoardRecord) -> Role {
        let meta = record.meta
        if meta["isProtected"]?.boolValue == true && meta["kind"]?.stringValue == "sticker" { return .hidden }
        if meta["live"]?.boolValue != true { return .unsaid }
        if meta["source"]?.stringValue == "echo" || meta["mark"] != nil { return .said }
        let block = meta["chatBlock"]?.stringValue
        if case .graph = record { return .unsaid }
        if meta["graphFor"] != nil || block == "graph" || block == "figure" || block == "model" || meta["lectureBlock"] != nil
            || meta["proofFigure"] != nil || meta["proofTable"] != nil || meta["handPart"] != nil {
            return .unsaid
        }
        if meta["chatProblem"] != nil || meta["handLine"]?.stringValue != nil { return .said }
        if case .math = record { return .said }
        return .unsaid
    }

    /// Whether an ask sends a picture: only when the screen holds something the LaTeX cannot say.
    public static func wanted(_ records: [BoardRecord]) -> Bool {
        records.contains { role(of: $0) == .unsaid }
    }

    /// The picture's size for `bounds`: its long side at most 1024 px, blown up at most 2×.
    public static func size(for bounds: Box) -> (scale: Double, w: Int, h: Int) {
        let scale = min(maxScale, longSide / max(bounds.w, bounds.h, 1))
        return (scale, max(1, Int((bounds.w * scale).rounded())), max(1, Int((bounds.h * scale).rounded())))
    }

    /// The length of `bytes` of `type` as a base64 data URL.
    public static func dataURLChars(_ type: String, bytes: Int) -> Int {
        "data:\(type);base64,".count + 4 * ((bytes + 2) / 3)
    }

    /// The screen's picture as a JPEG data URL, or nil (nothing to show, or nothing fits).
    @MainActor
    public static func capture(store: BoardStore, screen: RecordID, maxChars: Int = AskLimits.imageChars) async -> String? {
        let records = store.drawables(on: screen)
        guard wanted(records), let rect = store[screen]?.screen?.rect else { return nil }
        var items: [RenderItem] = []
        var box: Box?
        for r in records where role(of: r) != .hidden {
            guard let item = RenderGeometry.item(for: r), let on = intersect(item.bounds, rect) else { continue }
            items.append(item)
            box = box.map { $0.union(on) } ?? on
        }
        guard let box, let bounds = intersect(Box(x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2), rect),
              bounds.w > 0, bounds.h > 0 else { return nil }
        let drawn = items
        return await Task.detached(priority: .userInitiated) { encode(drawn, bounds: bounds, maxChars: maxChars) }.value
    }

    /// Down the ladder until the data URL fits.
    static func encode(_ items: [RenderItem], bounds: Box, maxChars: Int) -> String? {
        var images: [Double: CGImage] = [:]
        for step in ladder {
            if images[step.scale] == nil { images[step.scale] = render(items, bounds: bounds, factor: step.scale) }
            guard let image = images[step.scale], let jpeg = jpeg(image, quality: step.quality) else { return nil }
            if dataURLChars("image/jpeg", bytes: jpeg.count) <= maxChars { return "data:image/jpeg;base64,\(jpeg.base64EncodedString())" }
        }
        return nil
    }

    /// `bounds` (page units) at its picture size times `factor`, on white.
    public static func render(_ items: [RenderItem], bounds: Box, factor: Double = 1) -> CGImage? {
        let s = size(for: bounds)
        let w = max(1, Int((Double(s.w) * factor).rounded()))
        let h = max(1, Int((Double(s.h) * factor).rounded()))
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                                  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
        ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
        TileRasterizer.preparePageSpace(ctx, rect: bounds, scale: s.scale * factor, pixelHeight: h)
        for item in items where item.bounds.intersects(bounds) { item.draw(in: ctx) }
        return ctx.makeImage()
    }

    static func jpeg(_ image: CGImage, quality: Double) -> Data? {
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, "public.jpeg" as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { return nil }
        return out as Data
    }

    static func intersect(_ a: Box, _ b: Box) -> Box? {
        let x = max(a.x, b.x), y = max(a.y, b.y)
        let r = min(a.x + a.w, b.x + b.w), bottom = min(a.y + a.h, b.y + b.h)
        // a dot or a straight stroke has no width or no height: touching counts
        return r >= x && bottom >= y ? Box(x: x, y: y, w: r - x, h: bottom - y) : nil
    }
}
