import AgathonBoard
import AgathonBrain
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// A JPEG of some of the kid's strokes, as a data URL, for the routes that read ink with a vision
/// model: a read with the vision recognizer (or the one retry after `needsCrop`), the second reader.
/// The web's `captureCrop`: about `maxWidth` px wide, white behind the ink, 8 px of padding, at most
/// `LiveLimits.maxCropBytes`. Drawn with the board's own renderer (AgathonBoard's `RenderGeometry`),
/// so the crop is the ink exactly as the kid sees it.
public enum InkCrop {
    public static func dataURL(strokes: [StrokeRecord], bounds: BrainRect, maxWidth: Double = 512, maxBytes: Int = LiveLimits.maxCropBytes) -> String? {
        guard !strokes.isEmpty, bounds.w > 0, bounds.h > 0 else { return nil }
        var width = maxWidth
        for _ in 0..<4 {
            if let data = jpeg(strokes: strokes, bounds: bounds, width: width), data.count <= maxBytes {
                return "data:image/jpeg;base64,\(data.base64EncodedString())"
            }
            width *= 0.7
        }
        return nil
    }

    /// The JPEG bytes at a target width (never upscaled past 2×).
    public static func jpeg(strokes: [StrokeRecord], bounds: BrainRect, width: Double, quality: Double = 0.8) -> Data? {
        let pad = 8.0
        let box = bounds.expanded(pad)
        let scale = min(2, max(0.1, width / box.w))
        let pw = max(1, Int((box.w * scale).rounded(.up)))
        let ph = max(1, Int((box.h * scale).rounded(.up)))
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let ctx = CGContext(data: nil, width: pw, height: ph, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                                  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
        else { return nil }
        ctx.setFillColor(CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: pw, height: ph))
        // page space is y-down
        ctx.translateBy(x: 0, y: CGFloat(ph))
        ctx.scaleBy(x: CGFloat(scale), y: -CGFloat(scale))
        ctx.translateBy(x: CGFloat(-box.x), y: CGFloat(-box.y))
        for s in strokes {
            var ink = s
            // the kid's colour does not matter to a reader; dark ink on white reads best
            ink.color = .black
            RenderGeometry.stroke(ink).draw(in: ctx)
        }
        guard let image = ctx.makeImage() else { return nil }
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { return nil }
        return out as Data
    }
}
