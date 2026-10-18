import Foundation

/// A graph's functions, evaluated natively: the subset of mathjs's syntax the engine writes into a
/// `graph` record's `expr` (`node.toString()` of a parsed expression in `x`): numbers, `x`, `pi`,
/// `e`, `+ - * / ^ !`, `mod`, implicit multiplication (`2 x`, `2(x + 1)`), and mathjs's functions
/// (`sqrt`, `abs`, `log(x, b)`, `nthRoot`, trig and the rest). The web compiles the same strings with
/// mathjs (src/lib/live/engine/graph.ts, `compileExpr`); this follows mathjs's precedence, including
/// its "rule 2" (`1 / 2 x` is `(1 / 2) x`).
///
/// Like `compileExpr`, an expression with any other free symbol does not compile (nil), and a value
/// that is not a real number (a complex root, a pole) samples as NaN.
public enum MathExpr {
    public typealias Sampler = @Sendable (Double) -> Double

    public enum ParseError: Error, Equatable {
        case unexpected(String)
        case unknownSymbol(String)
        case unknownFunction(String)
        case end
    }

    indirect enum Node: Equatable {
        case number(Double)
        case x
        case negate(Node)
        case binary(Character, Node, Node)
        case call(String, [Node])
        case factorial(Node)
    }

    // MARK: - Compile (cached)

    private static let lock = NSLock()
    nonisolated(unsafe) private static var cache: [String: Sampler?] = [:]

    /// A sampler for `expr` in `x`, or nil when it does not parse or uses another symbol.
    public static func compile(_ expr: String) -> Sampler? {
        lock.lock()
        if let hit = cache[expr] {
            lock.unlock()
            return hit
        }
        lock.unlock()
        let made: Sampler?
        if let node = try? parse(expr) {
            made = { x in evaluate(node, x) }
        } else {
            made = nil
        }
        lock.lock()
        if cache.count > 512 { cache.removeAll() }
        cache[expr] = made
        lock.unlock()
        return made
    }

    /// The value of `expr` at `x` (NaN when it does not compile).
    public static func evaluate(_ expr: String, x: Double) -> Double {
        compile(expr)?(x) ?? .nan
    }

    // MARK: - Evaluate

    static func evaluate(_ n: Node, _ x: Double) -> Double {
        switch n {
        case .number(let v): return v
        case .x: return x
        case .negate(let a): return -evaluate(a, x)
        case .factorial(let a):
            let v = evaluate(a, x)
            if v < 0 && v == v.rounded() { return .nan }
            return tgamma(v + 1)
        case .binary(let op, let a, let b):
            let l = evaluate(a, x), r = evaluate(b, x)
            switch op {
            case "+": return l + r
            case "-": return l - r
            case "*": return l * r
            case "/": return l / r
            case "^": return power(l, r)
            case "%":
                // mathjs `mod`: the result takes the divisor's sign
                if r == 0 { return l }
                let m = fmod(l, r)
                return m != 0 && (m < 0) != (r < 0) ? m + r : m
            default: return .nan
            }
        case .call(let name, let args):
            let v = args.map { evaluate($0, x) }
            return call(name, v)
        }
    }

    /// mathjs's power on reals: a negative base with a fractional exponent is complex (NaN here).
    static func power(_ a: Double, _ b: Double) -> Double {
        if a < 0 && b != b.rounded() { return .nan }
        return pow(a, b)
    }

    static let functions: [String: ClosedRange<Int>] = [
        "sin": 1...1, "cos": 1...1, "tan": 1...1, "sec": 1...1, "csc": 1...1, "cot": 1...1,
        "asin": 1...1, "acos": 1...1, "atan": 1...1, "asec": 1...1, "acsc": 1...1, "acot": 1...1,
        "sinh": 1...1, "cosh": 1...1, "tanh": 1...1, "asinh": 1...1, "acosh": 1...1, "atanh": 1...1,
        "sqrt": 1...1, "cbrt": 1...1, "abs": 1...1, "exp": 1...1, "expm1": 1...1,
        "log": 1...2, "ln": 1...1, "log10": 1...1, "log2": 1...1, "log1p": 1...1,
        "nthRoot": 1...2, "pow": 2...2, "floor": 1...1, "ceil": 1...1, "round": 1...1, "fix": 1...1,
        "sign": 1...1, "max": 1...16, "min": 1...16, "factorial": 1...1, "gamma": 1...1,
        "atan2": 2...2, "mod": 2...2, "square": 1...1, "cube": 1...1, "hypot": 1...16,
    ]

