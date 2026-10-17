#!/usr/bin/env swift
// Draws the app's raster brand assets from the mark's geometry (MarkGeometry in
// Sources/AgathonDesign/Brand/Mark.swift; the brand page's Blocks lockup):
//
//   AppIcon.png  1024 × 1024, opaque, flat fills: the mark on ink (mark at 92 % of a 120 box,
//                offset 14, as on the brand page). iOS rounds the corners itself.
//   Logo.png     600 × 600, transparent: the three-colour mark on its own.
//
// Run from the repo root:
//   swift ios/Packages/AgathonDesign/Scripts/render-brand-assets.swift ios/Agathon/Resources/Assets.xcassets
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let ink = CGColor(srgbRed: 0x14 / 255.0, green: 0x15 / 255.0, blue: 0x1F / 255.0, alpha: 1)
let cobalt = CGColor(srgbRed: 0x2D / 255.0, green: 0x5B / 255.0, blue: 0xFF / 255.0, alpha: 1)
let sunny = CGColor(srgbRed: 0xFF / 255.0, green: 0xD1 / 255.0, blue: 0x2E / 255.0, alpha: 1)
let tomato = CGColor(srgbRed: 0xFF / 255.0, green: 0x5A / 255.0, blue: 0x36 / 255.0, alpha: 1)

/// Draws the mark's 100-unit box at `origin` with `unit` pixels per unit (y down).
func drawMark(_ ctx: CGContext, origin: CGPoint, unit u: CGFloat) {
    func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: origin.x + x * u, y: origin.y + y * u) }
    // Ring: centre (50, 50), radius 23, stroke 10, as a filled band.
    let c = p(50, 50)
    let ring = CGMutablePath()
    ring.addEllipse(in: CGRect(x: c.x - 28 * u, y: c.y - 28 * u, width: 56 * u, height: 56 * u))
    ring.addEllipse(in: CGRect(x: c.x - 18 * u, y: c.y - 18 * u, width: 36 * u, height: 36 * u))
    ctx.addPath(ring)
    ctx.setFillColor(cobalt)
    ctx.fillPath(using: .evenOdd)
    // Bar: x 68, y 22, 10 × 56, corner 2.5.
    let bar = CGPath(roundedRect: CGRect(origin: p(68, 22), size: CGSize(width: 10 * u, height: 56 * u)),
                     cornerWidth: 2.5 * u, cornerHeight: 2.5 * u, transform: nil)
    ctx.addPath(bar)
    ctx.setFillColor(tomato)
    ctx.fillPath()
    // Dot: radius 6.5.
    ctx.setFillColor(sunny)
    ctx.fillEllipse(in: CGRect(x: c.x - 6.5 * u, y: c.y - 6.5 * u, width: 13 * u, height: 13 * u))
}

func makeContext(_ side: Int, opaque: Bool) -> CGContext {
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    let info = opaque ? CGImageAlphaInfo.noneSkipLast.rawValue : CGImageAlphaInfo.premultipliedLast.rawValue
    let ctx = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: 0,
                        space: space, bitmapInfo: info)!
    // Flip to y-down so the numbers read like the SVG.
    ctx.translateBy(x: 0, y: CGFloat(side))
    ctx.scaleBy(x: 1, y: -1)
    ctx.setShouldAntialias(true)
    return ctx
}

func write(_ ctx: CGContext, to url: URL) {
    let image = ctx.makeImage()!
    let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, image, nil)
    guard CGImageDestinationFinalize(dest) else { fatalError("couldn't write \(url.path)") }
    print("wrote \(url.path)")
}

let args = CommandLine.arguments
guard args.count == 2 else {
    print("usage: render-brand-assets.swift <Assets.xcassets>")
    exit(2)
}
let assets = URL(fileURLWithPath: args[1])

// App icon: 1024, opaque, ink ground, mark at 92/120 offset 14/120.
do {
    let side = 1024
    let ctx = makeContext(side, opaque: true)
    ctx.setFillColor(ink)
    ctx.fill(CGRect(x: 0, y: 0, width: side, height: side))
    let k = CGFloat(side) / 120
    drawMark(ctx, origin: CGPoint(x: 14 * k, y: 14 * k), unit: 0.92 * k)
    write(ctx, to: assets.appendingPathComponent("AppIcon.appiconset/AppIcon.png"))
}

// Logo: 600, transparent, the mark's box filling the image.
do {
    let side = 600
    let ctx = makeContext(side, opaque: false)
    ctx.clear(CGRect(x: 0, y: 0, width: side, height: side))
    drawMark(ctx, origin: .zero, unit: CGFloat(side) / 100)
    write(ctx, to: assets.appendingPathComponent("Logo.imageset/Logo.png"))
}
