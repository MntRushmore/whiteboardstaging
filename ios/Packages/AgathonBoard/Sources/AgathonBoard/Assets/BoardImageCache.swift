import CoreGraphics
import Foundation
import ImageIO

/// The board's decoded pictures, by their record's `asset.src`: downsampled to what the screen can
/// show (never the camera's full 12 MP), decoded once, and shared by every tile that draws them.
/// Thread-safe: tiles render off the main thread and read it while it fills.
public final class BoardImageCache: @unchecked Sendable {
    public static let shared = BoardImageCache()

    public enum State: Sendable, Equatable {
        case loading
        case ready
        case failed
    }

    private struct Entry {
        var state: State
        var image: CGImage?
        /// the longest side the image was decoded at (a bigger picture on the board asks for more)
        var pixels: Int
        var used: UInt64
    }

    private let lock = NSLock()
    private var entries: [String: Entry] = [:]
    private var clock: UInt64 = 0
    /// decoded bytes kept before the least recently drawn pictures are let go
    public var byteLimit = 160 * 1024 * 1024

    public init() {}

    /// The picture behind `src`, when it is decoded.
    public func image(for src: String) -> CGImage? {
        lock.lock()
        defer { lock.unlock() }
        guard var e = entries[src], let img = e.image else { return nil }
        clock += 1
        e.used = clock
        entries[src] = e
        return img
    }

    public func state(for src: String) -> State? {
        lock.lock()
        defer { lock.unlock() }
        return entries[src]?.state
    }

    /// Marks `src` as loading at `pixels`. False when it is already loading, or decoded big enough.
    func beginLoad(_ src: String, pixels: Int) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if let e = entries[src] {
            switch e.state {
            case .loading: return false
            case .ready: if Double(pixels) <= Double(e.pixels) * 1.25 { return false }
            case .failed: return false
            }
            entries[src]?.state = e.image == nil ? .loading : .ready
            entries[src]?.pixels = pixels
            return true
        }
        entries[src] = Entry(state: .loading, image: nil, pixels: pixels, used: 0)
        return true
    }

    /// A decoded picture for `src` (a load finished, or the app put one it already had: a photo it
    /// just uploaded).
    public func put(_ image: CGImage, for src: String) {
        lock.lock()
        clock += 1
        entries[src] = Entry(state: .ready, image: image, pixels: max(image.width, image.height), used: clock)
        trim()
        lock.unlock()
    }

    func fail(_ src: String) {
        lock.lock()
        if entries[src]?.image == nil {
            entries[src] = Entry(state: .failed, image: nil, pixels: 0, used: 0)
        } else {
            entries[src]?.state = .ready
        }
        lock.unlock()
    }

    /// Forgets `src` (a failed load to try again).
    public func forget(_ src: String) {
        lock.lock()
        entries[src] = nil
        lock.unlock()
    }

    public func removeAll() {
        lock.lock()
        entries.removeAll()
        lock.unlock()
    }

    private func trim() {
        var total = entries.values.reduce(0) { $0 + ($1.image.map { $0.bytesPerRow * $0.height } ?? 0) }
        guard total > byteLimit else { return }
        for (src, e) in entries.sorted(by: { $0.value.used < $1.value.used }) where e.image != nil {
            total -= e.image.map { $0.bytesPerRow * $0.height } ?? 0
            entries[src] = nil
            if total <= byteLimit { break }
        }
    }

    // MARK: - Decoding

    /// The longest side, in pixels, to decode a picture at for a record this big (page units): enough
    /// for a 2× zoom on the biggest iPad, never more than 2560.
    public static func pixels(forPageSize w: Double, _ h: Double) -> Int {
        Int(min(2560, max(256, max(w, h) * 2.5)).rounded())
    }

    /// Decodes `data` at most `maxPixels` on its longest side, upright (EXIF orientation applied).
    public static func decode(_ data: Data, maxPixels: Int) -> CGImage? {
        let opts = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, opts) else { return nil }
        let thumb: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixels,
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, thumb as CFDictionary)
    }

    /// The bytes of a `data:` URL (old boards kept small pictures inline).
    public static func dataURLBytes(_ src: String) -> Data? {
        guard src.hasPrefix("data:"), let comma = src.firstIndex(of: ",") else { return nil }
        let header = src[src.startIndex..<comma]
        let body = String(src[src.index(after: comma)...])
        if header.hasSuffix(";base64") { return Data(base64Encoded: body, options: .ignoreUnknownCharacters) }
        return body.removingPercentEncoding.map { Data($0.utf8) }
    }
}
