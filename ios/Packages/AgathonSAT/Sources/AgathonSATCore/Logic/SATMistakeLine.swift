import Foundation

/// The wrong-answer note's ring (docs/SAT-V2.md, "Wrong-answer diagnosis"; the design notes: "when
/// the tutor can find the line that made the mistake, it rings that line too"). A `why` that names the
/// mistake's maths ("use the rise, 31 − 19 = 12, as the slope") is matched against what the tutor read
/// on the page: a line rings only when it clearly carries that maths. Otherwise, no ring.
public enum SATMistakeLine {
    /// The relations a `why` states (`2x = 4`, `31 − 19 = 12`, `(2-0)/(0-4)`), as compared.
    public static func fragments(_ why: String) -> [String] {
        let text = why.replacingOccurrences(of: "$", with: " ").replacingOccurrences(of: "−", with: "-")
            .replacingOccurrences(of: "–", with: "-").replacingOccurrences(of: "×", with: "*")
        // maths runs: digits, letters standing alone, operators, brackets, an equals sign in it
        guard let re = try? NSRegularExpression(pattern: #"[0-9a-z()\[\]\.\+\-\*/\^ ]*[0-9a-z)\]]\s*=\s*[0-9a-z(\[\-][0-9a-z()\[\]\.\+\-\*/\^ ]*"#,
                                                options: [.caseInsensitive]) else { return [] }
        let ns = text as NSString
        return re.matches(in: text, range: NSRange(location: 0, length: ns.length)).compactMap { m in
            let raw = ns.substring(with: m.range).trimmingCharacters(in: CharacterSet(charactersIn: " .,;:"))
            // words are not maths: keep runs made of maths (single letters at most)
            let words = raw.split(whereSeparator: { !$0.isLetter }).filter { $0.count > 1 }
            guard words.isEmpty else { return nil }
            let k = SATHintLadder.key(raw)
            return k.count >= 4 ? k : nil
        }
    }

    /// The read line (its index in `lines`) that clearly carries the mistake: one of the `why`'s
    /// relations is the line, or the line's right side after its first `=`; nil when no line does (or
    /// more than one does: no guessing).
    public static func match(why: String, lines: [String]) -> Int? {
        let frags = fragments(why)
        guard !frags.isEmpty else { return nil }
        let keys = lines.map(SATHintLadder.key)
        let hits = keys.indices.filter { i in
            let k = keys[i]
            guard k.count >= 3 else { return false }
            return frags.contains { f in k == f || k.hasSuffix(f) || (k.contains(f) && f.count >= 6) }
        }
        return hits.count == 1 ? hits[0] : nil
    }
}

/// The walk-through's drawing on the figure (the design notes, frame 5: "a step that is about the
/// figure is also drawn ON the figure — the rise and the run as cobalt legs, their sizes as labels").
public enum SATWalkFigure {
    /// The two points a slope step works with: the plane's first two labelled points (left to right),
    /// when `step` is about the slope (it says slope, rise or run, or its maths is a difference over a
    /// difference). nil otherwise.
    public static func slopePoints(_ plot: SATPlot, step: SATSolution.Step) -> (SATPoint, SATPoint)? {
        let words = step.text.lowercased()
        let math = step.math ?? ""
        let aboutSlope = words.contains("slope") || words.contains("rise") || words.contains(" run")
            || math.range(of: #"\\frac\{[^{}]*-[^{}]*\}\{[^{}]*-[^{}]*\}"#, options: .regularExpression) != nil
        guard aboutSlope else { return nil }
        let points = plot.items.compactMap { item -> SATPoint? in
            if case .point(let at, let label, _) = item, label?.isEmpty == false { return at }
            return nil
        }
        guard points.count >= 2 else { return nil }
        let two = points.prefix(2).sorted { $0.x < $1.x }
        guard two[0].x != two[1].x else { return nil }
        return (two[0], two[1])
    }

    /// The run and the rise between them, as numbers the test writes ("2", "12").
    public static func legs(_ a: SATPoint, _ b: SATPoint) -> (run: String, rise: String) {
        (SATFigureMarks.number(abs(b.x - a.x)), SATFigureMarks.number(abs(b.y - a.y)))
    }
}
