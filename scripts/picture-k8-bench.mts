/**
 * K–8 PICTURE BENCH (v1.0 picture-tutor reliability): the 28 boards of src/__eval__/picture/k8.ts,
 * each run REPS times through the real runBoardDraw (the route's logic, run here with the local key),
 * scored for what the KID SEES (the overlay in tutor blue over the board, as the iPad draws it):
 *
 *   right        the outcome a kid should get (picture / checkmark / note / quiet) AND the judge finds
 *                the picture right against the case's spec (counts, shading, numbers, no give-away)
 *   consistent   all reps of a case got the same verdict and the same kind of outcome
 *   wrong shown  a picture was shown that is wrong (judge), or ink on right work (a nudge)
 *   latency      p50 / p95 of the whole run (first byte of the request to the last event)
 *
 * The judge (google/gemini-3.8-flash, a vision call) is a helper, not the verdict: every rep's kid view
 * lands in a contact sheet per case (<out>/sheets/<id>.png) for a person to look at, and `eyes.json`
 * in the run's folder overrides the judge per rep: { "<id>#<rep>": { "right": bool, "wrongShown": bool, "why": "…" } }.
 * `--rescore` rebuilds the summary from saved runs + eyes.json, with no paid calls.
 *
 *   set -a; . ../whiteboardstaging/.env.local; set +a
 *   npx tsx scripts/picture-k8-bench.mts --run base --reps 5 [--only id1,id2] [--budget 25]
 *   npx tsx scripts/picture-k8-bench.mts --run base --rescore
 *
 * The BASELINE is this script on the code before the fixes: `git worktree add ../v1-picture-base <the
 * bench commit>` and run it there (same boards, same scorer). SPEND: refuses to start when the OpenRouter
 * account has under $20 left (the lane rule), and stops at --budget (lane ledger
 * ~/whiteboardstaging/.picture-bench/k8-spend.json). Outputs never go in git.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { K8_CASES, renderK8Board, type K8Case } from "../src/__eval__/picture/k8";
import { decodeRgb, type Rgb } from "../src/lib/server/boardDraw/overlay";
import { kidViewRgb } from "../src/lib/server/boardDraw/kidView";
import { numbersIn } from "../src/lib/server/boardDraw/readback";
import { runBoardDraw, type RunSummary } from "../src/lib/server/boardDraw/run";
import { openrouterChat } from "../src/lib/server/openrouter";
import { recognizeImage } from "../src/lib/server/mathpix";

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const ROOT = join(homedir(), "whiteboardstaging", ".picture-bench");
const RUN = arg("run", "k8")!;
const OUT = join(ROOT, `k8-${RUN}`);
const REPS = Number(arg("reps", "5"));
const BUDGET = Number(arg("budget", "25"));
const ONLY = arg("only")?.split(",").filter(Boolean);
const CONCURRENCY = Number(arg("concurrency", "4"));
const RESCORE = process.argv.includes("--rescore");
/** no paid calls: a made-up painter result (a dark outline and a PALE YELLOW fill) to check the scorer and the sheets */
const FAKE = process.argv.includes("--fake");
const MIN_ACCOUNT_USD = 20;
const JUDGE_MODEL = "google/gemini-3.8-flash";
const MATHPIX_READ_USD = 0.003;
mkdirSync(join(OUT, "sheets"), { recursive: true });

const ledgerPath = join(ROOT, "k8-spend.json");
const ledger: { total: number; runs: Record<string, number> } = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : { total: 0, runs: {} };
const spend = (usd: number) => {
  ledger.total = Math.round((ledger.total + usd) * 1e6) / 1e6;
  ledger.runs[RUN] = Math.round(((ledger.runs[RUN] ?? 0) + usd) * 1e6) / 1e6;
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
};

