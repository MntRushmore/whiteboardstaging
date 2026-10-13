/**
 * The high-school skills' guides (topics on no grade's path): see ../skillGuide.ts. Written for a
 * teen and their parent, in plain US English with the math in Unicode. Each one covers the kinds of
 * problem the skill's generator writes (src/lib/learning/generators: algebra.ts, functions.ts,
 * geometry.ts, trig.ts, calculus.ts, science.ts), so the page's words match its practice set, and
 * every number in an example is worked out right (guides.hs.test.ts checks the sizes and the words).
 */
import type { TopicId } from "@/lib/learning/topics";
import type { SkillGuide } from "../skillGuide";

export const HS_GUIDES: Readonly<Partial<Record<TopicId, SkillGuide>>> = {
  absolute_value: {
    title: "Absolute value equations",
    what: "Absolute value is a number's distance from zero, so |−5| and |5| are both 5. An equation like |x − 2| = 3 usually has two answers, because two numbers sit 3 away from 2: 5 and −1. The same idea solves inequalities like |x + 3| < 6, whose answer is a whole stretch of the number line.",
    steps: [
      "Get the absolute value alone first: 3|x − 7| = 12 becomes |x − 7| = 4, and |x| + 1 = 5 becomes |x| = 4.",
      "Split it into two equations, one equal to the positive number and one to the negative: x − 7 = 4 or x − 7 = −4.",
      "Solve each one: x = 11 or x = 3.",
      "For a less-than inequality, write one sandwich: |x + 3| < 6 becomes −6 < x + 3 < 6, so −9 < x < 3.",
      "For a greater-than inequality, write two pieces joined by or: |x + 7| ≥ 3 becomes x + 7 ≤ −3 or x + 7 ≥ 3, so x ≤ −10 or x ≥ −4.",
      "Check each answer in the original problem.",
    ],
    slips: [
      {
        slip: "Finding only one answer",
        fix: "|x − 2| = 3 means x − 2 is 3 or −3. Write both equations every time: most of these problems have two answers.",
      },
      {
        slip: "Splitting before the absolute value is alone",
        fix: "In 3|x − 7| = 12, writing x − 7 = 12 is wrong. Divide both sides by 3 first, then split.",
      },
      {
        slip: "Mixing up “and” and “or” in inequalities",
        fix: "Less than gives one piece in the middle, like −6 < x + 3 < 6. Greater than gives two pieces pointing away from each other, joined by or.",
      },
    ],
    faq: [
      {
        q: "Can an absolute value equation have no answer?",
        a: "Yes. An absolute value is never negative, so |x − 4| = −2 has no solution. When it equals 0, as in |x − 4| = 0, there is just one answer, x = 4.",
      },
      {
        q: "Why does |x + 3| < 6 turn into −6 < x + 3 < 6?",
        a: "|x + 3| < 6 says x + 3 is less than 6 away from zero, so it sits between −6 and 6. Subtracting 3 from all three parts gives −9 < x < 3.",
      },
      {
        q: "When do students learn absolute value equations?",
        a: "Kids meet absolute value as distance from zero in middle school. Solving equations and inequalities with it is part of Algebra 1, and it comes back in Algebra 2.",
      },
    ],
    related: ["inequalities", "two_step_equations", "negative_numbers", "multi_step_equations"],
  },

  polynomials: {
    title: "Multiplying polynomials",
    what: "Multiplying polynomials means multiplying every term in one set of parentheses by every term in the other, then combining like terms. (x + 8)(x − 9) becomes x² − 9x + 8x − 72, which simplifies to x² − x − 72. It's the skill behind factoring and solving quadratics, so it's worth making it automatic.",
    steps: [
      "Multiply the first term of the first parentheses by each term of the second: in (x + 8)(x − 9), x · x = x² and x · (−9) = −9x.",
      "Do the same with the next term: 8 · x = 8x and 8 · (−9) = −72.",
      "Write all the products in a row: x² − 9x + 8x − 72.",
      "Combine like terms: −9x + 8x = −x, so the answer is x² − x − 72.",
      "Write a square like (x + 2)² as (x + 2)(x + 2) and multiply the same way: x² + 4x + 4.",
    ],
    slips: [
      {
        slip: "Squaring each term on its own",
        fix: "(x + 2)² is not x² + 4. Write it out as (x + 2)(x + 2) and the middle term, 4x, shows up.",
      },
      {
        slip: "Losing a minus sign",
        fix: "Keep each term's sign with it: in (x + 5)(x − 4), 5 times −4 is −20, not 20.",
      },
      {
        slip: "Missing a product",
        fix: "Two terms times two terms makes 4 products, and two terms times three makes 6. Count them before you combine.",
      },
      {
        slip: "Stopping before like terms are combined",
        fix: "x² − 4x + 5x − 20 isn't finished: −4x + 5x = x, so the answer is x² + x − 20.",
      },
    ],
    faq: [
      {
        q: "What is FOIL?",
        a: "FOIL stands for First, Outer, Inner, Last: the four products when you multiply two binomials like (x + 8)(x − 9). It's the same as multiplying every term by every term, which also works when a factor has three terms.",
      },
      {
        q: "Why is (x − 7)(x + 7) just x² − 49?",
        a: "The middle terms cancel: −7x + 7x = 0. Any (x − a)(x + a) gives x² − a², called a difference of squares.",
      },
      {
        q: "How is this different from factoring?",
        a: "Multiplying goes from (x + 6)(x − 2) to x² + 4x − 12. Factoring goes the other way, from x² + 4x − 12 back to (x + 6)(x − 2).",
      },
    ],
    related: ["simplify_expressions", "exponent_rules", "factoring", "quadratic_equations"],
  },

  factoring: {
    title: "Factoring quadratics",
    what: "Factoring turns a quadratic like x² + 9x + 18 back into the two parentheses that multiply to make it, (x + 6)(x + 3). It's multiplying polynomials in reverse, and it's one of the main ways to solve quadratic equations.",
    steps: [
      "Take out any common factor first: 5x² + 25x = 5x(x + 5).",
      "For x² + bx + c, find two numbers that multiply to c and add to b: for x² + 9x + 18, 6 and 3 work, since 6 × 3 = 18 and 6 + 3 = 9.",
      "Write them in the parentheses: (x + 6)(x + 3).",
      "Look for a difference of squares: x² − 81 = (x + 9)(x − 9) and 25x² − 9 = (5x + 3)(5x − 3).",
      "When x² has a number in front, as in 3x² − 4x − 4, split the middle term with two numbers that multiply to 3 × (−4) = −12 and add to −4, then factor in pairs: 3x² + 2x − 6x − 4 = x(3x + 2) − 2(3x + 2) = (3x + 2)(x − 2).",
      "Check by multiplying your parentheses back out.",
    ],
    slips: [
      {
        slip: "Getting the signs mixed up",
        fix: "For x² + 4x − 12 the numbers must multiply to −12, so one of them is negative: 6 and −2. Check: 6 + (−2) = 4.",
      },
      {
        slip: "Leaving a common factor inside",
        fix: "In 9x² − 3x both terms share 3x, so the answer is 3x(3x − 1), not x(9x − 3).",
      },
      {
        slip: "Trying to factor a sum of squares",
        fix: "x² − 16 factors as (x + 4)(x − 4), but x² + 16 doesn't factor over the real numbers. Look for the minus sign.",
      },
    ],
    faq: [
      {
        q: "How do I know my factoring is right?",
        a: "Multiply your answer back out. (x + 6)(x − 2) = x² − 2x + 6x − 12 = x² + 4x − 12, the quadratic you started with, so it's right.",
      },
      {
        q: "What is a perfect square trinomial?",
        a: "A quadratic like x² + 14x + 49, where the first and last terms are squares and the middle term is twice their product. It factors as (x + 7)².",
      },
      {
        q: "Does every quadratic factor?",
        a: "No. x² + x + 1 has no nice factors. Those are solved with the quadratic formula or by completing the square instead.",
      },
    ],
    related: ["polynomials", "quadratic_equations", "rational_expressions", "exponent_rules"],
  },

  quadratic_equations: {
    title: "Quadratic equations",
    what: "A quadratic equation has an x² in it, like x² + 5x + 6 = 0, and it usually has two answers. Many can be solved by taking a square root or by factoring and setting each factor equal to zero; the quadratic formula solves the rest.",
    steps: [
      "If there is no x term, get x² alone and take the square root of both sides, keeping both signs: x² = 64 gives x = ±8.",
      "Otherwise, move everything to one side so the other side is 0: x² − 8x = −12 becomes x² − 8x + 12 = 0.",
      "Factor the left side: (x − 2)(x − 6) = 0.",
      "Set each factor equal to zero and solve: x − 2 = 0 or x − 6 = 0, so x = 2 or x = 6.",
      "For a square like (x + 7)² = 81, take the square root first: x + 7 = ±9, so x = 2 or x = −16.",
      "Check each answer in the original equation.",
    ],
    slips: [
      {
        slip: "Forgetting the negative root",
        fix: "x² = 64 has two answers, 8 and −8, because (−8)² = 64 too. Write ±.",
      },
      {
        slip: "Dividing both sides by x",
        fix: "In x² − 9x = 0, dividing by x loses the answer x = 0. Factor instead: x(x − 9) = 0, so x = 0 or x = 9.",
      },
      {
        slip: "Factoring without a zero on one side",
        fix: "x² − 8x = −12 has to become x² − 8x + 12 = 0 before you factor. The zero-product rule only works when one side is 0.",
      },
      {
        slip: "Keeping the sign from the parentheses",
        fix: "From (x + 3)(x − 8) = 0 the answers are x = −3 and x = 8: each one makes its factor zero.",
      },
    ],
    faq: [
      {
        q: "When should my child use the quadratic formula?",
        a: "When the quadratic doesn't factor nicely. x = (−b ± √(b² − 4ac)) / 2a works for every equation ax² + bx + c = 0, and it gives the same answers as factoring when factoring works.",
      },
      {
        q: "Why do quadratics have two answers?",
        a: "Two different numbers can have the same square, so an x² usually allows two solutions. Sometimes they are the same number, as in (x − 3)² = 0, and sometimes there are no real solutions at all.",
      },
      {
        q: "Can an answer be a fraction?",
        a: "Yes. 2x² + x − 3 = 0 factors as (2x + 3)(x − 1) = 0, so x = −3/2 or x = 1.",
      },
    ],
    related: ["factoring", "polynomials", "radicals", "complex_numbers"],
  },

  radicals: {
    title: "Radicals",
    what: "A radical is a root, like √63. Simplifying one means taking any perfect square out from under it: √63 = √(9 · 7) = 3√7. Radical equations, like √(x − 5) = 2, are solved by getting the root alone and squaring both sides.",
    steps: [
      "To simplify a square root, find the largest perfect square that divides the number: 125 = 25 · 5.",
      "Take its root out in front: √125 = √(25 · 5) = 5√5.",
      "Add or subtract only like radicals: √2 + √18 = √2 + 3√2 = 4√2.",
      "Multiply roots by multiplying the numbers under them: √6 · √24 = √144 = 12.",
      "To solve an equation, get the root alone, then square both sides: √x + 9 = 11 gives √x = 2, so x = 4.",
      "Check the answer in the original equation, since squaring can bring in an answer that doesn't work.",
    ],
    slips: [
      {
        slip: "Adding the numbers under the roots",
        fix: "√2 + √18 is not √20. Simplify first, √18 = 3√2, so the sum is 4√2.",
      },
      {
        slip: "Squaring before the root is alone",
        fix: "In √x + 9 = 11, subtract 9 first to get √x = 2, then square.",
      },
      {
        slip: "Not taking out the largest square",
        fix: "√32 = 2√8 isn't finished, because 8 = 4 · 2. Use 16 instead: √32 = 4√2.",
      },
      {
        slip: "Squaring only part of a side",
        fix: "When you square 5√x = 25, square the 5 too: 25x = 625, so x = 25.",
      },
    ],
    faq: [
      {
        q: "Why check answers to radical equations?",
        a: "Squaring both sides can create an answer that doesn't work in the original equation, called an extraneous solution. Putting each answer back in catches it.",
      },
      {
        q: "Is √(25 · 5) the same as 5√5?",
        a: "Yes. √(25 · 5) = √25 · √5 = 5√5, and both equal √125, about 11.18.",
      },
      {
        q: "Does my child need to know the perfect squares?",
        a: "It helps a lot. Knowing 4, 9, 16, 25, 36, 49, 64, 81, 100 and 144 by heart makes it quick to spot the square inside a number.",
      },
    ],
    related: ["powers_roots", "exponent_rules", "quadratic_equations", "complex_numbers", "pythagorean"],
  },

  rational_expressions: {
    title: "Rational expressions",
    what: "A rational expression is a fraction with x in it, like (x² − 16)/(x + 4). You simplify it the way you simplify a number fraction: factor the top and bottom and cancel what they share. Rational equations, like 18/x = 6, are solved by clearing the fractions.",
    steps: [
      "Factor the top and the bottom: (x² − 16)/(x + 4) = (x + 4)(x − 4)/(x + 4).",
      "Cancel any factor that is on both, which leaves x − 4.",
      "Note the values x can't take, the ones that make a bottom zero: here x ≠ −4.",
      "To add, rewrite over a common denominator: 5/x + 6/(x + 3) = (5(x + 3) + 6x)/(x(x + 3)) = (11x + 15)/(x(x + 3)).",
      "To solve an equation, multiply both sides by every denominator to clear the fractions: 4/(x − 1) = 7/(x − 4) becomes 4(x − 4) = 7(x − 1), so x = −3.",
      "Check that the answer doesn't make any denominator zero.",
    ],
    slips: [
      {
        slip: "Canceling terms instead of factors",
        fix: "In (x² − 16)/(x + 4) you can't cross out the x's or the 4's. Only whole factors cancel, after you factor.",
      },
      {
        slip: "Adding the tops and the bottoms",
        fix: "5/x + 6/(x + 3) is not 11/(2x + 3). Rewrite both fractions over x(x + 3) first.",
      },
      {
        slip: "Keeping an answer that breaks the problem",
        fix: "An answer that makes a denominator zero is no solution. Write down the values x can't take before you start.",
      },
    ],
    faq: [
      {
        q: "Why write x ≠ 0?",
        a: "Dividing by zero is undefined, so any x that makes a denominator 0 is ruled out. In 18/x = 6, x can't be 0, and the answer, x = 3, is fine.",
      },
      {
        q: "Can (x − 6)/(x + 6) be simplified?",
        a: "No. x − 6 and x + 6 are different factors, so nothing cancels. The fraction is already as simple as it gets.",
      },
      {
        q: "How is this like number fractions?",
        a: "It's the same rules: 6/8 = 3/4 because a 2 cancels from the top and the bottom. Here x + 4 cancels the same way.",
      },
    ],
    related: ["factoring", "add_fractions_unlike", "equivalent_fractions", "multi_step_equations", "polynomials"],
  },

  complex_numbers: {
    title: "Complex numbers",
    what: "Complex numbers add one new number, i, where i² = −1. That makes square roots of negatives possible, √−9 = 3i, and gives numbers like 3 − 4i, with a real part and an imaginary part. You add, subtract and multiply them much like expressions with x, then replace i² with −1.",
    steps: [
      "To add, combine the real parts and the imaginary parts separately: (3 − 4i) + (4 − 3i) = 7 − 7i.",
      "To subtract, take away both parts of the second number: (−6 − 4i) − (8 + 4i) = −6 − 8 − 4i − 4i = −14 − 8i.",
      "To multiply, multiply every term by every term, as with (x + 2)(x − 3): (3 − 3i)(2 + 3i) = 6 + 9i − 6i − 9i².",
      "Replace i² with −1 and simplify: 6 + 9i − 6i + 9 = 15 + 3i.",
      "For a power of i, use the cycle of four, i, −1, −i, 1: i²² = (i⁴)⁵ · i² = −1.",
      "For the square root of a negative number, take out the i: √−100 = √100 · i = 10i.",
    ],
    slips: [
      {
        slip: "Leaving i² in the answer",
        fix: "i² is −1, so −9i² becomes +9. An answer in the form a + bi has no i² in it.",
      },
      {
        slip: "Missing the minus on the second number",
        fix: "In (−6 − 4i) − (8 + 4i), the minus applies to both the 8 and the 4i.",
      },
      {
        slip: "Getting powers of i wrong",
        fix: "Divide the power by 4 and use the remainder: 27 ÷ 4 leaves 3, so i²⁷ = i³ = −i.",
      },
    ],
    faq: [
      {
        q: "Are complex numbers real?",
        a: "They aren't on the ordinary number line, which is why the i part is called imaginary. They are used in electricity, signals and physics, and they give every quadratic equation a solution.",
      },
      {
        q: "Why is (4 + 3i)(4 − 3i) a real number?",
        a: "The i terms cancel: 16 − 12i + 12i − 9i² = 16 + 9 = 25. A complex number times its conjugate is always real.",
      },
      {
        q: "When do students learn complex numbers?",
        a: "Usually in Algebra 2, right after quadratics, since x² + 1 = 0 has no real answer but has two complex ones, i and −i.",
      },
    ],
    related: ["quadratic_equations", "radicals", "polynomials", "exponent_rules"],
  },

  functions: {
    title: "Functions",
    what: "A function is a rule that turns each input into exactly one output. With g(x) = 3x − 4, the input 2 gives g(2) = 3(2) − 4 = 2. Students evaluate functions, find the input that gives an output, put one function inside another, like f(g(1)), and find inverses that undo them.",
    steps: [
      "To evaluate, replace every x with the number, in parentheses: g(−2) with g(x) = 5x + 7 is 5(−2) + 7.",
      "Then simplify: 5(−2) + 7 = −10 + 7 = −3.",
      "To find the input for an output, set the rule equal to it and solve: f(x) = −22 with f(x) = −3x − 1 gives −3x − 1 = −22, so x = 7.",
      "For a composition like f(g(1)), work from the inside out: find g(1) first, then put that number into f.",
      "For an inverse, write y = f(x), swap x and y, and solve for y: y = 3x − 2 becomes x = 3y − 2, so f⁻¹(x) = (x + 2)/3.",
    ],
    slips: [
      {
        slip: "Reading f(x) as f times x",
        fix: "f(2) means the output when x is 2. It isn't f multiplied by 2.",
      },
      {
        slip: "Dropping the parentheses around a negative",
        fix: "With g(x) = 3x² − 5, g(−2) = 3(−2)² − 5 = 12 − 5 = 7. Without the parentheses, −2² would be −4 and the answer would come out −17.",
      },
      {
        slip: "Composing in the wrong order",
        fix: "f(g(1)) means g first, then f. g(f(1)) is usually a different number.",
      },
      {
        slip: "Thinking f⁻¹(x) means 1/f(x)",
        fix: "The −1 means inverse, the function that undoes f. It isn't a reciprocal.",
      },
    ],
    faq: [
      {
        q: "What does f(x) mean?",
        a: "It's read “f of x” and means the output of the function f for the input x. The letter is just the function's name; g and h are common too.",
      },
      {
        q: "How do I check an inverse?",
        a: "Put one inside the other. With f(x) = 3x − 2 and f⁻¹(x) = (x + 2)/3, f⁻¹(5) = 7/3 and f(7/3) = 7 − 2 = 5: you get back the number you started with.",
      },
      {
        q: "Is every equation a function?",
        a: "No. A function gives exactly one output for each input. y = x² is a function, but x = y² is not, since x = 4 gives both y = 2 and y = −2.",
      },
    ],
    related: ["linear_functions", "exponential_equations", "logarithms", "two_step_equations"],
  },

  exponential_equations: {
    title: "Exponential equations",
    what: "In an exponential equation the unknown is in the exponent, as in 5ˣ = 625. When both sides can be written as powers of the same base, the exponents must be equal: 625 = 5⁴, so x = 4.",
    steps: [
      "Get the power alone: 2 · 5ˣ = 250 becomes 5ˣ = 125.",
      "Write the other side as a power of the same base: 125 = 5³, so 5ˣ = 5³.",
      "If the bases differ, rewrite both sides with a common base: 4ˣ = 8 becomes (2²)ˣ = 2³, which is 2²ˣ = 2³.",
      "Set the exponents equal and solve: 2x = 3, so x = 3/2.",
      "Write a fraction as a negative power: 3ˣ = 1/243 becomes 3ˣ = 3⁻⁵, so x = −5.",
    ],
    slips: [
      {
        slip: "Dividing instead of matching powers",
        fix: "5ˣ = 625 doesn't mean x = 625 ÷ 5. Ask what power of 5 makes 625: 5⁴ = 625, so x = 4.",
      },
      {
        slip: "Adding exponents in a power of a power",
        fix: "(2²)ˣ is 2²ˣ, not 2²⁺ˣ. Multiply the exponents.",
      },
      {
        slip: "Setting only part of the exponent equal",
        fix: "In 2ˣ⁺² = 64, write 64 = 2⁶. The whole exponent, x + 2, equals 6, so x = 4.",
      },
    ],
    faq: [
      {
        q: "What if the numbers aren't powers of the same base?",
        a: "Then take a logarithm of both sides: 2ˣ = 10 gives x = log 10 ÷ log 2, about 3.32. The practice problems here are built on exact powers, so they come out to whole numbers or simple fractions.",
      },
      {
        q: "How is this different from x² = 25?",
        a: "In x² = 25 the unknown is the base, and you take a square root. In 2ˣ = 32 the unknown is the exponent, and you match powers or use logs.",
      },
      {
        q: "Where do exponential equations show up?",
        a: "Anywhere something doubles or halves at a steady rate: money growing with interest, populations, and how fast a medicine leaves the body.",
      },
    ],
    related: ["logarithms", "exponent_rules", "powers_roots", "functions"],
  },

  logarithms: {
    title: "Logarithms",
    what: "A logarithm answers the question “what power?”: log₂ 8 = 3 because 2³ = 8. Logs undo exponents, so log₃ x = 3 means x = 3³ = 27. Their rules turn products into sums, which is how they solve equations where the unknown is a power.",
    steps: [
      "Read a log as a power: log₂ 64 asks what power of 2 makes 64, and 2⁶ = 64, so it's 6.",
      "To solve log₃ x = 3, rewrite it as a power: x = 3³ = 27.",
      "Combine a sum of logs with the same base into the log of a product: log₃ 3 + log₃ 81 = log₃ 243 = 5.",
      "Combine a difference into the log of a quotient: log₃ 162 − log₃ 6 = log₃ 27 = 3.",
      "Divide away a number in front first: 2 log₂ x = 12 gives log₂ x = 6, so x = 2⁶ = 64.",
      "Remember that a log with no base written is base 10: log 1000 = 3.",
    ],
    slips: [
      {
        slip: "Dividing the logs",
        fix: "log₃ 162 − log₃ 6 is log₃ (162 ÷ 6) = log₃ 27, not log₃ 162 ÷ log₃ 6.",
      },
      {
        slip: "Mixing up the base and the answer",
        fix: "log₂ 8 = 3 says 2³ = 8: the base is 2, the power is 3, and 8 is the result.",
      },
      {
        slip: "Taking the log of zero or a negative",
        fix: "You can only take the log of a positive number. An answer that makes the inside of a log zero or negative doesn't work.",
      },
    ],
    faq: [
      {
        q: "What is ln?",
        a: "ln is the natural log, a log with base e (about 2.718). It follows all the same rules as log₂ or log₁₀.",
      },
      {
        q: "Why learn logarithms?",
        a: "They solve equations where the unknown is an exponent, and they measure things that grow by multiplying, like the pH scale, earthquake sizes and sound in decibels.",
      },
      {
        q: "How do I check log₂ x + log₂ 4 = 4?",
        a: "Put the answer back in. With x = 4, log₂ 4 + log₂ 4 = 2 + 2 = 4, so it works.",
      },
    ],
    related: ["exponential_equations", "exponent_rules", "functions", "powers_roots"],
  },

  angles: {
    title: "Angle relationships",
    what: "Angle problems use a few facts about how angles fit together: complementary angles add to 90°, angles on a straight line add to 180°, angles around a point add to 360°, and vertical angles are equal. Each fact turns a picture into an equation to solve for x.",
    steps: [
      "Decide which fact the angles follow: a right angle (90°), a straight line (180°), a full turn (360°), or vertical angles (equal).",
      "Write the equation: complementary angles x and 77° give x + 77° = 90°.",
      "Solve it: x = 90° − 77° = 13°.",
      "For angles written with x, like vertical angles (3x + 18)° and (2x + 34)°, set them equal: 3x + 18 = 2x + 34, so x = 16.",
      "If the question asks for the angle, put x back in: 3(16) + 18 = 66°.",
    ],
    slips: [
      {
        slip: "Using the wrong total",
        fix: "Complementary is 90° and supplementary is 180°. One way to remember: c comes before s, and 90 comes before 180.",
      },
      {
        slip: "Stopping at x when the angle is asked for",
        fix: "x = 16 isn't the angle. Put it back into 3x + 18 to get 66°.",
      },
      {
        slip: "Adding vertical angles to 180°",
        fix: "Vertical angles are across from each other where two lines cross, and they are equal. It's the angles next to each other that add to 180°.",
      },
    ],
    faq: [
      {
        q: "What are vertical angles?",
        a: "When two lines cross they make two pairs of opposite angles, and each pair is equal. So (2x + 7)° = (6x − 73)° gives x = 20, and both angles are 47°.",
      },
      {
        q: "What does a ratio of angles mean?",
        a: "If two angles on a straight line are in the ratio 1 : 3, call them x and 3x. Then x + 3x = 180°, so x = 45° and the angles are 45° and 135°.",
      },
      {
        q: "Why do angles around a point add to 360°?",
        a: "A full turn is 360°. However many angles share the point, together they make one full turn.",
      },
    ],
    related: ["triangles", "one_step_equations", "two_step_equations", "area_perimeter"],
  },

  triangles: {
    title: "Angles in a triangle",
    what: "The three angles inside any triangle add up to 180°. Knowing two of them gives the third, and when the angles are written with x, the same fact gives an equation to solve.",
    steps: [
      "Add the angles you know: in x + 79° + 53° = 180°, 79° + 53° = 132°.",
      "Subtract from 180°: x = 180° − 132° = 48°.",
      "In a right triangle one angle is 90°, so the other two add to 90°.",
      "In an isosceles triangle the two base angles are equal: x + x + 38° = 180° gives 2x = 142°, so x = 71°.",
      "For angles like (x + 38)°, (2x + 10)° and x°, add them and set the sum equal to 180: 4x + 48 = 180, so x = 33.",
    ],
    slips: [
      {
        slip: "Using 360° instead of 180°",
        fix: "360° is a full turn, or the angles of a four-sided shape. A triangle's angles always add to 180°.",
      },
      {
        slip: "Leaving out the right angle",
        fix: "A small square in a corner of the drawing means 90°. Include it in the sum.",
      },
      {
        slip: "Giving x when the angles are asked for",
        fix: "In 4x + 2x + 3x = 180, x = 20, but the angles are 80°, 40° and 60°. Check that they add to 180°.",
      },
    ],
    faq: [
      {
        q: "Why do a triangle's angles add to 180°?",
        a: "Tear the three corners off a paper triangle and line them up point to point: they make a straight line, which is 180°.",
      },
      {
        q: "Can a triangle have two right angles?",
        a: "No. Two right angles already make 180°, which leaves nothing for the third angle.",
      },
      {
        q: "What is an isosceles triangle?",
        a: "A triangle with two equal sides. The angles opposite those sides are equal too, which is why x + x shows up in these problems.",
      },
    ],
    related: ["angles", "pythagorean", "two_step_equations", "area_perimeter"],
  },

  coordinate_geometry: {
    title: "Distance and midpoint",
    what: "Two formulas measure a segment on a coordinate grid. The midpoint formula averages the coordinates to find the point halfway between two points, and the distance formula, which comes from the Pythagorean theorem, finds how far apart they are.",
    steps: [
      "Label the points (x₁, y₁) and (x₂, y₂): for (2, 0) and (10, 10), x₁ = 2, y₁ = 0, x₂ = 10 and y₂ = 10.",
      "For the midpoint, average the x's and average the y's: M = ((2 + 10)/2, (0 + 10)/2) = (6, 5).",
      "For the distance, subtract the x's and subtract the y's: for (5, 6) and (10, 18) the differences are 5 and 12.",
      "Square the differences, add them and take the square root: d = √(5² + 12²) = √169 = 13.",
    ],
    slips: [
      {
        slip: "Subtracting in the midpoint formula",
        fix: "The midpoint adds the coordinates and divides by 2. Subtracting is for the distance.",
      },
      {
        slip: "Mixing x's with y's",
        fix: "Keep the pairs apart: x₂ − x₁ uses only the x's, and y₂ − y₁ only the y's.",
      },
      {
        slip: "Taking the root of each square separately",
        fix: "√(5² + 12²) is √169 = 13, not 5 + 12 = 17. Add under the root first.",
      },
    ],
    faq: [
      {
        q: "Does the order of the points matter?",
        a: "No. (10 − 5)² and (5 − 10)² are both 25, so the distance is the same either way, and an average doesn't depend on order.",
      },
      {
        q: "How is the distance formula like the Pythagorean theorem?",
        a: "The two differences are the legs of a right triangle and the distance is its hypotenuse: d² = (x₂ − x₁)² + (y₂ − y₁)².",
      },
      {
        q: "Can a distance be negative?",
        a: "No. Squaring makes both differences positive, and a square root is never negative.",
      },
    ],
    related: ["pythagorean", "linear_functions", "powers_roots", "radicals"],
  },

  trig_values: {
    title: "Trig values of special angles",
    what: "A few angles, 30°, 45° and 60° and the angles where they repeat around the circle, have sines, cosines and tangents with exact values, like sin 30° = 1/2 and cos 45° = √2/2. Students learn them from two special right triangles and the unit circle, and use them all through trigonometry.",
    steps: [
      "Learn the first-quadrant values: sin 30° = 1/2, sin 45° = √2/2 and sin 60° = √3/2, while cosine runs the other way, cos 30° = √3/2, cos 45° = √2/2 and cos 60° = 1/2.",
      "Get a tangent by dividing sine by cosine: tan 45° = 1 and tan 60° = √3.",
      "For a bigger angle, find its reference angle, the angle to the nearest x-axis: 120° is 60° from 180°.",
      "Take the sign from the quadrant: cosine is negative in the second quadrant, so cos 120° = −cos 60° = −1/2.",
      "Work in radians the same way, using π/6 = 30°, π/4 = 45° and π/3 = 60°: sin 7π/6 = −sin π/6 = −1/2.",
    ],
    slips: [
      {
        slip: "Swapping sine and cosine",
        fix: "sin 30° is 1/2 and cos 30° is √3/2. In the 30-60-90 triangle, the side opposite 30° is the short one.",
      },
      {
        slip: "Getting the sign wrong past 90°",
        fix: "Use “All Students Take Calculus”: all three are positive in quadrant 1, sine in 2, tangent in 3 and cosine in 4.",
      },
      {
        slip: "Reading 6 sin 30° as sin 180°",
        fix: "The 6 multiplies the value: 6 sin 30° = 6 · 1/2 = 3.",
      },
    ],
    faq: [
      {
        q: "Does my child need to memorize these?",
        a: "It helps. Most classes expect the 30°, 45° and 60° values from memory, and the rest follow from reference angles and signs.",
      },
      {
        q: "What is the unit circle?",
        a: "A circle with radius 1. The point at angle θ on it is (cos θ, sin θ), which is why the values repeat with different signs all the way around.",
      },
      {
        q: "Why is tan 90° missing?",
        a: "tan 90° = sin 90° ÷ cos 90° = 1 ÷ 0, which is undefined.",
      },
    ],
    related: ["trig_equations", "pythagorean", "triangles", "radicals"],
  },

  trig_equations: {
    title: "Trig equations",
    what: "A trig equation asks which angles give a certain sine, cosine or tangent, as in 2 sin x = 1. Because the values repeat around the circle, there are usually two answers in one full turn, from 0° to 360° or from 0 to 2π.",
    steps: [
      "Get the trig function alone: 2 sin x = 1 becomes sin x = 1/2.",
      "Find the reference angle from the special values: sin 30° = 1/2, so it's 30°.",
      "Find the quadrants where the function has that sign: sine is positive in quadrants 1 and 2.",
      "Write the angle in each of those quadrants: x = 30° and x = 180° − 30° = 150°.",
      "Give the answers in the interval the problem asks for, in degrees or radians: 30° and 150° are π/6 and 5π/6.",
    ],
    slips: [
      {
        slip: "Stopping at one answer",
        fix: "sin x = 1/2 has two answers between 0° and 360°: 30° and 150°. Look for the other quadrant with the same sign.",
      },
      {
        slip: "Mixing degrees and radians",
        fix: "If the interval is 0 ≤ x < 2π, answer in radians, like 5π/6, not 150°.",
      },
      {
        slip: "Using a negative reference angle",
        fix: "For cos x = −1/2 the reference angle is still 60°. The minus sign only picks the quadrants, 2 and 3, so x = 120° and 240°.",
      },
    ],
    faq: [
      {
        q: "Why are there two answers?",
        a: "Sine, cosine and tangent each take every value at two places around the circle. For example, cos 60° and cos 300° are both 1/2.",
      },
      {
        q: "Can a trig equation have just one answer?",
        a: "Yes, at the top or bottom of the curve: cos x = 1 has only x = 0 between 0 and 2π, and sin x = 1 has only x = 90° between 0° and 360°.",
      },
      {
        q: "What if no interval is given?",
        a: "Then the full answer includes every turn of the circle, like x = 30° + 360°k. On the practice problems here, an answer without an interval in the problem is given from 0° up to 360°.",
      },
    ],
    related: ["trig_values", "quadratic_equations", "functions", "two_step_equations"],
  },

  limits: {
    title: "Limits",
    what: "A limit asks what value a function is heading toward as x gets close to a number, even where the function isn't defined. The limit of (x² − 9)/(x − 3) as x → 3 is 6, though putting in 3 gives 0/0. Limits are where calculus starts.",
    steps: [
      "Try putting the number in: for the limit of 3x − 7 as x → 2, 3 · 2 − 7 = −1, and that's the answer.",
      "If you get 0/0, factor the top and the bottom: (x² − 9)/(x − 3) = (x − 3)(x + 3)/(x − 3).",
      "Cancel the common factor and put the number in again: x + 3 at x = 3 is 6.",
      "For x → ∞ with a fraction, divide every term by the highest power of x in the bottom: (5x − 6)/(4x + 7) becomes (5 − 6/x)/(4 + 7/x).",
      "Let each term with x in its denominator go to 0: the limit is 5/4.",
    ],
    slips: [
      {
        slip: "Calling 0/0 the answer",
        fix: "0/0 means more work is needed, not that the limit is 0 or doesn't exist. Factor, cancel and try again.",
      },
      {
        slip: "Canceling terms instead of factors",
        fix: "In (x² − 9)/(x − 3) you can't cross out the x's. Factor the top first.",
      },
      {
        slip: "Comparing the wrong terms at infinity",
        fix: "As x → ∞ only the highest powers matter: (6x² − 3)/(3x² + 4) heads to 6/3 = 2.",
      },
    ],
    faq: [
      {
        q: "Why not just put the number in?",
        a: "Often you can, and that's the answer. When it gives 0/0 the function has a hole there, and the limit is the height the graph is heading toward at the hole.",
      },
      {
        q: "What does x → ∞ mean?",
        a: "It means x grows without end. The limit is the height the graph levels off at, its horizontal asymptote.",
      },
      {
        q: "Are limits needed for derivatives?",
        a: "Yes. A derivative is defined as a limit: the slope between two points on a curve as they get closer and closer together.",
      },
    ],
    related: ["derivatives", "rational_expressions", "factoring", "functions"],
  },

  derivatives: {
    title: "Derivatives",
    what: "A derivative measures how fast something changes: the slope of a curve at each point. For the functions students meet first, a few rules find it, starting with the power rule, which turns 7x⁵ into 35x⁴.",
    steps: [
      "Use the power rule on each term: bring the power down in front and lower it by 1, so the derivative of x⁵ is 5x⁴.",
      "Keep a number in front as it is: the derivative of 7x⁵ is 7 · 5x⁴ = 35x⁴.",
      "Drop a constant, whose derivative is 0, and turn x into 1: the derivative of 2x³ − x + 1 is 6x² − 1.",
      "Learn the trig and e rules: sin x becomes cos x, cos x becomes −sin x, and eˣ stays eˣ.",
      "For a function inside another, use the chain rule and multiply by the inside's derivative: sin 3x becomes 3 cos 3x, and (2x − 1)⁴ becomes 8(2x − 1)³.",
    ],
    slips: [
      {
        slip: "Forgetting to lower the power",
        fix: "The derivative of 4x³ is 12x², not 12x³. The power goes down by one.",
      },
      {
        slip: "Keeping the constant",
        fix: "In x⁴ − 3x² − 6 the −6 disappears, so the derivative is 4x³ − 6x.",
      },
      {
        slip: "Missing the chain rule",
        fix: "The derivative of e⁵ˣ is 5e⁵ˣ, not e⁵ˣ. Multiply by the derivative of the inside, 5x.",
      },
      {
        slip: "Getting the cosine sign wrong",
        fix: "The derivative of cos x is −sin x, with a minus. The derivative of sin x is cos x, with none.",
      },
    ],
    faq: [
      {
        q: "What does f′(x) mean?",
        a: "It's read “f prime of x” and is another way to write the derivative. If f(x) = x² + 3x − 3, then f′(x) = 2x + 3.",
      },
      {
        q: "What are derivatives used for?",
        a: "Finding speed from position, the slope of a curve, and the highest and lowest points of a graph, where the derivative is 0.",
      },
      {
        q: "Is a derivative a limit?",
        a: "Yes. It's the limit of the slope between two points on the curve as they get closer together. The rules are shortcuts for that limit.",
      },
    ],
    related: ["limits", "integrals", "exponent_rules", "functions"],
  },

  integrals: {
    title: "Integrals",
    what: "An integral undoes a derivative. The indefinite integral ∫ 4x dx asks which function has the derivative 4x, and the answer is 2x² + C. A definite integral, with numbers at the bottom and top, gives a number: the area under a curve between two points.",
    steps: [
      "Use the power rule in reverse on each term: raise the power by 1 and divide by the new power, so ∫ x⁵ dx = x⁶/6.",
      "Keep the number in front: ∫ 12x⁵ dx = 12 · x⁶/6 = 2x⁶.",
      "Integrate a constant by putting an x on it: ∫ 5 dx = 5x.",
      "Add + C to an indefinite integral, since any constant has a derivative of 0.",
      "For a definite integral, find the antiderivative and subtract its value at the bottom number from its value at the top: ∫₁⁴ 9x² dx = 3(4)³ − 3(1)³ = 192 − 3 = 189.",
      "Check an indefinite integral by taking the derivative of your answer.",
    ],
    slips: [
      {
        slip: "Forgetting + C",
        fix: "Every indefinite integral needs + C, because 2x² + 5 and 2x² − 1 both have the derivative 4x.",
      },
      {
        slip: "Multiplying by the power instead of dividing",
        fix: "∫ x² dx is x³/3, not 3x³. Raise the power, then divide by it.",
      },
      {
        slip: "Getting the sine and cosine signs backward",
        fix: "∫ sin x dx = −cos x + C and ∫ cos x dx = sin x + C. Take the derivative to check.",
      },
      {
        slip: "Subtracting in the wrong order",
        fix: "A definite integral is the top value minus the bottom value: F(4) − F(1), not F(1) − F(4).",
      },
    ],
    faq: [
      {
        q: "What does dx mean?",
        a: "It names the variable you are integrating with respect to, here x, and marks where the integral ends.",
      },
      {
        q: "Why is there no + C on a definite integral?",
        a: "The C would be added at the top value and taken away at the bottom one, so it cancels. A definite integral is a single number.",
      },
      {
        q: "How does an integral give an area?",
        a: "A definite integral adds up thin strips under the curve. For a curve above the x-axis, ∫₀³ 4x³ dx = 81 is the area between the curve and the axis from x = 0 to x = 3.",
      },
    ],
    related: ["derivatives", "limits", "exponent_rules", "area_perimeter"],
  },

  units: {
    title: "Unit conversions",
    what: "Converting units means writing the same amount in a different unit, like 3.5 L = 3500 mL. In the metric system every step is a power of 10, so converting is multiplying or dividing by 10, 100 or 1000.",
    steps: [
      "Find how many of the small unit make one of the big unit: 1 km = 1000 m, 1 kg = 1000 g, 1 L = 1000 mL, 1 m = 100 cm and 1 cm = 10 mm.",
      "Going to a smaller unit, multiply: 7.5 km = 7.5 × 1000 m = 7500 m.",
      "Going to a bigger unit, divide: 4000 g = 4000 ÷ 1000 kg = 4 kg.",
      "Multiplying or dividing by 10, 100 or 1000 moves the decimal point 1, 2 or 3 places: 3.5 × 1000 = 3500.",
      "To change km/h to m/s, multiply by 1000 (meters in a kilometer) and divide by 3600 (seconds in an hour), which is the same as dividing by 3.6: 72 km/h = 20 m/s.",
    ],
    slips: [
      {
        slip: "Multiplying when you should divide",
        fix: "Ask whether the answer should be bigger or smaller. A kilogram is bigger than a gram, so 5000 g is a small number of kilograms: 5 kg.",
      },
      {
        slip: "Moving the decimal point the wrong number of places",
        fix: "Centimeters to millimeters is × 10, one place: 3.5 cm = 35 mm. Kilometers to meters is × 1000, three places.",
      },
      {
        slip: "Dividing by 60 for km/h to m/s",
        fix: "An hour is 3600 seconds, not 60. Divide by 3.6 to go from km/h to m/s.",
      },
    ],
    faq: [
      {
        q: "Is there a trick for metric prefixes?",
        a: "Kilo means 1000, centi means a hundredth and milli means a thousandth. So a kilometer is 1000 meters and a millimeter is a thousandth of a meter.",
      },
      {
        q: "Why learn metric when we use feet and pounds?",
        a: "Science classes use metric units, and they are easier to convert, because every step is a power of 10.",
      },
      {
        q: "How do I check a conversion?",
        a: "Convert back. If 7.5 km = 7500 m, then 7500 ÷ 1000 should give 7.5 again.",
      },
    ],
    related: ["decimals_multiply", "multiply_by_tens", "proportions", "percents"],
  },
};
