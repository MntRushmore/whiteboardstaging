/**
 * The BOARD CHAT eval: real model calls on the chat corpus (./corpus.ts), scored on what the board
 * would do with each reply.
 *
 * Every request goes through the PRODUCTION prompt (`buildChatMessages`, src/lib/server/prompts/
 * chat.ts) and the reply is read the way the route reads it (`ChatReplyRawSchema`,
 * `cleanChatActions`: invalid actions dropped). Then, as the board would:
 *  - each problem is verified by the engine (`verifyProblem`: it reads, is not false, `localSolve`
 *    answers it, the hand can write it) — the share verified is the number that matters;
 *  - each figure spec is checked by the drawer (`checkFigure`), given the route's ONE repair
 *    round-trip when it has problems (a second call, counted in latency and cost), and planned
 *    (`planFigure` in the board's largest figure box);
 *  - each graph's relations are graphed by the engine (`graphFor`);
 *  - each proof is gated as the route gates it (`checkProofProposal`: the engine's planner proves it
 *    with the figure), with the route's ONE repair round-trip when it fails; each `write_lines`
 *    block is verified as the board verifies it (an algebra proof: every step equal).
 * And the request's own expectations: the action types it needs, the count of problems asked for,
 * a window when a range was asked for, no action for a request that is not maths help.
 *
 * Calls go through the model bench's client (cached on disk, priced, under a hard spend cap).
 */
import type { LiveEngine } from "@/lib/live/contracts";
import type { ChatAction, ChatActionType, WriteProofAction } from "@/lib/live/chat/contracts";
import { figureProblems } from "@/lib/live/chat/figure";
import { PROBLEM_GRID } from "@/lib/live/chat/layout";
import { checkProofProposal, type ProofProposalVerdict } from "@/lib/live/chat/proof";
import { answerOf, isChain, isCleanAnswer, verifyLines, verifyProblem, type ProblemVerdict } from "@/lib/live/chat/verify";
import { FigureSpecSchema, type FigureSpec } from "@/lib/live/figureDraw/contracts";
import { planFigure } from "@/lib/live/figureDraw";
import { planHandwriting } from "@/lib/live/handwriting";
import {
  buildChatMessages,
  buildFigureRepairMessages,
  buildProofRepairMessages,
  ChatReplyRawSchema,
  cleanChatActions,
  ProofRepairReplySchema,
  type DroppedAction,
} from "@/lib/server/prompts/chat";
import { callModel, pool, type BenchMessage, type CallContext, type CallRecord } from "../models/client";
import { parseModelJson } from "../models/json";
import { requestFor, type ChatCase } from "./corpus";

export interface ProblemScore {
  lines: string[];
  verdict: "verified" | Extract<ProblemVerdict, { ok: false }>["reason"];
  answer: string;
  clean: boolean;
}

export interface FigureScore {
  /** the spec passed the shared schema (else the action was dropped) */
  schema: boolean;
  /** `checkFigure` had nothing to say the first time */
  cleanFirst: boolean;
  /** clean after the route's one repair round-trip (or the first time) */
  cleanAfterRepair: boolean;
  /** `planFigure` drew it (not null) */
  drawn: boolean;
  problems: string[];
  repair?: Omit<CallRecord, "content">;
}

export interface ProofScore {
  /** the action passed the shared schema (else the route dropped it) */
  schema: boolean;
  worked: boolean;
  /** the engine's planner proved it the first time (`checkProofProposal`) */
  provedFirst: boolean;
  /** proved after the route's one repair round-trip (or the first time): it reaches the board */
  provedAfterRepair: boolean;
  /** the proof as the board writes it: rows and their reasons (the planner's) */
  rows: number;
  reasons: string[];
  prove: string;
  /** what the engine found wrong the first time */
  problems: string[];
  repair?: Omit<CallRecord, "content">;
}

