/**
 * docs/eval/chat.md: the board chat eval's scoreboard (see ./run.ts). The recommendation between
 * the `<!-- recommendation:start -->` / `<!-- recommendation:end -->` markers is written by hand and
 * kept when the report is generated again.
 */
import type { SpendState } from "../models/client";
import type { ChatCase } from "./corpus";
import { requestCostUsd, requestLatencyMs, type ChatResult } from "./run";

export interface ChatReportInput {
  corpus: readonly ChatCase[];
  results: readonly ChatResult[];
  spend: SpendState;
  spentThisRun: number;
  capUsd: number;
  date: string;
  catalogFetchedAt: string;
  previous?: string;
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

const row = (cells: readonly string[]) => `| ${cells.join(" | ")} |`;
const table = (head: readonly string[], rows: readonly (readonly string[])[]) => [row(head), row(head.map(() => "---")), ...rows.map(row)].join("\n");
const usd = (v: number) => `$${v.toFixed(v < 0.01 ? 5 : 4)}`;
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const frac = (a: number, b: number) => (b === 0 ? "—" : `${a}/${b} (${Math.round((100 * a) / b)}%)`);
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** The numbers per model that the summary and the tests read. */
export function modelSummary(rs: readonly ChatResult[]) {
  const problems = rs.flatMap((r) => r.problems);
  const figures = rs.flatMap((r) => r.figures);
  const graphs = rs.flatMap((r) => r.graphs);
  const lat = rs.filter((r) => r.call.ok).map(requestLatencyMs);
  const cost = rs.reduce((s, r) => s + requestCostUsd(r), 0);
  return {
    requests: rs.length,
    json: rs.filter((r) => r.json).length,
    proposed: rs.reduce((s, r) => s + r.proposed, 0),
    valid: rs.reduce((s, r) => s + r.valid, 0),
    intent: rs.filter((r) => r.intent).length,
    problems: problems.length,
    verified: problems.filter((p) => p.verdict === "verified").length,
    clean: problems.filter((p) => p.clean).length,
    figures: figures.length,
    figureSchema: figures.filter((f) => f.schema).length,
    figureCleanFirst: figures.filter((f) => f.cleanFirst).length,
    figureClean: figures.filter((f) => f.cleanAfterRepair).length,
    figureDrawn: figures.filter((f) => f.drawn).length,
    figureCases: rs.filter((r) => r.kind === "figure").length,
    graphs: graphs.length,
    graphed: graphs.filter((g) => g.graphed).length,
    p50: percentile(lat, 50),
    p95: percentile(lat, 95),
    cost,
    costPerRequest: rs.length ? cost / rs.length : 0,
  };
}

export function renderChatMarkdown(input: ChatReportInput): string {
  const { corpus, results } = input;
  const models = [...new Set(results.map((r) => r.model))];
  const byModel = (m: string) => results.filter((r) => r.model === m);
  const n = corpus.length;

  const summary = models.map((m) => {
    const s = modelSummary(byModel(m));
    return [
      `\`${m}\``,
      frac(s.json, s.requests),
      frac(s.valid, s.proposed),
      `**${frac(s.intent, s.requests)}**`,
      `**${frac(s.verified, s.problems)}**`,
      frac(s.clean, s.verified),
      `${s.figureSchema}/${s.figures} · ${s.figureCleanFirst} → ${s.figureClean} · ${s.figureDrawn}`,
      frac(s.graphed, s.graphs),
      secs(s.p50),
      secs(s.p95),
      usd(s.costPerRequest),
      usd(s.cost),
    ];
  });

  const kinds = [...new Set(corpus.map((c) => c.kind))];
  const courses = [...new Set(corpus.map((c) => c.course))];
  const cell = (rs: readonly ChatResult[]) => {
    const ok = rs.filter((r) => r.intent).length;
    const p = rs.flatMap((r) => r.problems);
    const v = p.filter((x) => x.verdict === "verified").length;
    return `${ok}/${rs.length}${p.length ? ` · ${v}/${p.length} verified` : ""}`;
  };
  const byKind = kinds.map((k) => [k, String(corpus.filter((c) => c.kind === k).length), ...models.map((m) => cell(byModel(m).filter((r) => r.kind === k)))]);
  const byCourse = courses.map((k) => [k, String(corpus.filter((c) => c.course === k).length), ...models.map((m) => cell(byModel(m).filter((r) => r.course === k)))]);

  const misses = results
    .filter((r) => !r.intent)
    .map((r) => [r.model, r.id, esc(r.intentWhy), esc(r.reply.slice(0, 90))]);
  const unverified = results.flatMap((r) =>
    r.problems.filter((p) => p.verdict !== "verified").map((p) => [r.model, r.id, `\`${esc(p.lines.join("; "))}\``, p.verdict]),
  );
  const droppedRows = results.flatMap((r) => r.dropped.map((d) => [r.model, r.id, d.type, esc(d.reason)]));
  const figureRows = results.flatMap((r) =>
    r.figures.map((f) => [r.model, r.id, f.schema ? "yes" : "no", f.cleanFirst ? "yes" : "no", f.cleanAfterRepair ? "yes" : "no", f.drawn ? "yes" : "no", esc(f.problems.slice(0, 2).join("; ").slice(0, 160))]),
  );

  const recommendation = /<!-- recommendation:start -->[\s\S]*?<!-- recommendation:end -->/.exec(input.previous ?? "")?.[0] ?? "<!-- recommendation:start -->\n_(written by hand after a run)_\n<!-- recommendation:end -->";
  const spendRows = Object.entries(input.spend.byModel).map(([m, v]) => [`\`${m}\``, String(v.calls), usd(v.usd)]);

  return [
    "# Board chat eval: a typed request → what the tutor writes",
    "",
    `> Generated by \`npm run eval:chat\` (src/__eval__/chat/chat.test.ts; real model calls, gated by RUN_CHAT_EVAL=1) on ${input.date}; OpenRouter catalog of ${input.catalogFetchedAt}.`,
    `> ${n} requests (src/__eval__/chat/corpus.ts) over Algebra 1, Algebra 2, Geometry and Calculus problem sets, graphs, figures, and mixed or follow-up requests ("3 more like these" with the screen, "graph that", a new screen, clear, a formula, "solve it for me", two requests to decline).`,
    "> Each goes through the production prompt and the route's reading of the reply (`cleanChatActions`: an invalid action is dropped). Then as the board does it: every problem verified by the engine (`verifyProblem`: it reads, is not false, `localSolve` answers it, the hand can write it); every figure checked by the drawer (`checkFigure`), given the route's one repair round-trip when it has problems, and drawn (`planFigure`); every graph's relations graphed by the engine (`graphFor`).",
    "> **Intent** is the request's own expectations: the action types it needs, the number of problems asked for, a window when a range was asked for, no answer written for \"solve it for me\", no action for a request that is not maths help. **Latency** and **cost** are per request, the figure repair included.",
    "",
    "## Summary",
    "",
    table(
      ["model", "JSON", "valid actions", "intent", "problems verified", "clean answers", "figures: schema · check-clean first → after repair · drawn", "graphs graphed", "p50", "p95", "cost / request", "cost"],
      summary,
    ),
    "",
    recommendation,
    "",
    "## By kind of request",
    "",
    table(["kind", "requests", ...models.map((m) => `\`${m}\``)], byKind),
    "",
    "## By course",
    "",
    table(["course", "requests", ...models.map((m) => `\`${m}\``)], byCourse),
    "",
    "## Requests that missed",
    "",
    misses.length ? table(["model", "request", "why", "reply"], misses) : "None.",
    "",
    "## Problems the engine did not verify",
    "",
    unverified.length ? table(["model", "request", "problem", "why"], unverified) : "None.",
    "",
    "## Actions dropped by the route",
    "",
    droppedRows.length ? table(["model", "request", "action", "why"], droppedRows) : "None.",
    "",
    "## Figures",
    "",
    figureRows.length ? table(["model", "request", "schema", "check-clean first", "after repair", "drawn", "first problems"], figureRows) : "None.",
    "",
    "## Spend",
    "",
    `This run: ${usd(input.spentThisRun)}. On the chat eval's ledger in all (cap ${usd(input.capUsd)}): ${usd(input.spend.totalUsd)} over ${input.spend.calls} calls (replies are cached, so a rerun costs nothing).`,
    "",
    table(["model", "calls", "spent"], spendRows),
    "",
  ].join("\n");
}