    static func call(_ name: String, _ v: [Double]) -> Double {
        let a = v.first ?? .nan
        func realOrNaN(_ r: Double) -> Double { r.isNaN ? .nan : r }
        switch name {
        case "sin": return sin(a)
        case "cos": return cos(a)
        case "tan": return tan(a)
        case "sec": return 1 / cos(a)
        case "csc": return 1 / sin(a)
        case "cot": return 1 / tan(a)
        case "asin": return abs(a) <= 1 ? asin(a) : .nan
        case "acos": return abs(a) <= 1 ? acos(a) : .nan
        case "atan": return atan(a)
        case "asec": return abs(a) >= 1 ? acos(1 / a) : .nan
        case "acsc": return abs(a) >= 1 ? asin(1 / a) : .nan
        case "acot": return a == 0 ? .pi / 2 : atan(1 / a)
        case "sinh": return sinh(a)
        case "cosh": return cosh(a)
        case "tanh": return tanh(a)
        case "asinh": return asinh(a)
        case "acosh": return a >= 1 ? acosh(a) : .nan
        case "atanh": return abs(a) < 1 ? atanh(a) : (abs(a) == 1 ? a * .infinity : .nan)
        case "sqrt": return a >= 0 ? a.squareRoot() : .nan
        case "cbrt": return cbrt(a)
        case "abs": return abs(a)
        case "exp": return exp(a)
        case "expm1": return expm1(a)
        case "square": return a * a
        case "cube": return a * a * a
        case "log":
            if v.count == 2 { return a > 0 && v[1] > 0 ? log(a) / log(v[1]) : .nan }
            return a > 0 ? log(a) : (a == 0 ? -.infinity : .nan)
        case "ln": return a > 0 ? log(a) : (a == 0 ? -.infinity : .nan)
        case "log10": return a > 0 ? log10(a) : (a == 0 ? -.infinity : .nan)
        case "log2": return a > 0 ? log2(a) : (a == 0 ? -.infinity : .nan)
        case "log1p": return a > -1 ? log1p(a) : (a == -1 ? -.infinity : .nan)
        case "nthRoot":
            let n = v.count == 2 ? v[1] : 2
            if n == 0 { return .nan }
            if a < 0 {
                // a real odd root of a negative number, as mathjs's nthRoot gives
                guard n == n.rounded(), Int(n) % 2 != 0 else { return .nan }
                return -pow(-a, 1 / n)
            }
            return pow(a, 1 / n)
        case "pow": return power(a, v[1])
        case "floor": return floor(a)
        case "ceil": return ceil(a)
        case "round": return a.rounded(.toNearestOrAwayFromZero)
        case "fix": return a.rounded(.towardZero)
        case "sign": return a > 0 ? 1 : a < 0 ? -1 : 0
        case "max": return v.max() ?? .nan
        case "min": return v.min() ?? .nan
        case "factorial": return a < 0 && a == a.rounded() ? .nan : tgamma(a + 1)
        case "gamma": return realOrNaN(tgamma(a))
        case "atan2": return atan2(a, v[1])
        case "mod": return evaluate(.binary("%", .number(a), .number(v[1])), 0)
        case "hypot": return v.reduce(0) { ($0 * $0 + $1 * $1).squareRoot() }
        default: return .nan
        }
    }

    // MARK: - Parse (mathjs's grammar, the parts the engine writes)

    enum Token: Equatable {
        case number(Double)
        case symbol(String)
        case op(Character)
        case end
    }

    static func tokenize(_ s: String) throws -> [Token] {
        var out: [Token] = []
        let chars = Array(s)
        var i = 0
        while i < chars.count {
            let c = chars[i]
            if c.isWhitespace {
                i += 1
                continue
            }
            if c.isNumber || (c == "." && i + 1 < chars.count && chars[i + 1].isNumber) {
                var j = i
                while j < chars.count, chars[j].isNumber || chars[j] == "." { j += 1 }
                // an exponent: 1e-7, 2.5E3
                if j < chars.count, chars[j] == "e" || chars[j] == "E" {
                    var k = j + 1
                    if k < chars.count, chars[k] == "+" || chars[k] == "-" { k += 1 }
                    if k < chars.count, chars[k].isNumber {
                        while k < chars.count, chars[k].isNumber { k += 1 }
                        j = k
                    }
                }
                guard let v = Double(String(chars[i..<j])) else { throw ParseError.unexpected(String(chars[i..<j])) }
                out.append(.number(v))
                i = j
                continue
            }
            if c.isLetter || c == "_" {
                var j = i
                while j < chars.count, chars[j].isLetter || chars[j].isNumber || chars[j] == "_" { j += 1 }
                out.append(.symbol(String(chars[i..<j])))
                i = j
                continue
            }
            if "+-*/^!(),%".contains(c) {
                out.append(.op(c))
                i += 1
                continue
            }
            throw ParseError.unexpected(String(c))
        }
        out.append(.end)
        return out
    }

