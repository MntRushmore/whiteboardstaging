/**
 * docs/eval/sketch.md from the runs' numbers (docs/eval/sketch.json, one entry per round and model)
 * and the scores given by eye (./scores.ts).
 */
import type { ModelNumbers } from "./run";
import type { ModelScores } from "./scores";

export interface RoundRecord {
  round: string;
  /** what changed in the prompt for this round */
  about: string;
  date: string;
  reasoning: string;
  numbers: ModelNumbers[];
  /** model → contact sheet path (repo-relative) */
  sheets: Record<string, string>;
}

export interface SketchHistory {
  rounds: RoundRecord[];
  spentUsd: number;
  capUsd: number;
  catalogFetchedAt: string;
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "–");
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** A model's visual averages: each part 0–3, the total 0–9, and the comic's consistency. */
export function visualSummary(s: ModelScores | undefined): { n: number; r: number; c: number; o: number; total: number; comic?: number } | null {
  const all = Object.values(s?.drawings ?? {});
  if (!all.length) return null;
  const mean = (i: number) => all.reduce((n, d) => n + d[i], 0) / all.length;
  const [r, c, o] = [mean(0), mean(1), mean(2)];
  return { n: all.length, r, c, o, total: r + c + o, comic: s?.comic };
}

export function renderSketchMarkdown(h: SketchHistory, scores: Record<string, Record<string, ModelScores>>, verdict: string): string {
  const out: string[] = [];
  out.push("# Illustrator eval: free drawing in lecture mode", "");
  out.push(
    "`npm run eval:sketch` (RUN_SKETCH_EVAL=1): the corpus (`src/__eval__/sketch/corpus.ts`: the owner's four-panel comic of a futuristic police officer, labelled science diagrams, history, business school, geography, a cat — 19 drawings) through the PRODUCTION illustrator (`illustrate`: the prompt, the SVG parser and sampler, the one retry with the parser's complaint), one model at a time, no fallback. Every drawing is rendered as the board inks it (round-capped pen, the palette, pale fills) on a contact sheet per model, LOOKED at, and scored by eye 0–3 for recognisable / clean / on-prompt (total 0–9), and the comic's panels together 0–3 for consistency (`src/__eval__/sketch/scores.ts`).",
    "",
  );
  out.push(`Catalog prices of ${h.catalogFetchedAt}. Spent on this eval so far: $${h.spentUsd.toFixed(2)} of a $${h.capUsd.toFixed(2)} cap.`, "");
  if (verdict.trim()) out.push("## The pick", "", verdict.trim(), "");
  for (const r of [...h.rounds].reverse()) {
    out.push(`## Round ${r.round} (${r.date}): ${r.about}`, "");
    out.push(`Reasoning: ${r.reasoning}. Latency is every attempt of a drawing added up (the retry included); "slow" counts drawings with an attempt past the primary's per-attempt timeout (25 s in rounds 1–2, 20 s from round 3), where production would have gone to the fallback. "Unusable 1st" is a first SVG with nothing drawable in it (the retry was used).`, "");
    out.push("| model | look (0–9) | recognisable | clean | on-prompt | comic consistency | drawn | unusable 1st | slow | p50 | p95 | $ / drawing | strokes | points | sheet |");
    out.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    const ranked = [...r.numbers].sort((a, b) => (visualSummary(scores[r.round]?.[b.model])?.total ?? -1) - (visualSummary(scores[r.round]?.[a.model])?.total ?? -1));
    for (const n of ranked) {
      const v = visualSummary(scores[r.round]?.[n.model]);
      const look = v ? `**${v.total.toFixed(2)}**` : "not scored";
      const part = (x: number | undefined) => (v && x !== undefined ? x.toFixed(2) : "–");
      out.push(
        `| \`${n.model}\` | ${look} | ${part(v?.r)} | ${part(v?.c)} | ${part(v?.o)} | ${v?.comic ?? "–"} / 3 | ${n.drawn}/${n.drawings} | ${n.firstUnusable} | ${n.overAttempt} | ${secs(n.p50)} | ${secs(n.p95)} | $${n.costPerDrawing.toFixed(4)} | ${Math.round(n.meanStrokes)} | ${Math.round(n.meanPoints)} | [png](${r.sheets[n.model]?.replace(/^docs\/eval\//, "") ?? ""}) |`,
      );
    }
    out.push("");
    const notes = r.numbers.map((n) => ({ model: n.model, note: scores[r.round]?.[n.model]?.note })).filter((x) => x.note);
    if (notes.length) {
      out.push("What the sheets show:", "");
      for (const x of notes) out.push(`- \`${x.model}\`: ${x.note}`);
      out.push("");
    }
    const drawnIds = Object.keys(Object.values(scores[r.round] ?? {})[0]?.drawings ?? {});
    if (drawnIds.length) {
      const models = ranked.map((n) => n.model).filter((m) => scores[r.round]?.[m]);
      out.push("<details><summary>Scores per drawing (recognisable / clean / on-prompt)</summary>", "");
      out.push(`| drawing | ${models.map((m) => `\`${m.split("/")[1]}\``).join(" | ")} |`);
      out.push(`|---|${models.map(() => "---").join("|")}|`);
      for (const id of drawnIds) out.push(`| ${id} | ${models.map((m) => scores[r.round][m].drawings[id]?.join("/") ?? "–").join(" | ")} |`);
      out.push("", "</details>", "");
    }
    out.push(`Drawn: ${pct(r.numbers.reduce((n, x) => n + x.drawn, 0), r.numbers.reduce((n, x) => n + x.drawings, 0))} of all drawings in this round.`, "");
  }
  return out.join("\n");
}
