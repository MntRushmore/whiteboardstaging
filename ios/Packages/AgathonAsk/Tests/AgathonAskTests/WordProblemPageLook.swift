@testable import AgathonAsk
import AgathonBoard
import AgathonBoardUI
import AgathonLive
import Foundation
import Testing
import UIKit

/// A word problem's page as a picture, for a person to look at (not compared): the page's template,
/// the words in the tutor's hand. Off by default; with TEST_RUNNER_LIVE_SNAPSHOTS=<dir> the PNGs are
/// written there.
@MainActor
@Suite(.enabled(if: ProcessInfo.processInfo.environment["LIVE_SNAPSHOTS"] != nil))
struct WordProblemPageLook {
    @Test func wordProblemPages() async throws {
        let dir = URL(fileURLWithPath: ProcessInfo.processInfo.environment["LIVE_SNAPSHOTS"] ?? NSTemporaryDirectory())
        let problems: [(String, [String])] = [
            ("words-apples.png", ["\\text{Sam has 3 bags of 4 apples.}", "\\text{How many apples?}"]),
            ("words-ages.png", ["\\text{Maya is 3 years older than Leo.}", "\\text{Together they are 21.}", "\\text{How old is Leo?}"]),
            ("words-long.png", ["\\text{A baker makes 24 muffins in the morning and 18 more in the afternoon. She puts them in boxes of 6 and gives }\\frac{1}{2}\\text{ of the boxes to the school bake sale.}",
                                "\\text{How many boxes does she give to the bake sale?}"]),
        ]
        for (name, problem) in problems {
            let board = MemoryBoard()
            let d = AskBoardDriver(board: board, brain: TestBrain.shared)
            d.problemPages = true
            let report = await ProblemPageWriter(driver: d).write(.init(problems: [problem], setId: "look", origin: "practice", allDone: false))
            let id = try #require(report.pages.first)
            let screen = try #require(board.store[id]?.screen)
            let page = try #require(screen.problemPage)
            let width = 1600
            let rect = screen.rect
            let scale = CGFloat(width) / CGFloat(rect.w)
            let height = Int((Double(width) * rect.h / rect.w).rounded())
            let ctx = try #require(CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                             space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                             bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue))
            TileRasterizer.preparePageSpace(ctx, rect: rect, scale: scale, pixelHeight: height)
            ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
            ctx.fill(rect.cgRect)
            PageTemplate(page: page, screen: rect)?.draw(in: ctx, colors: .blocks)
            TileRasterizer.draw(SceneIndex.build(board.store.drawables(on: id), images: .shared).items(in: rect), in: ctx)
            let image = try #require(ctx.makeImage())
            try #require(UIImage(cgImage: image).pngData()).write(to: dir.appendingPathComponent(name))
        }
    }
}
