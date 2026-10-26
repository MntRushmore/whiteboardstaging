import AgathonBoard
import CoreGraphics
import CryptoKit
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// The board as the picture tutor sends it: the region R of the page the kid can see (page units),
/// rendered on white, everything on it (the tutor's accepted pictures too; a ghost on show is not a record), no
/// UI; its longest side `maxLongSide` px. Everything after uses R, so the picture that comes back
/// lands exactly where it was taken from.
struct PictureCapture: Sendable {
    var region: Box
    var screen: RecordID
    var png: Data
    var image: CGImage
    var hash: String
    /// The largest clear rectangle of the picture (its pixels): where the tutor's pen thinks.
    var blank: CGRect?
    /// Where the ink is (its pixels): where the pen looks while it reads.
    var ink: CGRect?
    /// The kid's lines of writing in R (page units), top to bottom: what the pen reads along while the
    /// tutor thinks.
    var lines: [Box] = []

    var pixelSize: CGSize { CGSize(width: image.width, height: image.height) }

    /// A rect of the picture's pixels on the page.
    func pageRect(_ px: CGRect) -> Box { PictureTutorGeometry.pageRect(px, imageSize: pixelSize, region: region) }
}

/// The maths between the page, the captured picture and the screen.
enum PictureTutorGeometry {
    /// R: what the view shows of the page, inside the page, grown by `margin` × its size on each side.
    /// `insets` (the board's chrome: its top bar and dock, as the camera keeps clear of them) are not
    /// visible. Nil when nothing of the page is visible.
    static func region(camera: Camera, viewSize: CGSize, screen: Box, insets: CameraConstraints? = nil,
                       margin: Double = PictureTutorSettings.captureMarginFraction) -> Box? {
        guard viewSize.width > 0, viewSize.height > 0, camera.scale > 0 else { return nil }
        let i = insets ?? CameraConstraints(top: 0, left: 0, bottom: 0, right: 0)
        let a = camera.toPage(CGPoint(x: i.left, y: i.top))
        let b = camera.toPage(CGPoint(x: max(i.left, Double(viewSize.width) - i.right), y: max(i.top, Double(viewSize.height) - i.bottom)))
        let visible = Box(x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y)
        let x0 = max(visible.minX, screen.minX), y0 = max(visible.minY, screen.minY)
        let x1 = min(visible.maxX, screen.maxX), y1 = min(visible.maxY, screen.maxY)
        guard x1 > x0, y1 > y0 else { return nil }
        let r = Box(x: x0, y: y0, w: x1 - x0, h: y1 - y0)
        guard margin > 0 else { return r }
        return Box(x: r.x - r.w * margin, y: r.y - r.h * margin, w: r.w * (1 + 2 * margin), h: r.h * (1 + 2 * margin))
    }

    /// The picture's size for R: the longest side `maxLongSide` px, the other in proportion.
    static func pixelSize(for region: Box, maxLongSide: Double = PictureTutorSettings.maxLongSide) -> (width: Int, height: Int) {
        let k = maxLongSide / max(region.w, region.h, 1)
        return (max(1, Int((region.w * k).rounded())), max(1, Int((region.h * k).rounded())))
    }

    /// A point of the picture (pixels, y down) on the page.
    static func pagePoint(_ px: CGPoint, imageSize: CGSize, region: Box) -> Vec2 {
        Vec2(region.x + Double(px.x) * region.w / Double(imageSize.width), region.y + Double(px.y) * region.h / Double(imageSize.height))
    }

    /// A rect of the picture (pixels) on the page.
    static func pageRect(_ px: CGRect, imageSize: CGSize, region: Box) -> Box {
        let a = pagePoint(px.origin, imageSize: imageSize, region: region)
        let b = pagePoint(CGPoint(x: px.maxX, y: px.maxY), imageSize: imageSize, region: region)
        return Box(x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y)
    }

    /// Where a page rect is on screen (view points) under `camera`.
    static func viewRect(_ box: Box, camera: Camera) -> CGRect {
        let a = camera.toView(Vec2(box.minX, box.minY))
        return CGRect(x: a.x, y: a.y, width: box.w * camera.scale, height: box.h * camera.scale)
    }

    /// A picture pixel on screen: picture → page → view.
    static func viewPoint(_ px: CGPoint, imageSize: CGSize, region: Box, camera: Camera) -> CGPoint {
        camera.toView(pagePoint(px, imageSize: imageSize, region: region))
    }
}

enum PictureTutorCapture {
    /// The meta on an accepted picture: locked (Select and the eraser leave it alone), kept from the
    /// Live loop, and known as the picture tutor's so it never counts as the kid's work.
    static let metaKey = "pictureTutor"

