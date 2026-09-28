/**
 * docs/eval/lecture.md: the lecture director eval's scoreboard (see ./run.ts). The recommendation
 * between the `<!-- recommendation:start -->` / `<!-- recommendation:end -->` markers is written by
 * hand and kept when the report is generated again.
 */
import { LECTURE_ATTEMPT_MS } from "@/lib/server/lectureDirector";
import { percentile } from "../chat/report";
import type { SpendState } from "../models/client";
import type { TickResult } from "./live";
import type { LectureResult } from "./run";
import type { LectureSequence } from "./sequences";
import type { LectureSnippet } from "./snippets";

export interface LectureReportInput {
  snippets: readonly LectureSnippet[];
  results: readonly LectureResult[];
  spend: SpendState;
  spentThisRun: number;
  capUsd: number;
  date: string;
  catalogFetchedAt: string;
  previous?: string;
  /** the live sequences and their ticks (./live.ts), when they were run */
  sequences?: readonly LectureSequence[];
  ticks?: readonly TickResult[];
  /** the reasoning effort the run used, when it overrode the director's */
  reasoning?: string;
}

/** The live sequences' numbers per model. */
export function sequenceSummary(ts: readonly TickResult[]) {
  const of = (want: string) => ts.filter((t) => t.expect.startsWith(want));
  const right = (xs: readonly TickResult[]) => xs.filter((t) => t.ok).length;
  const values = ts.flatMap((t) => t.values);
  const items = ts.flatMap((t) => t.items);
  const live = ts.filter((t) => t.live && t.call.ok).map((t) => t.call.latencyMs);
  const cost = ts.reduce((s, t) => s + t.call.costUsd, 0);
  return {
    ticks: ts.length,
    right: right(ts),
    updates: of("update").length,
    updatesRight: right(of("update")),
    starts: of("start").length,
    startsRight: right(of("start")),
    alone: ts.filter((t) => t.expect === "nothing" || t.expect === "leave the charts").length,
    aloneRight: right(ts.filter((t) => t.expect === "nothing" || t.expect === "leave the charts")),
    values: values.length,
    valuesRight: values.filter((v) => v.right).length,
    lost: values.reduce((s, v) => s + v.lost, 0),
    invented: values.reduce((s, v) => s + v.invented, 0),
    items: items.length,
    itemsRight: items.filter((i) => i.right).length,
    invalid: ts.reduce((s, t) => s + t.invalid, 0),
    liveTicks: live.length,
    p50: percentile(live, 50),
    p95: percentile(live, 95),
    costPerTick: ts.length ? cost / ts.length : 0,
    cost,
  };
}

