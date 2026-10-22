import Foundation

/// The pages of one problem that needed more room (docs/PROBLEM-PAGES.md, "More room"): its first
/// page and every page that `continues` it, in the board's order. A problem on one page has none.
public struct ProblemPageGroup: Equatable, Sendable {
    /// the problem's first page (its `problem` record and the tutor's problem are there)
    public let first: RecordID
    /// the problem's pages, the first first, in the board's order
    public let pages: [RecordID]

    public init(first: RecordID, pages: [RecordID]) {
        self.first = first
        self.pages = pages
    }

    /// How many pages the problem has.
    public var count: Int { pages.count }
    /// Its last page: the answer spot is there.
    public var last: RecordID { pages.last ?? first }

    /// Which page of the problem `id` is (1-based), if it is one.
    public func part(of id: RecordID) -> Int? {
        pages.firstIndex(of: id).map { $0 + 1 }
    }

    /// The problem's pages before `id` (in order).
    public func before(_ id: RecordID) -> [RecordID] {
        guard let i = pages.firstIndex(of: id) else { return [] }
        return Array(pages[..<i])
    }
}

extension BoardStore {
    /// The problem `screen` is a page of, when that problem spreads over more than one page ("More
    /// room"); nil for a problem on one page, a plain screen or the All done page. A page whose first
    /// page is gone stands on its own.
    public func problemGroup(of screen: RecordID) -> ProblemPageGroup? {
        guard let page = self[screen]?.screen?.problemPage, page.kind == .problem else { return nil }
        var first = screen
        if let c = page.continues, c != screen, self[c]?.screen?.problemPage?.kind == .problem { first = c }
        let pages = screens.filter { s in
            s.id == first || (s.problemPage.map { $0.kind == .problem && $0.continues == first } ?? false)
        }.map(\.id)
        guard pages.count > 1, pages.contains(screen) else { return nil }
        return ProblemPageGroup(first: first, pages: pages)
    }

    /// The last page of the problem `screen` is a page of (`screen` itself for a problem on one page,
    /// or a plain screen): a page put "after this one" goes after it, so a problem's pages stay together.
    public func lastPageOfProblem(_ screen: RecordID) -> RecordID {
        problemGroup(of: screen)?.last ?? screen
    }

    /// The order key for a screen put right after `anchor` (before the screen that follows it), or at
    /// the end when `anchor` is not a screen.
    public func screenOrder(after anchor: RecordID) -> OrderKey {
        let screens = self.screens
        guard let i = screens.firstIndex(where: { $0.id == anchor }) else { return OrderKey.after(screens.last?.order) }
        let next = i + 1 < screens.count ? screens[i + 1].order : nil
        return (try? OrderKey.between(screens[i].order, next)) ?? OrderKey.after(screens.last?.order)
    }
}

/// "More room" (docs/PROBLEM-PAGES.md): the problem on show goes on on a new page right after its last
/// one. The new page says "Problem 2, continued" (the template draws it), shows the problem again,
/// small (a copy of what is written in the problem's place on its first page: the tutor's hand, a
/// typeset problem, its picture, or the kid's own first line, as the tutor's ink there), and has the
/// answer spot; the page before loses its answer spot (`more`). One step the kid can undo.
@MainActor
public enum MoreRoom {
    /// The meta key on the problem's copy at the top of a continued page: the page it was copied from.
    public static let reminderMeta = "reminder"

    /// What the step puts on the board.
    public struct Plan: Equatable, Sendable {
        /// the new page (its `page` continues the problem)
        public var screen: ScreenRecord
        /// the problem's last page until now, with `more` set
        public var previous: ScreenRecord
        /// the problem again, small, on the new page
        public var copies: [BoardRecord]
    }

