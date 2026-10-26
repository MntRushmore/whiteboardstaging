/**
 * PICTURE BENCH: the picture tutor's real pipeline (runBoardDraw, as production runs it) on the
 * synthetic boards of src/__eval__/picture, scored automatically, with an HTML contact sheet.
 *
 *   set -a; . ../whiteboardstaging/.env.local; set +a
 *   npx tsx scripts/picture-bench.mts --run base [--only id1,id2] [--limit 10] [--budget 4]
 *
 * Paid calls (OpenRouter tutor + painter, Mathpix reads): every run's spend is added to
 * ~/whiteboardstaging/.picture-bench/spend.json and the bench stops once the total reaches
 * --budget. Outputs (never in git) under ~/whiteboardstaging/.picture-bench/<run>/.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { benchCases, expectation, extraCases, type BenchCase } from "../src/__eval__/picture/cases";
import { renderBoard, workLines } from "../src/__eval__/picture/board";
import { falseEquations } from "../src/lib/server/boardDraw/arithmetic";
import { numbersIn } from "../src/lib/server/boardDraw/readback";
import { decodeRgb } from "../src/lib/server/boardDraw/overlay";
import { runBoardDraw, type RunSummary } from "../src/lib/server/boardDraw/run";
import { recognizeImage } from "../src/lib/server/mathpix";

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const ROOT = join(homedir(), "whiteboardstaging", ".picture-bench");
const RUN = arg("run", "run")!;
const OUT = join(ROOT, RUN);
const BUDGET = Number(arg("budget", "4"));
const ONLY = arg("only")?.split(",").filter(Boolean);
const LIMIT = Number(arg("limit", "999"));
const CONCURRENCY = 3;
const MATHPIX_READ_USD = 0.003;
mkdirSync(OUT, { recursive: true });

const ledgerPath = join(ROOT, "spend.json");
const ledger: { total: number; runs: Record<string, number> } = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : { total: 0, runs: {} };
const spend = (usd: number) => {
  ledger.total = Math.round((ledger.total + usd) * 1e6) / 1e6;
  ledger.runs[RUN] = Math.round(((ledger.runs[RUN] ?? 0) + usd) * 1e6) / 1e6;
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
};

type Scored = {
  id: string;
  type: string;
  mode: string;
  work: string;
  frame: string;
  placement: string;
  hand: string;
  expect: string;
  result: string;
  correct: boolean;
  instructions: string;
  read: string;
  falseEquations: string[];
  answerShown: boolean;
  overlapPct: number;
  washPct: number;
  overlayPx: number;
  tutorModel: string;
  paints: number;
  readbackStrays: string[];
  tutorWrongSums: string[];
  ms: number;
  costUsd: number;
  pass: boolean;
  why: string[];
  error?: string;
};

/** Pixels of the board's ink (dark or the printed problem's colour), grown by `r` px. */
function inkNear(rgb: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const l = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
    ink[i] = l < 215 ? 1 : 0;
  }
  // grow: a row pass then a column pass (a square of side 2r + 1)
  const rows = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let last = -1e9;
    for (let x = 0; x < w; x++) if (ink[y * w + x]) last = x; else if (x - last <= r) rows[y * w + x] = 1;
    last = 1e9;
    for (let x = w - 1; x >= 0; x--) if (ink[y * w + x]) last = x; else if (last - x <= r) rows[y * w + x] = 1;
    for (let x = 0; x < w; x++) if (ink[y * w + x]) rows[y * w + x] = 1;
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let last = -1e9;
    for (let y = 0; y < h; y++) if (rows[y * w + x]) last = y; else if (y - last <= r) out[y * w + x] = 1;
    last = 1e9;
    for (let y = h - 1; y >= 0; y--) if (rows[y * w + x]) last = y; else if (last - y <= r) out[y * w + x] = 1;
    for (let y = 0; y < h; y++) if (rows[y * w + x]) out[y * w + x] = 1;
  }
  return out;
}

