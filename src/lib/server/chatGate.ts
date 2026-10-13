import type pino from "pino";
import type { ChatAction, ChatRequest, DrawModelAction, TeachAction, WriteProofAction } from "@/lib/live/chat/contracts";
import { figureProblems } from "@/lib/live/chat/figure";
import { CHAT_GRAPH_READ } from "@/lib/live/chat/limits";
import { modelProblems } from "@/lib/live/chat/models/check";
import { PROOF_CHECK, wantsHardProof } from "@/lib/live/chat/proof";
import { commonestReason } from "@/lib/live/chat/verify";
import type { LiveEngine } from "@/lib/live/contracts";
import { FigureSpecSchema } from "@/lib/live/figureDraw/contracts";
import { refundInk } from "@/lib/server/billing";
import { gateChatProof, PROOF_NOT_WRITTEN } from "@/lib/server/chatProof";
import { gateChatProblems, PROBLEM_DROP_WHY, type ProblemDropReason, type ProblemsRepair } from "@/lib/server/chatProblems";
import { gateChatTeach, TEACH_NOT_WRITTEN } from "@/lib/server/chatTeach";
import { chatJsonWithFallback } from "@/lib/server/openrouter";
import { recordRouteEvent } from "@/lib/server/request";
import {
  buildFigureRepairMessages,
  buildProblemsRepairMessages,
  buildProofRepairMessages,
  buildTeachRepairMessages,
  cleanChatActions,
  dropMissingProblems,
  FigureRepairReplySchema,
  problemsFromRepair,
  ProblemsRepairReplySchema,
  ProofRepairReplySchema,
  teachFromRepair,
  TeachRepairReplySchema,
  type DroppedAction,
} from "@/lib/server/prompts/chat";
import { buildModelRepairMessages, ModelRepairReplySchema } from "@/lib/server/prompts/model";

/**
 * The board chat's engine gates, shared by POST /api/live/chat and POST /api/live/ask: what the
 * model proposed for the board goes in, and what the board may write comes out, with notes for the
 * panel. Moved out of the chat route whole, so both routes hold the board to the same checks:
 *
 *  - every action is validated with zod one by one (`cleanChatActions`); an invalid one is dropped,
 *    never guessed at;
 *  - a `write_problems` keeps only the problems the engine verifies (`gateChatProblems`), with ONE
 *    repair round-trip for the ones it refuses; none left drops the set;
 *  - a `teach` goes on only when the engine has checked every line of its maths (`gateChatTeach`),
 *    with ONE repair round-trip; its figure is left out when the drawer still rejects it;
 *  - a `write_proof` goes on only when the engine's planner proves it (`gateChatProof`), with ONE
 *    repair round-trip; "the hardest proof ever" is held to it;
 *  - a `draw_figure` the drawer reports problems with gets ONE repair round-trip, else it is dropped;
 *  - a `draw_model` (Ask's visual models) the board's spec check refuses (`modelProblems`: more
 *    shaded than parts, a jump off its line, a label that says other than the picture) gets ONE repair
 *    round-trip, else it is dropped with a note;
 *  - a `graph` goes on only when the engine graphs every relation in it as the board will
 *    (`CHAT_GRAPH_READ`), else it is dropped with a note: a reply never says it graphed something
 *    the board then cannot draw;
 *  - a `help_problem` about a number the screen does not have is dropped with a note;
 *  - everything else (`write_lines`, `new_screen`, `clear_tutor`, Ask's `help_board`) goes on as
 *    it came: the board runs it.
 *
 * Every repair fits the route's time (`deadline`): one is not started with less than REPAIR_MIN_MS
 * left, and the platform never kills a request mid-way. When the model proposed something and
 * nothing survived, the reply is replaced with why, and the ink is given back unless the route says
 * the student still got an answer (`refundWhen`: Ask's kept explanation). Problems the engine refused and repairs the time did not allow are app events
 * (`route.live.<route>`), since the student reads a note about them.
 */

/** The figure repair is one small call (at most one per request). */
const REPAIR_ATTEMPT_MS = 10_000;
/** A proof's repair carries its figure and statements back (at most one per request). */
const PROOF_REPAIR_ATTEMPT_MS = 14_000;
/** A worked solution's repair works the problem again (at most one per request). */
const TEACH_REPAIR_ATTEMPT_MS = 16_000;
/** A problem set's repair: new problems for the ones the engine refused (at most one per request). */
const PROBLEMS_REPAIR_ATTEMPT_MS = 10_000;
/** A repair is not started with less than this left of the route's time. */
const REPAIR_MIN_MS = 6_000;

