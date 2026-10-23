import Foundation

/// A plot's `function` item: a JavaScript-style expression in x ("2*x+1", "x**2 - 3", "Math.sqrt(x)",
/// "0.5*x^2"), parsed once and evaluated at each x the figure draws. Numbers, x, + − * / ^ **,
/// brackets, unary minus, implicit products where JavaScript would need a `*` ("2x", "3(x+1)"), the
/// constants pi and e, and the usual functions (sqrt, abs, sin, cos, tan, log, ln, exp, floor, ceil,
/// round, min, max, pow). Anything else is no expression (nil): that item is not drawn.
public struct SATExpression: Sendable {
    indirect enum Node: Sendable {
        case number(Double)
        case x
        case unary(Character, Node)
        case binary(Character, Node, Node)
        case call(String, [Node])
    }

    let root: Node

    public init?(_ source: String) {
        var p = Parser(source)
        guard let node = p.parse() else { return nil }
        root = node
    }

    /// The value at `x` (NaN outside the function's domain).
    public func callAsFunction(_ x: Double) -> Double {
        Self.eval(root, x)
    }

    static func eval(_ n: Node, _ x: Double) -> Double {
        switch n {
        case .number(let v): return v
        case .x: return x
        case .unary(let op, let a): return op == "-" ? -eval(a, x) : eval(a, x)
        case .binary(let op, let a, let b):
            let l = eval(a, x), r = eval(b, x)
            switch op {
            case "+": return l + r
            case "-": return l - r
            case "*": return l * r
            case "/": return l / r
            case "^": return pow(l, r)
            default: return .nan
            }
        case .call(let name, let args):
            let v = args.map { eval($0, x) }
            func one(_ f: (Double) -> Double) -> Double { v.count == 1 ? f(v[0]) : .nan }
            switch name {
            case "sqrt": return one(Foundation.sqrt)
            case "abs": return one(Swift.abs)
            case "sin": return one(Foundation.sin)
            case "cos": return one(Foundation.cos)
            case "tan": return one(Foundation.tan)
            case "log": return one(Foundation.log10)
            case "ln": return one(Foundation.log)
            case "exp": return one(Foundation.exp)
            case "floor": return one(Foundation.floor)
            case "ceil": return one(Foundation.ceil)
            case "round": return one { Foundation.round($0) }
            case "min": return v.min() ?? .nan
            case "max": return v.max() ?? .nan
            case "pow": return v.count == 2 ? Foundation.pow(v[0], v[1]) : .nan
            default: return .nan
            }
        }
    }

    /// A recursive-descent parser: sum → product → unary → power → atom.
    struct Parser {
        let chars: [Character]
        var i = 0

        init(_ s: String) {
            // JavaScript's spellings first: Math.sqrt → sqrt, ** → ^, Math.PI → pi
            let t = s.replacingOccurrences(of: "Math.", with: "").replacingOccurrences(of: "**", with: "^")
                .replacingOccurrences(of: "PI", with: "pi").replacingOccurrences(of: "−", with: "-")
                .replacingOccurrences(of: "·", with: "*").replacingOccurrences(of: "×", with: "*")
            chars = Array(t.filter { !$0.isWhitespace })
        }

        mutating func parse() -> Node? {
            guard let n = sum(), i == chars.count else { return nil }
            return n
        }

        var peek: Character? { i < chars.count ? chars[i] : nil }

        mutating func sum() -> Node? {
            guard var left = product() else { return nil }
            while let c = peek, c == "+" || c == "-" {
                i += 1
                guard let right = product() else { return nil }
                left = .binary(c, left, right)
            }
            return left
        }

        mutating func product() -> Node? {
            guard var left = unary() else { return nil }
            while true {
                if let c = peek, c == "*" || c == "/" {
                    i += 1
                    guard let right = unary() else { return nil }
                    left = .binary(c, left, right)
                } else if let c = peek, c == "(" || c == "x" || c.isLetter || c.isNumber || c == "." {
                    // an implicit product: 2x, 3(x+1), x sqrt(x)
                    guard let right = power() else { return nil }
                    left = .binary("*", left, right)
                } else {
                    return left
                }
            }
        }

        /// A sign binds looser than a power: `-x^2` is −(x²), as on paper.
        mutating func unary() -> Node? {
            if let c = peek, c == "-" || c == "+" {
                i += 1
                guard let a = unary() else { return nil }
                return .unary(c, a)
            }
            return power()
        }

        mutating func power() -> Node? {
            guard let base = atom() else { return nil }
            if peek == "^" {
                i += 1
                // right-associative, and a signed exponent: 2^3^2 is 2^(3^2), 2^-1 is a half
                guard let exponent = unary() else { return nil }
                return .binary("^", base, exponent)
            }
            return base
        }

        mutating func atom() -> Node? {
            guard let c = peek else { return nil }
            if c == "(" {
                i += 1
                guard let inner = sum(), peek == ")" else { return nil }
                i += 1
                return inner
            }
            if c.isNumber || c == "." {
                var s = ""
                while let d = peek, d.isNumber || d == "." {
                    s.append(d)
                    i += 1
                }
                // 1e-3
                if peek == "e", i + 1 < chars.count, chars[i + 1].isNumber || chars[i + 1] == "-" {
                    s.append("e")
                    i += 1
                    if peek == "-" {
                        s.append("-")
                        i += 1
                    }
                    while let d = peek, d.isNumber {
                        s.append(d)
                        i += 1
                    }
                }
                return Double(s).map(Node.number)
            }
            if c.isLetter {
                var name = ""
                while let d = peek, d.isLetter {
                    name.append(d)
                    i += 1
                }
                switch name {
                case "x": return .x
                case "pi": return .number(Double.pi)
                case "e": return .number(M_E)
                default:
                    guard peek == "(" else {
                        // "xx" or "2xe": a run of letters that is products of x, pi and e
                        return Self.letters(name)
                    }
                    i += 1
                    var args: [Node] = []
                    if peek != ")" {
                        while true {
                            guard let a = sum() else { return nil }
                            args.append(a)
                            if peek == "," {
                                i += 1
                                continue
                            }
                            break
                        }
                    }
                    guard peek == ")" else { return nil }
                    i += 1
                    return .call(name.lowercased(), args)
                }
            }
            return nil
        }

        /// A run of single letters as a product ("xx" → x·x); nil when one is not x or e.
        static func letters(_ name: String) -> Node? {
            var node: Node?
            for ch in name {
                let n: Node
                switch ch {
                case "x": n = .x
                case "e": n = .number(M_E)
                default: return nil
                }
                node = node.map { .binary("*", $0, n) } ?? n
            }
            return node
        }
    }
}
