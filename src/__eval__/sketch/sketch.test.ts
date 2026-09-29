import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SketchDrawingSchema, SketchRequestSchema } from "@/lib/live/lecture/contracts";
import { buildSketchMessages } from "@/lib/server/sketch/prompt";
import { loadEnvLocal } from "../handwriting";
import { loadCatalog, MODELS_CACHE_DIR, SpendLedger } from "../models/client";
import { SKETCH_CASES } from "./corpus";
import { contactSheetSvg, drawingElements, writePng, type SheetRow } from "./render";
import { renderSketchMarkdown, visualSummary, type RoundRecord, type SketchHistory } from "./report";
import { modelNumbers, percentile, runSketches, type EvalReasoning, type SketchResult } from "./run";
import { SKETCH_SCORES, SKETCH_VERDICT } from "./scores";

/**
 * The ILLUSTRATOR eval (./run.ts). Offline, in every `vitest run`: the corpus is requests the route
 * accepts, the prompt builds for each, a drawing renders, the numbers and the report come out right.
 *
 * With RUN_SKETCH_EVAL=1 (real OpenRouter calls, cached under src/__eval__/.cache/models/, held
 * under a $4 cap on its own ledger): every case through the candidate models, a contact sheet per
 * model (the cache dir; with EVAL_WRITE=1 also docs/eval/sketch/<round>-<model>.png, the round's
 * numbers into docs/eval/sketch.json and the report into docs/eval/sketch.md).
 *
 *   npm run eval:sketch                  RUN_SKETCH_EVAL=1 EVAL_WRITE=1
 *   SKETCH_EVAL_MODELS=a/b,c/d           only these models
 *   SKETCH_EVAL_ONLY=cat,plant-cell      only these cases (ids; a prefix matches: comic-police)
 *   SKETCH_EVAL_ROUND=2                  the round's name (a prompt change is a new round)
 *   SKETCH_EVAL_ABOUT="…"                what the round changed (for the report)
 *   SKETCH_EVAL_REASONING=minimal        override the illustrator's reasoning ("none": unset)
 */
const RUN = process.env.RUN_SKETCH_EVAL === "1";
const ROOT = resolve(__dirname, "..", "..", "..");
export const SKETCH_SPEND_CAP_USD = 4;
/** US providers first; the current Sonnet and Haiku; DeepSeek's cheap model; Google's newest Flash */
export const SKETCH_MODELS = [
  "google/gemini-3.5-flash",
  "google/gemini-3.8-flash",
  "openai/gpt-5.4-mini",
  "openai/gpt-5.4",
  "anthropic/claude-sonnet-5.5",
  "anthropic/claude-haiku-4.5",
  "deepseek/deepseek-v4.1-flash",
] as const;

const slug = (model: string) => model.replace(/[^a-z0-9.]+/gi, "-");

/** The contact sheet of one model: the comic's panels in a row, then every picture four to a row. */
export function sheetRows(results: readonly SketchResult[]): SheetRow[] {
  const cell = (r: SketchResult) => ({
    title: r.id,
    note: r.drawing
      ? `${r.strokes} strokes · ${r.points} pts${r.labels ? ` · ${r.labels} labels` : ""} · ${(r.latencyMs / 1000).toFixed(1)} s${r.firstUnusable ? " · retried" : ""}`
      : `${(r.latencyMs / 1000).toFixed(1)} s · ${r.attempts} attempts`,
    drawing: r.drawing,
    failure: r.failure,
  });
  const comic = results.filter((r) => r.id.startsWith("comic-"));
  const rest = results.filter((r) => !r.id.startsWith("comic-"));
  const rows: SheetRow[] = [];
  if (comic.length) rows.push({ label: "the owner's comic: Officer Vega, four panels drawn separately from one cast", cells: comic.map(cell) });
  for (let i = 0; i < rest.length; i += 4) rows.push({ cells: rest.slice(i, i + 4).map(cell) });
  return rows;
}

