import AgathonBrain
import Foundation

/// A bench run's cases: the catalogue's (cut by grade and category) and the brain's own practice
/// problems worked by the engine — each right, and with a slip put in on purpose — dealt out over the
/// hands chosen. Seeded: the same config, the same cases in the same hands.
public enum TrainingGenerator {
    /// One case to run, and the hand that writes it.
    public struct Planned: Sendable, Hashable, Identifiable {
        public var spec: TrainingCase
        public var hand: TrainingHand
        public var id: String { "\(spec.id)@\(hand.name)" }

        public init(spec: TrainingCase, hand: TrainingHand) {
            self.spec = spec
            self.hand = hand
        }
    }

    /// The practice skills each grade band is made of (the brain's `practice` generators).
    public static let skills: [TrainingGrade: [String]] = [
        .k2: ["add_within_20", "subtract_within_20", "add_within_100", "subtract_within_100"],
        .g34: ["add_subtract_within_1000", "times_tables", "division_facts", "multiply_by_tens", "multiply_multi_digit"],
        .g56: ["add_fractions_unlike", "multiply_fractions", "decimals_add_subtract", "decimals_multiply", "percents"],
        .g78: ["negative_numbers", "order_of_operations", "one_step_equations", "two_step_equations", "multi_step_equations"],
        .hs: ["quadratic_equations", "systems", "exponent_rules", "inequalities"],
    ]

    /// The cases for `config`: up to `config.count`, catalogue first in a seeded order, the brain's
    /// practice problems mixed in (about a quarter) when asked.
    public static func plan(_ config: TrainingConfig, brain: Brain) async -> [Planned] {
        let hands = config.hands.compactMap(TrainingHand.named).nonEmpty ?? [.clean]
        let grades = Set(config.grades)
        let categories = Set(config.categories)
        var rng = SplitMix(seed: UInt64(truncatingIfNeeded: config.seed &* 2_654_435_761 &+ 17))
        var pool = TrainingCatalogue.all.filter { grades.contains($0.grade) && categories.contains($0.category) }
        if !config.includeWrong { pool = pool.filter { !$0.wrong } }
        pool.shuffle(using: &rng)
        var generated: [TrainingCase] = []
        if config.includeGenerated && categories.contains(.generated) {
            let want = max(1, config.count / 4)
            generated = await practiceCases(grades: config.grades, count: want, seed: config.seed, includeWrong: config.includeWrong, brain: brain)
        }
        // interleave: about every fourth case a practice problem
        var picked: [TrainingCase] = []
        var g = generated.makeIterator()
        var c = pool.makeIterator()
        while picked.count < config.count {
            let wantGenerated = !generated.isEmpty && (picked.count % 4 == 3 || pool.isEmpty)
            if wantGenerated, let next = g.next() {
                picked.append(next)
            } else if let next = c.next() {
                picked.append(next)
            } else if let next = g.next() {
                picked.append(next)
            } else {
                break
            }
        }
        return picked.enumerated().map { i, spec in Planned(spec: spec, hand: hands[i % hands.count]) }
    }

    /// Practice problems from the brain (`practice`), worked by the engine (`localSolve`): the steps
    /// written as a kid would, the last in the answer spot; and the same with the answer off by one.
    public static func practiceCases(grades: [TrainingGrade], count: Int, seed: Int, includeWrong: Bool, brain: Brain) async -> [TrainingCase] {
        let skillList = grades.flatMap { g in (skills[g] ?? []).map { (g, $0) } }
        guard !skillList.isEmpty, count > 0 else { return [] }
        _ = try? await brain.load()
        var out: [TrainingCase] = []
        var attempt = 0
        while out.count < count && attempt < count * 4 {
            let (grade, skill) = skillList[attempt % skillList.count]
            let s = seed &* 1_000 &+ attempt
            attempt += 1
            guard let problem = (try? await brain.practice(skill: skill, count: 1, seed: s))?.first, !problem.isEmpty,
                  let worked = await workedSteps(problem, brain: brain) else { continue }
            let wrong = includeWrong && out.count % 2 == 1
            if wrong, let slip = slipped(worked) {
                out.append(TrainingCase(id: "gen:\(skill):\(s):slip", category: .generated, grade: grade, topic: skill, problem: problem,
                                        lines: slip, solved: false, wrong: true, source: .practice))
            } else {
                var lines = worked.dropLast().map { TrainingLineSpec($0, .calm) }
                lines.append(TrainingLineSpec(worked.last!, .tick, place: .answer))
                out.append(TrainingCase(id: "gen:\(skill):\(s):right", category: .generated, grade: grade, topic: skill, problem: problem,
                                        lines: lines, solved: true, wrong: false, source: .practice))
            }
        }
        return out
    }

    /// The engine's worked steps for a problem, at most four, as a kid would write them; nil when the
    /// engine cannot work it without a model.
    public static func workedSteps(_ problem: [String], brain: Brain) async -> [String]? {
        guard let solved = try? await brain.localSolve(problem, options: LocalSolveOptions(handwriting: true, mode: .answer)),
              solved.source != nil else { return nil }
        var steps = solved.steps.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        if steps.isEmpty, let answer = solved.answer, !answer.isEmpty { steps = [answer] }
        guard !steps.isEmpty else { return nil }
        // the problem written again is not a step
        let first = TrainingJudge.flat(problem.joined())
        steps.removeAll { TrainingJudge.flat($0) == first }
        guard !steps.isEmpty else { return nil }
        return Array(steps.suffix(4))
    }

    /// The steps with the last one's last number off by one: ringed, with the right value.
    static func slipped(_ steps: [String]) -> [TrainingLineSpec]? {
        guard let last = steps.last, let (wrong, right) = bump(last) else { return nil }
        var lines = steps.dropLast().map { TrainingLineSpec($0, .calm) }
        lines.append(TrainingLineSpec(wrong, .ring, value: right, place: .answer))
        return lines
    }

    /// `latex` with its last whole number one more (`x = 4` → `x = 5`): the new line and the number
    /// it had. Nil without a number.
    public static func bump(_ latex: String) -> (String, String)? {
        let chars = Array(latex)
        var end = chars.count - 1
        while end >= 0 && !chars[end].isNumber { end -= 1 }
        guard end >= 0 else { return nil }
        var start = end
        while start > 0 && chars[start - 1].isNumber { start -= 1 }
        // a decimal's last digits: bump the digits after the point (3.6 → 3.7)
        guard let n = Int(String(chars[start...end])) else { return nil }
        let right = String(chars[start...end])
        let replaced = String(chars[..<start]) + String(n + 1) + String(chars[(end + 1)...])
        // the right value is the whole line's right side when it has one
        let rightValue: String
        if let eq = latex.lastIndex(of: "=") {
            rightValue = String(latex[latex.index(after: eq)...]).trimmingCharacters(in: .whitespaces)
        } else {
            rightValue = right == latex.trimmingCharacters(in: .whitespaces) ? right : latex.trimmingCharacters(in: .whitespaces)
        }
        return (replaced, rightValue)
    }
}

extension Array {
    var nonEmpty: [Element]? { isEmpty ? nil : self }
}