async function runCase(c: BenchCase): Promise<Scored> {
  const dir = join(OUT, c.id);
  mkdirSync(dir, { recursive: true });
  const board = await renderBoard(c);
  writeFileSync(join(dir, "board.png"), board.png);
  const rgb = await decodeRgb(board.png);
  let overlayB64 = "";
  let instructions = "";
  let correct = false;
  let written = "";
  let summary: RunSummary | null = null;
  let error: string | undefined;
  const t0 = Date.now();
  try {
    summary = await runBoardDraw({
      runId: `bench-${c.id}`,
      requestId: `bench-${c.id}`,
      imageDataUrl: `data:image/png;base64,${board.png.toString("base64")}`,
      board: rgb,
      mode: c.mode,
      source: "auto",
      signal: new AbortController().signal,
      emit: (e) => {
        if (e.type === "done") {
          overlayB64 = e.overlay.split(",")[1] ?? "";
          instructions = e.instructions ?? "";
        } else if (e.type === "none") {
          correct = e.correct === true;
        } else if (e.type === "write") {
          // the server's own working-out (plain arithmetic): no picture
          written = e.latex;
        } else if (e.type === "error") {
          error = e.message;
        }
      },
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const ms = Date.now() - t0;
  let cost = summary?.costUsd ?? 0;
  // the run's own read-back (Solve and Suggest, when the tutor asked for numbers)
  if (summary?.result === "done" && c.mode !== "feedback" && /\d/.test(instructions)) cost += MATHPIX_READ_USD * (summary.paints ?? 1);

  let read = "";
  let overlapPct = 0;
  let washPct = 0;
  let overlayPx = 0;
  if (overlayB64) {
    const overlay = Buffer.from(overlayB64, "base64");
    writeFileSync(join(dir, "overlay.png"), overlay);
    await sharp(board.png).composite([{ input: overlay }]).png().toFile(join(dir, "result.png"));
    const { data: ov, info } = await sharp(overlay).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width;
    const H = info.height;
    if (W === board.width && H === board.height) {
      const near = inkNear(rgb.data, W, H, 6);
      let on = 0;
      let wash = 0;
      for (let y = 2; y < H - 2; y++)
        for (let x = 2; x < W - 2; x++) {
          const i = y * W + x;
          if (ov[i * 4 + 3] === 0) continue;
          overlayPx++;
          if (near[i]) on++;
          const l = 0.299 * ov[i * 4] + 0.587 * ov[i * 4 + 1] + 0.114 * ov[i * 4 + 2];
          const sat = Math.max(ov[i * 4], ov[i * 4 + 1], ov[i * 4 + 2]) - Math.min(ov[i * 4], ov[i * 4 + 1], ov[i * 4 + 2]);
          // grey, and deep inside the picture (all 4 points 2 px away drawn too): a wash, not a stroke's edge
          if (l > 140 && sat < 30 && ov[(i - 2) * 4 + 3] && ov[(i + 2) * 4 + 3] && ov[(i - 2 * W) * 4 + 3] && ov[(i + 2 * W) * 4 + 3]) wash++;
        }
      overlapPct = overlayPx ? Math.round((on / overlayPx) * 1000) / 10 : 0;
      washPct = overlayPx ? Math.round((wash / overlayPx) * 1000) / 10 : 0;
    }
    const jpeg = await sharp(overlay).flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer();
    const r = await recognizeImage(`data:image/jpeg;base64,${jpeg.toString("base64")}`, undefined, { timeoutMs: 8000 });
    cost += MATHPIX_READ_USD;
    if (r.ok) read = r.latex;
  }
  spend(cost);

  const result = error ? "error" : (summary?.result ?? "error");
  const wrongSums = read ? falseEquations(read) : [];
  const nums = new Set(numbersIn(read));
  const answerShown = c.problem.answer.length > 0 && c.problem.answer.every((a) => nums.has(a));
  const why: string[] = [];
  if (result === "error") why.push(`error: ${error ?? summary?.errorCode ?? "?"}`);
  else if (c.problem.expectWrite) {
    if (!written) why.push(`no write event (${result})`);
    else if (!numbersIn(written).includes(c.problem.expectWrite)) why.push(`wrote ${written}, not ${c.problem.expectWrite}`);
    if (overlayB64) why.push("painted as well");
  } else if (c.problem.expectNoRecheck && (summary?.tutorWrongSums?.length ?? 0) > 0) why.push(`recheck fired on the kid's own sum: ${summary?.tutorWrongSums?.join("; ")}`);
  else if (result === "write") {
    // the server wrote the value itself: right when it is the answer (and only Solve writes)
    if (c.mode !== "answer") why.push(`wrote in ${c.mode} mode: ${written}`);
    else if (c.problem.answer.length && !c.problem.answer.every((a) => numbersIn(written).includes(a))) why.push(`wrote ${written}, not ${c.problem.answer.join(", ")}`);
  }
  else if (c.mode === "feedback" && c.work === "right") {
    if (result !== "none") why.push("drew on right work");
    else if (!correct) why.push("no checkmark (correct=false)");
  } else {
    if (result !== "done") why.push(`nothing drawn (${result})`);
    if (c.mode === "answer" && result === "done" && c.problem.answer.length && !answerShown) why.push("final answer not read in the picture");
    if (c.mode !== "answer" && answerShown) why.push("gave away the final answer");
    if (wrongSums.length) why.push(`false sum read: ${wrongSums.join("; ")}`);
    if (overlapPct > 15) why.push(`over the kid's writing: ${overlapPct}%`);
    if (washPct > 4) why.push(`grey wash: ${washPct}%`);
  }
  const scored: Scored = {
    id: c.id, type: c.problem.type, mode: c.mode, work: c.work, frame: c.frame, placement: c.placement, hand: c.hand,
    expect: expectation(c), result, correct, instructions: written ? `write: ${written}` : instructions, read, falseEquations: wrongSums, answerShown,
    overlapPct, washPct, overlayPx, tutorModel: summary?.tutorModel ?? "", paints: summary?.paints ?? (result === "done" ? 1 : 0),
    readbackStrays: summary?.readbackStrays ?? [], tutorWrongSums: summary?.tutorWrongSums ?? [], ms, costUsd: Math.round(cost * 1e5) / 1e5,
    pass: why.length === 0, why, ...(error ? { error } : {}),
  };
  writeFileSync(join(dir, "data.json"), JSON.stringify({ ...scored, lines: workLines(c) }, null, 2));
  return scored;
}

async function main() {
  let cases = process.argv.includes("--extra") ? extraCases() : process.argv.includes("--all") ? [...benchCases(), ...extraCases()] : benchCases();
  if (ONLY) cases = cases.filter((c) => ONLY.includes(c.id));
  cases = cases.slice(0, LIMIT);
  console.log(`${RUN}: ${cases.length} cases, spent so far $${ledger.total.toFixed(3)} of $${BUDGET}`);
  const results: Scored[] = [];
  let next = 0;
  const worker = async () => {
    while (next < cases.length) {
      if (ledger.total >= BUDGET) {
        console.log("budget reached: stopping");
        return;
      }
      const c = cases[next++];
      const s = await runCase(c);
      results.push(s);
      console.log(`${s.pass ? "PASS" : "FAIL"} ${s.id} ${s.result}${s.correct ? "+correct" : ""} ${s.ms}ms $${s.costUsd} ${s.tutorModel.split("/")[1] ?? ""} ${s.why.join(" | ")}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  results.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
  writeReport(results);
  const pass = results.filter((r) => r.pass).length;
  console.log(`\n${RUN}: ${pass}/${results.length} pass; run spend $${(ledger.runs[RUN] ?? 0).toFixed(3)}; total $${ledger.total.toFixed(3)}`);
  console.log(`report: ${join(OUT, "report.html")}`);
}

function rate(rs: Scored[], key: keyof Scored): string {
  const groups = new Map<string, Scored[]>();
  for (const r of rs) groups.set(String(r[key]), [...(groups.get(String(r[key])) ?? []), r]);
  return [...groups.entries()].map(([k, g]) => `${k} ${g.filter((r) => r.pass).length}/${g.length}`).join(" · ");
}

function writeReport(rs: Scored[]) {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const by = (["mode", "type", "frame", "placement", "hand"] as const).map((k) => `<p><b>${k}</b>: ${esc(rate(rs, k))}</p>`).join("");
  const rows = rs
    .map(
      (r) => `<tr class="${r.pass ? "pass" : "fail"}"><td><b>${esc(r.id)}</b><br>${esc(r.type)}<br>${r.mode} · ${r.work} · ${r.frame} · ${r.placement} · ${r.hand}<br><i>${esc(r.expect)}</i></td>
<td><img src="${r.id}/board.png"></td><td>${existsSync(join(OUT, r.id, "result.png")) ? `<img src="${r.id}/result.png">` : "—"}</td>
<td><b>${r.pass ? "PASS" : "FAIL"}</b> ${esc(r.why.join("; "))}<br>${r.result}${r.correct ? " + correct" : ""} · ${r.ms} ms · $${r.costUsd} · ${esc(r.tutorModel)}${r.paints > 1 ? " · repainted" : ""}${r.tutorWrongSums.length ? ` · rechecked (${esc(r.tutorWrongSums.join("; "))})` : ""}<br>overlap ${r.overlapPct}% · wash ${r.washPct}%<br><small>tutor: ${esc(r.instructions)}</small><br><small>read: ${esc(r.read)}</small></td></tr>`,
    )
    .join("\n");
  const pass = rs.filter((r) => r.pass).length;
  const html = `<!doctype html><meta charset="utf-8"><title>Picture bench ${esc(RUN)}</title>
<style>body{font:14px -apple-system,Helvetica,sans-serif;margin:16px;background:#fafafa;color:#111}table{border-collapse:collapse;width:100%}td{border-top:1px solid #ddd;padding:8px;vertical-align:top}img{width:360px;border:1px solid #ccc;background:#fff}tr.fail td:first-child{border-left:4px solid #d33}tr.pass td:first-child{border-left:4px solid #2a2}small{color:#555}</style>
<h1>Picture bench: ${esc(RUN)}</h1><p><b>${pass}/${rs.length} pass</b> · spend this run $${(ledger.runs[RUN] ?? 0).toFixed(3)} · bench total $${ledger.total.toFixed(3)}</p>${by}
<table>${rows}</table>`;
  writeFileSync(join(OUT, "report.html"), html);
}

await main();