async function accountLeft(): Promise<number> {
  const r = await fetch("https://openrouter.ai/api/v1/credits", { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` } });
  const j = (await r.json()) as { data?: { total_credits?: number; total_usage?: number } };
  return (j.data?.total_credits ?? 0) - (j.data?.total_usage ?? 0);
}

type Rep = {
  id: string;
  rep: number;
  result: string;
  correct: boolean;
  instructions: string;
  written: string;
  read: string;
  ms: number;
  costUsd: number;
  summary: Partial<RunSummary> | null;
  error?: string;
  judge?: { right: boolean; wrongShown: boolean; why: string };
};

const BLUE = { r: 0x2d, g: 0x5b, b: 0xff };

/** A checkmark (or a written answer) in tutor blue, so the sheet shows what the iPad would show. */
async function markView(view: Rgb, what: "check" | "write", text = ""): Promise<Buffer> {
  const png = await sharp(Buffer.from(view.data), { raw: { width: view.width, height: view.height, channels: 3 } }).png().toBuffer();
  const blue = `rgb(${BLUE.r},${BLUE.g},${BLUE.b})`;
  const svg =
    what === "check"
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="${view.width}" height="${view.height}"><path d="M${view.width - 260} 120 l40 45 l80 -100" stroke="${blue}" stroke-width="12" fill="none" stroke-linecap="round"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="${view.width}" height="${view.height}"><text x="${view.width - 520}" y="140" font-family="Noteworthy, Marker Felt" font-size="56" fill="${blue}">${text.replace(/[<&>]/g, "")}</text></svg>`;
  return sharp(png).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
}

function outcomeOk(c: K8Case, r: Rep): boolean {
  switch (c.expect.outcome) {
    case "picture":
      return r.result === "done" || (c.mode === "answer" && r.result === "write");
    case "note":
      return r.result === "done";
    case "check":
      return r.result === "none" && r.correct;
    case "quiet":
      return r.result === "none";
  }
}

const JUDGE_PROMPT = (c: K8Case, r: Rep) =>
  [
    "You are grading an AI tutor that draws on a child's whiteboard. The image is EXACTLY what the child sees: their own writing in black, and the tutor's additions in BLUE (earlier accepted tutor pictures may also be blue).",
    `The tutor's mode: ${c.mode === "answer" ? "Solve (show the full worked answer)" : c.mode === "suggest" ? "Suggest (a hint for the next step only, never the answer)" : "Feedback (point out the mistake, never write the corrected answer)"}.`,
    `What a RIGHT result shows: ${c.expect.spec}`,
    r.result === "none" ? `The tutor drew nothing${r.correct ? " and gave a checkmark" : ""}.` : r.result === "write" ? `The tutor wrote "${r.written}" (no picture).` : `The tutor was asked to draw: ${r.instructions}`,
    "Check the blue additions against the spec item by item. COUNT every rod, cube, dot, slice, part and shaded part one by one. Shading must be clearly visible. Every number must be the right number. A picture that gives away the final answer in Suggest or Feedback is wrong. Words only, when a picture was asked for, is wrong.",
    'Reply with only JSON: {"counts": "what you counted", "right": true|false, "wrongPictureShown": true|false (true only when blue additions are shown that are WRONG or misleading — wrong counts/shading/numbers, an answer given away, or a nudge drawn on finished right work), "why": "one short sentence"}',
  ].join("\n");

async function judge(c: K8Case, r: Rep, viewPng: Buffer): Promise<Rep["judge"]> {
  const jpeg = await sharp(viewPng).resize(1280, 1280, { fit: "inside" }).jpeg({ quality: 88 }).toBuffer();
  const data = await openrouterChat(
    {
      model: JUDGE_MODEL,
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}` } }, { type: "text", text: JUDGE_PROMPT(c, r) }] }],
      temperature: 0,
      max_tokens: 1200,
      reasoning: { effort: "low" },
      usage: { include: true },
    },
    { title: "Agathon picture bench - judge" },
  );
  const cost = (data.usage as { cost?: number } | undefined)?.cost ?? 0;
  spend(cost);
  const raw = data.choices?.[0]?.message?.content;
  const text = typeof raw === "string" ? raw : "";
  try {
    const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { right?: boolean; wrongPictureShown?: boolean; why?: string; counts?: string };
    return { right: j.right === true, wrongShown: j.wrongPictureShown === true, why: `${j.why ?? ""} [${j.counts ?? ""}]` };
  } catch {
    return { right: false, wrongShown: false, why: `judge reply unreadable: ${text.slice(0, 120)}` };
  }
}

async function runRep(c: K8Case, rep: number, board: { png: Buffer }, rgb: Rgb): Promise<Rep> {
  const dir = join(OUT, c.id);
  mkdirSync(dir, { recursive: true });
  const r: Rep = { id: c.id, rep, result: "error", correct: false, instructions: "", written: "", read: "", ms: 0, costUsd: 0, summary: null };
  let overlayB64 = "";
  const t0 = Date.now();
  try {
    if (FAKE) {
      const w = rgb.width;
      const h = rgb.height;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="700" y="400" width="300" height="80" fill="#fff3b0" stroke="#111" stroke-width="5"/><text x="700" y="560" font-size="60" fill="#111">= 85</text></svg>`;
      const ov = await sharp(Buffer.from(svg)).png().toBuffer();
      r.instructions = "fake";
      overlayB64 = ov.toString("base64");
      r.result = "done";
      r.summary = { result: "done", costUsd: 0 } as RunSummary;
    } else
    r.summary = await runBoardDraw({
      runId: `k8-${c.id}-${rep}`,
      requestId: `k8-${c.id}-${rep}`,
      imageDataUrl: `data:image/png;base64,${board.png.toString("base64")}`,
      board: rgb,
      mode: c.mode,
      source: c.source,
      signal: new AbortController().signal,
      emit: (e) => {
        if (e.type === "status" && e.stage === "drawing") r.instructions = e.instructions;
        else if (e.type === "done") overlayB64 = e.overlay.split(",")[1] ?? "";
        else if (e.type === "none") r.correct = e.correct === true;
        else if (e.type === "write") r.written = e.latex;
        else if (e.type === "error") r.error = e.message;
      },
    });
    r.result = r.summary!.result;
  } catch (err) {
    r.error = err instanceof Error ? err.message : String(err);
  }
  r.ms = Date.now() - t0;
  r.costUsd = r.summary?.costUsd ?? 0;
  // the run's own Mathpix read-backs (not OpenRouter: kept out of the lane's OpenRouter total, logged)
  let viewPng: Buffer;
  if (overlayB64) {
    const ov = await sharp(Buffer.from(overlayB64, "base64")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const view = kidViewRgb(rgb, new Uint8Array(ov.data.buffer, ov.data.byteOffset, ov.data.length));
    viewPng = await sharp(Buffer.from(view.data), { raw: { width: view.width, height: view.height, channels: 3 } }).png().toBuffer();
    // what the additions say (numbers), read the same way the run's read-back does
    const jpeg = await sharp(Buffer.from(overlayB64, "base64")).flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer();
    const read = FAKE ? { ok: false as const } : await recognizeImage(`data:image/jpeg;base64,${jpeg.toString("base64")}`, undefined, { timeoutMs: 8000 });
    if (read.ok) r.read = read.latex ?? "";
  } else if (r.result === "none" && r.correct) {
    viewPng = await markView(rgb, "check");
  } else if (r.result === "write") {
    viewPng = await markView(rgb, "write", r.written);
  } else {
    viewPng = board.png;
  }
  writeFileSync(join(dir, `view-${rep}.png`), viewPng);
  spend(r.costUsd);
  if (r.result !== "error" && !FAKE) r.judge = await judge(c, r, viewPng);
  writeFileSync(join(dir, `rep-${rep}.json`), JSON.stringify(r, null, 2));
  return r;
}

type Verdict = { right: boolean; wrongShown: boolean; why: string; source: "eyes" | "judge" | "rule" };

function verdict(c: K8Case, r: Rep, eyes: Record<string, { right: boolean; wrongShown: boolean; why?: string }>): Verdict {
  const mine = eyes[`${c.id}#${r.rep}`];
  if (mine) return { right: mine.right, wrongShown: mine.wrongShown, why: mine.why ?? "", source: "eyes" };
  if (r.result === "error") return { right: false, wrongShown: false, why: `error: ${r.error ?? ""}`, source: "rule" };
  if (!outcomeOk(c, r)) {
    // ink on work that needed none is a wrong picture shown (the demo's nudge after right work)
    const wrongShown = r.result === "done" && (c.expect.outcome === "check" || c.expect.outcome === "quiet");
    return { right: false, wrongShown, why: `outcome ${r.result}${r.correct ? "+correct" : ""}, wanted ${c.expect.outcome}`, source: "rule" };
  }
  if (r.result === "done") {
    const nums = new Set(numbersIn(r.read));
    const gave = (c.expect.hide ?? []).filter((n) => nums.has(n) && !numbersIn(r.instructions).includes(n));
    if (gave.length && c.mode !== "answer") return { right: false, wrongShown: true, why: `gave away ${gave.join(", ")}`, source: "rule" };
  }
  if (r.judge) return { right: r.judge.right, wrongShown: r.result === "done" && r.judge.wrongShown, why: r.judge.why, source: "judge" };
  return { right: true, wrongShown: false, why: "", source: "rule" };
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

async function contactSheet(c: K8Case, reps: Rep[], verdicts: Verdict[]) {
  const dir = join(OUT, c.id);
  const tw = 640;
  const th = 480;
  const tiles: sharp.OverlayOptions[] = [];
  const board = await sharp(join(dir, "board.png")).resize(tw, th, { fit: "contain", background: "#fff" }).png().toBuffer();
  tiles.push({ input: board, left: 0, top: 0 });
  for (const [k, r] of reps.entries()) {
    const f = join(dir, `view-${r.rep}.png`);
    if (!existsSync(f)) continue;
    const v = verdicts[k];
    const img = await sharp(f).resize(tw, th, { fit: "contain", background: "#fff" }).png().toBuffer();
    const label = `<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="34"><rect width="100%" height="100%" fill="${v.right ? "#1f7a3a" : "#b3261e"}"/><text x="8" y="24" font-family="Helvetica" font-size="20" fill="#fff">#${r.rep} ${r.result}${r.correct ? "+check" : ""} ${(r.ms / 1000).toFixed(1)}s ${v.right ? "RIGHT" : "WRONG"}${v.wrongShown ? " SHOWN" : ""}</text></svg>`;
    const col = (k + 1) % 3;
    const row = Math.floor((k + 1) / 3);
    tiles.push({ input: img, left: col * (tw + 10), top: row * (th + 44) + 34 });
    tiles.push({ input: Buffer.from(label), left: col * (tw + 10), top: row * (th + 44) });
  }
  const rows = Math.ceil((reps.length + 1) / 3);
  await sharp({ create: { width: 3 * (tw + 10), height: rows * (th + 44) + 34, channels: 3, background: "#777" } }).composite(tiles).png().toFile(join(OUT, "sheets", `${c.id}.png`));
}

async function main() {
  let cases = K8_CASES;
  if (ONLY) cases = cases.filter((c) => ONLY.includes(c.id));
  const all: Rep[] = [];
  if (!RESCORE) {
    const left = FAKE ? 999 : await accountLeft();
    console.log(`OpenRouter account: $${left.toFixed(2)} left; lane ledger $${ledger.total.toFixed(3)} of $${BUDGET}`);
    if (left < MIN_ACCOUNT_USD) {
      console.error(`refusing to run: under $${MIN_ACCOUNT_USD} left on the production key`);
      process.exit(2);
    }
    const jobs: Array<{ c: K8Case; rep: number }> = [];
    const boards = new Map<string, { png: Buffer; rgb: Rgb }>();
    for (const c of cases) {
      const b = await renderK8Board(c);
      mkdirSync(join(OUT, c.id), { recursive: true });
      writeFileSync(join(OUT, c.id, "board.png"), b.png);
      boards.set(c.id, { png: b.png, rgb: await decodeRgb(b.png) });
    }
    // rep-major order: each case's first try comes before anyone's second (a budget stop is fair)
    for (let rep = 1; rep <= REPS; rep++) for (const c of cases) jobs.push({ c, rep });
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        if (ledger.total >= BUDGET) return void console.log("budget reached: stopping");
        const { c, rep } = jobs[next++];
        const b = boards.get(c.id)!;
        const r = await runRep(c, rep, { png: b.png }, b.rgb);
        all.push(r);
        console.log(`${c.id}#${rep} ${r.result}${r.correct ? "+correct" : ""} ${r.ms}ms $${r.costUsd.toFixed(4)} ${r.judge ? (r.judge.right ? "judge:right" : "judge:WRONG") : ""} ${r.summary?.paints ? `paints ${r.summary.paints}` : ""}`);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } else {
    for (const c of cases) for (let rep = 1; rep <= REPS; rep++) {
      const f = join(OUT, c.id, `rep-${rep}.json`);
      if (existsSync(f)) all.push(JSON.parse(readFileSync(f, "utf8")));
    }
  }
  await summarize(cases, all);
}

async function summarize(cases: K8Case[], all: Rep[]) {
  const eyesPath = join(OUT, "eyes.json");
  const eyes = existsSync(eyesPath) ? JSON.parse(readFileSync(eyesPath, "utf8")) : {};
  const rows: string[] = [];
  let right = 0;
  let n = 0;
  let consistent = 0;
  let shown = 0;
  const ms: number[] = [];
  const byKind = new Map<string, { right: number; n: number }>();
  const byMode = new Map<string, { right: number; n: number }>();
  const lines: string[] = [];
  for (const c of cases) {
    const reps = all.filter((r) => r.id === c.id).sort((a, b) => a.rep - b.rep);
    if (!reps.length) continue;
    const vs = reps.map((r) => verdict(c, r, eyes));
    const caseRight = vs.filter((v) => v.right).length;
    const same = new Set(reps.map((r, k) => `${vs[k].right}|${r.result}|${r.correct}`)).size === 1;
    right += caseRight;
    n += reps.length;
    consistent += same ? 1 : 0;
    shown += vs.filter((v) => v.wrongShown).length;
    for (const r of reps) if (r.result !== "error") ms.push(r.ms);
    for (const [map, key] of [[byKind, c.kind], [byMode, `${c.mode}/${c.expect.outcome}`]] as const) {
      const g = map.get(key) ?? { right: 0, n: 0 };
      g.right += caseRight;
      g.n += reps.length;
      map.set(key, g);
    }
    await contactSheet(c, reps, vs);
    lines.push(`${c.id.padEnd(22)} ${caseRight}/${reps.length} right ${same ? "consistent " : "MIXED      "} shown-wrong ${vs.filter((v) => v.wrongShown).length}  ${reps.map((r, k) => `${r.result[0]}${r.correct ? "✓" : ""}${vs[k].right ? "+" : "-"}${(r.ms / 1000).toFixed(0)}s`).join(" ")}`);
    rows.push(...reps.map((r, k) => JSON.stringify({ id: c.id, rep: r.rep, result: r.result, correct: r.correct, right: vs[k].right, wrongShown: vs[k].wrongShown, by: vs[k].source, why: vs[k].why, ms: r.ms, paints: r.summary?.paints ?? 0, verify: (r.summary as Record<string, unknown> | null)?.verify ?? null, timings: r.summary?.timings, cost: r.costUsd, instructions: r.instructions })));
  }
  const casesRun = cases.filter((c) => all.some((r) => r.id === c.id)).length;
  const head = [
    `K8 picture bench "${RUN}": ${n} runs over ${casesRun} boards`,
    `right ${right}/${n} = ${((100 * right) / Math.max(1, n)).toFixed(1)}%   consistent ${consistent}/${casesRun} = ${((100 * consistent) / Math.max(1, casesRun)).toFixed(1)}%   wrong pictures shown ${shown}/${n}`,
    `latency p50 ${(pct(ms, 50) / 1000).toFixed(1)} s   p95 ${(pct(ms, 95) / 1000).toFixed(1)} s   run spend $${(ledger.runs[RUN] ?? 0).toFixed(3)} (lane total $${ledger.total.toFixed(3)})`,
    `by kind: ${[...byKind].map(([k, g]) => `${k} ${g.right}/${g.n}`).join(" · ")}`,
    `by mode: ${[...byMode].map(([k, g]) => `${k} ${g.right}/${g.n}`).join(" · ")}`,
  ];
  const text = [...head, "", ...lines].join("\n");
  writeFileSync(join(OUT, "summary.txt"), text);
  writeFileSync(join(OUT, "reps.jsonl"), rows.join("\n"));
  console.log(`\n${text}\n\nsheets: ${join(OUT, "sheets")}`);
}

await main();