    /// The step for the problem `screen` is a page of: nil when it is no problem page, has as many
    /// pages as a problem may, or the board is full.
    public static func plan(_ store: BoardStore, from screen: RecordID, now: Double = (Date().timeIntervalSince1970 * 1000).rounded()) -> Plan? {
        guard let here = store[screen]?.screen?.problemPage, here.kind == .problem else { return nil }
        let group = store.problemGroup(of: screen)
        let firstId = group?.first ?? screen
        let lastId = group?.last ?? screen
        guard (group?.count ?? 1) < ProblemPageLayout.maxPages, store.screens.count < ScreenRecord.maxScreens,
              case .screen(let first)? = store[firstId], let firstPage = first.problemPage,
              case .screen(var previous)? = store[lastId], var previousPage = previous.problemPage else { return nil }
        let L = ProblemPageLayout.self
        let rect = Box.screen
        let new = ScreenRecord(order: store.screenOrder(after: lastId), name: "Screen \(store.screens.count + 1)")

        // the problem as written in its place on the first page
        let top = L.place(Vec2(0, firstPage.resolvedWorkTop), on: first.rect).y
        let shown = store.drawables(on: firstId).filter { r in
            guard r.meta["mark"] == nil, r.meta[reminderMeta] == nil, let b = bounds(of: r) else { return false }
            return b.center.y < top
        }
        var copies: [BoardRecord] = []
        var reminderBottom = L.reminderOrigin.y
        if let box = shown.compactMap(bounds(of:)).reduce(nil as Box?, { acc, b in acc.map { $0.union(b) } ?? b }), box.w > 0 || box.h > 0 {
            // its scale in layout units (the first page's own rect may be another size), then page units
            let local = L.unplace(box, from: first.rect)
            let k = min(L.reminderScale, local.h > 0 ? L.reminderMaxHeight / local.h : L.reminderScale,
                        local.w > 0 ? (L.problemMaxX - L.reminderOrigin.x) / local.w : L.reminderScale)
            let f = k * rect.w / first.rect.w
            let origin = L.place(L.reminderOrigin, on: rect)
            func at(_ x: Double, _ y: Double) -> Vec2 { Vec2(origin.x + (x - box.x) * f, origin.y + (y - box.y) * f) }
            // (each copy appears when the page was made: a replay shows it there)
            var order = OrderKey.first
            let meta: Meta = [reminderMeta: .string(firstId.rawValue), "locked": true]
            for r in shown.sorted(by: { ($0.order ?? .first) < ($1.order ?? .first) }) {
                switch r {
                case .stroke(let s):
                    let o = at(s.x, s.y)
                    copies.append(.stroke(StrokeRecord(
                        screen: new.id, order: order, author: .tutor, color: s.color, width: s.width * f, pressure: s.pressure,
                        x: o.x, y: o.y, rotation: s.rotation,
                        points: s.points.map { p in
                            var q = p
                            q.x = Float(Double(p.x) * f)
                            q.y = Float(Double(p.y) * f)
                            return q
                        },
                        start: now, closed: s.closed, fill: s.fill, meta: meta)))
                case .math(let m):
                    let o = at(m.x, m.y)
                    copies.append(.math(MathRecord(screen: new.id, order: order, author: .tutor, role: .note, latex: m.latex, x: o.x, y: o.y,
                                                   w: m.w * f, h: m.h * f, fontSize: m.fontSize * f, meta: meta)))
                case .image(let i):
                    let o = at(i.x, i.y)
                    copies.append(.image(ImageRecord(screen: new.id, order: order, author: .tutor, x: o.x, y: o.y, w: i.w * f, h: i.h * f,
                                                     rotation: i.rotation, asset: i.asset, meta: meta)))
                default:
                    continue
                }
                order = OrderKey.after(order)
            }
            reminderBottom = L.reminderOrigin.y + local.h * k
        }
        // the new page is a page of the same problem: its place in the set, its record, its answer spot
        let page = ProblemPage(kind: .problem, setId: firstPage.setId, index: firstPage.index, count: firstPage.count,
                               problem: firstPage.problem, origin: firstPage.origin,
                               workTop: L.continuedWorkTop(reminderBottom: reminderBottom), answer: firstPage.answer,
                               continues: firstId)
        var screenRecord = new
        screenRecord.problemPage = page
        previousPage.more = true
        previous.problemPage = previousPage
        return Plan(screen: screenRecord, previous: previous, copies: copies)
    }

    /// The step, on `store` as one change of `origin` (the kid's: one undo step).
    @discardableResult
    public static func apply(_ plan: Plan, to store: BoardStore, origin: ChangeOrigin = .kid) -> RecordID {
        store.transact(origin) { tx in
            tx.put(.screen(plan.previous))
            tx.put(.screen(plan.screen))
            for r in plan.copies { tx.put(r) }
        }
        return plan.screen.id
    }

    /// A drawn record's box on its page (page units), for what is copied.
    nonisolated static func bounds(of r: BoardRecord) -> Box? {
        switch r {
        case .stroke(let s):
            guard !s.points.isEmpty else { return nil }
            var x0 = Double.infinity, y0 = Double.infinity, x1 = -Double.infinity, y1 = -Double.infinity
            for p in s.points {
                let v = s.pagePoint(p)
                x0 = min(x0, v.x)
                y0 = min(y0, v.y)
                x1 = max(x1, v.x)
                y1 = max(y1, v.y)
            }
            return Box(x: x0, y: y0, w: x1 - x0, h: y1 - y0)
        case .math(let m): return Box(x: m.x, y: m.y, w: m.w, h: m.h)
        case .image(let i): return Box(x: i.x, y: i.y, w: i.w, h: i.h)
        default: return nil
        }
    }
}