    static func parse(_ s: String) throws -> Node {
        var p = Parser(tokens: try tokenize(s))
        let n = try p.parseAdd()
        guard p.peek == .end else { throw ParseError.unexpected("\(p.peek)") }
        return n
    }

    struct Parser {
        let tokens: [Token]
        var i = 0

        var peek: Token { tokens[i] }
        mutating func next() -> Token {
            defer { i += 1 }
            return tokens[i]
        }

        // + -
        mutating func parseAdd() throws -> Node {
            var n = try parseMultiply()
            while case .op(let c) = peek, c == "+" || c == "-" {
                _ = next()
                n = .binary(c, n, try parseMultiply())
            }
            return n
        }

        // * / mod (explicit), over implicit multiplication
        mutating func parseMultiply() throws -> Node {
            var n = try parseImplicit()
            while true {
                if case .op(let c) = peek, c == "*" || c == "/" || c == "%" {
                    _ = next()
                    n = .binary(c, n, try parseImplicit())
                } else if case .symbol("mod") = peek {
                    _ = next()
                    n = .binary("%", n, try parseImplicit())
                } else {
                    return n
                }
            }
        }

        // `2 x`, `2(x + 1)`, `(x + 1)(x - 1)`, `x sin(x)`
        mutating func parseImplicit() throws -> Node {
            var n = try parseRule2()
            var last = n
            while true {
                let more: Bool
                switch peek {
                case .symbol(let s): more = s != "mod"
                case .op("("): more = true
                case .number:
                    // a number after anything but a constant (mathjs: `x 2` is x·2, `2 3` is not allowed)
                    if case .number = last { more = false } else { more = true }
                default: more = false
                }
                guard more else { return n }
                last = try parseRule2()
                n = .binary("*", n, last)
            }
        }

        // mathjs's "rule 2": `number / number symbol` divides before multiplying
        mutating func parseRule2() throws -> Node {
            var n = try parseUnary()
            var last = n
            while case .op("/") = peek, Self.isConstant(last) {
                guard case .number = tokens[i + 1] else { break }
                let after = tokens[i + 2]
                let symbolOrParen: Bool
                if case .symbol(let s) = after { symbolOrParen = s != "mod" } else { symbolOrParen = after == .op("(") }
                guard symbolOrParen else { break }
                _ = next() // "/"
                last = try parseUnary()
                n = .binary("/", n, last)
            }
            return n
        }

        static func isConstant(_ n: Node) -> Bool {
            switch n {
            case .number: return true
            case .negate(let a): return isConstant(a)
            default: return false
            }
        }

        mutating func parseUnary() throws -> Node {
            if case .op(let c) = peek, c == "-" || c == "+" {
                _ = next()
                let a = try parseUnary()
                return c == "-" ? .negate(a) : a
            }
            return try parsePow()
        }

        // ^ is right-associative and binds tighter than a unary minus on its left (-x^2 = -(x^2))
        mutating func parsePow() throws -> Node {
            let base = try parseFactorial()
            if case .op("^") = peek {
                _ = next()
                return .binary("^", base, try parseUnary())
            }
            return base
        }

        mutating func parseFactorial() throws -> Node {
            var n = try parsePrimary()
            while case .op("!") = peek {
                _ = next()
                n = .factorial(n)
            }
            return n
        }

        mutating func parsePrimary() throws -> Node {
            switch next() {
            case .number(let v):
                return .number(v)
            case .op("("):
                let n = try parseAdd()
                guard next() == .op(")") else { throw ParseError.unexpected(")") }
                return n
            case .symbol(let s):
                if case .op("(") = peek {
                    guard let arity = MathExpr.functions[s] else { throw ParseError.unknownFunction(s) }
                    _ = next()
                    var args: [Node] = []
                    if peek != .op(")") {
                        args.append(try parseAdd())
                        while case .op(",") = peek {
                            _ = next()
                            args.append(try parseAdd())
                        }
                    }
                    guard next() == .op(")") else { throw ParseError.unexpected(")") }
                    guard arity.contains(args.count) else { throw ParseError.unexpected("\(s) with \(args.count) arguments") }
                    return .call(s, args)
                }
                switch s {
                case "x": return .x
                case "pi", "PI": return .number(.pi)
                case "e", "E": return .number(M_E)
                case "Infinity": return .number(.infinity)
                case "tau": return .number(2 * .pi)
                case "phi": return .number((1 + 5.0.squareRoot()) / 2)
                default: throw ParseError.unknownSymbol(s)
                }
            case .end:
                throw ParseError.end
            case let t:
                throw ParseError.unexpected("\(t)")
            }
        }
    }
}
