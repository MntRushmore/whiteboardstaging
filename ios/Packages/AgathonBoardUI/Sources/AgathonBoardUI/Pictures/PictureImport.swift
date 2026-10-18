import AgathonBoard
import AgathonDesign
import CoreGraphics
import Foundation
import ImageIO
import PDFKit
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// A picture ready for the board: its bytes to upload (re-encoded, without the camera's metadata:
/// no location ever leaves the iPad) and its decoded pixels to show at once.
public struct PreparedPicture: @unchecked Sendable {
    public var data: Data
    public var mimeType: String
    public var image: CGImage
}

/// Photos, camera shots and files made fit for a board (the web's `addImageFiles` rules).
public enum PictureImport {
    /// What the `board-assets` bucket accepts (supabase/migrations/20260911000000_init.sql, B4).
    public static let boardTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"]
    /// The longest side kept: a board shows a picture at most screen-wide, zoomed 2×.
    public static let maxPixels = 2048
    /// The web's limit for a picture, applied to what is uploaded.
    public static let maxBytes = 10 * 1024 * 1024
    public static let maxPDFBytes = 25 * 1024 * 1024

    public enum Failure: Error, Equatable {
        case notAPicture
        case tooBig
        case pdfLocked
        case pdfUnreadable
    }

    /// Decodes any picture iOS reads (HEIC from the camera roll included), upright, at most
    /// `maxPixels`, and encodes it as JPEG (PNG when it has see-through parts), with no metadata.
    public static func prepare(_ data: Data, maxPixels: Int = maxPixels) throws -> PreparedPicture {
        guard let image = BoardImageCache.decode(data, maxPixels: maxPixels) else { throw Failure.notAPicture }
        return try encode(image)
    }

    public static func prepare(_ image: UIImage) throws -> PreparedPicture {
        guard let data = image.jpegData(compressionQuality: 0.95) ?? image.pngData() else { throw Failure.notAPicture }
        return try prepare(data)
    }

    public static func encode(_ image: CGImage) throws -> PreparedPicture {
        let alpha = image.alphaInfo
        let transparent = alpha == .first || alpha == .last || alpha == .premultipliedFirst || alpha == .premultipliedLast
        let type = transparent ? UTType.png : UTType.jpeg
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, type.identifier as CFString, 1, nil) else { throw Failure.notAPicture }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { throw Failure.notAPicture }
        guard out.length <= maxBytes else { throw Failure.tooBig }
        return PreparedPicture(data: out as Data, mimeType: transparent ? "image/png" : "image/jpeg", image: image)
    }

    // MARK: - PDF

    /// Opens a PDF (a file picked in Files). Refuses a locked one and anything over 25 MB.
    public static func openPDF(_ url: URL) throws -> PDFDocument {
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard size <= maxPDFBytes else { throw Failure.tooBig }
        guard let doc = PDFDocument(url: url) else { throw Failure.pdfUnreadable }
        guard !doc.isLocked else { throw Failure.pdfLocked }
        guard doc.pageCount > 0 else { throw Failure.pdfUnreadable }
        return doc
    }

    /// A page's size in points, upright (its rotation applied).
    public static func pageSize(_ page: PDFPage) -> CGSize {
        let b = page.bounds(for: .mediaBox)
        return page.rotation % 180 == 0 ? b.size : CGSize(width: b.height, height: b.width)
    }

    /// Renders a page to fill `pixels` wide (the size the page will have on the screen at full
    /// zoom-out × 2, capped at 3200), white behind it, upright.
    public static func render(_ page: PDFPage, width pixels: Int) -> CGImage? {
        let size = pageSize(page)
        guard size.width > 0, size.height > 0 else { return nil }
        let w = max(64, min(3200, pixels))
        let h = max(1, Int((Double(w) * size.height / size.width).rounded()))
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
        ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
        ctx.interpolationQuality = .high
        let scale = CGFloat(w) / size.width
        ctx.scaleBy(x: scale, y: scale)
        page.draw(with: .mediaBox, to: ctx)
        return ctx.makeImage()
    }

    /// A small picture of a page for the picker.
    public static func thumbnail(_ page: PDFPage, width: CGFloat = 240) -> UIImage {
        let size = pageSize(page)
        let h = width * size.height / max(1, size.width)
        return page.thumbnail(of: CGSize(width: width, height: h), for: .mediaBox)
    }

    /// The meta of a PDF page on the board: locked (it is the worksheet, it stays put) and kept out
    /// of the tutor's reach, as the web's PDF upload does.
    public static func pdfMeta(fileName: String, page: Int) -> Meta {
        ["locked": true, "protected": true, "kind": "pdf", "fileName": .string(fileName), "page": .number(Double(page))]
    }
}

