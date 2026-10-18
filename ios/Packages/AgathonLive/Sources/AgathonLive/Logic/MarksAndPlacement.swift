import AgathonBoard
import AgathonBrain
import Foundation

/// The tutor's marks as the loop keys and places them (src/lib/live/marks.ts). The strokes
/// themselves are AgathonBoard's `TutorMarks` (the same geometry and seeded wobble as the web's).
public enum LiveMarks {
    /// What a mark is, in the loop's words; `TutorMarks` draws `tick`, `ring`, `question`.
    public enum Kind: String, Sendable, Equatable {
        case check, circle, question

        var board: AgathonBoard.MarkKind {
            switch self {
            case .check: return .tick
            case .circle: return .ring
            case .question: return .question
            }
        }
    }

    /// A mark is redrawn only when its kind or its line's place changes (`markKey`: 4 px units).
    public static func key(_ kind: Kind, _ line: BrainRect) -> String {
        // JavaScript's Math.round: halves round up, towards +∞
        func r(_ n: Double) -> Int { Int(floor(n / 4 + 0.5)) }
        return "\(kind.rawValue):\(r(line.x)),\(r(line.y)),\(r(line.w)),\(r(line.h))"
    }

    /// The kind a key names.
    public static func kind(ofKey key: String) -> Kind? {
        guard let colon = key.firstIndex(of: ":") else { return nil }
        return Kind(rawValue: String(key[..<colon]))
    }

    /// The box the ring round `line` takes (for what is placed beside it).
    public static func ringRect(_ line: BrainRect) -> BrainRect {
        let (rx, ry) = TutorMarks.ringRadii(line.box)
        let cx = line.x + line.w / 2, cy = line.y + line.h / 2
        return BrainRect(x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2)
    }

    /// The page box a mark of this kind takes beside `line`.
    public static func markRect(_ kind: Kind, _ line: BrainRect) -> BrainRect {
        switch kind {
        case .circle:
            return ringRect(line)
        case .check, .question:
            let a = TutorMarks.anchor(line.box)
            return BrainRect(x: a.x, y: a.y, w: a.h * (kind == .check ? 0.9 : 0.55), h: a.h)
        }
    }

    /// The strokes for a mark, seeded as the web seeds them (`handSeedFor("<lineId>:<key>")`).
    public static func strokes(_ kind: Kind, line: BrainRect, lineId: String) -> [TutorStroke] {
        let seed = LiveSeeds.handSeed("\(lineId):\(key(kind, line))")
        return TutorMarks.strokes(kind.board, line: line.box, seed: seed)
    }
}

/// Seeds the web derives from text (`handSeedFor`: FNV-1a, 32 bits), so a re-render writes the same hand.
public enum LiveSeeds {
    public static func handSeed(_ key: String) -> UInt32 {
        var h: UInt32 = 2_166_136_261
        for unit in key.utf16 {
            h ^= UInt32(unit)
            h = h &* 16_777_619
        }
        return h
    }
}

/// Where the tutor's writing goes (src/lib/live/placement.ts), in page units.
public enum LivePlacement {
    public static let belowGapY = 12.0
    public static let viewportMargin = 16.0
    public static let slotStepX = 40.0
    public static let slotTries = 6
    public static let rowTries = 4
    public static let rowGap = 8.0
    public static let stepGap = 16.0
    public static let stepPitch = 52.0
    public static let sideGap = 48.0
    public static let answerGapFactor = 0.4
    public static let answerGapMin = 10.0

    /// The space before an answer the tutor writes on the kid's own line.
    public static func inlineAnswerGap(_ inkHeight: Double) -> Double {
        max(answerGapMin, (inkHeight * answerGapFactor).rounded())
    }

    /// A slot clear of `avoid`: `right` slides right in 40 px steps, then under the line; `below`
    /// goes straight under the line, then just under whatever is in the way.
    public static func findFreeSlot(_ candidate: BrainRect, avoid: [BrainRect], line: BrainRect, prefer: Prefer = .right, scale: Double = 1) -> BrainRect {
        let belowGap = belowGapY * scale
        let rGap = rowGap * scale
        func free(_ r: BrainRect) -> Bool { !avoid.contains { $0.intersects(r) } }
        func below() -> BrainRect? {
            var r = BrainRect(x: prefer == .below ? candidate.x : line.x, y: max(candidate.y, line.maxY + belowGap), w: candidate.w, h: candidate.h)
            if prefer == .right { r.y = line.maxY + belowGap + candidate.h + rGap }
            let limit = line.maxY + belowGap + Double(rowTries) * (candidate.h + rGap)
            var k = 0
            while k < 12 && r.y <= limit {
                let hits = avoid.filter { $0.intersects(r) }
                if hits.isEmpty { return r }
                r.y = (hits.map(\.maxY).max() ?? r.y) + rGap
                k += 1
            }
            return nil
        }
        if prefer == .below {
            if free(candidate) { return candidate }
            return below() ?? candidate
        }
        for i in 0..<slotTries {
            var r = candidate
            r.x = candidate.x + Double(i) * slotStepX * scale
            if free(r) { return r }
        }
        return below() ?? candidate
    }

    public enum Prefer: Sendable { case right, below }

    /// A block that would run off the bottom of the screen moves beside the work instead.
    public static func keepOnScreen(_ rect: BrainRect, screen: BrainRect?, column: BrainRect, offsetY: Double = 0, sideGap: Double = LivePlacement.sideGap) -> BrainRect {
        guard let screen else { return rect }
        let bottom = screen.maxY - viewportMargin
        if rect.maxY <= bottom { return rect }
        let beside = BrainRect(x: column.maxX + sideGap, y: column.y + offsetY, w: rect.w, h: rect.h)
        if beside.maxX <= screen.maxX - viewportMargin && beside.maxY <= bottom { return beside }
        return rect
    }

    /// Slides `rect` left so it stays inside `bounds` on the right (never past its left edge).
    public static func keepInsideX(_ rect: BrainRect, bounds: BrainRect) -> BrainRect {
        let maxX = bounds.maxX - viewportMargin
        if rect.maxX <= maxX { return rect }
        var r = rect
        r.x = max(bounds.x + viewportMargin, maxX - rect.w)
        return r
    }

    /// The tutor's hand is bigger in page units on a board shown below zoom 1 (`inkScale`).
    public static func inkScale(_ zoom: Double?) -> Double {
        guard let zoom, zoom.isFinite, zoom > 0 else { return 1 }
        return min(6, max(1, 1 / zoom))
    }
}
