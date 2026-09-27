# Courses: what the local engine covers

The skills of the high-school Algebra 1 and Algebra 2 courses (Common Core State Standards,
high school: N-RN, N-CN, A-SSE, A-APR, A-CED, A-REI, F-IF, F-BF, F-LE, S-ID), and whether Solve
answers them **locally** — exact, with teacher-style steps the tutor's hand writes, no words on
the board, and the student's own steps checked (a right step ✓, a wrong one ringed).

- **does it**: the engine writes the working and the answer; problems on the scoreboard pass.
- **partial**: the common forms are done; the gap is named.
- **not yet**: Solve asks the model (or, where noted, another engineer's work covers it).
- **n/a**: the standard is about explaining or interpreting in words — nothing for the board to
  compute. Word problems are set up by the model and solved by the engine (see
  `docs/ARCHITECTURE.md`, "Word problems").

Problems: `src/__eval__/courses/algebra1.ts`, `src/__eval__/courses/algebra2.ts` (plus the
original corpus's topics, each mapped to a course by `TOPIC_COURSE` in `src/__eval__/corpus.ts`).
Scoreboard: `docs/eval/offline.md`, section "By course". Engine: `src/lib/live/engine/courses.ts`
and the modules it routes to.

## Scoreboard by course

`npm run eval:offline`, the same corpus and judge before and after this work (before: the engine
at `0e1e1af`):

| course | problems | before | after |
| --- | --- | --- | --- |
| Algebra 1 | 176 (95 new) | 107 (61%) | **176 (100%)** |
| Algebra 2 | 135 (77 new) | 90 (67%) | **135 (100%)** |
| Precalculus / calculus | 100 | 100 (100%) | 100 (100%) |
| General (arithmetic, units) | 32 | 32 (100%) | 32 (100%) |
| Geometry (`src/__eval__/courses/geometry.ts`, merged from feat/geometry) | 153 | — | **153 (100%)** |
| **all** | 596 | — | **596 (100%)** |

## Algebra 1

| Standard | Skill | On the board (in → the answer) | Status |
| --- | --- | --- | --- |
| N-RN.1–2 | Rational exponents | `8^{\frac{2}{3}}` → `(\sqrt[3]{8})^{2}`, `2^{2}`, `4`; `27^{-\frac{1}{3}}` → `\frac{1}{3}` | does it |
| N-RN.2 | Simplify radicals, like radicals, products, rationalize | `\sqrt{50}` → `\sqrt{25 \cdot 2}`, `5\sqrt{2}`; `\sqrt{12} + \sqrt{27}` → `5\sqrt{3}`; `\frac{1}{\sqrt{2}}` → `\frac{\sqrt{2}}{2}` | does it (numbers; a letter under a root is not simplified — it needs \|x\|) |
| N-RN.3 | Rational + irrational is irrational | — | n/a |
| A-SSE.1 | Interpret parts of an expression | — | n/a |
| A-SSE.2 | Laws of exponents, one rule a line | `(2x^{3}y)^{2}` → `2^{2}x^{3 \cdot 2}y^{2}`, `4x^{6}y^{2}`; `\frac{12x^{5}y^{2}}{4x^{2}y^{5}}` → … `\frac{3x^{3}}{y^{3}}`; negative and zero exponents | does it |
| A-SSE.2 | Factoring (common factor, trinomials, difference of squares, grouping) | `2x^{2} + 7x + 3` → split and group → `(x + 3)(2x + 1)` | does it |
| A-SSE.3a | Factor a quadratic to find its zeros | `x^{2} - 5x + 6 = 0` → `(x - 2)(x - 3) = 0` → `x = 2, \ x = 3` | does it |
| A-SSE.3b | Complete the square (vertex form) | `(x + 3)^{2} = 16` solved by square roots | partial: an expression is never rewritten into vertex form (asking for it needs words) |
| A-SSE.3c | Rewrite exponentials (`1.15^{t} = (1.15^{\frac{1}{12}})^{12t}`) | — | not yet |
| A-APR.1 | Add, subtract, multiply polynomials | `(3x^{2} + 2x - 1) - (x^{2} - 4x + 5)` → `2x^{2} + 6x - 6` | does it |
| A-APR.3 | Zeros from factors | `(x - 3)(x + 4) = 0` → `x = -4, \ x = 3` | does it |
| A-CED.1 | Equations from a context | a word problem: the model writes the setup, the engine solves it | partial (the setup is a model's) |
| A-CED.2 | Lines: slope from two points, point-slope, slope-intercept | `(2, 3), (5, 9)` → `m = \frac{9 - 3}{5 - 2}`, `m = 2`, `y - 3 = 2(x - 2)`, `y = 2x - 1`; `m = 2`, `(1, 3)` → `y = 2x + 1`; `2x + 3y = 6`, `y = ?` → `y = -\frac{2}{3}x + 2` | does it |
| A-CED.2 | Intercepts | `3x + 4y = 12`, `y = 0` → `x = 4` | does it |
| A-CED.2 | Standard form from slope-intercept | — | not yet (no word-free way to ask for it) |
| A-CED.3 | Constraints | — | n/a |
| A-CED.4 | A formula solved for a letter | `A = \frac{1}{2}bh`, `h = ?` → `2A = bh`, `h = \frac{2A}{b}`; `A = P + Prt`, `P = ?` → `A = P(rt + 1)`, …; `A = \pi r^{2}`, `r = ?` → `r = \sqrt{\frac{A}{\pi}}` | does it (the letter linear once denominators are cleared, or once under a power / root / exp / log) |
| A-REI.1 | Explain each step | the student's steps checked line by line | does it |
| A-REI.3 | Linear equations and inequalities | `3(x + 2) = 21` → `3x + 6 = 21`, `3x = 15`, `x = 5` | does it |
| A-REI.4 | Quadratics: square roots, factoring, the formula | `x^{2} - 2x - 1 = 0` → … `x = 1 \pm \sqrt{2}` | does it (no real roots: `\varnothing`) |
| A-REI.5–6 | Systems of linear equations | substitution / elimination | does it |
| A-REI.7 | A line and a quadratic | `y = x^{2}`, `y = 2x + 3` → `x = -1, \ x = 3`, … | does it |
| A-REI.10–12 | Graphs of equations and inequalities | — | (graphing, in parallel) |
| F-IF.1–2 | Function notation, evaluating | `f(x) = 2x + 3`, `f(4) =` → `= 2(4) + 3`, `= 8 + 3`, `= 11`; `f(a + 1)` → `= 2a + 5`; `f(x) = 7` → `x = 2` | does it |
| F-IF.1 | Domain (a value outside it) | `f(x) = \frac{1}{x - 2}`, `f(2) =` → `= \frac{1}{2 - 2}`, `= \frac{1}{0}` (no value) | partial (only by evaluating there) |
| F-IF.4–5 | Key features from a graph or a context | — | n/a / (graphing) |
| F-IF.6 | Average rate of change | `\frac{f(4) - f(1)}{4 - 1} =` → `= 2` | does it |
| F-IF.8 | Rewrite to reveal features (vertex form) | — | not yet |
| F-BF.1–2 | Sequences: arithmetic and geometric, nth term, explicit from recursive | `3, 7, 11, \ldots`, `a_{10} = ?` → `d = 4`, `a_{10} = 3 + (10 - 1) \cdot 4`, …, `39`; `a_{1} = 2`, `a_{n} = a_{n - 1} + 5`, `a_{n} = ?` → `a_{n} = 5n - 3` | does it |
| F-BF.3 | Transformations | — | not yet (graphing) |
| F-LE.2 | Linear model from two points | the line through two points | does it |
| F-LE.2 | Exponential model through two points (`y = ab^{x}`) | — | not yet |
| F-LE.5 | Growth, decay, simple and compound interest | `A = P(1 + r)^{t}` with the values → `A = 1000(1 + 0.05)^{3}`, `A = 1000(1.05)^{3}`, …, `A = 1157.625`; compound interest `A \approx 1348.85` | does it (a value with no short decimal is written to the cent with ≈) |
| F-LE.5 | Percent change | `\frac{60 - 50}{50} \times 100 =` → `20` | does it (the value; no working) |
| S-ID.2 | Mean of a list | `3, 5, 7, 9, 11`, `\bar{x} = ?` → `\bar{x} = \frac{35}{5}`, `\bar{x} = 7` | does it |
| S-ID.2–3 | Median, IQR, standard deviation | — | not yet (no word-free notation on the board) |
| S-ID.6–7 | Lines of fit, correlation | — | not yet |

## Algebra 2

| Standard | Skill | On the board (in → the answer) | Status |
| --- | --- | --- | --- |
| N-CN.1–2 | i, i² = -1; add, subtract, multiply | `(2 + 3i)(1 - i)` → `2 - 2i + 3i - 3i^{2}`, `2 - 2i + 3i + 3`, `5 + i`; `i^{23}` → `(i^{4})^{5} \cdot i^{3}`, `i^{3}`, `-i`; `\sqrt{-4} \cdot \sqrt{-9}` → `-6` | does it |
| N-CN.3 | Conjugates, quotients, modulus | `\frac{2 + 3i}{1 - i}` → times `(1 + i)` … `-\frac{1}{2} + \frac{5}{2}i`; `\|3 + 4i\|` → `5` | does it |
| N-CN.7 | Quadratics with complex solutions | with `i` in the column: `x^{2} + 2x + 5 = 0` → … `x = \frac{-2 \pm 4i}{2}`, `x = -1 \pm 2i` | does it, **only when the column already uses i**; otherwise `\varnothing` (the owner's default — `src/lib/live/engine/complexSetting.ts`, setting `"never" \| "when-column-uses-i" \| "always"`, passed to `localSolve` as `complexRoots`) |
| A-SSE.4 | Finite geometric (and arithmetic) series; infinite geometric | `2, 6, 18, \ldots`, `S_{6} = ?` → `S_{6} = \frac{2(1 - 3^{6})}{1 - 3}`, …, `728`; `\sum_{n=1}^{10}(2n + 1)` → `= \frac{10}{2}(3 + 21)`, … `120`; `\sum_{n=1}^{\infty} 3(\frac{1}{2})^{n - 1}` → `6` | does it (\|r\| ≥ 1: no infinite sum written) |
| A-APR.2 | The remainder theorem | `P(x) = x^{3} - 2x^{2} + 4`, `P(3) =` → `= 3^{3} - 2(3)^{2} + 4`, `= 27 - 18 + 4`, `= 13` | does it |
| A-APR.3 | Zeros of a polynomial (rational roots) | `2x^{3} - 3x^{2} - 11x + 6` → `(x + 2)(2x - 1)(x - 3)`; quartics | does it |
| A-APR.4 | Polynomial identities | an identity the student writes is checked `ok` | partial (checked, not proved) |
| A-APR.5 | The binomial theorem | `(x + 2)^{4}` → `x^{4} + 4x^{3}(2) + 6x^{2}(2)^{2} + 4x(2)^{3} + 2^{4}`, `x^{4} + 8x^{3} + 24x^{2} + 32x + 16` | does it (powers 3–6) |
| A-APR.6 | Long division | `\frac{x^{3} - 2x^{2} + 4}{x - 3}` → the dividend rewritten one quotient term at a time … `x^{2} + x + 3 + \frac{13}{x - 3}` | does it; synthetic division: partial (the same working as long division — the tableau is not drawn) |
| A-APR.7 | Rational expressions: + − × ÷ | `\frac{2}{x} + \frac{3}{x + 1}` → `x \neq -1, \ x \neq 0`, …, `\frac{5x + 2}{x(x + 1)}`; products and quotients factored and cancelled | does it (one letter) |
| A-REI.2 | Rational and radical equations, extraneous roots | (original corpus) | does it |
| A-REI.11 | Where two functions meet | `f(x) = x^{2}`, `g(x) = x + 6`, `f(x) = g(x)` → `x = -2, \ x = 3` | does it (algebraically; graphing in parallel) |
| A-CED.2 | Direct, inverse, joint variation | `y = \frac{k}{x}`, `x = 2`, `y = 6`, `k = ?` → `k = 12` | does it |
| A-CED.4 | A formula with the letter below the bar or in an exponent | `\frac{1}{f} = \frac{1}{u} + \frac{1}{v}` → `f = \frac{uv}{u + v}`; `A = Pe^{rt}` → `t = \frac{\ln(\frac{A}{P})}{r}` | does it |
| F-IF.7 | Graphs of polynomial, rational, exponential, log functions | — | (graphing, in parallel) |
| F-IF.7 | Asymptotes and holes of a rational function | — | not yet (asking needs words; the limits at ±∞ are done in precalculus) |
| F-IF | Piecewise functions | `f(x) = \begin{cases} … \end{cases}`, `f(3) =` → `3 \ge 0`, `= 2(3) + 1`, `= 7` (Mathpix's `\left\{\begin{array}` too) | does it |
| F-BF.1b–c | Combining and composing functions | `(f + g)(2)`, `f(g(x))` → `= f(x^{2})`, `= 2(x^{2}) + 3`, `= 2x^{2} + 3`; `(f \circ g)(x)` | does it |
| F-BF.4 | Inverse functions | `f(x) = \frac{x + 1}{x - 2}`, `f^{-1}(x) =` → `y = …`, `x = \frac{y + 1}{y - 2}`, `x(y - 2) = y + 1`, …, `f^{-1}(x) = \frac{2x + 1}{x - 1}` | does it (linear, rational-linear, odd powers, roots, exp / log); an even power is refused (it needs a restricted domain) |
| F-BF.5 | Logarithm properties | `\log(x^{2}y)` → `\log x^{2} + \log y`, `2\log x + \log y`; `\log_{2} 8 + \log_{2} 4` → `\log_{2}(8 \cdot 4)`, `\log_{2} 32`, `5`; `\log_{3} 7` → `\frac{\ln 7}{\ln 3}` (change of base) | does it |
| F-LE.4 | Exponential equations by logs | `3^{x} = 2^{x + 1}` → `x\ln 3 = (x + 1)\ln 2`, …, `x = \frac{\ln 2}{\ln 3 - \ln 2}`; `2^{x} = 5` → `x = \log_{2} 5`, `x = \frac{\ln 5}{\ln 2}`; common bases (original) | does it |
| F-IF.8b | Rewrite exponentials to reveal a rate | — | not yet |
| F-TF | Trigonometric functions | (precalculus: exact values, equations, identities) | does it (see ARCHITECTURE) |
| S-ID.4, S-IC | Normal distributions, inference | — | not yet |
| — | Matrices | — | not yet (refused) |

## How checking behaves on these topics

A student's line is compared with the line above it (`engine.analyzeLine`): an expression step by
value at sample points (a closed value exactly — `\sqrt{50}` then `= 5\sqrt{5}` is ringed, a
rounded decimal is never), an equation by its solution set, a claim `f(4) = 11` right under
`f(x) = …` from the definition. In two or more letters (a formula, a line) a rearrangement is `ok`
when it has the same solutions; a *different* equation is only ringed when it is a sign or
constant slip, because the next line may be a second equation of a system (the engine's existing
rule). A complex answer `x = 1 \pm 2i` under `x^{2} + 2x + 5 = 0` is ringed; `x = -1 \pm 2i` ticked.