    static func meta(runId: String?, mode: PictureTutorMode) -> Meta {
        var m: Meta = ["locked": true, "protected": true, "kind": "pictureTutor", metaKey: true, "mode": .string(mode.rawValue)]
        if let runId { m["runId"] = .string(runId) }
        return m
    }

    static func isPictureTutor(_ r: BoardRecord) -> Bool {
        r.meta[metaKey]?.boolValue == true
    }

    /// What goes in the picture: everything drawn on the screen, the tutor's accepted pictures too, so
    /// the tutor sees what it already wrote and never writes it again (a ghost on show is an overlay,
    /// not a record, so it is never in here).
    static func content(_ records: [BoardRecord]) -> [BoardRecord] {
        records.filter { $0.isDrawable }
    }

    /// The current screen's region R as a picture; nil when there's nothing of the kid's in it (an
    /// empty board is never sent) or the view isn't laid out.
    @MainActor
    static func capture(controller: BoardController, insets: CameraConstraints? = nil,
                        margin: Double = PictureTutorSettings.captureMarginFraction) async -> PictureCapture? {
        let screenID = controller.currentScreenID
        guard let screen = controller.currentScreen,
              let region = PictureTutorGeometry.region(camera: controller.viewport.camera, viewSize: controller.viewport.viewSize,
                                                       screen: BoardCanvasView.extent(of: screen.rect, infinite: controller.infinite),
                                                       insets: insets, margin: margin) else { return nil }
        let items = content(controller.store.drawables(on: screenID))
            .compactMap { RenderGeometry.item(for: $0, images: controller.images) }
            .filter { $0.bounds.intersects(region) }
        guard !items.isEmpty else { return nil }
        let lines = kidLines(controller.store.drawables(on: screenID), in: region)
        var capture = await Task.detached(priority: .userInitiated) { make(items, region: region, screen: screenID) }.value
        capture?.lines = lines
        return capture
    }

    /// The kid's strokes in R grouped into lines (level with each other), top to bottom, at most 8.
    @MainActor static func kidLines(_ records: [BoardRecord], in region: Box) -> [Box] {
        var boxes: [Box] = records.compactMap {
            guard case .stroke(let s) = $0, s.author == .kid, let b = PictureTutorBoard.bounds(s), b.intersects(region) else { return nil }
            return b
        }
        boxes.sort { $0.y < $1.y }
        var lines: [Box] = []
        for b in boxes {
            // joins a line its middle sits within
            if let i = lines.lastIndex(where: { b.y + b.h / 2 > $0.y && b.y + b.h / 2 < $0.y + $0.h }) {
                lines[i] = lines[i].union(b)
            } else {
                lines.append(b)
            }
        }
        return Array(lines.sorted { $0.y < $1.y }.prefix(8))
    }

    static func make(_ items: [RenderItem], region: Box, screen: RecordID) -> PictureCapture? {
        let size = PictureTutorGeometry.pixelSize(for: region)
        guard let image = render(items, region: region, width: size.width, height: size.height), let png = png(image) else { return nil }
        let areas = BlankArea.find(in: image)
        return PictureCapture(region: region, screen: screen, png: png, image: image, hash: hash(png), blank: areas.blank, ink: areas.ink)
    }

    /// R at `width` × `height` px, on white.
    static func render(_ items: [RenderItem], region: Box, width w: Int, height h: Int) -> CGImage? {
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
        ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
        TileRasterizer.preparePageSpace(ctx, rect: region, scale: CGFloat(Double(w) / region.w), pixelHeight: h)
        TileRasterizer.draw(items, in: ctx)
        return ctx.makeImage()
    }

    /// The painter's picture in the tutor's blue (the owner, 2026-10-26: no tracing, "just do blue ink
    /// handwriting"): each pixel's darkness becomes the blue's opacity, so black ink is solid blue, its
    /// soft edges stay soft, and paper stays clear. Nil when the image can't be redrawn.
    static func tutorBlue(_ image: CGImage) -> CGImage? {
        let w = image.width, h = image.height
        guard w > 0, h > 0, let space = CGColorSpace(name: CGColorSpace.sRGB),
              let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: space,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        guard let data = ctx.data else { return nil }
        let px = data.bindMemory(to: UInt8.self, capacity: w * h * 4)
        let ink = InkColor.tutor.rgb
        for i in 0..<(w * h) {
            let o = i * 4
            let a = Double(px[o + 3]) / 255
            guard a > 0 else { continue }
            // un-premultiply, then darkness × coverage is how much blue
            let r = Double(px[o]) / 255 / a, g = Double(px[o + 1]) / 255 / a, b = Double(px[o + 2]) / 255 / a
            let darkness = max(0, min(1, 1 - (0.299 * r + 0.587 * g + 0.114 * b)))
            let alpha = a * darkness
            px[o] = UInt8((ink.r * alpha * 255).rounded())
            px[o + 1] = UInt8((ink.g * alpha * 255).rounded())
            px[o + 2] = UInt8((ink.b * alpha * 255).rounded())
            px[o + 3] = UInt8((alpha * 255).rounded())
        }
        return ctx.makeImage()
    }