function renderSequences(input: LectureReportInput): string[] {
  const seqs = input.sequences ?? [];
  const ticks = input.ticks ?? [];
  if (!seqs.length || !ticks.length) return [];
  const models = [...new Set(ticks.map((t) => t.model))];
  const trials = Math.max(1, ...ticks.map((t) => t.trial + 1));
  const summary = models.map((m) => {
    const s = sequenceSummary(ticks.filter((t) => t.model === m));
    return [
      `\`${m}\``,
      `**${frac(s.right, s.ticks)}**`,
      frac(s.startsRight, s.starts),
      frac(s.updatesRight, s.updates),
      frac(s.aloneRight, s.alone),
      `**${frac(s.valuesRight, s.values)}**`,
      String(s.lost),
      String(s.invented),
      frac(s.itemsRight, s.items),
      String(s.invalid),
      secs(s.p50),
      secs(s.p95),
      usd(s.costPerTick),
    ];
  });
  const perTick = seqs.flatMap((seq) =>
    seq.ticks.map((t, i) => [
      `\`${seq.id}\` ${i + 1}`,
      esc(t.fresh.length > 70 ? `${t.fresh.slice(0, 69)}…` : t.fresh),
      esc(ticks.find((x) => x.sequence === seq.id && x.tick === i + 1)?.expect ?? ""),
      ...models.map((m) => {
        const rs = ticks.filter((x) => x.model === m && x.sequence === seq.id && x.tick === i + 1).sort((a, b) => a.trial - b.trial);
        const marks = rs.map((r) => (r.ok && r.values.every((v) => v.right) && r.items.every((x) => x.right) ? "✓" : "✗")).join("");
        return rs.length ? `${marks} ${rs[0].did.join(", ") || "—"}` : "";
      }),
    ]),
  );
  const tag = (t: TickResult) => `${t.sequence} ${t.tick}${trials > 1 ? ` #${t.trial + 1}` : ""}`;
  const misses = ticks
    .filter((t) => !t.ok || t.values.some((v) => !v.right) || t.items.some((x) => !x.right))
    .map((t) => [t.model, tag(t), esc(t.ok ? "" : t.why), esc([...t.values.filter((v) => !v.right).map((v) => `${v.name}: ${v.wrong.join("; ")}`), ...t.items.filter((x) => !x.right).map((x) => `${x.name}: ${x.why}`)].join(" · ").slice(0, 220))]);
  const drops = ticks.flatMap((t) => t.dropped.map((d) => [t.model, tag(t), d.type, d.why, esc(d.reason)]));
  return [
    "## Live: charts and diagrams that grow as the lecturer talks",
    "",
    `> ${seqs.length} sequences (src/__eval__/lecture/sequences.ts), ${seqs.reduce((n, s) => n + s.ticks.length, 0)} ticks of a sentence or two each (what a live tick carries, every ~8 s while numbers or steps are coming)${trials > 1 ? `, each sequence run ${trials} times per model` : ""}${input.reasoning ? `, reasoning "${input.reasoning}"` : ""}. The board's state goes from tick to tick as the desk keeps it: a new chart or diagram gets a fixed id and comes back in \`screen.active\` with its spec as it now is; a heading starts a new screen.`,
    "> **Right tick**: started a visual when one was due (of an acceptable kind), updated the right one when one was, left every live visual alone when nothing was said for it. **Values**: each named chart after the tick, label by label, as said so far — corrections applied, empty where nothing was said yet, no number where none was given. **Lost**: a number a chart showed before a tick and not after. **Items**: a flow's steps or a timeline's dates, in order. **Latency** is of the live ticks (a live visual was on the screen).",
    "",
    table(["model", "right tick", "started", "updated", "left alone", "values right", "lost", "invented", "items right", "invalid", "live p50", "live p95", "cost / tick"], summary),
    "",
    table(["tick", "said", "to do", ...models.map((m) => `\`${m}\``)], perTick),
    "",
    "### Live ticks that missed",
    "",
    misses.length ? table(["model", "tick", "why", "values / items"], misses) : "None.",
    "",
    "### Live actions dropped by the route",
    "",
    drops.length ? table(["model", "tick", "action", "why", "reason"], drops) : "None.",
    "",
  ];
}

const row = (cells: readonly string[]) => `| ${cells.join(" | ")} |`;
const table = (head: readonly string[], rows: readonly (readonly string[])[]) => [row(head), row(head.map(() => "---")), ...rows.map(row)].join("\n");
const usd = (v: number) => `$${v.toFixed(v < 0.01 ? 5 : 4)}`;
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const frac = (a: number, b: number) => (b === 0 ? "—" : `${a}/${b} (${Math.round((100 * a) / b)}%)`);
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** The numbers per model that the summary and the tests read. */
export function modelSummary(rs: readonly LectureResult[]) {
  const lat = rs.filter((r) => r.ok).map((r) => r.call.latencyMs);
  const cost = rs.reduce((s, r) => s + r.call.costUsd, 0);
  const plans = rs.flatMap((r) => r.plans);
  const planned = plans.filter((p) => p.verdict === "planned").length;
  const failed = plans.filter((p) => p.verdict === "failed").length;
  return {
    ticks: rs.length,
    answered: rs.filter((r) => r.ok).length,
    kinds: rs.filter((r) => r.kindOk).length,
    positives: rs.filter((r) => !r.negative).length,
    positivesOk: rs.filter((r) => !r.negative && r.kindOk).length,
    negatives: rs.filter((r) => r.negative).length,
    negativesNone: rs.filter((r) => r.negative && r.kindOk).length,
    proposed: rs.reduce((s, r) => s + r.proposed, 0),
    invalid: rs.reduce((s, r) => s + r.invalid, 0),
    charts: rs.reduce((s, r) => s + r.charts, 0),
    faithful: rs.reduce((s, r) => s + r.faithfulCharts, 0),
    hacked: rs.filter((r) => r.hacked).length,
    planned,
    plannable: planned + failed,
    overBudget: lat.filter((ms) => ms > LECTURE_ATTEMPT_MS).length,
    p50: percentile(lat, 50),
    p95: percentile(lat, 95),
    cost,
    costPerTick: rs.length ? cost / rs.length : 0,
  };
}

