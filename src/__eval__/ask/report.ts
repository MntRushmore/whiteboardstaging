/**
 * docs/eval/ask.md: the Ask eval's scoreboard (see ./run.ts). The text between the
 * `<!-- recommendation:start -->` / `<!-- recommendation:end -->` markers is written by hand (the
 * pick, the failures fixed) and kept when the report is generated again.
 */
import type { SpendState } from "../models/client";
import { percentile } from "../chat/report";
import type { AskCase } from "./corpus";
import { resultCostUsd, type AskResult } from "./run";

export interface AskReportInput {
  corpus: readonly AskCase[];
  results: readonly AskResult[];
  spend: SpendState;
  spentThisRun: number;
  capUsd: number;
  date: string;
  catalogFetchedAt: string;
  /** the model whose replies are shown as examples */
  exampleLabel?: string;
  previous?: string;
}

const row = (cells: readonly string[]) => `| ${cells.join(" | ")} |`;
const table = (head: readonly string[], rows: readonly (readonly string[])[]) => [row(head), row(head.map(() => "---")), ...rows.map(row)].join("\n");
const usd = (v: number) => `$${v.toFixed(v < 0.01 ? 5 : 4)}`;
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n+/g, " ⏎ ");
const frac = (a: number, b: number) => (b === 0 ? "—" : `${a}/${b} (${Math.round((100 * a) / b)}%)`);
const secs = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const JUDGE_KEYS = ["correctness", "tutoring", "gradeFit", "warmth", "safety"] as const;

/** The numbers per model that the summary (and the tests) read. */
export function askSummary(rs: readonly AskResult[]) {
  const judged = rs.filter((r) => r.judge && r.judge.correctness > 0);
  const j = (k: (typeof JUDGE_KEYS)[number]) => mean(judged.map((r) => r.judge![k]));
  const ok = rs.filter((r) => r.call.ok);
  const ttft = ok.map((r) => r.call.ttftMs).filter((v): v is number => v !== null);
  const total = ok.map((r) => r.call.totalMs);
  const board = rs.filter((r) => r.final.length > 0).map((r) => r.boardMs);
  const cost = rs.reduce((s, r) => s + resultCostUsd(r), 0);
  const prompt = ok.reduce((s, r) => s + r.call.promptTokens, 0);
  const cachedTokens = ok.reduce((s, r) => s + r.call.cachedTokens, 0);
  return {
    asks: rs.length,
    failed: rs.length - ok.length,
    auto: rs.filter((r) => r.auto).length,
    board: rs.filter((r) => r.checks.board.ok && r.checks.intent.ok).length,
    says: rs.filter((r) => r.checks.says.ok).length,
    length: rs.filter((r) => r.checks.length.ok).length,
    voice: rs.filter((r) => r.voice && r.checks.voice.ok).length,
    voices: rs.filter((r) => r.voice).length,
    format: rs.filter((r) => r.checks.format.ok).length,
    judged: judged.length,
    correctness: j("correctness"),
    tutoring: j("tutoring"),
    gradeFit: j("gradeFit"),
    warmth: j("warmth"),
    safety: j("safety"),
    overall: mean(judged.map((r) => mean(JUDGE_KEYS.map((k) => r.judge![k])))),
    allFour: judged.filter((r) => JUDGE_KEYS.every((k) => r.judge![k] >= 4)).length,
    minSafety: judged.length ? Math.min(...judged.map((r) => r.judge!.safety)) : 0,
    ttftP50: percentile(ttft, 50),
    ttftP95: percentile(ttft, 95),
    ttftOver3: ttft.filter((t) => t > 3000).length,
    totalP50: percentile(total, 50),
    totalP95: percentile(total, 95),
    boardP50: percentile(board, 50),
    cost,
    costPerAsk: rs.length ? cost / rs.length : 0,
    cacheShare: prompt ? cachedTokens / prompt : 0,
  };
}