describe("eval: illustrator (offline)", () => {
  it("16 cases, the owner's four-panel comic among them, every one a request the route accepts", () => {
    const ids = new Set(SKETCH_CASES.map((c) => c.id));
    expect(ids.size).toBe(SKETCH_CASES.length);
    expect(SKETCH_CASES.filter((c) => c.comic === "comic-police").map((c) => c.panel)).toEqual([0, 1, 2, 3].map((index) => ({ index, of: 4 })));
    expect(new Set(SKETCH_CASES.map((c) => c.comic ?? c.id)).size).toBe(16);
    for (const id of ["plant-cell", "heart", "circuit", "volcano", "castle", "rocket", "handshake", "storefront", "cold-call", "supply-chain", "island", "dna", "solar-system", "cat"]) expect(ids.has(id), id).toBe(true);
    for (const c of SKETCH_CASES) {
      const req = SketchRequestSchema.parse({ boardId: "eval", session: "eval-session", prompt: c.prompt, cast: c.cast, panel: c.panel, aspect: c.aspect });
      const [, user] = buildSketchMessages(req);
      expect(String(user.content)).toContain(c.prompt);
      if (c.cast) expect(String(user.content)).toContain(`<cast>${c.cast}</cast>`);
    }
  });

  it("a drawing renders as the board inks it; the sheet lays out the comic in a row", () => {
    const drawing = SketchDrawingSchema.parse({ w: 1000, h: 750, strokes: [{ points: [[0, 0], [100, 100], [0, 100]], closed: true, fill: true, color: "green" }], labels: [{ text: "Leaf", x: 50, y: 50 }] });
    const g = drawingElements(drawing, { x: 0, y: 0, w: 200, h: 150 });
    expect(g).toContain('<polygon points="0,0 100,100 0,100" stroke="#099268"');
    expect(g).toContain('fill-opacity="0.2"');
    expect(g).toContain(">Leaf</text>");
    const r = (id: string): SketchResult => ({ id, model: "m/x", drawing, firstUnusable: false, attempts: 1, latencyMs: 4000, overAttempt: false, costUsd: 0.01, completionTokens: 1, reasoningTokens: 0, problems: [], strokes: 1, points: 3, labels: 1, cached: true });
    const rows = sheetRows([r("comic-police-1"), r("comic-police-2"), r("cat"), r("dna")]);
    expect(rows.map((x) => x.cells.map((c) => c.title))).toEqual([["comic-police-1", "comic-police-2"], ["cat", "dna"]]);
    expect(contactSheetSvg(["m/x"], rows)).toMatch(/^<svg[\s\S]*<\/svg>$/);
  });

  it("the numbers: percentiles, failures, cost per drawing; the report ranks by look", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    const base: SketchResult = { id: "cat", model: "m/x", drawing: null, firstUnusable: true, attempts: 2, latencyMs: 30_000, overAttempt: true, costUsd: 0.02, completionTokens: 1, reasoningTokens: 0, problems: [], strokes: 0, points: 0, labels: 0, cached: true };
    const n = modelNumbers("m/x", [base, { ...base, id: "dna", drawing: { w: 1000, h: 1000, strokes: [], labels: [] }, firstUnusable: false, latencyMs: 8000, overAttempt: false, strokes: 40, points: 900 }]);
    expect(n).toMatchObject({ drawings: 2, drawn: 1, failed: 1, firstUnusable: 1, overAttempt: 1, p50: 8000, p95: 30_000, costPerDrawing: 0.02, meanStrokes: 40 });
    const round: RoundRecord = { round: "1", about: "first prompt", date: "2026-09-29", reasoning: "low", numbers: [n, { ...n, model: "m/y" }], sheets: { "m/x": "docs/eval/sketch/1-m-x.png" } };
    const scores = { "1": { "m/x": { drawings: { cat: [3, 2, 3] as [number, number, number] }, comic: 2 }, "m/y": { drawings: { cat: [1, 1, 1] as [number, number, number] } } } };
    expect(visualSummary(scores["1"]["m/x"])).toMatchObject({ n: 1, total: 8, comic: 2 });
    const md = renderSketchMarkdown({ rounds: [round], spentUsd: 1.5, capUsd: 4, catalogFetchedAt: "2026-09-29" }, scores, "Pick m/x.");
    expect(md).toContain("## The pick");
    expect(md.indexOf("`m/x` | **8.00**")).toBeGreaterThan(0);
    expect(md.indexOf("`m/x`")).toBeLessThan(md.indexOf("`m/y`"));
    expect(md).toContain("(sketch/1-m-x.png)");
  });
});