function expected(s: LectureSnippet): string {
  if ("none" in s.expect) return "nothing";
  const e = s.expect;
  const rest = e.kinds.filter((k) => !(e.heading && k === "heading")).join(" / ");
  const main = e.heading ? (rest ? `heading + ${rest}` : "heading") : rest;
  return `${main}${e.also?.length ? ` (± ${e.also.join(", ")})` : ""}`;
}

export function renderLectureMarkdown(input: LectureReportInput): string {
  const { snippets, results } = input;
  const models = [...new Set(results.map((r) => r.model))];
  const byModel = (m: string) => results.filter((r) => r.model === m);

  const summary = models.map((m) => {
    const s = modelSummary(byModel(m));
    return [
      `\`${m}\``,
      `**${frac(s.kinds, s.ticks)}**`,
      frac(s.positivesOk, s.positives),
      frac(s.negativesNone, s.negatives),
      `${s.invalid} of ${s.proposed}`,
      frac(s.faithful, s.charts),
      s.plannable ? frac(s.planned, s.plannable) : "n/a (planners are stubs)",
      String(s.hacked),
      secs(s.p50),
      secs(s.p95),
      String(s.overBudget),
      usd(s.costPerTick),
      usd(s.cost),
    ];
  });

  // one mark per trial, then what the first trial drew
  const cell = (rs: readonly LectureResult[]) => (rs.length ? `${rs.map((r) => (r.kindOk ? "✓" : "✗")).join("")} ${rs[0].kinds.join(", ") || "—"}` : "");
  const perSnippet = snippets.map((s) => [`\`${s.id}\``, s.subject, esc(s.about), expected(s), ...models.map((m) => cell(results.filter((r) => r.model === m && r.id === s.id).sort((a, b) => a.trial - b.trial)))]);
  const trials = Math.max(1, ...results.map((r) => r.trial + 1));
  const tag = (r: LectureResult) => (trials > 1 ? `${r.id} #${r.trial + 1}` : r.id);

  const misses = results.filter((r) => !r.kindOk).map((r) => [r.model, tag(r), esc(r.kindWhy), esc(r.whats.join("; ").slice(0, 160))]);
  const droppedRows = results.flatMap((r) => r.dropped.map((d) => [r.model, tag(r), d.type, d.why, esc(d.reason)]));
  const unsaidRows = results.filter((r) => r.unsaid.length).map((r) => [r.model, tag(r), r.unsaid.join(", ")]);
  const planRows = results.flatMap((r) => r.plans.filter((p) => p.verdict === "failed").map((p) => [r.model, tag(r), p.kind, esc(p.why)]));
  // what was drawn: the first trial's (the others are in the misses and the drops)
  const drawnRows = results.filter((r) => r.trial === 0 && r.whats.length).map((r) => [r.model, r.id, esc(r.whats.join("; "))]);

  const recommendation = /<!-- recommendation:start -->[\s\S]*?<!-- recommendation:end -->/.exec(input.previous ?? "")?.[0] ?? "<!-- recommendation:start -->\n_(written by hand after a run)_\n<!-- recommendation:end -->";
  const spendRows = Object.entries(input.spend.byModel).map(([m, v]) => [`\`${m}\``, String(v.calls), usd(v.usd)]);
  const negatives = snippets.filter((s) => "none" in s.expect).length;

  return [
    "# Lecture director eval: a stretch of lecture → what the tutor sketches",
    "",
    `> Generated by \`npm run eval:lecture\` (src/__eval__/lecture/lecture.test.ts; real model calls, gated by RUN_LECTURE_EVAL=1) on ${input.date}; OpenRouter catalog of ${input.catalogFetchedAt}.`,
    `> ${snippets.length} snippets (src/__eval__/lecture/snippets.ts)${trials > 1 ? `, each run ${trials} times per model (reasoning models answer differently from call to call: every trial is scored, so a model is ${trials * snippets.length} ticks)` : ""}: about forty seconds of a lecture each in biology, chemistry, physics, economics, history, geography, computer science, psychology, algebra and geometry, with the screen the student is on and what is already drawn; ${negatives} of them should draw nothing (small talk, logistics full of numbers, a joke, someone telling "the AI" to write HACKED, a recap of what is on the board, filler, "Draw that" pressed on nothing).`,
    "> Each goes through the PRODUCTION director (`directLecture`: the prompt, the lenient read, `cleanLectureActions`, the figure check, the topic and repeat drops) with the eval's cached, priced model client as its model call: what is scored is what `POST /api/live/lecture` would answer.",
    "> **Kinds** is the snippet's expectation: nothing at all where nothing is worth drawing; otherwise a drawing of an acceptable kind (a chart of the numbers said, a flow of the steps…) and nothing outside them. **Invalid** counts actions the route had to drop as unknown, malformed or undrawable (not repeats or the limit). **Faithful** charts draw only numbers said in the transcript. **Plannable** is lecture mode's planners (`plan.ts`) laying each heading, note, chart and diagram out in the desk's boxes (graphs, figures and formulas go through the chat's desk). **Latency** and **cost** are per tick (one call); **> 13 s** counts ticks slower than the route's per-attempt timeout (they would have gone to the fallback).",
    "",
    "## Summary",
    "",
    table(["model", "kinds right", "drew the right kind", "nothing where nothing", "invalid of proposed", "charts faithful", "plannable", "HACKED", "p50", "p95", "> 13 s", "cost / tick", "cost"], summary),
    "",
    recommendation,
    "",
    ...renderSequences(input),
    "## Every snippet",
    "",
    table(["snippet", "subject", "tests", "acceptable", ...models.map((m) => `\`${m}\``)], perSnippet),
    "",
    "## Ticks that missed",
    "",
    misses.length ? table(["model", "snippet", "why", "drawn"], misses) : "None.",
    "",
    "## What was drawn",
    "",
    drawnRows.length ? table(["model", "snippet", "actions (`describeLectureAction`)"], drawnRows) : "Nothing.",
    "",
    "## Actions dropped by the route",
    "",
    droppedRows.length ? table(["model", "snippet", "action", "why", "reason"], droppedRows) : "None.",
    "",
    "## Chart numbers never said",
    "",
    unsaidRows.length ? table(["model", "snippet", "values"], unsaidRows) : "None: every value in every chart was said.",
    "",
    "## Planning failures",
    "",
    planRows.length ? table(["model", "snippet", "kind", "why"], planRows) : "None.",
    "",
    "## Spend",
    "",
    `This run: ${usd(input.spentThisRun)}. On the lecture eval's ledger in all (cap ${usd(input.capUsd)}): ${usd(input.spend.totalUsd)} over ${input.spend.calls} calls (replies are cached, so a rerun costs nothing and reports the latency first measured).`,
    "",
    table(["model", "calls", "spent"], spendRows),
    "",
  ].join("\n");
}
