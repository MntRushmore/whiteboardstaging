import Foundation

/// The comparison: what the tutor did with each line against what a teacher wants, and the reason a
/// line failed in words the owner can act on ("Misread: wrote 431, read 481"). Pure: the bench, the
/// regression fixtures' replay and the tests all judge through it.
public enum TrainingJudge {
    /// Judges one observed line against its expectation. Sets `pass`, `why` and `readRight`.
    public static func judge(_ line: TrainingLineResult) -> TrainingLineResult {
        var out = line
        if let read = line.read { out.readRight = sameMaths(read, line.meaning) } else { out.readRight = nil }
        guard let expect = line.expect else {
            out.pass = nil
            out.why = nil
            return out
        }
        let misread = out.readRight == false
        let readWords = line.read.map { "read \(show($0))" } ?? "never read"
        // the tutor's lines this written line became
        if line.pieces == 0 {
            out.pass = false
            out.why = line.read == nil
                ? TrainingWhy(.unread, "The tutor never read this line (\(show(line.written))).")
                : TrainingWhy(.merged, "Taken together with another line: \(readWords).")
            return out
        }
        if line.pieces > 1 {
            out.pass = false
            out.why = TrainingWhy(.split, "One line taken as \(line.pieces) lines (\(show(line.written))).")
            return out
        }
        if expect.accepts(line.mark) {
            // ringed, and the tutor says what it should be: the right value?
            if expect == .ring, let value = line.value, let result = line.result, !result.isEmpty, !sameMaths(result, value), !result.contains(flat(value)) {
                out.pass = false
                out.why = TrainingWhy(.wrongValue, "Ringed, but the tutor's value is \(show(result)); the right one is \(show(value)).")
                return out
            }
            out.pass = true
            out.why = nil
            return out
        }
        out.pass = false
        let wrote = "wrote \(show(line.written)), \(readWords)"
        if line.mark == .question || (line.read ?? "").isEmpty {
            out.why = TrainingWhy(.unread, "A question mark: the tutor could not read it (\(wrote)).")
        } else if !line.released && line.mark == .none {
            out.why = TrainingWhy(.held, "Never checked: it was still held when the page was checked (\(wrote)).")
        } else if expect == .ring && line.reading == "asking" {
            out.why = TrainingWhy(.asked, "Asked \"Is this right?\" instead of ringing (\(wrote)).")
        } else if misread {
            out.why = TrainingWhy(.misread, "Misread: \(wrote); \(line.mark.words) where \(expect.words) belongs.")
        } else if line.mark == .ring {
            out.why = TrainingWhy(.wrongRing, "Ringed right work: \(show(line.meaning)) wants \(expect.words).")
        } else if expect == .ring {
            out.why = TrainingWhy(.missedRing, "Missed the slip: \(show(line.meaning)) got \(line.mark.words).")
        } else {
            out.why = TrainingWhy(.wrongMark, "\(line.mark.words.capitalizedFirst) where \(expect.words) belongs (\(show(line.meaning))).")
        }
        return out
    }

    /// Judges a whole case: every line, then the page's own outcome (solved or not).
    public static func judge(lines: [TrainingLineResult], solvedExpected: Bool?, solvedGot: Bool) -> (lines: [TrainingLineResult], pass: Bool?, why: TrainingWhy?) {
        let judged = lines.map(judge)
        let lineVerdicts = judged.compactMap(\.pass)
        guard !lineVerdicts.isEmpty || solvedExpected != nil else { return (judged, nil, nil) }
        var why: TrainingWhy?
        if let expected = solvedExpected, expected != solvedGot {
            why = expected
                ? TrainingWhy(.notSolved, "The page's problem was answered but not counted solved.")
                : TrainingWhy(.falselySolved, "The page was counted solved, but its answer is wrong.")
        }
        let pass = lineVerdicts.allSatisfy { $0 } && why == nil
        return (judged, pass, why)
    }

    // MARK: - reads

    /// The same maths as written, give or take how it is spelled: spacing, braces, `\left`/`\right`,
    /// `\cdot` for `\times`, `\div`'s spellings, a trailing full stop.
    public static func sameMaths(_ a: String, _ b: String) -> Bool {
        flat(a) == flat(b)
    }

    /// A reading reduced to what it says (the comparison's form).
    public static func flat(_ latex: String) -> String {
        var s = latex
        let words: [(String, String)] = [
            ("\\left", ""), ("\\right", ""), ("\\displaystyle", ""), ("\\mathrm", ""), ("\\text", ""), ("\\operatorname", ""),
            ("\\quad", ""), ("\\qquad", ""), ("\\,", ""), ("\\;", ""), ("\\:", ""), ("\\!", ""), ("~", ""),
            ("\\cdot", "*"), ("\\times", "*"), ("×", "*"), ("\\div", "/"), ("÷", "/"), ("\\dfrac", "\\frac"), ("\\tfrac", "\\frac"),
            ("−", "-"), ("–", "-"), ("\\leq", "≤"), ("\\le", "≤"), ("\\geq", "≥"), ("\\ge", "≥"), ("\\checkmark", "✓"),
            ("{", ""), ("}", ""), (" ", ""),
        ]
        for (from, to) in words { s = s.replacingOccurrences(of: from, with: to) }
        while s.hasSuffix(".") || s.hasSuffix(",") { s.removeLast() }
        return s
    }

    /// LaTeX as the results screen shows it inline.
    static func show(_ latex: String) -> String {
        let t = latex.trimmingCharacters(in: .whitespaces)
        return t.isEmpty ? "(nothing)" : t
    }
}

extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}

