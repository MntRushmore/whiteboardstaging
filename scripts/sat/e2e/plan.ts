/**
 * The questions the SAT v2 end-to-end harness works, and what a student writes on each (worked by hand,
 * 2026-10-23). For each: L1 the first right line, L2 the right line after it, S a planted slip in L2's
 * place, U an unfinished line. `next` judges Help me's one step after L1: is it true for this
 * question, is it progress, and does it stop short of the answer when more than one step is left.
 */

export interface StepVerdict {
  correct: boolean;
  progress: boolean;
  /** jumped straight to the final answer although at least two steps were left */
  jumped: boolean;
  specific: boolean;
  why: string;
}

export interface QuestionPlan {
  id: string;
  kind: string;
  L1: string;
  L2: string;
  S: string;
  U: string;
  /** the student's marks on the figure (the iPad's SATFigureMarks words), when the run draws some */
  marks?: string;
  next: (step: string, num: Num) => StepVerdict;
}

/** Numeric helpers over the engine (run.ts passes them in). */
export interface Num {
  /** every side of the relation, evaluated with `scope` (null when a side is no number) */
  sides(latex: string, scope: Record<string, number>): number[] | null;
  /** the relation holds at `scope` (all sides equal) */
  holds(latex: string, scope: Record<string, number>): boolean;
  /** the bare-number value of the line's last side, or null */
  last(latex: string, scope?: Record<string, number>): number | null;
  /** LaTeX without spaces/braces */
  flat(latex: string): string;
}

const v = (correct: boolean, progress: boolean, jumped: boolean, specific: boolean, why: string): StepVerdict => ({ correct, progress, jumped, specific, why });