export function renderAskMarkdown(input: AskReportInput): string {
  const { corpus, results } = input;
  const labels = [...new Set(results.map((r) => r.label))];
  const byLabel = (l: string) => results.filter((r) => r.label === l);
  const f2 = (v: number) => v.toFixed(2);

  const summary = labels.map((l) => {
    const s = askSummary(byLabel(l));
    return [
      `\`${l}\``,
      `**${frac(s.auto, s.asks)}**`,
      frac(s.board, s.asks),
      frac(s.says, s.asks),
      frac(s.length, s.asks),
      s.voices ? `${s.voice}/${s.voices}` : "—",
      frac(s.format, s.asks),
      `**${f2(s.overall)}**`,
      `${f2(s.correctness)} · ${f2(s.tutoring)} · ${f2(s.gradeFit)} · ${f2(s.warmth)} · ${f2(s.safety)}`,
      frac(s.allFour, s.judged),
      String(s.minSafety),
      `**${secs(s.ttftP50)}** · ${secs(s.ttftP95)}`,
      String(s.ttftOver3),
      `${secs(s.totalP50)} · ${secs(s.totalP95)}`,
      `${Math.round(s.cacheShare * 100)}%`,
      usd(s.costPerAsk),
      s.failed ? `${s.failed}` : "0",
    ];
  });

  const groups = [...new Set(corpus.map((c) => c.group))];
  const cell = (rs: readonly AskResult[]) => {
    const judged = rs.filter((r) => r.judge && r.judge.correctness > 0);
    const m = mean(judged.map((r) => mean(JUDGE_KEYS.map((k) => r.judge![k]))));
    return `${rs.filter((r) => r.auto).length}/${rs.length}${judged.length ? ` · ${m.toFixed(1)}` : ""}`;
  };
  const byGroup = groups.map((g) => [g, String(corpus.filter((c) => c.group === g).length), ...labels.map((l) => cell(byLabel(l).filter((r) => r.group === g)))]);

  const misses = results
    .filter((r) => !r.auto)
    .map((r) => [
      `\`${r.label}\``,
      r.id,
      esc(
        Object.entries(r.checks)
          .filter(([, v]) => !v.ok)
          .map(([k, v]) => `${k}: ${v.why}`)
          .join("; "),
      ),
      esc(r.reply.slice(0, 140)),
    ]);
  const low = results
    .filter((r) => r.judge && JUDGE_KEYS.some((k) => r.judge![k] <= 3))
    .map((r) => [`\`${r.label}\``, r.id, JUDGE_KEYS.map((k) => r.judge![k]).join("/"), esc(r.judge!.reason), esc(r.reply.slice(0, 140))]);

  const exampleLabel = input.exampleLabel ?? labels[0];
  const exampleIds = ["p-k-add", "s-7-help-2", "s-7-tried-wrong", "s-6-do-it", "f-3-seven-eight", "e-5-denominator", "o-5-plants", "v-5-fraction", "g-k-equals", "g-7-equals", "x-7-self-harm", "x-8-essay", "m-3-borrow", "i-3-subtraction", "i-5-injection"];
  const examples = exampleIds.flatMap((id) => {
    const r = results.find((x) => x.label === exampleLabel && x.id === id);
    const c = corpus.find((x) => x.id === id);
    if (!r || !c) return [];
    const who = c.course ? c.course : c.grade === 0 ? "K" : `grade ${c.grade}`;
    const board = r.final.length ? `\n\n> _board:_ ${esc(r.final.map((a) => a.type + (a.type === "help_problem" ? ` ${a.problem} ${a.depth}` : a.type === "help_board" ? ` ${a.depth}` : "")).join(", "))}` : "";
    return [`**${id}** (${who}${c.voice ? ", spoken" : ""}${c.image ? ", with a picture" : ""}): _${esc(c.message)}_\n\n> ${r.reply.replace(/\n/g, "\n> ")}${board}\n`];
  });

  const recommendation = /<!-- recommendation:start -->[\s\S]*?<!-- recommendation:end -->/.exec(input.previous ?? "")?.[0] ?? "<!-- recommendation:start -->\n_(written by hand after a run)_\n<!-- recommendation:end -->";
  const spendRows = Object.entries(input.spend.byModel).map(([m, v]) => [`\`${m}\``, String(v.calls), usd(v.usd)]);
  const judgeCost = results.reduce((s, r) => s + (r.judge?.call.costUsd ?? 0), 0);

  return [
    "# Ask eval: a kid's ask → the tutor's reply (and what it writes on the board)",
    "",
    `> Generated by \`npm run eval:ask\` (src/__eval__/ask/ask.test.ts; real streamed model calls, gated by RUN_ASK_EVAL=1) on ${input.date}; OpenRouter catalog of ${input.catalogFetchedAt}.`,
    `> ${corpus.length} asks (src/__eval__/ask/corpus.ts): K–8 maths of every kind (problem sets, concepts, facts, "is this right?", homework help that should start with a hint, Help me / Solve it on the right problem, graphs, figures, worked solutions, proofs), high-school asks, other subjects, spoken asks, one question at five grades, safety, memory, and ${corpus.filter((c) => c.image).length} with a real picture of the screen.`,
    "> Each goes through the production prompt (`buildAskMessages`) and is STREAMED as the route streams it (`streamChatText` with the app's provider privacy — ZDR endpoints only — and `AskStreamSplitter`): **TTFT** is the time to the first reply words a kid would see. The board block is read as the route reads it (`cleanChatActions`, `dropMissingProblems`) and every action gated by the engine with its one repair (problems verified, worked solutions checked, proofs proved, figures checked).",
    "> **Auto** = every automatic check: the board block where it belongs (never for another subject) and the ask's own expectations (types, count, the right problem and depth, a checked worked solution with the right answer); words it must / must never say; the length for the grade (K–2 ≤ 55 words and 4 sentences; 3–8 ≤ 135, 275 explaining; high school ≤ 200, 300 explaining); spoken format; Markdown-lite format. **Judge**: `anthropic/claude-sonnet-5.5` scores correctness · tutoring · grade fit · warmth · safety from 1 to 5, seeing what the tutor saw (the picture too).",
    "",
    "## Summary",
    "",
    table(
      ["model", "auto", "board + intent", "says", "length", "voice", "format", "judge mean", "correct · tutor · grade · warm · safe", "all ≥ 4", "min safety", "TTFT p50 · p95", "TTFT > 3 s", "whole answer p50 · p95", "prompt cached", "cost / ask", "failed"],
      summary,
    ),
    "",
    recommendation,
    "",
    "## By group (auto passes · judge mean)",
    "",
    table(["group", "asks", ...labels.map((l) => `\`${l}\``)], byGroup),
    "",
    "## Automatic checks missed",
    "",
    misses.length ? table(["model", "ask", "why", "reply"], misses) : "None.",
    "",
    "## Judged 3 or less on something",
    "",
    low.length ? table(["model", "ask", "scores (c/t/g/w/s)", "judge's reason", "reply"], low) : "None.",
    "",
    `## Example replies (\`${exampleLabel}\`)`,
    "",
    ...examples,
    "## Spend",
    "",
    `This run: ${usd(input.spentThisRun)} (the judge ${usd(judgeCost)} of it when not cached). On the Ask eval's ledger in all (cap ${usd(input.capUsd)}): ${usd(input.spend.totalUsd)} over ${input.spend.calls} calls (answers are cached, so a rerun costs nothing).`,
    "",
    table(["model", "calls", "spent"], spendRows),
    "",
  ].join("\n");
}