    static func png(_ image: CGImage) -> Data? {
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, UTType.png.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, image, nil)
        guard CGImageDestinationFinalize(dest) else { return nil }
        return out as Data
    }

    static func hash(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /// A PNG's pixels (the overlay that came back).
    static func decode(_ png: Data) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(png as CFData, nil) else { return nil }
        return CGImageSourceCreateImageAtIndex(source, 0, nil)
    }
}

/// Where the picture is clear: the largest empty rectangle (for the pen to think in) and the ink's box
/// (for the pen to look at). On a coarse grid of the picture, ink grown by a cell so the pen keeps
/// clear of it.
enum BlankArea {
    static let cell = 12

    static func find(in image: CGImage) -> (blank: CGRect?, ink: CGRect?) {
        let cols = max(1, image.width / cell), rows = max(1, image.height / cell)
        guard let grid = occupancy(image, cols: cols, rows: rows) else { return (nil, nil) }
        var ink: (c0: Int, r0: Int, c1: Int, r1: Int)?
        for r in 0..<rows {
            for c in 0..<cols where grid[r * cols + c] {
                ink = ink.map { (min($0.c0, c), min($0.r0, r), max($0.c1, c), max($0.r1, r)) } ?? (c, r, c, r)
            }
        }
        let sx = Double(image.width) / Double(cols), sy = Double(image.height) / Double(rows)
        let inkRect = ink.map { CGRect(x: Double($0.c0) * sx, y: Double($0.r0) * sy, width: Double($0.c1 - $0.c0 + 1) * sx, height: Double($0.r1 - $0.r0 + 1) * sy) }
        let grown = dilate(grid, cols: cols, rows: rows)
        let blank = largestEmpty(grown, cols: cols, rows: rows).map {
            CGRect(x: Double($0.c) * sx, y: Double($0.r) * sy, width: Double($0.w) * sx, height: Double($0.h) * sy)
        }
        return (blank, inkRect)
    }

    /// The picture shrunk to one pixel per cell: a cell with any ink in it is darker than paper.
    static func occupancy(_ image: CGImage, cols: Int, rows: Int) -> [Bool]? {
        var pixels = [UInt8](repeating: 255, count: cols * rows)
        let ok = pixels.withUnsafeMutableBytes { buf -> Bool in
            guard let ctx = CGContext(data: buf.baseAddress, width: cols, height: rows, bitsPerComponent: 8, bytesPerRow: cols,
                                      space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return false }
            ctx.interpolationQuality = .medium
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: cols, height: rows))
            return true
        }
        guard ok else { return nil }
        // (the bitmap's rows are bottom-up in CG's space: row 0 of the buffer is the picture's top)
        return pixels.map { $0 < 248 }
    }

    static func dilate(_ g: [Bool], cols: Int, rows: Int) -> [Bool] {
        var out = g
        for r in 0..<rows {
            for c in 0..<cols where g[r * cols + c] {
                for dr in -1...1 {
                    for dc in -1...1 {
                        let rr = r + dr, cc = c + dc
                        if rr >= 0, rr < rows, cc >= 0, cc < cols { out[rr * cols + cc] = true }
                    }
                }
            }
        }
        return out
    }

    /// The largest all-clear rectangle (cells), by the histogram method; nil when none is clear.
    static func largestEmpty(_ g: [Bool], cols: Int, rows: Int) -> (c: Int, r: Int, w: Int, h: Int)? {
        var heights = [Int](repeating: 0, count: cols)
        var best: (c: Int, r: Int, w: Int, h: Int, area: Int)?
        for r in 0..<rows {
            for c in 0..<cols { heights[c] = g[r * cols + c] ? 0 : heights[c] + 1 }
            var stack: [Int] = []
            for c in 0...cols {
                let h = c == cols ? 0 : heights[c]
                while let top = stack.last, heights[top] >= h {
                    stack.removeLast()
                    let height = heights[top]
                    let left = stack.last.map { $0 + 1 } ?? 0
                    let width = c - left
                    let area = width * height
                    if height > 0, area > (best?.area ?? 0) { best = (left, r - height + 1, width, height, area) }
                }
                stack.append(c)
            }
        }
        return best.map { ($0.c, $0.r, $0.w, $0.h) }
    }
}
