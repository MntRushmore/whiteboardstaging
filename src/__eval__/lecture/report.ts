/**
 * docs/eval/lecture.md: the lecture director eval's scoreboard (see ./run.ts). The recommendation
 * between the `<!-- recommendation:start -->` / `<!-- recommendation:end -->` markers is written by
 * hand and kept when the report is generated again.
 */
import { LECTURE_LIMITS } from "@/lib/live/lecture/contracts";
import { LECTURE_ATTEMPT_MS } from "@/lib/server/lectureDirector";
import { BULLET_ASK_MAX, BULLET_ONE_LINE } from "@/lib/server/prompts/lecture";
import { percentile } from "../chat/report";
import type { SpendState } from "../models/client";
import type { SequenceRun, TickResult } from "./live";
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
  /** the SLIDES sequences' runs (./live.ts: their ticks, the deck each built and its score), when they were run */
  slideSequences?: readonly LectureSequence[];
  runs?: readonly SequenceRun[];
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
    alone: ts.filter((t) => t.expect === "nothing" || t.expect === "leave the visuals").length,
    aloneRight: right(ts.filter((t) => t.expect === "nothing" || t.expect === "leave the visuals")),
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

/** The SLIDES sequences' numbers per model: the decks, and the ticks they were built in. */
export function slideSummary(runs: readonly SequenceRun[]) {
  const ticks = runs.flatMap((r) => r.ticks);
  const scores = runs.flatMap((r) => (r.score ? [r.score] : []));
  const sum = (f: (s: (typeof scores)[number]) => number) => scores.reduce((n, s) => n + f(s), 0);
  const visual = ticks.filter((t) => t.expect.startsWith("start") || t.expect.startsWith("update") || t.expect.startsWith("grow"));
  const lat = ticks.filter((t) => t.call.ok).map((t) => t.call.latencyMs);
  const cost = ticks.reduce((s, t) => s + t.call.costUsd, 0);
  const values = ticks.flatMap((t) => t.values);
  const items = ticks.flatMap((t) => t.items);
  return {
    runs: runs.length,
    ticks: ticks.length,
    right: ticks.filter((t) => t.ok && t.values.every((v) => v.right) && t.items.every((x) => x.right)).length,
    titles: sum((s) => s.titles),
    titlesRight: sum((s) => s.titlesRight),
    titlesLate: sum((s) => s.titlesLate),
    stray: sum((s) => s.stray.length),
    notFirst: sum((s) => s.notFirst.length),
    points: sum((s) => s.points),
    pointsBulleted: sum((s) => s.pointsBulleted),
    pointsLate: sum((s) => s.pointsLate),
    bullets: sum((s) => s.bullets),
    oneLine: sum((s) => s.oneLine),
    overAsk: sum((s) => s.overAsk.length),
    longest: Math.max(0, ...scores.map((s) => s.longest)),
    cut: sum((s) => s.cut),
    dupes: sum((s) => s.dupes.length),
    caught: sum((s) => s.caught),
    mostOnATopic: Math.max(0, ...scores.map((s) => s.mostOnATopic)),
    continued: sum((s) => s.continued),
    restating: sum((s) => s.restating.length),
    filler: sum((s) => s.filler),
    fillerSilent: sum((s) => s.fillerSilent),
    visuals: visual.length,
    visualsRight: visual.filter((t) => t.ok).length,
    values: values.length,
    valuesRight: values.filter((v) => v.right).length,
    items: items.length,
    itemsRight: items.filter((i) => i.right).length,
    invalid: ticks.reduce((s, t) => s + t.invalid, 0),
    p50: percentile(lat, 50),
    p95: percentile(lat, 95),
    costPerTick: ticks.length ? cost / ticks.length : 0,
    cost,
  };
}

/** A deck as markdown: each slide's title, its bullets, its visual. */
export function renderDeck(run: SequenceRun): string[] {
  return run.slides.flatMap((s, i) => {
    const title = `${s.title ?? "(no title)"}${s.cont ? " (cont.)" : ""}`;
    const parts = [...s.bullets.map((b) => `    - ${esc(b)}`), ...s.visuals.map((v) => `    - _${esc(v)}_`)];
    return [`${i + 1}. **${esc(title)}**`, ...(parts.length ? parts : ["    - (nothing)"])];
  });
}

