import AgathonBoard
import CoreGraphics
import Foundation

/// The dock's words, for a 6-year-old: one short word under each picture, US English. (The web's
/// `DOCK_COPY`, src/components/kidmode/dockView.ts, where they are pinned the same way.) A board's
/// screens are "pages" to a kid, everywhere.
public enum DockCopy {
    public static let dock = "Tools"
    public static let back = "Back to my boards"
    public static let select = "Select"
    public static let selectHint = "Tap or circle your work to move it, resize it or delete it"
    public static let pen = "Pen"
    public static let eraser = "Eraser"
    public static let shapes = "Shapes"
    public static let line = "Line"
    public static let arrow = "Arrow"
    public static let box = "Box"
    public static let circle = "Circle"
    public static let picture = "Picture"
    public static let photos = "Photos"
    public static let camera = "Camera"
    public static let files = "Files"
    public static let undo = "Undo"
    public static let redo = "Redo"
    public static let more = "More"
    public static let color = "Color"
    public static let colors = "Colors"
    public static let newPage = "New page"
    public static let pages = "Pages"
    public static let previousPage = "Page before"
    public static let nextPage = "Next page"
    public static let copy = "Copy"
    public static let delete = "Delete"
    public static let full = "This board is full"

    public static func pageOf(_ n: Int, _ count: Int) -> String { "Page \(n) of \(count)" }
    /// a problem page in a set (docs/PROBLEM-PAGES.md)
    public static func problemOf(_ n: Int, _ count: Int) -> String { "Problem \(n) of \(count)" }
    public static let allDone = "All done"

    /// What the top bar says under the board's name: "Problem 2 of 5" on a problem page in a set,
    /// "All done" on the page that ends one, else "Page 2 of 6".
    public static func whereAmI(_ page: ProblemPage?, screen n: Int, of count: Int) -> String {
        if let page {
            if page.kind == .done && page.setId != nil { return allDone }
            if page.kind == .problem, page.inSet, let i = page.index, let c = page.count { return problemOf(i, c) }
        }
        return pageOf(n, count)
    }
    public static func pageShort(_ n: Int, _ count: Int) -> String { "\(n)/\(count)" }

    public static let deleteTitle = "Delete this page?"
    public static let deleteMessage = "Everything on it goes too. You can undo it."
    public static let deleteConfirm = "Delete page"
    public static let keep = "Keep it"

    public static let pictureFailed = "Couldn't add that picture."
    public static let pdfFailed = "Couldn't add that page."
    public static let tryAgain = "Try again."
    public static let boardFull = "This board is full."
    public static let boardFullMessage = "A board holds 50 pages."
}

/// How much of the dock fits beside Help me, from the board's width (the web's `dockFit`):
///  - `row`: everything (Select, Pen, Eraser, Shapes, Picture | Undo, Redo | five pens | pages);
///  - `fold`: Shapes, Picture and Redo behind More (an upright iPad, a split view);
///  - `foldColors`: the pens behind one Color button too;
///  - `compact`: New page behind More too.
/// When even that is too wide, Help me goes above the dock (`helpAbove`). It never wraps.
public struct DockLayout: Equatable, Sendable {
    public enum Fit: Int, CaseIterable, Sendable {
        case row, fold, foldColors, compact
    }

    public var fit: Fit
    public var helpAbove: Bool

    public var shapesInMore: Bool { fit != .row }
    public var redoInMore: Bool { fit != .row }
    public var colorsInButton: Bool { fit == .foldColors || fit == .compact }
    public var newPageInMore: Bool { fit == .compact }

    /// The dock's measures, in points (the view draws with the same numbers).
    public enum Size {
        /// a tool's column: its circle and its word
        public static let tool: CGFloat = 58
        public static let circle: CGFloat = 52
        public static let height: CGFloat = 84
        public static let swatch: CGFloat = 56
        public static let separator: CGFloat = 18
        public static let arrow: CGFloat = 52
        public static let pageLabel: CGFloat = 48
        public static let newPage: CGFloat = 76
        /// either end of the dock: the capsule's round end needs room past the last word
        public static let padding: CGFloat = 16
        /// between the dock and Help me
        public static let helpGap: CGFloat = 14
    }

    /// The dock's width at `fit` (several pages: the arrows show).
    public static func width(_ fit: Fit, pages: Int) -> CGFloat {
        let tools = CGFloat(fit == .row ? 5 : 3) * Size.tool
        let edits = 2 * Size.tool // Undo and Redo, or Undo and More
        let colors = fit == .foldColors || fit == .compact ? Size.tool : 5 * Size.swatch
        let arrows = pages > 1 ? 2 * Size.arrow + Size.pageLabel : 0
        let newPage = fit == .compact ? 0 : Size.newPage
        let pagesPart = arrows + newPage
        let groups = pagesPart > 0 ? 3 : 2
        return 2 * Size.padding + tools + edits + colors + pagesPart + CGFloat(groups) * Size.separator
    }

    /// The most of the dock that fits `width` points with Help me (`helpWidth`) beside it.
    public static func fitting(width: CGFloat, helpWidth: CGFloat, pages: Int) -> DockLayout {
        let beside = width - (helpWidth > 0 ? helpWidth + Size.helpGap : 0)
        for fit in Fit.allCases where Self.width(fit, pages: pages) <= beside {
            return DockLayout(fit: fit, helpAbove: false)
        }
        for fit in Fit.allCases where Self.width(fit, pages: pages) <= width {
            return DockLayout(fit: fit, helpAbove: helpWidth > 0)
        }
        return DockLayout(fit: .compact, helpAbove: helpWidth > 0)
    }
}