export const PLAN: QuestionPlan[] = [
  {
    id: "algebra-linear-functions-0001",
    kind: "plot MCQ (two labelled points)",
    L1: "m=\\frac{1-(-2)}{2-0}",
    L2: "m=\\frac{3}{2}",
    S: "m=\\frac{2}{3}",
    U: "f(6)=",
    marks: "On the question's graph the student drew: circled near (0, -2); circled near (2, 1).",
    next: (s, n) => {
      const f = n.flat(s);
      // m = 3/2 (simplify), or the line f(x) = 3/2 x - 2, or f(6) worked from it
      if (n.holds(s, { m: 1.5 }) && /m/.test(f) && !/x/.test(f)) return v(true, n.last(s, { m: 1.5 }) === 1.5 && !/1-\(-2\)/.test(f), false, true, "simplifies the slope to 3/2");
      if (/f\(x\)|y=/.test(f)) {
        const ok = [0, 2, 6].every((x) => n.holds(s.replace(/f\(x\)|y/, "Y"), { Y: 1.5 * x - 2, x }));
        return v(ok, ok, false, ok, ok ? "writes the line through the points" : "a wrong line");
      }
      if (/f\(6\)/.test(f)) return v(n.last(s) === 7, true, n.last(s) === 7, true, "goes to f(6)");
      return v(false, false, false, false, "not a step on this question");
    },
  },
  {
    id: "geometry_trig-area-volume-0001",
    kind: "geometry shape grid-in",
    L1: "A=\\frac{1}{2}\\cdot12\\cdot9",
    L2: "A=6\\cdot9",
    S: "A=12\\cdot9",
    U: "A=\\frac{1}{2}\\cdot",
    next: (s, n) => {
      const ok = n.holds(s, { A: 54 });
      // one multiplication from L1 to 54: the answer is the next step
      return v(ok, ok && n.flat(s) !== n.flat("A=\\frac{1}{2}\\cdot12\\cdot9"), false, ok, ok ? "A = 54 (or 6·9): one step left" : "wrong area");
    },
  },
  {
    id: "psda-probability-0001",
    kind: "table MCQ",
    L1: "P=\\frac{16}{28}",
    L2: "P=\\frac{4}{7}",
    S: "P=\\frac{4}{15}",
    U: "P=",
    next: (s, n) => {
      const ok = n.holds(s, { P: 16 / 28 });
      return v(ok, ok && n.flat(s) !== n.flat("P=\\frac{16}{28}"), false, ok, ok ? "simplifies 16/28" : "wrong probability");
    },
  },
  {
    id: "algebra-linear-one-var-0111",
    kind: "word problem grid-in",
    L1: "6+3m=51",
    L2: "3m=45",
    S: "3m=57",
    U: "3m=",
    next: (s, n) => {
      const ok = n.holds(s, { m: 15 }) && !n.holds(s, { m: 14 });
      const jumped = /^m=15$/.test(n.flat(s));
      return v(ok, ok && n.flat(s) !== "6+3m=51", jumped, ok, jumped ? "jumped to m = 15" : ok ? "an equivalent next equation" : "not equivalent");
    },
  },
  {
    id: "algebra-linear-one-var-0103",
    kind: "equation MCQ (stem relation as the page's head)",
    L1: "5x-20=2x+37",
    L2: "3x=57",
    S: "3x=17",
    U: "3x=",
    next: (s, n) => {
      const ok = n.holds(s, { x: 19 }) && !n.holds(s, { x: 18 });
      const jumped = /^x=19$/.test(n.flat(s));
      return v(ok, ok && n.flat(s) !== "5x-20=2x+37", jumped, ok, jumped ? "jumped to x = 19" : ok ? "an equivalent next equation" : "not equivalent");
    },
  },
  {
    id: "algebra-linear-systems-0105",
    kind: "system grid-in (two stem equations)",
    L1: "2x=38",
    L2: "x=19",
    S: "x=17",
    U: "3y=21-",
    next: (s, n) => {
      const f = n.flat(s);
      const ok = n.holds(s, { x: 19, y: -17 / 3 }) && (/y/.test(f) || !n.holds(s, { x: 18, y: -17 / 3 }));
      const jumped = /^y=-?\\frac17\/?3$|^y=-17\/3$|^y=-\\frac173$/.test(f);
      return v(ok, ok && f !== "2x=38", jumped, ok, jumped ? "jumped to y" : ok ? "true for the system, a step on" : "false for the system");
    },
  },
  {
    id: "advanced_math-equivalent-expressions-0101",
    kind: "equivalent expressions MCQ",
    L1: "10(3x+5)-4x=30x+50-4x",
    L2: "=26x+50",
    S: "=34x+50",
    U: "=30x-",
    next: (s, n) => {
      const sides = [0, 1, 3].map((x) => n.sides(s, { x }));
      const ok = sides.every((sd, i) => sd !== null && sd.every((val) => Math.abs(val - (26 * [0, 1, 3][i] + 50)) < 1e-9));
      return v(ok, ok, false, ok, ok ? "combines to 26x + 50 (one step left)" : "not equal to the expression");
    },
  },
  {
    id: "advanced_math-nonlinear-equations-0108",
    kind: "radical equation grid-in (stem relation as head)",
    L1: "x+20=49",
    L2: "x=29",
    S: "x=69",
    U: "x=",
    next: (s, n) => {
      const ok = n.holds(s, { x: 29 }) && !n.holds(s, { x: 28 });
      return v(ok, ok && n.flat(s) !== "x+20=49", false, ok, ok ? "x = 29: one step left" : "wrong");
    },
  },
  {
    id: "advanced_math-nonlinear-equations-0147",
    kind: "quadratic word problem MCQ",
    L1: "w(w+3)=54",
    L2: "w^{2}+3w-54=0",
    S: "w^{2}+3w+54=0",
    U: "w^{2}+3w=",
    next: (s, n) => {
      const f = n.flat(s);
      const ok = n.holds(s, { w: 6 }) && (n.holds(s, { w: -9 }) || /w=6|w-6/.test(f));
      const jumped = /^w=6$|^9$|^l=9$|^w\+3=9$|6\+3=9/.test(f);
      return v(ok, ok && f !== "w(w+3)=54", jumped, ok, jumped ? "jumped to the width or length" : ok ? "expands / rearranges (roots 6 and -9 kept)" : "not equivalent");
    },
  },
  {
    id: "psda-ratios-rates-0001",
    kind: "rates MCQ (arithmetic lines)",
    L1: "4\\cdot60=240",
    L2: "\\frac{18}{45}=0.4",
    S: "\\frac{18}{45}=2.5",
    U: "0.4\\cdot240=",
    next: (s, n) => {
      const f = n.flat(s);
      const sides = n.sides(s, {});
      const tru = sides !== null && sides.every((x) => Math.abs(x - sides[0]) < 1e-9);
      const uses = /18/.test(f) && /45/.test(f);
      const jumped = /96/.test(f) && !/0\.4|18/.test(f);
      return v(tru, tru && uses, jumped, uses, jumped ? "jumped to 96" : uses ? "works the rate 18/45 for this printer" : "true but not this question's next step");
    },
  },
  {
    id: "geometry_trig-right-triangles-trig-0103",
    kind: "right-triangle trig grid-in (word)",
    L1: "h=94\\sin30^{\\circ}",
    L2: "h=94\\cdot\\frac{1}{2}",
    S: "h=94\\cdot\\frac{\\sqrt{3}}{2}",
    U: "h=94\\cdot",
    next: (s, n) => {
      const ok = n.holds(s, { h: 47 });
      return v(ok, ok, false, ok, ok ? "sin 30° = 1/2 (or 47): one step left" : "wrong height");
    },
  },
  {
    id: "advanced_math-nonlinear-functions-0002",
    kind: "plot grid-in (parabola, labelled points)",
    L1: "f(x)=a(x-1)^{2}+9",
    L2: "0=a(4-1)^{2}+9",
    S: "0=a(4-1)^{2}-9",
    U: "a=",
    marks: "On the question's graph the student drew: circled near (4, 0).",
    next: (s, n) => {
      const f = n.flat(s);
      const ok = n.holds(s.replace(/f\(4\)/, "0"), { a: -1 }) && !n.holds(s.replace(/f\(4\)/, "0"), { a: 1 });
      const uses4 = /4/.test(f);
      const jumped = /f\(0\)=8$|^8$/.test(f);
      return v(ok || /a=-1/.test(f), (ok || /a=-1/.test(f)) && uses4, jumped, uses4, jumped ? "jumped to f(0) = 8" : ok ? "substitutes the point (4, 0)" : "not the point (4, 0) in vertex form");
    },
  },
];

/** The figure-marks probe: a general slope formula under marks on the two labelled points. */
export const MARKS_PROBE = {
  id: "algebra-linear-functions-0001",
  line: "m=\\frac{y_{2}-y_{1}}{x_{2}-x_{1}}",
  marks: "On the question's graph the student drew: circled near (0, -2); circled near (2, 1).",
};