function renderSlides(input: LectureReportInput): string[] {
  const seqs = input.slideSequences ?? [];
  const runs = input.runs ?? [];
  if (!seqs.length || !runs.some((r) => r.score)) return [];
  const slideRuns = runs.filter((r) => seqs.some((s) => s.id === r.sequence));
  const models = [...new Set(slideRuns.map((r) => r.model))];
  const trials = Math.max(1, ...slideRuns.map((r) => r.trial + 1));
  const summary = models.map((m) => {
    const s = slideSummary(slideRuns.filter((r) => r.model === m));
    return [
      `\`${m}\``,
      `**${frac(s.right, s.ticks)}**`,
      frac(s.titlesRight, s.titles) + (s.titlesLate ? ` (${s.titlesLate} late)` : "") + (s.notFirst ? `, ${s.notFirst} not first` : ""),
      String(s.stray),
      `**${frac(s.pointsBulleted, s.points)}**` + (s.pointsLate ? ` (${s.pointsLate} late)` : ""),
      String(s.bullets),
      frac(s.oneLine, s.bullets),
      `${s.longest}${s.overAsk ? ` (${s.overAsk} over ${BULLET_ASK_MAX})` : ""}${s.cut ? `, ${s.cut} cut` : ""}`,
      `**${s.dupes}**`,
      String(s.caught),
      String(s.mostOnATopic),
      String(s.restating),
      frac(s.visualsRight, s.visuals),
      frac(s.valuesRight, s.values),
      frac(s.itemsRight, s.items),
      frac(s.fillerSilent, s.filler),
      String(s.invalid),
      secs(s.p50),
      secs(s.p95),
      usd(s.costPerTick),
    ];
  });
  const ticks = slideRuns.flatMap((r) => r.ticks);
  const perTick = seqs.flatMap((seq) =>
    seq.ticks.map((t, i) => {
      const todo = [t.title ? "title" : "", ticks.find((x) => x.sequence === seq.id && x.tick === i + 1)?.expect ?? "", t.points?.length ? `${t.points.length} point${t.points.length > 1 ? "s" : ""}` : ""].filter(Boolean).join("; ");
      return [
        `\`${seq.id}\` ${i + 1}`,
        esc(t.fresh.length > 70 ? `${t.fresh.slice(0, 69)}…` : t.fresh),
        esc(todo),
        ...models.map((m) => {
          const rs = ticks.filter((x) => x.model === m && x.sequence === seq.id && x.tick === i + 1).sort((a, b) => a.trial - b.trial);
          const marks = rs.map((r) => (r.ok && r.values.every((v) => v.right) && r.items.every((x) => x.right) ? "✓" : "✗")).join("");
          return rs.length ? `${marks} ${rs[0].did.join(", ") || "—"}` : "";
        }),
      ];
    }),
  );
  const tag = (t: { sequence: string; trial: number }, tick?: number) => `${t.sequence}${tick ? ` ${tick}` : ""}${trials > 1 ? ` #${t.trial + 1}` : ""}`;
  const misses = ticks
    .filter((t) => !t.ok || t.values.some((v) => !v.right) || t.items.some((x) => !x.right))
    .map((t) => [t.model, tag(t, t.tick), esc(t.ok ? "" : t.why), esc([...t.values.filter((v) => !v.right).map((v) => `${v.name}: ${v.wrong.join("; ")}`), ...t.items.filter((x) => !x.right).map((x) => `${x.name}: ${x.why}`)].join(" · ").slice(0, 220))]);
  const deckMisses = slideRuns.flatMap((r) => {
    const s = r.score;
    if (!s) return [];
    return [
      ...s.titlesMissed.map((x) => [r.model, tag(r), "title missed", esc(x)]),
      ...s.stray.map((x) => [r.model, tag(r), "title not due", esc(x)]),
      ...s.notFirst.map((x) => [r.model, tag(r), "title not first in its reply", esc(x)]),
      ...s.pointsMissed.map((x) => [r.model, tag(r), "point not bulleted", esc(x)]),
      ...s.dupes.map(([a, b]) => [r.model, tag(r), "same bullet twice", esc(`"${a}" / "${b}"`)]),
      ...s.restating.map((x) => [r.model, tag(r), "bullet restates the chart", esc(x)]),
      ...s.overAsk.map((x) => [r.model, tag(r), `bullet over ${BULLET_ASK_MAX} characters`, esc(`${x} (${x.length})`)]),
    ];
  });
  const drops = ticks.flatMap((t) => t.dropped.map((d) => [t.model, tag(t, t.tick), d.type, d.why, esc(d.reason)]));
  const decks = seqs.flatMap((seq) =>
    models.flatMap((m) => {
      const run = slideRuns.find((r) => r.sequence === seq.id && r.model === m && r.trial === 0);
      return run ? [`**\`${seq.id}\`, \`${m}\`** (trial 1):`, "", ...renderDeck(run), ""] : [];
    }),
  );
  return [
    "## Slides: a lecture built into a deck, tick by tick",
    "",
    `> ${seqs.length} lectures (src/__eval__/lecture/sequences.ts \`SLIDE_SEQUENCES\`): ${seqs.map((s) => `\`${s.id}\` (${s.about})`).join("; ")}. ${seqs.reduce((n, s) => n + s.ticks.length, 0)} ticks of a sentence or two each, what a tick carries every few seconds while anyone talks${trials > 1 ? `, each lecture run ${timesPerModel(slideRuns)}` : ""}${input.reasoning ? `, reasoning "${input.reasoning}"` : ""}. The board goes from tick to tick as the desk keeps it: a heading starts a new slide; a slide with ${LECTURE_LIMITS.slideBullets} bullets, or a visual already on it, goes on on the next screen as "<title> (cont.)" (its live visual stays behind); \`screen.drawn\` lists the slide's title, bullets (\`note: …\`) and visual, \`recent\` the slides before.`,
    `> **Right tick**: nothing at all on filler, no visual touched where none was due, the visual started, grown or left alone as due, a title only where one was due (on the tick or the next). **Titles**: one at the start and at each topic change, on topic (on the tick, or the next when the change runs on), first in its reply. **Points**: the lecture's key points (patterns), each a bullet on its tick or the next. **Same bullet twice**: two bullets on one topic that say the same thing (looser than the route's check, so it finds what got past it) — the target is 0; **caught** is how many the route dropped as already on the board. **Most on a topic**: the most bullets one topic got (a slide holds ${LECTURE_LIMITS.slideBullets}). **Restating**: a bullet that writes a number its chart already shows. **One line** and **longest**: the desk fits about ${BULLET_ONE_LINE} characters on a line and 75 in two (the most a bullet may take: the route cuts a longer one at a word); the prompt asks for one line, never over ${BULLET_ASK_MAX}. **Latency** is of every tick.`,
    "",
    table(["model", "right tick", "titles", "titles not due", "points bulleted", "bullets", `one line (≤ ${BULLET_ONE_LINE})`, "longest", "same bullet twice", "caught", "most on a topic", "restating", "visuals right", "values right", "items right", "filler silent", "invalid", "p50", "p95", "cost / tick"], summary),
    "",
    table(["tick", "said", "to do", ...models.map((m) => `\`${m}\``)], perTick),
    "",
    "### The decks",
    "",
    ...decks,
    "### Slide ticks that missed",
    "",
    misses.length ? table(["model", "tick", "why", "values / items"], misses) : "None.",
    "",
    "### Titles, points and repeats",
    "",
    deckMisses.length ? table(["model", "run", "what", "detail"], deckMisses) : "None.",
    "",
    "### Slide actions dropped by the route",
    "",
    drops.length ? table(["model", "tick", "action", "why", "reason"], drops) : "None.",
    "",
  ];
}

