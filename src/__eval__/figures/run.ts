/**
 * The FIGURE eval: real model calls on the figure corpus, scored on what the board would write.
 *
 * For each figure and model: the figure is rendered as the board's crop (./render.ts), sent with
 * its labels (as the recognizer reads them when it reads them right) through the PRODUCTION prompt
 * (`buildFigureMessages`, src/lib/server/prompts/figure.ts), the reply read the way the route reads
 * it (`figureSetup`: the structured read planned into equations, else the model's own lines) and
 * then decided the way the board decides (`figureAnswer`: the engine solves it, the answer is
 * checked). The written answer is compared with the figure's: correct, WRONG (a wrong answer on the
 * student's page — the number that matters most), or nothing written.
 *
 * The baseline is the prompt before this change (free-form setup lines only, `BASELINE_PROMPT`),
 * scored the way the board used to write it: the engine's answer to the lines, no sanity check.
 *
 * Calls go through the model bench's client (cached on disk, priced, under a hard spend cap).
 */
import type { LiveEngine } from "@/lib/live/contracts";
import { figureAnswer, finalValue } from "@/lib/live/figure";
import { localSolve } from "@/lib/live/localSolve";
import { validateSetupLines } from "@/lib/live/wordProblem";
import { buildFigureMessages, figureReasoning, figureSetup } from "@/lib/server/prompts/figure";
import { SetupReplySchema, cleanSetupReply } from "@/lib/server/prompts/setup";
import { callModel, pool, type BenchMessage, type CallContext, type CallRecord } from "../models/client";
import { parseModelJson } from "../models/json";
import type { FigureCase } from "./corpus";

export type Written = "correct" | "wrong" | "nothing";

export interface FigureResult {
  figure: string;
  config: string;
  model: string;
  prompt: "structured" | "baseline";
  written: Written;
  /** structured: where the written answer (or the refusal) came from */
  source: "facts" | "lines" | "none";
  /** structured: did the model's read plan (and solve) to the right answer on its own */
  factsCorrect: boolean;
  /** why the read was not used, or why nothing was written */
  reason: string;
  value: number | null;
  expected: number;
  call: Omit<CallRecord, "content">;
  content: string;
}

/** The figure prompt before the model perceived and the engine reasoned (kept to measure against). */
export const BASELINE_PROMPT = [
  "You read a student's hand-drawn maths figure — a triangle, angles, a circle, a rectangle, a number line, axes — and write the maths a student writes beside it to find what it asks. You never calculate.",
  "",
  "INPUT: an image of the figure with its labels; the labels as a handwriting reader read them (they may be misread: the image is the truth); the student's lines beside the figure, top to bottom, if any (a line like x = ? names what is asked).",
  'OUTPUT: one JSON object and nothing else: {"unknown": "<the letter asked for>", "lines": ["<LaTeX>", ...]}',
  "",
  "RULES:",
  "1. lines set the problem up from the figure, top to bottom, at most 4: the relation the figure shows (Pythagoras, the angles of a triangle, angles on a straight line, a perimeter or an area with the lengths in), then, when the unknown is squared, the unknown alone.",
  "2. Use the figure's own letters: a side labelled x is x, a vertex angle A is A. One letter per quantity. No \\angle, no \\triangle, no words, no units.",
  "3. Angles are plain numbers of degrees, without the degree sign: x + 40 + 65 = 180.",
  "4. Never compute: leave the arithmetic unsimplified, and never state the answer. A length found by Pythagoras is the equation, then the unknown as a square root: x^{2} = 3^{2} + 4^{2}, x = \\sqrt{3^{2} + 4^{2}}.",
  "5. KaTeX-renderable LaTeX, one relation per line; EVERY line contains =, < or >.",
  '6. If the figure asks nothing you can set up this way (no unknown marked, or not a figure), answer {"unknown": "", "lines": []}.',
].join("\n");

function baselineMessages(labels: readonly string[], crop: string): BenchMessage[] {
  const messages = buildFigureMessages({ lines: [], labels: [...labels], crop });
  return [{ role: "system", content: BASELINE_PROMPT }, messages[1] as BenchMessage];
}

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-6 * Math.max(1, Math.abs(b)), Number.isInteger(b) ? 1e-6 : 0.051);