/// A run's numbers: totals, accuracy by category / hand / grade / handwriting style, latency, cost.
public struct TrainingSummary: Sendable, Equatable {
    public struct Bucket: Sendable, Equatable, Identifiable {
        public var name: String
        public var cases: Int
        public var passed: Int
        public var lines: Int
        public var linesPassed: Int
        public var id: String { name }
        /// lines right, 0…1 (nil with none judged)
        public var lineRate: Double? { lines > 0 ? Double(linesPassed) / Double(lines) : nil }
        public var caseRate: Double? { cases > 0 ? Double(passed) / Double(cases) : nil }
    }

    /// cases judged (a My Pencil page counts once any of its lines is reviewed)
    public var cases = 0
    public var passed = 0
    public var lines = 0
    public var linesPassed = 0
    /// reads that were the maths written, of reads checked
    public var readsRight = 0
    public var readsChecked = 0
    public var byCategory: [Bucket] = []
    public var byHand: [Bucket] = []
    public var byGrade: [Bucket] = []
    /// why lines failed, most first
    public var reasons: [(code: TrainingWhy.Code, count: Int)] = []
    /// pen up → read (ms)
    public var readP50: Double?
    public var readP90: Double?
    /// Check → the last mark (ms)
    public var checkP50: Double?
    public var checkP90: Double?
    /// calls to the server by route, and what they would have cost in ink
    public var calls: [String: Int] = [:]
    public var ink = 0
    /// rings on right work, missed slips
    public var wrongRings = 0
    public var missedRings = 0

    public init() {}

    public init(_ results: [TrainingCaseResult]) {
        var cat: [String: Bucket] = [:]
        var hand: [String: Bucket] = [:]
        var grade: [String: Bucket] = [:]
        var why: [TrainingWhy.Code: Int] = [:]
        var readMs: [Double] = []
        var checkMs: [Double] = []
        func add(_ map: inout [String: Bucket], _ key: String, _ r: TrainingCaseResult, judged: [TrainingLineResult]) {
            var b = map[key] ?? Bucket(name: key, cases: 0, passed: 0, lines: 0, linesPassed: 0)
            if let p = r.pass {
                b.cases += 1
                if p { b.passed += 1 }
            }
            b.lines += judged.count
            b.linesPassed += judged.filter { $0.pass == true }.count
            map[key] = b
        }
        for r in results {
            let judged = r.lines.filter { $0.pass != nil }
            if let p = r.pass {
                cases += 1
                if p { passed += 1 }
            }
            lines += judged.count
            linesPassed += judged.filter { $0.pass == true }.count
            for l in r.lines {
                if let right = l.readRight {
                    readsChecked += 1
                    if right { readsRight += 1 }
                }
                if let w = l.why, l.pass == false { why[w.code, default: 0] += 1 }
                if let ms = l.readMs { readMs.append(ms) }
                if l.why?.code == .wrongRing { wrongRings += 1 }
                if l.why?.code == .missedRing { missedRings += 1 }
            }
            if let w = r.why, r.pass == false, judged.allSatisfy({ $0.pass != false }) { why[w.code, default: 0] += 1 }
            if let c = r.checkMs { checkMs.append(c) }
            for (k, v) in r.calls { calls[k, default: 0] += v }
            add(&cat, r.category.title, r, judged: judged)
            add(&hand, r.hand, r, judged: judged)
            add(&grade, r.grade?.rawValue ?? "No grade", r, judged: judged)
        }
        let order = { (a: Bucket, b: Bucket) in a.lines != b.lines ? a.lines > b.lines : a.name < b.name }
        byCategory = cat.values.sorted(by: order)
        byHand = hand.values.sorted(by: order)
        byGrade = grade.values.sorted { $0.name < $1.name }
        reasons = why.map { ($0.key, $0.value) }.sorted { $0.count != $1.count ? $0.count > $1.count : $0.code.rawValue < $1.code.rawValue }
        readP50 = Self.percentile(readMs, 0.5)
        readP90 = Self.percentile(readMs, 0.9)
        checkP50 = Self.percentile(checkMs, 0.5)
        checkP90 = Self.percentile(checkMs, 0.9)
        ink = calls.reduce(0) { $0 + (Self.inkCost[$1.key] ?? 0) * $1.value }
    }

    public static func == (a: TrainingSummary, b: TrainingSummary) -> Bool {
        a.cases == b.cases && a.passed == b.passed && a.lines == b.lines && a.linesPassed == b.linesPassed && a.calls == b.calls
            && a.byCategory == b.byCategory && a.byHand == b.byHand && a.byGrade == b.byGrade && a.readP50 == b.readP50
    }

    /// What each route costs a student in ink (ROUTE_COSTS on the server): what the run would have
    /// spent without the training pass.
    public static let inkCost: [String: Int] = ["recognize": 1, "reread": 1, "setup": 2, "check": 3, "solve": 10]

    /// The p-th percentile (nearest rank), nil with nothing.
    public static func percentile(_ xs: [Double], _ p: Double) -> Double? {
        guard !xs.isEmpty else { return nil }
        let s = xs.sorted()
        let rank = Int((p * Double(s.count)).rounded(.up)) - 1
        return s[min(max(0, rank), s.count - 1)]
    }

    public var lineRate: Double? { lines > 0 ? Double(linesPassed) / Double(lines) : nil }
    public var caseRate: Double? { cases > 0 ? Double(passed) / Double(cases) : nil }
    public var readRate: Double? { readsChecked > 0 ? Double(readsRight) / Double(readsChecked) : nil }
    public var totalCalls: Int { calls.values.reduce(0, +) }
}