extension BoardController {
    /// Puts a prepared picture on the current screen (fitted, uploaded first).
    @discardableResult
    public func insert(_ p: PreparedPicture, source: String, rect: Box? = nil, meta: Meta = [:]) async -> RecordID? {
        await insertPicture(p.data, image: p.image, mimeType: p.mimeType, source: source, rect: rect, meta: meta)
    }

    /// Renders PDF page `index` (0-based) at the screen's resolution and puts it on the current
    /// screen, fitted, locked.
    @discardableResult
    public func insertPDFPage(_ doc: PDFDocument, index: Int, fileName: String, pixelsPerUnit: Double = 2.4) async -> RecordID? {
        guard let page = doc.page(at: index) else { return nil }
        let rect = fitInScreen(PictureImport.pageSize(page))
        guard let image = PictureImport.render(page, width: Int(rect.w * pixelsPerUnit)),
              let p = try? PictureImport.encodePNG(image) else {
            notice = BoardNotice(kind: .pdfFailed)
            return nil
        }
        return await insert(p, source: "pdf", rect: rect, meta: PictureImport.pdfMeta(fileName: fileName, page: index + 1))
    }
}

extension PictureImport {
    /// A PDF page as PNG (sharp text; the web uploads PNG too).
    public static func encodePNG(_ image: CGImage) throws -> PreparedPicture {
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, UTType.png.identifier as CFString, 1, nil) else { throw Failure.notAPicture }
        CGImageDestinationAddImage(dest, image, nil)
        guard CGImageDestinationFinalize(dest) else { throw Failure.notAPicture }
        guard out.length <= maxBytes else { throw Failure.tooBig }
        return PreparedPicture(data: out as Data, mimeType: "image/png", image: image)
    }
}

// MARK: - Camera

/// The camera (UIImagePickerController): one photo, straight to the board.
struct CameraPicker: UIViewControllerRepresentable {
    var onPhoto: (UIImage?) -> Void

    static var isAvailable: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let c = UIImagePickerController()
        c.sourceType = Self.isAvailable ? .camera : .photoLibrary
        c.delegate = context.coordinator
        return c
    }

    func updateUIViewController(_ c: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onPhoto: onPhoto) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onPhoto: (UIImage?) -> Void
        init(onPhoto: @escaping (UIImage?) -> Void) { self.onPhoto = onPhoto }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            onPhoto(info[.originalImage] as? UIImage)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { onPhoto(nil) }
    }
}

// MARK: - PDF page picker

/// Pick a page of a PDF to put on the board: its pages as thumbnails, one tap to choose, Add page.
struct PDFPagePicker: View {
    let document: PDFDocument
    let fileName: String
    var onPick: (Int) -> Void
    var onCancel: () -> Void
    @State private var chosen = 0
    @State private var thumbs: [Int: UIImage] = [:]

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.l) {
            SheetHeader("Pick a page", tag: fileName, onClose: onCancel)
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150, maximum: 200), spacing: DS.Space.l)], spacing: DS.Space.l) {
                    ForEach(0..<min(document.pageCount, 60), id: \.self) { i in
                        Button {
                            chosen = i
                        } label: {
                            VStack(spacing: DS.Space.xs) {
                                ZStack {
                                    RoundedRectangle(cornerRadius: DS.Radius.thumb, style: .continuous).fill(DS.Color.surfaceSunken)
                                    if let t = thumbs[i] {
                                        Image(uiImage: t).resizable().scaledToFit().padding(8)
                                    }
                                }
                                .frame(height: 200)
                                .overlay(RoundedRectangle(cornerRadius: DS.Radius.thumb, style: .continuous)
                                    .strokeBorder(chosen == i ? DS.Color.ink : .clear, lineWidth: DS.Stroke.selected))
                                Text("\(i + 1)").font(DS.Font.fixed(.numeral, size: 17)).foregroundStyle(chosen == i ? DS.Color.ink : DS.Color.inkSecondary)
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Page \(i + 1)")
                        .accessibilityAddTraits(chosen == i ? .isSelected : [])
                        .onAppear {
                            if thumbs[i] == nil, let page = document.page(at: i) { thumbs[i] = PictureImport.thumbnail(page) }
                        }
                    }
                }
            }
            HStack {
                Spacer()
                PillButton("Add page \(chosen + 1)", icon: .plus, kind: .primary, size: .large) { onPick(chosen) }
            }
        }
        .padding(DS.Space.xl)
        .background(DS.Color.paper)
    }
}