export interface ChatResult {
  id: string;
  course: string;
  kind: string;
  model: string;
  /** the reply parsed as JSON with a reply string */
  json: boolean;
  proposed: number;
  valid: number;
  dropped: DroppedAction[];
  types: ChatActionType[];
  /** the request's expectations met (types, count, window, no answers, no action) */
  intent: boolean;
  intentWhy: string;
  problems: ProblemScore[];
  figures: FigureScore[];
  graphs: Array<{ relations: string[]; graphed: boolean; window: boolean }>;
  /** proofs (`write_proof`), gated as the route gates them */
  proofs: ProofScore[];
  /** `write_lines` blocks, verified as the board does (`verifyLines`) */
  lines: Array<{ lines: string[]; chain: boolean; ok: boolean; why: string }>;
  reply: string;
  call: Omit<CallRecord, "content">;
  content: string;
}

export interface ChatRunOptions {
  corpus: readonly ChatCase[];
  models: readonly string[];
  ctx: CallContext;
  engine: LiveEngine;
  concurrency?: number;
  log?: (line: string) => void;
}

/** The hand's interlock, as the board runs it: every glyph drawable at the problem size. */
const canDraw = (lines: readonly string[]) => planHandwriting(lines, { size: PROBLEM_GRID.size, seed: 1 }).unsupported.length === 0;

const FIGURE_BOX = { w: 460, h: 380 };

/** The request's expectations against what the reply would do. */
export function judgeIntent(c: ChatCase, actions: readonly ChatAction[]): { ok: boolean; why: string } {
  const types = actions.map((a) => a.type);
  if (c.expect.types.length === 0) return types.length === 0 ? { ok: true, why: "" } : { ok: false, why: `acted on a request it should decline (${types.join(", ")})` };
  const missing = c.expect.types.filter((t) => !types.includes(t));
  if (missing.length > 0) return { ok: false, why: `no ${missing.join(", ")}${types.length ? ` (got ${types.join(", ")})` : " (no action)"}` };
  const problems = actions.flatMap((a) => (a.type === "write_problems" ? a.problems : []));
  if (c.expect.count !== undefined && problems.length !== c.expect.count) return { ok: false, why: `${problems.length} problems for ${c.expect.count} asked` };
  if (c.expect.window && !actions.some((a) => a.type === "graph" && a.window)) return { ok: false, why: "no window for the range asked" };
  if (c.expect.noAnswers && problems.some((p) => p.some((l) => /^[a-z]\s*=\s*-?[\d.]+$/i.test(l.replace(/\s+/g, " ").trim())))) return { ok: false, why: "wrote the answer" };
  if (c.expect.worked !== undefined && !actions.some((a) => a.type === "write_proof" && a.worked === c.expect.worked)) return { ok: false, why: `a proof ${c.expect.worked ? "written whole" : "set up for the student"} was asked for` };
  if (c.expect.chain && !actions.some((a) => a.type === "write_lines" && isChain(a.lines))) return { ok: false, why: "not a chain of = lines" };
  return { ok: true, why: "" };
}

/** Every `write_lines` block as the board verifies it. */
export function scoreLines(engine: LiveEngine, actions: readonly ChatAction[]): ChatResult["lines"] {
  return actions.flatMap((a) => {
    if (a.type !== "write_lines") return [];
    const v = verifyLines(engine, a.lines, canDraw);
    return [{ lines: a.lines, chain: isChain(a.lines), ok: v.ok, why: v.ok ? "" : v.reason }];
  });
}

/** A proof as the route gates it: the engine's check, then (once per request) the repair's. */
export function proofScore(action: WriteProofAction, verdict: ProofProposalVerdict, after?: ProofProposalVerdict, repair?: Omit<CallRecord, "content">): ProofScore {
  const final = after ?? verdict;
  return {
    schema: true,
    worked: action.worked,
    provedFirst: verdict.ok,
    provedAfterRepair: final.ok,
    rows: final.ok ? final.proof.rows.length : 0,
    reasons: final.ok ? final.proof.rows.map((r) => r.reason) : [],
    prove: final.ok ? final.proof.prove : action.prove,
    problems: verdict.ok ? [] : verdict.problems,
    ...(repair ? { repair } : {}),
  };
}