export interface FigureRunOptions {
  corpus: readonly FigureCase[];
  models: readonly string[];
  ctx: CallContext;
  engine: LiveEngine;
  /** the crop of each figure (a data URL), by id */
  crops: ReadonlyMap<string, string>;
  prompt: "structured" | "baseline";
  concurrency?: number;
  log?: (line: string) => void;
}

/** Every figure × model, scored. */
export async function runFigures(opts: FigureRunOptions): Promise<FigureResult[]> {
  const jobs = opts.models.flatMap((model) => opts.corpus.map((figure) => ({ model, figure })));
  return pool(jobs, opts.concurrency ?? 4, async ({ model, figure }) => {
    const labels = figure.labels.map((l) => l.latex);
    const crop = opts.crops.get(figure.id)!;
    const messages = opts.prompt === "structured" ? (buildFigureMessages({ lines: [], labels, crop }) as BenchMessage[]) : baselineMessages(labels, crop);
    const record = await callModel(
      { model, messages, maxTokens: 1500, json: true, reasoning: figureReasoning(model) ?? null, timeoutMs: 60_000 },
      opts.ctx,
    );
    const { content, ...call } = record;
    const base = { figure: figure.id, config: figure.config, model, prompt: opts.prompt, expected: figure.answer.value, call, content };
    if (!record.ok) {
      opts.log?.(`${model} ${figure.id}: call failed (${record.failure}: ${record.error})`);
      return { ...base, written: "nothing", source: "none", factsCorrect: false, reason: `call failed: ${record.failure}`, value: null };
    }
    const json = parseModelJson(content);
    if (opts.prompt === "baseline") return { ...base, ...scoreBaseline(opts.engine, json, labels, figure) };
    const setup = figureSetup(json ?? {}, { lines: [], labels });
    const factsCorrect = setup.figure?.source === "facts" && (setup.figure.stages ?? []).some((s) => s.letter === figure.answer.letter && close(s.value, figure.answer.value));
    if (setup.lines.length === 0) return { ...base, written: "nothing", source: "none", factsCorrect: false, reason: setup.figure?.reason ?? "no lines", value: null };
    const answer = figureAnswer(opts.engine, setup, labels);
    const why = setup.figure?.source === "lines" ? `read not used: ${setup.figure.reason ?? "?"}` : "";
    if (!answer.ok) return { ...base, written: "nothing", source: answer.source, factsCorrect, reason: [why, answer.reason].filter(Boolean).join("; "), value: null };
    const got = answer.values.find((v) => v.letter === figure.answer.letter) ?? answer.values[0];
    const written: Written = got && close(got.value, figure.answer.value) ? "correct" : "wrong";
    return { ...base, written, source: answer.source, factsCorrect, reason: why, value: got?.value ?? null };
  });
}

/** The old board: the model's lines validated, the engine's answer written (no sanity check). */
function scoreBaseline(engine: LiveEngine, json: unknown, labels: readonly string[], figure: FigureCase): Pick<FigureResult, "written" | "source" | "factsCorrect" | "reason" | "value"> {
  const reply = SetupReplySchema.safeParse(json ?? {});
  const clean = cleanSetupReply(reply.success ? reply.data : { unknown: "", lines: [] });
  const setup = validateSetupLines(engine, clean.lines, labels);
  if (!setup) return { written: "nothing", source: "lines", factsCorrect: false, reason: clean.lines.length === 0 ? "no lines" : "the lines do not validate", value: null };
  let steps: string[] = [];
  try {
    steps = localSolve(engine, setup, undefined, { handwriting: true }).steps;
  } catch {
    steps = [];
  }
  const letter = clean.unknown || figure.answer.letter;
  const value = finalValue([...setup, ...steps], letter) ?? finalValue([...setup, ...steps], figure.answer.letter);
  // the old board wrote the setup even when the engine could not finish it: no answer on the page
  if (value === null) return { written: "nothing", source: "lines", factsCorrect: false, reason: "setup written, no answer", value: null };
  return { written: close(value, figure.answer.value) ? "correct" : "wrong", source: "lines", factsCorrect: false, reason: "", value };
}