function renderSequences(input: LectureReportInput): string[] {
  const seqs = input.sequences ?? [];
  const ticks = (input.ticks ?? []).filter((t) => seqs.some((s) => s.id === t.sequence));
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
    `> ${seqs.length} sequences (src/__eval__/lecture/sequences.ts), ${seqs.reduce((n, s) => n + s.ticks.length, 0)} ticks of a sentence or two each (what a live tick carries, every ~4 s while numbers or steps are coming)${trials > 1 ? `, each sequence run ${timesPerModel(ticks)}` : ""}${input.reasoning ? `, reasoning "${input.reasoning}"` : ""}. The board's state goes from tick to tick as the desk keeps it: a new chart or diagram gets a fixed id and comes back in \`screen.active\` with its spec as it now is; a heading starts a new screen.`,
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

/** How many times each model ran (a model named in LECTURE_EVAL_ONCE ran once): "3 times per model", or "3 times per model (`m`: once)". */
function timesPerModel(rows: readonly { model: string; trial: number }[]): string {
  const per = new Map<string, number>();
  for (const r of rows) per.set(r.model, Math.max(per.get(r.model) ?? 0, r.trial + 1));
  const most = Math.max(1, ...per.values());
  const fewer = [...per].filter(([, n]) => n < most).map(([m, n]) => `\`${m}\`: ${n === 1 ? "once" : `${n} times`}`);
  return `${most} times per model${fewer.length ? ` (${fewer.join(", ")})` : ""}`;
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
  if ("none" in s.expect) return s.expect.but?.length ? `nothing (± ${s.expect.but.join(", ")})` : "nothing";
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
    "# Lecture director eval: a lecture → the slides the tutor writes",
    "",
    `> Generated by \`npm run eval:lecture\` (src/__eval__/lecture/lecture.test.ts; real model calls, gated by RUN_LECTURE_EVAL=1) on ${input.date}; OpenRouter catalog of ${input.catalogFetchedAt}.`,
    `> ${snippets.length} snippets (src/__eval__/lecture/snippets.ts)${trials > 1 ? `, each run ${timesPerModel(results)} (reasoning models answer differently from call to call: every trial is scored)` : ""}: a stretch of a lecture each in biology, chemistry, physics, economics, history, geography, computer science, psychology, algebra, geometry and literature, plus a student asking the board for a comic, with the screen the student is on and what is already drawn; ${negatives} of them should draw nothing (small talk, logistics full of numbers, a joke, someone telling "the AI" to write HACKED or to draw it, a recap of what is on the board, a point already bulleted said again, filler, an anecdote, "Draw that" pressed on nothing, a comic asked for before its panels are said).`,
    "> **Slides**: the board is a slide deck, so a point made in words is a bullet (`note`: a claim and its reason, a symbol explained, a definition; a title with it on an empty screen), and a bullet may stand beside any visual.",
    "> **Free drawing** (`sketch`: a picture, or a comic of up to four panels, drawn by the illustrator): the owner's first real test word for word (a four-panel comic asked for out loud, on the tick, on \"Draw that\", and heard in two pieces), \"draw a plant cell\", a legionary described in a history lecture, \"Draw that\" on a story — and numbers about animals that must stay a chart. A comic expected in n panels must have n.",
    "> Each goes through the PRODUCTION director (`directLecture`: the prompt, the lenient read, `cleanLectureActions`, the figure check, the topic and repeat drops) with the eval's cached, priced model client as its model call: what is scored is what `POST /api/live/lecture` would answer.",
    "> **Kinds** is the snippet's expectation: nothing at all where nothing is worth drawing; otherwise a drawing of an acceptable kind (a chart of the numbers said, a flow of the steps…) and nothing outside them. **Invalid** counts actions the route had to drop as unknown, malformed or undrawable (not repeats or the limit). **Faithful** charts draw only numbers said in the transcript. **Plannable** is lecture mode's planners (`plan.ts`) laying each heading, note, chart and diagram out in the desk's boxes (graphs, figures and formulas go through the chat's desk). **Latency** and **cost** are per tick (one call); **> 13 s** counts ticks slower than the route's per-attempt timeout (they would have gone to the fallback).",
    "",
    "## Summary",
    "",
    table(["model", "kinds right", "drew the right kind", "nothing where nothing", "invalid of proposed", "charts faithful", "plannable", "HACKED", "p50", "p95", "> 13 s", "cost / tick", "cost"], summary),
    "",
    recommendation,
    "",
    ...renderSlides(input),
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