export function scoreProblems(engine: LiveEngine, actions: readonly ChatAction[]): ProblemScore[] {
  const out: ProblemScore[] = [];
  for (const a of actions) {
    if (a.type !== "write_problems") continue;
    for (const lines of a.problems) {
      const v = verifyProblem(engine, lines, canDraw);
      const answer = v.ok ? answerOf(v.steps) : "";
      out.push({ lines, verdict: v.ok ? "verified" : v.reason, answer, clean: v.ok && isCleanAnswer(answer) });
    }
  }
  return out;
}

export function scoreGraphs(engine: LiveEngine, actions: readonly ChatAction[]): ChatResult["graphs"] {
  return actions.flatMap((a) => {
    if (a.type !== "graph") return [];
    let graphed = false;
    try {
      graphed = Boolean(engine.graphFor?.(a.relations));
    } catch {
      graphed = false;
    }
    return [{ relations: a.relations, graphed, window: Boolean(a.window) }];
  });
}

function drawn(spec: FigureSpec): boolean {
  try {
    return planFigure(spec, { seed: 1, box: FIGURE_BOX }) !== null;
  } catch {
    return false;
  }
}

/** Every request × model, scored. */
export async function runChat(opts: ChatRunOptions): Promise<ChatResult[]> {
  const jobs = opts.models.flatMap((model) => opts.corpus.map((c) => ({ model, c })));
  return pool(jobs, opts.concurrency ?? 4, async ({ model, c }) => {
    const messages = buildChatMessages(requestFor(c)) as BenchMessage[];
    const record = await callModel({ model, messages, maxTokens: 3000, json: true, reasoning: "low", timeoutMs: 60_000 }, opts.ctx);
    const { content, ...call } = record;
    const base = { id: c.id, course: c.course, kind: c.kind, model, call, content };
    const empty = { json: false, proposed: 0, valid: 0, dropped: [], types: [], problems: [], figures: [], graphs: [], proofs: [], lines: [], reply: "" };
    if (!record.ok) {
      opts.log?.(`${model} ${c.id}: call failed (${record.failure}: ${record.error})`);
      return { ...base, ...empty, intent: false, intentWhy: `call failed: ${record.failure}` };
    }
    const json = parseModelJson(content);
    const raw = ChatReplyRawSchema.safeParse(json ?? {});
    const isJson = Boolean(json) && raw.success && typeof (json as { reply?: unknown }).reply === "string";
    const reply = raw.success ? raw.data.reply : "";
    const rawActions = raw.success ? raw.data.actions : [];
    const { actions, dropped } = cleanChatActions(rawActions);

    // figures: the drawer's check, the route's one repair, the drawing
    const figures: FigureScore[] = [];
    const rawFigures = rawActions.filter((a) => a && typeof a === "object" && (a as { type?: unknown }).type === "draw_figure");
    let repaired = false;
    for (const f of rawFigures) {
      const parsed = FigureSpecSchema.safeParse((f as { figure?: unknown }).figure);
      if (!parsed.success) {
        figures.push({ schema: false, cleanFirst: false, cleanAfterRepair: false, drawn: false, problems: [parsed.error.issues[0]?.message ?? "schema"] });
        continue;
      }
      let spec = parsed.data;
      const first = figureProblems(spec);
      let problems = first;
      let repair: FigureScore["repair"];
      if (first.length > 0 && !repaired) {
        repaired = true;
        const rec = await callModel(
          { model, messages: buildFigureRepairMessages(c.message, spec, first) as BenchMessage[], maxTokens: 1500, json: true, reasoning: "low", timeoutMs: 60_000 },
          opts.ctx,
        );
        const { content: _c, ...rcall } = rec;
        void _c;
        repair = rcall;
        const fixed = FigureSpecSchema.safeParse((parseModelJson(rec.content) as { figure?: unknown } | null)?.figure);
        if (fixed.success) {
          const again = figureProblems(fixed.data);
          if (again.length === 0) spec = fixed.data;
          problems = again;
        }
      }
      figures.push({ schema: true, cleanFirst: first.length === 0, cleanAfterRepair: problems.length === 0, drawn: drawn(spec), problems: first, ...(repair ? { repair } : {}) });
    }

    // proofs: the engine's check (the route's gate), its one repair round-trip, the check again
    const proofs: ProofScore[] = [];
    let proofRepaired = false;
    for (const raw of rawActions.filter((a) => a && typeof a === "object" && (a as { type?: unknown }).type === "write_proof")) {
      const [action] = cleanChatActions([raw]).actions;
      if (!action || action.type !== "write_proof") {
        proofs.push({ schema: false, worked: true, provedFirst: false, provedAfterRepair: false, rows: 0, reasons: [], prove: "", problems: ["schema"] });
        continue;
      }
      const first = checkProofProposal(action);
      if (first.ok || proofRepaired) {
        proofs.push(proofScore(action, first));
        continue;
      }
      proofRepaired = true;
      const rec = await callModel(
        { model, messages: buildProofRepairMessages(c.message, action, first.problems) as BenchMessage[], maxTokens: 2000, json: true, reasoning: "low", timeoutMs: 60_000 },
        opts.ctx,
      );
      const { content: _rc, ...rcall } = rec;
      void _rc;
      const fixed = ProofRepairReplySchema.safeParse(parseModelJson(rec.content) ?? {});
      const after = fixed.success ? checkProofProposal({ ...action, ...fixed.data }) : first;
      proofs.push(proofScore(action, first, after, rcall));
    }

    let intent = judgeIntent(c, actions);
    // the route drops a figure still wrong after its one repair: the request then did not get its figure
    if (intent.ok && c.expect.types.includes("draw_figure") && !figures.some((f) => f.cleanAfterRepair)) intent = { ok: false, why: "the figure is still wrong after the repair (dropped)" };
    // …and a proof still unproved after its one repair
    if (intent.ok && c.expect.types.includes("write_proof") && !proofs.some((p) => p.provedAfterRepair)) intent = { ok: false, why: "the proof is still unproved after the repair (dropped)" };
    // an algebra proof whose steps the engine cannot all show equal is not written
    const lines = scoreLines(opts.engine, actions);
    if (intent.ok && c.expect.chain && !lines.some((l) => l.chain && l.ok)) intent = { ok: false, why: `the lines did not check out (${lines.map((l) => l.why).join(", ")})` };
    return {
      ...base,
      json: isJson,
      proposed: rawActions.length,
      valid: actions.length,
      dropped,
      types: actions.map((a) => a.type),
      intent: isJson && intent.ok,
      intentWhy: isJson ? intent.why : "not JSON",
      problems: scoreProblems(opts.engine, actions),
      figures,
      graphs: scoreGraphs(opts.engine, actions),
      proofs,
      lines,
      reply,
    };
  });
}

type Repaired = { repair?: Omit<CallRecord, "content"> };
const repairs = (r: { figures: readonly Repaired[]; proofs?: readonly Repaired[] }): Repaired[] => [...r.figures, ...(r.proofs ?? [])];

/** Latency of a request as the student waits for it: the call, plus a figure's or a proof's repair when there was one. */
export function requestLatencyMs(r: Pick<ChatResult, "call" | "figures"> & Partial<Pick<ChatResult, "proofs">>): number {
  return r.call.latencyMs + repairs(r).reduce((s, f) => s + (f.repair?.latencyMs ?? 0), 0);
}

/** Cost of a request: the call and any repair. */
export function requestCostUsd(r: Pick<ChatResult, "call" | "figures"> & Partial<Pick<ChatResult, "proofs">>): number {
  return r.call.costUsd + repairs(r).reduce((s, f) => s + (f.repair?.costUsd ?? 0), 0);
}
