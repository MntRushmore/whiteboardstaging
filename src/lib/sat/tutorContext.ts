import type { SatFigure, SatQuestion } from "@/lib/sat/contracts";

/**
 * The live tutor's problem context on an SAT page (docs/SAT-V2.md "The tutor on an SAT page"). Pure:
 * src/lib/server/sat/context.ts reads the question from the bank.
 *
 * When a Live call carries `sat_question_id`, the model is told the problem from the BANK (its stem,
 * choices, a text description of its figure, and its solution steps), never from text the client
 * sent, plus the student's marks on the figure (`sat_figure_marks`) when the iPad sends them. The
 * steps keep Help me's next step on the bank's path; the model is told not to show them unless the
 * student asks for the solution.
 */

/** `sat_figure_marks`: at most this many characters (longer is ignored, not refused). */
export const SAT_FIGURE_MARKS_MAX = 300;

const num = (n: number) => String(Math.round(n * 1000) / 1000);
const pt = (p: readonly [number, number]) => `(${num(p[0])}, ${num(p[1])})`;

/** A short plain-text description of a figure: axes, points, functions, table cells, shape labels. */
export function describeFigure(fig: SatFigure): string {
  if (fig.kind === "table") {
    return [`A table with columns ${fig.headers.map((h) => h || "(blank)").join(" | ")}.`, ...fig.rows.map((r) => `Row: ${r.join(" | ")}.`)].join(" ");
  }
  if (fig.kind === "plot") {
    const axis = (name: string, a: { min: number; max: number; step: number; label?: string }) => `${name} from ${num(a.min)} to ${num(a.max)} (grid step ${num(a.step)}${a.label ? `, labelled "${a.label}"` : ""})`;
    const out = [`A coordinate plane: ${axis("x", fig.x)}, ${axis("y", fig.y)}.`];
    const points = fig.items.filter((i) => i.type === "point");
    const unlabelled = points.filter((p) => p.type === "point" && !p.label);
    for (const it of fig.items) {
      if (it.type === "function") out.push(`The graph of y = ${it.expr.replace(/\*\*/g, "^")}.`);
      else if (it.type === "segment") out.push(`A segment from ${pt(it.from)} to ${pt(it.to)}.`);
      else if (it.type === "point" && it.label) out.push(`A point at ${pt(it.at)} labelled "${it.label}".`);
      else if (it.type === "bar") out.push(`A bar at x = ${num(it.x)} of height ${num(it.height)}${it.label ? ` labelled "${it.label}"` : ""}.`);
    }
    // a scatterplot's points, all together
    if (unlabelled.length) out.push(`${unlabelled.length === 1 ? "A point" : `${unlabelled.length} points`} at ${unlabelled.map((p) => (p.type === "point" ? pt(p.at) : "")).join(", ")}.`);
    return out.join(" ");
  }
  const out = ["A geometric figure (its own units, y up)."];
  for (const it of fig.items) {
    if (it.type === "polygon") out.push(`A polygon with vertices ${it.points.map(pt).join(", ")}.`);
    else if (it.type === "circle") out.push(`A circle with centre ${pt(it.center)} and radius ${num(it.r)}.`);
    else if (it.type === "segment") out.push(`A ${it.dashed ? "dashed " : ""}segment from ${pt(it.from)} to ${pt(it.to)}.`);
    else if (it.type === "label") out.push(`The label "${it.text}" at ${pt(it.at)}.`);
    else if (it.type === "right_angle") out.push(`A right angle mark at ${pt(it.at)}.`);
    else if (it.type === "arc_angle") out.push(`An angle at ${pt(it.at)} between the rays at ${num(it.from)} and ${num(it.to)} degrees${it.label ? `, labelled "${it.label}"` : ""}.`);
  }
  if (fig.note) out.push(fig.note);
  return out.join(" ");
}

/**
 * The student's marks on the figure as the iPad describes them ("circled near (2, 31)"): trimmed,
 * one line, plain text, at most 300 characters. Anything else (not a string, empty, too long, or
 * with control characters) is ignored: null.
 */
export function satFigureMarksOf(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const v = (raw as Record<string, unknown>).sat_figure_marks;
  if (typeof v !== "string") return null;
  const t = v.trim();
  // eslint-disable-next-line no-control-regex
  if (!t || t.length > SAT_FIGURE_MARKS_MAX || /[\u0000-\u001f\u007f]/.test(t)) return null;
  return t;
}

/** The block the model reads: the bank's problem, its solution path (guidance only), the student's marks. */
export function satContextBlock(q: Pick<SatQuestion, "id" | "skill" | "format" | "stem" | "figure" | "choices" | "solution">, marks: string | null = null): string {
  const lines = [
    "SAT PRACTICE PAGE. The problem the student is working on is this question from Agathon's own question bank. It is THE problem: any text on the page is the student's own writing, not the problem.",
    `Question ${q.id} (${q.skill}; ${q.format === "mcq" ? "multiple choice: the student picks A, B, C or D" : "grid-in: the student enters a number"}):`,
    q.stem,
  ];
  if (q.figure) lines.push(`Figure: ${describeFigure(q.figure)}`);
  if (q.choices) lines.push(`Choices: ${q.choices.map((c) => `${c.key}) ${c.text}`).join("  ")}`);
  lines.push(
    "The bank's solution path, for your guidance only: keep checks, hints and the next step on this path, and do not show these steps or the final answer unless the student asks for the solution.",
    ...q.solution.steps.map((s, i) => `${i + 1}. ${s.text}${s.math ? ` [${s.math}]` : ""}`),
  );
  if (marks) lines.push(`The student's marks on the figure (in the figure's coordinates): ${marks.slice(0, SAT_FIGURE_MARKS_MAX)}`);
  return lines.join("\n");
}

/** `messages` with the SAT block appended to the first system message (or a system message put first). */
export function withSatContext<M extends { role: string; content: unknown }>(messages: readonly M[], block: string | null): M[] {
  if (!block) return [...messages];
  const i = messages.findIndex((m) => m.role === "system" && typeof m.content === "string");
  if (i < 0) return [{ role: "system", content: block } as M, ...messages];
  return messages.map((m, j) => (j === i ? { ...m, content: `${m.content as string}\n\n${block}` } : m));
}