export const PROBLEMS_NOT_WRITTEN = "I couldn't check those problems, so I didn't write them.";
const problemsLeftOut = (n: number, of: number) => `${n} of ${of} problems couldn't be checked, so I left ${n === 1 ? "it" : "them"} out.`;

export const FIGURE_NOT_DRAWN = "The figure couldn't be drawn.";
export const GRAPH_NOT_DRAWN = "The graph couldn't be drawn.";
export const MODEL_NOT_DRAWN = "The picture couldn't be drawn.";
/** What the panel says when a graph was all the reply proposed and the board cannot draw it. */
export const GRAPH_NOT_DRAWN_REPLY = "Sorry, I couldn't draw that graph. Try asking for it another way.";

/** The maths engine the teach and problem checks run on, loaded on the first one (mathjs, ~2 MB). */
let enginePromise: Promise<LiveEngine> | null = null;
function gateEngine(): Promise<LiveEngine> {
  enginePromise ??= import("@/lib/live/engine").then((m) => m.getEngine());
  return enginePromise;
}

export interface ChatGateContext {
  /** what the student asked, as parsed: the repairs read it, and the screen's problem numbers */
  request: Pick<ChatRequest, "message" | "history" | "screen" | "problem">;
  /** the models the repairs ask (the chat's for /api/live/chat, Ask's for /api/live/ask) */
  models: { primary: string; fallback: string };
  /**
   * The repairs' reasoning per model ("low" for every model when unset, as the chat's always was;
   * Ask's primary is Anthropic's, which takes none: its thinking budget starts at 1024 tokens).
   */
  reasoningFor?: (model: string) => "none" | "minimal" | "low" | undefined;
  /** the route's word in the repairs' titles ("chat" → "Agathon Live - chat proof"), so their model events are the route's */
  route: string;
  /** the model that proposed the actions (in the events' meta) */
  model: string;
  /** the request's own signal: a student who left ends the repairs */
  signal: AbortSignal;
  requestId: string;
  /** the user `requireUser` verified: whose charge is given back when nothing survives */
  userId: string;
  log: pino.Logger;
  startedAt: number;
  /** the route's own end (epoch ms): every repair ends by then */
  deadline: number;
  /**
   * Nothing the model proposed survived: whether the ink comes back, given the line the panel shows
   * instead (`replacement`). Unset: always, as the old chat, whose reply was only about the board.
   * Ask keeps its explanation above that line, so it refunds only when the line is all the student
   * sees (`explains`, askReply.ts): a real answer with a failed board part is still an answer.
   */
  refundWhen?: (replacement: string) => boolean;
}

/** What the gate did, for the route's log line. */
export interface ChatGateStats {
  repairs: number;
  proofRepairs: number;
  proofsDropped: number;
  teachRepairs: number;
  teachesDropped: number;
  teachChecked: number;
  problemRepairs: number;
  problemsDropped: number;
  problemsReplaced: number;
  repairsSkipped: number;
  modelRepairs: number;
  modelsDropped: number;
  graphsDropped: number;
}

export interface ChatGateResult {
  /** what the board may write, in order */
  actions: ChatAction[];
  /** what was left out, in words for the panel ("The figure couldn't be drawn.") */
  notes: string[];
  /**
   * The model proposed something and nothing survived: what the panel says instead of the model's
   * reply ("Sorry, I couldn't draw that figure."). Null otherwise: the reply stands.
   */
  replacement: string | null;
  /** the ink was given back (nothing survived, and `refundWhen` agreed) */
  refunded: boolean;
  /** how many actions the model proposed (an unreadable board block counts as one) */
  proposed: number;
  /** what was dropped and why (for the log) */
  dropped: DroppedAction[];
  stats: ChatGateStats;
}

/**
 * Gate the model's proposed actions (`raw`, unvalidated) for the board. `unread` are proposals that
 * could not even be read (Ask's board block that was not JSON): each counts as proposed and
 * dropped, so a reply whose board part was lost is answered and refunded as one whose every action
 * was dropped.
 */
