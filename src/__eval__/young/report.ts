/**
 * The young kids' section of the offline scoreboard (`docs/eval/offline.md`): the totals, by grade
 * band and by topic, and every column the board marks differently from a teacher, line by line.
 */
import type { YoungCounts, YoungScoreboard, YoungVerdict } from "./young";

const pct = (n: number, d: number) => (d === 0 ? "—" : `${((100 * n) / d).toFixed(1)}%`);
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const code = (s: string) => (s ? `\`${s.replace(/`/g, "'")}\`` : "");

function row(label: string, c: YoungCounts): string {
  return `| ${label} | ${c.total} | **${c.passed}** (${pct(c.passed, c.total)}) | ${c.linesRight}/${c.lines} | ${c.wrongRings} | ${c.missedRings} | ${c.questions} | ${c.falseSolved} | ${c.missedSolved} |`;
}

const HEADER = ["| | columns | pass | lines marked right | wrong rings | missed rings | ? on work | false solved | missed solved |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"];

function failure(v: YoungVerdict): string {
  const marks = v.lines.map((l) => `${code(l.latex)} ${l.pass ? l.got : `**${l.got}** (want ${l.expected})`}`).join("; ");
  const solved = v.solved.got === v.solved.expected ? "" : ` — solved **${v.solved.got}** (want ${v.solved.expected})`;
  return `| ${v.id} | ${v.problem ? code(v.problem) : "(own)"} | ${cell(marks)}${solved} | ${cell(v.note ?? "")} |`;
}

/** The section, as Markdown lines. */
export function renderYoungSection(board: YoungScoreboard): string {
  const { summary, verdicts } = board;
  const failing = verdicts.filter((v) => !v.pass);
  return [
    "## Young kids' working (K–6)",
    "",
    "> A child's column of working — side calculations, partial products, columns, a long-division bracket,",
    "> remainders, fraction and decimal steps — marked as the board marks it (`src/lib/live/engine/columnWork.ts`,",
    "> Feedback, Auto on) and compared with a teacher's marks, line by line. Corpus: `src/__eval__/young/corpus.ts`.",
    "> A wrong ring is a ring on right work.",
    "",
    `**${summary.passed} / ${summary.total} columns marked as a teacher would (${pct(summary.passed, summary.total)}).**`,
    "",
    ...HEADER,
    row("all", summary),
    ...summary.byGrade.map((g) => row(`grades ${g.grade}`, g)),
    ...summary.byTopic.map((t) => row(t.topic, t)),
    "",
    "### Columns marked differently",
    "",
    failing.length === 0 ? "None." : ["| id | problem | marks | note |", "| --- | --- | --- | --- |", ...failing.map(failure)].join("\n"),
    "",
  ].join("\n");
}