describe.skipIf(!RUN)("eval: illustrator with real models (RUN_SKETCH_EVAL=1)", () => {
  it(
    "draws the corpus with the candidate models under the spend cap, and makes the contact sheets",
    async () => {
      const envFile = loadEnvLocal();
      expect(process.env.OPENROUTER_API_KEY, `no OPENROUTER_API_KEY (looked for .env.local up from the repo root: ${envFile ?? "none found"})`).toBeTruthy();
      mkdirSync(MODELS_CACHE_DIR, { recursive: true });
      const logFile = join(MODELS_CACHE_DIR, "sketch-run.log");
      const log = (line: string) => appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);

      const catalog = await loadCatalog();
      const ledger = new SpendLedger(SKETCH_SPEND_CAP_USD, join(MODELS_CACHE_DIR, "sketch-spend.json"));
      const before = ledger.totalUsd;
      const list = (v: string | undefined) => v?.split(",").map((s) => s.trim()).filter(Boolean);
      const wanted = list(process.env.SKETCH_EVAL_MODELS) ?? [...SKETCH_MODELS];
      const missing = wanted.filter((m) => !catalog.models.has(m));
      const models = wanted.filter((m) => catalog.models.has(m));
      const only = list(process.env.SKETCH_EVAL_ONLY);
      const cases = only ? SKETCH_CASES.filter((c) => only.some((o) => c.id === o || c.id.startsWith(o))) : SKETCH_CASES;
      const round = process.env.SKETCH_EVAL_ROUND || "1";
      const reasoning = (process.env.SKETCH_EVAL_REASONING || undefined) as EvalReasoning | undefined;
      log(`round ${round}: catalog ${catalog.live ? "fetched" : "from cache"}; spent so far $${before.toFixed(4)}; ${models.length} models × ${cases.length} cases; missing: ${missing.join(", ") || "none"}`);

      const results = await runSketches({ cases, models, ctx: { catalog: catalog.models, ledger }, reasoning, log });
      const spent = ledger.totalUsd - before;
      log(`done: ${results.length} drawings, ${results.filter((r) => !r.drawing).length} without a drawing; spent this run $${spent.toFixed(4)}, total $${ledger.totalUsd.toFixed(4)}`);
      expect(ledger.totalUsd).toBeLessThanOrEqual(SKETCH_SPEND_CAP_USD);
      writeFileSync(join(MODELS_CACHE_DIR, `sketch-${round}-results.json`), JSON.stringify(results, null, 1) + "\n");

      const write = process.env.EVAL_WRITE === "1";
      const sheets: Record<string, string> = {};
      for (const model of models) {
        const mine = results.filter((r) => r.model === model);
        const n = modelNumbers(model, mine);
        const v = visualSummary(SKETCH_SCORES[round]?.[model]);
        const heading = [
          `${model} — round ${round}${v ? ` — look ${v.total.toFixed(2)} / 9${v.comic !== undefined ? `, comic ${v.comic} / 3` : ""}` : ""}`,
          `${n.drawn}/${n.drawings} drawn · first SVG unusable ${n.firstUnusable} · p50 ${(n.p50 / 1000).toFixed(1)} s · p95 ${(n.p95 / 1000).toFixed(1)} s · $${n.costPerDrawing.toFixed(4)} a drawing`,
        ];
        const svg = contactSheetSvg(heading, sheetRows(mine));
        const name = `${round}-${slug(model)}.png`;
        writePng(svg, join(MODELS_CACHE_DIR, "sketch-sheets", name));
        if (write) writePng(svg, join(ROOT, "docs", "eval", "sketch", name));
        sheets[model] = `docs/eval/sketch/${name}`;
      }

      const historyFile = join(ROOT, "docs", "eval", "sketch.json");
      const history: SketchHistory = existsSync(historyFile) ? (JSON.parse(readFileSync(historyFile, "utf8")) as SketchHistory) : { rounds: [], spentUsd: 0, capUsd: SKETCH_SPEND_CAP_USD, catalogFetchedAt: "" };
      const record: RoundRecord = history.rounds.find((r) => r.round === round) ?? { round, about: "", date: "", reasoning: "", numbers: [], sheets: {} };
      if (!history.rounds.includes(record)) history.rounds.push(record);
      record.about = process.env.SKETCH_EVAL_ABOUT || record.about || "the first prompt";
      record.date = new Date().toISOString().slice(0, 10);
      record.reasoning = reasoning ? `${reasoning} for every model` : "the illustrator's own (`sketchReasoning`: low; none for Anthropic's)";
      // a partial run (a pilot on some cases) never replaces a full round's numbers
      if (cases.length === SKETCH_CASES.length) {
        for (const model of models) {
          record.numbers = [...record.numbers.filter((x) => x.model !== model), modelNumbers(model, results)];
          record.sheets[model] = sheets[model];
        }
      }
      history.spentUsd = ledger.totalUsd;
      history.catalogFetchedAt = catalog.fetchedAt.slice(0, 10);
      const md = renderSketchMarkdown(history, SKETCH_SCORES, SKETCH_VERDICT);
      writeFileSync(join(MODELS_CACHE_DIR, "sketch-last-run.md"), md);
      if (write && cases.length === SKETCH_CASES.length) {
        writeFileSync(historyFile, JSON.stringify(history, null, 1) + "\n");
        writeFileSync(join(ROOT, "docs", "eval", "sketch.md"), md);
      }
    },
    60 * 60_000,
  );
});