export async function chatGate(raw: readonly unknown[], ctx: ChatGateContext, unread: readonly DroppedAction[] = []): Promise<ChatGateResult> {
  const { request: data, models, route, model, signal, requestId, userId, log, startedAt, deadline } = ctx;
  const reasoningFor = ctx.reasoningFor ?? (() => "low" as const);

  /** repairs not started because the route's time was running out (an event when any) */
  let repairsSkipped = 0;
  const repairTime = () => {
    if (deadline - Date.now() >= REPAIR_MIN_MS) return true;
    repairsSkipped++;
    return false;
  };
  const title = (what: string) => `Agathon Live - ${route} ${what}`;

  const proposed = raw.length + unread.length;
  const { actions: valid, dropped } = cleanChatActions(raw);
  dropped.unshift(...unread);
  const notes: string[] = [];

  /** One repair round-trip for a proof the engine could not prove: the model gets the engine's problems. */
  const repairProof = async (action: WriteProofAction, problems: readonly string[]) => {
    if (!repairTime()) return null;
    try {
      const { data: fixed } = await chatJsonWithFallback(models.primary, models.fallback, {
        messages: buildProofRepairMessages(data.message, action, problems),
        schema: ProofRepairReplySchema,
        signal,
        requestId,
        maxTokens: 2000,
        reasoningFor,
        latencyFirst: true,
        attemptTimeoutMs: PROOF_REPAIR_ATTEMPT_MS,
        deadline,
        title: title("proof"),
      });
      return fixed;
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, `${route} proof repair failed`);
      return null;
    }
  };

  /** One repair round-trip for a worked solution the engine could not check: the model gets its findings. */
  const repairTeach = async (action: TeachAction, problems: readonly string[]) => {
    if (!repairTime()) return null;
    try {
      const { data: fixed } = await chatJsonWithFallback(models.primary, models.fallback, {
        messages: buildTeachRepairMessages(data, action, problems),
        schema: TeachRepairReplySchema,
        signal,
        requestId,
        maxTokens: 3000,
        reasoningFor,
        latencyFirst: true,
        attemptTimeoutMs: TEACH_REPAIR_ATTEMPT_MS,
        deadline,
        title: title("teach"),
      });
      return teachFromRepair(fixed);
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, `${route} teach repair failed`);
      return null;
    }
  };

  /** One repair round-trip for problems the engine could not check: new ones, told why. */
  const repairProblems: ProblemsRepair = async (failed) => {
    if (!repairTime()) return null;
    try {
      const { data: fixed } = await chatJsonWithFallback(models.primary, models.fallback, {
        messages: buildProblemsRepairMessages(data.message, failed.map((f) => ({ problem: f.problem, why: PROBLEM_DROP_WHY[f.reason] }))),
        schema: ProblemsRepairReplySchema,
        signal,
        requestId,
        maxTokens: 1500,
        reasoningFor,
        latencyFirst: true,
        attemptTimeoutMs: PROBLEMS_REPAIR_ATTEMPT_MS,
        deadline,
        title: title("problems"),
      });
      return problemsFromRepair(fixed);
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, `${route} problems repair failed`);
      return null;
    }
  };

  // Visual models: checked by the board's spec check (`modelProblems`); ONE repair round-trip per
  // request when there is time, else dropped with a note.
  let modelRepairs = 0;
  let modelsDropped = 0;
  const gateModel = async (action: DrawModelAction): Promise<DrawModelAction | null> => {
    let problems = modelProblems(action.model);
    if (problems.length > 0 && modelRepairs === 0 && repairTime()) {
      modelRepairs++;
      try {
        const { data: fixed } = await chatJsonWithFallback(models.primary, models.fallback, {
          messages: buildModelRepairMessages(data.message, action.model, problems),
          schema: ModelRepairReplySchema,
          signal,
          requestId,
          maxTokens: 1500,
          reasoningFor,
          latencyFirst: true,
          attemptTimeoutMs: REPAIR_ATTEMPT_MS,
          deadline,
          title: title("model"),
        });
        problems = modelProblems(fixed.model);
        // the repaired model keeps the problem it goes with
        if (problems.length === 0) return { ...action, model: fixed.model };
      } catch (err) {
        log.warn({ err: err instanceof Error ? err.message : String(err) }, `${route} model repair failed`);
      }
    }
    if (problems.length === 0) return action;
    modelsDropped++;
    dropped.push({ type: "draw_model", reason: problems.slice(0, 3).join("; ").slice(0, 160) });
    return null;
  };

  // Figures: checked by the drawer; one repair round-trip when it stays cheap, else dropped.
  const actions: ChatAction[] = [];
  let repairs = 0;
  let figuresDropped = 0;
  // Proofs: proved by the engine's planner with the figure (`gateChatProof`), one repair, else dropped.
  let proofRepairs = 0;
  let proofsDropped = 0;
  // Worked solutions: every line checked by the engine (`gateChatTeach`), one repair, else dropped.
  let teachRepairs = 0;
  let teachesDropped = 0;
  let teachChecked = 0;
  // Problem sets: every problem verified by the engine (`gateChatProblems`), one repair, else left out.
  let problemRepairs = 0;
  let problemSetsDropped = 0;
  const problemDrops: ProblemDropReason[] = [];
  let problemsProposed = 0;
  let problemsReplaced = 0;
  // Graphs: every relation graphed by the engine as the board reads it (`CHAT_GRAPH_READ`), else dropped.
  let graphsDropped = 0;
  // "the hardest proof ever" is held to it: a proof that takes a few rows is sent back once
  const proofCheck = wantsHardProof(data.message) ? { minRows: PROOF_CHECK.hardMinRows } : {};
  for (const action of valid) {
    if (action.type === "write_problems") {
      problemsProposed += action.problems.length;
      const gated = await gateChatProblems(action, await gateEngine(), problemRepairs === 0 ? repairProblems : null);
      if (gated.repaired) problemRepairs++;
      problemDrops.push(...gated.dropped);
      if (gated.ok) {
        actions.push(gated.action);
        problemsReplaced += gated.replaced;
        if (gated.dropped.length > 0) notes.push(problemsLeftOut(gated.dropped.length, action.problems.length));
      } else {
        problemSetsDropped++;
        dropped.push({ type: "write_problems", reason: `none checked (${commonestReason(gated.dropped) ?? "?"})` });
      }
      continue;
    }
    if (action.type === "teach") {
      const gated = await gateChatTeach(action, await gateEngine(), teachRepairs === 0 ? (problems) => repairTeach(action, problems) : null);
      if (gated.repaired) teachRepairs++;
      if (gated.ok) {
        actions.push(gated.action);
        teachChecked += gated.checked;
        if (gated.figureDropped && !notes.includes(FIGURE_NOT_DRAWN)) notes.push(FIGURE_NOT_DRAWN);
      } else {
        teachesDropped++;
        dropped.push({ type: "teach", reason: gated.reason });
      }
      continue;
    }
    if (action.type === "write_proof") {
      const gated = await gateChatProof(action, proofRepairs === 0 ? (problems) => repairProof(action, problems) : null, proofCheck);
      if (gated.repaired) proofRepairs++;
      if (gated.ok) actions.push(gated.action);
      else {
        proofsDropped++;
        dropped.push({ type: "write_proof", reason: gated.reason });
      }
      continue;
    }
    if (action.type === "draw_model") {
      const gated = await gateModel(action);
      if (gated) actions.push(gated);
      continue;
    }
    if (action.type === "graph") {
      const engine = await gateEngine();
      let graphed = false;
      try {
        graphed = Boolean(engine.graphFor?.(action.relations, CHAT_GRAPH_READ));
      } catch {
        graphed = false;
      }
      if (graphed) actions.push(action);
      else {
        graphsDropped++;
        dropped.push({ type: "graph", reason: `not graphable: ${action.relations.join("; ")}`.slice(0, 160) });
      }
      continue;
    }
    if (action.type !== "draw_figure") {
      // write_lines, new_screen, clear_tutor, help_problem (checked below), help_board: the board runs them
      actions.push(action);
      continue;
    }
    let problems = figureProblems(action.figure);
    if (problems.length > 0 && repairs === 0 && repairTime()) {
      repairs++;
      try {
        const { data: fixed } = await chatJsonWithFallback(models.primary, models.fallback, {
          messages: buildFigureRepairMessages(data.message, action.figure, problems),
          schema: FigureRepairReplySchema,
          signal,
          requestId,
          maxTokens: 1500,
          reasoningFor,
          latencyFirst: true,
          attemptTimeoutMs: REPAIR_ATTEMPT_MS,
          deadline,
          title: title("figure"),
        });
        const spec = FigureSpecSchema.parse(fixed.figure);
        problems = figureProblems(spec);
        if (problems.length === 0) {
          // mended, still beside the problem it was asked for (`near`)
          actions.push({ ...action, figure: spec });
          continue;
        }
      } catch (err) {
        log.warn({ err: err instanceof Error ? err.message : String(err) }, `${route} figure repair failed`);
      }
    }
    if (problems.length === 0) {
      actions.push(action);
      continue;
    }
    figuresDropped++;
    dropped.push({ type: "draw_figure", reason: problems.slice(0, 3).join("; ").slice(0, 160) });
  }
  if (figuresDropped > 0 && !notes.includes(FIGURE_NOT_DRAWN)) notes.push(FIGURE_NOT_DRAWN);
  if (graphsDropped > 0) notes.push(GRAPH_NOT_DRAWN);
  if (modelsDropped > 0) notes.push(MODEL_NOT_DRAWN);
  if (proofsDropped > 0) notes.push(PROOF_NOT_WRITTEN);
  if (teachesDropped > 0) notes.push(TEACH_NOT_WRITTEN);
  if (problemSetsDropped > 0) notes.push(PROBLEMS_NOT_WRITTEN);

  // A screen added (or the tutor's ink cleared) only to make room for a figure, a picture, a graph, a
  // proof or a worked solution that could not be written is not something the student asked for:
  // with nothing else left, nothing is done.
  if (figuresDropped + modelsDropped + graphsDropped + proofsDropped + teachesDropped + problemSetsDropped > 0 && actions.every((a) => a.type === "new_screen" || a.type === "clear_tutor")) actions.length = 0;

  // Help with a problem that is not on this screen: dropped, and the panel says there is none.
  const present = dropMissingProblems(actions, data.screen);
  actions.splice(0, actions.length, ...present.actions);
  dropped.push(...present.dropped);
  notes.push(...present.notes);

  // Nothing the model proposed survived: say so plainly, and give the ink back (when the route
  // agrees: `refundWhen`).
  let replacement: string | null = null;
  let refunded = false;
  if (proposed > 0 && actions.length === 0) {
    replacement =
      teachesDropped > 0
        ? "Sorry, I couldn't check that working, so I didn't write it. Try asking again."
        : proofsDropped > 0
          ? "Sorry, I couldn't check that proof, so I didn't write it. Try asking for another one."
          : figuresDropped > 0
            ? "Sorry, I couldn't draw that figure."
            : modelsDropped > 0
              ? "Sorry, I couldn't draw that picture."
              : graphsDropped > 0
                ? GRAPH_NOT_DRAWN_REPLY
                : problemSetsDropped > 0
                ? "Sorry, I couldn't check those problems, so I didn't write them. Try asking for them another way."
                : present.notes.length > 0
                  ? present.notes[0]
                  : "Sorry, I couldn't do that on the board. Try asking another way.";
    notes.length = 0;
    if (ctx.refundWhen?.(replacement) ?? true) {
      const r = await refundInk({ userId, requestId }, log);
      refunded = r.refunded > 0;
    }
  }

  // Problems the engine refused (left out, or a whole set dropped): the student reads a note
  // about it, so the admin page hears of it too — with the engine's commonest reason in the code.
  const why = commonestReason(problemDrops);
  if (why) {
    recordRouteEvent(log, {
      level: "warn",
      code: `problems_dropped_${why}`,
      message: `${problemDrops.length} of ${problemsProposed} problems failed the engine's check`,
      meta: { dropped: problemDrops.length, proposed: problemsProposed, reasons: [...new Set(problemDrops)].join(","), replaced: problemsReplaced, repaired: problemRepairs > 0, setsDropped: problemSetsDropped, model },
    });
  }
  // A repair the route's time did not allow: what it would have fixed went out as it was.
  if (repairsSkipped > 0) {
    recordRouteEvent(log, {
      level: "warn",
      code: "budget",
      message: `${repairsSkipped} repair${repairsSkipped === 1 ? "" : "s"} not started: the route's time was running out`,
      meta: { skipped: repairsSkipped, ms: Date.now() - startedAt, budgetMs: deadline - startedAt, model },
    });
  }

  return {
    actions,
    notes,
    replacement,
    refunded,
    proposed,
    dropped,
    stats: {
      repairs,
      proofRepairs,
      proofsDropped,
      teachRepairs,
      teachesDropped,
      teachChecked,
      problemRepairs,
      problemsDropped: problemDrops.length,
      problemsReplaced,
      repairsSkipped,
      modelRepairs,
      modelsDropped,
      graphsDropped,
    },
  };
}
