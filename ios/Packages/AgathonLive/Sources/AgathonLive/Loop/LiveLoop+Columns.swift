import AgathonBoard
import AgathonBrain
import Foundation

/// What the columns know besides the kid's lines (the web's `LiveLoop.columnOptions`,
/// `problemEquations`, `rememberProblems`; src/lib/live/liveLoop.ts), handed to the brain's flush:
///
///  - the chat's problems on the screen (`chatCells`; a problem page's cell is the whole page): the
///    work in one cell is one problem whatever blank gap is in it — a tall fraction written a guide
///    line further down used to start a column of its own, judged with nothing above it — ink beside
///    one problem is never one line with ink under another, and the strays under one are no line
///    (taps of the pen, an answer's `=` before its number, her own tick after it: `strays.ts`);
///  - the tutor's one-line equations: a bar the kid draws under one with a number under it is "divide
///    both sides" (`\div 3`);
///  - the lines that were one problem at the last flush stay one (`problemMates`).
extension LiveLoop {
    func clusterContext() -> (cells: [ProblemCell], equations: [BrainRect], mates: [[String]]) {
        let chat = chatCells()
        var cells = chat.map { ProblemCell(key: $0.key, lines: $0.lines, head: $0.head, cell: $0.cell) }
        // a problem page of the kid's own (no problem of the tutor's on it): the page is the problem's
        // cell, its first line written in the problem area the problem (`ownPageCell`)
        if cells.isEmpty, let own = ownPageCell() { cells = [own] }
        let equations = chat.filter { c in
            c.lines.count == 1 && c.lines[0].range(of: #"=|<|>|\\[lg]eq?(?![a-zA-Z])"#, options: .regularExpression) != nil
        }.map(\.head)
        var mates: [[String]] = []
        var seen = Set<String>()
        for id in problemMates.keys.sorted() where !seen.contains(id) {
            let group = ([id] + (problemMates[id] ?? []).sorted())
            group.forEach { seen.insert($0) }
            if group.count > 1 { mates.append(group) }
        }
        return (cells, equations, mates)
    }

    /// A problem page with no problem of the tutor's on it: the whole page as one cell, its problem the
    /// kid's own (what is written in the problem area). Her problem and its work were cut in two by the
    /// blank under the problem area (`op-alg-ok`: `3x = 15` judged with nothing above it, never ticked).
    func ownPageCell() -> ProblemCell? {
        guard let page = board.currentProblemPage, page.kind == .problem, heads.isEmpty else { return nil }
        let rect = board.screenRect.box
        let L = ProblemPageLayout.self
        let head = ProblemPageLayout.place(AgathonBoard.Box(x: L.problemOrigin.x, y: L.problemOrigin.y, w: L.problemMaxX - L.problemOrigin.x, h: L.problemMinBottom - L.problemOrigin.y), on: rect)
        let cell = ProblemPageLayout.place(AgathonBoard.Box(x: 40, y: 40, w: 1520, h: 840), on: rect)
        return ProblemCell(key: "page:\(board.currentScreenID.rawValue)", lines: [], head: BrainRect(x: head.x, y: head.y, w: head.w, h: head.h),
                           cell: BrainRect(x: cell.x, y: cell.y, w: cell.w, h: cell.h))
    }

    /// Remembers which lines are one problem now (one column), and forgets the lines that are gone.
    func rememberProblems(_ lines: [InkLine]) {
        let ids = Set(lines.map(\.id))
        for (id, mates) in problemMates {
            problemMates[id] = ids.contains(id) ? mates.intersection(ids) : nil
        }
        for (_, column) in Dictionary(grouping: lines, by: \.column) where column.count >= 2 {
            let all = Set(column.map(\.id))
            for l in column { problemMates[l.id, default: []].formUnion(all.subtracting([l.id])) }
        }
    }

    /// The answer spot's line put in the work above it on a page of the kid's own (`answerSpotColumns`),
    /// the columns numbered again left to right, the rows top to bottom.
    func joinAnswerSpot(_ input: [InkLine]) -> [InkLine] {
        let columns = answerSpotColumns(input)
        guard columns != input.map(\.column) else { return input }
        var groups: [Int: [InkLine]] = [:]
        for (i, l) in input.enumerated() { groups[columns[i], default: []].append(l) }
        let order = groups.keys.sorted { a, b in
            let ax = groups[a]!.map(\.bounds.x).min() ?? 0, bx = groups[b]!.map(\.bounds.x).min() ?? 0
            return ax != bx ? ax < bx : (groups[a]!.map(\.bounds.y).min() ?? 0) < (groups[b]!.map(\.bounds.y).min() ?? 0)
        }
        var out: [InkLine] = []
        for (c, key) in order.enumerated() {
            for (row, line) in groups[key]!.sorted(by: { ($0.bounds.y, $0.bounds.x) < ($1.bounds.y, $1.bounds.x) }).enumerated() {
                var l = line
                l.column = c
                l.row = row
                out.append(l)
            }
        }
        return out
    }

    /// On a problem page, the brain's columns with the answer spot's line put in the work above it: the
    /// answer is that work's last step (a slip ringed above it is what it carried on from), not a
    /// problem of its own judged with nothing above it. The column of the work's lowest line above it.
    func answerSpotColumns(_ input: [InkLine]) -> [Int] {
        var columns = input.map(\.column)
        let answers = input.indices.filter { inAnswerSpot(input[$0].bounds) }
        guard !answers.isEmpty else { return columns }
        let work = input.indices.filter { !answers.contains($0) }
        for i in answers {
            let above = work.filter { input[$0].bounds.maxY <= input[i].bounds.y + input[i].bounds.h * 0.5 }
            if let last = above.max(by: { input[$0].bounds.maxY < input[$1].bounds.maxY }) { columns[i] = input[last].column }
        }
        return columns
    }
}
